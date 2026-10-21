// Specification tab on a job: the job card (read or edit), and its reference files.
import { useState } from 'react';
import { supabase, q } from '../lib/supabase';
import { useLoad, fmtDate } from '../lib/hooks';
import { useRefData } from '../lib/refdata';
import { useAuth } from '../auth/AuthProvider';
import { REQUEST_TYPES, PROJECT_TYPES, SUB_TYPES, REF_TYPES, METAL_TONES, STONE_TYPES, SOURCES, ENGRAVE_METHODS, label } from '../lib/options';
import { uploadJobFile, signedUrls, deleteJobFile, isImage, fmtBytes, ACCEPT } from '../lib/files';
import JobForm from './JobForm';
import { Card, Empty, ErrorNote, Loading, Pill, useAction } from './ui';

export default function JobSpec({ job, editable, onSaved }) {
  const ref = useRefData();
  const [editing, setEditing] = useState(null); // null | 'simple' | 'advanced'
  const [run, busy] = useAction();
  const { loading, error, data, reload } = useLoad(async () => {
    const [metals, stones] = await Promise.all([
      q(supabase.from('job_metal_lines').select('*').eq('job_id', job.id).order('line_no')),
      q(supabase.from('job_stone_lines').select('*').eq('job_id', job.id).order('line_no')),
    ]);
    return { metals, stones };
  }, [job.id, job.updated_at]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  const { metals, stones } = data;
  const variant = job.form_variant === 'advanced' ? 'advanced' : 'simple';

  if (editing) {
    return (
      <Card title={`Edit specification (${editing})`}>
        <JobForm variant={editing} job={job} metals={metals} stones={stones} officeById={ref.officeById} busy={busy} allowFiles={false}
          submitLabel="Save specification" onCancel={() => setEditing(null)}
          onSubmit={async ({ job: j, metals: m, stones: s }) => {
            const ok = await run(() => q(supabase.rpc('save_job', { p_job_id: job.id, p_job: j, p_metals: m, p_stones: s })), 'Specification saved');
            if (ok) { setEditing(null); await reload(); onSaved?.(); }
          }} />
      </Card>
    );
  }

  const v = (x) => (x == null || x === '' ? '—' : x);
  const totalCt = stones.reduce((a, s) => a + (Number(s.ct_pc) || 0) * (Number(s.pcs) || 0), 0);
  const totalPcs = stones.reduce((a, s) => a + (Number(s.pcs) || 0), 0);
  return (
    <>
      <Card title={`Job card (${variant})`} actions={editable
        ? <><button className="btn sm" onClick={() => setEditing(variant)}>Edit</button>
          {variant === 'simple' && <button className="btn sm" onClick={() => setEditing('advanced')}>Edit as advanced</button>}</>
        : <small className="muted">Frozen: the job is at or past Ready for production.</small>}>
        <div className="spec-grid">
          <dl className="kv">
            <dt>Stage requested</dt><dd>{label(REQUEST_TYPES, job.request_type)}{job.is_rush && <> <Pill tone="bad">Rush</Pill></>}</dd>
            <dt>Project</dt><dd>{label(PROJECT_TYPES, job.job_type)}{job.sub_type && ` · ${label(SUB_TYPES, job.sub_type)}`}</dd>
            <dt>Reference</dt><dd>{job.ref_no ? `${label(REF_TYPES, job.ref_type)} ${job.ref_no}` : '—'}</dd>
            <dt>Item</dt><dd>{[job.item_type, job.item_sub_type].filter(Boolean).join(' · ') || '—'}{job.size_label && `, size ${job.size_label} ${job.size_system || ''}`}</dd>
            <dt>Quantity</dt><dd>{job.quantity}</dd>
            <dt>Due / in store</dt><dd>{v(job.due_date)} / {v(job.in_store_by)}</dd>
            <dt>Budget</dt><dd>{job.budget != null ? `${job.budget_currency || ''} ${Number(job.budget).toLocaleString()}` : '—'}</dd>
            <dt>Quick options</dt><dd>{job.quick_options?.length ? job.quick_options.join(', ') : '—'}</dd>
          </dl>
          <dl className="kv">
            <dt>Customer request</dt><dd className="pre">{v(job.customer_request)}</dd>
            <dt>Design brief</dt><dd className="pre">{v(job.design_brief)}</dd>
            <dt>Must keep</dt><dd className="pre">{v(job.must_keep)}</dd>
            <dt>Avoid</dt><dd className="pre">{v(job.avoid)}</dd>
            <dt>Stamping</dt><dd>{job.stamping ? `${job.stamping}${job.stamping_location ? ` at ${job.stamping_location}` : ''}` : '—'}</dd>
            <dt>Engraving</dt><dd>{job.engrave_text ? `"${job.engrave_text}" ${[job.engrave_location, job.engrave_font, label(ENGRAVE_METHODS, job.engrave_method)].filter((x) => x && x !== '—').join(' · ')}` : '—'}</dd>
          </dl>
        </div>
      </Card>

      <div className="grid2">
        <Card title={`Metal${job.metal_tone ? ` · ${label(METAL_TONES, job.metal_tone)}` : ''}${job.target_metal_weight ? ` · target ${job.target_metal_weight} g` : ''}`}>
          {metals.length === 0 ? <Empty>No metal lines.</Empty> : (
            <table className="table"><thead><tr><th>#</th><th>Metal</th><th>Colour</th><th>Rhodium</th><th>Finish</th><th>Notes</th></tr></thead>
              <tbody>{metals.map((m) => <tr key={m.id}><td>{m.line_no}</td><td>{m.metal}</td><td>{v(m.color)}</td><td>{v(m.rhodium)}</td><td>{v(m.finish)}</td><td>{v(m.notes)}</td></tr>)}</tbody></table>
          )}
        </Card>
        <Card title={`Stones · ${totalPcs} pcs / ${totalCt.toFixed(3)} ct`}>
          {stones.length === 0 ? <Empty>No stone lines.</Empty> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>#</th><th>Loc</th><th>Type</th><th>Shape</th><th>Size</th><th>Quality</th><th>ct/pc</th><th>Pcs</th><th>Setting</th><th>Source</th></tr></thead>
              <tbody>{stones.map((s) => (
                <tr key={s.id}><td>{s.line_no}</td><td>{v(s.position)}{s.in_mounting != null && <small className="muted"> {s.in_mounting ? '(mntg)' : ''}</small>}</td>
                  <td title={label(STONE_TYPES, s.stone_type)}>{s.stone_type}</td><td>{v(s.shape)}</td><td>{v(s.size)}</td>
                  <td>{[s.color, s.clarity, s.spec].filter(Boolean).join(' / ') || '—'}</td><td className="mono">{s.ct_pc ?? '—'}</td><td>{v(s.pcs)}</td>
                  <td>{v(s.setting)}</td><td>{s.source ? label(SOURCES, s.source) : '—'}</td></tr>))}</tbody></table></div>
          )}
        </Card>
      </div>

      <JobFiles job={job} kind="reference" title="Reference images & files" />
    </>
  );
}

