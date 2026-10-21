import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Refuse to start with a server-side key in the browser: it would bypass every security rule.
function looksLikeServerKey(k) {
  if (!k) return false;
  if (k.startsWith('sb_secret_')) return true;
  try {
    const payload = JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

export const configError = !url || !key
  ? 'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set.'
  : looksLikeServerKey(key)
    ? 'A server-side (service-role / secret) key was configured for the browser. Use the publishable / anon key instead.'
    : null;

export const supabase = configError
  ? null
  : createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

/** Await a supabase query and throw its error, so callers can use try/catch. */
export async function q(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/** Call an Edge Function and surface its JSON error message. */
export async function callFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    let status;
    try {
      status = error.context?.status;
      const j = await error.context.json();
      if (j?.error) message = j.error;
    } catch { /* keep generic message */ }
    const e = new Error(message);
    e.status = status;
    throw e;
  }
  return data;
}
