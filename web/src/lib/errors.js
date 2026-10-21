import { supabase } from './supabase';

// Turn any Supabase / Postgres / network error into something a person can act on.
// kind: auth | forbidden | notfound | conflict | validation | blocked | network | server
export function mapError(err) {
  if (!err) return null;
  const code = err.code || '';
  const status = err.status;
  const msg = String(err.message || err.error_description || err);

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { kind: 'network', title: 'You are offline', message: 'Check your internet connection and try again.' };
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return { kind: 'network', title: 'Cannot reach the server', message: 'The portal could not contact the database. Try again in a moment.' };
  }
  if (status === 401 || code === 'PGRST301' || code === 'PGRST303' || /JWT expired|invalid JWT|Session expired/i.test(msg)) {
    return { kind: 'auth', title: 'Your session has ended', message: 'Sign in again to continue.' };
  }
  if (/Invalid login credentials/i.test(msg)) {
    return { kind: 'auth', title: 'Sign-in failed', message: 'The email or password is incorrect.' };
  }
  if (status === 429 || /rate limit|too many/i.test(msg)) {
    return { kind: 'validation', title: 'Too many attempts', message: 'Wait a minute before trying again.' };
  }
  if (/banned/i.test(msg)) {
    return { kind: 'forbidden', title: 'Account deactivated', message: 'Your account has been deactivated. Contact an administrator.' };
  }
  if (code === '42501' || status === 403 || /row-level security|permission denied|not allowed|Only administrators/i.test(msg)) {
    return { kind: 'forbidden', title: 'Not allowed', message: friendlyRaise(msg) || 'Your role does not allow this action.' };
  }
  if (code === 'PGRST116' || status === 404 || /Job not found/i.test(msg)) {
    return { kind: 'notfound', title: 'Not found', message: 'It does not exist, or your role cannot see it.' };
  }
  if (code === '23505' || status === 409) {
    return { kind: 'conflict', title: 'Already exists', message: /already exists/i.test(msg) ? msg : 'A record with the same code or name already exists.' };
  }
  if (code === '23503') {
    return { kind: 'validation', title: 'Linked record problem', message: 'This refers to a record that does not exist, or it is still used elsewhere.' };
  }
  if (['23502', '23514', '22P02', '22001'].includes(code) || status === 400) {
    return { kind: 'validation', title: 'Check the form', message: status === 400 && msg ? msg : 'Some values are missing or not in the expected format.' };
  }
  if (code === 'P0001') {
    if (/^Blocked/i.test(msg)) return { kind: 'blocked', title: 'Not ready yet', message: friendlyRaise(msg) };
    return { kind: 'validation', title: 'Cannot do that', message: friendlyRaise(msg) };
  }
  return { kind: 'server', title: 'Something went wrong', message: 'The server could not complete the request. It has been logged.' };
}

const MILESTONE_WORDS = {
  cad_accepted: 'the CAD version has not been accepted',
  customer_approved: 'the customer approval has not been recorded',
  production_released: 'the PO has not been issued',
  qc_passed: 'no QC pass is recorded',
  cost_approved: 'the cost has not been approved',
};

function friendlyRaise(msg) {
  const m = /Blocked: (\w+) is not recorded/.exec(msg);
  if (m) return `Blocked: ${MILESTONE_WORDS[m[1]] || m[1]}.`;
  return msg.replace(/^ERROR:\s*/, '');
}

// Best-effort: record unexpected errors so admins see them in Admin -> Errors. Never throws.
export async function logError(err, route) {
  try {
    const mapped = mapError(err);
    // Only genuine faults. "Not allowed", "not found", validation etc. are expected outcomes.
    if (!supabase || mapped?.kind !== 'server') return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    await supabase.from('error_log').insert({
      user_id: data.session.user.id,
      route: route || (typeof location !== 'undefined' ? location.pathname : null),
      code: String(err?.code || err?.status || mapped?.kind || ''),
      message: String(err?.message || err).slice(0, 1000),
      detail: { kind: mapped?.kind, hint: err?.hint || null, details: err?.details || null },
    });
  } catch { /* logging must never break the app */ }
}
