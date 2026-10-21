// The job card from the MWL mocks. variant "simple" = NewJobSimple, "advanced" = NewJobAdvance.
// Used for new jobs and for editing a job's specification.
import { useMemo, useState } from 'react';
import {
  REQUEST_TYPES, PROJECT_TYPES, SUB_TYPES, REF_TYPES, ITEM_TYPES, ITEM_SUB_TYPES, SIZE_SYSTEMS, QUICK_OPTIONS,
  METALS, METAL_COLORS, RHODIUM, FINISHES, METAL_TONES, STONE_TYPES, SHAPES, SETTINGS, SOURCES, ENGRAVE_METHODS,
} from '../lib/options';
import { Field } from './ui';

const blankMetal = () => ({ metal: '', color: '', rhodium: '', finish: '', notes: '' });
const blankStone = () => ({ position: '', in_mounting: null, stone_type: 'DIA', shape: 'RND', size: '', color: '', clarity: '', spec: '', ct_pc: '', pcs: '', setting: '', source: '', notes: '' });

const JOB_FIELDS = ['title', 'description', 'job_type', 'item_type', 'item_sub_type', 'style_no', 'size_label', 'size_system',
  'customer_ref_no', 'order_ref_no', 'request_type', 'sub_type', 'ref_type', 'ref_no', 'due_date', 'in_store_by', 'is_rush',
  'quantity', 'budget', 'budget_currency', 'customer_request', 'product_specs', 'design_brief', 'must_keep', 'avoid',
  'quick_options', 'metal_tone', 'target_metal_weight', 'stamping', 'stamping_location', 'engrave_text', 'engrave_location',
  'engrave_font', 'engrave_method'];

function initialJob(job) {
  const j = { job_type: 'custom', request_type: 'cad', is_rush: false, quantity: 1, quick_options: [] };
  JOB_FIELDS.forEach((k) => { if (job && job[k] != null) j[k] = job[k]; });
  return j;
}
const toStr = (v) => (v == null ? '' : String(v));

