import { addDays, weekStartOf, type DateStr } from './dates.js';
import type { MeasurementEntry } from './types.js';

export interface MeasurementDelta {
  bustCm: number;
  waistCm: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

const diff = (a: MeasurementEntry, b: MeasurementEntry): MeasurementDelta => ({
  bustCm: r1(a.bustCm - b.bustCm),
  waistCm: r1(a.waistCm - b.waistCm),
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
