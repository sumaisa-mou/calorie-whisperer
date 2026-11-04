import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestStreak, checkIn, currentStreak, weekStreak, workoutWeeks } from './streaks.js';
import { proteinTarget } from './calc.js';

const S = (...d: string[]) => new Set(d);

test('current streak has a grace day for today', () => {
  const days = S('2026-11-01', '2026-11-02', '2026-11-03');
  assert.equal(currentStreak(days, '2026-11-03'), 3);
  assert.equal(currentStreak(days, '2026-11-04'), 3); // not logged yet today: streak is alive
  assert.equal(currentStreak(days, '2026-11-05'), 0); // a full day missed
  assert.equal(currentStreak(S(), '2026-11-05'), 0);
});

test('best streak finds the longest run', () => {
  assert.equal(bestStreak(S('2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07')), 3);
  assert.equal(bestStreak(S()), 0);
});

test('workout weeks and week streak', () => {
  // 2026-11-04 is a Wednesday; week starts Monday 2026-11-02
  const days = S('2026-10-19', '2026-10-21', '2026-10-26', '2026-10-28', '2026-10-30', '2026-11-02');
  const weeks = workoutWeeks(days, '2026-11-04', 1, 4);
  assert.deepEqual(weeks.map((w) => [w.start, w.count]), [['2026-10-12', 0], ['2026-10-19', 2], ['2026-10-26', 3], ['2026-11-02', 1]]);
  assert.equal(weekStreak(weeks, 2), 2); // current week (1) not met yet → skipped, previous two met
  assert.equal(weekStreak(weeks, 3), 1); // only 10-26 met; 10-19 broke it
  assert.equal(weekStreak(weeks, 1), 3); // current met + two before; the empty week stops it
});

test('check-in picks one focus in priority order', () => {
  const base = { daysLogged: 7, workouts: 4, workoutGoal: 4, avgProtein: 70, proteinTarget: 60, burnedKcal: 400 };
  assert.match(checkIn({ ...base, daysLogged: 3 }).focus, /3 of 7 days/);
  assert.match(checkIn({ ...base, avgProtein: 40 }).focus, /Protein is your gap/);
  assert.match(checkIn({ ...base, workouts: 2 }).focus, /2 more sessions/);
  assert.match(checkIn(base).focus, /Strong week/);
});

test('protein target is 0.8 g per kg', () => {
  assert.equal(proteinTarget(72.8), 58);
  assert.equal(proteinTarget(75), 60);
});
