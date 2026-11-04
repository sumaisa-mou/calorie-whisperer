import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateWorkout, kcalToFatG, sumWorkouts, walkMet } from './workout.js';

test('walk MET interpolates and clamps', () => {
  assert.equal(walkMet(4.8), 3.5);
  assert.equal(walkMet(1), 2.0);
  assert.equal(walkMet(20), 8.3);
  assert.ok(walkMet(5.2) > 3.5 && walkMet(5.2) < 4.3);
});

test('walk with no steps assumes a brisk 5 km/h', () => {
  const e = estimateWorkout({ kind: 'walk', minutes: 60, steps: 0, items: [] }, 70);
  assert.equal(e.speedKmh, undefined);
  // (MET(5) − 1) × 70 kg × 1 h
  assert.equal(e.kcal, Math.round((walkMet(5) - 1) * 70));
});

test('walk speed comes from steps and height', () => {
  // 170 cm → stride 0.7055 m; 7,000 steps ≈ 4.94 km in 60 min
  const e = estimateWorkout({ kind: 'walk', minutes: 60, steps: 7000, items: [] }, 70, 170);
  assert.equal(e.distanceKm, 4.94);
  assert.equal(e.speedKmh, 4.9);
});

test('gym: MET is volume-weighted and kcal splits across items', () => {
  const e = estimateWorkout(
    {
      kind: 'gym',
      minutes: 30,
      steps: 0,
      items: [
        { name: 'Squat', sets: 4, reps: 30, met: 5 }, // 120
        { name: 'Crunch', sets: 4, reps: 30, met: 3 }, // 120  → 240 reps / 30 min = 8 reps/min (typical pace)
      ],
    },
    80,
  );
  assert.equal(e.met, 4);
  assert.equal(e.repsPerMin, 8);
  assert.equal(e.paceFactor, 1);
  assert.equal(e.kcal, 120); // (4−1) × 1 × 80 × 0.5
  assert.deepEqual(e.itemKcal, [60, 60]);
});

test('fat grams: 7,700 kcal = 1 kg', () => {
  assert.equal(Math.round(kcalToFatG(7700)), 1000);
  assert.equal(sumWorkouts([{ kcal: 385, minutes: 20 }, { kcal: 385, minutes: 10 }]).kgEffect, 0.1);
});

test('sessions before 05:00 count toward the previous day', async () => {
  const { countsForDate } = await import('./workout.js');
  assert.equal(countsForDate({ date: '2026-11-04', time: '00:30' }), '2026-11-03');
  assert.equal(countsForDate({ date: '2026-11-04', time: '04:59' }), '2026-11-03');
  assert.equal(countsForDate({ date: '2026-11-04', time: '05:00' }), '2026-11-04');
  assert.equal(countsForDate({ date: '2026-11-01', time: '00:10' }), '2026-10-31');
});

test('gym: per-set reps drive the volume weighting', () => {
  const e = estimateWorkout(
    {
      kind: 'gym',
      minutes: 30,
      steps: 0,
      items: [
        { name: 'Squat', sets: 2, reps: 38, met: 5, setReps: [30, 45] }, // 75 reps
        { name: 'Wall push-up', sets: 1, reps: 25, met: 3, setReps: [25] }, // 25 reps
      ],
    },
    80,
  );
  assert.equal(e.met, 4.5); // (5×75 + 3×25) / 100
});

test('gym: faster pace burns more, slower burns less, both capped', () => {
  const base = { kind: 'gym' as const, minutes: 30, steps: 0 };
  const items = (sets: number, reps: number) => [{ name: 'Squat', sets, reps, met: 5 }];
  const typical = estimateWorkout({ ...base, items: items(4, 60) }, 80); // 240 reps → 8/min
  const fast = estimateWorkout({ ...base, items: items(4, 75) }, 80); // 300 reps → 10/min → ×1.25
  const huge = estimateWorkout({ ...base, items: items(10, 100) }, 80); // 1000 reps → capped ×1.4
  const slow = estimateWorkout({ ...base, items: items(1, 20) }, 80); // 20 reps → capped ×0.6
  assert.equal(typical.kcal, 160); // (5−1) × 80 × 0.5
  assert.equal(fast.paceFactor, 1.25);
  assert.equal(fast.kcal, 200);
  assert.equal(huge.paceFactor, 1.4);
  assert.equal(slow.paceFactor, 0.6);
  assert.equal(slow.kcal, 96);
});
