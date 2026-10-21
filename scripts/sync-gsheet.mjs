// Sync the "DB Schema" Google Sheet into Supabase.
//
// Source of CSVs (first match wins):
//   SHEET_CSV_DIR  -> folder containing Company.csv, Office.csv, Counter.csv, Customer.csv, CustomerPvt.csv
//   SHEET_ID       -> Google Sheet shared as "Anyone with the link can view" (fetched via the gviz CSV endpoint)
//
// Usage:  node scripts/sync-gsheet.mjs [--dry-run]
// Env:    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (not needed for --dry-run)
//
// Idempotent: upserts on natural keys. Never overwrites live counter values.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';

const DRY = process.argv.includes('--dry-run');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SHEET_ID, SHEET_CSV_DIR } = process.env;

// ------------------------------------------------------------------ helpers
const clean = (v) => {
  const s = (v ?? '').toString().trim();
  return s === '' ? null : s;
};
const digits = (v) => {
  const d = (v ?? '').toString().replace(/\D/g, '');
  return d === '' ? null : d;
};
const pct = (caption) => {
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(caption ?? '');
  return m ? Number(m[1]) : null;
};
const num = (v) => {
  const s = clean(v);
  return s === null ? null : Number(s);
};

async function readTab(name) {
  let text;
  if (SHEET_CSV_DIR) {
    text = await readFile(path.join(SHEET_CSV_DIR, `${name}.csv`), 'utf8');
  } else if (SHEET_ID) {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetching tab "${name}" failed: HTTP ${res.status}. Is the sheet shared by link?`);
    text = await res.text();
  } else {
    throw new Error('Set SHEET_CSV_DIR or SHEET_ID');
  }
  return parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true });
}

const log = (...a) => console.log(...a);

let db = null;
if (!DRY) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

async function upsert(table, rows, onConflict, opts = {}) {
  log(`  ${table}: ${rows.length} row(s)`);
  if (DRY || rows.length === 0) return rows;
  const { data, error } = await db.from(table).upsert(rows, { onConflict, ...opts }).select();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}

// ------------------------------------------------------------------ read tabs
const tabs = {};
for (const t of ['Company', 'Office', 'Counter', 'Customer', 'CustomerPvt']) {
  try {
    tabs[t] = await readTab(t);
  } catch (e) {
    if (['Customer', 'CustomerPvt'].includes(t)) { tabs[t] = []; log(`(skipping ${t}: ${e.message})`); }
    else throw e;
  }
}
log(`Read: ${Object.entries(tabs).map(([k, v]) => `${k}=${v.length}`).join(', ')}`);

// ------------------------------------------------------------------ 1. currencies
log('1. currencies');
const currencyCodes = new Set();
for (const o of tabs.Office) if (clean(o.Currency)) currencyCodes.add(o.Currency.toUpperCase());
for (const c of tabs.CustomerPvt) if (clean(c.Currency)) currencyCodes.add(c.Currency.toUpperCase());
await upsert('currencies', [...currencyCodes].map((code) => ({ code })), 'code');

// ------------------------------------------------------------------ 2. companies
log('2. companies');
const companyRows = tabs.Company.map((c) => ({
  code: c.CompanyCode,
  name: c.CompanyName,
  address_lines: (clean(c.Address) ?? '').split('|').map((s) => s.trim()).filter(Boolean),
}));
const companiesDb = await upsert('companies', companyRows, 'code');
const sheetCompanyCode = new Map(tabs.Company.map((c) => [c.CompanyID, c.CompanyCode]));
const companyIdByCode = new Map((companiesDb ?? []).map((c) => [c.code, c.id]));

// ------------------------------------------------------------------ 3. counters
log('3. counters');
const counterRows = tabs.Counter.map((c) => ({
  type: c.Type.toLowerCase(),
  prefix: c.CounterPrefix,
  reset_policy: c.Type.toLowerCase() === 'invoice' ? 'yearly' : 'never',
}));
const countersDb = await upsert('counters', counterRows, 'prefix');
const sheetCounterPrefix = new Map(tabs.Counter.map((c) => [c.CounterID, c.CounterPrefix]));
const counterIdByPrefix = new Map((countersDb ?? []).map((c) => [c.prefix, c.id]));

// Seed starting values ONLY if no row exists yet (ignoreDuplicates), so re-runs never reset live counters.
const year = String(new Date().getFullYear());
const seedValues = tabs.Counter.map((c) => ({
  counter_id: counterIdByPrefix.get(c.CounterPrefix),
  period_key: c.Type.toLowerCase() === 'invoice' ? year : 'ALL',
  last_value: Number(c.LastValue || 0),
}));
if (!DRY) {
  const { error } = await db.from('counter_values')
    .upsert(seedValues, { onConflict: 'counter_id,period_key', ignoreDuplicates: true });
  if (error) throw new Error(`counter_values: ${error.message}`);
}
log(`  counter_values: ${seedValues.length} seed row(s) (existing rows untouched)`);

// ------------------------------------------------------------------ 4. offices (two passes for self-FK)
log('4. offices');
const officeRows = tabs.Office.map((o) => {
  const caption = clean(o.Tax_Caption);
  return {
    company_id: companyIdByCode.get(sheetCompanyCode.get(o.CompanyID)) ?? null,
    code: o.OfficeCode,
    name: o.Name,
    city: clean(o.City),
    country: clean(o.Country),
    phone_raw: clean(o.Phone),
    whatsapp: digits(o.Whatsapp),
    email: clean(o.Email),
    currency_code: clean(o.Currency)?.toUpperCase() ?? null,
    tax_rate: pct(caption),
    tax_caption: caption,
    logo_url: clean(o.Logo),
    job_counter_id: counterIdByPrefix.get(sheetCounterPrefix.get(o.JobCounterID)) ?? null,
    invoice_counter_id: counterIdByPrefix.get(sheetCounterPrefix.get(o.InvoiceCounterID)) ?? null,
  };
});
if (!DRY && officeRows.some((r) => r.company_id === null)) throw new Error('An office references an unknown company');
const officesDb = await upsert('offices', officeRows, 'code');
const sheetOfficeCode = new Map(tabs.Office.map((o) => [o.OfficeID, o.OfficeCode]));
const officeIdByCode = new Map((officesDb ?? []).map((o) => [o.code, o.id]));

// pass 2: back_office_id (sheet BackOfficeID is an OfficeID)
const backLinks = tabs.Office
  .map((o) => ({ code: o.OfficeCode, back: officeIdByCode.get(sheetOfficeCode.get(o.BackOfficeID)) ?? null }))
  .filter((x) => x.back !== null || DRY);
log(`  offices.back_office_id: ${tabs.Office.filter((o) => clean(o.BackOfficeID)).length} link(s)`);
if (!DRY) {
  for (const l of backLinks) {
    const { error } = await db.from('offices').update({ back_office_id: l.back }).eq('code', l.code);
    if (error) throw new Error(`offices.back_office_id: ${error.message}`);
  }
}

// ------------------------------------------------------------------ 5. FX rates (dated, base USD)
log('5. exchange_rates');
const fx = new Map();
for (const o of tabs.Office) {
  const cur = clean(o.Currency)?.toUpperCase();
  const rate = num(o.FXR);
  if (cur && rate) fx.set(cur, rate);
}
const today = new Date().toISOString().slice(0, 10);
await upsert('exchange_rates',
  [...fx].map(([currency_code, rate_per_usd]) => ({ currency_code, rate_per_usd, effective_from: today })),
  'currency_code,effective_from');

// ------------------------------------------------------------------ 6. customers (tabs may be empty at this stage)
log('6. customers');
if (tabs.Customer.length === 0) {
  log('  (Customer tab is empty - nothing to import yet)');
} else {
  const pvtById = new Map(tabs.CustomerPvt.map((p) => [p.CustomerID, p]));

  const terms = [...new Set(tabs.CustomerPvt.map((p) => clean(p.PaymentTerms)).filter(Boolean))];
  const ships = [...new Set(tabs.CustomerPvt.map((p) => clean(p.ShipVia)).filter(Boolean))];
  const termsDb = await upsert('payment_terms', terms.map((name) => ({ name })), 'name');
  const shipsDb = await upsert('ship_via', ships.map((name) => ({ name })), 'name');
  const termId = new Map((termsDb ?? []).map((t) => [t.name, t.id]));
  const shipId = new Map((shipsDb ?? []).map((s) => [s.name, s.id]));

  const custRows = tabs.Customer.map((c) => ({
    office_id: officeIdByCode.get(sheetOfficeCode.get(c.OfficeID)),
    ezj_ac_num: clean(c.EZJAcNum),
    alias: c.Alias,
  }));
  const custDb = await upsert('customers', custRows, 'office_id,alias');
  const idByKey = new Map((custDb ?? []).map((c) => [`${c.office_id}|${c.alias}`, c.id]));

  const pvtRows = [];
  const contactRows = [];
  for (const c of tabs.Customer) {
    const p = pvtById.get(c.CustomerID);
    if (!p) continue;
    const officeId = officeIdByCode.get(sheetOfficeCode.get(c.OfficeID));
    const customer_id = idByKey.get(`${officeId}|${c.Alias}`);
    pvtRows.push({
      customer_id,
      name: p.Name,
      billing_address: clean(p.BillingAddress),
      shipping_address: clean(p.ShippingAddress),
      email: clean(p.Email),
      whatsapp: digits(p.Whatsapp),
      currency_code: clean(p.Currency)?.toUpperCase() ?? null,
      payment_terms_id: termId.get(clean(p.PaymentTerms)) ?? null,
      ship_via_id: shipId.get(clean(p.ShipVia)) ?? null,
      tax_perc: num(p.TaxPerc),
    });
    // The sheet has one free-text "Contacts" cell; keep it as one contact row to be cleaned up in the app.
    if (clean(p.Contacts)) contactRows.push({ customer_id, name: p.Contacts, is_primary: true });
  }
  await upsert('customer_private', pvtRows, 'customer_id');

  if (!DRY && contactRows.length) {
    const ids = contactRows.map((r) => r.customer_id);
    const { data: existing } = await db.from('customer_contacts').select('customer_id').in('customer_id', ids);
    const have = new Set((existing ?? []).map((e) => e.customer_id));
    const fresh = contactRows.filter((r) => !have.has(r.customer_id));
    if (fresh.length) {
      const { error } = await db.from('customer_contacts').insert(fresh);
      if (error) throw new Error(`customer_contacts: ${error.message}`);
    }
    log(`  customer_contacts: ${fresh.length} new`);
  }
}

log(DRY ? '\nDry run complete - nothing written.' : '\nSync complete.');
