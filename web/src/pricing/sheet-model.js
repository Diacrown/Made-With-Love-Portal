// The master sheet -> a validated pricing model.
//
// Input: tabs as arrays of rows ({ TabName: [[header...], [cells...]] }), from the Google Sheet CSV export,
// an .xlsx file, or the snapshot built into the old MWL page. Cells may be strings or numbers.
// Output: { ok, model, report }. When report.errors is not empty, ok is false and the model must not be published:
// the app keeps serving the last good model, and the report says exactly which cell to fix.
//
// The normalisation follows the MWL calculator (the UI team's prototype) column for column, so that a quote priced
// here equals the same quote priced there (see tests/mwl-parity).
import { nnum, nz, frac, str, csvList, yes, typeKey, objs, parsePmDate, hash } from "./util.js";
import { OPTIONAL_TABS } from "./sheet-config.js";

export const MODEL_SCHEMA = 2;

export const REQUIRED_COLUMNS = {
  Location: ["LocationCode", "Currency", "Duty", "StonePriceList"],
  Master: ["Type", "Name"],
  Size: ["SHAPE", "CODE", "CT_PC"],
  StonePrice: ["StonePriceList", "StoneType", "StoneShape", "StoneSize", "StoneColor", "StoneClarity", "StoneSpec", "Rate", "WtFr", "WtTo"],
  SettingRates: ["UptoCtWt", "RateMode", "Rate"],
  LaborPolicy: ["Caption", "CastingCharges", "CADCharges", "SettingCharges", "MinFlat"],
  CastingRates: ["Metal", "UptoGms", "RatePerGram"],
  MetalMaster: ["MetalType", "Wastage"],
  AlloyMaster: ["AlloyCode", "SG", "MetalType", "Purity"],
  LabelAs: ["LocationCode", "StoneColor", "StoneClarity", "StoneSpec", "LabelAs"],
};

class Report {
  constructor() { this.errors = []; this.warnings = []; this.groups = new Map(); }
  error(where, message) { this.errors.push({ where, message }); }
  warn(where, message) { this.warnings.push({ where, message }); }
  /** Collects one warning per (tab, message) with the list of rows it applies to. */
  group(tab, message, row) {
    const k = tab + "\u0000" + message;
    if (!this.groups.has(k)) this.groups.set(k, { tab, message, rows: [] });
    this.groups.get(k).rows.push(row);
  }
  flushGroups() {
    for (const g of this.groups.values()) {
      const rows = g.rows.length > 8 ? `${g.rows.slice(0, 8).join(", ")} … (${g.rows.length} rows)` : g.rows.join(", ");
      this.warn(`${g.tab} rows ${rows}`, g.message);
    }
    this.groups.clear();
  }
}

const sortKey = (n) => (Number.isFinite(n) ? n : 1e9);

/**
 * buildModel(tabs, { previous, source })
 *   previous: the last published model (for the change summary)
 *   source:   { kind: "google-sheet" | "xlsx" | "snapshot", id?, fetchedAt? }
 */
