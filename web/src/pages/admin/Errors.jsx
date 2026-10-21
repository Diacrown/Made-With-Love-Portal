import { supabase, q } from '../../lib/supabase';
import { useLoad, fmtDate } from '../../lib/hooks';
import { Card, Empty, ErrorScreen, Loading } from '../../components/ui';

export default function Errors() {
  const { loading, error, data, reload } = useLoad(async () => {
    const rows = await q(supabase.from('error_log').select('*').order('at', { ascending: false }).limit(200));
    const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
    const names = ids.length ? await q(supabase.rpc('staff_names', { p_ids: ids })) : [];
    return { rows, names: Object.fromEntries(names.map((n) => [n.id, n.full_name])) };
  }, []);

  return (
    <Card title="Error log" actions={<button className="btn" onClick={reload}>Refresh</button>}>
      <p className="muted small">Unexpected errors users hit in the portal (latest 200). Expected outcomes such as "not allowed" are shown to the user but not logged here unless they look like a fault.</p>
      {loading && !data ? <Loading /> : error ? <ErrorScreen error={error} onRetry={reload} /> : data.rows.length === 0 ? <Empty>No errors logged.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>User</th><th>Screen</th><th>Code</th><th>Message</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="muted">{fmtDate(r.at)}</td>
                  <td>{data.names[r.user_id] || '—'}</td>
                  <td className="mono small">{r.route}</td>
                  <td className="mono">{r.code}</td>
                  <td>{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
