import fs from 'node:fs';
import { need } from '../lib/env.mjs';
import { openSqlite, tableIndex, readTable } from './sqlite.mjs';

// Written against a personal collection that is not in this repo. sqlite.mjs
// beside it is general-purpose and needs nothing.
need(new URL('collection.anki2', import.meta.url).pathname);
const bytes = new Uint8Array(fs.readFileSync('collection.anki2'));
const db = openSqlite(bytes);
console.log('page size', db.pageSize, 'usable', db.usable);
const tables = tableIndex(db);
console.log('tables:', [...tables.keys()].join(', '));

const t0 = Date.now();
const notes = readTable(db, 'notes');
console.log('notes rows:', notes.rows.length, 'in', Date.now() - t0, 'ms');
console.log('columns:', notes.columns.join(','));

const col = readTable(db, 'col');
const models = JSON.parse(col.rows[0].models);
console.log('models:', Object.entries(models).map(([k,m]) => `${k}=${m.name}(${m.flds.length})`).join('  '));

// compare against sqlite3's own answer
const want = JSON.parse(fs.readFileSync('truth.json', 'utf8'));
let bad = 0;
const byId = new Map(notes.rows.map(r => [String(r.id), r]));
for (const [id, rec] of Object.entries(want.sample)) {
  const got = byId.get(id);
  if (!got) { console.log('MISSING', id); bad++; continue; }
  if (got.flds !== rec.flds) { console.log('MISMATCH flds', id); bad++; }
  if (String(got.mid) !== String(rec.mid)) { console.log('MISMATCH mid', id, got.mid, rec.mid); bad++; }
}
console.log('count matches sqlite3:', notes.rows.length === want.count ? 'PASS' : `FAIL ${notes.rows.length} vs ${want.count}`);
console.log('sampled rows byte-identical:', bad === 0 ? `PASS (${Object.keys(want.sample).length} checked)` : `FAIL ${bad}`);

// the long record that must have used overflow pages
const longest = notes.rows.reduce((a, b) => (b.flds.length > a.flds.length ? b : a));
console.log('longest flds:', longest.flds.length, longest.flds.length === want.maxlen ? 'PASS' : `FAIL want ${want.maxlen}`);

// full checksum over every row, so nothing silently differs
import crypto from 'node:crypto';
const mine = crypto.createHash('sha256');
for (const r of [...notes.rows].sort((a,b) => a.id - b.id)) mine.update(String(r.id) + '\u0000' + r.flds + '\u0001');
console.log('digest over all notes:', mine.digest('hex').slice(0, 32), want.digest.slice(0, 32), mine === want ? '' : '');
