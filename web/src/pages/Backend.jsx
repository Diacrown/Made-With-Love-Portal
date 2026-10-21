// "Back end (live)": shows a stakeholder that the screens run on a real Supabase back end.
// Everything here is a live call; the security probes ask the database to do things it must refuse
// and show the database's own answer. Probes never change data when the rules work.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, q, callFunction } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { useRefData, statusText } from '../lib/refdata';
import { fmtDate } from '../lib/hooks';
import { Card, PageHead, Pill } from '../components/ui';

// Database design straight from the migration files (bundled at build time).
const MIGRATIONS = import.meta.glob('../../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true });

const TABLES = [
  ['companies', 'Companies'], ['offices', 'Offices'], ['customers', 'Customers (alias)'], ['customer_private', 'Customer personal details'],
  ['jobs', 'Jobs'], ['job_stage_history', 'Stage / status history'], ['cad_versions', 'CAD versions'], ['job_files', 'Files'],
  ['quotes', 'Quotes'], ['pricing_models', 'Price data versions'], ['audit_log', 'Audit log entries'], ['profiles', 'User profiles'],
];

const ms = (t0) => Math.round(performance.now() - t0);

export default function Backend() {
  const { user, session, grants, can, isAdmin } = useAuth();
  const ref = useRefData();
  const host = useMemo(() => { try { return new URL(import.meta.env.VITE_SUPABASE_URL).host; } catch { return '—'; } }, []);
  const [ping, setPing] = useState(null);
  const [counts, setCounts] = useState(null);
  const [probes, setProbes] = useState(null);
  const [activity, setActivity] = useState(null);
  const [running, setRunning] = useState(false);

  const loadPing = useCallback(async () => {
    const t0 = performance.now();
    const { error } = await supabase.from('companies').select('id').limit(1);
    setPing({ ok: !error, ms: ms(t0), at: new Date(), error: error?.message });
  }, []);

  const loadCounts = useCallback(async () => {
    const rows = await Promise.all(TABLES.map(async ([t, label]) => {
      const t0 = performance.now();
      const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
      return { t, label, count, error: error ? `${error.code || ''} ${error.message}` : null, ms: ms(t0) };
    }));
    setCounts(rows);
  }, []);

  const loadActivity = useCallback(async () => {
    const { data } = await supabase.from('job_stage_history')
      .select('id, changed_at, from_stage_id, to_stage_id, from_status, to_status, note, job:jobs(id, job_no)')
      .order('changed_at', { ascending: false }).limit(10);
    setActivity(data || []);
  }, []);

  useEffect(() => {
    loadPing(); loadCounts(); loadActivity();
    const t = setInterval(() => { loadPing(); loadActivity(); }, 15000);   // live refresh
    return () => clearInterval(t);
  }, [loadPing, loadCounts, loadActivity]);

  async function runProbes() {
    setRunning(true);
    const out = [];
    const probe = async (name, expect, fn, judge) => {
      const t0 = performance.now();
      let res;
      try { res = await fn(); } catch (e) { res = { error: e }; }
      const verdict = judge(res);
      out.push({ name, expect, ...verdict, ms: ms(t0) });
      setProbes([...out]);
    };
    const refused = (r) => (r.error
      ? { pass: true, answer: `Refused: ${r.error.message}${r.error.code ? ` (${r.error.code})` : ''}` }
      : { pass: false, answer: 'Allowed - this should not happen' });

    await probe('Read the job-number counters directly', 'Refused: internal table, only the numbering function may use it',
      () => supabase.from('counters').select('*').limit(1), refused);
    await probe('Publish fake price data', 'Refused: price data is published only by the checked sync script',
      () => supabase.from('pricing_models').insert({ version: 'probe', model: {} }), refused);
    await probe('Write the error log as another user', 'Refused: a user can only log their own errors',
      () => supabase.from('error_log').insert({ user_id: '00000000-0000-0000-0000-000000000000', route: '/backend-probe', message: 'probe' }), refused);
    await probe('Move a job that you cannot see', 'Refused by the workflow function',
      () => supabase.rpc('advance_job', { p_job: -1, p_to: 'intake' }), refused);
    await probe('Change a job\'s stage by editing the row', 'Refused: stages change only through the workflow',
      async () => {
        const { data: list } = await supabase.from('jobs').select('id, stage_id').order('id').limit(1);
        const j = list && list[0];
        if (!j) return { error: { message: 'no job visible to test with', code: 'skip' }, skip: true };
        const other = ref.stages.find((s) => s.id !== j.stage_id);
        const r = await supabase.from('jobs').update({ stage_id: other.id }).eq('id', j.id).select('id');
        if (!r.error && (!r.data || r.data.length === 0)) return { error: { message: 'no rows changed (row-level security)', code: 'RLS' } };
        return r;
      }, (r) => (r.skip ? { pass: null, answer: r.error.message } : refused(r)));
    await probe('Read the audit log', isAdmin ? 'Allowed: you are a global administrator' : 'Hidden: only administrators see it',
      () => supabase.from('audit_log').select('id', { count: 'exact', head: true }),
      (r) => (r.error ? { pass: false, answer: r.error.message } : isAdmin
        ? { pass: true, answer: `Allowed: ${r.count} entries` } : { pass: r.count === 0, answer: `${r.count} entries visible` }));
    await probe('Read customer personal details', can('customer_private.read') ? 'Allowed for your own office\'s customers' : 'Hidden for your role (alias only)',
      async () => {
        const [a, b] = await Promise.all([
          supabase.from('customers').select('id', { count: 'exact', head: true }),
          supabase.from('customer_private').select('customer_id', { count: 'exact', head: true }),
        ]);
        return { a: a.count, b: b.count, error: a.error || b.error };
      },
      (r) => (r.error ? { pass: false, answer: r.error.message } : { pass: can('customer_private.read') ? true : r.b === 0, answer: `${r.a} customers visible, details for ${r.b}` }));
    if (can('quote.read')) {
      await probe('Live rates Edge Function', 'Answers with metal spot and FX rates',
        () => callFunction('rates', {}).then((d) => ({ d })),
        (r) => (r.error ? { pass: false, answer: r.error.message } : { pass: true, answer: `${Object.keys(r.d.spot || {}).join(', ') || 'no live spot'} · FX ${r.d.fx?.src || 'backup'}${r.d.cached ? ' · cached' : ''}${r.d.stale ? ' · stale' : ''}` }));
    }
    setRunning(false);
  }

  const design = useMemo(() => Object.entries(MIGRATIONS).sort().map(([path, sql]) => {
    const n = (re) => (sql.match(re) || []).length;
    return {
      file: path.split('/').pop(), tables: n(/create table/gi), policies: n(/create policy/gi), functions: n(/create (or replace )?function/gi), triggers: n(/create trigger/gi),
      title: (sql.match(/^--\s*(.+)$/m) || [])[1] || '',
    };
  }), []);
  const totals = design.reduce((a, d) => ({ tables: a.tables + d.tables, policies: a.policies + d.policies, functions: a.functions + d.functions, triggers: a.triggers + d.triggers }), { tables: 0, policies: 0, functions: 0, triggers: 0 });
  const expiresIn = session?.expires_at ? Math.max(0, Math.round((session.expires_at * 1000 - Date.now()) / 60000)) : null;

  return (
    <>
      <PageHead crumb="Back end (live)" title="Supabase back end, live"
        sub="Every figure on this page is fetched from Supabase as you watch. What you can see and do is decided by the database, not by this screen." />

      <div className="stats">
        <div className="stat"><small>Supabase project</small><b className="mono small-b">{host}</b></div>
        <div className="stat"><small>Round trip</small><b>{ping ? (ping.ok ? `${ping.ms} ms` : 'down') : '…'}</b><small className="muted">{ping ? `checked ${ping.at.toLocaleTimeString()}` : ''}</small></div>
        <div className="stat"><small>Signed in as</small><b className="small-b">{user?.email}</b><small className="muted">{grants.map((g) => `${g.role} · ${g.office}`).join(', ')}</small></div>
        <div className="stat"><small>Session token</small><b>{expiresIn != null ? `${expiresIn} min` : '—'}</b><small className="muted">refreshes automatically</small></div>
      </div>

      <div className="grid2">
        <Card title="Data you can see (row-level security)" actions={<button className="btn sm" onClick={loadCounts}>Refresh</button>}>
          <p className="muted small">Same tables, different numbers per role: the database filters rows before they leave Supabase. Sign in as another role to compare.</p>
          <table className="table">
            <thead><tr><th>Table</th><th className="r">Rows visible to you</th><th className="r">Time</th></tr></thead>
            <tbody>{(counts || TABLES.map(([t, label]) => ({ t, label }))).map((c) => (
              <tr key={c.t}><td>{c.label} <small className="muted mono">{c.t}</small></td>
                <td className="r mono">{c.error ? <span className="locked" title={c.error}>🔒 no access</span> : c.count ?? '…'}</td>
                <td className="r muted small">{c.ms != null ? `${c.ms} ms` : ''}</td></tr>
            ))}</tbody>
          </table>
        </Card>

        <Card title="Security probes" actions={<button className="btn primary sm" disabled={running} onClick={runProbes}>{running ? 'Running…' : probes ? 'Run again' : 'Run probes'}</button>}>
          <p className="muted small">Each probe asks Supabase to do something it must refuse. The answer is the database's own message. When the rules work, nothing is changed.</p>
          {!probes ? <p className="muted">Press <b>Run probes</b>.</p> : (
            <ul className="probes">
              {probes.map((p, i) => (
                <li key={i}>
                  <span className={`probe-mark ${p.pass === true ? 'ok' : p.pass === false ? 'bad' : ''}`}>{p.pass === true ? '✓' : p.pass === false ? '✗' : '–'}</span>
                  <div><b>{p.name}</b><div className="small muted">Expected: {p.expect}</div><div className="small mono">{p.answer}</div></div>
                  <small className="muted">{p.ms} ms</small>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Latest workflow activity (refreshes every 15 s)">
        {!activity ? <p className="muted">Loading…</p> : activity.length === 0 ? <p className="muted">No activity visible to you yet.</p> : (
          <table className="table">
            <thead><tr><th>When</th><th>Job</th><th>Change</th><th>Note</th></tr></thead>
            <tbody>{activity.map((h) => (
              <tr key={h.id}>
                <td className="muted">{fmtDate(h.changed_at)}</td>
                <td>{h.job ? <Link className="mono" to={`/jobs/${h.job.id}`}>{h.job.job_no}</Link> : '—'}</td>
                <td>{h.from_stage_id === h.to_stage_id
                  ? <>Status <span className="mono">{h.from_status || '—'}</span> → <span className="mono">{h.to_status || '—'}</span> <small className="muted">{statusText(ref.statusByCode[h.to_status], false)}</small></>
                  : <>{h.from_stage_id ? ref.stageById[h.from_stage_id]?.name : 'Created'} → <b>{ref.stageById[h.to_stage_id]?.name}</b></>}</td>
                <td className="small">{h.note || ''}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>

      <Card title={`Database design: ${design.length} migrations · ${totals.tables} tables · ${totals.policies} security policies · ${totals.functions} functions · ${totals.triggers} triggers`}>
        <p className="muted small">Read from the migration files in the GitHub repository; Supabase applies them in this order.</p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Migration</th><th>What it does</th><th className="r">Tables</th><th className="r">Policies</th><th className="r">Functions</th><th className="r">Triggers</th></tr></thead>
            <tbody>{design.map((d) => (
              <tr key={d.file}><td className="mono small">{d.file}</td><td className="small">{d.title}</td><td className="r">{d.tables}</td><td className="r">{d.policies}</td><td className="r">{d.functions}</td><td className="r">{d.triggers}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
      <p className="muted small">Mock front end · <Pill tone="brand">React + Vite</Pill> talking straight to <Pill tone="good">Supabase</Pill> (Postgres, Auth, Storage, Edge Functions) with the browser-safe publishable key only.</p>
    </>
  );
}
