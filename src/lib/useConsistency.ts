import { useMemo } from 'react';
import { useApp } from './useApp';
import { useDaily, useSettings, useWorkouts } from './queries';
import { addDays, rangeDays } from '../../shared/dates';
import { proteinTarget } from '../../shared/calc';
import { countsForDate } from '../../shared/workout';
import { bestStreak, checkIn, currentStreak, weekStreak, workoutWeeks } from '../../shared/streaks';

/** Streaks, weekly workout goal progress and the last-7-days check-in. */
export function useConsistency() {
  const { today, profile, latest } = useApp();
  const from = addDays(today, -119);
  const dailyQ = useDaily(from, today);
  const workoutsQ = useWorkouts(from, today);
  const settingsQ = useSettings();
  const goal = settingsQ.data?.weeklyWorkouts ?? 4;

  return useMemo(() => {
    const daily = dailyQ.data ?? [];
    const workouts = workoutsQ.data ?? [];
    const loggedDays = new Set(daily.filter((d) => d.calories > 0).map((d) => d.date));
    const workoutDays = new Set(workouts.map((w) => countsForDate(w)));
    const weeks = workoutWeeks(workoutDays, today, profile?.weekStart ?? 1, 12);

    const last7 = new Set(rangeDays(addDays(today, -6), today));
    const logged7 = daily.filter((d) => last7.has(d.date) && d.calories > 0);
    const pt = latest ? proteinTarget(latest.kg) : null;
    const week = checkIn({
      daysLogged: logged7.length,
      workouts: [...workoutDays].filter((d) => last7.has(d)).length,
      workoutGoal: goal,
      avgProtein: logged7.length ? logged7.reduce((s, d) => s + d.protein, 0) / logged7.length : null,
      proteinTarget: pt,
      burnedKcal: Math.round(workouts.filter((w) => last7.has(countsForDate(w))).reduce((s, w) => s + w.kcal, 0)),
    });

    return {
      ready: !dailyQ.isLoading && !workoutsQ.isLoading,
      goal,
      loggingStreak: currentStreak(loggedDays, today),
      bestLogging: bestStreak(loggedDays),
      thisWeek: weeks.at(-1)?.count ?? 0,
      weekStreak: weekStreak(weeks, goal),
      week,
    };
  }, [dailyQ.data, workoutsQ.data, dailyQ.isLoading, workoutsQ.isLoading, today, profile?.weekStart, latest, goal]);
}
