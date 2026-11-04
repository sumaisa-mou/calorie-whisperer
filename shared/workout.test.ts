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
        { name: 'Squat', sets: 3, reps: 10, met: 5 }, // 30
        { name: 'Crunch', sets: 3, reps: 10, met: 3 }, // 30
      ],
    },
    80,
  );
  assert.equal(e.met, 4);
  assert.equal(e.kcal, 120); // (4−1) × 80 × 0.5
  assert.deepEqual(e.itemKcal, [60, 60]);
});

test('fat grams: 7,700 kcal = 1 kg', () => {
  assert.equal(Math.round(kcalToFatG(7700)), 1000);
  assert.equal(sumWorkouts([{ kcal: 385, minutes: 20 }, { kcal: 385, minutes: 10 }]).kgEffect, 0.1);
});
