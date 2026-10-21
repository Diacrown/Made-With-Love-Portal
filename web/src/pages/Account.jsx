import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { Card, Field, PageHead, useAction } from '../components/ui';

export default function Account() {
  const { profile, grants, access } = useAuth();
  const [params] = useSearchParams();
  const recovery = params.get('recovery') === '1';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [formError, setFormError] = useState(null);
  const [run, busy] = useAction();

  const perms = [...new Set((access || []).map((a) => a.permission_code).filter(Boolean))].sort();

  async function changePassword(e) {
    e.preventDefault();
    setFormError(null);
    if (pw.length < 10) return setFormError({ message: 'Use at least 10 characters.', code: '23514' });
    if (pw !== pw2) return setFormError({ message: 'The two passwords do not match.', code: '23514' });
    const ok = await run(async () => {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      return true;
    }, 'Password changed');
    if (ok) { setPw(''); setPw2(''); }
  }

  return (
    <>
      <PageHead crumb="Account" title="My account" sub="Your profile, what your role allows, and your password." />
      <div className="grid2">
        <Card title="Profile">
          <dl className="kv">
            <dt>Name</dt><dd>{profile?.full_name || '—'}</dd>
            <dt>Email</dt><dd>{profile?.email}</dd>
            <dt>Roles</dt><dd>{grants.map((g) => <div key={g.role + g.office}>{g.role} · {g.office}</div>)}</dd>
            <dt>Permissions</dt><dd className="mono small">{perms.join(', ')}</dd>
          </dl>
        </Card>
        <Card title={recovery ? 'Set a new password' : 'Change password'}>
          {recovery && <div className="note info">You opened a password reset link. Choose a new password now.</div>}
          <form onSubmit={changePassword} className="stack">
            <Field label="New password" hint="At least 10 characters.">
              <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
            <Field label="Repeat new password">
              <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </Field>
            {formError && <div className="note bad">{formError.message}</div>}
            <button className="btn primary" disabled={busy || !pw}>Save password</button>
          </form>
        </Card>
      </div>
    </>
  );
}
