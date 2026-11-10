import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMeasurements } from './measurements.js';

const e = (date: string, bustCm: number, waistCm: number) => ({ date, bustCm, waistCm });

test('empty history is due with no deltas', () => {
  const s = summarizeMeasurements([], '2026-11-10');
  assert.equal(s.due, true);
  assert.equal(s.latest, null);
  assert.equal(s.sinceStart, null);
  assert.deepEqual(s.rows, []);
});

test('computes change vs previous and since start, newest first', () => {
  const s = summarizeMeasurements([e('2026-10-26', 96, 80), e('2026-11-02', 95.5, 78.8), e('2026-11-09', 95, 77.9)], '2026-11-10');
  assert.equal(s.rows[0].date, '2026-11-09');
  assert.deepEqual(s.rows[0].change, { bustCm: -0.5, waistCm: -0.9 });
  assert.equal(s.rows[2].change, null);
  assert.deepEqual(s.sinceStart, { bustCm: -1, waistCm: -2.1 });
});

test('due depends on the current week (Monday start)', () => {
  // 2026-11-10 is a Tuesday; week starts Mon 2026-11-09
  assert.equal(summarizeMeasurements([e('2026-11-08', 95, 78)], '2026-11-10').due, true);
  const done = summarizeMeasurements([e('2026-11-09', 95, 78)], '2026-11-10');
  assert.equal(done.due, false);
  assert.equal(done.nextDue, '2026-11-16');
});
