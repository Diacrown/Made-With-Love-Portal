// Quote state: creating, repairing and importing quotes. Same shape as the MWL calculator, so its saved quotes,
// exports ("for GATI") and CAD order files load here unchanged.
import { num, str } from "./util.js";
import { ALT_MAX, BLANK, CUSTOM_SIZE } from "./pricing.js";

export const ITEM_TYPES = ["Ring", "Earring", "Pendant", "Necklace", "Bracelet", "Bangle", "Charm", "Anklet", "Brooch", "Chain", "Set"];
export const MODES = ["Price Only", "Breakup", "No Price"];
const today = () => new Date().toISOString().slice(0, 10);
export const newId = () => "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const altId = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const blankRow = (P) => ({ pos: "", type: P.DEF.type || "", shape: P.DEF.shape || "", size: "", dims: "", color: "", clarity: "", spec: "", label: "", ctManual: "", ppcManual: "", pcs: "", setRate: "", setMode: "", setting: "" });
export const freshAlt = () => ({ open: false, comps: [], metals: Array.from({ length: ALT_MAX }, () => ({ m1: "", m2: "" })), editing: null });

export function freshQuote(P) {
  return {
    id: newId(), quoteName: "", mode: "Price Only",
    job: { jobNo: "", itemNo: "", designer: "", date: today(), itemType: "", size: "", renderUrl: "" },
    price: { location: "", cadType: P.DEF.cad || "None", priceList: "", duty: "", currency: "", customer: "", customerRef: "" },
    metal: { m1: "", g1: "", m2: "", g2: "", laborMode: P.DEF.labor || (P.model.labor[0] || {}).caption || "Standard", rateType: "Spot", rateUser: false },
    stones: Array.from({ length: 5 }, () => blankRow(P)),
    addCharges: "", addPct: "", addBasis: "amt", addLabel: "", override: "",
    images: { cad: [], ref: [] }, sel: { cad: 0, ref: 0 },
    imported: null, alt: freshAlt(),
  };
}

/** Repairs a quote from storage, the server or a file, so an old or damaged quote can never break the app. */
export function normalizeQuote(raw, P) {
  const s = freshQuote(P);
  if (!raw || typeof raw !== "object") return s;
  const d = raw.state && raw.state.stones ? raw.state : raw;   // MWL browser-saved records wrap the state
  if (typeof d.id === "string" && /^[\w-]{4,40}$/.test(d.id)) s.id = d.id;
  for (const k of ["quoteName", "addCharges", "addPct", "addLabel", "override"]) if (d[k] != null) s[k] = String(d[k]);
  if (["Price Only", "Breakup", "No Price"].includes(d.mode)) s.mode = d.mode;
  if (d.addBasis === "pct" || d.addBasis === "amt") s.addBasis = d.addBasis;
  for (const part of ["job", "price", "metal"]) {
    const src = d[part] && typeof d[part] === "object" ? d[part] : {};
    for (const k of Object.keys(s[part])) if (src[k] != null) s[part][k] = typeof s[part][k] === "boolean" ? !!src[k] : String(src[k]);
  }
  const rows = Array.isArray(d.stones) ? d.stones : [];
  s.stones = rows.filter((r) => r && typeof r === "object").map((r) => cleanRow(r, P));
  while (s.stones.length < 5) s.stones.push(blankRow(P));
  const imgs = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && /^(data:image\/|https:\/\/|assets\/)/.test(x)) : []);
  s.images = { cad: imgs(d.images && d.images.cad), ref: imgs(d.images && d.images.ref) };
  s.sel = { cad: 0, ref: 0 };
  s.alt = readAlternates(d, P) || freshAlt();
  if (d.alt && typeof d.alt === "object" && Array.isArray(d.alt.comps)) {
    s.alt.comps = d.alt.comps.filter((c) => c && Array.isArray(c.stones)).map((c) => ({ id: str(c.id) || altId(), name: String(c.name || "Option"), stones: c.stones.map((r) => cleanRow(r, P)) }));
    (Array.isArray(d.alt.metals) ? d.alt.metals : []).slice(0, ALT_MAX).forEach((m, k) => { s.alt.metals[k] = { m1: str(m && m.m1), m2: str(m && m.m2) }; });
    s.alt.open = !!(d.alt.open || s.alt.comps.length || s.alt.metals.some((m) => m.m1));
  }
  if (d.imported && typeof d.imported === "object") s.imported = d.imported;
  return s;
}
function cleanRow(r, P) {
  const b = blankRow(P);
  for (const k of Object.keys(b)) if (r[k] != null) b[k] = String(r[k]);
  if (r.labelKey != null) b.labelKey = String(r.labelKey);
  return b;
}

