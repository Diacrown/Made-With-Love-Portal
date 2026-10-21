// Start a quote from a job and its accepted CAD version (metal weights + stone matrix), in MWL quote shape.
import { freshQuote, applyLocation, blankRow, conformQuote } from '../pricing/quote.js';
import { CUSTOM_SIZE } from '../pricing/pricing.js';

const TYPE_FROM_CAD = { DIA: 'Mined', LGD: 'LGD', GEM: 'Gems' };
// shape codes used before the forms switched to the price sheet's codes
const LEGACY_SHAPE = { EMR: 'EME', CUS: 'SCU', PEAR: 'PSH', ASC: 'SEM', TRL: 'TRN' };

function shapeName(P, code) {
  const c = String(code || '').toUpperCase();
  const want = LEGACY_SHAPE[c] || c;
  return P.SHAPES.find((n) => (P.SHAPE_CODE[n] || '').toUpperCase() === want || n.toUpperCase() === want) || (c ? (P.SHAPES.includes('Other') ? 'Other' : '') : '');
}

/**
 * "1.3" / "8x6" / "8.10*5.65" -> matching Size code for the shape (same mm tolerance as MWL importOrder).
 * Larger fancy shapes are listed by weight ("1.50 ct ±"); those match on the CAD's ct/pc instead.
 * No match -> a custom size priced from ct/pc.
 */
function sizeFor(P, shape, text, ctpc) {
  const d = (String(text || '').match(/[\d.]+/g) || []).map(parseFloat).filter(Number.isFinite);
  if (!shape) return { size: '', dims: '' };
  const byWeight = Number(ctpc) > 0 && P.sizesFor(shape).find((s) => /ct/i.test(s.mm) && Math.abs(s.ct - Number(ctpc)) < 0.005);
  if (!d.length) return byWeight ? { size: byWeight.code, dims: '' } : { size: '', dims: '' };
  const [L, W] = d;
  const m = P.sizesFor(shape).find((s) => {
    const dd = (s.mm.match(/[\d.]+/g) || []).map(parseFloat);
    if (/-/.test(s.mm)) return false;
    return dd.length === 1 ? Math.abs(dd[0] - L) < 0.051 && (!W || Math.abs(W - L) < 0.051) : W != null && Math.abs(dd[0] - L) < 0.06 && Math.abs(dd[1] - W) < 0.06;
  });
  if (m) return { size: m.code, dims: '' };
  if (byWeight) return { size: byWeight.code, dims: d.map((v) => v.toFixed(2)).join(' × ') + ' mm' };
  return { size: CUSTOM_SIZE, dims: d.map((v) => v.toFixed(2)).join(' × ') + ' mm' };
}

export function quoteFromJob(P, { job, customerAlias, locationCode, version, metals = [], stones = [] }) {
  const S = freshQuote(P);
  const notes = [];
  S.quoteName = [job.job_no, job.title].filter(Boolean).join(' ');
  S.job.jobNo = job.job_no || '';
  S.job.itemType = job.item_type || '';
  S.job.size = [job.size_system, job.size_label].filter(Boolean).join(' ');
  S.job.designer = version?.designer_name || '';
  S.job.renderUrl = version?.render_url || '';
  S.price.customer = customerAlias || '';
  S.price.customerRef = job.customer_ref_no || '';
  if (version && P.CAD.some((c) => c[0] === 'Medium')) S.price.cadType = 'Medium';
  if (locationCode && P.locOf(locationCode)) applyLocation(S, P, locationCode);
  else if (locationCode) notes.push(`Location ${locationCode} is not in the price data - pick one.`);

  const ms = metals.filter((m) => m.metal);
  [['m1', 'g1'], ['m2', 'g2']].forEach(([mk, gk], i) => {
    const m = ms[i];
    if (!m) return;
    const code = P.findAlloy(m.metal);
    if (!code) notes.push(`Metal "${m.metal}" is not in the price data's alloy list - pick it by hand.`);
    S.metal[mk] = code || '';
    S.metal[gk] = m.grams != null ? String(m.grams) : '';
  });
  if (ms.length > 2) notes.push('Only the first two metal lines are priced (the calculator has Metal 1 and Metal 2).');

  const rows = stones.filter((s) => !s.is_blank).map((s) => {
    const type = TYPE_FROM_CAD[s.stone_type] || P.DEF.type;
    const shape = shapeName(P, s.shape);
    const { size, dims } = sizeFor(P, shape, s.size, s.ct_pc);
    const r = Object.assign(blankRow(P), {
      pos: s.position || '', type, shape, size, dims, pcs: s.pcs != null ? String(s.pcs) : '',
      ctManual: size === CUSTOM_SIZE && s.ct_pc != null ? String(s.ct_pc) : '', setting: s.setting_style || '',
    });
    if (size === CUSTOM_SIZE) notes.push(`${s.position || 'Row'} ${shape || s.shape} ${s.size}: not in the Size tab - priced from ct/pc ${s.ct_pc ?? '?'}.`);
    P.conformRow(r, S);
    return r;
  });
  if (rows.length) { while (rows.length < 5) rows.push(blankRow(P)); S.stones = rows; }
  conformQuote(S, P);
  return { quote: S, notes };
}
