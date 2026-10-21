import { useState } from 'react';
import { supabase, q } from '../../lib/supabase';
import { useLoad, fmtDate } from '../../lib/hooks';
import { resetPricingCache } from '../../lib/pricingData';
import { Card, Empty, ErrorScreen, Loading, Pill, useAction } from '../../components/ui';

export default function Pricing() {
  const [run, busy] = useAction();
  const [show, setShow] = useState(null);
  const { loading, error, data, reload } = useLoad(() =>
    q(supabase.from('pricing_models').select('id, version, is_live, published_at, source, note, warnings').order('published_at', { ascending: false }).limit(50)), []);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorScreen error={error} onRetry={reload} />;
  const makeLive = (r) => run(async () => { await q(supabase.rpc('set_live_pricing_model', { p_id: r.id })); resetPricingCache(); await reload(); }, `Version ${r.version.slice(0, 8)} is now live`);
  return (
    <Card title="Price data versions" actions={<small className="muted">Published from the master price sheet with <span className="mono">npm run sync:pricing</span>. A sheet with errors is never published.</small>}>
      {data.length === 0 ? <Empty>No price data published yet. Run <span className="mono">npm run sync:pricing</span> (see docs/quotes.md).</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Version</th><th>Published</th><th>Source</th><th>Note</th><th>Warnings</th><th /></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.version.slice(0, 12)} {r.is_live && <Pill tone="good">live</Pill>}</td>
                  <td className="muted">{fmtDate(r.published_at)}</td>
                  <td className="small">{r.source?.kind} {r.source?.id ? <span className="mono">{String(r.source.id).slice(0, 14)}</span> : ''}</td>
                  <td>{r.note || '—'}</td>
                  <td>{r.warnings?.length ? <button className="link-btn" onClick={() => setShow(show === r.id ? null : r.id)}>{r.warnings.length} warning(s)</button> : '—'}
                    {show === r.id && <ul className="small warn-list">{r.warnings.map((w, i) => <li key={i}><b>{w.where}</b> {w.message}</li>)}</ul>}</td>
                  <td>{!r.is_live && <button className="btn sm" disabled={busy} onClick={() => makeLive(r)}>Make live</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
