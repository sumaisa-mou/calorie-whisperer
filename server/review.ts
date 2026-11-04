/**
 * AI review of a day that went over the calorie target.
 *
 * Each meal is tagged:  necessary  |  improve  |  avoidable
 * The model judges by purpose + nutritional quality (not by calories alone); the server then enforces
 * the hard rules itself, because a model must never be the only thing standing between a user and a bad label.
 */
import { generateJSON, type Schema } from './llm.js';
import { round } from '../shared/calc.js';
import type { Meal, MealReview, MealVerdict } from '../shared/types.js';

export const REVIEW_SYSTEM = `You are a practical, kind nutrition coach inside a personal weight-loss tracker.
The user went OVER their daily calorie target. Review the meals they logged that day and tag each one, so they can see where the extra calories came from.

Give every meal exactly one verdict:
- "necessary": the body genuinely needed it — a balanced main meal (breakfast, lunch, dinner) or a protein/fibre-rich snack that fills a real gap. Keep it "necessary" even if the meal is big.
- "improve": a meal the user needed to eat, but a clearly lighter or healthier version was possible (heavy oil/ghee/butter, deep-fried, refined-carb heavy, oversized portion, sugary sauce). Eating it was right; the choice or portion was not ideal.
- "avoidable": food the body did not need — sweets, desserts, sugary drinks or juice, chips and other packaged snacks, fried extras, repeat snacking, late-night eating. Mostly empty calories with little protein or fibre.

How to decide (follow in this order):
1. Judge by PURPOSE and NUTRITIONAL QUALITY, never by calories alone. A 700 kcal home-cooked dal, rice and vegetable dinner is "necessary"; a 250 kcal pastry is "avoidable".
2. Breakfast, lunch and dinner are NEVER "avoidable" — skipping main meals is not the advice. If a main meal is unhealthy, use "improve". Only snacks, and desserts or sugary drinks inside a meal, can be "avoidable".
3. Use the per-meal numbers: protein and fibre with moderate calories support weight loss; high sugar or fat with little protein/fibre does not. Also consider time of day (eating very late at night is a weak reason to eat).
4. If the user is only slightly over target (under about 5%), be gentle: prefer "necessary" or "improve" and avoid labelling many meals "avoidable".
5. It is fine, and common, for every meal to be "necessary". NEVER invent problems just to explain the overshoot.
6. savableKcal: a realistic estimate of calories that could have been saved — the whole meal for an avoidable one, the difference to a lighter version for "improve", 0 for "necessary". Never more than that meal's calories.
7. avoidItems: names copied exactly from that meal's item list that were the weak spot (max 3). Empty array if none.
8. reason: ONE short sentence (max 20 words), concrete, non-judgemental, mentioning the food itself. Plain language, no medical claims.
9. summary: at most 2 sentences on where the extra calories mostly came from. tip: one specific, easy suggestion for tomorrow.
10. Respect regional cuisines (dal, roti, rice, curry, idli, dosa, etc.). Staples are not bad because they are carbohydrates — judge the oil, sugar, frying and portion size.

Output valid JSON only. Use the meal ids exactly as given and include an entry for EVERY meal.`;

const RESPONSE_SCHEMA: Schema = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    tip: { type: 'STRING' },
    meals: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'INTEGER', description: 'meal id exactly as given' },
          verdict: { type: 'STRING', description: 'one of: necessary, improve, avoidable' },
          reason: { type: 'STRING' },
          savableKcal: { type: 'NUMBER' },
          avoidItems: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['id', 'verdict', 'reason', 'savableKcal', 'avoidItems'],
      },
    },
  },
  required: ['summary', 'tip', 'meals'],
};

export interface ReviewContext {
  date: string;
  targetKcal: number;
  eatenKcal: number;
  weeklyLossKg?: number;
  meals: Meal[];
}

/** The per-request message: the facts the model needs, nothing else. */
export function buildReviewPrompt(c: ReviewContext): string {
  const over = c.eatenKcal - c.targetKcal;
  const lines = [
    `Date: ${c.date}`,
    `Daily calorie target: ${round(c.targetKcal)} kcal. Eaten: ${round(c.eatenKcal)} kcal — over by ${round(over)} kcal (${round((over / c.targetKcal) * 100)}%).`,
    c.weeklyLossKg ? `Goal: lose weight, about ${c.weeklyLossKg} kg per week.` : 'Goal: lose weight.',
    '',
    'Meals:',
  ];
  for (const m of c.meals) {
    lines.push(
      `id=${m.id} | ${m.mealType} | ${m.time} | ${round(m.calories)} kcal | protein ${round(m.protein)} g | carbs ${round(m.carbs)} g | fat ${round(m.fat)} g | fibre ${round(m.fiber)} g | sugar ${round(m.sugar)} g | sodium ${round(m.sodium)} mg`,
      `  items: ${m.items.map((i) => `${i.name} (${round(i.grams)} g, ${round(i.calories)} kcal)`).join('; ')}`,
    );
    if (m.note) lines.push(`  note: ${m.note}`);
  }
  return lines.join('\n');
}

const MAIN_MEALS = new Set(['breakfast', 'lunch', 'dinner']);
const VERDICTS = new Set<MealVerdict>(['necessary', 'improve', 'avoidable']);

/** Validate whatever the model produced and apply the hard rules. */
export function normalizeReview(raw: unknown, meals: Meal[]): { summary: string; tip: string; meals: MealReview[] } {
  const obj = (raw ?? {}) as { summary?: unknown; tip?: unknown; meals?: unknown };
  const byId = new Map(meals.map((m) => [m.id, m]));
  const out = new Map<number, MealReview>();

  for (const r of Array.isArray(obj.meals) ? obj.meals : []) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    const meal = byId.get(Number(o.id));
    if (!meal || out.has(meal.id)) continue; // unknown or duplicate id

    let verdict = VERDICTS.has(o.verdict as MealVerdict) ? (o.verdict as MealVerdict) : 'necessary';
    // Hard rule: a main meal can be improved, never "avoidable".
    if (verdict === 'avoidable' && MAIN_MEALS.has(meal.mealType)) verdict = 'improve';

    const saved = typeof o.savableKcal === 'number' && Number.isFinite(o.savableKcal) ? o.savableKcal : 0;
    const names = new Set(meal.items.map((i) => i.name));
    out.set(meal.id, {
      id: meal.id,
      calories: round(meal.calories),
      verdict,
      reason: typeof o.reason === 'string' ? o.reason.trim().slice(0, 200) : '',
      savableKcal: verdict === 'necessary' ? 0 : round(Math.min(Math.max(0, saved), meal.calories)),
      avoidItems: (Array.isArray(o.avoidItems) ? o.avoidItems : [])
        .filter((n): n is string => typeof n === 'string' && names.has(n)) // only real item names
        .slice(0, 3),
    });
  }
  return {
    summary: typeof obj.summary === 'string' ? obj.summary.trim().slice(0, 400) : '',
    tip: typeof obj.tip === 'string' ? obj.tip.trim().slice(0, 300) : '',
    meals: meals.flatMap((m) => out.get(m.id) ?? []),
  };
}

export async function reviewDay(c: ReviewContext) {
  const raw = await generateJSON({
    system: REVIEW_SYSTEM,
    parts: [{ text: buildReviewPrompt(c) }],
    schema: RESPONSE_SCHEMA,
  });
  return normalizeReview(raw, c.meals);
}
