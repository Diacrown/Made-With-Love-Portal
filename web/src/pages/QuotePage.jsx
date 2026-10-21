import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase, q } from '../lib/supabase';
import { usePricing } from '../lib/pricingData';
import { useRefData } from '../lib/refdata';
import { useAuth } from '../auth/AuthProvider';
import { signedUrls } from '../lib/files';
import { quoteFromJob } from '../lib/quoteFromJob';
import { freshQuote, normalizeQuote, conformQuote, exportQuote, MODES } from '../pricing/quote.js';
import Calculator from '../components/Calculator';
import QuoteDoc from '../components/QuoteDoc';
import { ErrorScreen, Loading, PageHead, Pill, useAction } from '../components/ui';

/** Strip what must not be stored with the quote (MWL keeps images in the quote; here they live with the job). */
const storable = (S) => ({ ...S, images: { cad: [], ref: [] }, sel: { cad: 0, ref: 0 } });

export default function QuotePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const jobId = params.get('job');
  const navigate = useNavigate();
  const ref = useRefData();
  const { can } = useAuth();
  const pricing = usePricing();
  const [run, busy] = useAction();
  const [S, setS] = useState(null);
  const [meta, setMeta] = useState(null); // { id, revision, job, jobOffices }
  const [notes, setNotes] = useState([]);
  const [loadErr, setLoadErr] = useState(null);
  const [cadImage, setCadImage] = useState(null);
  const [saved, setSaved] = useState(null); // JSON of last saved state

  // load / build the quote once the price data is ready
  useEffect(() => {
    if (!pricing.P || S) return;
    const P = pricing.P;
    (async () => {
      try {
        if (id && id !== 'new') {
          const row = await q(supabase.from('quotes').select('*, job:jobs(id, job_no, title, front_office_id, back_office_id)').eq('id', id).maybeSingle());
          if (!row) { const e = new Error('Quote not found'); e.code = 'PGRST116'; throw e; }
          const st = conformQuote(normalizeQuote(row.state, P), P);
          setS(st); setSaved(JSON.stringify(storable(st)));
          setMeta({ id: row.id, revision: row.revision, job: row.job, pricingVersion: row.pricing_version });
          if (row.job) loadCadImage(row.job.id);
        } else if (jobId) {
          const job = await q(supabase.from('jobs').select('*, customer:customers(alias)').eq('id', jobId).maybeSingle());
          if (!job) { const e = new Error('Job not found'); e.code = 'PGRST116'; throw e; }
          const version = await q(supabase.from('cad_versions').select('*').eq('job_id', job.id).eq('status', 'accepted').order('version_no', { ascending: false }).limit(1).maybeSingle());
          let metals = [], stones = [];
          if (version) {
            [metals, stones] = await Promise.all([
              q(supabase.from('cad_version_metals').select('*').eq('cad_version_id', version.id).order('line_no')),
              q(supabase.from('cad_version_stones').select('*').eq('cad_version_id', version.id).order('line_no')),
            ]);
          }
          const office = ref.officeById[job.front_office_id];
          const company = ref.companies?.find((c) => c.id === office?.company_id);
          const r = quoteFromJob(P, { job, customerAlias: job.customer?.alias, locationCode: company?.code, version, metals, stones });
          setS(r.quote);
          setNotes([version ? `Started from CAD V${version.version_no} (accepted).` : 'This job has no accepted CAD yet: metals and stones are empty.', ...r.notes]);
          setMeta({ id: null, revision: null, job });
          loadCadImage(job.id);
        } else {
          setS(freshQuote(P)); setMeta({ id: null, revision: null, job: null });
        }
      } catch (e) { setLoadErr(e); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricing.P, id, jobId]);

  async function loadCadImage(job) {
    try {
      const f = await q(supabase.from('job_files').select('storage_path, mime_type, cad_version:cad_versions(status)').eq('job_id', job).eq('kind', 'cad').order('created_at', { ascending: false }));
      const pick = f.find((x) => x.cad_version?.status === 'accepted' && /^image\//.test(x.mime_type || '')) || f.find((x) => /^image\//.test(x.mime_type || ''));
      if (pick) setCadImage((await signedUrls([pick.storage_path]))[pick.storage_path] || null);
    } catch { /* image is optional */ }
  }

  const dirty = S && saved !== JSON.stringify(storable(S));
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const jobOffices = meta?.job ? [meta.job.front_office_id, meta.job.back_office_id] : null;
  const canWrite = jobOffices ? jobOffices.some((o) => can('quote.write', o)) : can('quote.write');
  const t = useMemo(() => (S && pricing.P ? pricing.P.totals(S, pricing.live) : null), [S, pricing.P, pricing.live]);

  if (pricing.loading) return <Loading label="Loading price data" />;
  if (pricing.error) return pricing.error.code === 'NO_PRICING'
    ? <ErrorScreen kind="validation" title="No price data yet" message={pricing.error.message} />
    : <ErrorScreen error={pricing.error} />;
  if (loadErr) return <ErrorScreen error={loadErr} />;
  if (!S) return <Loading label="Preparing the quote" />;
  const P = pricing.P;

  const save = () => run(async () => {
    const tt = P.totals(S, pricing.live);
    const { lm, ...totals } = tt;
    const row = await q(supabase.rpc('save_quote', {
      p_id: meta.id, p_expected_revision: meta.revision, p_job_id: meta.job?.id ?? null, p_name: S.quoteName || null,
      p_state: storable(S), p_totals: totals, p_location: S.price.location || null, p_currency: S.price.currency || null,
      p_total_usd: tt.withDuty || null, p_total_local: tt.final || null, p_pricing_version: pricing.version,
      p_rates: { spot: pricing.live?.spot || {}, fx: pricing.live?.fx || null, at: pricing.live?.at || null },
    }));
    setMeta({ ...meta, id: row.id, revision: row.revision });
    setSaved(JSON.stringify(storable(S)));
    if (!meta.id) navigate(`/quotes/${row.id}`, { replace: true });
  }, 'Quote saved');

  const exportJson = () => {
    const out = exportQuote(S, P, pricing.live);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
    a.download = `${(S.quoteName || 'quote').replace(/[^\w\- ]+/g, '')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const print = () => {
    const prev = document.title;
    document.title = (S.quoteName || 'Quotation').replace(/[\\/:*?"<>|]+/g, ' ');
    setTimeout(() => { window.print(); document.title = prev; }, 50);
  };

  return (
    <>
      <PageHead
        crumb={<><Link to="/quotes">Quotes</Link>{meta.job && <> / <Link to={`/jobs/${meta.job.id}`}>{meta.job.job_no}</Link></>}</>}
        title={<input className="title-input" value={S.quoteName} placeholder="Untitled quote" disabled={!canWrite} aria-label="Quote name" onChange={(e) => { const v = e.target.value; setS({ ...S, quoteName: v }); }} />}
        sub={<>{meta.id ? `Revision ${meta.revision}` : 'Not saved yet'} · price data <span className="mono">{pricing.version?.slice(0, 8)}</span>
          {meta.pricingVersion && meta.pricingVersion !== pricing.version && <> · <Pill tone="warn">saved with older price data</Pill></>}
          {dirty && <> · <Pill tone="warn">unsaved changes</Pill></>}</>}
        actions={<>
          <div className="seg" role="group" aria-label="Output mode">
            {MODES.map((m) => <button key={m} type="button" aria-pressed={S.mode === m} onClick={() => setS({ ...S, mode: m })}>{m}</button>)}
          </div>
          <button className="btn" onClick={print}>Print / PDF</button>
          <button className="btn" onClick={exportJson}>Export JSON</button>
          {canWrite && <button className="btn primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>}
        </>} />
      {notes.length > 0 && <div className="note info">{notes.map((n, i) => <div key={i}>{n}</div>)}</div>}
      {!canWrite && <div className="note info">Read only: your role can see this quote but not change it.</div>}
      <Calculator P={P} model={pricing.model} live={pricing.live} rateInfo={pricing.rateInfo} onRefreshRates={pricing.refreshRates}
        S={S} setS={setS} readOnly={!canWrite} />
      {t && <div className="quote-bar" aria-live="polite"><span>{S.price.location || '—'} · gross {`$${Math.round(t.gross).toLocaleString('en-US')}`}</span><b className="mono">{t.final ? `${S.price.currency} ${t.final.toLocaleString('en-US')}` : '—'}</b></div>}
      {createPortal(<div id="print-root"><QuoteDoc P={P} S={S} live={pricing.live} cadImage={cadImage} /></div>, document.body)}
    </>
  );
}
