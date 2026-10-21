import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase, q } from '../lib/supabase';
import { useLoad, fmtDate } from '../lib/hooks';
import { useRefData, OWNER_LABEL, JOB_TYPE_LABEL } from '../lib/refdata';
import { useAuth } from '../auth/AuthProvider';
import { checklistFor, movesFor } from '../lib/workflow';
import { Card, Empty, ErrorScreen, Loading, PageHead, Pill, StagePill, useAction } from '../components/ui';

const one = (x) => (Array.isArray(x) ? x[0] ?? null : x ?? null);

export default function JobDetail() {
  const { id } = useParams();
  const ref = useRefData();
  const { can, user } = useAuth();
  const [tab, setTab] = useState('overview');
  const [note, setNote] = useState('');
  const [run, busy] = useAction();

  const { loading, error, data, reload } = useLoad(async () => {
    if (!/^\d+$/.test(id)) { const e = new Error('Job not found'); e.code = 'PGRST116'; throw e; }
    const job = await q(supabase.from('jobs')
      .select('*, customer:customers(id, alias, ezj_ac_num, office_id, customer_private(name, email, whatsapp, billing_address, shipping_address, currency_code))')
      .eq('id', id).maybeSingle());
    if (!job) { const e = new Error('Job not found'); e.code = 'PGRST116'; throw e; }
    const [ms, hist] = await Promise.all([
      q(supabase.from('job_milestones').select('code, set_at, set_by').eq('job_id', id)),
      q(supabase.from('job_stage_history').select('*').eq('job_id', id).order('changed_at', { ascending: true })),
    ]);
    const ids = [...new Set([...ms.map((m) => m.set_by), ...hist.map((h) => h.changed_by), job.created_by].filter(Boolean))];
    const names = ids.length ? await q(supabase.rpc('staff_names', { p_ids: ids })) : [];
    return { job, ms, hist, names: Object.fromEntries(names.map((n) => [n.id, n.full_name])) };
  }, [id]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorScreen error={error} onRetry={reload} />;

  const { job, ms, hist, names } = data;
  const who = (uid) => (!uid ? 'System' : uid === user.id ? 'You' : names[uid] || 'Team member');
  const stage = ref.stageById[job.stage_id];
  const msCodes = ms.map((m) => m.code);
  const moves = movesFor(job, ref, can, msCodes);
  const checklist = checklistFor(job, ref, can, msCodes);
  const visited = new Set(hist.map((h) => h.to_stage_id));
  const track = ref.stages.filter((s) => s.is_active && (s.code !== 'local_finishing' || visited.has(s.id)));
  const pos = track.findIndex((s) => s.id === job.stage_id);
  const customer = job.customer;
  const priv = one(customer?.customer_private);

  const advance = (mv) => run(async () => {
    await q(supabase.rpc('advance_job', { p_job: job.id, p_to: mv.to.code, p_note: note.trim() || null }));
    setNote('');
    await reload();
  }, `Moved to ${mv.to.name}`);

  const record = (m) => run(async () => {
    await q(supabase.rpc('record_milestone', { p_job: job.id, p_code: m.code }));
    await reload();
  }, 'Recorded');

  return (
    <>
      <PageHead crumb={<><Link to="/jobs">Jobs</Link> / {job.job_no}</>}
        title={<><span className="mono">{job.job_no}</span> <StagePill stage={stage} /></>}
        sub={job.title} />

      <div className="subtabs" role="tablist">
        {[['overview', 'Overview'], ['customer', 'Customer'], ['activity', `Activity (${hist.length})`]].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`subtab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <ol className="track" aria-label="Stages">
            {track.map((s, i) => (
              <li key={s.id} className={i < pos ? 'done' : i === pos ? 'now' : ''}><span>{i + 1}</span>{s.name}</li>
            ))}
          </ol>

          <div className="grid2">
            <Card title={`Step ${pos + 1}: ${stage?.name}`} actions={stage?.owner && <small className="muted">Owner: {OWNER_LABEL[stage.owner]}</small>}>
              {checklist.length > 0 && (
                <ul className="checklist">
                  {checklist.map(({ m, done, canRecord }) => (
                    <li key={m.code} className={done ? 'done' : ''}>
                      <span className="tick" aria-hidden="true">{done ? '✓' : ''}</span>
                      <div>
                        <b>{m.label}</b> <Pill tone={m.owner_side === 'front' ? 'gold' : 'brand'}>{OWNER_LABEL[m.owner_side]}</Pill>
                        {done && <small className="muted"> · {who(ms.find((x) => x.code === m.code)?.set_by)}</small>}
                      </div>
                      {!done && (canRecord
                        ? <button className="btn primary sm" disabled={busy} onClick={() => record(m)}>Record</button>
                        : <small className="muted">Waiting for {OWNER_LABEL[m.owner_side].toLowerCase()}</small>)}
                    </li>
                  ))}
                </ul>
              )}
              {moves.length === 0 ? <Empty>This job is closed. No further moves.</Empty> : (
                <>
                  <label className="field"><span>Note for the activity log (optional)</span>
                    <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Customer asked for a thinner shank" />
                  </label>
                  <div className="moves">
                    {moves.map((mv) => (
                      <div key={mv.t.id} className="move">
                        <button className={`btn ${mv.allowed ? 'primary' : ''}`} disabled={!mv.allowed || busy} onClick={() => advance(mv)} title={mv.reason || ''}>
                          {mv.label} → {mv.to?.name}
                        </button>
                        {mv.reason && <small className="muted">{mv.reason}</small>}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>

            <Card title="Order">
              <dl className="kv">
                <dt>Front office</dt><dd>{ref.officeById[job.front_office_id]?.name}</dd>
                <dt>Back office</dt><dd>{ref.officeById[job.back_office_id]?.name || '—'}</dd>
                <dt>Customer</dt><dd><Link className="mono" to={`/customers/${customer?.id}`}>{customer?.alias}</Link>{priv && ` · ${priv.name}`}</dd>
                <dt>Type</dt><dd>{JOB_TYPE_LABEL[job.job_type]}{job.style_no && ` · ${job.style_no}`}</dd>
                <dt>Item</dt><dd>{job.item_type || '—'}{job.size_label && `, size ${job.size_label} ${job.size_system || ''}`}</dd>
                <dt>Customer ref</dt><dd>{job.customer_ref_no || '—'}</dd>
                <dt>Order ref</dt><dd>{job.order_ref_no || '—'}</dd>
                <dt>Description</dt><dd>{job.description || '—'}</dd>
                <dt>Created</dt><dd>{fmtDate(job.created_at)}</dd>
              </dl>
            </Card>
          </div>
        </>
      )}

      {tab === 'customer' && (
        <div className="grid2">
          <Card title="Customer">
            <dl className="kv">
              <dt>Alias</dt><dd className="mono">{customer?.alias}</dd>
              <dt>EZJ account</dt><dd className="mono">{customer?.ezj_ac_num || '—'}</dd>
              <dt>Office</dt><dd>{ref.officeById[customer?.office_id]?.name}</dd>
            </dl>
          </Card>
          <Card title="Customer details">
            {priv ? (
              <dl className="kv">
                <dt>Name</dt><dd>{priv.name}</dd>
                <dt>Email</dt><dd>{priv.email || '—'}</dd>
                <dt>WhatsApp</dt><dd>{priv.whatsapp || '—'}</dd>
                <dt>Billing</dt><dd>{priv.billing_address || '—'}</dd>
                <dt>Shipping</dt><dd>{priv.shipping_address || '—'}</dd>
                <dt>Currency</dt><dd>{priv.currency_code || '—'}</dd>
              </dl>
            ) : (
              <div className="restricted">
                <b>🔒 Restricted</b>
                <p>Names, addresses and contacts are visible only to the customer&apos;s own front office. The database withheld them for your role.</p>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'activity' && (
        <Card title="Stage history">
          <ul className="timeline">
            {hist.map((h) => (
              <li key={h.id}>
                <b>{h.from_stage_id ? `${ref.stageById[h.from_stage_id]?.name} → ` : 'Created at '}{ref.stageById[h.to_stage_id]?.name}</b>
                <small className="muted"> · {who(h.changed_by)} · {fmtDate(h.changed_at)}</small>
                {h.note && <div className="quote">{h.note}</div>}
              </li>
            ))}
            {ms.map((m) => (
              <li key={m.code} className="ms">
                <b>✓ {ref.milestoneTypes.find((t) => t.code === m.code)?.label || m.code}</b>
                <small className="muted"> · {who(m.set_by)} · {fmtDate(m.set_at)}</small>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
