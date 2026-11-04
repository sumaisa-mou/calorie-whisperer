import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewPrompt, normalizeReview } from './review.js';
import type { Meal } from '../shared/types.js';

const meal = (id: number, mealType: Meal['mealType'], calories: number, names: string[]): Meal => ({
  id,
  date: '2026-11-03',
  time: '13:00',
  mealType,
  note: '',
  items: names.map((name) => ({ name, grams: 100, calories: calories / names.length, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 })),
  calories,
  protein: 20,
  carbs: 50,
  fat: 10,
  fiber: 5,
  sugar: 4,
  sodium: 300,
});

const meals = [meal(1, 'lunch', 600, ['Rice', 'Dal']), meal(2, 'snack', 300, ['Chips', 'Cola'])];

test('prompt carries the numbers, ids and the overshoot', () => {
  const p = buildReviewPrompt({ date: '2026-11-03', targetKcal: 1100, eatenKcal: 1269, weeklyLossKg: 0.5, meals });
  assert.match(p, /over by 169 kcal \(15%\)/);
  assert.match(p, /id=1 \| lunch/);
  assert.match(p, /id=2 \| snack/);
  assert.match(p, /Chips \(100 g/);
});

test('a main meal can never be "avoidable" — downgraded to "improve"', () => {
  const r = normalizeReview({ summary: 's', tip: 't', meals: [{ id: 1, verdict: 'avoidable', reason: 'x', savableKcal: 100, avoidItems: [] }] }, meals);
  assert.equal(r.meals[0].verdict, 'improve');
});

test('savable kcal is clamped, necessary meals save 0, unknown ids/items dropped', () => {
  const r = normalizeReview(
    {
      summary: 's',
      tip: 't',
      meals: [
        { id: 2, verdict: 'avoidable', reason: 'sugary', savableKcal: 9999, avoidItems: ['Cola', 'Made up item'] },
        { id: 1, verdict: 'necessary', reason: 'balanced', savableKcal: 50, avoidItems: [] },
        { id: 99, verdict: 'avoidable', reason: 'ghost', savableKcal: 1, avoidItems: [] },
      ],
    },
    meals,
  );
  assert.deepEqual(r.meals.map((m) => m.id), [1, 2]); // only real meals, in meal order
  assert.equal(r.meals[0].savableKcal, 0);
  assert.equal(r.meals[1].savableKcal, 300); // clamped to the meal's calories
  assert.deepEqual(r.meals[1].avoidItems, ['Cola']);
});

test('junk output degrades gracefully', () => {
  assert.deepEqual(normalizeReview(null, meals), { summary: '', tip: '', meals: [] });
  const r = normalizeReview({ meals: [{ id: 1, verdict: 'banana', reason: 5 }] }, meals);
  assert.equal(r.meals[0].verdict, 'necessary');
  assert.equal(r.meals[0].reason, '');
});
