// Verifies web/src/pricing/*.js are still byte-identical to the hashes recorded in SOURCE.md
// (the MWL engine must not be edited here - change it in Unified-Quote-Calculator and copy again).
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const dir = new URL('../web/src/pricing/', import.meta.url);
const src = await readFile(new URL('SOURCE.md', dir), 'utf8');
let bad = 0;
for (const [, f, h] of src.matchAll(/\| ([\w.-]+\.js) \| `([0-9a-f]+)` \|/g)) {
  const got = createHash('sha256').update(await readFile(new URL(f, dir))).digest('hex').slice(0, h.length);
  console.log(`${got === h ? 'ok  ' : 'DIFF'} ${f}`);
  if (got !== h) bad++;
}
if (bad) { console.error(`${bad} file(s) differ from the MWL engine copy.`); process.exit(1); }
