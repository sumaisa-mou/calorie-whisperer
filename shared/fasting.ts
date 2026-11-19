import { addDays, diffDays, weekday, rangeDays, type DateStr } from './dates.js';

/** Meals under this many kcal (black coffee, tea, a bite) don't break a fast. */
export const FAST_MIN_KCAL = 50;

/** Fasting goal in hours for each weekday, index 0 = Sunday … 6 = Saturday. 0 = no goal that day. */
export type FastingPlan = number[];

export const NO_PLAN: FastingPlan = [0, 0, 0, 0, 0, 0, 0];

/** Selectable goals: hours fasting (the eating window is the rest of the 24h). */
export const FAST_OPTIONS = [0, 12, 14, 16, 18, 20] as const;

export const fastLabel = (hours: number) => (hours === 0 ? 'Off' : `${hours}:${24 - hours}`);

export interface MealLite {
  date: DateStr;
  time: string; // HH:MM
  calories: number;
  /** breakfast | lunch | dinner | snack — only used for the meal timeline */
  mealType?: string;
}

const EPOCH = '1970-01-01';
const minutesOf = (date: DateStr, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return diffDays(date, EPOCH) * 1440 + h * 60 + m;
};
const fromMinutes = (ts: number): { date: DateStr; time: string } => {
  const day = Math.floor(ts / 1440);
  const rem = ts - day * 1440;
  return {
    date: addDays(EPOCH, day),
    time: `${String(Math.floor(rem / 60)).padStart(2, '0')}:${String(rem % 60).padStart(2, '0')}`,
  };
};
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Meals that count as eating (>= FAST_MIN_KCAL), as sorted timestamps in minutes. */
function counted(meals: MealLite[]) {
  return meals
    .filter((m) => m.calories >= FAST_MIN_KCAL)
    .map((m) => ({ date: m.date, time: m.time, calories: m.calories, mealType: m.mealType ?? 'meal', ts: minutesOf(m.date, m.time) }))
    .sort((a, b) => a.ts - b.ts);
}

export interface FastDay {
  date: DateStr;
  /** hours without food before the first meal of this day; null if no meal today or no earlier meal known */
  fastHours: number | null;
  firstMeal: string | null;
  lastMeal: string | null;
  /** first → last meal of the day, in hours */
  windowHours: number | null;
  /** goal for this weekday, 0 = none */
  goalHours: number;
  /** eating window allowed that day (24 − goal), 0 = no limit */
  allowedWindowHours: number;
  /** was the first→last meal span within the allowed window? null when there is no goal or no meals */
  windowOk: boolean | null;
  /** null when there is no goal or no measurable fast */
  hit: boolean | null;
}

/**
 * One row per day from..to (ascending). A day's fast is the gap between its first meal and the previous meal —
 * i.e. the fast that ENDED that day, judged against that weekday's goal. Pass meals from before `from` too,
 * otherwise the first day has no earlier meal to measure from.
 */
export function fastingDays(meals: MealLite[], from: DateStr, to: DateStr, plan: FastingPlan): FastDay[] {
  const all = counted(meals);
  return rangeDays(from, to).map((date) => {
    const goalHours = plan[weekday(date)] ?? 0;
    const allowedWindowHours = goalHours > 0 ? 24 - goalHours : 0;
    const today = all.filter((m) => m.date === date);
    if (today.length === 0) return { date, fastHours: null, firstMeal: null, lastMeal: null, windowHours: null, goalHours, allowedWindowHours, windowOk: null, hit: null };
    const first = today[0];
    const last = today[today.length - 1];
    const prev = [...all].reverse().find((m) => m.ts < first.ts);
    const fastHours = prev ? r1((first.ts - prev.ts) / 60) : null;
    const windowHours = r1((last.ts - first.ts) / 60);
    return {
      date,
      fastHours,
      firstMeal: first.time,
      lastMeal: last.time,
      windowHours,
      goalHours,
      allowedWindowHours,
      windowOk: allowedWindowHours > 0 ? windowHours <= allowedWindowHours : null,
      hit: goalHours > 0 && fastHours !== null ? fastHours >= goalHours : null,
    };
  });
}

export interface CurrentFast {
  sinceDate: DateStr;
  sinceTime: string;
  elapsedHours: number;
  /** goal for the day this fast will end on (tomorrow if you already ate today), 0 = none */
  goalHours: number;
  goalDate: DateStr;
  done: boolean;
  /** when the goal is (or was) reached */
  reachedDate: DateStr | null;
  reachedTime: string | null;
}

/** The fast in progress right now, measured from the last meal that counts. */
export function currentFast(meals: MealLite[], today: DateStr, nowTime: string, plan: FastingPlan): CurrentFast | null {
  const all = counted(meals);
  const now = minutesOf(today, nowTime);
  const last = [...all].reverse().find((m) => m.ts <= now);
  if (!last) return null;
  const goalDate = last.date === today ? addDays(today, 1) : today;
  const goalHours = plan[weekday(goalDate)] ?? 0;
  const elapsedHours = r1(Math.max(0, now - last.ts) / 60);
  const reached = goalHours > 0 ? fromMinutes(last.ts + goalHours * 60) : null;
  return {
    sinceDate: last.date,
    sinceTime: last.time,
    elapsedHours,
    goalHours,
    goalDate,
    done: goalHours > 0 && now - last.ts >= goalHours * 60,
    reachedDate: reached?.date ?? null,
    reachedTime: reached?.time ?? null,
  };
}

