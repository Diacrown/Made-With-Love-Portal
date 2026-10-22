import { useMemo, useState } from 'react';
import { useLive } from '../lib/live';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase, q } from '../lib/supabase';
import { useLoad, fmtDate } from '../lib/hooks';
import { useRefData, JOB_TYPE_LABEL } from '../lib/refdata';
import { Pill } from '../components/ui';
import { useAuth } from '../auth/AuthProvider';
import { Empty, ErrorScreen, Loading, PageHead, StagePill } from '../components/ui';

export default function Jobs() {
  const ref = useRefData();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const stageF = params.get('stage') || 'all';
  const [search, setSearch] = useState('');

  const { loading, error, data: jobs, reload } = useLoad(() =>
    q(supabase.from('jobs')
      .select('id, job_no, title, job_type, stage_id, status_code, front_office_id, back_office_id, updated_at, customer:customers(alias)')
      .order('updated_at', { ascending: false }).limit(1000)), []);
  const [flash, setFlash] = useState(() => new Set());
  useLive(['jobs'], (p) => {
    reload({ silent: true });
    const id = p.new?.id;
    if (id) {
      setFlash((s) => new Set(s).add(id));
      setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(id); return n; }), 4000);
    }
  }, { debounce: 0 });

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
        actions={can('job.create') && <Link className="btn primary" to="/jobs/new">New job</Link>} />
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
            <thead><tr><th>Job</th><th>Title</th><th>Customer</th><th>Type</th><th>Stage</th><th>Status</th><th>Front / back office</th><th>Updated</th></tr></thead>
            <tbody>
              {shown.map((j) => (
                <tr key={j.id} className={flash.has(j.id) ? 'flash' : undefined}>
                  <td><Link to={`/jobs/${j.id}`} className="mono">{j.job_no}</Link></td>
                  <td>{j.title}</td>
                  <td className="mono">{j.customer?.alias}</td>
                  <td>{JOB_TYPE_LABEL[j.job_type]}</td>
                  <td><StagePill stage={ref.stageById[j.stage_id]} /></td>
                  <td>{j.status_code && <Pill tone={ref.statusByCode[j.status_code]?.kind === 'normal' ? 'muted' : 'bad'}>{j.status_code}</Pill>} <small className="muted">{ref.statusByCode[j.status_code]?.label}</small></td>
                  <td>{ref.officeById[j.front_office_id]?.name} → {ref.officeById[j.back_office_id]?.name || '—'}</td>
                  <td className="muted">{fmtDate(j.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
