export type Sex = 'female' | 'male';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Profile {
  sex: Sex;
  dob: string; // YYYY-MM-DD
  heightCm: number;
  activity: Activity;
  goalWeightKg: number;
  weeklyLossKg: number;
  timezone: string;
  weekStart: 0 | 1;
}

export interface WeightEntry {
  date: string;
  kg: number;
}

export interface Nutrients {
  calories: number;
  protein: number; // g
  carbs: number; // g
  fat: number; // g
  fiber: number; // g
  sugar: number; // g
  sodium: number; // mg
}

export interface FoodItem extends Nutrients {
  name: string;
  grams: number;
  confidence?: number; // 0..1, only for AI-estimated items
}

export interface Meal extends Nutrients {
  id: number;
  date: string; // YYYY-MM-DD (user-local day)
  time: string; // HH:MM (user-local)
  mealType: MealType;
  note: string;
  items: FoodItem[];
}

export type MealInput = Omit<Meal, 'id' | keyof Nutrients> & Partial<Nutrients>;

export interface DailyTotal extends Nutrients {
  date: string;
  meals: number;
}

export interface AnalyzeResult {
  items: FoodItem[];
  notes: string;
}

export interface FoodSearchHit {
  name: string;
  brand: string;
  per100g: Nutrients;
}

// ---- AI day review: which meals were needed when a day went over the calorie target
export type MealVerdict = 'necessary' | 'improve' | 'avoidable';

export interface MealReview {
  id: number; // meal id
  calories: number; // meal calories at review time — if the meal is edited later the tag is treated as stale
  verdict: MealVerdict;
  reason: string;
  savableKcal: number;
  avoidItems: string[];
}

export interface DayReview {
  date: string;
  targetKcal: number;
  eatenKcal: number;
  summary: string;
  tip: string;
  meals: MealReview[];
  createdAt: string;
}
