import type { Activity, FoodItem, Nutrients, Profile, Sex } from './types.js';
import {
  addDays,
  addMonths,
  ageOn,
  monthOf,
  weekStartOf,
  type DateStr,
} from './dates.js';

/** Approximate energy content of 1 kg of body weight change. */
export const KCAL_PER_KG = 7700;

export const ACTIVITY_FACTORS: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const ACTIVITY_LABELS: Record<Activity, string> = {
  sedentary: 'Sedentary (desk job, little exercise)',
  light: 'Lightly active (light exercise 1-3 days/week)',
  moderate: 'Moderately active (exercise 3-5 days/week)',
  active: 'Very active (hard exercise 6-7 days/week)',
  very_active: 'Extra active (physical job + training)',
};

export const CALORIE_FLOOR: Record<Sex, number> = { female: 1200, male: 1500 };

export const ZERO_NUTRIENTS: Nutrients = {
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: 0,
  sugar: 0,
  sodium: 0,
};

export const round = (n: number, dp = 0): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

// ---------------------------------------------------------------- body maths

export function inchesToCm(feet: number, inches: number): number {
  return (feet * 12 + inches) * 2.54;
}

export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalIn = cm / 2.54;
  const feet = Math.floor(totalIn / 12);
  return { feet, inches: round(totalIn - feet * 12, 1) };
}

/** Mifflin-St Jeor resting energy expenditure (kcal/day). */
export function bmr(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

export function tdee(bmrKcal: number, activity: Activity): number {
  return bmrKcal * ACTIVITY_FACTORS[activity];
}

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

export type BmiCategory = 'underweight' | 'normal' | 'overweight' | 'obese';

export function bmiCategory(value: number): BmiCategory {
  if (value < 18.5) return 'underweight';
  if (value < 25) return 'normal';
  if (value < 30) return 'overweight';
  return 'obese';
}

/** Weight range (kg) that gives a BMI of 18.5–24.9 at this height. */
export function healthyRange(heightCm: number): { min: number; max: number } {
  const m2 = (heightCm / 100) ** 2;
  return { min: round(18.5 * m2, 1), max: round(24.9 * m2, 1) };
}

/** Signed difference vs the healthy range: >0 above range, <0 below, 0 inside. */
export function rangeDifference(weightKg: number, range: { min: number; max: number }): number {
  if (weightKg > range.max) return round(weightKg - range.max, 1);
  if (weightKg < range.min) return round(weightKg - range.min, 1);
  return 0;
}

export interface CalorieTarget {
  bmr: number;
  tdee: number;
  /** daily deficit that was actually applied */
  deficit: number;
  target: number;
  floor: number;
  /** true when the safety floor forced the target up */
  clamped: boolean;
  /** weekly loss that the final target really produces */
  effectiveWeeklyLossKg: number;
}

export function calorieTarget(
  p: Profile,
  weightKg: number,
  today: DateStr,
): CalorieTarget {
  const age = ageOn(p.dob, today);
  const b = bmr(p.sex, weightKg, p.heightCm, age);
  const t = tdee(b, p.activity);
  const wantedDeficit = (p.weeklyLossKg * KCAL_PER_KG) / 7;
  const floor = CALORIE_FLOOR[p.sex];
  let target = t - wantedDeficit;
  let clamped = false;
  if (target < floor) {
    target = Math.min(floor, t); // never push above maintenance
    clamped = true;
  }
  const deficit = t - target;
  return {
    bmr: round(b),
    tdee: round(t),
    deficit: round(deficit),
    target: round(target),
    floor,
    clamped,
    effectiveWeeklyLossKg: round((deficit * 7) / KCAL_PER_KG, 2),
  };
}

/** kg gained (+) or lost (−) for a calorie surplus/deficit over n days. */
export function weightChangeKg(consumed: number, tdeeKcal: number, days = 1): number {
  return ((consumed - tdeeKcal) * days) / KCAL_PER_KG;
}

// ---------------------------------------------------------------- weight stats

export interface WeightPoint {
  date: DateStr;
  kg: number;
}

export interface PeriodAvg {
  /** week start date, or YYYY-MM for months */
  key: string;
  avg: number;
  count: number;
  /** change vs the previous period that has data (null for the first) */
  change: number | null;
}

function averageBy(
  points: WeightPoint[],
  keyOf: (d: DateStr) => string,
): PeriodAvg[] {
  const groups = new Map<string, number[]>();
  for (const p of [...points].sort((a, b) => a.date.localeCompare(b.date))) {
    const k = keyOf(p.date);
    const arr = groups.get(k);
    if (arr) arr.push(p.kg);
    else groups.set(k, [p.kg]);
  }
  const out: PeriodAvg[] = [];
  let prev: number | null = null;
  for (const [key, vals] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    out.push({
      key,
      avg: round(avg, 2),
      count: vals.length,
      change: prev === null ? null : round(avg - prev, 2),
    });
    prev = avg;
  }
  return out;
}

/** Average only over days that were actually logged. */
export function weeklyAverages(points: WeightPoint[], weekStart: 0 | 1 = 1): PeriodAvg[] {
  return averageBy(points, (d) => weekStartOf(d, weekStart));
}

export function monthlyAverages(points: WeightPoint[]): PeriodAvg[] {
  return averageBy(points, monthOf);
}

export interface WeightSummary {
  latest: WeightPoint | null;
  first: WeightPoint | null;
  totalChange: number | null;
  currentWeek: PeriodAvg | null;
  previousWeek: PeriodAvg | null;
  weekChange: number | null;
  currentMonth: PeriodAvg | null;
  monthChange: number | null;
}

export function summarizeWeights(
  points: WeightPoint[],
  today: DateStr,
  weekStart: 0 | 1 = 1,
): WeightSummary {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1) ?? null;
  const first = sorted[0] ?? null;
  const weeks = weeklyAverages(sorted, weekStart);
  const months = monthlyAverages(sorted);
  const thisWeekKey = weekStartOf(today, weekStart);
  const thisMonthKey = monthOf(today);

  // "current" = the period containing today if it has data, else the latest period
  const currentWeek = weeks.find((w) => w.key === thisWeekKey) ?? weeks.at(-1) ?? null;
  const currentMonth = months.find((m) => m.key === thisMonthKey) ?? months.at(-1) ?? null;

  // change vs the *calendar* previous period, so a gap week doesn't mislead
  const prevWeekKey = currentWeek ? addDays(currentWeek.key, -7) : null;
  const previousWeek = weeks.find((w) => w.key === prevWeekKey) ?? null;
  const prevMonthKey = currentMonth ? addMonths(currentMonth.key, -1) : null;
  const previousMonth = months.find((m) => m.key === prevMonthKey) ?? null;

  return {
    latest,
    first,
    totalChange: latest && first ? round(latest.kg - first.kg, 1) : null,
    currentWeek,
    previousWeek,
    weekChange: currentWeek && previousWeek ? round(currentWeek.avg - previousWeek.avg, 2) : null,
    currentMonth,
    monthChange:
      currentMonth && previousMonth ? round(currentMonth.avg - previousMonth.avg, 2) : null,
  };
}

