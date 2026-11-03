// Date helpers. A "day" is a plain 'YYYY-MM-DD' string in the user's timezone.
// All arithmetic is done in UTC on those strings so DST never shifts a day.

export type DateStr = string;

const RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateStr(s: string): boolean {
  if (!RE.test(s)) return false;
  const d = parse(s);
  return !Number.isNaN(d.getTime()) && fmt(d) === s;
}

function parse(s: DateStr): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmt(d: Date): DateStr {
  return d.toISOString().slice(0, 10);
}

export function addDays(s: DateStr, n: number): DateStr {
  const d = parse(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

export function diffDays(a: DateStr, b: DateStr): number {
  return Math.round((parse(a).getTime() - parse(b).getTime()) / 86_400_000);
}

/** Today's date (YYYY-MM-DD) in the given IANA timezone. */
export function todayInTz(tz: string, now: Date = new Date()): DateStr {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    return parts;
  } catch {
    return fmt(now);
  }
}

/** Current HH:MM in the given timezone. */
export function nowTimeInTz(tz: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
  } catch {
    return now.toISOString().slice(11, 16);
  }
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(s: DateStr): number {
  return parse(s).getUTCDay();
}

/**
 * Start date of the week containing `s`.
 * weekStart: 1 = Monday (default), 0 = Sunday.
 */
export function weekStartOf(s: DateStr, weekStart: 0 | 1 = 1): DateStr {
  const offset = (weekday(s) - weekStart + 7) % 7;
  return addDays(s, -offset);
}

export function monthOf(s: DateStr): string {
  return s.slice(0, 7); // YYYY-MM
}

export function monthStart(month: string): DateStr {
  return `${month}-01`;
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function rangeDays(from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function ageOn(dob: DateStr, on: DateStr): number {
  const [by, bm, bd] = dob.split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}
