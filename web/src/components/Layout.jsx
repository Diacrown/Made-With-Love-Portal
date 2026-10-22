import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { supabase, q } from '../lib/supabase';
import { useLive, useLiveStatus } from '../lib/live';
import { statusText } from '../lib/refdata';
import { useAuth } from '../auth/AuthProvider';
import { RefDataProvider, useRefData } from '../lib/refdata';
import { ErrorScreen, Loading, useToast } from './ui';

const ROLE_LABEL = {
  admin: 'Admin', office_admin: 'Office admin', front_office: 'Front office',
  back_office: 'Back office', qc: 'QC', cad: 'CAD',
};

function Tabs() {
  const { isAdmin, can } = useAuth();
  const tabs = [
    ['/', 'overview', 'Overview'],
    ['/jobs', 'jobs', 'Jobs'],
    ['/customers', 'customers', 'Customers'],
    ...(can('quote.read') ? [['/quotes', 'quotes', 'Quotes']] : []),
    ['/workflow', 'workflow', 'How jobs move'],
    ['/backend', 'supabase', 'Back end (live)'],
    ['/account', 'account', 'My account'],
  ];
  if (isAdmin) tabs.push(['/admin', 'admin', 'Admin']);
  return (
    <nav className="tabs" aria-label="Sections">
      {tabs.map(([to, file, label]) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          <span className="tab-file">{file}</span>{label}
        </NavLink>
      ))}
    </nav>
  );
}

function LiveBadge() {
  const st = useLiveStatus();
  const label = st === 'live' ? 'Live' : st === 'offline' ? 'Offline' : 'Connecting';
  return <span className={`live-badge ${st}`} title="Screens refresh by themselves when someone else changes the data (Supabase Realtime)">{label}</span>;
}

/** Toast when someone else moves a job you can see (RLS decides which events arrive). */
function ActivityToasts({ rd: ref }) {
  const { user, can } = useAuth();
  const toast = useToast();
  useLive([{ table: 'job_stage_history', event: 'INSERT' }], async (p) => {
    const h = p.new;
    if (!h || !h.changed_by || h.changed_by === user?.id || ref.loading) return;
    try {
      const [job] = await q(supabase.from('jobs').select('id, job_no').eq('id', h.job_id).limit(1));
      if (!job) return;
      const names = await q(supabase.rpc('staff_names', { p_ids: [h.changed_by] }));
      const what = h.from_stage_id !== h.to_stage_id
        ? `moved to ${ref.stageById[h.to_stage_id]?.name || 'a new stage'}`
        : statusText(ref.statusByCode[h.to_status], false) || 'status changed';
      toast(<><Link to={`/jobs/${job.id}`} className="mono">{job.job_no}</Link> {what} · by {names[0]?.full_name || 'a colleague'}</>, 'good');
    } catch { /* a toast is optional */ }
  }, { debounce: 0, enabled: !!user && can('job.read') });
  return null;
}

function Shell() {
  const { profile, grants, signOut } = useAuth();
  const ref = useRefData();
  return (
    <div className="app">
      <div className="mock-ribbon" role="note">
        <b>MOCK FRONT END</b> · screens are a working mock-up; the data, security rules and workflow run live on the Supabase back end ·{' '}
        <NavLink to="/backend">see the back end</NavLink>
      </div>
      <header className="topbar">
        <div className="brand"><span className="logo" aria-hidden="true">W</span><div><b>Made With Love · Mock Front End</b><small>Live Supabase back end</small></div></div>
        <div className="who">
          <div className="who-text">
            <b>{profile?.full_name || profile?.email}</b>
            <small>{grants.map((g) => `${ROLE_LABEL[g.role] || g.role} · ${g.office}`).join('  |  ')}</small>
          </div>
          <LiveBadge />
          <button className="btn" onClick={() => signOut()}>Sign out</button>
        </div>
      </header>
      {!ref.loading && !ref.error && <ActivityToasts rd={ref} />}
      <Tabs />
      <main className="content">
        {ref.loading ? <Loading /> : ref.error ? <ErrorScreen error={ref.error} onRetry={ref.reload} /> : <Outlet />}
      </main>
    </div>
  );
}

/** Only signed-in, active users with at least one role get past here. */
export function RequireAuth() {
  const { session, profile, access, loadError, signOut } = useAuth();
  const location = useLocation();
  if (session === undefined) return <div className="center"><Loading label="Checking session" /></div>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (loadError) return <div className="center"><ErrorScreen error={loadError} /></div>;
  if (access === null) return <div className="center"><Loading label="Loading your access" /></div>;
  if (profile && !profile.is_active) {
    return <div className="center"><ErrorScreen kind="forbidden" title="Account deactivated" message="Your account has been deactivated. Contact an administrator." /></div>;
  }
  if (access.length === 0) {
    return (
      <div className="center">
        <div className="error-screen">
          <div className="error-code">🔒 NO ROLE</div>
          <h1>No access assigned yet</h1>
          <p>You are signed in, but no role has been given to your account. Ask an administrator to assign one.</p>
          <button className="btn" onClick={() => signOut()}>Sign out</button>
        </div>
      </div>
    );
  }
  return <RefDataProvider><Shell /></RefDataProvider>;
}

/** Screen-level permission gate (the database enforces the same rule). */
export function RequirePerm({ perm, admin, children }) {
  const { can, isAdmin } = useAuth();
  const ok = admin ? isAdmin : can(perm);
  if (!ok) return <ErrorScreen kind="forbidden" title="This area is not for your role" message="Your role does not include access to this screen. If you need it, ask an administrator." />;
  return children;
}
