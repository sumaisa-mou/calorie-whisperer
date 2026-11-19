import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMeasurements } from './measurements.js';

const e = (date: string, bustIn: number, waistIn: number) => ({ date, bustIn, waistIn });

test('empty history is due with no deltas', () => {
  const s = summarizeMeasurements([], '2026-11-10');
  assert.equal(s.due, true);
  assert.equal(s.latest, null);
  assert.equal(s.sinceStart, null);
  assert.deepEqual(s.rows, []);
});

test('computes change vs previous and since start, newest first', () => {
  const s = summarizeMeasurements([e('2026-10-26', 36, 30), e('2026-11-02', 35.5, 29.75), e('2026-11-09', 35.25, 29.25)], '2026-11-10');
  assert.equal(s.rows[0].date, '2026-11-09');
  assert.deepEqual(s.rows[0].change, { bustIn: -0.25, waistIn: -0.5 });
  assert.equal(s.rows[2].change, null);
  assert.deepEqual(s.sinceStart, { bustIn: -0.75, waistIn: -0.75 });
});

test('due depends on the current week (Monday start)', () => {
  // 2026-11-10 is a Tuesday; week starts Mon 2026-11-09
  assert.equal(summarizeMeasurements([e('2026-11-08', 95, 78)], '2026-11-10').due, true);
  const done = summarizeMeasurements([e('2026-11-09', 95, 78)], '2026-11-10');
  assert.equal(done.due, false);
  assert.equal(done.nextDue, '2026-11-16');
});

test('insight: weekly average and last-4-weeks change', () => {
  const s = summarizeMeasurements(
    [e('2026-10-05', 38, 32), e('2026-10-12', 37.5, 31.5), e('2026-10-19', 37, 31), e('2026-10-26', 36.5, 30.5), e('2026-11-02', 36.5, 30), e('2026-11-09', 36, 29.5)],
    '2026-11-10',
  );
  assert.equal(s.insight?.weeks, 5);
  assert.deepEqual(s.insight?.perWeek, { bustIn: -0.4, waistIn: -0.5 });
  // base = newest entry on/before 2026-10-12
  assert.deepEqual(s.insight?.last4Weeks, { bustIn: -1.5, waistIn: -2 });
});

test('insight needs two measurements at least a week apart', () => {
  assert.equal(summarizeMeasurements([e('2026-11-09', 36, 30)], '2026-11-10').insight, null);
  assert.equal(summarizeMeasurements([e('2026-11-05', 36, 30), e('2026-11-08', 35.5, 30)], '2026-11-10').insight, null);
});
