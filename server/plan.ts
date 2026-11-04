/**
 * AI session plan: "what should I train today?"
 *
 * The model is given the user's real recent history and a closed list of exercises it may choose from
 * (so every exercise has a known intensity). The server then validates the plan — the model suggests,
 * the code decides what is allowed.
 */
import { generateJSON, type Schema } from './llm.js';
import { round } from '../shared/calc.js';
import { GYM_PRESETS, type PlanExercise, type Workout, type WorkoutPlan } from '../shared/workout.js';

export const PLAN_SYSTEM = `You are an encouraging, safety-first personal trainer inside a fitness tracker.
Create ONE gym session for today for this user, built from their real recent training.

Rules:
1. Choose exercises ONLY from the "Allowed exercises" list, spelling each name exactly as given. Never invent others.
2. PROGRESSIVE OVERLOAD: for an exercise they did before, set today's target reps per set slightly above what they actually managed last time (about +5% to +10%, or +2 to +5 reps), never a big jump. If their last session looks like a stretch (sets falling off sharply), repeat the same numbers instead.
3. Match their level. If their history is bodyweight and easy variations (for example knee push-ups), stay with those; do not suggest advanced moves. With no history at all, start gentle: 2 to 3 sets of 8 to 12 reps.
4. Recovery: if they trained hard on each of the last 3 days, plan a lighter session (fewer sets) and say so. If they have not trained for several days, ease back in.
5. Balance the session: legs, push, core, and something cardio-like or full-body if the list allows. 4 to 6 exercises, 2 to 4 sets each, target reps between 5 and 100.
6. Sessions are 20 to 45 minutes. Set durationMin to a realistic total including rest.
7. For each exercise write a "note": one short cue about form or a target to beat ("beat 45 total last time"). Max 14 words.
8. summary: at most 2 sentences — why this session, tied to their history. tip: one practical tip (rest, form, breathing).
9. Be motivating but honest. No medical claims, no body-shaming, no promises about weight loss.

Output valid JSON only.`;

const RESPONSE_SCHEMA: Schema = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    tip: { type: 'STRING' },
    durationMin: { type: 'NUMBER' },
    exercises: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          sets: { type: 'INTEGER' },
          reps: { type: 'INTEGER', description: 'target reps per set' },
          note: { type: 'STRING' },
        },
        required: ['name', 'sets', 'reps', 'note'],
      },
    },
  },
  required: ['summary', 'tip', 'durationMin', 'exercises'],
};

export interface PlanContext {
  today: string;
  sex?: string;
  age?: number;
  weightKg?: number;
  weeklyGoal: number;
  workoutsThisWeek: number;
  daysSinceLast: number | null;
  /** newest first, at most a handful */
  recent: Workout[];
  /** custom categories the user has used before (name → met) */
  customs: { name: string; met: number }[];
}

export const allowedList = (customs: { name: string; met: number }[]) => {
  const byName = new Map<string, number>(GYM_PRESETS.map((p) => [p.name, p.met]));
  for (const c of customs) if (!byName.has(c.name)) byName.set(c.name, c.met);
  return byName;
};

export function buildPlanPrompt(c: PlanContext): string {
  const allowed = [...allowedList(c.customs)].map(([n]) => n).join(', ');
  const lines = [
    `Today: ${c.today}`,
    `User: ${[c.sex, c.age ? `${c.age} years` : '', c.weightKg ? `${round(c.weightKg, 1)} kg` : ''].filter(Boolean).join(', ') || 'no profile details'}.`,
    `Weekly goal: ${c.weeklyGoal} workouts. Done this week so far: ${c.workoutsThisWeek}.`,
    c.daysSinceLast === null ? 'Last workout: none logged yet.' : `Last workout: ${c.daysSinceLast} day(s) ago.`,
    '',
    `Allowed exercises: ${allowed}`,
    '',
    'Recent gym sessions (newest first; reps listed per set as actually done):',
  ];
  const gym = c.recent.filter((w) => w.kind === 'gym');
  if (gym.length === 0) lines.push('(none)');
  for (const w of gym) {
    lines.push(`- ${w.date}, ${round(w.minutes)} min: ${w.items.map((i) => `${i.name} ${i.setReps?.length ? i.setReps.join('+') : `${i.sets}x${i.reps}`}`).join('; ')}`);
  }
  return lines.join('\n');
}

/** Keep only allowed exercises with sane numbers; fill in each exercise's intensity from our own table. */
export function normalizePlan(raw: unknown, customs: { name: string; met: number }[]): WorkoutPlan {
  const obj = (raw ?? {}) as { summary?: unknown; tip?: unknown; durationMin?: unknown; exercises?: unknown };
  const allowed = allowedList(customs);
  const seen = new Set<string>();
  const exercises: PlanExercise[] = [];
  for (const e of Array.isArray(obj.exercises) ? obj.exercises : []) {
    if (typeof e !== 'object' || e === null) continue;
    const o = e as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const met = allowed.get(name);
    if (met === undefined || seen.has(name)) continue;
    const sets = Math.round(Number(o.sets));
    const reps = Math.round(Number(o.reps));
    if (!Number.isFinite(sets) || !Number.isFinite(reps)) continue;
    seen.add(name);
    exercises.push({
      name,
      met,
      sets: Math.min(6, Math.max(1, sets)),
      reps: Math.min(100, Math.max(5, reps)),
      note: typeof o.note === 'string' ? o.note.trim().slice(0, 120) : '',
    });
    if (exercises.length === 8) break;
  }
  const d = Number(obj.durationMin);
  return {
    summary: typeof obj.summary === 'string' ? obj.summary.trim().slice(0, 400) : '',
    tip: typeof obj.tip === 'string' ? obj.tip.trim().slice(0, 300) : '',
    durationMin: Number.isFinite(d) ? Math.min(90, Math.max(10, Math.round(d))) : 30,
    exercises,
  };
}

export async function planSession(c: PlanContext, customs: { name: string; met: number }[]) {
  const raw = await generateJSON({ system: PLAN_SYSTEM, parts: [{ text: buildPlanPrompt(c) }], schema: RESPONSE_SCHEMA });
  return normalizePlan(raw, customs);
}
