import { useState } from 'react';
import { supabase, q } from '../../lib/supabase';
import { useLoad, fmtDate } from '../../lib/hooks';
import { Card, Empty, ErrorScreen, Loading, Pill } from '../../components/ui';

const TABLES = ['all', 'jobs', 'job_milestones', 'customers', 'customer_private', 'customer_contacts', 'user_office_roles', 'profiles', 'offices', 'job_stages', 'job_stage_transitions'];
const TONE = { INSERT: 'good', UPDATE: 'info', DELETE: 'bad' };

export default function Audit() {
  const [table, setTable] = useState('all');
  const [open, setOpen] = useState(null);
  const { loading, error, data, reload } = useLoad(async () => {
    let query = supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(200);
    if (table !== 'all') query = query.eq('table_name', table);
    const rows = await q(query);
    const ids = [...new Set(rows.map((r) => r.actor).filter(Boolean))];
    const names = ids.length ? await q(supabase.rpc('staff_names', { p_ids: ids })) : [];
    return { rows, names: Object.fromEntries(names.map((n) => [n.id, n.full_name])) };
  }, [table]);

  return (
    <Card title="Audit log" actions={<>
      <select value={table} onChange={(e) => setTable(e.target.value)} aria-label="Table">{TABLES.map((t) => <option key={t} value={t}>{t === 'all' ? 'All tables' : t}</option>)}</select>
      <button className="btn" onClick={reload}>Refresh</button></>}>
      <p className="muted small">Latest 200 changes. Customer personal data is recorded as "changed" only, never the values.</p>
      {loading && !data ? <Loading /> : error ? <ErrorScreen error={error} onRetry={reload} /> : data.rows.length === 0 ? <Empty>No changes recorded.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Table</th><th>Row</th><th>Change</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="muted">{fmtDate(r.at)}</td>
                  <td>{r.actor ? data.names[r.actor] || 'Unknown user' : 'System / script'}</td>
                  <td><Pill tone={TONE[r.action]}>{r.action}</Pill></td>
                  <td className="mono">{r.table_name}</td>
                  <td className="mono">{r.row_id}</td>
                  <td>
                    <span className="mono small">{r.action === 'UPDATE' ? Object.keys(r.changed || {}).join(', ') : 'whole row'}</span>{' '}
                    <button className="link-btn" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Show'}</button>
                    {open === r.id && <pre className="json">{JSON.stringify(r.changed, null, 2)}</pre>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
