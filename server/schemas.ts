import { z } from 'zod';
import { isDateStr } from '../shared/dates.js';

const dateStr = z.string().refine(isDateStr, 'Expected YYYY-MM-DD');
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');
const num = (min: number, max: number) => z.number().finite().min(min).max(max);

export const profileSchema = z.object({
  sex: z.enum(['female', 'male']),
  dob: dateStr,
  heightCm: num(100, 250),
  activity: z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']),
  goalWeightKg: num(30, 250),
  weeklyLossKg: num(0, 1.5),
  timezone: z.string().min(1).refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown timezone'),
  weekStart: z.union([z.literal(0), z.literal(1)]),
});

export const weightSchema = z.object({
  date: dateStr,
  kg: num(20, 400),
});

export const foodItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  grams: num(0, 5000),
  calories: num(0, 10000),
  protein: num(0, 1000).default(0),
  carbs: num(0, 1000).default(0),
  fat: num(0, 1000).default(0),
  fiber: num(0, 500).default(0),
  sugar: num(0, 1000).default(0),
  sodium: num(0, 50000).default(0),
  confidence: num(0, 1).optional(),
});

export const mealSchema = z.object({
  date: dateStr,
  time: timeStr,
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  note: z.string().max(500).default(''),
  items: z.array(foodItemSchema).min(1).max(40),
});

export const analyzeSchema = z.object({
  // base64 (no data: prefix)
  image: z.string().min(100).max(6_000_000),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']).default('image/jpeg'),
  note: z.string().max(500).default(''),
});

export const textMealSchema = z.object({ text: z.string().trim().min(2).max(1000) });

export const chatSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .min(1)
    .max(30),
  today: dateStr,
});

export const loginSchema = z.object({ password: z.string().min(1).max(200) });

export const rangeQuery = z.object({ from: dateStr, to: dateStr });
