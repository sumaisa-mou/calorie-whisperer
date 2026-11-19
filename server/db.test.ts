import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';

test('legacy cm measurements table is converted to inches in place', async () => {
  const url = `file:${join(mkdtempSync(join(tmpdir(), 'ft-db-')), 'test.db')}`;
  // a database created by the first (cm) release
  const old = createClient({ url });
  await old.execute(`CREATE TABLE measurements (date TEXT PRIMARY KEY, bust_cm REAL NOT NULL, waist_cm REAL NOT NULL, updated_at TEXT NOT NULL)`);
  await old.execute({ sql: 'INSERT INTO measurements VALUES (?, ?, ?, ?)', args: ['2026-11-09', 91.44, 76.2, 'x'] });
  old.close();

  process.env.TURSO_DATABASE_URL = url;
  const { db } = await import('./db.js');
  const c = await db();
  const rows = (await c.execute('SELECT date, bust_in, waist_in FROM measurements')).rows;
  assert.deepEqual(rows.map((r) => [r.date, r.bust_in, r.waist_in]), [['2026-11-09', 36, 30]]);
  // new-format writes work
  await c.execute({ sql: 'INSERT INTO measurements (date, bust_in, waist_in, updated_at) VALUES (?, ?, ?, ?)', args: ['2026-11-16', 35.5, 29.5, 'y'] });
});
