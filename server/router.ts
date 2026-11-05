import { z, ZodError } from 'zod';
import type { InValue } from '@libsql/client';
import { db } from './db.js';
import { checkPassword, HttpError, issueToken, verifyToken } from './auth.js';
import {
  analyzeSchema,
  chatSchema,
  loginSchema,
  mealSchema,
  profileSchema,
  rangeQuery,
  textMealSchema,
  weightSchema,
  workoutSchema,
  settingsSchema,
  planRequestSchema,
} from './schemas.js';
import { analyzeImage, analyzeText, searchFoods } from './nutrition.js';
import { chatText } from './llm.js';
import {
  calorieTarget,
  healthyRange,
  bmi,
  sumNutrients,
  summarizeWeights,
  weeklyAverages,
  round,
} from '../shared/calc.js';
import { addDays, ageOn, diffDays, isDateStr, weekStartOf } from '../shared/dates.js';
import type { DailyTotal, DayReview, FoodItem, Meal, Profile, WeightEntry } from '../shared/types.js';
import { reviewDay } from './review.js';
import { planSession } from './plan.js';
import { estimateWorkout, type GymItem, type Workout } from '../shared/workout.js';

export interface ApiRequest {
  method: string;
  /** path after /api, e.g. "/meals/12" */
  path: string;
  query: URLSearchParams;
  body: unknown;
  authorization?: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

type Ctx = { req: ApiRequest; params: string[] };
type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

const ok = (body: unknown, status = 200): ApiResponse => ({ status, body });

// ------------------------------------------------------------------ row mappers

type Row = Record<string, InValue>;

const rowToProfile = (r: Row): Profile => ({
  sex: r.sex as Profile['sex'],
  dob: String(r.dob),
  heightCm: Number(r.height_cm),
  activity: r.activity as Profile['activity'],
  goalWeightKg: Number(r.goal_weight_kg),
  weeklyLossKg: Number(r.weekly_loss_kg),
  timezone: String(r.timezone),
  weekStart: Number(r.week_start) === 0 ? 0 : 1,
});

const rowToMeal = (r: Row): Meal => ({
  id: Number(r.id),
  date: String(r.date),
  time: String(r.time),
  mealType: r.meal_type as Meal['mealType'],
  note: String(r.note ?? ''),
  items: JSON.parse(String(r.items)) as FoodItem[],
  calories: Number(r.calories),
  protein: Number(r.protein),
  carbs: Number(r.carbs),
  fat: Number(r.fat),
  fiber: Number(r.fiber),
  sugar: Number(r.sugar),
  sodium: Number(r.sodium),
});

const rowToWorkout = (r: Row): Workout => ({
  id: Number(r.id),
  date: String(r.date),
  time: String(r.time),
  kind: r.kind === 'gym' ? 'gym' : 'walk',
  minutes: Number(r.minutes),
  steps: Number(r.steps),
  items: JSON.parse(String(r.items)) as GymItem[],
  note: String(r.note ?? ''),
  kcal: Number(r.kcal),
});

async function loadWorkouts(from: string, to: string): Promise<Workout[]> {
  const c = await db();
  const res = await c.execute({
    sql: 'SELECT * FROM workouts WHERE date >= ? AND date <= ? ORDER BY date, time, id',
    args: [from, to],
  });
  return res.rows.map((r) => rowToWorkout(r as unknown as Row));
}

/** Estimated burn uses your weight on that day (or the nearest earlier/first entry). */
async function estimateFor(input: z.infer<typeof workoutSchema>) {
  const weights = await loadWeights();
  if (weights.length === 0) throw new HttpError(400, 'Log your weight first — calories burned depend on it.');
  const w = [...weights].reverse().find((x) => x.date <= input.date) ?? weights[0];
  const profile = await getProfile();
  return estimateWorkout(input, w.kg, profile?.heightCm);
}

async function getProfile(): Promise<Profile | null> {
  const c = await db();
  const res = await c.execute('SELECT * FROM profile WHERE id = 1');
  return res.rows[0] ? rowToProfile(res.rows[0] as unknown as Row) : null;
}

async function loadMeals(from: string, to: string): Promise<Meal[]> {
  const c = await db();
  const res = await c.execute({
    sql: 'SELECT * FROM meals WHERE date >= ? AND date <= ? ORDER BY date, time, id',
    args: [from, to],
  });
  return res.rows.map((r) => rowToMeal(r as unknown as Row));
}

async function loadWeights(from?: string, to?: string): Promise<WeightEntry[]> {
  const c = await db();
  const res = await c.execute({
    sql: 'SELECT date, kg FROM weights WHERE date >= ? AND date <= ? ORDER BY date',
    args: [from ?? '0000-01-01', to ?? '9999-12-31'],
  });
  return res.rows.map((r) => ({ date: String(r.date), kg: Number(r.kg) }));
}

function range(q: URLSearchParams) {
  const parsed = rangeQuery.parse({ from: q.get('from'), to: q.get('to') });
  if (parsed.from > parsed.to) throw new HttpError(400, '`from` must be before `to`.');
  if (diffDays(parsed.to, parsed.from) > 400) throw new HttpError(400, 'Range too large (max 400 days).');
  return parsed;
}

function mealRow(input: z.infer<typeof mealSchema>) {
  // totals are always derived from the items, never trusted from the client
  const t = sumNutrients(input.items);
  return {
    items: JSON.stringify(input.items),
    ...t,
  };
}

// ------------------------------------------------------------------ handlers

const routes: { method: string; re: RegExp; auth: boolean; fn: Handler }[] = [];
const route = (method: string, pattern: string, fn: Handler, auth = true) => {
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '/?$');
  routes.push({ method, re, auth, fn });
};

