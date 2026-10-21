// The pricing engine. Pure functions over (model, quote state, live rates); no DOM, no network.
// Ported line by line from the MWL calculator (the UI team's prototype) so prices match it exactly,
// with one deliberate fix (see priceFor): weights that fall in the hairline gap between two 3-decimal
// weight bands are priced by the lower band instead of coming back unpriced.
//
// Quote state uses the MWL shape, so quotes and exports move freely between the two:
//   { quoteName, mode, job:{...}, price:{location,cadType,priceList,duty,currency,customer,customerRef},
//     metal:{m1,g1,m2,g2,laborMode,rateType,rateUser}, stones:[row...], addCharges, addPct, addBasis, addLabel, override,
//     images:{cad,ref}, sel:{cad,ref}, alt:{open, comps:[{id,name,stones}], metals:[{m1,m2}]} }
// Live rates: { spot: { AU: { price, at, src? }, ... }, fx: { rates: { EUR: 0.88, ... }, date, src } }
import { num, str, isGem, typeKey, round5, round4 } from "./util.js";

export const BLANK = "(blank)";          // an explicit blank clarity / spec — blank is a valid value in StonePrice
export const CUSTOM_SIZE = "__custom";
export const GEM_CT_UPLIFT = 1.25;      // gemstones are cut deeper: +25% on the catalogue ct/pc
export const ALT_MAX = 3;
export const ALT_L = ["A", "B", "C"];
export const TEXT_WHEN_CUSTOM = ["shape", "size", "color", "clarity", "spec"];
const OZ = 31.1035;

