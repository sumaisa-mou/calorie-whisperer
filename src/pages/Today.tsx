import { Link } from 'react-router-dom';
import { useApp } from '../lib/useApp';
import { useMeals, useWorkouts } from '../lib/queries';
import { Loading, ErrorBanner, Ring, Stat } from '../components/ui';
import WeightEntryForm from '../components/WeightEntryForm';
import { sumNutrients, weightChangeKg } from '../../shared/calc';
import { fmtDay, num, signed } from '../lib/format';
import { sumWorkouts } from '../../shared/workout';

export default function Today() {
  const { loading, error, profile, today, latest, target, summary } = useApp();
  const mealsQ = useMeals(today, today);
  const workoutsQ = useWorkouts(today, today);

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
  const burn = sumWorkouts(workoutsQ.data ?? []);

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

      <div className="grid3">
        <Stat macro="p" label="Protein" value={`${num(totals.protein)} g`} />
        <Stat macro="c" label="Carbs" value={`${num(totals.carbs)} g`} />
        <Stat macro="f" label="Fat" value={`${num(totals.fat)} g`} />
      </div>

      <div className="grid2">
        <Link to={`/meals/new?date=${today}`} className="btn block">＋ Add a meal</Link>
        <Link to="/workout" className="btn secondary block">🏋️ Log workout</Link>
      </div>

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