export function buildModel(tabs, { previous = null, source = {} } = {}) {
  const R = new Report();

  // ---- tabs and columns present ----
  for (const [tab, cols] of Object.entries(REQUIRED_COLUMNS)) {
    const t = tabs[tab];
    if (!t || !t.length) {
      if (OPTIONAL_TABS.includes(tab)) { R.warn(tab, `The ${tab} tab is missing or empty; it is optional.`); continue; }
      R.error(tab, `The ${tab} tab is missing or empty.`);
      continue;
    }
    const head = (t[0] || []).map(str);
    for (const c of cols) if (!head.includes(c)) R.error(`${tab}!1`, `The ${tab} tab has no "${c}" column.`);
  }
  if (R.errors.length) return { ok: false, model: null, report: finish(R, null, previous) };

  // ---- Master ----
  const M = objs(tabs.Master);
  const master = (types) => M
    .filter((m) => [].concat(types).some((t) => str(m.Type).toLowerCase() === t.toLowerCase()))
    .map((m, k) => ({ name: str(m.Name), sort: nnum(m.SortNo), code: str(m.Code), group: str(m.Group), def: yes(m.Default), k, row: m._row }))
    .filter((m) => m.name)
    .sort((a, b) => sortKey(a.sort) - sortKey(b.sort) || a.k - b.k);
  const knownMasterTypes = ["stonetype", "stoneshape", "stonecolor", "stoneclarity", "stonespec", "cadlevel", "cadtype", "stonepricellist", "stonepricelist"];
  const unused = new Map();
  for (const m of M) if (str(m.Type) && !knownMasterTypes.includes(str(m.Type).toLowerCase())) unused.set(str(m.Type), (unused.get(str(m.Type)) || 0) + 1);
  if (unused.size) R.warn("Master", `Lists not used by the calculator (fine to keep): ${[...unused].map(([t, n]) => `${t} (${n})`).join(", ")}.`);
  const dupes = (list, what) => {
    const seen = new Map();
    for (const m of list) {
      if (seen.has(m.name)) R.warn(`Master row ${m.row}`, `${what} "${m.name}" is listed twice (also row ${seen.get(m.name)}); the first is used.`);
      else seen.set(m.name, m.row);
    }
  };

  const st = master("StoneType");
  dupes(st, "Stone type");
  const types = st.map((m) => ({ name: m.name, key: typeKey(m.name), handling: nz(m.group), def: m.def }));
  if (!types.length) R.error("Master", "No StoneType rows.");

  const shp = master("StoneShape");
  dupes(shp, "Shape");
  const shapes = shp.map((m) => ({ name: m.name, code: m.code || m.name, def: m.def }));
  if (!shapes.length) R.error("Master", "No StoneShape rows.");
  const shapeCodes = new Set(shapes.map((s) => s.code));

  const ordered = (type) => master(type).sort((a, b) => sortKey(a.sort) - sortKey(b.sort) || a.name.localeCompare(b.name));
  const qualityList = (type, what) => { const l = ordered(type); dupes(l, what); return l.map((m) => ({ name: m.name, group: m.group, def: m.def })); };
  const colors = qualityList("StoneColor", "Color");
  const clarities = qualityList("StoneClarity", "Clarity");
  const specs = qualityList("StoneSpec", "Spec");

  const cadRows = master(["CADType", "CADLevel"]);
  dupes(cadRows, "CAD level");
  const cad = cadRows.map((m) => ({ name: m.name, fee: nz(m.sort), def: m.def }));
  if (!cad.some((c) => c.name.toLowerCase() === "none")) R.warn("Master", 'No CAD level called "None"; labour policies that switch CAD off will still charge $0.');

  const plRows = master(["StonePricelList", "StonePriceList"]);
  const priceLists = plRows.map((m) => ({ name: m.name, code: m.code || m.name }));
  if (!priceLists.length) R.error("Master", "No StonePricelList rows.");
  const plCodes = new Set(priceLists.map((p) => p.code));

  // ---- Size ----
  const sizes = [];
  const sizeCodes = new Map();
  for (const s of objs(tabs.Size)) {
    const sh = csvList(s.SHAPE).filter(Boolean);
    if (!sh.length) { if (str(s.CODE)) R.warn(`Size row ${s._row}`, `Size ${str(s.CODE)} has no SHAPE; it is not offered anywhere.`); continue; }
    const knownSh = sh.filter((c) => shapeCodes.has(c));
    for (const c of sh) if (!shapeCodes.has(c)) R.group("Size", knownSh.length
      ? `Shape "${c}" is not a StoneShape code in Master; these sizes are still offered for their other shapes.`
      : `Shape "${c}" is not a StoneShape code in Master, so these sizes are never offered. Add the shape to Master or fix the code.`, s._row);
    const code = str(s.CODE) || "#" + (str(s.SORT_NO) || str(s.MM_Caption) || s._row);
    if (!str(s.CODE)) R.warn(`Size row ${s._row}`, `No CODE: the size is offered, but only weight-band prices can apply to it.`);
    if (sizeCodes.has(code)) { R.error(`Size row ${s._row}`, `Size code ${code} is listed twice (also row ${sizeCodes.get(code)}).`); continue; }
    const ct = nnum(s.CT_PC);
    if (!(ct > 0)) R.warn(`Size row ${s._row}`, `Size ${code} has no CT_PC weight; stones of this size will weigh 0 ct.`);
    sizeCodes.set(code, s._row);
    sizes.push({ code, shapes: sh, mm: str(s.MM_Caption) || code, wt: str(s.WT_Caption), ct: Number.isFinite(ct) ? ct : 0, sort: nnum(s.SORT_NO), seq: nnum(s.SEQ_NO), k: sizes.length });
  }

  // ---- Location ----
  const locations = [];
  for (const l of objs(tabs.Location)) {
    const code = str(l.LocationCode);
    if (!code) continue;
    const where = `Location row ${l._row}`;
    const cur = str(l.Currency).toUpperCase() || "USD";
    if (!/^[A-Z]{3}$/.test(cur)) R.error(where, `${code}: currency "${str(l.Currency)}" is not a 3-letter code.`);
    const duty = frac(l.Duty), buffer = frac(l.CurrencyBuffer);
    if (!(duty >= 0 && duty < 1)) R.error(where, `${code}: duty "${str(l.Duty)}" is not between 0% and 100%.`);
    if (!(buffer >= 0 && buffer <= 0.5)) R.error(where, `${code}: currency buffer "${str(l.CurrencyBuffer)}" is not between 0% and 50%.`);
    const pl = str(l.StonePriceList);
    if (!plCodes.has(pl)) R.error(where, `${code}: StonePriceList "${pl}" is not a StonePricelList code in Master.`);
    if (locations.some((x) => x.code === code)) { R.error(where, `Location ${code} is listed twice.`); continue; }
    locations.push({
      code, alias: str(l.Alias), name: str(l.Name), address: str(l.Address), phone: str(l.Phone), email: str(l.Email),
      taxCaption: str(l.TaxCaption ?? l.Tax_Caption), currency: cur, buffer, duty, priceList: pl, metalCaption: str(l.MetalCaption),
      fxSheet: nz(l.FXR) || nz(l.FxRate),
    });
  }
  locations.sort((a, b) => (a.alias || a.code).localeCompare(b.alias || b.code));
  if (!locations.length) R.error("Location", "No locations.");

  // ---- LaborPolicy ----
  const laborRows = objs(tabs.LaborPolicy).filter((m) => str(m.Caption));
  const labor = laborRows.map((m) => {
    const where = `LaborPolicy row ${m._row}`;
    const minFlat = nnum(m.MinFlat), gm = nnum(m.GmRate);
    if (str(m.MinFlat) && !Number.isFinite(minFlat)) R.error(where, `${str(m.Caption)}: MinFlat "${str(m.MinFlat)}" is not a number.`);
    if (str(m.GmRate) && !Number.isFinite(gm)) R.error(where, `${str(m.Caption)}: GmRate "${str(m.GmRate)}" is not a number.`);
    return { caption: str(m.Caption), desc: str(m.Description), cast: yes(m.CastingCharges), cad: yes(m.CADCharges), set: yes(m.SettingCharges), minFlat: nz(m.MinFlat), upto: nz(m.FlatUptoGm), gm: nz(m.GmRate), def: yes(m.Default) };
  });
  if (!labor.length) R.error("LaborPolicy", "No labour policies.");
  const laborDefault = (labor.find((m) => m.def) || labor.find((m) => /^standard$/i.test(m.caption)) || labor[0] || {}).caption || "";
  for (const m of labor) if (m.upto) R.warn("LaborPolicy", `${m.caption}: FlatUptoGm (${m.upto} g) is shown but not used in the price — labour is the larger of MinFlat and grams × GmRate.`);

  // ---- LabelAs ----
  const labelAs = objs(tabs.LabelAs || []).filter((l) => str(l.LabelAs)).map((l) => ({ loc: str(l.LocationCode), color: str(l.StoneColor), clarity: str(l.StoneClarity), spec: str(l.StoneSpec), label: str(l.LabelAs) }));

  // ---- SettingRates ----
  const setting = [];
  for (const s of objs(tabs.SettingRates)) {
    const upto = nnum(s.UptoCtWt);
    if (!Number.isFinite(upto)) { if (str(s.UptoCtWt) || str(s.Rate)) R.error(`SettingRates row ${s._row}`, `UptoCtWt "${str(s.UptoCtWt)}" is not a number.`); continue; }
    const mode = str(s.RateMode).toUpperCase();
    if (mode !== "PPC" && mode !== "PCT") R.error(`SettingRates row ${s._row}`, `RateMode "${str(s.RateMode)}" must be PPC (per piece) or PCT (per carat).`);
    if (!Number.isFinite(nnum(s.Rate))) R.error(`SettingRates row ${s._row}`, `Rate "${str(s.Rate)}" is not a number.`);
    setting.push({ upto, mode, rate: nz(s.Rate), rule: str(s.SettingRule) });
  }
  setting.sort((a, b) => a.upto - b.upto);
  if (!setting.length) R.error("SettingRates", "No setting rates.");

  // ---- CastingRates ----
  const casting = {};
  for (const c of objs(tabs.CastingRates)) {
    const m = str(c.Metal).toUpperCase();
    if (!m) continue;
    const upto = nnum(c.UptoGms), rate = nnum(c.RatePerGram);
    if (!Number.isFinite(upto) || !Number.isFinite(rate)) { R.error(`CastingRates row ${c._row}`, `${m}: UptoGms and RatePerGram must be numbers.`); continue; }
    (casting[m] ||= []).push([upto, rate]);
  }
  for (const a of Object.values(casting)) a.sort((x, y) => x[0] - y[0]);

  // ---- MetalMaster ----
  const metals = {};
  const mmRows = objs(tabs.MetalMaster);
  for (const m of mmRows) {
    const k = str(m.MetalType).toUpperCase();
    if (!k) continue;
    const where = `MetalMaster row ${m._row}`;
    const wastage = nnum(m.Wastage), sur = nnum(m.SpotRateSurcharge), pm = nnum(m.PMRateSource);
    if (!(wastage > 0)) R.error(where, `${k}: Wastage "${str(m.Wastage)}" must be a positive number.`);
    if (str(m.SpotRateSurcharge) && !(sur > 0)) R.error(where, `${k}: SpotRateSurcharge "${str(m.SpotRateSurcharge)}" must be a positive number.`);
    const ss = nnum(m.BackupSpotRate) || nnum(m.SpotRate);
    metals[k] = { code: str(m.MetalType), name: str(m.Name), wastage: wastage > 0 ? wastage : 1, surcharge: sur > 0 ? sur : 1, pm: pm > 0 ? pm : 0, pmDate: str(m.PMRateDate), spotSrc: str(m.SpotRateSource), sheetSpot: ss > 0 ? ss : 0 };
  }
  for (const k of ["AU", "PT", "PD", "AG"]) if (!metals[k]) R.error("MetalMaster", `No ${k} row.`);
  const au = metals.AU;
  const dates = Object.values(metals).map((m) => m.pmDate).filter(Boolean).sort((a, b) => (parsePmDate(b) || 0) - (parsePmDate(a) || 0));
  const auSrc = str((mmRows.find((m) => str(m.MetalType).toUpperCase() === "AU") || {}).PMRateSource);
  const pm = { ok: !!(au && au.pm), dateTxt: (au && au.pmDate) || dates[0] || "", date: null, err: "" };
  pm.date = parsePmDate(pm.dateTxt);
  pm.err = !au ? "No gold row in MetalMaster"
    : !au.pm ? (/^(INDEX|IMPORTHTML)\(/i.test(auSrc) ? 'PMRateSource holds the formula as text — add "=" in front of it in MetalMaster' : /^(#|Loading)/i.test(auSrc) ? `The sheet could not load the PM page (${auSrc.slice(0, 20)})` : "PM rate unavailable — check PMRateSource in MetalMaster")
    : !pm.date ? `PMRateDate unreadable (${pm.dateTxt.slice(0, 30)})` : "";
  if (!pm.date) pm.ok = false;
  if (!pm.ok) R.warn("MetalMaster", `${pm.err}. Quotes will use spot rates until it is fixed.`);

  // ---- AlloyMaster ----
  const alloys = [];
  for (const a of objs(tabs.AlloyMaster)) {
    const code = str(a.AlloyCode);
    if (!code) continue;
    const where = `AlloyMaster row ${a._row}`;
    const sg = nnum(a.SG), purity = nnum(a.Purity), metal = str(a.MetalType).toUpperCase();
    if (!(sg > 0)) R.error(where, `${code}: SG "${str(a.SG)}" must be a positive number.`);
    if (!(purity > 0 && purity <= 1)) R.error(where, `${code}: Purity "${str(a.Purity)}" must be between 0 and 1.`);
    if (!metals[metal] && !casting[metal]) R.warn(where, `${code}: metal type "${metal}" has no MetalMaster or CastingRates row, so its metal value and casting are $0.`);
    else if (!metals[metal]) R.warn(where, `${code}: metal type "${metal}" has no MetalMaster row, so its metal value is $0 (casting is still charged).`);
    if (alloys.some((x) => x.code === code)) { R.error(where, `Alloy ${code} is listed twice.`); continue; }
    alloys.push({ code, name: str(a.AlloyName), rank: nnum(a.Rank), sg: sg > 0 ? sg : 0, metal, purity: nz(a.Purity), pd: yes(a.PDAlloy), star: yes(a.Starred) });
  }
  alloys.sort((a, b) => sortKey(a.rank) - sortKey(b.rank) || a.code.localeCompare(b.code));
  if (alloys.some((a) => a.pd) && !metals.PD) R.error("AlloyMaster", "Palladium alloys exist but MetalMaster has no PD row.");

  // ---- StonePrice ----
  const typeKeys = new Set(types.map((t) => t.key));
  const knownColor = new Set(colors.map((c) => c.name)), knownClarity = new Set(clarities.map((c) => c.name)), knownSpec = new Set(specs.map((c) => c.name));
  const prices = [];
  const unknownQ = { color: new Map(), clarity: new Map(), spec: new Map() };
  for (const p of objs(tabs.StonePrice)) {
    if (!str(p.StonePriceList) || !str(p.StoneType)) {
      if (Object.values(p).some((v) => str(v))) R.warn(`StonePrice row ${p._row}`, "Row has no StonePriceList or StoneType and is ignored.");
      continue;
    }
    const where = `StonePrice row ${p._row}`;
    const row = {
      pl: csvList(p.StonePriceList), type: csvList(p.StoneType).map(typeKey), shape: csvList(p.StoneShape), size: str(p.StoneSize),
      color: csvList(p.StoneColor), clarity: csvList(p.StoneClarity), spec: csvList(p.StoneSpec),
      rate: nnum(p.Rate), fr: nnum(p.WtFr), to: nnum(p.WtTo), sku: str(p.SKU), row: p._row,
    };
    // Rows that can never apply (unknown list / type / shape / size, or an impossible band) are reported, not fatal:
    // the old calculator ignores them too, so they cannot change a price. Anything that would make a price wrong is fatal.
    // A list cell ("RND,PRN,ASC") with one unknown code still prices the codes that are known — as the old
    // calculator does; only the unknown code is ignored. The row is dead only when no known code is left.
    let dead = "";
    const keep = (key, known, label) => {
      const bad = row[key].filter((x) => x && !known.has(x));
      if (!bad.length) return;
      row[key] = row[key].filter((x) => !x || known.has(x));
      if (row[key].length) for (const x of bad) R.group("StonePrice", `${label} "${x}" is not in Master; it is ignored on these rows (the other ${label.toLowerCase()}s on them still price).`, p._row);
      else dead ||= `${label.toLowerCase()} "${bad[0]}" is not in Master`;
    };
    keep("pl", plCodes, "Price list");
    keep("type", typeKeys, "Stone type");
    keep("shape", shapeCodes, "Shape code");
    if (row.size && !sizeCodes.has(row.size)) dead ||= `size "${row.size}" is not on the Size tab`;
    const hasFr = str(p.WtFr) !== "", hasTo = str(p.WtTo) !== "";
    if (!(row.rate > 0)) { R.error(where, `Rate "${str(p.Rate)}" must be a positive number.`); continue; }
    if (!row.size) {
      if (!hasFr || !hasTo) dead ||= "it has no StoneSize and no WtFr/WtTo weight band";
      else if (!Number.isFinite(row.fr) || !Number.isFinite(row.to)) { R.error(where, `WtFr "${str(p.WtFr)}" / WtTo "${str(p.WtTo)}" must be numbers.`); continue; }
      else if (row.fr > row.to) R.warn(where, `WtFr ${row.fr} is above WtTo ${row.to}, so this band can never match and those stones need a typed price. Check the formula in WtFr.`), (dead ||= "impossible band");
    }
    if (dead) {
      if (dead !== "impossible band") R.group("StonePrice", `Never used, because ${dead}.`, p._row);
      continue;
    }
    for (const [k, known] of [["color", knownColor], ["clarity", knownClarity], ["spec", knownSpec]]) {
      for (const v of row[k]) if (v && !known.has(v)) { const m = unknownQ[k]; if (!m.has(v)) m.set(v, []); m.get(v).push(p._row); }
    }
    prices.push(row);
  }
  R.flushGroups();
  for (const [k, m] of Object.entries(unknownQ)) {
    for (const [v, rows] of m) R.warn("StonePrice", `${k[0].toUpperCase() + k.slice(1)} "${v}" is not in Master (rows ${rows.slice(0, 6).join(", ")}${rows.length > 6 ? ", …" : ""}); it still prices but sorts last.`);
  }
  checkOverlaps(prices, R);
  if (!prices.length) R.error("StonePrice", "No usable prices.");

  const model = {
    schema: MODEL_SCHEMA,
    types, shapes, colors, clarities, specs, cad, priceLists, sizes, locations, labor, laborDefault, labelAs, setting, casting, metals, alloys, prices, pm,
    meta: { source: { kind: source.kind || "", id: source.id || "", fetchedAt: source.fetchedAt || null, by: source.by || "", at: source.at || null }, builtAt: new Date().toISOString(), version: "" },
  };
  model.meta.version = hash(JSON.stringify({ ...model, meta: null }));
  const report = finish(R, model, previous);
  return { ok: R.errors.length === 0, model: R.errors.length ? null : model, report };
}

/** Bands for the same list / type / shape / color / clarity / spec must not overlap; exact-size rows must not conflict. */
function checkOverlaps(prices, R) {
  const bands = new Map(), sized = new Map();
  for (const p of prices) {
    for (const pl of p.pl) for (const ty of p.type) for (const sh of p.shape) for (const co of p.color) for (const cl of p.clarity) for (const sp of p.spec) {
      const k = [pl, ty, sh, co, cl, sp].join("|");
      if (p.size) {
        const k2 = k + "|" + p.size;
        const prev = sized.get(k2);
        if (prev && prev.rate !== p.rate) R.error(`StonePrice row ${p.row}`, `${label(k)} size ${p.size}: ${p.rate} here but ${prev.rate} on row ${prev.row}.`);
        else if (!prev) sized.set(k2, p);
      } else {
        if (!bands.has(k)) bands.set(k, []);
        bands.get(k).push(p);
      }
    }
  }
  let reported = 0;
  for (const [k, list] of bands) {
    list.sort((a, b) => a.fr - b.fr || a.to - b.to);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      if (b.fr <= a.to + 1e-9 && a.row !== b.row) {
        if (reported++ < 40) R.error(`StonePrice row ${b.row}`, `${label(k)}: band ${b.fr}–${b.to} ct overlaps ${a.fr}–${a.to} ct on row ${a.row}.`);
      }
    }
  }
  if (reported > 40) R.error("StonePrice", `…and ${reported - 40} more overlapping bands.`);
}
const label = (k) => k.split("|").filter(Boolean).join(" / ");

function finish(R, model, previous) {
  const report = { ok: R.errors.length === 0, errors: R.errors, warnings: R.warnings, at: new Date().toISOString() };
  if (model) {
    report.version = model.meta.version;
    report.stats = { locations: model.locations.length, sizes: model.sizes.length, prices: model.prices.length, alloys: model.alloys.length, labor: model.labor.length, pmOk: model.pm.ok };
    if (previous) report.changes = diffModels(previous, model);
  }
  return report;
}

/** What changed in prices between two models (for the sync report). */
export function diffModels(a, b) {
  const keys = (m) => {
    const out = new Map();
    for (const p of m.prices || []) {
      const k = [p.pl.join(","), p.type.join(","), p.shape.join(","), p.size || `${p.fr}-${p.to}`, p.color.join(","), p.clarity.join(","), p.spec.join(",")].join(" | ");
      out.set(k, p.rate);
    }
    return out;
  };
  const A = keys(a), B = keys(b);
  const changed = [], added = [], removed = [];
  for (const [k, v] of B) { if (!A.has(k)) added.push(`${k}: ${v}`); else if (A.get(k) !== v) changed.push(`${k}: ${A.get(k)} → ${v}`); }
  for (const k of A.keys()) if (!B.has(k)) removed.push(k);
  const setDiff = (x, y, f) => { const s = new Set((x || []).map(f)); return (y || []).filter((v) => !s.has(f(v))).length; };
  return {
    prices: { changed: changed.length, added: added.length, removed: removed.length, examples: [...changed.slice(0, 20), ...added.slice(0, 5).map((x) => "+ " + x), ...removed.slice(0, 5).map((x) => "− " + x)] },
    locations: setDiff(a.locations, b.locations, (l) => JSON.stringify(l)),
    sizes: setDiff(a.sizes, b.sizes, (s) => JSON.stringify([s.code, s.shapes, s.mm, s.wt, s.ct])),   // not the list position
    alloys: setDiff(a.alloys, b.alloys, (x) => JSON.stringify(x)),
    metals: setDiff(Object.values(a.metals || {}), Object.values(b.metals || {}), (m) => JSON.stringify([m.code, m.wastage, m.surcharge, m.pm, m.sheetSpot])),
    settings: JSON.stringify([a.labor, a.setting, a.casting, a.cad]) === JSON.stringify([b.labor, b.setting, b.casting, b.cad]) ? 0 : 1,
  };
}

/** Plain-text report for the CLI and the admin page. */
export function formatReport(report) {
  const out = [];
  out.push(report.ok ? `OK — data version ${report.version}` : "NOT PUBLISHED — fix the errors below");
  if (report.stats) out.push(`${report.stats.prices} prices, ${report.stats.sizes} sizes, ${report.stats.locations} locations, ${report.stats.alloys} alloys`);
  if (report.changes) {
    const c = report.changes.prices;
    out.push(`Since the last publish: ${c.changed} price(s) changed, ${c.added} added, ${c.removed} removed`);
    for (const e of c.examples) out.push("  " + e);
  }
  if (report.errors.length) { out.push("", `ERRORS (${report.errors.length})`); for (const e of report.errors) out.push(`  [${e.where}] ${e.message}`); }
  if (report.warnings.length) { out.push("", `WARNINGS (${report.warnings.length})`); for (const w of report.warnings) out.push(`  [${w.where}] ${w.message}`); }
  return out.join("\n");
}
