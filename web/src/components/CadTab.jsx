// CAD tab on a job (MWL "CadImage" mock): numbered versions with metal weights, stone matrix and images.
import { useEffect, useMemo, useState } from 'react';
import { supabase, q } from '../lib/supabase';
import { useLoad, fmtDate } from '../lib/hooks';
import { useRefData } from '../lib/refdata';
import { useAuth } from '../auth/AuthProvider';
import { METALS, RHODIUM, FINISHES, SHAPES, SETTINGS, STONE_TYPES } from '../lib/options';
import { stonesFromCsv, fromCadJson, dataUrlToFile, toCsv } from '../lib/cadImport';
import { uploadJobFile, downloadFile } from '../lib/files';
import { mapError } from '../lib/errors';
import { JobFiles } from './JobSpec';
import { Card, Empty, ErrorNote, Field, Loading, Modal, Pill, useAction, useToast } from './ui';

const TONE = { draft: 'muted', submitted: 'info', accepted: 'good', revision: 'warn', superseded: 'muted' };
const blankMetal = () => ({ metal: '', grams: '', rhodium: '', finish: '', note: '' });
const blankStone = () => ({ position: '', stone_type: 'DIA', is_blank: false, shape: 'RND', size: '', ct_pc: '', pcs: '', role: '', setting_style: '' });
const n = (v) => (v === '' || v == null ? null : Number(v));

