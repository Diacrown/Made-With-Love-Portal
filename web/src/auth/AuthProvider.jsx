import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, q } from '../lib/supabase';

const AuthCtx = createContext(null);
const IDLE_MINUTES = 30;

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [profile, setProfile] = useState(null);
  const [access, setAccess] = useState(null); // null = not loaded yet
  const [loadError, setLoadError] = useState(null);

  // Session lifecycle
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s ?? null);
      if (event === 'PASSWORD_RECOVERY') navigate('/account?recovery=1');
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const userId = session?.user?.id;

  const loadAccess = useCallback(async () => {
    if (!userId) return;
    try {
      const [p, a] = await Promise.all([
        q(supabase.from('profiles').select('id, full_name, email, is_active').eq('id', userId).maybeSingle()),
        q(supabase.rpc('my_access')),
      ]);
      setProfile(p);
      setAccess(a ?? []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e);
      setAccess([]);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) { setProfile(null); setAccess(null); setLoadError(null); return; }
    loadAccess();
  }, [userId, loadAccess]);

  const signOut = useCallback(async (reason) => {
    await supabase.auth.signOut();
    navigate(reason ? `/login?reason=${reason}` : '/login', { replace: true });
  }, [navigate]);

  // Sign out after a period without activity (shared office machines).
  useEffect(() => {
    if (!userId) return;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      if (Date.now() - last > IDLE_MINUTES * 60 * 1000) signOut('idle');
    }, 60 * 1000);
    return () => { clearInterval(t); events.forEach((e) => window.removeEventListener(e, bump)); };
  }, [userId, signOut]);

  const value = useMemo(() => {
    const rows = access ?? [];
    // UI convenience only. The database (RLS + functions) is what actually enforces access.
    const can = (perm, officeId) => rows.some((r) =>
      r.permission_code === perm && (r.office_id === null || officeId === undefined || r.office_id === officeId));
    const isAdmin = rows.some((r) => r.permission_code === 'admin.manage' && r.office_id === null);
    const grants = [];
    const seen = new Set();
    rows.forEach((r) => {
      const k = `${r.role_code}@${r.office_code ?? 'ALL'}`;
      if (!seen.has(k)) { seen.add(k); grants.push({ role: r.role_code, office: r.office_code ?? 'All offices', officeId: r.office_id }); }
    });
    return { session, user: session?.user ?? null, profile, access, loadError, can, isAdmin, grants, signOut, reloadAccess: loadAccess };
  }, [session, profile, access, loadError, signOut, loadAccess]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
