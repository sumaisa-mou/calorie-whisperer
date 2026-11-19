import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentFast, eatingWindow, fastingDays, mealFlow, summarizeEating, summarizeFasting, type FastingPlan } from './fasting.js';

const m = (date: string, time: string, calories = 400) => ({ date, time, calories });
// 2026-11-09 is a Monday (weekday 1)
const monday16: FastingPlan = [0, 16, 0, 0, 0, 0, 0];
const all16: FastingPlan = [16, 16, 16, 16, 16, 16, 16];

test('overnight fast = last meal yesterday → first meal today', () => {
  const days = fastingDays([m('2026-11-08', '20:00'), m('2026-11-09', '12:30'), m('2026-11-09', '19:30')], '2026-11-09', '2026-11-09', monday16);
  assert.equal(days[0].fastHours, 16.5);
  assert.equal(days[0].firstMeal, '12:30');
  assert.equal(days[0].lastMeal, '19:30');
  assert.equal(days[0].windowHours, 7);
  assert.equal(days[0].hit, true);
});

test('goal depends on the weekday; days without a goal have no hit/miss', () => {
  const meals = [m('2026-11-08', '20:00'), m('2026-11-09', '09:00'), m('2026-11-10', '09:00')];
  const [mon, tue] = fastingDays(meals, '2026-11-09', '2026-11-10', monday16);
  assert.equal(mon.goalHours, 16);
  assert.equal(mon.hit, false); // 13h < 16h
  assert.equal(tue.goalHours, 0);
  assert.equal(tue.hit, null);
});

test('meals under 50 kcal do not break the fast', () => {
  const days = fastingDays([m('2026-11-08', '20:00'), m('2026-11-09', '07:00', 5), m('2026-11-09', '12:00')], '2026-11-09', '2026-11-09', monday16);
  assert.equal(days[0].fastHours, 16);
  assert.equal(days[0].firstMeal, '12:00');
});

test('no meals / no earlier meal gives null', () => {
  const days = fastingDays([m('2026-11-09', '12:00')], '2026-11-08', '2026-11-09', all16);
  assert.equal(days[0].fastHours, null);
  assert.equal(days[1].fastHours, null); // nothing before it to measure from
  assert.equal(days[1].hit, null);
  assert.deepEqual(fastingDays([], '2026-11-09', '2026-11-09', all16)[0].firstMeal, null);
});

test('a skipped day gives a long fast on the next eating day', () => {
  const days = fastingDays([m('2026-11-07', '20:00'), m('2026-11-09', '12:00')], '2026-11-08', '2026-11-09', all16);
  assert.equal(days[0].fastHours, null);
  assert.equal(days[1].fastHours, 40);
});

test('current fast before eating today targets today; after eating it targets tomorrow', () => {
  const plan: FastingPlan = [0, 16, 12, 0, 0, 0, 0]; // Mon 16, Tue 12
  const before = currentFast([m('2026-11-08', '20:00')], '2026-11-09', '10:00', plan)!;
  assert.equal(before.elapsedHours, 14);
  assert.equal(before.goalHours, 16);
  assert.equal(before.done, false);
  assert.equal(before.reachedTime, '12:00');
  assert.equal(before.reachedDate, '2026-11-09');

  const after = currentFast([m('2026-11-09', '12:00'), m('2026-11-09', '19:00')], '2026-11-09', '21:00', plan)!;
  assert.equal(after.elapsedHours, 2);
  assert.equal(after.goalDate, '2026-11-10');
  assert.equal(after.goalHours, 12);
  assert.equal(after.reachedDate, '2026-11-10');
  assert.equal(after.reachedTime, '07:00');
});

test('current fast: done once the goal passes, null with no meals, crosses midnight', () => {
  const done = currentFast([m('2026-11-08', '20:00')], '2026-11-09', '13:00', monday16)!;
  assert.equal(done.done, true);
  assert.equal(done.elapsedHours, 17);
  assert.equal(currentFast([], '2026-11-09', '13:00', monday16), null);
  assert.equal(currentFast([m('2026-11-08', '23:30')], '2026-11-09', '00:30', monday16)!.elapsedHours, 1);
});

test('summary: average, longest, hits and streak', () => {
  const meals = [
    m('2026-11-08', '20:00'), m('2026-11-09', '12:00'), // Mon 16h hit
    m('2026-11-09', '20:00'), m('2026-11-10', '09:00'), // Tue 13h miss
    m('2026-11-10', '20:00'), m('2026-11-11', '12:00'), // Wed 16h hit
    m('2026-11-11', '20:00'), m('2026-11-12', '12:00'), // Thu 16h hit
  ];
  const s = summarizeFasting(fastingDays(meals, '2026-11-09', '2026-11-12', all16));
  assert.equal(s.planned, 4);
  assert.equal(s.hits, 3);
  assert.equal(s.streak, 2);
  assert.equal(s.longestHours, 16);
  assert.equal(s.avgHours, 15.3);
  assert.deepEqual(summarizeFasting([]), { avgHours: null, longestHours: null, planned: 0, hits: 0, streak: 0 });
});

