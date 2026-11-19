import { addDays, type DateStr } from '../../shared/dates';

const parse = (s: DateStr) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

export const fmtDay = (s: DateStr) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(parse(s));

export const fmtShort = (s: DateStr) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(parse(s));

export const fmtMonth = (ym: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parse(`${ym}-01`));

export const fmtWeek = (start: DateStr) => `${fmtShort(start)} – ${fmtShort(addDays(start, 6))}`;

/** +0.3 / −0.3 with a real minus sign */
export const signed = (n: number, dp = 1) => {
  const v = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  if (n > 0) return `+${v}`;
  if (n < 0) return `−${v}`;
  return v;
};

export const num = (n: number, dp = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** 13.5 → "13h 30m" */
export const fmtHours = (h: number) => {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
};
