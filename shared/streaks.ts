import { addDays, diffDays, weekStartOf, type DateStr } from './dates.js';

/**
 * Consecutive days (ending today) that are in `days`.
 * Today gets a grace period: if you haven't logged yet, the streak still counts up to yesterday.
 */
export function currentStreak(days: Set<DateStr>, today: DateStr): number {
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export function bestStreak(days: Set<DateStr>): number {
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  sorted.forEach((d, i) => {
    run = i > 0 && diffDays(d, sorted[i - 1]) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

export interface WeekCount {
  start: DateStr;
  count: number; // distinct workout days in that week
}

/** Workout-day counts for the last `weeks` weeks, oldest → newest (the last one is the current week). */
export function workoutWeeks(workoutDays: Set<DateStr>, today: DateStr, weekStart: 0 | 1, weeks = 12): WeekCount[] {
  const thisWeek = weekStartOf(today, weekStart);
  const out: WeekCount[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(thisWeek, -7 * i);
    let count = 0;
    for (let k = 0; k < 7; k++) if (workoutDays.has(addDays(start, k))) count++;
    out.push({ start, count });
  }
  return out;
}

/**
 * Consecutive weeks that reached the weekly workout goal.
 * The current week counts once it is met, and is not held against you while it is still in progress.
 */
export function weekStreak(weeks: WeekCount[], goal: number): number {
  let n = 0;
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (weeks[i].count >= goal) n++;
    else if (i === weeks.length - 1) continue; // current week still in progress
    else break;
  }
  return n;
}

export interface CheckIn {
  daysLogged: number; // of the last 7
  workouts: number; // workout days in the last 7
  workoutGoal: number;
  avgProtein: number | null; // on days with meals
  proteinTarget: number | null;
  burnedKcal: number;
  /** the one thing to work on this week */
  focus: string;
}

/** Last-7-days check-in with a rule-based focus (logging first, then protein, then workouts). */
export function checkIn(i: {
  daysLogged: number;
  workouts: number;
  workoutGoal: number;
  avgProtein: number | null;
  proteinTarget: number | null;
  burnedKcal: number;
}): CheckIn {
  let focus: string;
  if (i.daysLogged < 5) {
    focus = `You logged food on ${i.daysLogged} of 7 days. Log every day — the numbers are only useful if they are complete.`;
  } else if (i.avgProtein !== null && i.proteinTarget && i.avgProtein < i.proteinTarget * 0.85) {
    focus = `Protein is your gap: ${Math.round(i.avgProtein)} g a day against a ${i.proteinTarget} g target. Add eggs, dal, curd, fish or chicken to each main meal.`;
  } else if (i.workouts < i.workoutGoal) {
    const n = i.workoutGoal - i.workouts;
    focus = `${i.workouts} of ${i.workoutGoal} workouts so far. ${n} more ${n === 1 ? 'session' : 'sessions'} gets you to your weekly goal.`;
  } else {
    focus = 'Strong week: you logged, hit your protein and trained. Keep the same routine and let the weekly average do the work.';
  }
  return { ...i, focus };
}
