import { z } from 'zod';
import { generateJSON, type Part, type Schema } from './llm.js';
import { foodItemSchema } from './schemas.js';
import { round } from '../shared/calc.js';
import type { AnalyzeResult, FoodItem, FoodSearchHit, Nutrients } from '../shared/types.js';

// ------------------------------------------------------------------ AI estimation

const SYSTEM = `You are a careful nutrition-estimation assistant inside a personal weight-loss tracker.
You receive a photo and/or text describing ONE meal. Identify every distinct food or drink and estimate:
- the weight in grams of the portion as served (cooked weight for cooked foods),
- calories (kcal), protein, carbs, fat, fiber, sugar (grams) and sodium (mg) for THAT portion.

Rules:
- Be realistic, not optimistic. Include cooking oil, ghee, butter, sauces and dressings when they are likely present
  (add them as separate items or fold them into the dish and mention it in the item name).
- Recognise regional dishes (e.g. dal, curry, roti, biryani, sushi) and use typical recipes.
- Use plate size, cutlery and containers as scale references. If the user note gives quantities, trust it over the image.
- Split mixed plates into separate items; do not output a single lump called "meal".
- confidence is 0..1 (how sure you are about identification AND portion).
- notes: one or two short sentences about the main uncertainty (e.g. hidden oil, portion depth). Plain text.
- If the image contains no food, return an empty items array and explain in notes.`;

const nutrientProps: Record<string, Schema> = {
  name: { type: 'STRING' },
  grams: { type: 'NUMBER', description: 'portion weight in grams' },
  calories: { type: 'NUMBER', description: 'kcal for the whole portion' },
  protein: { type: 'NUMBER' },
  carbs: { type: 'NUMBER' },
  fat: { type: 'NUMBER' },
  fiber: { type: 'NUMBER' },
  sugar: { type: 'NUMBER' },
  sodium: { type: 'NUMBER', description: 'milligrams' },
  confidence: { type: 'NUMBER' },
};

const RESPONSE_SCHEMA: Schema = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: nutrientProps,
        required: ['name', 'grams', 'calories', 'protein', 'carbs', 'fat'],
      },
    },
    notes: { type: 'STRING' },
  },
  required: ['items', 'notes'],
};

const clean = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0);

/** Validate + sanitise whatever the model produced into FoodItems. */
export function normalizeAiResult(raw: unknown): AnalyzeResult {
  const obj = (raw ?? {}) as { items?: unknown[]; notes?: unknown };
  const items: FoodItem[] = [];
  for (const r of Array.isArray(obj.items) ? obj.items : []) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    if (typeof o.name !== 'string') continue;
    const parsed = foodItemSchema.safeParse({
      name: o.name.slice(0, 120),
      grams: Math.min(clean(o.grams), 5000),
      calories: Math.min(clean(o.calories), 10000),
      protein: Math.min(clean(o.protein), 1000),
      carbs: Math.min(clean(o.carbs), 1000),
      fat: Math.min(clean(o.fat), 1000),
      fiber: Math.min(clean(o.fiber), 500),
      sugar: Math.min(clean(o.sugar), 1000),
      sodium: Math.min(clean(o.sodium), 50000),
      confidence: typeof o.confidence === 'number' ? Math.min(1, Math.max(0, o.confidence)) : undefined,
    });
    if (parsed.success) items.push(roundItem(parsed.data));
  }
  return { items, notes: typeof obj.notes === 'string' ? obj.notes.slice(0, 600) : '' };
}

function roundItem(i: FoodItem): FoodItem {
  return {
    ...i,
    grams: round(i.grams),
    calories: round(i.calories),
    protein: round(i.protein, 1),
    carbs: round(i.carbs, 1),
    fat: round(i.fat, 1),
    fiber: round(i.fiber, 1),
    sugar: round(i.sugar, 1),
    sodium: round(i.sodium),
  };
}

async function estimate(parts: Part[]): Promise<AnalyzeResult> {
  const raw = await generateJSON({ system: SYSTEM, parts, schema: RESPONSE_SCHEMA });
  const result = normalizeAiResult(raw);
  return { ...result, items: await reconcileWithUsda(result.items) };
}

/** Photo (and optional note). The image only lives in memory for this request. */
export function analyzeImage(image: string, mimeType: string, note: string) {
  const text = note.trim()
    ? `Analyse this meal photo. User note: ${note.trim()}`
    : 'Analyse this meal photo.';
  return estimate([{ inlineData: { mimeType, data: image } }, { text }]);
}