export function createPricer(model) {
  const sizesByShape = {}, sizeByCode = {};
  for (const s of model.sizes) {
    for (const sh of s.shapes) (sizesByShape[sh] ||= []).push(s);
    sizeByCode[s.code] = s;
  }
  const cmp = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  for (const a of Object.values(sizesByShape)) {
    const useSort = a.every((s) => Number.isFinite(s.sort));
    a.sort((x, y) => (useSort ? x.sort - y.sort : 0) || x.ct - y.ct || cmp(x.mm, y.mm) || cmp(x.wt, y.wt));
  }
  const SHAPE_CODE = Object.fromEntries(model.shapes.map((s) => [s.name, s.code]));
  const HANDLING = Object.fromEntries(model.types.map((t) => [t.name, t.handling]));
  const ORDER = { color: {}, clarity: {}, spec: {} };
  model.colors.forEach((m, i) => { if (!(m.name in ORDER.color)) ORDER.color[m.name] = i; });
  model.clarities.forEach((m, i) => { if (!(m.name in ORDER.clarity)) ORDER.clarity[m.name] = i; });
  model.specs.forEach((m, i) => { if (!(m.name in ORDER.spec)) ORDER.spec[m.name] = i; });
  const first = (l) => (l.find((m) => m.def) || {}).name || "";
  const DEF = {
    type: first(model.types), shape: first(model.shapes),
    colors: model.colors.filter((m) => m.def).map((m) => m.name),
    clarities: model.clarities.filter((m) => m.def).map((m) => m.name),
    specs: model.specs.filter((m) => m.def).map((m) => m.name),
    cad: first(model.cad), labor: model.laborDefault,
  };
  const TYPES = model.types.map((t) => t.name).concat(["Custom"]);
  const SHAPES = model.shapes.map((s) => s.name);
  const CAD = model.cad.map((c) => [c.name, c.fee]);
  const SG = Object.fromEntries(model.alloys.filter((a) => a.sg).map((a) => [a.code, a.sg]));
  const alloyBy = Object.fromEntries(model.alloys.map((a) => [a.code, a]));
  /**
   * Older names for each alloy, so CAD orders ("14KT" + "WG") and quotes saved before the sheet renamed its codes
   * (e.g. "18KT YG" -> "18YG", "14KT WG-PD" -> "14WG (PD)") still find their metal. Built from purity and name.
   */
  const legacyKeys = (a) => {
    const keys = [];
    if (a.metal !== "AU" || !a.purity) return keys;
    const kt = Math.round(a.purity * 24), txt = (a.code + " " + a.name).toUpperCase();
    if (kt >= 22) return [kt + "KT"];
    const col = /PD/.test(txt) ? "WG-PD" : /WNS|NI SAFE/.test(txt) ? "WG" : /W/.test(txt) && /NI FREE/.test(txt) ? "WG-NF"
      : /YG|YELLOW/.test(txt) ? "YG" : /RG|ROSE/.test(txt) ? "RG" : /RD|RED/.test(txt) ? "RD" : "";
    if (col) keys.push(`${kt}KT ${col}`);
    if (col === "WG-NF") keys.push(`${kt}KT WG`);       // only used when the sheet has no Ni-safe white for that karat
    return keys;
  };
  const LEGACY = new Map();
  for (const pass of [0, 1]) model.alloys.forEach((a) => { const k = legacyKeys(a)[pass]; if (k && !LEGACY.has(k)) LEGACY.set(k, a.code); });
  const norm = (v) => String(v ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  /** Any alloy name (current code, old code, "14KT WG", "14k wg", "750YG") -> current code, or "". */
  function findAlloy(text) {
    const v = norm(text);
    if (!v) return "";
    const exact = model.alloys.find((a) => norm(a.code) === v) || model.alloys.find((a) => norm(a.name) === v);
    if (exact) return exact.code;
    const k = v.replace(/^(\d+)\s*K(T)?\b\s*/, "$1KT ").trim();
    if (LEGACY.has(k)) return LEGACY.get(k);
    const kt = k.match(/^(\d+KT)( |$)/);   // karat only, or an unknown colour: first alloy of that karat (as MWL did)
    if (kt) for (const [key, code] of LEGACY) if (key === kt[1] || key.startsWith(kt[1] + " ")) return code;
    return "";
  }

  /* ---------- lookups ---------- */
  const locOf = (code) => model.locations.find((l) => l.code === code);
  const LM = (caption) => model.labor.find((m) => m.caption === caption) || model.labor[0] || { caption: "", cast: true, cad: true, set: true, minFlat: 0, upto: 0, gm: 0 };
  const isTier = (lm) => !lm.cad || !lm.set || !lm.cast;
  const plCode = (name) => (model.priceLists.find((p) => p.name === name) || {}).code || name;
  const defaultPricelist = (code) => {
    const l = locOf(code);
    return l ? ((model.priceLists.find((p) => p.code === l.priceList) || {}).name || l.priceList) : (model.priceLists[0] || {}).name;
  };
  const sizesFor = (shape) => sizesByShape[SHAPE_CODE[shape] || shape] || [];
  const sizeLabel = (r) => (r.size === CUSTOM_SIZE ? r.dims || "custom" : (sizeByCode[r.size] || {}).mm || r.size);

  /** Label As: the LabelAs tab (location + color + clarity + spec; blank matches blank), else "Color / Clarity Spec". */
  function defaultLabel(r, loc) {
    if (r.type === "Mount" || !r.color) return "";
    const q = (v) => (v === BLANK ? "" : str(v));
    const hit = model.labelAs.find((l) => l.loc === loc && l.color === q(r.color) && l.clarity === q(r.clarity) && l.spec === q(r.spec));
    if (hit) return hit.label;
    const tail = [q(r.clarity), q(r.spec)].filter(Boolean).join(" ");
    return tail ? `${q(r.color)} / ${tail}` : q(r.color);
  }
  const labelOf = (r, loc) => str(r.label) || defaultLabel(r, loc);

  /** Currency rate incl. the location's buffer, rounded to 4 decimals before use. 0 = no location / no rate. */
  function fxRate(quote, live) {
    if (!quote.price.location || !quote.price.currency) return 0;
    const c = quote.price.currency;
    if (c === "USD") return 1;
    const l = locOf(quote.price.location);
    const base = (live && live.fx && live.fx.rates && live.fx.rates[c]) || (l && l.currency === c ? l.fxSheet : 0) || 0;
    if (!base) return 0;
    return round4(base * (1 + (l ? l.buffer : 0)));
  }
  const setFor = (ct) => (!ct ? null : model.setting.find((s) => ct <= s.upto + 1e-9) || model.setting[model.setting.length - 1] || null);

  /* ---------- stone price lookups ---------- */
  function priceRows(r, upto, priceList) {
    const pl = plCode(priceList), tk = typeKey(r.type), sh = SHAPE_CODE[r.shape] || r.shape;
    const qv = (v) => (v === BLANK ? "" : v);
    return model.prices.filter((p) => p.pl.includes(pl) && p.type.includes(tk) && p.shape.includes(sh)
      && (upto < 1 || p.color.includes(qv(r.color))) && (upto < 2 || p.clarity.includes(qv(r.clarity))) && (upto < 3 || p.spec.includes(qv(r.spec))));
  }
  function distinct(rows, key, ord) {
    const out = [];
    rows.forEach((p) => p[key].forEach((v) => { const x = v === "" ? BLANK : v; if (!out.includes(x)) out.push(x); }));
    const o = (v) => (v in ord ? ord[v] : v === BLANK ? -1 : 1e6);
    return out.filter((v) => key !== "color" || v !== BLANK).sort((a, b) => o(a) - o(b) || a.localeCompare(b));
  }
  const priced = (r) => r.type && r.shape && r.type !== "Mount" && r.type !== "Custom";
  const colorsFor = (r, pl) => (priced(r) ? distinct(priceRows(r, 0, pl), "color", ORDER.color) : []);
  const claritiesFor = (r, pl) => (priced(r) && r.color ? distinct(priceRows(r, 1, pl), "clarity", ORDER.clarity) : []);
  const specsFor = (r, pl) => (priced(r) && r.color && r.clarity ? distinct(priceRows(r, 2, pl), "spec", ORDER.spec) : []);

  /**
   * $/ct from the price list: an exact size row first, then a weight band (WtFr–WtTo, inclusive) on rows without a size.
   * Fix over MWL: a weight inside the gap between two 3-decimal bands (e.g. 0.00375 between …0.003 and 0.004…) takes
   * the band it follows, as long as it is less than 0.001 ct past that band's end. MWL returned no price there.
   * -> { rate, how: "size" | "band" | "gap", row } or null
   */
  function priceMatch(r, ctpc, pl) {
    if (!priced(r) || !r.color || !r.clarity || !r.spec) return null;
    const rows = priceRows(r, 3, pl);
    const exact = r.size && r.size !== CUSTOM_SIZE && rows.find((p) => p.size && p.size === r.size);
    if (exact) return { rate: exact.rate, how: "size", row: exact.row };
    const ct = Math.round(ctpc * 1e4) / 1e4;
    if (!(ct > 0)) return null;
    const bands = rows.filter((p) => !p.size && Number.isFinite(p.fr) && Number.isFinite(p.to));
    const band = bands.find((p) => ct >= p.fr - 1e-9 && ct <= p.to + 1e-9);
    if (band) return { rate: band.rate, how: "band", row: band.row };
    const gap = bands.filter((p) => ct > p.to && ct < p.to + 0.001 - 1e-9).sort((a, b) => b.to - a.to)[0];
    return gap ? { rate: gap.rate, how: "gap", row: gap.row } : null;
  }
  const priceFor = (r, ctpc, pl) => { const m = priceMatch(r, ctpc, pl); return m ? m.rate : null; };

  /* ---------- row housekeeping (keeps colour → clarity → spec valid; fills single choices and defaults) ---------- */
  const rowEmpty = (r) => (!r.type || r.type === DEF.type) && (!r.shape || r.shape === DEF.shape) && !r.size && !r.pcs && !r.color && !r.clarity && !r.ctManual && !r.label && !r.ppcManual;
  function conformRow(r, quote) {
    if (!priced(r)) return r;
    const pl = quote.price.priceList;
    const ready = { color: () => true, clarity: () => !!r.color, spec: () => !!r.clarity };
    const defs = { color: DEF.colors, clarity: DEF.clarities, spec: DEF.specs };
    const step = (key, list) => {
      if (r[key] && list.length && !list.includes(r[key])) r[key] = "";
      if (!r[key] && list.length === 1) r[key] = list[0];
      else if (!r[key] && ready[key]()) { const d = defs[key].find((v) => list.includes(v)); if (d) r[key] = d; }
      return !!r[key];
    };
    step("color", colorsFor(r, pl)) && step("clarity", claritiesFor(r, pl)) && step("spec", specsFor(r, pl));
    if (!r.color) { r.clarity = ""; r.spec = ""; } else if (!r.clarity) r.spec = "";
    const key = [quote.price.location, r.color, r.clarity, r.spec].join("|");
    if (r.labelKey === undefined && r.label) r.labelKey = key;
    if (r.labelKey !== key) { r.label = defaultLabel(r, quote.price.location); r.labelKey = key; }
    return r;
  }
  const conformFilled = (r, quote) => { if (!rowEmpty(r)) conformRow(r, quote); };

  /* ---------- metal ---------- */
  /** Spot for a metal: the live price, else the sheet's backup spot rate. */
  function spotOf(k, live) {
    const s = live && live.spot && live.spot[k];
    if (s && s.price > 0) return s.price;
    return (model.metals[k] || {}).sheetSpot || 0;
  }
  /** $/g for a metal type: PM or spot × surcharge, per oz → per g, × wastage. */
  function metalRateG(k, rateType, live) {
    const m = model.metals[k];
    if (!m) return 0;
    const usePm = rateType === "PM" && m.pm;
    const spot = spotOf(k, live);
    const oz = usePm ? m.pm : spot ? spot * m.surcharge : m.pm;
    return ((oz || 0) / OZ) * m.wastage;
  }
  function alloyRateG(code, rateType, live) {
    const a = alloyBy[code];
    if (!a) return 0;
    return metalRateG(a.metal, rateType, live) * a.purity + (a.pd ? metalRateG("PD", rateType, live) : 0);
  }
  /** Casting charge slabs for the alloy's metal (e.g. Au: first 6.99 g @15, up to 24.99 g @10, rest @5). */
  function castSlab(code, g) {
    const a = alloyBy[code];
    if (!a || !g) return 0;
    const slabs = model.casting[a.metal] || [];
    let prev = 0, v = 0;
    for (const [upto, rate] of slabs) { const take = Math.min(g, upto) - prev; if (take > 0) v += take * rate; prev = upto; if (g <= upto) break; }
    return v;
  }
  /** Every policy: grams × GmRate, never below MinFlat; nothing when there are no grams. */
  const laborFor = (gms, lm) => (!gms ? 0 : Math.round(Math.max(lm.minFlat, gms * lm.gm)));
  const metalVal = (code, g, rateType, live) => (g ? alloyRateG(code, rateType, live) * g : 0);
  function metalCosts(m1, g1, m2, g2, lm, rateType, live) {
    const gms = g1 + g2;
    const value = metalVal(m1, g1, rateType, live) + metalVal(m2, g2, rateType, live);
    const castChg = lm.cast ? castSlab(m1, g1) + castSlab(m2, g2) : 0;
    return { gms, value, castChg, casting: Math.round(value + castChg), labor: laborFor(gms, lm) };
  }

  /* ---------- one stone row ---------- */
  function calcRow(r, quote) {
    const lm = LM(quote.metal.laborMode);
    const pl = quote.price.priceList;
    const isText = r.type === "Custom", mount = r.type === "Mount";
    const sz = !isText && r.size && r.size !== CUSTOM_SIZE ? sizeByCode[r.size] : null;
    const custom = isText || r.size === CUSTOM_SIZE || (!!r.size && !sz);
    let ctpc = sz ? sz.ct : num(r.ctManual);
    if (sz && isGem(r.type)) ctpc = ctpc * GEM_CT_UPLIFT;
    const match = mount || isText ? null : priceMatch(r, ctpc, pl);
    const listPrice = match ? match.rate : null;
    const auto = listPrice != null;
    const manualPpc = !mount && !auto;
    const handling = auto ? HANDLING[r.type] || 0 : 0;      // only on prices found in StonePrice
    const ppc = mount ? 0 : auto ? listPrice + handling : num(r.ppcManual);
    const pcs = Math.max(0, Math.floor(num(r.pcs)));
    const cttw = ctpc * pcs, total = cttw * ppc;
    const st = setFor(ctpc), modeEdit = isText || !st;
    const modeAuto = st ? st.mode : "PPC", mode = modeEdit && r.setMode ? r.setMode : modeAuto;
    const setEdit = isText || !st;
    const setAuto = st ? st.rate : 0, setRate = setEdit && String(r.setRate ?? "").trim() !== "" ? num(r.setRate) : setAuto;
    const setTot = !lm.set ? 0 : setRate * (mode === "PCT" ? cttw : pcs);
    const flags = [];
    const empty = rowEmpty(r);
    if (!empty) {
      if (!r.type) flags.push("Pick type");
      if (!isText) {
        if (!r.shape) flags.push("Pick shape");
        else if (!r.size) flags.push("Pick size");
        if (priced(r) && (!r.color || !r.clarity || !r.spec) && colorsFor(r, pl).length) flags.push("Pick color, clarity & spec");
      }
      if (custom && !num(r.ctManual)) flags.push("Enter ct/pc");
      if (manualPpc && !num(r.ppcManual) && !flags.length) flags.push("No list price — enter $/ct");
      if (!pcs) flags.push("Enter pcs");
    }
    return { isText, custom, sz, ctpc, ppc, listPrice, handling, auto, how: match ? match.how : null, priceRow: match ? match.row : null, setEdit, modeEdit, modeAuto, manualPpc, pcs, cttw, total, mode, setAuto, setRate, setTot, flags, empty };
  }

  function stoneSums(rows, quote) {
    let pcs = 0, ct = 0, dia = 0, set = 0, flagged = 0;
    rows.forEach((r) => {
      const c = calcRow(r, quote);
      if (r.type !== "Mount") { pcs += c.pcs; ct += c.cttw; }
      dia += c.total; set += c.setTot;
      if (c.flags.length) flagged++;
    });
    return { pcs, ct, dia, set, flagged };
  }

  /* ---------- the quote ---------- */
  function totals(quote, live) {
    const { pcs, ct, dia, set, flagged } = stoneSums(quote.stones, quote);
    const g1 = num(quote.metal.g1), g2 = num(quote.metal.g2), lm = LM(quote.metal.laborMode);
    const rateType = effectiveRateType(quote);
    const { gms, casting, labor, value, castChg } = metalCosts(quote.metal.m1, g1, quote.metal.m2, g2, lm, rateType, live);
    const cad = !lm.cad ? 0 : (CAD.find((c) => c[0] === quote.price.cadType) || [, 0])[1];
    const subtotal = casting + labor + cad + dia + set;
    const add = quote.addBasis === "pct" ? Math.round(subtotal * num(quote.addPct)) / 100 : num(quote.addCharges);
    const addPct = subtotal ? (add / subtotal) * 100 : 0;
    const gross = subtotal + add;
    const duty = num(quote.price.duty);
    const withDuty = gross ? round5(gross * (1 + duty / 100)) : 0;
    const fx = fxRate(quote, live);
    const local = withDuty && fx ? round5(withDuty * fx) : 0;
    const ov = num(quote.override);
    return { pcs, ct, dia, set, flagged, gms, tier: isTier(lm), lm, laborMode: lm.caption, rateType, casting, value, castChg, labor, cad, subtotal, add, addPct, gross, duty, withDuty, fx, local, ov, final: ov || local };
  }
  /** PM only when the sheet has a usable PM rate and the user chose it; otherwise Spot (MWL behaviour). */
  const effectiveRateType = (quote) => (model.pm.ok && quote.metal.rateType === "PM" ? "PM" : "Spot");

  /* ---------- variant pricing (alternate metals × stone variants) ---------- */
  const activeVariants = (quote) => quote.alt.metals.map((m, k) => ({ k, ...m })).filter((m) => m.m1);
  /** Grams of an alternate metal pair, converted from Metal Details by specific gravity. */
  function altGrams(quote, pair) {
    const b1 = quote.metal.m1, g1 = num(quote.metal.g1), b2 = quote.metal.m2, g2 = num(quote.metal.g2);
    if (!pair.m1) return null;
    if (!b1 || !g1 || !SG[b1] || !SG[pair.m1]) return { err: "Enter Metal 1 & gms" };
    const out = { m1: pair.m1, g1: (g1 * SG[pair.m1]) / SG[b1], m2: "", g2: 0 };
    if (g2) {
      out.m2 = pair.m2 || b2;
      out.g2 = b2 && SG[b2] && SG[out.m2] ? (g2 * SG[out.m2]) / SG[b2] : g2;
    }
    return out;
  }
  const baseGrams = (quote) => ({ m1: quote.metal.m1, g1: num(quote.metal.g1), m2: quote.metal.m2, g2: num(quote.metal.g2) });
  /** One cell: same CAD, add charges, duty and fx as the main quote. */
  function altCell(quote, stoneVals, g, t, live) {
    if (!g || g.err) return null;
    const mc = metalCosts(g.m1, g.g1, g.m2, g.g2, t.lm, t.rateType, live);
    const gross = mc.casting + mc.labor + t.cad + stoneVals.dia + stoneVals.set + t.add;
    const withDuty = gross ? round5(gross * (1 + t.duty / 100)) : 0;
    return { ...mc, gross, withDuty, local: withDuty && t.fx ? round5(withDuty * t.fx) : 0 };
  }
  /** Rows of the grid: saved variants, or — before any is saved — the current stone details. */
  function altRows(quote) {
    if (quote.alt.comps.length) return quote.alt.comps;
    if (!activeVariants(quote).length) return [];
    const st = quote.stones.filter((r) => !rowEmpty(r));
    return [{ id: "__cur", name: st.length ? "As in Stone Details" : "Metal only", stones: st, implicit: true }];
  }
  function compName(quote, rows) {
    const parts = [];
    rows.forEach((r) => { if (r.type === "Mount") return; const q = labelOf(r, quote.price.location) || r.type; if (q && !parts.includes(q)) parts.push(q); });
    return parts.slice(0, 3).join(" + ") || (rows.length ? "Variant " + (quote.alt.comps.length + 1) : "Metal only");
  }
  /** The whole grid as data (used by the screen, the PDF and the GATI export). */
  function variantGrid(quote, live) {
    const t = totals(quote, live);
    const cols = [{ key: "b", label: "As entered", g: baseGrams(quote) }].concat(activeVariants(quote).map((v) => ({ key: v.k, label: "Metal " + ALT_L[v.k], g: altGrams(quote, v) })));
    const rows = altRows(quote).map((comp) => {
      const sv = stoneSums(comp.stones, quote);
      return { comp, sv, cells: cols.map((c) => altCell(quote, sv, c.g, t, live)) };
    });
    return { t, cols, rows };
  }

  return {
    model, DEF, TYPES, SHAPES, SHAPE_CODE, CAD, SG, ORDER, sizeByCode, alloyBy, findAlloy,
    locOf, LM, isTier, plCode, defaultPricelist, sizesFor, sizeLabel, defaultLabel, labelOf, fxRate, setFor,
    priceRows, colorsFor, claritiesFor, specsFor, priceMatch, priceFor, priced, rowEmpty, conformRow, conformFilled,
    spotOf, metalRateG, alloyRateG, castSlab, laborFor, metalCosts, calcRow, stoneSums, totals, effectiveRateType,
    activeVariants, altGrams, baseGrams, altCell, altRows, compName, variantGrid,
  };
}
