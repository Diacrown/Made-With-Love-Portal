import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, q } from '../lib/supabase';
import { useLoad, fmtDate } from '../lib/hooks';
import { useLive } from '../lib/live';
import { money } from '../pricing/util.js';
import { useAuth } from '../auth/AuthProvider';
import { Empty, ErrorScreen, Loading, PageHead } from '../components/ui';

export default function Quotes() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const { loading, error, data, reload } = useLoad(() =>
    q(supabase.from('quotes').select('id, name, location, currency, total_local, total_usd, revision, updated_at, job:jobs(id, job_no)').order('updated_at', { ascending: false }).limit(300)), []);
  useLive(['quotes'], () => reload({ silent: true }));
  if (loading) return <Loading />;
  if (error) return <ErrorScreen error={error} onRetry={reload} />;
  const s = search.trim().toLowerCase();
  const rows = data.filter((r) => !s || r.name.toLowerCase().includes(s) || (r.job?.job_no || '').toLowerCase().includes(s));
  return (
    <>
      <PageHead crumb="Quotes" title="Quotes" sub="Quotes on your offices' jobs, and your own scratch quotes. Prices come from the MWL price data."
        actions={can('quote.write') && <Link className="btn primary" to="/quotes/new">New quote</Link>} />
      <div className="toolbar"><input className="search" placeholder="Search name or job number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search quotes" /></div>
      {rows.length === 0 ? <Empty>No quotes yet.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Quote</th><th>Job</th><th>Location</th><th className="r">USD incl. duty</th><th className="r">Total</th><th>Rev</th><th>Updated</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/quotes/${r.id}`}>{r.name}</Link></td>
                  <td>{r.job ? <Link className="mono" to={`/jobs/${r.job.id}`}>{r.job.job_no}</Link> : <small className="muted">scratch</small>}</td>
                  <td className="mono">{r.location || '—'}</td>
                  <td className="r mono">{r.total_usd ? `$${Number(r.total_usd).toLocaleString('en-US')}` : '—'}</td>
                  <td className="r mono">{r.total_local ? money(r.currency, Number(r.total_local)) : '—'}</td>
                  <td>{r.revision}</td>
                  <td className="muted">{fmtDate(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Quotes tab on a job. */
export function JobQuotes({ job }) {
  const { can } = useAuth();
  const canWrite = can('quote.write', job.front_office_id) || can('quote.write', job.back_office_id);
  const { loading, error, data, reload } = useLoad(() =>
    q(supabase.from('quotes').select('id, name, location, currency, total_local, total_usd, revision, updated_at').eq('job_id', job.id).order('updated_at', { ascending: false })), [job.id]);
  useLive([{ table: 'quotes', filter: `job_id=eq.${job.id}` }], () => reload({ silent: true }));
  if (loading) return <Loading />;
  if (error) return <ErrorScreen error={error} onRetry={reload} />;
  return (
    <section className="card">
      <header className="card-hd"><h2>Quotes ({data.length})</h2>{canWrite && <div className="card-actions"><Link className="btn primary sm" to={`/quotes/new?job=${job.id}`}>New quote from this job</Link></div>}</header>
      <div className="card-bd">
        {data.length === 0 ? <Empty>No quotes yet. A new quote starts from the job and its accepted CAD (metal weights and stones).</Empty> : (
          <table className="table">
            <thead><tr><th>Quote</th><th>Location</th><th className="r">USD incl. duty</th><th className="r">Total</th><th>Rev</th><th>Updated</th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id}><td><Link to={`/quotes/${r.id}`}>{r.name}</Link></td><td className="mono">{r.location || '—'}</td>
                <td className="r mono">{r.total_usd ? `$${Number(r.total_usd).toLocaleString('en-US')}` : '—'}</td>
                <td className="r mono">{r.total_local ? money(r.currency, Number(r.total_local)) : '—'}</td><td>{r.revision}</td><td className="muted">{fmtDate(r.updated_at)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </section>
  );
}
