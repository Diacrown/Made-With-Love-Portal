import { Link } from 'react-router-dom';
import { supabase, q } from '../lib/supabase';
import { useLoad } from '../lib/hooks';
import { useRefData } from '../lib/refdata';
import { useAuth } from '../auth/AuthProvider';
import { myTurn } from '../lib/workflow';
import { Card, Empty, ErrorScreen, Loading, PageHead, StagePill } from '../components/ui';

export default function Overview() {
  const ref = useRefData();
  const { can, profile } = useAuth();
  const canJobs = can('job.read');

  const { loading, error, data, reload } = useLoad(async () => {
    const [jobs, ms] = await Promise.all([
      canJobs ? q(supabase.from('jobs').select('id, job_no, title, job_type, stage_id, status_code, front_office_id, back_office_id, updated_at').order('updated_at', { ascending: false }).limit(1000)) : [],
      canJobs ? q(supabase.from('job_milestones').select('job_id, code')) : [],
    ]);
    const msByJob = {};
    ms.forEach((m) => { (msByJob[m.job_id] ||= []).push(m.code); });
    return { jobs, msByJob };
  }, [canJobs]);

  if (loading) return <Loading />;
  if (error) return <ErrorScreen error={error} onRetry={reload} />;

  const { jobs, msByJob } = data;
  const open = jobs.filter((j) => ref.stageById[j.stage_id]?.code !== 'closed');
  const counts = ref.stages.map((s) => ({ s, n: jobs.filter((j) => j.stage_id === s.id).length }));
  const max = Math.max(1, ...counts.map((c) => c.n));
  const turn = jobs
    .map((j) => ({ j, items: myTurn(j, ref, can, msByJob[j.id]) }))
    .filter((x) => x.items.length)
    .slice(0, 12);

  return (
    <>
      <PageHead crumb="Workspace" title={`Hello${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`} sub="Jobs you can see, where they are, and what is waiting for you." />
      <div className="stats">
        <div className="stat"><small>Open jobs</small><b>{open.length}</b></div>
        <div className="stat"><small>Waiting for you</small><b>{turn.length}</b></div>
        <div className="stat"><small>All visible jobs</small><b>{jobs.length}</b></div>
      </div>
      <div className="grid2">
        <Card title="Your turn">
          {turn.length === 0 ? <Empty>Nothing is waiting for you right now.</Empty> : (
            <ul className="list">
              {turn.map(({ j, items }) => (
                <li key={j.id}>
                  <Link to={`/jobs/${j.id}`} className="list-main"><span className="mono">{j.job_no}</span> {j.title}</Link>
                  <div className="list-sub"><StagePill stage={ref.stageById[j.stage_id]} /> {items[0]}{items.length > 1 ? ` (+${items.length - 1} more)` : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Jobs by stage">
          {counts.map(({ s, n }) => (
            <Link key={s.id} to={`/jobs?stage=${s.code}`} className="bar-row">
              <span>{s.name}</span>
              <span className="bar"><span style={{ width: `${(n / max) * 100}%` }} /></span>
              <b>{n}</b>
            </Link>
          ))}
        </Card>
      </div>
    </>
  );
}
