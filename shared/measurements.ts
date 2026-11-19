import { addDays, diffDays, weekStartOf, type DateStr } from './dates.js';
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

export interface MeasurementInsight {
  /** whole-or-partial weeks between the first and latest measurement */
  weeks: number;
  /** average change per week since the first measurement */
  perWeek: MeasurementDelta;
  /** change over the last ~4 weeks (vs the newest entry at least 28 days older than the latest), null if not enough history */
  last4Weeks: MeasurementDelta | null;
}

export interface MeasurementSummary {
  /** newest first */
  rows: MeasurementRow[];
  latest: MeasurementEntry | null;
  first: MeasurementEntry | null;
  sinceStart: MeasurementDelta | null;
  /** null until there are two measurements at least a week apart */
  insight: MeasurementInsight | null;
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
  const weeks = latest && first ? diffDays(latest.date, first.date) / 7 : 0;
  const sinceStart = latest && first && latest !== first ? diff(latest, first) : null;
  const cutoff = latest ? addDays(latest.date, -28) : '';
  const base = [...entries].reverse().find((x) => x.date <= cutoff);
  const insight: MeasurementInsight | null =
    sinceStart && weeks >= 1
      ? {
          weeks: r2(weeks),
          perWeek: { bustIn: r2(sinceStart.bustIn / weeks), waistIn: r2(sinceStart.waistIn / weeks) },
          last4Weeks: latest && base ? diff(latest, base) : null,
        }
      : null;
  return {
    rows,
    latest,
    first,
    sinceStart,
    insight,
    due: !done,
    nextDue: done ? addDays(thisWeek, 7) : null,
  };
}