route(
  'POST',
  '/login',
  async ({ req }) => {
    const { password } = loginSchema.parse(req.body);
    if (!checkPassword(password)) {
      await new Promise((r) => setTimeout(r, 800)); // slow down guessing
      throw new HttpError(401, 'Wrong password.');
    }
    return { token: issueToken() };
  },
  false,
);

route('GET', '/health', () => ({ ok: true }), false);

route('GET', '/profile', async () => ({ profile: await getProfile() }));

route('PUT', '/profile', async ({ req }) => {
  const p = profileSchema.parse(req.body);
  const c = await db();
  await c.execute({
    sql: `INSERT INTO profile (id, sex, dob, height_cm, activity, goal_weight_kg, weekly_loss_kg, timezone, week_start, updated_at)
          VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET sex=excluded.sex, dob=excluded.dob, height_cm=excluded.height_cm,
            activity=excluded.activity, goal_weight_kg=excluded.goal_weight_kg,
            weekly_loss_kg=excluded.weekly_loss_kg, timezone=excluded.timezone,
            week_start=excluded.week_start, updated_at=excluded.updated_at`,
    args: [p.sex, p.dob, p.heightCm, p.activity, p.goalWeightKg, p.weeklyLossKg, p.timezone, p.weekStart, new Date().toISOString()],
  });
  return { profile: p };
});

// ---- weights
route('GET', '/weights', async ({ req }) => {
  const from = req.query.get('from') ?? undefined;
  const to = req.query.get('to') ?? undefined;
  if ((from && !isDateStr(from)) || (to && !isDateStr(to))) throw new HttpError(400, 'Bad date.');
  return { weights: await loadWeights(from, to) };
});

route('PUT', '/weights', async ({ req }) => {
  const w = weightSchema.parse(req.body);
  const c = await db();
  await c.execute({
    sql: `INSERT INTO weights (date, kg, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(date) DO UPDATE SET kg = excluded.kg, updated_at = excluded.updated_at`,
    args: [w.date, w.kg, new Date().toISOString()],
  });
  return { weight: w };
});

route('DELETE', '/weights/:date', async ({ params }) => {
  if (!isDateStr(params[0])) throw new HttpError(400, 'Bad date.');
  const c = await db();
  await c.execute({ sql: 'DELETE FROM weights WHERE date = ?', args: [params[0]] });
  return { ok: true };
});

// ---- meals
route('GET', '/meals', async ({ req }) => {
  const { from, to } = range(req.query);
  return { meals: await loadMeals(from, to) };
});

route('GET', '/meals/:id', async ({ params }) => {
  const id = Number(params[0]);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Bad id.');
  const c = await db();
  const res = await c.execute({ sql: 'SELECT * FROM meals WHERE id = ?', args: [id] });
  if (!res.rows[0]) throw new HttpError(404, 'Meal not found.');
  return { meal: rowToMeal(res.rows[0] as unknown as Row) };
});

