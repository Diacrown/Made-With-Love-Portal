// Small pure helpers shared by the browser and the Netlify functions.
// Number parsing follows the MWL sheet conventions: "5%" means 0.05, "$1,200" means 1200.

/**
 * Number from a sheet cell or a typed value; NaN when it is not clearly a number. "5%" -> 0.05, "$1,200" -> 1200.
 * Strict on purpose: a typo such as "12O" (letter O) or "1.2.5" is NaN, so the sheet check refuses it instead of
 * quietly reading 12. A unit shown by the sheet's number format ("0.049 ct", "5 g") is fine.
 */
const NUM_RE = /^[-+]?[$€£₹]?\s*[-+]?(\d{1,3}(,\d{2,3})+|\d+)?(\.\d+)?\s*(%|\/?\s*(cts?|pcs?|pc|g|gms?|grams?|mm|oz))?$/i;   // sheet number formats may show a unit
export function nnum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const s = String(v ?? "").trim();
  if (!s || !NUM_RE.test(s) || !/\d/.test(s)) return NaN;
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n)) return NaN;
  return s.endsWith("%") ? n / 100 : n;
}
/** Like nnum, but 0 instead of NaN. */
export const nz = (v) => { const n = nnum(v); return Number.isFinite(n) ? n : 0; };
/** A fraction: 0.05, "5%" and 5 all mean 5% (values above 1 are read as percentages). */
export const frac = (v) => { const s = String(v ?? ""); const n = nz(v); return s.trim().endsWith("%") ? n : n > 1 ? n / 100 : n; };
export const str = (v) => String(v ?? "").trim();
/** "WS,DM" -> ["WS","DM"]; "" -> [""] (a blank cell is a real value: it matches a blank choice). */
export const csvList = (v) => str(v).split(",").map((x) => x.trim());
export const yes = (v) => /^y/i.test(str(v));
/** Stone types: "Gems" (Master) and "Gem" (StonePrice) are the same type. */
export const typeKey = (t) => str(t).toLowerCase().replace(/s$/, "");
export const isGem = (t) => typeKey(t) === "gem";
/** User input to a number: commas allowed, anything else is 0. */
export const num = (v) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
/** Nearest multiple of 5 (MWL rounds final USD and local totals this way). */
export const round5 = (n) => (Number.isFinite(n) ? Math.round(n / 5 + 1e-9) * 5 + 0 : 0);
export const round2 = (n) => Math.round(n * 100) / 100;
export const round4 = (n) => Math.round(n * 1e4) / 1e4;
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const SYM = { USD: "$", GBP: "£", EUR: "€", AUD: "A$", NZD: "NZ$", PLN: "zł ", INR: "₹" };
export const usd = (n, d = 0) => "$" + (Number.isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const money = (cur, n) => (SYM[cur] ?? cur + " ") + Math.round(Number.isFinite(n) ? n : 0).toLocaleString("en-US");

/** The coded price printed on quotes: 1234567890 -> JADELIGHTX. */
export const PRICE_CODE = { 1: "J", 2: "A", 3: "D", 4: "E", 5: "L", 6: "I", 7: "G", 8: "H", 9: "T", 0: "X" };
export const priceCode = (n) => (n ? String(Math.round(n)).replace(/\d/g, (d) => PRICE_CODE[d]) : "");

/** Sheet date text ("Fri 16 Oct 2026 PM", "16 Oct 2026") -> epoch ms, or null. */
export function parsePmDate(t) {
  const s = str(t).replace(/\b(AM|PM)\b/gi, "").replace(/^[A-Za-z]{3},?\s+/, "").trim();
  if (!s) return null;
  const d = Date.parse(s) || Date.parse(s.replace(/(\d+)\s+(\w+)\s+(\d{4})/, "$2 $1, $3"));
  return Number.isFinite(d) && d > 0 ? d : null;
}

/** RFC 4180 CSV parser (handles quotes, commas and newlines inside quotes). Drops fully blank rows. */
export function parseCSV(t) {
  const rows = [];
  let row = [], f = "", q = false;
  const s = String(t ?? "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((v) => str(v) !== ""));
}

/** [[header...], [row...]] -> [{header: value, _row: sheetRowNumber}] */
export function objs(tab) {
  const [h = [], ...rows] = tab || [];
  const keys = h.map(str);
  return rows.map((r, i) => {
    const o = Object.fromEntries(keys.map((k, j) => [k, r[j] ?? ""]));
    Object.defineProperty(o, "_row", { value: i + 2, enumerable: false });
    return o;
  });
}

/** Stable short hash (FNV-1a, 52-bit) for data versions; not for security. */
export function hash(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0").slice(0, 6);
}