/** Alternates block: from a quote export ("alternates") or an order file ("_ALTERNATES"). */
export function readAlternates(d, P) {
  const a = d.alternates || d._ALTERNATES;
  if (!a || typeof a !== "object") return null;
  const alt = freshAlt();
  const comps = a.variants || a.compositions || a.comps || [];
  alt.comps = (Array.isArray(comps) ? comps : []).map((c) => ({ id: str(c.id) || altId(), name: String(c.name || "Option"), stones: (Array.isArray(c.stones) ? c.stones : []).map((r) => cleanRow(r, P)) }));
  (Array.isArray(a.metals) ? a.metals : []).slice(0, ALT_MAX).forEach((m, k) => { alt.metals[k] = { m1: str(m && m.m1), m2: str(m && m.m2) }; });
  alt.open = !!(alt.comps.length || alt.metals.some((m) => m.m1));
  return alt;
}

/**
 * Keeps state that depends on the sheet valid (location, lists, rate type, rows). Port of MWL conformState.
 * pmOk: whether the sheet's PM rate is usable right now (not missing, not stale).
 */
export function conformQuote(q, P, { pmOk = P.model.pm.ok } = {}) {
  const M = P.model;
  if (q.price.location && !P.locOf(q.price.location)) Object.assign(q.price, { location: "", currency: "", duty: "", priceList: "" });
  if (q.price.location && !M.priceLists.some((p) => p.name === q.price.priceList)) q.price.priceList = P.defaultPricelist(q.price.location);
  // metal codes renamed in the sheet since the quote was saved
  const fixAlloy = (o, k) => { if (o[k] && !P.alloyBy[o[k]]) o[k] = P.findAlloy(o[k]) || o[k]; };
  fixAlloy(q.metal, "m1"); fixAlloy(q.metal, "m2");
  (q.alt.metals || []).forEach((m) => { fixAlloy(m, "m1"); fixAlloy(m, "m2"); });
  if (!M.labor.some((m) => m.caption === q.metal.laborMode) && M.labor.length) {
    // a renamed policy ("Zero" -> "No Labor") is matched by what it charges; otherwise the default applies
    const was = /^(zero|no labou?r|none)$/i.test(q.metal.laborMode) ? M.labor.find((m) => !m.minFlat && !m.gm && m.cast && m.set) : null;
    q.metal.laborMode = (was && was.caption) || P.DEF.labor || M.labor[0].caption;
  }
  if (!P.CAD.some((c) => c[0] === q.price.cadType) && P.CAD.length) q.price.cadType = P.DEF.cad || P.CAD[0][0];
  const lm = P.LM(q.metal.laborMode);
  if (!lm.cad && q.price.cadType !== "None") { q.price.cadPrev = q.price.cadType; q.price.cadType = "None"; }
  if (!pmOk) q.metal.rateType = "Spot";
  else if (!q.metal.rateUser) q.metal.rateType = "Spot";   // Spot is the default; PM can be chosen when available
  q.stones.forEach((r) => P.conformFilled(r, q));
  (q.alt.comps || []).forEach((c) => c.stones.forEach((r) => P.conformFilled(r, q)));
  return q;
}

/** Applying a location: duty, currency and price list come from the Location tab (all stay editable). */
export function applyLocation(q, P, code) {
  q.price.location = code;
  const l = P.locOf(code);
  if (l) {
    q.price.duty = String(+(l.duty * 100).toFixed(2));
    q.price.currency = l.currency;
    q.price.priceList = P.defaultPricelist(l.code);
    q.stones.forEach((r) => P.conformFilled(r, q));
  }
  return q;
}

