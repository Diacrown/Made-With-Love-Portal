import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, q } from '../lib/supabase';
import { useLoad } from '../lib/hooks';
import { useLive } from '../lib/live';
import { useRefData } from '../lib/refdata';
import { useAuth } from '../auth/AuthProvider';
import { Empty, ErrorScreen, Field, Loading, Modal, PageHead, useAction } from '../components/ui';

const one = (x) => (Array.isArray(x) ? x[0] ?? null : x ?? null);

export default function Customers() {
  const ref = useRefData();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const { loading, error, data, reload } = useLoad(() =>
    q(supabase.from('customers').select('id, alias, ezj_ac_num, office_id, customer_private(name, email)').order('alias')), []);
  useLive(['customers'], () => reload({ silent: true }));

  const shown = useMemo(() => (data || []).filter((c) => {
    const s = search.trim().toLowerCase();
    const p = one(c.customer_private);
    return !s || c.alias.toLowerCase().includes(s) || (c.ezj_ac_num || '').toLowerCase().includes(s) || (p?.name || '').toLowerCase().includes(s);
  }), [data, search]);

  if (loading) return <Loading />;
  if (error) return <ErrorScreen error={error} onRetry={reload} />;

  const anyPrivate = data.some((c) => one(c.customer_private));

  return (
    <>
      <PageHead crumb="Customers" title="Customers"
        sub={anyPrivate ? 'Full details are shown for customers of your own office.' : 'Your role sees customer aliases only. Names and contacts are restricted to front offices.'}
        actions={can('customer.write') && <button className="btn primary" onClick={() => setCreating(true)}>New customer</button>} />
      <div className="toolbar">
        <input className="search" placeholder="Search alias, EZJ account or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" />
      </div>
      {shown.length === 0 ? <Empty>No customers {data.length ? 'match' : 'are visible to your role yet'}.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Alias</th><th>EZJ account</th><th>Office</th><th>Name</th><th>Email</th></tr></thead>
            <tbody>
              {shown.map((c) => {
                const p = one(c.customer_private);
                return (
                  <tr key={c.id}>
                    <td><Link className="mono" to={`/customers/${c.id}`}>{c.alias}</Link></td>
                    <td className="mono">{c.ezj_ac_num || '—'}</td>
                    <td>{ref.officeById[c.office_id]?.name}</td>
                    <td>{p ? p.name : <span className="locked">🔒 Restricted</span>}</td>
                    <td>{p ? p.email || '—' : <span className="locked">🔒</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewCustomer onClose={() => setCreating(false)} />}
    </>
  );
}

function NewCustomer({ onClose }) {
  const ref = useRefData();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [run, busy] = useAction();
  const offices = ref.offices.filter((o) => can('customer.write', o.id));
  const [f, setF] = useState({ office_id: offices[0]?.id ?? '', alias: '', ezj_ac_num: '', name: '', email: '', whatsapp: '', billing_address: '', shipping_address: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const office = ref.officeById[Number(f.office_id)];
  const canPrivate = office && can('customer_private.write', office.id);

  async function save() {
    const id = await run(async () => {
      const c = await q(supabase.from('customers')
        .insert({ office_id: Number(f.office_id), alias: f.alias.trim().toUpperCase(), ezj_ac_num: f.ezj_ac_num.trim() || null })
        .select('id').single());
      if (canPrivate && f.name.trim()) {
        await q(supabase.from('customer_private').insert({
          customer_id: c.id, name: f.name.trim(), email: f.email.trim() || null,
          whatsapp: f.whatsapp.replace(/\D/g, '') || null, billing_address: f.billing_address.trim() || null,
          shipping_address: f.shipping_address.trim() || null, currency_code: office.currency_code,
        }));
      }
      return c.id;
    }, 'Customer saved');
    if (id) { onClose(); navigate(`/customers/${id}`); }
  }

  const emailOk = !f.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email);
  const valid = f.office_id && /^[A-Za-z0-9-]{2,30}$/.test(f.alias.trim()) && emailOk && (!canPrivate || f.name.trim());
  return (
    <Modal title="New customer" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!valid || busy} onClick={save}>{busy ? 'Saving…' : 'Save customer'}</button></>}>
      <div className="form-grid">
        <Field label="Office">
          <select value={f.office_id} onChange={set('office_id')}>
            {offices.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.code})</option>)}
          </select>
        </Field>
        <Field label="Alias code" hint="Letters, numbers, dashes. Shown to production."><input value={f.alias} onChange={set('alias')} placeholder="DE-C0050" /></Field>
        <Field label="EZJEMS account no."><input value={f.ezj_ac_num} onChange={set('ezj_ac_num')} /></Field>
        {canPrivate ? (
          <>
            <Field label="Customer name"><input value={f.name} onChange={set('name')} /></Field>
            <Field label="Email">
              <input type="email" value={f.email} onChange={set('email')} aria-invalid={!emailOk} />
            </Field>
            <Field label="WhatsApp" hint="Digits only, with country code"><input value={f.whatsapp} onChange={set('whatsapp')} /></Field>
            <Field label="Billing address"><textarea rows={2} value={f.billing_address} onChange={set('billing_address')} /></Field>
            <Field label="Shipping address"><textarea rows={2} value={f.shipping_address} onChange={set('shipping_address')} /></Field>
          </>
        ) : <div className="note info">Your role at this office cannot enter customer details. Only the alias is saved.</div>}
      </div>
    </Modal>
  );
}