function Sel({ value, onChange, pairs, list, blank = '—', ...rest }) {
  const opts = pairs || (list || []).map((x) => [x, x]);
  return (
    <select value={toStr(value)} onChange={(e) => onChange(e.target.value || null)} {...rest}>
      <option value="">{blank}</option>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

/**
 * props: variant, job (existing values or null), metals, stones, customers (new only), officeById,
 *        canPickCustomer, busy, submitLabel, onSubmit({ job, metals, stones, files }), onCancel, allowFiles
 */
export default function JobForm(props) {
  const { variant, officeById, customers = [], busy, submitLabel = 'Save', onCancel, allowFiles = true } = props;
  const adv = variant === 'advanced';
  const isNew = !props.job;
  const [f, setF] = useState(() => initialJob(props.job));
  const [customerId, setCustomerId] = useState('');
  const [metals, setMetals] = useState(() => (props.metals?.length ? props.metals.map((m) => ({ ...blankMetal(), ...m })) : [blankMetal()]));
  const [stones, setStones] = useState(() => (props.stones?.length ? props.stones.map((s) => ({ ...blankStone(), ...s })) : [blankStone()]));
  const [files, setFiles] = useState([]);
  const [touched, setTouched] = useState(false);

  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const setE = (k) => (e) => set(k)(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
  const customer = customers.find((c) => String(c.id) === customerId);
  const office = isNew ? (customer && officeById[customer.office_id]) : officeById[props.job.front_office_id];

  const errors = useMemo(() => {
    const e = {};
    if (isNew && !customer) e.customer = 'Choose a customer';
    if (!toStr(f.title).trim()) e.title = 'Enter a project title';
    if (f.job_type !== 'custom' && !toStr(f.ref_no).trim()) e.ref_no = 'Edit and Existing jobs need a reference (style, SKU or job #)';
    if (!(Number(f.quantity) >= 1)) e.quantity = 'At least 1';
    if (f.budget !== '' && f.budget != null && !(Number(f.budget) >= 0)) e.budget = 'Not a valid amount';
    if (f.due_date && f.in_store_by && f.in_store_by < f.due_date) e.in_store_by = 'In-store date is before the due date';
    stones.forEach((s, i) => {
      if (s.ct_pc !== '' && !(Number(s.ct_pc) >= 0)) e[`stone${i}`] = `Stone row ${i + 1}: ct/pc is not a number`;
      if (s.pcs !== '' && !Number.isInteger(Number(s.pcs))) e[`stone${i}`] = `Stone row ${i + 1}: pieces must be a whole number`;
    });
    return e;
  }, [f, stones, customer, isNew]);
  const valid = Object.keys(errors).length === 0;

  function submit(e) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    const job = {};
    JOB_FIELDS.forEach((k) => {
      let v = f[k];
      if (typeof v === 'string') v = v.trim();
      job[k] = v === '' ? null : v;
    });
    job.quantity = Number(f.quantity) || 1;
    job.budget = f.budget === '' || f.budget == null ? null : Number(f.budget);
    job.target_metal_weight = f.target_metal_weight === '' || f.target_metal_weight == null ? null : Number(f.target_metal_weight);
    job.budget_currency = job.budget != null ? (f.budget_currency || office?.currency_code || null) : null;
    if (job.ref_type === 'style') job.style_no = job.ref_no;
    job.form_variant = variant;
    if (isNew) { job.customer_id = customer.id; job.front_office_id = customer.office_id; }
    const cleanStones = stones.filter((s) => s.stone_type && (s.shape || s.size || s.pcs || s.ct_pc)).map((s) => ({
      ...s, ct_pc: s.ct_pc === '' ? null : Number(s.ct_pc), pcs: s.pcs === '' ? null : parseInt(s.pcs, 10),
      in_mounting: s.in_mounting === '' ? null : s.in_mounting, source: s.source || null,
    }));
    const cleanMetals = metals.filter((m) => toStr(m.metal).trim());
    props.onSubmit({ job, metals: cleanMetals, stones: cleanStones, files });
  }

  const updRow = (setter, i, k) => (v) => setter((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const subTypes = ITEM_SUB_TYPES[f.item_type] || [];
  const err = (k) => touched && errors[k] && <small className="field-err">{errors[k]}</small>;

  return (
    <form className="jobform" onSubmit={submit} noValidate>
      <section className="form-sec">
        <h3>Order</h3>
        <div className="form-grid">
          {isNew ? (
            <Field label="Customer (alias)">
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-invalid={touched && !!errors.customer}>
                <option value="">Choose…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.alias} · {officeById[c.office_id]?.name}</option>)}
              </select>
              {err('customer')}
            </Field>
          ) : null}
          <Field label="Location"><input value={office ? `${office.name} (${office.code})` : '—'} readOnly tabIndex={-1} /></Field>
          <Field label="Stage requested"><Sel value={f.request_type} onChange={set('request_type')} pairs={REQUEST_TYPES} /></Field>
          <Field label="Due date"><input type="date" value={toStr(f.due_date)} onChange={setE('due_date')} /></Field>
          {adv && <Field label="In store by"><input type="date" value={toStr(f.in_store_by)} onChange={setE('in_store_by')} />{err('in_store_by')}</Field>}
          <Field label="Customer ref #"><input value={toStr(f.customer_ref_no)} onChange={setE('customer_ref_no')} maxLength={60} /></Field>
          <label className="check rush"><input type="checkbox" checked={!!f.is_rush} onChange={setE('is_rush')} /> Rush job</label>
        </div>
      </section>

      <section className="form-sec">
        <h3>Product</h3>
        <div className="form-grid">
          <Field label="Project type"><Sel value={f.job_type} onChange={(v) => set('job_type')(v || 'custom')} pairs={PROJECT_TYPES} blank="Choose…" /></Field>
          <Field label="Sub type"><Sel value={f.sub_type} onChange={set('sub_type')} pairs={SUB_TYPES} /></Field>
          <Field label="Reference type"><Sel value={f.ref_type} onChange={set('ref_type')} pairs={REF_TYPES} /></Field>
          <Field label="Reference #"><input value={toStr(f.ref_no)} onChange={setE('ref_no')} maxLength={60} placeholder="Style# / SKU# / Job#" aria-invalid={touched && !!errors.ref_no} />{err('ref_no')}</Field>
          <Field label="Item type"><Sel value={f.item_type} onChange={set('item_type')} list={ITEM_TYPES} /></Field>
          <Field label="Item sub type">
            <input list="subtypes" value={toStr(f.item_sub_type)} onChange={setE('item_sub_type')} maxLength={60} />
            <datalist id="subtypes">{subTypes.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field label="Size type"><Sel value={f.size_system} onChange={set('size_system')} list={SIZE_SYSTEMS} /></Field>
          <Field label="Size"><input value={toStr(f.size_label)} onChange={setE('size_label')} maxLength={20} /></Field>
          {adv && <Field label="Quantity"><input type="number" min={1} step={1} value={toStr(f.quantity)} onChange={setE('quantity')} />{err('quantity')}</Field>}
          {adv && <Field label={`Budget${office ? ` (${office.currency_code})` : ''}`}><input type="number" min={0} step="0.01" value={toStr(f.budget)} onChange={setE('budget')} />{err('budget')}</Field>}
        </div>
        <Field label="Project title"><input value={toStr(f.title)} onChange={setE('title')} maxLength={200} aria-invalid={touched && !!errors.title} placeholder="e.g. Three stone oval ring, 18KT YG" />{err('title')}</Field>
        <Field label="Description"><textarea rows={3} value={toStr(f.description)} onChange={setE('description')} maxLength={4000} /></Field>
        <div className="chips" role="group" aria-label="Quick options">
          {QUICK_OPTIONS.map((o) => {
            const on = (f.quick_options || []).includes(o);
            return <button type="button" key={o} className={`chip ${on ? 'on' : ''}`} aria-pressed={on}
              onClick={() => set('quick_options')(on ? f.quick_options.filter((x) => x !== o) : [...(f.quick_options || []), o])}>{o}</button>;
          })}
        </div>
      </section>

      {adv && (
        <section className="form-sec">
          <h3>Brief</h3>
          <div className="form-grid wide">
            <Field label="Customer request"><textarea rows={3} value={toStr(f.customer_request)} onChange={setE('customer_request')} maxLength={4000} /></Field>
            <Field label="Product specifications"><textarea rows={3} value={toStr(f.product_specs)} onChange={setE('product_specs')} maxLength={4000} /></Field>
            <Field label="Design brief"><textarea rows={3} value={toStr(f.design_brief)} onChange={setE('design_brief')} maxLength={4000} /></Field>
            <Field label="Must keep"><textarea rows={2} value={toStr(f.must_keep)} onChange={setE('must_keep')} maxLength={2000} /></Field>
            <Field label="Avoid"><textarea rows={2} value={toStr(f.avoid)} onChange={setE('avoid')} maxLength={2000} /></Field>
          </div>
        </section>
      )}

      <section className="form-sec">
        <h3>Metal details</h3>
        {adv && (
          <div className="form-grid">
            <Field label="Metal tone"><Sel value={f.metal_tone} onChange={set('metal_tone')} pairs={METAL_TONES} /></Field>
            <Field label="Target metal weight (g)"><input type="number" min={0} step="0.001" value={toStr(f.target_metal_weight)} onChange={setE('target_metal_weight')} /></Field>
          </div>
        )}
        <div className="table-wrap">
          <table className="table lines">
            <thead><tr><th>#</th><th>Metal</th><th>Colour</th>{adv && <><th>Rhodium</th><th>Finish</th></>}<th>Notes</th><th /></tr></thead>
            <tbody>
              {metals.map((m, i) => (
                <tr key={i}>
                  <td className="muted">{i + 1}</td>
                  <td><input list="metals" value={m.metal} onChange={(e) => updRow(setMetals, i, 'metal')(e.target.value)} maxLength={40} aria-label={`Metal ${i + 1}`} /></td>
                  <td><Sel value={m.color} onChange={updRow(setMetals, i, 'color')} list={METAL_COLORS} aria-label={`Colour ${i + 1}`} /></td>
                  {adv && <>
                    <td><Sel value={m.rhodium} onChange={updRow(setMetals, i, 'rhodium')} list={RHODIUM} aria-label={`Rhodium ${i + 1}`} /></td>
                    <td><Sel value={m.finish} onChange={updRow(setMetals, i, 'finish')} list={FINISHES} aria-label={`Finish ${i + 1}`} /></td>
                  </>}
                  <td><input value={m.notes || ''} onChange={(e) => updRow(setMetals, i, 'notes')(e.target.value)} maxLength={500} aria-label={`Metal notes ${i + 1}`} /></td>
                  <td><button type="button" className="x" aria-label="Remove metal line" onClick={() => setMetals((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : [blankMetal()]))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <datalist id="metals">{(props.metalOptions || METALS).map((m) => <option key={m} value={m} />)}</datalist>
        {metals.length < 3 && <button type="button" className="link-btn" onClick={() => setMetals((r) => [...r, blankMetal()])}>+ Add metal line</button>}
      </section>

      <section className="form-sec">
        <h3>Stone details</h3>
        <div className="table-wrap">
          <table className="table lines">
            <thead><tr>
              <th>#</th>{adv && <><th>Loc</th><th>Mntg</th></>}<th>Type</th><th>Shape</th><th>Size</th>
              {adv ? <><th>Col</th><th>Cla</th><th>Spec</th><th>ct/pc</th></> : <th>Quality</th>}
              <th>Pcs</th>{!adv && <th>CTW</th>}{adv && <th>Setting</th>}<th>Notes</th>{adv && <th>Source</th>}<th />
            </tr></thead>
            <tbody>
              {stones.map((s, i) => {
                const u = (k) => updRow(setStones, i, k);
                const ctw = s.ct_pc !== '' && s.pcs !== '' && s.ct_pc != null && s.pcs != null ? +(Number(s.ct_pc) * Number(s.pcs)).toFixed(3) : '';
                return (
                  <tr key={i}>
                    <td className="muted">{i + 1}</td>
                    {adv && <>
                      <td><input value={s.position || ''} onChange={(e) => u('position')(e.target.value)} maxLength={30} className="w-s" aria-label={`Location ${i + 1}`} placeholder="Center" /></td>
                      <td><select value={s.in_mounting == null ? '' : s.in_mounting ? 'Y' : 'N'} onChange={(e) => u('in_mounting')(e.target.value === '' ? null : e.target.value === 'Y')} aria-label={`Mounting ${i + 1}`}><option value="">—</option><option value="Y">Y</option><option value="N">N</option></select></td>
                    </>}
                    <td><select value={s.stone_type} onChange={(e) => u('stone_type')(e.target.value)} aria-label={`Stone type ${i + 1}`}>{STONE_TYPES.map(([v]) => <option key={v} value={v}>{v}</option>)}</select></td>
                    <td><Sel value={s.shape} onChange={u('shape')} list={SHAPES} aria-label={`Shape ${i + 1}`} /></td>
                    <td><input value={s.size || ''} onChange={(e) => u('size')(e.target.value)} maxLength={30} className="w-s" placeholder="mm" aria-label={`Size ${i + 1}`} /></td>
                    {adv ? <>
                      <td><input value={s.color || ''} onChange={(e) => u('color')(e.target.value)} maxLength={30} className="w-xs" aria-label={`Colour ${i + 1}`} /></td>
                      <td><input value={s.clarity || ''} onChange={(e) => u('clarity')(e.target.value)} maxLength={30} className="w-xs" aria-label={`Clarity ${i + 1}`} /></td>
                      <td><input value={s.spec || ''} onChange={(e) => u('spec')(e.target.value)} maxLength={30} className="w-xs" aria-label={`Spec ${i + 1}`} /></td>
                      <td><input type="number" min={0} step="0.001" value={toStr(s.ct_pc)} onChange={(e) => u('ct_pc')(e.target.value)} className="w-s" aria-label={`ct per piece ${i + 1}`} /></td>
                    </> : (
                      <td><input value={[s.color, s.clarity].filter(Boolean).join('/')} placeholder="G/VS" className="w-s" aria-label={`Quality ${i + 1}`}
                        onChange={(e) => { const [c = '', cl = ''] = e.target.value.split('/'); setStones((rows) => rows.map((r, j) => (j === i ? { ...r, color: c.trim(), clarity: cl.trim() } : r))); }} /></td>
                    )}
                    <td><input type="number" min={0} step={1} value={toStr(s.pcs)} onChange={(e) => u('pcs')(e.target.value)} className="w-xs" aria-label={`Pieces ${i + 1}`} /></td>
                    {!adv && <td><input type="number" min={0} step="0.001" value={toStr(ctw)} className="w-s" aria-label={`Total carat ${i + 1}`}
                      onChange={(e) => { const p = Number(s.pcs) || 1; u('ct_pc')(e.target.value === '' ? '' : String(+(Number(e.target.value) / p).toFixed(4))); }} /></td>}
                    {adv && <td><Sel value={s.setting} onChange={u('setting')} list={SETTINGS} aria-label={`Setting ${i + 1}`} /></td>}
                    <td><input value={s.notes || ''} onChange={(e) => u('notes')(e.target.value)} maxLength={500} aria-label={`Stone notes ${i + 1}`} /></td>
                    {adv && <td><Sel value={s.source} onChange={u('source')} pairs={SOURCES} aria-label={`Source ${i + 1}`} /></td>}
                    <td><button type="button" className="x" aria-label="Remove stone line" onClick={() => setStones((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : [blankStone()]))}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {Object.keys(errors).filter((k) => k.startsWith('stone')).map((k) => touched && <small key={k} className="field-err">{errors[k]}</small>)}
        <button type="button" className="link-btn" onClick={() => setStones((r) => [...r, blankStone()])}>+ Add stone row</button>
      </section>

      {adv && (
        <section className="form-sec">
          <h3>Stamping & engraving</h3>
          <div className="form-grid">
            <Field label="Stamping"><input value={toStr(f.stamping)} onChange={setE('stamping')} maxLength={200} placeholder="e.g. Diamantra logo + 750" /></Field>
            <Field label="Stamping location"><input value={toStr(f.stamping_location)} onChange={setE('stamping_location')} maxLength={100} placeholder="e.g. 4 + 8 o'clock" /></Field>
            <Field label="Engrave text"><input value={toStr(f.engrave_text)} onChange={setE('engrave_text')} maxLength={200} /></Field>
            <Field label="Engrave location"><input value={toStr(f.engrave_location)} onChange={setE('engrave_location')} maxLength={100} /></Field>
            <Field label="Font"><input value={toStr(f.engrave_font)} onChange={setE('engrave_font')} maxLength={60} /></Field>
            <Field label="Method"><Sel value={f.engrave_method} onChange={set('engrave_method')} pairs={ENGRAVE_METHODS} /></Field>
          </div>
        </section>
      )}

      {allowFiles && (
        <section className="form-sec">
          <h3>Reference images & files</h3>
          <input type="file" multiple accept="image/*,application/pdf,video/mp4" onChange={(e) => setFiles([...e.target.files])} aria-label="Reference files" />
          {files.length > 0 && <p className="muted small">{files.length} file(s) will be uploaded after the job is saved.</p>}
        </section>
      )}

      {touched && !valid && <div className="note bad" role="alert">Fix the highlighted fields: {Object.values(errors).join(' · ')}</div>}
      <div className="form-actions">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  );
}
