// Demo quotes: prices every DEMO job that has an accepted CAD version with the real MWL engine, exactly as
// "New quote from this job" does in the portal (accepted CAD metal weights + stone matrix -> quote), and saves it.
// Run after supabase/seed/demo_data.sql and `npm run sync:pricing`. Re-running replaces the demo quotes.
//
// Usage:  node --env-file=.env scripts/demo-quotes.mjs [--dry-run]
// Env:    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Rates:  the price sheet's backup spot rates and Location FXR (the portal refreshes live rates when a quote is opened).
import { createClient } from '@supabase/supabase-js';
import { createPricer } from '../web/src/pricing/pricing.js';
import { quoteFromJob } from '../web/src/lib/quoteFromJob.js';

const DRY = process.argv.includes('--dry-run');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
if (/^sb_publishable_|anon/.test(SUPABASE_SERVICE_ROLE_KEY)) throw new Error('SUPABASE_SERVICE_ROLE_KEY must be the secret / service_role key');
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const must = async (p, what) => { const { data, error } = await p; if (error) throw new Error(`${what}: ${error.message}`); return data; };

const live = await must(db.from('pricing_models').select('version, model').eq('is_live', true).maybeSingle(), 'Reading the live price data');
if (!live) throw new Error('No price data is live yet. Run "npm run sync:pricing" first.');
const P = createPricer(live.model);
const RATES = { spot: {}, fx: null };   // engine falls back to the sheet's backup spot + Location FXR

const [offices, companies, profiles] = await Promise.all([
  must(db.from('offices').select('id, code, company_id'), 'offices'),
  must(db.from('companies').select('id, code'), 'companies'),
  must(db.from('profiles').select('id, email'), 'profiles'),
]);
const officeById = new Map(offices.map((o) => [o.id, o]));
const companyById = new Map(companies.map((c) => [c.id, c]));
const userId = (email) => profiles.find((p) => (p.email || '').toLowerCase() === email)?.id ?? null;
const FRONT_USER = { AS: 'sydney@worldshiner.com', AB: 'brisbane@worldshiner.com', AM: 'melbourne@worldshiner.com', PL: 'polska@worldshiner.com',
  DM: 'me@niravmehta.com', GS: 'me@niravmehta.com' };

const jobs = await must(db.from('jobs').select('*, customer:customers!inner(alias)').like('customer.alias', 'DEMO-%').order('job_no'), 'Reading demo jobs');
if (!jobs.length) throw new Error('No demo jobs found. Run supabase/seed/demo_data.sql in the SQL Editor first.');

const rows = [];
for (const job of jobs) {
  const version = (await must(db.from('cad_versions').select('*').eq('job_id', job.id).eq('status', 'accepted')
    .order('version_no', { ascending: false }).limit(1), 'cad_versions'))[0];
  if (!version) continue;
  const [metals, stones] = await Promise.all([
    must(db.from('cad_version_metals').select('*').eq('cad_version_id', version.id).order('line_no'), 'cad metals'),
    must(db.from('cad_version_stones').select('*').eq('cad_version_id', version.id).order('line_no'), 'cad stones'),
  ]);
  const office = officeById.get(job.front_office_id);
  const company = companyById.get(office?.company_id);
  const { quote: S, notes } = quoteFromJob(P, { job, customerAlias: job.customer.alias, locationCode: company?.code, version, metals, stones });
  const t = P.totals(S, RATES);
  const { lm, ...totals } = t;
  const author = userId(FRONT_USER[office?.code] || 'itsolutions@worldshiner.com');
  rows.push({
    job_id: job.id, name: S.quoteName || job.job_no, state: { ...S, images: { cad: [], ref: [] }, sel: { cad: 0, ref: 0 } },
    totals, location: S.price.location || null, currency: S.price.currency || null,
    total_usd: t.withDuty || null, total_local: t.final || null, pricing_version: live.version,
    rates: { ...RATES, at: null, note: 'Demo: sheet backup rates' }, created_by: author, updated_by: author,
  });
  console.log(`${job.job_no.padEnd(10)} V${version.version_no}  ${(S.price.location || '?').padEnd(5)} ${String(S.price.currency || '').padEnd(4)}`
    + ` ${t.final ? Math.round(t.final).toLocaleString('en-US').padStart(9) : '        -'}  ${job.title}`);
  notes.forEach((n) => console.log(`             note: ${n}`));
}

if (!rows.length) { console.log('No demo job has an accepted CAD version - nothing to quote.'); process.exit(0); }
if (DRY) { console.log(`\nDry run - ${rows.length} quote(s) not saved.`); process.exit(0); }

await must(db.from('quotes').delete().in('job_id', jobs.map((j) => j.id)), 'Removing old demo quotes');
await must(db.from('quotes').insert(rows), 'Saving demo quotes');
console.log(`\nSaved ${rows.length} demo quote(s) with price data ${live.version}.`);
