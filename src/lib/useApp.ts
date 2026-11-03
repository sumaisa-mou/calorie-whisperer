import { useEffect, useMemo, useState } from 'react';
import { useProfile, useWeights } from './queries';
import { calorieTarget, summarizeWeights } from '../../shared/calc';
import { todayInTz } from '../../shared/dates';

const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** Today's date in the profile timezone; refreshes when the app regains focus. */
export function useToday(tz?: string) {
  const zone = tz ?? browserTz();
  const [today, setToday] = useState(() => todayInTz(zone));
  useEffect(() => {
    const update = () => setToday(todayInTz(zone));
    update();
    document.addEventListener('visibilitychange', update);
    const id = setInterval(update, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', update);
      clearInterval(id);
    };
  }, [zone]);
  return today;
}

/** Everything most screens need: profile, today, weight summary and calorie target. */
export function useApp() {
  const profileQ = useProfile();
  const weightsQ = useWeights();
  const profile = profileQ.data ?? null;
  const today = useToday(profile?.timezone);
  const weights = weightsQ.data;

  return useMemo(() => {
    const summary = weights ? summarizeWeights(weights, today, profile?.weekStart ?? 1) : null;
    const latest = summary?.latest ?? null;
    const target = profile && latest ? calorieTarget(profile, latest.kg, today) : null;
    return {
      loading: profileQ.isLoading || weightsQ.isLoading,
      error: profileQ.error ?? weightsQ.error,
      profile,
      weights: weights ?? [],
      today,
      summary,
      latest,
      target,
    };
  }, [profile, weights, today, profileQ.isLoading, weightsQ.isLoading, profileQ.error, weightsQ.error]);
}