export function analyzeText(description: string) {
  return estimate([{ text: `Estimate the nutrition for this meal: ${description}` }]);
}

// ------------------------------------------------------------------ USDA cross-check (optional)

const USDA_IDS = {
  calories: 1008,
  protein: 1003,
  fat: 1004,
  carbs: 1005,
  fiber: 1079,
  sugar: 2000,
  sodium: 1093,
} as const;

interface UsdaFood {
  description?: string;
  foodNutrients?: { nutrientId?: number; value?: number }[];
}

function per100gFromUsda(f: UsdaFood): Nutrients | null {
  const get = (id: number) => f.foodNutrients?.find((n) => n.nutrientId === id)?.value;
  const calories = get(USDA_IDS.calories);
  if (typeof calories !== 'number') return null;
  return {
    calories,
    protein: get(USDA_IDS.protein) ?? 0,
    carbs: get(USDA_IDS.carbs) ?? 0,
    fat: get(USDA_IDS.fat) ?? 0,
    fiber: get(USDA_IDS.fiber) ?? 0,
    sugar: get(USDA_IDS.sugar) ?? 0,
    sodium: get(USDA_IDS.sodium) ?? 0,
  };
}

/**
 * If USDA_API_KEY is set, replace the model's nutrient numbers with database values
 * (keeping the model's gram estimate) — but ONLY when the best USDA match has a calorie
 * density within ±30% of what the model implied. That guards against bad text matches
 * (e.g. "dal" matching something unrelated). Always fails open to the model's numbers.
 */
export async function reconcileWithUsda(items: FoodItem[]): Promise<FoodItem[]> {
  const key = process.env.USDA_API_KEY;
  if (!key) return items;
  return Promise.all(
    items.map(async (item) => {
      if (item.grams <= 0 || item.calories <= 0) return item;
      const modelDensity = (item.calories / item.grams) * 100;
      try {
        const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
        url.searchParams.set('query', item.name);
        url.searchParams.set('pageSize', '5');
        url.searchParams.set('dataType', 'Foundation,SR Legacy');
        url.searchParams.set('api_key', key);
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) return item;
        const data = (await res.json()) as { foods?: UsdaFood[] };
        for (const f of data.foods ?? []) {
          const per100 = per100gFromUsda(f);
          if (!per100) continue;
          if (Math.abs(per100.calories - modelDensity) / Math.max(modelDensity, 1) > 0.3) continue;
          const r = item.grams / 100;
          return roundItem({
            ...item,
            calories: per100.calories * r,
            protein: per100.protein * r,
            carbs: per100.carbs * r,
            fat: per100.fat * r,
            fiber: per100.fiber * r,
            sugar: per100.sugar * r,
            sodium: per100.sodium * r,
          });
        }
      } catch {
        /* fail open */
      }
      return item;
    }),
  );
}

// ------------------------------------------------------------------ Open Food Facts search

const offSchema = z.object({
  products: z
    .array(
      z.object({
        product_name: z.string().optional(),
        brands: z.string().optional(),
        nutriments: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .default([]),
});

const numOf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

export async function searchFoods(q: string): Promise<FoodSearchHit[]> {
  const url = new URL('https://world.openfoodfacts.org/cgi/search.pl');
  url.searchParams.set('search_terms', q);
  url.searchParams.set('search_simple', '1');
  url.searchParams.set('action', 'process');
  url.searchParams.set('json', '1');
  url.searchParams.set('page_size', '15');
  url.searchParams.set('fields', 'product_name,brands,nutriments');
  const res = await fetch(url, {
    headers: { 'user-agent': 'PersonalFitnessTracker/1.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const parsed = offSchema.safeParse(await res.json().catch(() => ({})));
  if (!parsed.success) return [];
  const hits: FoodSearchHit[] = [];
  for (const p of parsed.data.products) {
    const n = p.nutriments;
    if (!p.product_name || !n || n['energy-kcal_100g'] === undefined) continue;
    hits.push({
      name: p.product_name.slice(0, 120),
      brand: (p.brands ?? '').split(',')[0].trim(),
      per100g: {
        calories: round(numOf(n['energy-kcal_100g'])),
        protein: round(numOf(n['proteins_100g']), 1),
        carbs: round(numOf(n['carbohydrates_100g']), 1),
        fat: round(numOf(n['fat_100g']), 1),
        fiber: round(numOf(n['fiber_100g']), 1),
        sugar: round(numOf(n['sugars_100g']), 1),
        sodium: round(numOf(n['sodium_100g']) * 1000),
      },
    });
    if (hits.length >= 10) break;
  }
  return hits;
}