export interface FastingSummary {
  avgHours: number | null;
  longestHours: number | null;
  /** days with a goal and a measurable fast */
  planned: number;
  hits: number;
  /** consecutive goal days hit, counting back from the latest one with a result */
  streak: number;
}

export function summarizeFasting(days: FastDay[]): FastingSummary {
  const measured = days.filter((d) => d.fastHours !== null);
  const rated = days.filter((d) => d.hit !== null);
  let streak = 0;
  for (const d of [...rated].reverse()) {
    if (!d.hit) break;
    streak++;
  }
  return {
    avgHours: measured.length ? r1(measured.reduce((s, d) => s + (d.fastHours as number), 0) / measured.length) : null,
    longestHours: measured.length ? Math.max(...measured.map((d) => d.fastHours as number)) : null,
    planned: rated.length,
    hits: rated.filter((d) => d.hit).length,
    streak,
  };
}

export interface EatingWindow {
  /** today's fasting goal (the fast that ended when you first ate today), 0 = none */
  goalHours: number;
  /** allowed eating window today = 24 − goal, 0 = no limit */
  windowHours: number;
  /** none: nothing eaten yet today · open: eating allowed · closed: window used up, time to fast */
  state: 'none' | 'open' | 'closed';
  firstTime: string | null;
  lastTime: string | null;
  meals: number;
  kcal: number;
  /** since the first meal today */
  elapsedHours: number;
  /** left in the window (0 when closed or no limit) */
  remainingHours: number;
  closeDate: DateStr | null;
  closeTime: string | null;
}

/** Today's eating window: opens with the first meal that counts, closes `24 − goal` hours later. */
export function eatingWindow(meals: MealLite[], today: DateStr, nowTime: string, plan: FastingPlan): EatingWindow {
  const goalHours = plan[weekday(today)] ?? 0;
  const windowHours = goalHours > 0 ? 24 - goalHours : 0;
  const now = minutesOf(today, nowTime);
  const mine = counted(meals).filter((m) => m.date === today && m.ts <= now);
  if (mine.length === 0) {
    return { goalHours, windowHours, state: 'none', firstTime: null, lastTime: null, meals: 0, kcal: 0, elapsedHours: 0, remainingHours: 0, closeDate: null, closeTime: null };
  }
  const first = mine[0];
  const close = windowHours > 0 ? fromMinutes(first.ts + windowHours * 60) : null;
  const closed = windowHours > 0 && now >= first.ts + windowHours * 60;
  return {
    goalHours,
    windowHours,
    state: closed ? 'closed' : 'open',
    firstTime: first.time,
    lastTime: mine[mine.length - 1].time,
    meals: mine.length,
    kcal: Math.round(mine.reduce((sum, m) => sum + m.calories, 0)),
    elapsedHours: r1((now - first.ts) / 60),
    remainingHours: windowHours > 0 && !closed ? r1((first.ts + windowHours * 60 - now) / 60) : 0,
    closeDate: close?.date ?? null,
    closeTime: close?.time ?? null,
  };
}

export interface EatingSummary {
  avgWindowHours: number | null;
  /** days with a goal and meals */
  planned: number;
  within: number;
}

export function summarizeEating(days: FastDay[]): EatingSummary {
  const eaten = days.filter((d) => d.windowHours !== null);
  const rated = days.filter((d) => d.windowOk !== null);
  return {
    avgWindowHours: eaten.length ? r1(eaten.reduce((sum, d) => sum + (d.windowHours as number), 0) / eaten.length) : null,
    planned: rated.length,
    within: rated.filter((d) => d.windowOk).length,
  };
}

export interface FlowMeal {
  mealType: string;
  time: string;
  calories: number;
}

export interface FlowDay {
  date: DateStr;
  meals: FlowMeal[];
  /** hours between consecutive meals of this day (length = meals − 1) */
  gaps: number[];
  /** the overnight fast to the next meal that counts, or null if nothing was logged after this day yet */
  overnight: { hours: number; mealType: string; date: DateStr; time: string } | null;
}

/**
 * Per-day timeline of counted meals: breakfast → 4h → lunch → 5h → dinner → 12h → next meal.
 * Days without a counted meal are left out. Pass meals from after `to` as well to resolve the last overnight gap.
 */
export function mealFlow(meals: MealLite[], from: DateStr, to: DateStr): FlowDay[] {
  const all = counted(meals);
  const out: FlowDay[] = [];
  for (const date of rangeDays(from, to)) {
    const mine = all.filter((m) => m.date === date);
    if (mine.length === 0) continue;
    const last = mine[mine.length - 1];
    const next = all.find((m) => m.ts > last.ts && m.date > date);
    out.push({
      date,
      meals: mine.map((m) => ({ mealType: m.mealType, time: m.time, calories: Math.round(m.calories) })),
      gaps: mine.slice(1).map((m, i) => r1((m.ts - mine[i].ts) / 60)),
      overnight: next ? { hours: r1((next.ts - last.ts) / 60), mealType: next.mealType, date: next.date, time: next.time } : null,
    });
  }
  return out;
}