/** Files of one kind for a job: thumbnails, open, upload, delete. */
export function JobFiles({ job, kind, title, cadVersionId = null, readOnly = false }) {
  const { can } = useAuth();
  const [run, busy] = useAction();
  const writable = !readOnly && (can('job.update', job.front_office_id) || can('job.update', job.back_office_id));
  const { loading, error, data, reload } = useLoad(async () => {
    let qy = supabase.from('job_files').select('*').eq('job_id', job.id).eq('kind', kind).order('created_at');
    if (cadVersionId) qy = qy.eq('cad_version_id', cadVersionId);
    const rows = await q(qy);
    const urls = await signedUrls(rows.map((r) => r.storage_path));
    return { rows, urls };
  }, [job.id, kind, cadVersionId]);

  const upload = (fileList) => run(async () => {
    for (const f of fileList) await uploadJobFile(job.id, f, kind, cadVersionId ? { cad_version_id: cadVersionId } : {});
    await reload();
  }, `${fileList.length} file(s) uploaded`);
  const remove = (r) => {
    if (!window.confirm(`Delete ${r.file_name}?`)) return;
    run(async () => { await deleteJobFile(r); await reload(); }, 'File deleted');
  };

  return (
    <Card title={title} actions={writable && (
      <label className="btn sm">{busy ? 'Working…' : 'Upload'}<input type="file" multiple accept={ACCEPT} hidden disabled={busy} onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} /></label>
    )}>
      {loading && !data ? <Loading /> : error ? <ErrorNote error={error} /> : data.rows.length === 0 ? <Empty>No files yet.</Empty> : (
        <div className="files">
          {data.rows.map((r) => (
            <figure key={r.id} className="file">
              <a href={data.urls[r.storage_path]} target="_blank" rel="noreferrer noopener">
                {isImage(r) && data.urls[r.storage_path] ? <img src={data.urls[r.storage_path]} alt={r.file_name} loading="lazy" /> : <span className="file-icon">{(r.file_name.split('.').pop() || 'file').toUpperCase()}</span>}
              </a>
              <figcaption>
                <span title={r.file_name}>{r.file_name}</span>
                <small className="muted">{fmtBytes(r.size_bytes || 0)} · {fmtDate(r.created_at)}</small>
                {writable && <button className="link-btn small" onClick={() => remove(r)}>Delete</button>}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </Card>
  );
}