export default function CadTab({ job, onChanged }) {
  const ref = useRefData();
  const { can, profile } = useAuth();
  const [run, busy] = useAction();
  const [sel, setSel] = useState(null);
  const stageCode = ref.stageById[job.stage_id]?.code;
  const backCan = (p) => can(p, job.back_office_id);
  const stageOk = stageCode === 'intake' || stageCode === 'cad_design';

  const { loading, error, data, reload } = useLoad(() =>
    q(supabase.from('cad_versions').select('*').eq('job_id', job.id).order('version_no', { ascending: false })), [job.id, job.updated_at]);
  const versions = data || [];
  useEffect(() => { if (versions.length && !versions.some((v) => v.id === sel)) setSel(versions[0].id); }, [versions, sel]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote error={error} />;

  const open = versions.find((v) => ['draft', 'submitted', 'revision'].includes(v.status));
  const canCreate = stageOk && backCan('cad.write') && !open;
  const create = () => run(async () => {
    const v = await q(supabase.rpc('save_cad_version', {
      p_version_id: null, p_job_id: job.id,
      p_fields: { designer_name: profile?.full_name || null, client_instructions: [job.customer_request, job.description].filter(Boolean).join('\n\n') || null, cad_date: new Date().toISOString().slice(0, 10) },
      p_metals: [], p_stones: [],
    }));
    await reload(); setSel(v.id);
  }, 'New CAD version started');

  const current = versions.find((v) => v.id === sel);
  return (
    <div className="cad-layout">
      <Card title="CAD versions" actions={canCreate && <button className="btn primary sm" disabled={busy} onClick={create}>New version</button>}>
        {versions.length === 0 ? <Empty>{canCreate ? 'No CAD yet. Start version 1.' : stageOk ? 'No CAD yet. The back office / CAD team starts it.' : 'No CAD versions.'}</Empty> : (
          <ul className="list versions">
            {versions.map((v) => (
              <li key={v.id}>
                <button className={`ver ${v.id === sel ? 'on' : ''}`} onClick={() => setSel(v.id)}>
                  <b className="mono">V{v.version_no}</b> <Pill tone={TONE[v.status]}>{v.status}</Pill>
                  <small className="muted">{v.designer_name || '—'} · {fmtDate(v.submitted_at || v.created_at)}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!stageOk && <p className="muted small">New CAD versions can be started while the job is at New or CAD.</p>}
      </Card>
      {current && <CadSheet key={current.id + current.updated_at} job={job} version={current} stageOk={stageOk}
        onSaved={async () => { await reload(); onChanged?.(); }} />}
    </div>
  );
}

function CadSheet({ job, version, stageOk, onSaved }) {
  const ref = useRefData();
  const { can } = useAuth();
  const toast = useToast();
  const [run, busy] = useAction();
  const editable = stageOk && ['draft', 'revision'].includes(version.status) && can('cad.write', job.back_office_id);
  const canReview = version.status === 'submitted' && can('job.advance_stage', job.back_office_id);
  const [f, setF] = useState({ designer_name: version.designer_name || '', cad_date: version.cad_date || '', render_url: version.render_url || '', client_instructions: version.client_instructions || '', notes: version.notes || '' });
  const [metals, setMetals] = useState(null);
  const [stones, setStones] = useState(null);
  const [importNotes, setImportNotes] = useState([]);
  const [pendingImages, setPendingImages] = useState([]);
  const [reviewing, setReviewing] = useState(null);
  const [dirty, setDirty] = useState(false);

  const lines = useLoad(async () => {
    const [m, s] = await Promise.all([
      q(supabase.from('cad_version_metals').select('*').eq('cad_version_id', version.id).order('line_no')),
      q(supabase.from('cad_version_stones').select('*').eq('cad_version_id', version.id).order('line_no')),
    ]);
    return { m, s };
  }, [version.id]);
  useEffect(() => {
    if (!lines.data) return;
    const m = lines.data.m.map((x) => ({ metal: x.metal, grams: x.grams ?? '', rhodium: x.rhodium || '', finish: x.finish || '', note: x.note || '' }));
    const s = lines.data.s.map((x) => ({ ...blankStone(), ...x, ct_pc: x.ct_pc ?? '', pcs: x.pcs ?? '' }));
    setMetals(m.length ? m : [blankMetal()]);
    setStones(s.length ? s : (editable ? [blankStone()] : []));
  }, [lines.data, editable]);

  const totals = useMemo(() => (stones || []).reduce((a, s) => {
    if (s.is_blank) return a;
    const pcs = Number(s.pcs) || 0; return { pcs: a.pcs + pcs, ct: a.ct + pcs * (Number(s.ct_pc) || 0) };
  }, { pcs: 0, ct: 0 }), [stones]);
  const grams = (metals || []).reduce((a, m) => a + (Number(m.grams) || 0), 0);

  if (lines.loading && !lines.data) return <Loading />;
  if (lines.error) return <ErrorNote error={lines.error} />;
  if (!metals || !stones) return <Loading />;

  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setDirty(true); };
  const upd = (setter, i, k) => (v) => { setter((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r))); setDirty(true); };

  const save = (thenSubmit = false) => run(async () => {
    const payload = {
      p_version_id: version.id, p_job_id: job.id,
      p_fields: { ...f, cad_date: f.cad_date || null, render_url: f.render_url.trim() || null },
      p_metals: metals.filter((m) => m.metal.trim()).map((m) => ({ ...m, grams: n(m.grams) })),
      p_stones: stones.filter((s) => s.shape || s.size || s.pcs).map((s) => ({ ...s, ct_pc: n(s.ct_pc), pcs: s.pcs === '' ? null : parseInt(s.pcs, 10) })),
    };
    if (payload.p_fields.render_url && !/^https:\/\//.test(payload.p_fields.render_url)) {
      const e = new Error('The render URL must start with https://'); e.code = '23514'; throw e;
    }
    await q(supabase.rpc('save_cad_version', payload));
    for (const [i, url] of pendingImages.entries()) {
      try { await uploadJobFile(job.id, dataUrlToFile(url, `imported-cad-${i + 1}.${/png/.test(url) ? 'png' : 'jpg'}`), 'cad', { cad_version_id: version.id }); } catch (e) { toast(`Image ${i + 1}: ${mapError(e).message}`, 'warn'); }
    }
    setPendingImages([]);
    setDirty(false);
    if (thenSubmit) await q(supabase.rpc('submit_cad_version', { p_version_id: version.id }));
    await onSaved();
  }, thenSubmit ? `V${version.version_no} submitted for review` : 'Draft saved');

  const review = (decision, note) => run(async () => {
    await q(supabase.rpc('review_cad_version', { p_version_id: version.id, p_decision: decision, p_note: note || null }));
    setReviewing(null);
    await onSaved();
  }, decision === 'accept' ? `V${version.version_no} accepted - customer approval can start` : 'Revision requested');

  async function importCsv(file) {
    const { rows, notes } = stonesFromCsv(await file.text());
    if (!rows.length) { setImportNotes(notes.length ? notes : ['No stone rows found.']); return; }
    setStones(rows.map((r) => ({ ...blankStone(), ...r, ct_pc: r.ct_pc ?? '', pcs: r.pcs ?? '' })));
    setImportNotes([`${rows.length} stone row(s) imported from ${file.name}. Review, then save.`, ...notes]);
    setDirty(true);
  }
  async function importJson(file) {
    let d;
    try { d = JSON.parse(await file.text()); } catch { setImportNotes([`${file.name} is not valid JSON.`]); return; }
    const r = fromCadJson(d);
    if (r.fields.designer_name || r.fields.client_instructions) setF((x) => ({ ...x, designer_name: r.fields.designer_name || x.designer_name, client_instructions: r.fields.client_instructions || x.client_instructions }));
    if (r.metals.length) setMetals(r.metals.slice(0, 3).map((m) => ({ ...blankMetal(), ...m, grams: m.grams ?? '' })));
    if (r.stones.length) setStones(r.stones.map((s) => ({ ...blankStone(), ...s, ct_pc: s.ct_pc ?? '', pcs: s.pcs ?? '' })));
    setPendingImages(r.images.slice(0, 10));
    setImportNotes([`Loaded ${file.name}: ${r.metals.length} metal(s), ${r.stones.length} stone row(s)${r.images.length ? `, ${r.images.length} image(s) to upload on save` : ''}.`, ...r.notes]);
    setDirty(true);
  }

  const downloadZip = () => run(async () => {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    const base = `${job.job_no}-CAD-V${version.version_no}`;
    const sheet = {
      job: { job_no: job.job_no, title: job.title, item_type: job.item_type, item_sub_type: job.item_sub_type, size: [job.size_label, job.size_system].filter(Boolean).join(' '), style_no: job.style_no || job.ref_no || null },
      version: { version_no: version.version_no, status: version.status, ...f }, metals, stones, totals: { pcs: totals.pcs, cttw: +totals.ct.toFixed(4), grams: +grams.toFixed(3) },
      exportedAt: new Date().toISOString(),
    };
    zip.file('cad-sheet.json', JSON.stringify(sheet, null, 2));
    zip.file('metals.csv', toCsv(metals, ['metal', 'grams', 'rhodium', 'finish', 'note']));
    zip.file('stones.csv', toCsv(stones.map((s) => ({ ...s, cttw: (Number(s.ct_pc) || 0) * (Number(s.pcs) || 0) })), ['position', 'stone_type', 'is_blank', 'shape', 'size', 'ct_pc', 'pcs', 'cttw', 'role', 'setting_style']));
    const files = await q(supabase.from('job_files').select('*').eq('job_id', job.id).or(`cad_version_id.eq.${version.id},kind.eq.reference`));
    for (const fl of files) {
      const blob = await downloadFile(fl.storage_path);
      zip.file(`${fl.kind === 'reference' ? 'reference' : 'cad'}/${fl.file_name}`, blob);
    }
    const out = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(out); a.download = `${base}.zip`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'ZIP downloaded');

  const ro = !editable;
  return (
    <div className="stack">
      <Card title={<>CAD sheet · <span className="mono">V{version.version_no}</span> <Pill tone={TONE[version.status]}>{version.status}</Pill></>}
        actions={<>
          {editable && <label className="btn sm">Load JSON<input type="file" accept="application/json,.json" hidden onChange={(e) => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; }} /></label>}
          <button className="btn sm" disabled={busy} onClick={downloadZip}>Download ZIP</button>
        </>}>
        {version.status === 'revision' && version.review_note && <div className="note warn"><b>Revision asked:</b> {version.review_note}</div>}
        {version.status === 'accepted' && <div className="note info">Accepted {fmtDate(version.reviewed_at)}{version.review_note ? ` · ${version.review_note}` : ''}. Its metal weights and stones are what the quote uses.</div>}
        {importNotes.length > 0 && <div className="note info">{importNotes.map((x, i) => <div key={i}>{x}</div>)}</div>}
        <div className="form-grid">
          <Field label="Job #"><input value={job.job_no} readOnly tabIndex={-1} /></Field>
          <Field label="Style / SKU #"><input value={job.style_no || job.ref_no || '—'} readOnly tabIndex={-1} /></Field>
          <Field label="Item"><input value={[job.item_type, job.item_sub_type, job.size_label && `${job.size_system || ''} ${job.size_label}`].filter(Boolean).join(' · ') || '—'} readOnly tabIndex={-1} /></Field>
          <Field label="Designer"><input value={f.designer_name} onChange={set('designer_name')} readOnly={ro} maxLength={80} placeholder="e.g. Gopal" /></Field>
          <Field label="CAD date"><input type="date" value={f.cad_date} onChange={set('cad_date')} readOnly={ro} /></Field>
          <Field label="Render URL"><input value={f.render_url} onChange={set('render_url')} readOnly={ro} maxLength={500} placeholder="https://… (Sketchfab or turntable video)" /></Field>
        </div>
      </Card>

      <Card title={`Metal details · ${grams.toFixed(3)} g`}>
        <div className="table-wrap">
          <table className="table lines">
            <thead><tr><th>#</th><th>Metal</th><th>Gms</th><th>Rhodium</th><th>Finish</th><th>Note</th>{editable && <th />}</tr></thead>
            <tbody>
              {metals.map((m, i) => (
                <tr key={i}>
                  <td className="muted">{i + 1}</td>
                  <td><input list="cad-metals" value={m.metal} onChange={(e) => upd(setMetals, i, 'metal')(e.target.value)} readOnly={ro} aria-label={`CAD metal ${i + 1}`} /></td>
                  <td><input type="number" min={0} step="0.001" value={m.grams} onChange={(e) => upd(setMetals, i, 'grams')(e.target.value)} readOnly={ro} className="w-s" aria-label={`Grams ${i + 1}`} /></td>
                  <td><select value={m.rhodium} onChange={(e) => upd(setMetals, i, 'rhodium')(e.target.value)} disabled={ro}><option value="">—</option>{RHODIUM.map((x) => <option key={x}>{x}</option>)}</select></td>
                  <td><select value={m.finish} onChange={(e) => upd(setMetals, i, 'finish')(e.target.value)} disabled={ro}><option value="">—</option>{FINISHES.map((x) => <option key={x}>{x}</option>)}</select></td>
                  <td><input value={m.note} onChange={(e) => upd(setMetals, i, 'note')(e.target.value)} readOnly={ro} maxLength={300} /></td>
                  {editable && <td><button type="button" className="x" aria-label="Remove metal" onClick={() => { setMetals((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : [blankMetal()])); setDirty(true); }}>×</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <datalist id="cad-metals">{(ref.alloyCodes || METALS).map((m) => <option key={m} value={m} />)}</datalist>
        {editable && metals.length < 3 && <button className="link-btn" onClick={() => { setMetals((r) => [...r, blankMetal()]); setDirty(true); }}>+ Add metal</button>}
      </Card>

      <Card title={`Stone details · ${totals.pcs} pcs | ${totals.ct.toFixed(3)} cttw`}
        actions={editable && <label className="btn sm">Import matrix (CSV)<input type="file" accept=".csv,text/csv" hidden onChange={(e) => { if (e.target.files[0]) importCsv(e.target.files[0]); e.target.value = ''; }} /></label>}>
        {stones.length === 0 ? <Empty>No stones.</Empty> : (
          <div className="table-wrap">
            <table className="table lines">
              <thead><tr><th>Pos</th><th>Type</th><th>Blank</th><th>Shape</th><th>Size</th><th>ct/pc</th><th>Pcs</th><th>CTTW</th><th>Role</th><th>Style</th>{editable && <th />}</tr></thead>
              <tbody>
                {stones.map((s, i) => {
                  const u = (k) => upd(setStones, i, k);
                  const cttw = (Number(s.ct_pc) || 0) * (Number(s.pcs) || 0);
                  return (
                    <tr key={i} className={s.is_blank ? 'dim' : ''}>
                      <td><input value={s.position || ''} onChange={(e) => u('position')(e.target.value)} readOnly={ro} className="w-s" maxLength={30} aria-label={`Position ${i + 1}`} /></td>
                      <td><select value={s.stone_type} onChange={(e) => u('stone_type')(e.target.value)} disabled={ro} aria-label={`Type ${i + 1}`}>{STONE_TYPES.map(([v]) => <option key={v}>{v}</option>)}</select></td>
                      <td className="c"><input type="checkbox" checked={!!s.is_blank} onChange={(e) => u('is_blank')(e.target.checked)} disabled={ro} aria-label={`Blank ${i + 1}`} /></td>
                      <td><select value={s.shape || ''} onChange={(e) => u('shape')(e.target.value)} disabled={ro} aria-label={`Shape ${i + 1}`}><option value="">—</option>{[...new Set([...SHAPES, s.shape].filter(Boolean))].map((x) => <option key={x}>{x}</option>)}</select></td>
                      <td><input value={s.size || ''} onChange={(e) => u('size')(e.target.value)} readOnly={ro} className="w-s" maxLength={30} placeholder="mm" aria-label={`Size ${i + 1}`} /></td>
                      <td><input type="number" min={0} step="0.0001" value={s.ct_pc} onChange={(e) => u('ct_pc')(e.target.value)} readOnly={ro} className="w-s" aria-label={`ct/pc ${i + 1}`} /></td>
                      <td><input type="number" min={0} step={1} value={s.pcs} onChange={(e) => u('pcs')(e.target.value)} readOnly={ro} className="w-xs" aria-label={`Pcs ${i + 1}`} /></td>
                      <td className="mono calc">{cttw ? cttw.toFixed(3) : '—'}</td>
                      <td><input value={s.role || ''} onChange={(e) => u('role')(e.target.value)} readOnly={ro} className="w-s" maxLength={30} placeholder="center" aria-label={`Role ${i + 1}`} /></td>
                      <td><input list="cad-settings" value={s.setting_style || ''} onChange={(e) => u('setting_style')(e.target.value)} readOnly={ro} className="w-s" maxLength={40} aria-label={`Style ${i + 1}`} /></td>
                      {editable && <td><button type="button" className="x" aria-label="Remove stone" onClick={() => { setStones((r) => r.filter((_, j) => j !== i)); setDirty(true); }}>×</button></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <datalist id="cad-settings">{SETTINGS.map((x) => <option key={x} value={x} />)}</datalist>
        {editable && <button className="link-btn" onClick={() => { setStones((r) => [...r, blankStone()]); setDirty(true); }}>+ Add stone row</button>}
      </Card>

      <div className="grid2">
        <Card title="Client instructions">
          <textarea rows={5} value={f.client_instructions} onChange={set('client_instructions')} readOnly={ro} maxLength={4000} aria-label="Client instructions" />
        </Card>
        <Card title="Designer notes">
          <textarea rows={5} value={f.notes} onChange={set('notes')} readOnly={ro} maxLength={2000} aria-label="Designer notes" />
        </Card>
      </div>

      <JobFiles job={job} kind="cad" title={`CAD images · V${version.version_no}`} cadVersionId={version.id} readOnly={!editable} />
      <JobFiles job={job} kind="reference" title="Reference images" readOnly />

      {(editable || canReview) && (
        <div className="sticky-actions">
          {dirty && <small className="muted">Unsaved changes</small>}
          {editable && <button className="btn" disabled={busy} onClick={() => save(false)}>Save draft</button>}
          {editable && <button className="btn primary" disabled={busy} onClick={() => save(true)}>Save & submit for review</button>}
          {canReview && <button className="btn" disabled={busy} onClick={() => setReviewing('revision')}>Ask for revision</button>}
          {canReview && <button className="btn primary" disabled={busy} onClick={() => review('accept')}>Accept V{version.version_no}</button>}
        </div>
      )}
      {reviewing === 'revision' && <RevisionModal busy={busy} onClose={() => setReviewing(null)} onSend={(note) => review('revision', note)} />}
    </div>
  );
}

function RevisionModal({ busy, onClose, onSend }) {
  const [note, setNote] = useState('');
  return (
    <Modal title="Ask the designer for a revision" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !note.trim()} onClick={() => onSend(note.trim())}>Send back</button></>}>
      <Field label="What needs to change"><textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} autoFocus /></Field>
    </Modal>
  );
}
