// Publish the master PRICE sheet (Location, Master, Size, StonePrice, ...) as the live pricing model.
// Uses the MWL checker (web/src/pricing/sheet-model.js): a sheet with errors is never published.
//
// Source (first match wins):
//   --file tabs.json       { TabName: [[header...], [cells...]] }  (e.g. an export from the Unified Quote Calculator)
//   PRICE_SHEET_ID         master price sheet shared "Anyone with the link: Viewer" (each tab fetched by its gid)
//
// Usage:  node --env-file=.env scripts/sync-pricing.mjs [--file tabs.json] [--dry-run] [--note "why"]
// Env:    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (not needed for --dry-run)
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { parseCSV } from '../web/src/pricing/util.js';
import { TABS, OPTIONAL_TABS, DEFAULT_SHEET_ID } from '../web/src/pricing/sheet-config.js';
import { buildModel, formatReport } from '../web/src/pricing/sheet-model.js';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const file = arg('--file');
const note = arg('--note') || null;
const sheetId = process.env.PRICE_SHEET_ID || DEFAULT_SHEET_ID;

async function fetchTabs() {
  const tabs = {};
  for (const [name, gid] of Object.entries(TABS)) {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
    const res = await fetch(url);
    if (!res.ok) {
      if (OPTIONAL_TABS.includes(name)) { tabs[name] = []; continue; }
      throw new Error(`Tab ${name} (gid ${gid}): HTTP ${res.status}. Is the price sheet shared by link?`);
    }
    tabs[name] = parseCSV(await res.text());
  }
  return tabs;
}

const tabs = file ? JSON.parse(await readFile(file, 'utf8')) : await fetchTabs();
const source = file ? { kind: 'file', id: file.split('/').pop(), fetchedAt: new Date().toISOString() } : { kind: 'google-sheet', id: sheetId, fetchedAt: new Date().toISOString() };
console.log(`Read ${Object.entries(tabs).map(([k, v]) => `${k}=${Math.max(0, (v || []).length - 1)}`).join(', ')}`);

let db = null;
let previous = null;
if (!DRY) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or use --dry-run)');
  db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await db.from('pricing_models').select('id, version, model').eq('is_live', true).maybeSingle();
  if (error) throw new Error(`Reading the live price data failed: ${error.message}`);
  previous = data;
}

const built = buildModel(tabs, { previous: previous?.model || null, source });
console.log('\n' + formatReport(built.report));
if (!built.ok) {
  console.error(`\nNOT published: ${built.report.errors.length} error(s). Fix them in the sheet and run again.`);
  process.exit(1);
}
const m = built.model;
console.log(`\nModel ${m.meta.version}: ${m.locations.length} locations, ${m.alloys.length} alloys, ${m.sizes.length} sizes, ${m.prices.length} stone prices, ${m.labor.length} labour policies.`);

if (DRY) { console.log('Dry run - nothing published.'); process.exit(0); }
if (previous && previous.version === m.meta.version) { console.log('Same as the live version - nothing to publish.'); process.exit(0); }

const { data: row, error: insErr } = await db.from('pricing_models')
  .insert({ version: m.meta.version, model: m, warnings: built.report.warnings, source, note, is_live: false })
  .select('id').single();
if (insErr) throw new Error(`Saving the price data failed: ${insErr.message}`);
// switch live: old off first (one-live unique index), then new on
const { error: offErr } = await db.from('pricing_models').update({ is_live: false }).eq('is_live', true);
if (offErr) throw new Error(offErr.message);
const { error: onErr } = await db.from('pricing_models').update({ is_live: true }).eq('id', row.id);
if (onErr) throw new Error(onErr.message);
console.log(`Published version ${m.meta.version} (id ${row.id}) as live.`);