// ---------------------------------------------------------------- nutrients

export function sumNutrients(list: Nutrients[]): Nutrients {
  const t = { ...ZERO_NUTRIENTS };
  for (const n of list) {
    t.calories += n.calories;
    t.protein += n.protein;
    t.carbs += n.carbs;
    t.fat += n.fat;
    t.fiber += n.fiber;
    t.sugar += n.sugar;
    t.sodium += n.sodium;
  }
  return {
    calories: round(t.calories),
    protein: round(t.protein, 1),
    carbs: round(t.carbs, 1),
    fat: round(t.fat, 1),
    fiber: round(t.fiber, 1),
    sugar: round(t.sugar, 1),
    sodium: round(t.sodium),
  };
}

/** Rescale an item's nutrients when its weight changes. */
export function scaleItem(item: FoodItem, newGrams: number): FoodItem {
  if (item.grams <= 0 || newGrams < 0) return { ...item, grams: Math.max(0, newGrams) };
  const r = newGrams / item.grams;
  return {
    ...item,
    grams: newGrams,
    calories: round(item.calories * r),
    protein: round(item.protein * r, 1),
    carbs: round(item.carbs * r, 1),
    fat: round(item.fat * r, 1),
    fiber: round(item.fiber * r, 1),
    sugar: round(item.sugar * r, 1),
    sodium: round(item.sodium * r),
  };
}

export function mealTypeForTime(hhmm: string): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const h = Number(hhmm.slice(0, 2));
  if (h >= 5 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 18 && h < 22) return 'dinner';
  return 'snack';
}

export interface Projection {
  /** days with at least one logged meal that were used */
  days: number;
  avgConsumed: number;
  avgDiff: number; // consumed − tdee, kcal/day
  kgPerWeek: number; // negative = losing
}

/** Estimate trend from logged days only (days without any meal are ignored). */
export function projectFromIntake(consumedPerDay: number[], tdeeKcal: number): Projection | null {
  const days = consumedPerDay.filter((c) => c > 0);
  if (days.length === 0) return null;
  const avg = days.reduce((s, v) => s + v, 0) / days.length;
  const diff = avg - tdeeKcal;
  return {
    days: days.length,
    avgConsumed: round(avg),
    avgDiff: round(diff),
    kgPerWeek: round(weightChangeKg(avg, tdeeKcal, 7), 2),
  };
}

// ---------------------------------------------------------------- daily balance table

export interface BalanceRow {
  date: DateStr;
  /** maintenance calories (what your body burns) */
  needed: number;
  /** null when no meals were logged that day */
  consumed: number | null;
  /** consumed − needed (negative = deficit) */
  diff: number | null;
  /** estimated body-weight change in grams (negative = loss) */
  grams: number | null;
}

export function balanceRows(
  dates: DateStr[],
  consumedByDate: Map<DateStr, number>,
  needed: number,
): BalanceRow[] {
  return dates.map((date) => {
    const c = consumedByDate.get(date);
    if (!c || c <= 0) return { date, needed, consumed: null, diff: null, grams: null };
    const diff = c - needed;
    return { date, needed, consumed: round(c), diff: round(diff), grams: round((diff / KCAL_PER_KG) * 1000) };
  });
}

export interface BalanceTotals {
  days: number;
  needed: number;
  consumed: number;
  diff: number;
  grams: number;
}

/** Sums only the rows that have logged meals. */
export function balanceTotals(rows: BalanceRow[]): BalanceTotals {
  const logged = rows.filter((r) => r.consumed !== null);
  const needed = logged.reduce((s, r) => s + r.needed, 0);
  const consumed = logged.reduce((s, r) => s + (r.consumed ?? 0), 0);
  const diff = consumed - needed;
  return { days: logged.length, needed: round(needed), consumed: round(consumed), diff: round(diff), grams: round((diff / KCAL_PER_KG) * 1000) };
}
