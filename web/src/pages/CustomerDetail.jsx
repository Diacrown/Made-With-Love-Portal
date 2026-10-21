import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase, q } from '../lib/supabase';
import { useLoad } from '../lib/hooks';
import { useRefData } from '../lib/refdata';
import { useAuth } from '../auth/AuthProvider';
import { Card, Empty, ErrorScreen, Field, Loading, PageHead, StagePill, useAction } from '../components/ui';

const one = (x) => (Array.isArray(x) ? x[0] ?? null : x ?? null);

export default function CustomerDetail() {
  const { id } = useParams();
  const ref = useRefData();
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);

  const { loading, error, data, reload } = useLoad(async () => {
    if (!/^\d+$/.test(id)) { const e = new Error('not found'); e.code = 'PGRST116'; throw e; }
    const c = await q(supabase.from('customers').select('*, customer_private(*)').eq('id', id).maybeSingle());
    if (!c) { const e = new Error('not found'); e.code = 'PGRST116'; throw e; }
    const jobs = can('job.read') ? await q(supabase.from('jobs').select('id, job_no, title, stage_id').eq('customer_id', id).order('id', { ascending: false })) : [];
    return { c, jobs };
  }, [id]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorScreen error={error} onRetry={reload} />;
  const { c, jobs } = data;
  const p = one(c.customer_private);
  const canEdit = can('customer_private.write', c.office_id);

  return (
    <>
      <PageHead crumb={<><Link to="/customers">Customers</Link> / {c.alias}</>} title={<span className="mono">{c.alias}</span>}
        sub={`${ref.officeById[c.office_id]?.name} · EZJ ${c.ezj_ac_num || '—'}`} />
      <div className="grid2">
        <Card title="Customer details" actions={canEdit && !editing && <button className="btn sm" onClick={() => setEditing(true)}>{p ? 'Edit' : 'Add details'}</button>}>
          {editing ? <EditPrivate c={c} p={p} onDone={() => { setEditing(false); reload(); }} /> : p ? (
            <dl className="kv">
              <dt>Name</dt><dd>{p.name}</dd>
              <dt>Email</dt><dd>{p.email || '—'}</dd>
              <dt>WhatsApp</dt><dd>{p.whatsapp || '—'}</dd>
              <dt>Billing</dt><dd>{p.billing_address || '—'}</dd>
              <dt>Shipping</dt><dd>{p.shipping_address || '—'}</dd>
              <dt>Currency</dt><dd>{p.currency_code || '—'}</dd>
              <dt>Tax %</dt><dd>{p.tax_perc ?? '—'}</dd>
            </dl>
          ) : can('customer_private.read', c.office_id) ? <Empty>No details entered yet.</Empty> : (
            <div className="restricted"><b>🔒 Restricted</b><p>Customer details are visible only to this customer&apos;s front office.</p></div>
          )}
        </Card>
        <Card title={`Jobs (${jobs.length})`}>
          {jobs.length === 0 ? <Empty>No jobs you can see.</Empty> : (
            <ul className="list">
              {jobs.map((j) => (
                <li key={j.id}><Link className="list-main" to={`/jobs/${j.id}`}><span className="mono">{j.job_no}</span> {j.title}</Link> <StagePill stage={ref.stageById[j.stage_id]} /></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function EditPrivate({ c, p, onDone }) {
  const ref = useRefData();
  const [run, busy] = useAction();
  const [f, setF] = useState({
    name: p?.name || '', email: p?.email || '', whatsapp: p?.whatsapp || '',
    billing_address: p?.billing_address || '', shipping_address: p?.shipping_address || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const emailOk = !f.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email);

  async function save() {
    const row = {
      customer_id: c.id, name: f.name.trim(), email: f.email.trim() || null, whatsapp: f.whatsapp.replace(/\D/g, '') || null,
      billing_address: f.billing_address.trim() || null, shipping_address: f.shipping_address.trim() || null,
      currency_code: p?.currency_code || ref.officeById[c.office_id]?.currency_code || null,
    };
    const ok = await run(async () => { await q(supabase.from('customer_private').upsert(row, { onConflict: 'customer_id' })); return true; }, 'Saved');
    if (ok) onDone();
  }

  return (
    <div className="stack">
      <Field label="Name"><input value={f.name} onChange={set('name')} /></Field>
      <Field label="Email"><input type="email" value={f.email} onChange={set('email')} aria-invalid={!emailOk} /></Field>
      <Field label="WhatsApp"><input value={f.whatsapp} onChange={set('whatsapp')} /></Field>
      <Field label="Billing address"><textarea rows={2} value={f.billing_address} onChange={set('billing_address')} /></Field>
      <Field label="Shipping address"><textarea rows={2} value={f.shipping_address} onChange={set('shipping_address')} /></Field>
      <div className="row gap">
        <button className="btn" onClick={onDone}>Cancel</button>
        <button className="btn primary" disabled={busy || !f.name.trim() || !emailOk} onClick={save}>Save</button>
      </div>
    </div>
  );
}