route('POST', '/meals', async ({ req }) => {
  const input = mealSchema.parse(req.body);
  const c = await db();
  const r = mealRow(input);
  const res = await c.execute({
    sql: `INSERT INTO meals (date, time, meal_type, note, items, calories, protein, carbs, fat, fiber, sugar, sodium, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [input.date, input.time, input.mealType, input.note, r.items, r.calories, r.protein, r.carbs, r.fat, r.fiber, r.sugar, r.sodium, new Date().toISOString()],
  });
  const id = Number(res.lastInsertRowid);
  return { meal: { id, ...input, ...sumNutrients(input.items) } satisfies Meal };
});

route('PUT', '/meals/:id', async ({ req, params }) => {
  const id = Number(params[0]);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Bad id.');
  const input = mealSchema.parse(req.body);
  const c = await db();
  const r = mealRow(input);
  const res = await c.execute({
    sql: `UPDATE meals SET date=?, time=?, meal_type=?, note=?, items=?, calories=?, protein=?, carbs=?, fat=?, fiber=?, sugar=?, sodium=? WHERE id=?`,
    args: [input.date, input.time, input.mealType, input.note, r.items, r.calories, r.protein, r.carbs, r.fat, r.fiber, r.sugar, r.sodium, id],
  });
  if (res.rowsAffected === 0) throw new HttpError(404, 'Meal not found.');
  return { meal: { id, ...input, ...sumNutrients(input.items) } satisfies Meal };
});

route('DELETE', '/meals/:id', async ({ params }) => {
  const id = Number(params[0]);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Bad id.');
  const c = await db();
  await c.execute({ sql: 'DELETE FROM meals WHERE id = ?', args: [id] });
  return { ok: true };
});

/** Per-day totals (only days that have meals). */
route('GET', '/daily', async ({ req }) => {
  const { from, to } = range(req.query);
  const c = await db();
  const res = await c.execute({
    sql: `SELECT date, COUNT(*) AS meals, SUM(calories) AS calories, SUM(protein) AS protein, SUM(carbs) AS carbs,
                 SUM(fat) AS fat, SUM(fiber) AS fiber, SUM(sugar) AS sugar, SUM(sodium) AS sodium
          FROM meals WHERE date >= ? AND date <= ? GROUP BY date ORDER BY date`,
    args: [from, to],
  });
  const daily: DailyTotal[] = res.rows.map((r) => ({
    date: String(r.date),
    meals: Number(r.meals),
    calories: round(Number(r.calories)),
    protein: round(Number(r.protein), 1),
    carbs: round(Number(r.carbs), 1),
    fat: round(Number(r.fat), 1),
    fiber: round(Number(r.fiber), 1),
    sugar: round(Number(r.sugar), 1),
    sodium: round(Number(r.sodium)),
  }));
  return { daily };
});

// ---- workouts
route('GET', '/workouts', async ({ req }) => {
  const { from, to } = range(req.query);
  return { workouts: await loadWorkouts(from, to) };
});

route('POST', '/workouts', async ({ req }) => {
  const input = workoutSchema.parse(req.body);
  const est = await estimateFor(input);
  const c = await db();
  const res = await c.execute({
    sql: `INSERT INTO workouts (date, time, kind, minutes, steps, items, note, kcal, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [input.date, input.time, input.kind, input.minutes, input.steps, JSON.stringify(input.items), input.note, est.kcal, new Date().toISOString()],
  });
  return { workout: { id: Number(res.lastInsertRowid), ...input, kcal: est.kcal } satisfies Workout };
});

route('PUT', '/workouts/:id', async ({ req, params }) => {
  const id = Number(params[0]);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Bad id.');
  const input = workoutSchema.parse(req.body);
  const est = await estimateFor(input);
  const c = await db();
  const res = await c.execute({
    sql: `UPDATE workouts SET date=?, time=?, kind=?, minutes=?, steps=?, items=?, note=?, kcal=? WHERE id=?`,
    args: [input.date, input.time, input.kind, input.minutes, input.steps, JSON.stringify(input.items), input.note, est.kcal, id],
  });
  if (res.rowsAffected === 0) throw new HttpError(404, 'Workout not found.');
  return { workout: { id, ...input, kcal: est.kcal } satisfies Workout };
});

route('DELETE', '/workouts/:id', async ({ params }) => {
  const id = Number(params[0]);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Bad id.');
  const c = await db();
  await c.execute({ sql: 'DELETE FROM workouts WHERE id = ?', args: [id] });
  return { ok: true };
});

// ---- settings (weekly workout goal)
const DEFAULT_WEEKLY_WORKOUTS = 4;
async function getWeeklyGoal(): Promise<number> {
  const c = await db();
  const r = await c.execute({ sql: "SELECT value FROM settings WHERE key = 'weeklyWorkouts'", args: [] });
  const n = r.rows[0] ? Number(r.rows[0].value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 7 ? n : DEFAULT_WEEKLY_WORKOUTS;
}

route('GET', '/settings', async () => ({ settings: { weeklyWorkouts: await getWeeklyGoal() } }));

route('PUT', '/settings', async ({ req }) => {
  const s = settingsSchema.parse(req.body);
  const c = await db();
  await c.execute({
    sql: `INSERT INTO settings (key, value) VALUES ('weeklyWorkouts', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [String(s.weeklyWorkouts)],
  });
  return { settings: s };
});

// ---- AI session plan
route('POST', '/workout-plan', async ({ req }) => {
  const { today } = planRequestSchema.parse(req.body);
  const profile = await getProfile();
  const weights = await loadWeights();
  const all = await loadWorkouts(addDays(today, -45), today);
  const recent = [...all].reverse().filter((w) => w.kind === 'gym').slice(0, 6);
  const goal = await getWeeklyGoal();
  const ws = weekStartOf(today, profile?.weekStart ?? 1);
  const weekDays = new Set(all.filter((w) => w.date >= ws).map((w) => w.date));
  const last = all.at(-1);
  const customs = new Map<string, number>();
  for (const w of all) for (const i of w.items) customs.set(i.name, i.met);
  const customList = [...customs].map(([name, met]) => ({ name, met }));
  const plan = await planSession(
    {
      today,
      sex: profile?.sex,
      age: profile ? ageOn(profile.dob, today) : undefined,
      weightKg: weights.at(-1)?.kg,
      weeklyGoal: goal,
      workoutsThisWeek: weekDays.size,
      daysSinceLast: last ? diffDays(today, last.date) : null,
      recent,
      customs: customList,
    },
    customList,
  );
  if (plan.exercises.length === 0) throw new HttpError(502, 'The AI did not return a usable plan — please try again.');
  return { plan };
});

// ---- AI day review (which meals were needed on a day that went over target)
route('GET', '/reviews', async ({ req }) => {
  const { from, to } = range(req.query);
  const c = await db();
  const res = await c.execute({ sql: 'SELECT data FROM day_reviews WHERE date >= ? AND date <= ? ORDER BY date', args: [from, to] });
  return { reviews: res.rows.map((r) => JSON.parse(String(r.data)) as DayReview) };
});

route('POST', '/reviews/:date', async ({ params }) => {
  const date = params[0];
  if (!isDateStr(date)) throw new HttpError(400, 'Bad date.');
  const profile = await getProfile();
  if (!profile) throw new HttpError(400, 'Set up your profile first.');
  const weights = await loadWeights();
  const w = [...weights].reverse().find((x) => x.date <= date) ?? weights[0];
  if (!w) throw new HttpError(400, 'Log your weight first — the calorie target depends on it.');
  const meals = await loadMeals(date, date);
  const eaten = sumNutrients(meals).calories;
  const target = calorieTarget(profile, w.kg, date).target;
  if (meals.length === 0) throw new HttpError(400, 'No meals logged that day — nothing to review.');

  const result = await reviewDay({ date, targetKcal: target, eatenKcal: eaten, weeklyLossKg: profile.weeklyLossKg, meals });
  const review: DayReview = { date, targetKcal: round(target), eatenKcal: round(eaten), ...result, createdAt: new Date().toISOString() };
  const c = await db();
  await c.execute({
    sql: `INSERT INTO day_reviews (date, data, created_at) VALUES (?, ?, ?)
          ON CONFLICT(date) DO UPDATE SET data = excluded.data, created_at = excluded.created_at`,
    args: [date, JSON.stringify(review), review.createdAt],
  });
  return { review };
});

// ---- AI
route('POST', '/analyze', async ({ req }) => {
  const { image, mimeType, note } = analyzeSchema.parse(req.body);
  return analyzeImage(image, mimeType, note); // image is never persisted
});

route('POST', '/parse-text', async ({ req }) => {
  const { text } = textMealSchema.parse(req.body);
  return analyzeText(text);
});

route('GET', '/foods/search', async ({ req }) => {
  const q = (req.query.get('q') ?? '').trim();
  if (q.length < 2) return { hits: [] };
  return { hits: await searchFoods(q.slice(0, 80)) };
});

route('POST', '/chat', async ({ req }) => {
  const { messages, today } = chatSchema.parse(req.body);
  const profile = await getProfile();
  const weights = await loadWeights(addDays(today, -120), today);
  const meals = await loadMeals(addDays(today, -6), today);

  const lines: string[] = [];
  if (profile) {
    const latest = weights.at(-1);
    lines.push(
      `Profile: ${profile.sex}, DOB ${profile.dob}, height ${round(profile.heightCm, 1)} cm, activity ${profile.activity}, goal ${profile.goalWeightKg} kg, target loss ${profile.weeklyLossKg} kg/week.`,
    );
    if (latest) {
      const t = calorieTarget(profile, latest.kg, today);
      const hr = healthyRange(profile.heightCm);
      lines.push(
        `Latest weight ${latest.kg} kg on ${latest.date}; BMI ${round(bmi(latest.kg, profile.heightCm), 1)}; healthy range ${hr.min}-${hr.max} kg.`,
        `Estimated maintenance ${t.tdee} kcal/day; daily target ${t.target} kcal.`,
      );
    }
    const s = summarizeWeights(weights, today, profile.weekStart);
    if (s.currentWeek) lines.push(`This week's average weight: ${s.currentWeek.avg} kg (${s.currentWeek.count} weigh-ins); change vs last week: ${s.weekChange ?? 'n/a'} kg.`);
    const wk = weeklyAverages(weights, profile.weekStart).slice(-6);
    if (wk.length) lines.push('Weekly averages (week start: kg): ' + wk.map((w) => `${w.key}: ${w.avg}`).join(', '));
  } else {
    lines.push('The user has not filled in their profile yet.');
  }
  const byDay = new Map<string, number>();
  for (const m of meals) byDay.set(m.date, (byDay.get(m.date) ?? 0) + m.calories);
  if (byDay.size) lines.push('Calories logged per day (last 7 days): ' + [...byDay].map(([d, c]) => `${d}: ${round(c)}`).join(', '));
  const todays = meals.filter((m) => m.date === today);
  if (todays.length) {
    const tot = sumNutrients(todays);
    lines.push(
      `Today so far (${todays.length} meals): ${tot.calories} kcal, ${tot.protein} g protein, ${tot.carbs} g carbs, ${tot.fat} g fat. Meals: ` +
        todays.map((m) => `${m.time} ${m.items.map((i) => i.name).join(' + ')} (${m.calories} kcal)`).join('; '),
    );
  }

  const system = `You are a supportive, practical weight-loss coach inside the user's personal tracker app.
Use the data below; do not invent numbers that are not in it. Keep answers short and concrete (a few sentences or a short list).
Calorie figures are estimates. You are not a doctor: for medical conditions, eating disorders, pregnancy or very fast loss, suggest speaking to a healthcare professional.
Never encourage going below the safe calorie floor (1200 kcal women / 1500 kcal men).

USER DATA (today is ${today}):
${lines.join('\n')}`;

  return { reply: await chatText({ system, messages }) };
});

// ---- export
route('GET', '/export', async () => {
  const c = await db();
  const meals = (await c.execute('SELECT * FROM meals ORDER BY date, time, id')).rows.map((r) => rowToMeal(r as unknown as Row));
  const workouts = await loadWorkouts('0000-01-01', '9999-12-31');
  return { exportedAt: new Date().toISOString(), profile: await getProfile(), weights: await loadWeights(), meals, workouts };
});

// ------------------------------------------------------------------ dispatcher

export async function handle(req: ApiRequest): Promise<ApiResponse> {
  try {
    const method = req.method.toUpperCase();
    const path = req.path.replace(/\/+$/, '') || '/';
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (!m) continue;
      if (r.auth) {
        const token = req.authorization?.replace(/^Bearer\s+/i, '');
        if (!verifyToken(token)) throw new HttpError(401, 'Not signed in.');
      }
      return ok(await r.fn({ req, params: m.slice(1).map(decodeURIComponent) }));
    }
    const pathExists = routes.some((r) => r.re.test(path));
    return { status: pathExists ? 405 : 404, body: { error: pathExists ? 'Method not allowed.' : 'Not found.' } };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
    if (e instanceof ZodError) {
      const msg = e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
      return { status: 400, body: { error: `Invalid input — ${msg}` } };
    }
    console.error(e);
    return { status: 500, body: { error: 'Server error.' } };
  }
}
