import { useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { mapError } from '../lib/errors';
import { useAuth } from '../auth/AuthProvider';
import { Field } from '../components/ui';

const REASONS = {
  idle: 'You were signed out after 30 minutes without activity.',
  expired: 'Your session ended. Sign in again to continue.',
};

export default function Login() {
  const { session } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(REASONS[params.get('reason')] || null);
  const [mode, setMode] = useState('signin'); // signin | reset

  if (session) return <Navigate to={location.state?.from || '/'} replace />;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/account?recovery=1`,
        });
        if (err) throw err;
        // Same message whether or not the address exists, so the form cannot be used to discover accounts.
        setInfo('If that email belongs to a portal account, a reset link is on its way.');
        setMode('signin');
      }
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-side">
        <div className="brand big"><span className="logo" aria-hidden="true">W</span><div><b>Made With Love</b><small>Mock front end · live Supabase back end</small></div></div>
        <span className="mock-tag">MOCK FRONT END</span>
        <h1>One portal for every office.</h1>
        <p>Jobs, CAD, approvals, production and QC across Diamantra, World Shiner, Diacrown and Diamore. What you see depends on your role and office.</p>
        <ul className="ticks">
          <li>Front offices see their own customers in full.</li>
          <li>Back offices and production see job details and customer aliases only.</li>
          <li>Every change is recorded in the audit log.</li>
          <li>The screens are a mock-up; sign-in, data, security and workflow are the real Supabase back end.</li>
        </ul>
      </div>
      <form className="login-card" onSubmit={submit} noValidate>
        <h2>{mode === 'signin' ? 'Sign in' : 'Reset password'}</h2>
        {info && <div className="note info">{info}</div>}
        {error && <div className="note bad" role="alert"><b>{error.title}.</b> {error.message}</div>}
        <Field label="Work email">
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        {mode === 'signin' && (
          <Field label="Password">
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        <button className="btn primary wide" disabled={busy || !email || (mode === 'signin' && !password)}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Send reset link'}
        </button>
        <button type="button" className="link-btn" onClick={() => { setMode(mode === 'signin' ? 'reset' : 'signin'); setError(null); }}>
          {mode === 'signin' ? 'Forgot your password?' : 'Back to sign in'}
        </button>
        <p className="muted small">Accounts are created by an administrator. There is no public sign-up.</p>
      </form>
    </div>
  );
}
