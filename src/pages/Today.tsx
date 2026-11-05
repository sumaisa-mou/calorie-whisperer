import { Link } from 'react-router-dom';
import { useApp } from '../lib/useApp';
import { useMeals, useWorkouts } from '../lib/queries';
import { Loading, ErrorBanner, Ring, Stat } from '../components/ui';
import WeightEntryForm from '../components/WeightEntryForm';
import { FAT_KCAL_SHARE, FIBER_MIN_G, PROTEIN_G_PER_KG, fatTarget, fiberTarget, proteinTarget, sumNutrients, weightChangeKg } from '../../shared/calc';
import { useConsistency } from '../lib/useConsistency';
import { fmtDay, num, signed } from '../lib/format';
import { countsForDate, sumWorkouts } from '../../shared/workout';
import { addDays } from '../../shared/dates';

export default function Today() {
  const { loading, error, profile, today, latest, target, summary } = useApp();
  const mealsQ = useMeals(today, today);
  const workoutsQ = useWorkouts(today, addDays(today, 1));
  const cons = useConsistency();

  if (loading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;

  if (!profile) {
    return (
      <div className="stack">
        <h1>Welcome 👋</h1>
        <div className="banner info">Set up your profile first — height, age, activity and goal — so I can work out your calorie target.</div>
        <Link to="/settings" className="btn block">Set up profile</Link>
      </div>
    );
  }

  const totals = sumNutrients(mealsQ.data ?? []);
  const consumed = totals.calories;
  const remaining = target ? target.target - consumed : null;
  const balance = target ? consumed - target.tdee : null; // vs maintenance
  const ptarget = latest ? proteinTarget(latest.kg) : null;
  const ftarget = target ? fatTarget(target.target) : null;
  const fibtarget = target ? fiberTarget(target.target) : null;
  const burn = sumWorkouts((workoutsQ.data ?? []).filter((w) => countsForDate(w) === today));

  return (
    <div className="stack">
      <div className="header">
        <div>
          <h1>Today</h1>
          <div className="muted small">{fmtDay(today)}</div>
        </div>
        <Link to="/chat" className="btn secondary small">💬 Coach</Link>
      </div>

      {!latest && <div className="banner warn">Log your weight below to unlock your calorie target.</div>}

      <section className="hero">
        {target ? (
          <>
            <div className="hero-main">
              <div className="hero-left">
                <h2>Calories</h2>
                <div className={`hero-big ${remaining! < 0 ? 'over' : ''}`}>
                  {remaining! >= 0 ? `${num(remaining!)} left` : `${num(-remaining!)} over`}
                </div>
                <div className="hero-sub">target {num(target.target)} kcal</div>
              </div>
              <Ring value={consumed} max={target.target}>
                <b>{num(consumed)}</b>
                <span>eaten</span>
              </Ring>
            </div>
            {consumed > 0 && balance !== null && (
              <p className="hero-note">
                {balance <= 0 ? `${num(-balance)} kcal under` : `${num(balance)} kcal over`} your maintenance of {num(target.tdee)} kcal →{' '}
                <b className={balance <= 0 ? 'good' : 'bad'}>≈ {signed(weightChangeKg(consumed, target.tdee), 2)} kg</b> body weight if every day were like today.
              </p>
            )}
            {target.clamped && (
              <p className="banner warn small mt">Your weekly-loss goal would go below the safe minimum, so the target is held at {target.floor} kcal (≈ {target.effectiveWeeklyLossKg} kg/week).</p>
            )}
            {burn.kcal > 0 && (
              <p className="hero-note">
                Workout today: <b className="good">{num(burn.kcal)} kcal burned</b> (≈ {num(burn.fatG, 1)} g fat)
                {balance !== null && target && <> → with food and workouts together ≈ <b className={balance - burn.kcal <= 0 ? 'good' : 'bad'}>{signed(weightChangeKg(consumed, target.tdee + burn.kcal), 2)} kg</b> body weight per day like this.</>}
              </p>
            )}
          </>
        ) : (
          <>
            <h2>Calories eaten</h2>
            <div className="hero-big">{num(consumed)} <span className="muted" style={{ fontSize: '1rem', fontWeight: 600 }}>kcal</span></div>
          </>
        )}
      </section>

      <div className="grid2">
        <Stat
          macro="p"
          label="Protein"
          value={`${num(totals.protein)} g`}
          sub={ptarget ? `of ${ptarget} g` : undefined}
          bar={ptarget ? totals.protein / ptarget : undefined}
        />
        <Stat macro="c" label="Carbs" value={`${num(totals.carbs)} g`} />
        <Stat
          macro="f"
          label="Fat"
          value={`${num(totals.fat)} g`}
          sub={ftarget ? `max ${ftarget} g` : undefined}
          tone={ftarget && totals.fat > ftarget ? 'bad' : undefined}
          bar={ftarget ? totals.fat / ftarget : undefined}
        />
        <Stat
          macro="c"
          label="Fiber"
          value={`${num(totals.fiber)} g`}
          sub={fibtarget ? `min ${fibtarget} g` : undefined}
          bar={fibtarget ? totals.fiber / fibtarget : undefined}
        />
      </div>
      {ftarget && fibtarget && (
        <p className="muted small stat-note">
          Aggressive-loss targets (adult female): fat ≤ {Math.round(FAT_KCAL_SHARE * 100)}% of calories ({ftarget} g), fiber ≥ {FIBER_MIN_G} g ({fibtarget} g).
          {totals.fiber < fibtarget ? ` ${num(fibtarget - totals.fiber)} g fiber to go.` : ' Fiber reached ✓'}
        </p>
      )}
      {ptarget && latest && (
        <p className="muted small stat-note">
          Protein target = your weight × {PROTEIN_G_PER_KG} g ({latest.kg} kg → {ptarget} g).
          {totals.protein < ptarget ? ` ${num(ptarget - totals.protein)} g to go today.` : ' Target reached ✓'}
        </p>
      )}

      {cons.ready && (
        <Stat
          label="🏋️ Workouts this week"
          value={`${cons.thisWeek} / ${cons.goal}`}
          sub={cons.weekStreak > 0 ? `${cons.weekStreak}-week goal streak` : 'weekly goal'}
          tone={cons.thisWeek >= cons.goal ? 'good' : undefined}
          bar={cons.thisWeek / cons.goal}
        />
      )}

      <div className="grid2">
        <Link to={`/meals/new?date=${today}`} className="btn block">＋ Add a meal</Link>
        <Link to="/workout" className="btn secondary block">🏋️ Log workout</Link>
      </div>

      {cons.ready && (
        <section className="card checkin">
          <h2>Last 7 days</h2>
          <div className="grid2">
            <Stat label="Workouts" value={`${cons.week.workouts} / ${cons.week.workoutGoal}`} sub={cons.week.burnedKcal > 0 ? `${num(cons.week.burnedKcal)} kcal burned` : undefined} tone={cons.week.workouts >= cons.week.workoutGoal ? 'good' : undefined} />
            <Stat
              label="Avg protein"
              macro="p"
              value={cons.week.avgProtein === null ? '—' : `${num(cons.week.avgProtein)} g`}
              sub={cons.week.proteinTarget ? `target ${cons.week.proteinTarget} g` : undefined}
              bar={cons.week.avgProtein !== null && cons.week.proteinTarget ? cons.week.avgProtein / cons.week.proteinTarget : undefined}
            />
            <div style={{ gridColumn: '1 / -1' }}>
            <Stat
              label="Weight (week avg)"
              value={summary?.weekChange == null ? '—' : `${signed(summary.weekChange, 2)} kg`}
              sub="vs last week"
              tone={summary?.weekChange == null ? undefined : summary.weekChange <= 0 ? 'good' : 'bad'}
            />
            </div>
          </div>
          <p className="review-tip small mt">🎯 <b>Focus:</b> {cons.week.focus}</p>
        </section>
      )}

      <section className="card">
        <h2>Weight</h2>
        {summary?.latest && (
          <div className="grid2" style={{ marginBottom: '.75rem' }}>
            <Stat label="Latest" value={`${summary.latest.kg} kg`} sub={fmtDay(summary.latest.date)} />
            <Stat
              label="This week avg"
              value={summary.currentWeek ? `${summary.currentWeek.avg} kg` : '—'}
              sub={summary.weekChange !== null ? `${signed(summary.weekChange, 2)} kg vs last week` : 'no previous week yet'}
              tone={summary.weekChange === null ? undefined : summary.weekChange <= 0 ? 'good' : 'bad'}
            />
          </div>
        )}
        <WeightEntryForm today={today} existingKg={latest?.kg} />
      </section>
    </div>
  );
}
