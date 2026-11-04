import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bmi,
  bmiCategory,
  bmr,
  calorieTarget,
  healthyRange,
  inchesToCm,
  scaleItem,
  summarizeWeights,
  tdee,
  weeklyAverages,
  monthlyAverages,
  projectFromIntake,
  rangeDifference,
  balanceRows,
  balanceTotals,
} from './calc.js';
import { addDays, weekStartOf, ageOn, isDateStr } from './dates.js';
import type { Profile } from './types.js';

const profile: Profile = {
  sex: 'female',
  dob: '1995-01-01',
  heightCm: inchesToCm(5, 4.5),
  activity: 'light',
  goalWeightKg: 60,
  weeklyLossKg: 0.5,
  timezone: 'Asia/Dhaka',
  weekStart: 1,
};

test('5ft 4.5in is ~163.8 cm', () => {
  assert.ok(Math.abs(profile.heightCm - 163.83) < 0.01);
});

test('BMR / TDEE for the example profile (73 kg)', () => {
  const b = bmr('female', 73, profile.heightCm, 31);
  assert.ok(Math.abs(b - 1438) < 1, `bmr ${b}`);
  assert.ok(Math.abs(tdee(b, 'light') - 1977) < 2);
});

test('BMI and healthy range', () => {
  const v = bmi(73, profile.heightCm);
  assert.equal(Math.round(v * 10) / 10, 27.2);
  assert.equal(bmiCategory(v), 'overweight');
  const r = healthyRange(profile.heightCm);
  assert.equal(r.min, 49.7);
  assert.equal(r.max, 66.8);
  assert.equal(rangeDifference(73, r), 6.2);
  assert.equal(rangeDifference(60, r), 0);
  assert.equal(rangeDifference(45, r), -4.7);
});

test('calorie target at 0.5 kg/week', () => {
  const t = calorieTarget(profile, 73, '2026-11-03');
  assert.ok(Math.abs(t.target - 1427) < 3, `target ${t.target}`);
  assert.equal(t.clamped, false);
});

test('calorie target is clamped to the safety floor', () => {
  const t = calorieTarget({ ...profile, weeklyLossKg: 1 }, 73, '2026-11-03');
  assert.equal(t.clamped, true);
  assert.equal(t.target, 1200);
  assert.ok(t.effectiveWeeklyLossKg < 1);
});

test('week start and dates', () => {
  assert.equal(weekStartOf('2026-11-03', 1), '2026-11-02'); // Tue -> Mon
  assert.equal(weekStartOf('2026-11-02', 1), '2026-11-02');
  assert.equal(weekStartOf('2026-11-08', 1), '2026-11-02'); // Sun
  assert.equal(weekStartOf('2026-11-08', 0), '2026-11-08');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(ageOn('1995-11-04', '2026-11-03'), 30);
  assert.equal(ageOn('1995-11-03', '2026-11-03'), 31);
  assert.ok(!isDateStr('2026-02-30'));
});

test('weekly + monthly averages use logged days only', () => {
  const pts = [
    { date: '2026-10-26', kg: 74 },
    { date: '2026-10-28', kg: 73 }, // week of Oct 26 -> avg 73.5
    { date: '2026-11-02', kg: 72.5 },
    { date: '2026-11-03', kg: 72.1 },
    { date: '2026-11-04', kg: 72.9 }, // week of Nov 2 -> avg 72.5
  ];
  const w = weeklyAverages(pts);
  assert.deepEqual(
    w.map((x) => [x.key, x.avg, x.change]),
    [
      ['2026-10-26', 73.5, null],
      ['2026-11-02', 72.5, -1],
    ],
  );
  const m = monthlyAverages(pts);
  assert.equal(m.length, 2);
  const s = summarizeWeights(pts, '2026-11-04');
  assert.equal(s.weekChange, -1);
  assert.equal(s.totalChange, -1.1);
  assert.equal(s.latest?.kg, 72.9);
});

test('scaleItem rescales nutrients', () => {
  const item = {
    name: 'rice', grams: 100, calories: 130, protein: 2.7, carbs: 28, fat: 0.3,
    fiber: 0.4, sugar: 0, sodium: 1,
  };
  const s = scaleItem(item, 150);
  assert.equal(s.calories, 195);
  assert.equal(s.carbs, 42);
});

test('projection ignores unlogged days', () => {
  const p = projectFromIntake([1500, 0, 1700], 2000)!;
  assert.equal(p.days, 2);
  assert.equal(p.avgConsumed, 1600);
  assert.equal(p.kgPerWeek, round2((-400 * 7) / 7700));
  assert.equal(projectFromIntake([0, 0], 2000), null);
});
const round2 = (n: number) => Math.round(n * 100) / 100;

test('daily balance rows: grams from calorie surplus/deficit, unlogged days ignored', () => {
  const rows = balanceRows(
    ['2026-11-01', '2026-11-02', '2026-11-03'],
    new Map([['2026-11-01', 1500], ['2026-11-03', 2500]]),
    2000,
  );
  assert.equal(rows[0].diff, -500);
  assert.equal(rows[0].grams, -65); // -500 / 7700 kg = -64.9 g
  assert.equal(rows[1].consumed, null);
  assert.equal(rows[1].grams, null);
  assert.equal(rows[2].grams, 65);
  const t = balanceTotals(rows);
  assert.deepEqual(t, { days: 2, needed: 4000, burned: 0, consumed: 4000, diff: 0, grams: 0 });
});

test('balanceRows counts workout burn in the daily balance', () => {
  const rows = balanceRows(['2026-11-03'], new Map([['2026-11-03', 2000]]), 2000, new Map([['2026-11-03', 385]]));
  assert.equal(rows[0].burned, 385);
  assert.equal(rows[0].diff, -385);
  assert.equal(rows[0].grams, -50);
  assert.equal(balanceTotals(rows).burned, 385);
});
