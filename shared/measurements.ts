import { addDays, weekStartOf, type DateStr } from './dates.js';
import type { MeasurementEntry } from './types.js';

export interface MeasurementDelta {
  bustIn: number;
  waistIn: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const diff = (a: MeasurementEntry, b: MeasurementEntry): MeasurementDelta => ({
  bustIn: r2(a.bustIn - b.bustIn),
  waistIn: r2(a.waistIn - b.waistIn),
});

export interface MeasurementRow extends MeasurementEntry {
  /** change vs the previous entry (null for the first one) */
  change: MeasurementDelta | null;
}

export interface MeasurementSummary {
  /** newest first */
  rows: MeasurementRow[];
  latest: MeasurementEntry | null;
  first: MeasurementEntry | null;
  sinceStart: MeasurementDelta | null;
  /** true when nothing has been measured yet in the current week */
  due: boolean;
  /** date the next measurement is due (start of next week) when not due now */
  nextDue: DateStr | null;
}

/** Entries must be sorted by date ascending. */
export function summarizeMeasurements(entries: MeasurementEntry[], today: DateStr, weekStart: 0 | 1 = 1): MeasurementSummary {
  const latest = entries.at(-1) ?? null;
  const first = entries[0] ?? null;
  const thisWeek = weekStartOf(today, weekStart);
  const done = !!latest && latest.date >= thisWeek;
  const rows = entries.map((e, i) => ({ ...e, change: i > 0 ? diff(e, entries[i - 1]) : null })).reverse();
  return {
    rows,
    latest,
    first,
    sinceStart: latest && first && latest !== first ? diff(latest, first) : null,
    due: !done,
    nextDue: done ? addDays(thisWeek, 7) : null,
  };
}
