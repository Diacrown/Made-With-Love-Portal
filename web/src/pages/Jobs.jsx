import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, q } from '../lib/supabase';
import { useLoad, fmtDate } from '../lib/hooks';
import { useRefData, JOB_TYPE_LABEL } from '../lib/refdata';
import { useAuth } from '../auth/AuthProvider';
import { Empty, ErrorScreen, Field, Loading, Modal, PageHead, StagePill, useAction } from '../components/ui';

export default function Jobs() {
  const ref = useRefData();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const stageF = params.get('stage') || 'all';
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const { loading, error, data: jobs, reload } = useLoad(() =>
    q(supabase.from('jobs')
      .select('id, job_no, title, job_type, stage_id, front_office_id, back_office_id, updated_at, customer:customers(alias)')
      .order('updated_at', { ascending: false }).limit(1000)), []);

  const shown = useMemo(() => (jobs || []).filter((j) => {
    if (stageF !== 'all' && ref.stageById[j.stage_id]?.code !== stageF) return false;
    const s = search.trim().toLowerCase();
    return !s || j.job_no.toLowerCase().includes(s) || (j.title || '').toLowerCase().includes(s) || (j.customer?.alias || '').toLowerCase().includes(s);
  }), [jobs, stageF, search, ref]);

  if (loading) return <Loading />;
  if (error) return <ErrorScreen error={error} onRetry={reload} />;

  const present = ref.stages.filter((s) => jobs.some((j) => j.stage_id === s.id));

  return (
    <>
      <PageHead crumb="Jobs" title="All jobs" sub={`${shown.length} of ${jobs.length} shown. You only see jobs of your offices.`}
        actions={can('job.create') && <button className="btn primary" onClick={() => setCreating(true)}>New job</button>} />
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Filter by stage">
          <button className={`chip ${stageF === 'all' ? 'on' : ''}`} onClick={() => setParams({})}>All</button>
          {present.map((s) => (
            <button key={s.id} className={`chip ${stageF === s.code ? 'on' : ''}`} onClick={() => setParams({ stage: s.code })}>{s.name}</button>
          ))}
        </div>
        <input className="search" placeholder="Search job number, title or customer alias" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search jobs" />
      </div>
      {shown.length === 0 ? <Empty>No jobs match.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Job</th><th>Title</th><th>Customer</th><th>Type</th><th>Stage</th><th>Front / back office</th><th>Updated</th></tr></thead>
            <tbody>
              {shown.map((j) => (
                <tr key={j.id}>
                  <td><Link to={`/jobs/${j.id}`} className="mono">{j.job_no}</Link></td>
                  <td>{j.title}</td>
                  <td className="mono">{j.customer?.alias}</td>
                  <td>{JOB_TYPE_LABEL[j.job_type]}</td>
                  <td><StagePill stage={ref.stageById[j.stage_id]} /></td>
                  <td>{ref.officeById[j.front_office_id]?.name} → {ref.officeById[j.back_office_id]?.name || '—'}</td>
                  <td className="muted">{fmtDate(j.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewJob onClose={() => setCreating(false)} />}
    </>
  );
}

function NewJob({ onClose }) {
  const ref = useRefData();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [run, busy] = useAction();
  const [f, setF] = useState({ customer_id: '', title: '', job_type: 'custom', item_type: '', style_no: '', size_label: '', size_system: '', customer_ref_no: '', description: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const { data: customers, loading } = useLoad(() =>
    q(supabase.from('customers').select('id, alias, office_id').order('alias')), []);
  const allowed = (customers || []).filter((c) => can('job.create', c.office_id));

  async function save() {
    const c = allowed.find((x) => String(x.id) === f.customer_id);
    const row = {
      customer_id: c.id, front_office_id: c.office_id, title: f.title.trim(), job_type: f.job_type,
      item_type: f.item_type || null, style_no: f.style_no || null, size_label: f.size_label || null,
      size_system: f.size_system || null, customer_ref_no: f.customer_ref_no || null, description: f.description || null,
    };
    const job = await run(() => q(supabase.from('jobs').insert(row).select('id, job_no').single()), 'Job created');
    if (job) { onClose(); navigate(`/jobs/${job.id}`); }
  }

  const valid = f.customer_id && f.title.trim() && (f.job_type === 'custom' || f.style_no.trim());
  return (
    <Modal title="New job" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!valid || busy} onClick={save}>{busy ? 'Saving…' : 'Create job'}</button></>}>
      {loading ? <Loading /> : allowed.length === 0 ? <Empty>You cannot create jobs for any customer you can see. Add a customer first.</Empty> : (
        <div className="form-grid">
          <Field label="Customer (alias)">
            <select value={f.customer_id} onChange={set('customer_id')}>
              <option value="">Choose…</option>
              {allowed.map((c) => <option key={c.id} value={c.id}>{c.alias} · {ref.officeById[c.office_id]?.name}</option>)}
            </select>
          </Field>
          <Field label="Job type">
            <select value={f.job_type} onChange={set('job_type')}>
              {Object.entries(JOB_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Title"><input value={f.title} onChange={set('title')} maxLength={200} placeholder="e.g. Solitaire ring, catalog R2184" /></Field>
          <Field label="Item type"><input value={f.item_type} onChange={set('item_type')} placeholder="Ring, Pendant…" /></Field>
          <Field label="Style no." hint={f.job_type === 'custom' ? 'Optional for custom jobs' : 'Required for catalog jobs'}><input value={f.style_no} onChange={set('style_no')} /></Field>
          <Field label="Customer reference"><input value={f.customer_ref_no} onChange={set('customer_ref_no')} /></Field>
          <Field label="Size"><input value={f.size_label} onChange={set('size_label')} placeholder="54" /></Field>
          <Field label="Size system"><input value={f.size_system} onChange={set('size_system')} placeholder="EU, US, UK…" /></Field>
          <Field label="Description"><textarea rows={3} value={f.description} onChange={set('description')} maxLength={4000} /></Field>
        </div>
      )}
    </Modal>
  );
}
