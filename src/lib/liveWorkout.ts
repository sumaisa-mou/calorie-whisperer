import type { GymItem } from '../../shared/workout';

const KEY = 'ft_live_workout';

export type LiveSet = { name: string; met: number; reps: number };
export type Live = { startedAt: number; sets: LiveSet[]; current: { name: string; met: number } | null };

/** The session in progress lives in localStorage so a refresh or locked phone never loses it. */
export function loadLive(): Live | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v.startedAt === 'number' && Array.isArray(v.sets) ? (v as Live) : null;
  } catch {
    return null;
  }
}

export function saveLive(l: Live | null) {
  try {
    if (l) localStorage.setItem(KEY, JSON.stringify(l));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode etc. */
  }
}

/** Group the chronological sets by exercise (in order of first use). */
export function toItems(sets: LiveSet[]): GymItem[] {
  const order: string[] = [];
  const map = new Map<string, { met: number; reps: number[] }>();
  for (const s of sets) {
    if (!map.has(s.name)) {
      order.push(s.name);
      map.set(s.name, { met: s.met, reps: [] });
    }
    map.get(s.name)!.reps.push(s.reps);
  }
  return order.map((name) => {
    const m = map.get(name)!;
    return { name, met: m.met, sets: m.reps.length, reps: Math.max(1, Math.round(m.reps.reduce((a, b) => a + b, 0) / m.reps.length)), setReps: m.reps };
  });
}

export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