test('eating window: none before the first meal, open then closed after 24 − goal hours', () => {
  const plan: FastingPlan = [0, 16, 0, 0, 0, 0, 0]; // Monday 16:8
  assert.equal(eatingWindow([m('2026-11-08', '20:00')], '2026-11-09', '09:00', plan).state, 'none');

  const meals = [m('2026-11-09', '12:00', 500), m('2026-11-09', '15:00', 300), m('2026-11-09', '08:00', 10)];
  const open = eatingWindow(meals, '2026-11-09', '16:30', plan);
  assert.equal(open.state, 'open');
  assert.equal(open.windowHours, 8);
  assert.equal(open.firstTime, '12:00'); // the 10 kcal item does not open the window
  assert.equal(open.lastTime, '15:00');
  assert.equal(open.meals, 2);
  assert.equal(open.kcal, 800);
  assert.equal(open.closeTime, '20:00');
  assert.equal(open.elapsedHours, 4.5);
  assert.equal(open.remainingHours, 3.5);

  const closed = eatingWindow(meals, '2026-11-09', '20:00', plan);
  assert.equal(closed.state, 'closed');
  assert.equal(closed.remainingHours, 0);
});

test('eating window: no goal today means no limit; closing time can pass midnight', () => {
  const free = eatingWindow([m('2026-11-10', '09:00')], '2026-11-10', '23:00', [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(free.state, 'open');
  assert.equal(free.windowHours, 0);
  assert.equal(free.closeTime, null);
  const late = eatingWindow([m('2026-11-09', '18:00')], '2026-11-09', '19:00', [0, 12, 0, 0, 0, 0, 0]);
  assert.equal(late.closeDate, '2026-11-10');
  assert.equal(late.closeTime, '06:00');
});

test('windowOk and eating summary', () => {
  const meals = [
    m('2026-11-09', '12:00'), m('2026-11-09', '19:00'), // 7h within 8h
    m('2026-11-10', '10:00'), m('2026-11-10', '21:00'), // 11h > 8h
  ];
  const days = fastingDays(meals, '2026-11-09', '2026-11-10', [0, 16, 16, 0, 0, 0, 0]);
  assert.equal(days[0].allowedWindowHours, 8);
  assert.equal(days[0].windowOk, true);
  assert.equal(days[1].windowOk, false);
  assert.deepEqual(summarizeEating(days), { avgWindowHours: 9, planned: 2, within: 1 });
  assert.equal(fastingDays(meals, '2026-11-09', '2026-11-09', [0, 0, 0, 0, 0, 0, 0])[0].windowOk, null);
});

test('the 50 kcal limit: 49 is ignored, 50 counts', () => {
  const ignored = fastingDays([m('2026-11-08', '20:00'), m('2026-11-09', '07:00', 49), m('2026-11-09', '12:00')], '2026-11-09', '2026-11-09', all16);
  assert.equal(ignored[0].firstMeal, '12:00');
  const counts = fastingDays([m('2026-11-08', '20:00'), m('2026-11-09', '07:00', 50), m('2026-11-09', '12:00')], '2026-11-09', '2026-11-09', all16);
  assert.equal(counts[0].firstMeal, '07:00');
  assert.equal(counts[0].fastHours, 11);
});

test('meal flow: gaps between meals, overnight gap to the next meal (lunch when breakfast is skipped)', () => {
  const t = (date: string, time: string, mealType: string, calories = 400) => ({ date, time, mealType, calories });
  const flow = mealFlow(
    [
      t('2026-11-09', '08:00', 'breakfast'), t('2026-11-09', '12:00', 'lunch'), t('2026-11-09', '17:00', 'snack'), t('2026-11-09', '20:00', 'dinner'),
      t('2026-11-10', '12:30', 'lunch'), // breakfast skipped
      t('2026-11-10', '07:00', 'snack', 40), // under the limit: ignored
    ],
    '2026-11-09',
    '2026-11-10',
  );
  assert.equal(flow.length, 2);
  assert.deepEqual(flow[0].meals.map((x) => x.mealType), ['breakfast', 'lunch', 'snack', 'dinner']);
  assert.deepEqual(flow[0].gaps, [4, 5, 3]);
  assert.deepEqual(flow[0].overnight, { hours: 16.5, mealType: 'lunch', date: '2026-11-10', time: '12:30' });
  assert.deepEqual(flow[1].gaps, []);
  assert.equal(flow[1].overnight, null); // nothing logged after it yet
});
