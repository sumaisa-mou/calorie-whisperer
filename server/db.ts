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
];

/** Returns a ready-to-use client. Schema creation runs once per process. */
export async function db(): Promise<Client> {
  const c = getClient();
  ready ??= c.batch(SCHEMA, 'write').then(() => undefined);
  try {
    await ready;
  } catch (e) {
    ready = null;
    throw e;
  }
  return c;
}
