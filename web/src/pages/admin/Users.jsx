import { useMemo, useState } from 'react';
import { supabase, q, callFunction } from '../../lib/supabase';
import { useLoad, fmtDate } from '../../lib/hooks';
import { useRefData } from '../../lib/refdata';
import { useAuth } from '../../auth/AuthProvider';
import { Card, Empty, ErrorScreen, Field, Loading, Modal, Pill, useAction } from '../../components/ui';

export default function Users() {
  const ref = useRefData();
  const { user, reloadAccess } = useAuth();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [grantFor, setGrantFor] = useState(null);
  const [created, setCreated] = useState(null);
  const [run, busy] = useAction();

  const { loading, error, data, reload } = useLoad(async () => {
    const [profiles, grants] = await Promise.all([
      q(supabase.from('profiles').select('id, full_name, email, is_active, created_at').order('full_name')),
      q(supabase.from('user_office_roles').select('id, user_id, office_id, role_id')),
    ]);
    return { profiles, grants };
  }, []);

  const shown = useMemo(() => (data?.profiles || []).filter((p) => {
    const s = search.trim().toLowerCase();
    return !s || (p.full_name || '').toLowerCase().includes(s) || (p.email || '').toLowerCase().includes(s);
  }), [data, search]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorScreen error={error} onRetry={reload} />;

  const grantsOf = (uid) => data.grants.filter((g) => g.user_id === uid);
  const removeGrant = (g) => run(async () => {
    await q(supabase.from('user_office_roles').delete().eq('id', g.id));
    await reload();
    if (g.user_id === user.id) await reloadAccess();
  }, 'Role removed');
  const setActive = (p, active) => run(async () => {
    await callFunction('admin-users', { action: 'set_active', user_id: p.id, active });
    await reload();
  }, active ? 'User reactivated' : 'User deactivated - sign-in blocked');

  return (
    <Card title={`Users (${data.profiles.length})`}
      actions={<><input className="search sm" placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users" />
        <button className="btn primary" onClick={() => setAdding(true)}>Add user</button></>}>
      {shown.length === 0 ? <Empty>No users match.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Access</th><th>Status</th><th>Created</th><th /></tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className={p.is_active ? '' : 'dim'}>
                  <td>{p.full_name}{p.id === user.id && <small className="muted"> (you)</small>}</td>
                  <td>{p.email}</td>
                  <td>
                    <div className="grants">
                      {grantsOf(p.id).map((g) => (
                        <span key={g.id} className="grant">
                          {ref.roleById[g.role_id]?.name} · {g.office_id ? ref.officeById[g.office_id]?.code : 'All offices'}
                          <button className="x" title="Remove" aria-label="Remove role" disabled={busy} onClick={() => removeGrant(g)}>×</button>
                        </span>
                      ))}
                      <button className="link-btn" onClick={() => setGrantFor(p)}>+ role</button>
                    </div>
                  </td>
                  <td>{p.is_active ? <Pill tone="good">Active</Pill> : <Pill tone="bad">Deactivated</Pill>}</td>
                  <td className="muted">{fmtDate(p.created_at)}</td>
                  <td>{p.id !== user.id && (
                    <button className="btn sm" disabled={busy} onClick={() => setActive(p, !p.is_active)}>{p.is_active ? 'Deactivate' : 'Reactivate'}</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <AddUser onClose={() => setAdding(false)} onCreated={(r) => { setAdding(false); setCreated(r); reload(); }} />}
      {grantFor && <AddGrant profile={grantFor} onClose={() => setGrantFor(null)} onDone={async () => { setGrantFor(null); await reload(); if (grantFor.id === user.id) await reloadAccess(); }} />}
      {created && (
        <Modal title="User created" onClose={() => setCreated(null)} footer={<button className="btn primary" onClick={() => setCreated(null)}>Done</button>}>
          <p>Give these sign-in details to <b>{created.email}</b> privately. The password is shown only once. They should change it under My account after signing in.</p>
          <div className="secret mono">{created.temp_password}</div>
        </Modal>
      )}
    </Card>
  );
}

function AddUser({ onClose, onCreated }) {
  const ref = useRefData();
  const [run, busy] = useAction();
  const [f, setF] = useState({ full_name: '', email: '', role_code: 'front_office', offices: [] });
  const toggleOffice = (code) => setF({ ...f, offices: f.offices.includes(code) ? f.offices.filter((c) => c !== code) : [...f.offices, code] });
  const isGlobal = f.role_code === 'admin';
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim());
  const valid = f.full_name.trim() && emailOk && (isGlobal || f.offices.length > 0);

  async function save() {
    const r = await run(() => callFunction('admin-users', {
      action: 'create', email: f.email.trim(), full_name: f.full_name.trim(), role_code: f.role_code,
      office_codes: isGlobal ? [] : f.offices,
    }), 'User created');
    if (r) onCreated({ ...r, email: f.email.trim() });
  }

  return (
    <Modal title="Add user" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!valid || busy} onClick={save}>{busy ? 'Creating…' : 'Create user'}</button></>}>
      <div className="form-grid">
        <Field label="Full name"><input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Work email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} aria-invalid={f.email !== '' && !emailOk} /></Field>
        <Field label="Role">
          <select value={f.role_code} onChange={(e) => setF({ ...f, role_code: e.target.value })}>
            {ref.roles.map((r) => <option key={r.id} value={r.code}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Offices" hint={isGlobal ? 'Administrators have access to all offices.' : 'Pick one or more.'}>
          <div className="checks">
            {ref.offices.map((o) => (
              <label key={o.id} className={`check ${isGlobal ? 'dim' : ''}`}>
                <input type="checkbox" disabled={isGlobal} checked={f.offices.includes(o.code)} onChange={() => toggleOffice(o.code)} /> {o.code} <small className="muted">{o.name}</small>
              </label>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function AddGrant({ profile, onClose, onDone }) {
  const ref = useRefData();
  const [run, busy] = useAction();
  const [roleId, setRoleId] = useState(String(ref.roles[0]?.id || ''));
  const [officeId, setOfficeId] = useState('');
  async function save() {
    const ok = await run(async () => {
      await q(supabase.from('user_office_roles').insert({ user_id: profile.id, role_id: Number(roleId), office_id: officeId ? Number(officeId) : null }));
      return true;
    }, 'Role added');
    if (ok) onDone();
  }
  return (
    <Modal title={`Add role for ${profile.full_name || profile.email}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !roleId} onClick={save}>Add</button></>}>
      <div className="form-grid">
        <Field label="Role">
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {ref.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Office" hint="All offices gives this role everywhere. Use only for administrators.">
          <select value={officeId} onChange={(e) => setOfficeId(e.target.value)}>
            <option value="">All offices</option>
            {ref.offices.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.name}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
