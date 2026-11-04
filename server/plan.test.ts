import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanPrompt, normalizePlan } from './plan.js';
import type { Workout } from '../shared/workout.js';

const gym: Workout = {
  id: 1, date: '2026-11-03', time: '00:30', kind: 'gym', minutes: 30, steps: 0, note: '', kcal: 100,
  items: [{ name: 'Squat', sets: 2, reps: 38, met: 5, setReps: [30, 45] }, { name: 'Crunch', sets: 3, reps: 10, met: 3.8 }],
};

test('prompt includes real per-set history and the closed exercise list', () => {
  const p = buildPlanPrompt({ today: '2026-11-04', sex: 'female', age: 31, weightKg: 72.8, weeklyGoal: 4, workoutsThisWeek: 1, daysSinceLast: 1, recent: [gym], customs: [{ name: 'Rowing machine', met: 7 }] });
  assert.match(p, /Squat 30\+45/);
  assert.match(p, /Crunch 3x10/);
  assert.match(p, /Allowed exercises: .*Squat.*Rowing machine/);
  assert.match(p, /Done this week so far: 1/);
  assert.match(p, /Last workout: 1 day\(s\) ago/);
});

test('prompt copes with no history', () => {
  const p = buildPlanPrompt({ today: '2026-11-04', weeklyGoal: 3, workoutsThisWeek: 0, daysSinceLast: null, recent: [], customs: [] });
  assert.match(p, /none logged yet/);
  assert.match(p, /\(none\)/);
});

test('plan keeps only allowed exercises, clamps numbers, takes MET from our table', () => {
  const r = normalizePlan(
    {
      summary: 'Build on squats.', tip: 'Breathe.', durationMin: 500,
      exercises: [
        { name: 'Squat', sets: 99, reps: 2, note: 'beat 75' },
        { name: 'Squat', sets: 3, reps: 10, note: 'duplicate' }, // dropped
        { name: 'Muscle-up', sets: 3, reps: 5, note: 'not allowed' }, // dropped
        { name: 'Rowing machine', sets: 3, reps: 20, note: '' },
        { name: 'Crunch', sets: 'x', reps: 10, note: '' }, // dropped: bad number
      ],
    },
    [{ name: 'Rowing machine', met: 7 }],
  );
  assert.deepEqual(r.exercises.map((e) => [e.name, e.met, e.sets, e.reps]), [['Squat', 5, 6, 5], ['Rowing machine', 7, 3, 20]]);
  assert.equal(r.durationMin, 90);
});

test('junk output gives an empty plan instead of crashing', () => {
  assert.deepEqual(normalizePlan(null, []).exercises, []);
});
