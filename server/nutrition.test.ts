import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAiResult } from './nutrition.js';

test('normalizeAiResult sanitises junk from the model', () => {
  const r = normalizeAiResult({
    items: [
      { name: 'Rice', grams: 150.4, calories: 195.2, protein: 4, carbs: 42, fat: 0.4, confidence: 3 },
      { name: '', grams: 10, calories: 10 }, // dropped: empty name
      { name: 'Weird', grams: -5, calories: 'x', protein: null }, // negatives/NaN -> 0
      'garbage',
    ],
    notes: 'oil hidden',
  });
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].grams, 150);
  assert.equal(r.items[0].confidence, 1); // clamped
  assert.equal(r.items[1].grams, 0);
  assert.equal(r.items[1].calories, 0);
  assert.equal(r.notes, 'oil hidden');
});

test('normalizeAiResult handles non-object input', () => {
  assert.deepEqual(normalizeAiResult(null), { items: [], notes: '' });
});
