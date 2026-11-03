import { Link } from 'react-router-dom';
import { useApp } from '../lib/useApp';
import { useMeals } from '../lib/queries';
import { Loading, ErrorBanner, Progress, Stat } from '../components/ui';
import WeightEntryForm from '../components/WeightEntryForm';
import { sumNutrients, weightChangeKg } from '../../shared/calc';
import { fmtDay, num, signed } from '../lib/format';

export default function Today() {
  const { loading, error, profile, today, latest, target, summary } = useApp();
  const mealsQ = useMeals(today, today);

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

      <section className="card">
        {target ? (
          <>
            <div className="row between">
              <h2>Calories</h2>
              <span className="muted small">target {num(target.target)} kcal</span>
            </div>
            <div className="row between" style={{ alignItems: 'baseline' }}>
              <div>
                <span style={{ fontSize: '2rem', fontWeight: 800 }}>{num(consumed)}</span>
                <span className="muted"> eaten</span>
              </div>
              <div className={remaining! < 0 ? 'bad' : 'good'} style={{ fontWeight: 700 }}>
                {remaining! >= 0 ? `${num(remaining!)} left` : `${num(-remaining!)} over`}
              </div>
            </div>
            <Progress value={consumed} max={target.target} />
            {consumed > 0 && balance !== null && (
              <p className="muted small mt">
                {balance <= 0 ? `${num(-balance)} kcal under` : `${num(balance)} kcal over`} your maintenance of {num(target.tdee)} kcal →{' '}
                <b className={balance <= 0 ? 'good' : 'bad'}>≈ {signed(weightChangeKg(consumed, target.tdee), 2)} kg</b> body weight if every day were like today.
              </p>
            )}
            {target.clamped && (
              <p className="banner warn small mt">Your weekly-loss goal would go below the safe minimum, so the target is held at {target.floor} kcal (≈ {target.effectiveWeeklyLossKg} kg/week).</p>
            )}
          </>
        ) : (
          <>
            <h2>Calories eaten</h2>
            <div style={{ fontSize: '2rem', fontWeight: 800 }}>{num(consumed)} <span className="muted" style={{ fontSize: '1rem' }}>kcal</span></div>
          </>
        )}
        <div className="grid3 mt">
          <Stat label="Protein" value={`${num(totals.protein)} g`} />
          <Stat label="Carbs" value={`${num(totals.carbs)} g`} />
          <Stat label="Fat" value={`${num(totals.fat)} g`} />
        </div>
      </section>

      <Link to={`/meals/new?date=${today}`} className="btn block">＋ Add a meal</Link>

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
