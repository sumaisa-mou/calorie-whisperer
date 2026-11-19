import { createClient, type Client } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let client: Client | null = null;
let ready: Promise<void> | null = null;

function getClient(): Client {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL || 'file:./data/local.db';
  if (url.startsWith('file:')) {
    if (process.env.VERCEL) {
      throw new Error(
        'TURSO_DATABASE_URL is not set. Vercel functions have no persistent disk — create a Turso database and set TURSO_DATABASE_URL / TURSO_AUTH_TOKEN.',
      );
    }
    mkdirSync(dirname(url.replace(/^file:/, '')), { recursive: true });
  }
  client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return client;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS profile (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     sex TEXT NOT NULL,
     dob TEXT NOT NULL,
     height_cm REAL NOT NULL,
     activity TEXT NOT NULL,
     goal_weight_kg REAL NOT NULL,
     weekly_loss_kg REAL NOT NULL,
     timezone TEXT NOT NULL,
     week_start INTEGER NOT NULL DEFAULT 1,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS weights (
     date TEXT PRIMARY KEY,
     kg REAL NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS measurements (
     date TEXT PRIMARY KEY,
     bust_in REAL NOT NULL,
     waist_in REAL NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS meals (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     date TEXT NOT NULL,
     time TEXT NOT NULL,
     meal_type TEXT NOT NULL,
     note TEXT NOT NULL DEFAULT '',
     items TEXT NOT NULL,
     calories REAL NOT NULL,
     protein REAL NOT NULL DEFAULT 0,
     carbs REAL NOT NULL DEFAULT 0,
     fat REAL NOT NULL DEFAULT 0,
     fiber REAL NOT NULL DEFAULT 0,
     sugar REAL NOT NULL DEFAULT 0,
     sodium REAL NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_meals_date ON meals (date, time)`,
  `CREATE TABLE IF NOT EXISTS workouts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     date TEXT NOT NULL,
     time TEXT NOT NULL,
     kind TEXT NOT NULL,
     minutes REAL NOT NULL,
     steps INTEGER NOT NULL DEFAULT 0,
     items TEXT NOT NULL DEFAULT '[]',
     note TEXT NOT NULL DEFAULT '',
     kcal REAL NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts (date, time)`,
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS day_reviews (
     date TEXT PRIMARY KEY,
     data TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
];

/**
 * The first release stored measurements in cm (bust_cm / waist_cm). CREATE TABLE IF NOT EXISTS never alters an
 * existing table, so databases created back then must be converted in place: rename the columns and cm → inches.
 * Idempotent — does nothing once the columns are already bust_in / waist_in.
 */
async function migrateMeasurementsToInches(c: Client): Promise<void> {
  const hasOld = async () =>
    (await c.execute('PRAGMA table_info(measurements)')).rows.some((r) => r.name === 'bust_cm');
  if (!(await hasOld())) return;
  try {
    await c.batch(
      [
        'ALTER TABLE measurements RENAME COLUMN bust_cm TO bust_in',
        'ALTER TABLE measurements RENAME COLUMN waist_cm TO waist_in',
        'UPDATE measurements SET bust_in = ROUND(bust_in / 2.54, 2), waist_in = ROUND(waist_in / 2.54, 2)',
      ],
      'write',
    );
  } catch (e) {
    // another cold-started instance may have migrated first (the batch is atomic) — only rethrow if it still isn't done
    if (await hasOld()) throw e;
  }
}

/** Returns a ready-to-use client. Schema creation runs once per process. */
export async function db(): Promise<Client> {
  const c = getClient();
  ready ??= c.batch(SCHEMA, 'write').then(() => migrateMeasurementsToInches(c));
  try {
    await ready;
  } catch (e) {
    ready = null;
    throw e;
  }
  return c;
}