/** CAD Order Form JSON (or an exported quote) -> a quote. Port of MWL importOrder. -> { quote, notes } */
export function importOrder(d, P) {
  if (Array.isArray(d.stones) && d.metal && d.job) return { quote: normalizeQuote(d, P), notes: [], kind: "quote" };
  const s = freshQuote(P);
  const t = (v) => String(v ?? "").trim();
  s.job.jobNo = t(d.JobNo); s.job.itemNo = t(d.ItemNo); s.job.designer = t(d["CAD Designer"]);
  s.job.size = t(d["Item Size"]); s.job.itemType = t(d.ItemType);
  s.price.customerRef = t(d["Ref no"]);
  s.quoteName = [s.job.jobNo, s.job.itemNo].filter(Boolean).join(" ");
  s.price.cadType = P.CAD.some((c) => c[0] === "Medium") ? "Medium" : P.DEF.cad;
  const alloy = (kt, col) => {
    kt = t(kt).toUpperCase(); col = t(col).toUpperCase();
    if (!kt) return "";
    const found = P.findAlloy((kt + " " + col).trim()) || P.findAlloy(kt);
    if (!found) notes.push(`Metal "${(kt + " " + col).trim()}" is not in the sheet's alloy list — pick it by hand.`);
    return found;
  };
  const notes = [];
  s.metal.m1 = alloy(d["Metal Type 1"], d["Metal Col 1"]); s.metal.g1 = t(d["Metal 1 Weight"]);
  s.metal.m2 = alloy(d["Metal Type 2"], d["Metal Col 2"]); s.metal.g2 = t(d["Metal 2 Weight"]);
  const raw = Array.isArray(d._RAW_STONES) ? d._RAW_STONES : [];
  const mapType = (v) => (/lab|lgd/i.test(v) ? "LGD" : /gem|colou?r/i.test(v) ? "Gems" : /mount/i.test(v) ? "Mount" : "Mined");
  const typeName = (k) => (P.model.types.find((x) => x.name.toLowerCase() === k.toLowerCase()) || { name: k }).name;
  const rows = raw.filter((x) => x && typeof x === "object").map((x) => {
    const shape = P.SHAPES.find((sh) => sh.toLowerCase() === t(x.Shape).toLowerCase() || (P.SHAPE_CODE[sh] || "").toLowerCase() === t(x.Shape).toLowerCase())
      || (x.Shape ? (P.SHAPES.includes("Other") ? "Other" : "") : "");
    const L = num(x.L), W = num(x.W), H = num(x.H);
    let size = "", dims = "";
    if (shape) {
      const list = P.sizesFor(shape);
      const dimsOf = (s2) => (s2.mm.match(/[\d.]+/g) || []).map(parseFloat);
      const m = list.find((s2) => {
        const dd = dimsOf(s2);
        if (/-/.test(s2.mm)) return false;
        return dd.length === 1 ? Math.abs(dd[0] - L) < 0.051 && (!W || Math.abs(W - L) < 0.051) : Math.abs(dd[0] - L) < 0.06 && Math.abs(dd[1] - W) < 0.06;
      });
      if (m && x.SizeIdx !== "custom") size = m.code;
      else { size = CUSTOM_SIZE; dims = [L, W, H].filter(Boolean).map((v) => v.toFixed(2)).join(" × ") + (L ? " mm" : ""); }
    }
    const r = Object.assign(blankRow(P), { pos: t(x.Pos), type: typeName(mapType(t(x.Stone))), shape, size, dims, ctManual: t(x.AvgWt), pcs: t(x.Qty), setting: t(x.Set), setRate: "" });
    P.conformRow(r, s);
    if (size === CUSTOM_SIZE) notes.push(`${r.pos || "Row"} ${shape} (${r.type}) not in the Size tab — check ct/pc`);
    return r;
  });
  while (rows.length < 5) rows.push(blankRow(P));
  s.stones = rows;
  const urls = (a) => (Array.isArray(a) ? a.map((v) => v && v.dataUrl).filter((u) => typeof u === "string" && /^(data:image\/|https:\/\/)/.test(u)) : []);
  s.images.cad = urls(d._VERSIONS);
  s.images.ref = urls(d._CLIENT_REF_IMAGES);
  s.imported = {
    file: d.__file || "order data", count: raw.length, notes,
    summary: [d["Style code"], d._METAL_TYPE_COMBINED && d._METAL_TYPE_COMBINED + " " + (d._METAL_COLOR_COMBINED || ""), d["Metal 1 Weight"] && d["Metal 1 Weight"] + " g"].filter(Boolean).join(" · "),
    clientNotes: t(d["Client Notes"]),
  };
  s.alt = readAlternates(d, P) || freshAlt();
  return { quote: s, notes, kind: "order" };
}

/** The export used for GATI (same fields as MWL's export). */
export function exportQuote(q, P, live) {
  const t = P.totals(q, live);
  const bg = P.baseGrams(q);
  const rows = P.altRows(q);
  const alternates = rows.length ? {
    variants: q.alt.comps.map((c) => ({ id: c.id, name: c.name, stones: c.stones })),
    metals: q.alt.metals,
    prices: rows.map((c) => {
      const sv = P.stoneSums(c.stones, q);
      const cols = [["As entered", bg]].concat(P.activeVariants(q).map((v) => ["Metal " + "ABC"[v.k], P.altGrams(q, v)]));
      return { variant: c.name, diamonds: sv.dia, setting: sv.set, variants: cols.map(([label, g]) => { const r = P.altCell(q, sv, g, t, live); return { label, metal1: g && g.m1, grams1: g && g.g1, metal2: g && g.m2, grams2: g && g.g2, casting: r && r.casting, labor: r && r.labor, usd: r && r.withDuty, local: r && r.local, currency: q.price.currency }; }) };
    }),
  } : undefined;
  return {
    quoteName: q.quoteName, mode: q.mode, job: q.job, price: q.price, metal: q.metal, addCharges: q.addCharges, addPct: q.addPct, addBasis: q.addBasis, addLabel: q.addLabel, override: q.override,
    stones: q.stones.filter((r) => !P.rowEmpty(r)).map((r) => { const c = P.calcRow(r, q); return { ...r, ctpc: c.ctpc, ppc: c.ppc, cttw: c.cttw, total: c.total, setTot: c.setTot }; }),
    totals: t, alternates, exportedAt: new Date().toISOString(),
  };
}

/** A one-line summary for lists and search. */
export function quoteSummary(q, P, live) {
  const t = P.totals(q, live);
  return {
    id: q.id, name: q.quoteName || [q.job.jobNo, q.job.itemNo].filter(Boolean).join(" ") || "Untitled quote",
    jobNo: q.job.jobNo, itemNo: q.job.itemNo, customer: q.price.customer, customerRef: q.price.customerRef, location: q.price.location,
    currency: q.price.currency, total: t.final || 0,
  };
}
export { BLANK };
