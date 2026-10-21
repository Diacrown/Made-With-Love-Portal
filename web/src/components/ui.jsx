import { Component, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { mapError, logError } from '../lib/errors';
import { useAuth } from '../auth/AuthProvider';

export function Loading({ label = 'Loading' }) {
  return <div className="loading" role="status"><span className="spinner" aria-hidden="true" />{label}…</div>;
}

const STAGE_TONE = {
  intake: '', cad_design: 'plum', customer_review: 'warn', approved: 'good', production: 'info',
  qc_ready: 'brand', ready_to_ship: 'brand', dispatched: 'info', received: 'good', local_finishing: 'plum', closed: 'muted',
};
export function StagePill({ stage }) {
  if (!stage) return null;
  return <span className={`pill ${STAGE_TONE[stage.code] || ''}`}>{stage.name}</span>;
}

export function Pill({ tone = '', children }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-hd">
          <h2>{title}</h2>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className="card-bd">{children}</div>
    </section>
  );
}

export function PageHead({ crumb, title, sub, actions }) {
  return (
    <div className="page-head">
      <div>
        {crumb && <div className="crumb">{crumb}</div>}
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

const SCREEN = {
  forbidden: { code: '403', icon: '⛔' },
  notfound: { code: '404', icon: '🔍' },
  auth: { code: '401', icon: '🔒' },
  network: { code: 'OFFLINE', icon: '📡' },
  server: { code: '500', icon: '⚠' },
  validation: { code: '400', icon: '⚠' },
  conflict: { code: '409', icon: '⚠' },
  blocked: { code: '409', icon: '⏸' },
};

/** Full-page error screen. Pass either an error object or an explicit kind/title/message. */
export function ErrorScreen({ error, kind, title, message, onRetry }) {
  const m = error ? mapError(error) : { kind, title, message };
  const s = SCREEN[m.kind] || SCREEN.server;
  const { signOut } = useAuth() || {};
  return (
    <div className="error-screen" role="alert">
      <div className="error-code">{s.icon} {s.code}</div>
      <h1>{m.title}</h1>
      <p>{m.message}</p>
      <div className="row gap">
        {m.kind === 'auth' && signOut && <button className="btn primary" onClick={() => signOut('expired')}>Sign in again</button>}
        {onRetry && m.kind !== 'auth' && <button className="btn primary" onClick={onRetry}>Try again</button>}
        <Link className="btn" to="/">Go to overview</Link>
      </div>
    </div>
  );
}

/** Inline error box for a card or form. */
export function ErrorNote({ error }) {
  if (!error) return null;
  const m = mapError(error);
  return <div className={`note ${m.kind === 'blocked' ? 'warn' : 'bad'}`} role="alert"><b>{m.title}.</b> {m.message}</div>;
}

export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { logError(error); }
  render() {
    if (this.state.error) {
      return (
        <div className="error-screen" role="alert">
          <div className="error-code">⚠ 500</div>
          <h1>This screen crashed</h1>
          <p>The problem has been logged for the administrators.</p>
          <button className="btn primary" onClick={() => { this.setState({ error: null }); window.location.assign('/'); }}>Back to overview</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------- toasts
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, tone = 'good') => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Wrap an async action: busy state, mapped error toast, logging. */
export function useAction() {
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, okText) => {
    setBusy(true);
    try {
      const r = await fn();
      if (okText) toast(okText, 'good');
      return r;
    } catch (e) {
      const m = mapError(e);
      if (m.kind === 'auth') { navigate('/login?reason=expired'); return undefined; }
      if (m.kind === 'server') logError(e);
      toast(`${m.title}: ${m.message}`, m.kind === 'blocked' ? 'warn' : 'bad');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast, navigate]);
  return [run, busy];
}

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="card-hd"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close">×</button></header>
        <div className="card-bd">{children}</div>
        {footer && <footer className="modal-ft">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}
