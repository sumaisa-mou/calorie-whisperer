import { KCAL_PER_KG, round } from './calc.js';
import { addDays } from './dates.js';

export type WorkoutKind = 'walk' | 'gym';

/** One exercise inside a gym session. `met` is the intensity used for the estimate. */
export interface GymItem {
  name: string;
  sets: number;
  /** reps per set (average when `setReps` is present) */
  reps: number;
  met: number;
  /** exact reps of each set, e.g. [30, 45]; set by the live tracker */
  setReps?: number[];
}

export interface WorkoutInput {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  kind: WorkoutKind;
  minutes: number;
  steps: number; // walks only (0 = not entered)
  items: GymItem[]; // gym only
  note: string;
}

export interface Workout extends WorkoutInput {
  id: number;
  kcal: number; // extra calories burned above resting, estimated when logged
}

/** Quick-add exercises (MET values from the Compendium of Physical Activities, rounded). */
export const GYM_PRESETS: { name: string; met: number }[] = [
  { name: 'Squat', met: 5.0 },
  { name: 'Knee push-up', met: 3.8 },
  { name: 'Crunch', met: 3.8 },
  { name: 'Plank', met: 3.3 },
  { name: 'Lunge', met: 4.5 },
  { name: 'Glute bridge', met: 3.5 },
  { name: 'Jumping jacks', met: 8.0 },
  { name: 'Burpee', met: 8.0 },
  { name: 'Dumbbell weights', met: 3.5 },
];

/** For a manually-added category the user picks how hard it felt. */
export const INTENSITIES = [
  { value: 3.5, label: 'Light' },
  { value: 5, label: 'Moderate' },
  { value: 7, label: 'Hard' },
] as const;

// speed (km/h) → MET for walking, linearly interpolated
const WALK_MET: [number, number][] = [
  [2.0, 2.0],
  [3.2, 2.8],
  [4.0, 3.0],
  [4.8, 3.5],
  [5.6, 4.3],
  [6.4, 5.0],
  [7.2, 7.0],
  [8.0, 8.3],
];
export const DEFAULT_WALK_KMH = 5; // brisk walk, used when no steps are entered

export function walkMet(speedKmh: number): number {
  const v = Math.min(8, Math.max(2, speedKmh));
  for (let i = 1; i < WALK_MET.length; i++) {
    const [x1, y1] = WALK_MET[i];
    const [x0, y0] = WALK_MET[i - 1];
    if (v <= x1) return y0 + ((y1 - y0) * (v - x0)) / (x1 - x0);
  }
  return WALK_MET[WALK_MET.length - 1][1];
}

/** Walking stride ≈ 41.5 % of height. */
export const strideM = (heightCm: number) => (heightCm * 0.415) / 100;

export interface WorkoutEstimate {
  met: number;
  kcal: number;
  fatG: number;
  speedKmh?: number;
  distanceKm?: number;
  /** kcal share per gym item (same order as input) */
  itemKcal: number[];
  /** gym only: total reps ÷ session minutes */
  repsPerMin?: number;
  /** gym only: how much the pace scaled the burn (1 = typical pace) */
  paceFactor?: number;
}

/** A typical bodyweight session (sets + rests) works out to roughly this many reps per minute. */
export const REF_REPS_PER_MIN = 8;
export const PACE_MIN = 0.6;
export const PACE_MAX = 1.4;

/** Fat burned if all the energy came from fat — an upper bound, 1 g ≈ 7.7 kcal. */
export const kcalToFatG = (kcal: number) => (kcal / KCAL_PER_KG) * 1000;

/**
 * Extra calories burned above resting: (MET − 1) × kg × hours (gym sessions also scaled by reps-per-minute pace).
 * (Subtracting 1 MET avoids double-counting the resting burn already inside your daily maintenance.)
 */
export function estimateWorkout(
  w: Pick<WorkoutInput, 'kind' | 'minutes' | 'steps' | 'items'>,
  weightKg: number,
  heightCm = 170,
): WorkoutEstimate {
  const hours = Math.max(0, w.minutes) / 60;
  let met: number;
  let speedKmh: number | undefined;
  let distanceKm: number | undefined;
  let itemKcal: number[] = [];
  let repsPerMin: number | undefined;
  let paceFactor = 1;

  if (w.kind === 'walk') {
    if (w.steps > 0 && w.minutes > 0) {
      distanceKm = (w.steps * strideM(heightCm)) / 1000;
      speedKmh = distanceKm / hours;
    }
    met = walkMet(speedKmh ?? DEFAULT_WALK_KMH);
  } else {
    // session MET = average of the exercises' METs, weighted by volume (sets × reps)
    const vol = w.items.map((i) => (i.setReps?.length ? i.setReps.reduce((a, b) => a + b, 0) : Math.max(1, i.sets) * Math.max(1, i.reps)));
    const total = vol.reduce((a, b) => a + b, 0);
    met = total > 0 ? w.items.reduce((a, i, idx) => a + i.met * vol[idx], 0) / total : 0;
    // pace: more reps per minute = harder session. The 5-min floor stops the first seconds of a live
    // session from showing a wild rate.
    repsPerMin = total / Math.max(w.minutes, 5);
    paceFactor = Math.min(PACE_MAX, Math.max(PACE_MIN, repsPerMin / REF_REPS_PER_MIN));
    const sessionKcal = Math.max(0, met - 1) * paceFactor * weightKg * hours;
    itemKcal = vol.map((v) => (total > 0 ? round((sessionKcal * v) / total, 1) : 0));
  }

  const kcal = Math.max(0, met - 1) * paceFactor * weightKg * hours;
  return {
    met: round(met, 2),
    kcal: round(kcal),
    fatG: round(kcalToFatG(kcal), 1),
    speedKmh: speedKmh === undefined ? undefined : round(speedKmh, 1),
    distanceKm: distanceKm === undefined ? undefined : round(distanceKm, 2),
    itemKcal,
    repsPerMin: repsPerMin === undefined ? undefined : round(repsPerMin, 1),
    paceFactor: w.kind === 'gym' ? round(paceFactor, 2) : undefined,
  };
}

/**
 * Your training "day" ends at the next morning's weigh-in, so a session logged in the small hours
 * (e.g. 00:30) counts toward the PREVIOUS day. Anything before this time rolls back one day.
 */
export const DAY_STARTS_AT = '05:00';
export const countsForDate = (w: { date: string; time: string }): string => (w.time < DAY_STARTS_AT ? addDays(w.date, -1) : w.date);

export function sumWorkouts(list: Pick<Workout, 'kcal' | 'minutes'>[]) {
  const kcal = list.reduce((a, w) => a + w.kcal, 0);
  return { kcal: round(kcal), minutes: round(list.reduce((a, w) => a + w.minutes, 0)), fatG: round(kcalToFatG(kcal), 1), kgEffect: round(kcal / KCAL_PER_KG, 2) };
}
