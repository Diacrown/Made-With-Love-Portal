// Create portal users and assign roles from a CSV (columns: full_name,email,role,offices).
// offices = office codes separated by | (empty = global grant). Rows with no email are skipped.
//
// Usage: node --env-file=.env scripts/create-users.mjs data/users.csv [--dry-run]
// Writes data/users-credentials.csv (temporary passwords) - git-ignored, share privately, users must change them.
// Idempotent: existing users are reused, role assignments are upserted.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';

const [file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const DRY = process.argv.includes('--dry-run');
if (!file) throw new Error('Usage: create-users.mjs <users.csv> [--dry-run]');

const rows = parse(await readFile(file, 'utf8'), { columns: true, skip_empty_lines: true, trim: true, bom: true });
const withEmail = rows.filter((r) => r.email);
console.log(`${rows.length} row(s), ${withEmail.length} with an email, ${rows.length - withEmail.length} skipped (no email)`);

const bad = withEmail.filter((r) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email));
if (bad.length) throw new Error(`Invalid email for: ${bad.map((b) => b.full_name).join(', ')}`);
const dupes = withEmail.map((r) => r.email.toLowerCase()).filter((e, i, a) => a.indexOf(e) !== i);
if (dupes.length) throw new Error(`Duplicate emails: ${[...new Set(dupes)].join(', ')}`);

if (DRY) {
  for (const r of withEmail) console.log(`  would create ${r.email} -> ${r.role} @ ${r.offices || 'ALL'}`);
  process.exit(0);
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: roles, error: e1 } = await db.from('roles').select('id,code');
const { data: offices, error: e2 } = await db.from('offices').select('id,code');
if (e1 || e2) throw new Error((e1 || e2).message);
const roleId = new Map(roles.map((r) => [r.code, r.id]));
const officeId = new Map(offices.map((o) => [o.code, o.id]));

// Validate everything before creating anything.
for (const r of withEmail) {
  if (!roleId.has(r.role)) throw new Error(`${r.full_name}: unknown role "${r.role}"`);
  for (const c of (r.offices || '').split('|').filter(Boolean))
    if (!officeId.has(c)) throw new Error(`${r.full_name}: unknown office code "${c}"`);
}

// Existing users by email
const existing = new Map();
for (let page = 1; ; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw new Error(error.message);
  data.users.forEach((u) => existing.set(u.email?.toLowerCase(), u.id));
  if (data.users.length < 200) break;
}

const creds = [['full_name', 'email', 'temp_password', 'status']];
for (const r of withEmail) {
  const email = r.email.toLowerCase();
  let id = existing.get(email);
  let status = 'existing';
  if (!id) {
    const password = randomBytes(12).toString('base64url');
    const { data, error } = await db.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: r.full_name },
    });
    if (error) throw new Error(`${email}: ${error.message}`);
    id = data.user.id;
    status = 'created';
    creds.push([r.full_name, email, password, status]);
  }
  const codes = (r.offices || '').split('|').filter(Boolean);
  const grants = (codes.length ? codes : [null]).map((c) => ({
    user_id: id, office_id: c ? officeId.get(c) : null, role_id: roleId.get(r.role),
  }));
  // The unique index uses coalesce(office_id,0), which upsert onConflict can't target, so check first.
  for (const g of grants) {
    let q = db.from('user_office_roles').select('id').eq('user_id', g.user_id).eq('role_id', g.role_id);
    q = g.office_id === null ? q.is('office_id', null) : q.eq('office_id', g.office_id);
    const { data: have, error } = await q;
    if (error) throw new Error(error.message);
    if (!have.length) {
      const { error: ie } = await db.from('user_office_roles').insert(g);
      if (ie) throw new Error(`${email}: ${ie.message}`);
    }
  }
  console.log(`  ${status.padEnd(8)} ${email} -> ${r.role} @ ${r.offices || 'ALL'}`);
}

if (creds.length > 1) {
  await mkdir('data', { recursive: true });
  await writeFile('data/users-credentials.csv', creds.map((c) => c.join(',')).join('\n') + '\n');
  console.log(`\nTemporary passwords written to data/users-credentials.csv (git-ignored). Share privately; users should change them.`);
}
console.log('Done.');
