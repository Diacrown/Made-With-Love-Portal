import { useRefData, OWNER_LABEL, JOB_TYPE_LABEL } from '../lib/refdata';
import { Card, PageHead, StagePill } from '../components/ui';

export default function Workflow() {
  const ref = useRefData();
  const ms = Object.fromEntries(ref.milestoneTypes.map((m) => [m.code, m]));
  return (
    <>
      <PageHead crumb="Workspace" title="How jobs move"
        sub="Read live from the database. Each move has one owner; some need a step recorded first. Administrators can change this under Admin → Workflow." />
      <Card title="Stages">
        <ol className="stage-list">
          {ref.stages.filter((s) => s.is_active).map((s) => (
            <li key={s.id}>
              <StagePill stage={s} />
              <small className="muted">{s.owner ? OWNER_LABEL[s.owner] : ''}</small>
              <span className="muted small">
                {ref.milestoneTypes.filter((m) => m.stage_code === s.code).map((m) => `Step: ${m.label}`).join(' · ')}
              </span>
            </li>
          ))}
        </ol>
      </Card>
      <Card title="Allowed moves">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>From</th><th>To</th><th>Action</th><th>Who</th><th>Needs first</th><th>Job types</th></tr></thead>
            <tbody>
              {ref.transitions.map((t) => (
                <tr key={t.id}>
                  <td><StagePill stage={ref.stageById[t.from_stage_id]} /></td>
                  <td><StagePill stage={ref.stageById[t.to_stage_id]} /></td>
                  <td>{t.label}</td>
                  <td>{OWNER_LABEL[t.owner_side]}</td>
                  <td>{t.guard_code ? ms[t.guard_code]?.label || t.guard_code : '—'}{t.clears_milestones?.length ? <small className="muted"> (resets {t.clears_milestones.length} step{t.clears_milestones.length > 1 ? 's' : ''})</small> : null}</td>
                  <td>{t.job_type ? JOB_TYPE_LABEL[t.job_type] : 'All'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
