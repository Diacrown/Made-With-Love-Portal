// Imports for the CAD sheet: a stone matrix CSV ("Import Matrix Gem Map") and the CAD Order Form JSON export.
import { parseCSV } from '../pricing/util.js';

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES = {
  position: ['pos', 'position', 'loc', 'location'],
  stone_type: ['type', 'stone', 'stonetype'],
  is_blank: ['blank', 'isblank', 'empty'],
  shape: ['shape'],
  size: ['size', 'mm', 'sizemm', 'dims', 'l'],
  width: ['w', 'width'],
  ct_pc: ['ctpc', 'ctperpc', 'avgwt', 'weight', 'ct', 'wtpc'],
  pcs: ['pcs', 'qty', 'quantity', 'count'],
  role: ['role'],
  setting_style: ['style', 'setting', 'set', 'settingstyle'],
};

export function stoneType(v) {
  const s = String(v || '').toLowerCase();
  if (/lab|lgd/.test(s)) return 'LGD';
  if (/gem|colou?r|sapph|ruby|emerald/.test(s)) return 'GEM';
  return 'DIA';
}
const yes = (v) => /^(y|yes|true|1)$/i.test(String(v || '').trim());
const numOrNull = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

/** CSV text -> { rows, notes }. Header row required; column names are matched loosely. */
export function stonesFromCsv(text) {
  const table = parseCSV(text);
  if (table.length < 2) return { rows: [], notes: ['The file has no data rows.'] };
  const head = table[0].map(norm);
  const col = {};
  Object.entries(ALIASES).forEach(([k, names]) => { const i = head.findIndex((h) => names.includes(h)); if (i >= 0) col[k] = i; });
  const notes = [];
  if (col.shape === undefined && col.size === undefined) notes.push('No Shape or Size column found - check the header row.');
  const unknown = table[0].filter((h, i) => !Object.values(col).includes(i) && String(h).trim());
  if (unknown.length) notes.push(`Ignored columns: ${unknown.join(', ')}`);
  const get = (r, k) => (col[k] === undefined ? '' : String(r[col[k]] ?? '').trim());
  const rows = table.slice(1).map((r) => {
    const size = get(r, 'size'), w = get(r, 'width');
    return {
      position: get(r, 'position'), stone_type: stoneType(get(r, 'stone_type')), is_blank: yes(get(r, 'is_blank')),
      shape: get(r, 'shape').toUpperCase(), size: w && size && !/x/i.test(size) ? `${size}x${w}` : size,
      ct_pc: numOrNull(get(r, 'ct_pc')), pcs: numOrNull(get(r, 'pcs')) == null ? null : Math.round(numOrNull(get(r, 'pcs'))),
      role: get(r, 'role'), setting_style: get(r, 'setting_style'),
    };
  }).filter((r) => r.shape || r.size || r.pcs);
  return { rows: rows.slice(0, 500), notes: rows.length > 500 ? [...notes, 'Only the first 500 rows were imported.'] : notes };
}

/** CAD Order Form JSON (or a CAD sheet exported from here) -> { fields, metals, stones, images: [dataUrl], notes } */
export function fromCadJson(d) {
  if (d && d.version && Array.isArray(d.stones) && Array.isArray(d.metals)) {
    // our own cad-sheet.json export
    return { fields: d.version, metals: d.metals, stones: d.stones, images: [], notes: [] };
  }
  const t = (v) => String(v ?? '').trim();
  const metals = [1, 2, 3].map((i) => ({
    metal: [t(d[`Metal Type ${i}`]), t(d[`Metal Col ${i}`])].filter(Boolean).join(' '),
    grams: numOrNull(d[`Metal ${i} Weight`]), rhodium: '', finish: '', note: '',
  })).filter((m) => m.metal);
  const raw = Array.isArray(d._RAW_STONES) ? d._RAW_STONES : [];
  const stones = raw.filter((x) => x && typeof x === 'object').map((x) => {
    const L = numOrNull(x.L), W = numOrNull(x.W);
    return {
      position: t(x.Pos), stone_type: stoneType(x.Stone), is_blank: false, shape: t(x.Shape).toUpperCase(),
      size: L ? (W && W !== L ? `${L}x${W}` : String(L)) : '', ct_pc: numOrNull(x.AvgWt), pcs: numOrNull(x.Qty) == null ? null : Math.round(numOrNull(x.Qty)),
      role: '', setting_style: t(x.Set),
    };
  });
  const images = (Array.isArray(d._VERSIONS) ? d._VERSIONS : []).map((v) => v && v.dataUrl).filter((u) => typeof u === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(u));
  const notes = [];
  if (!metals.length && !stones.length) notes.push('No metals or stones found in this file. Is it a CAD Order Form export?');
  return {
    fields: { designer_name: t(d['CAD Designer']), client_instructions: t(d['Client Notes']) },
    metals, stones, images, notes,
  };
}

export function dataUrlToFile(url, name) {
  const [head, b64] = url.split(',');
  const mime = /data:([^;]+)/.exec(head)[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows, cols) => [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
