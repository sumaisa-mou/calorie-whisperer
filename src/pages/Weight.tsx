import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/useApp';
import { useDeleteWeight } from '../lib/queries';
import { ErrorBanner, Loading, Segmented, Stat } from '../components/ui';
import WeightEntryForm from '../components/WeightEntryForm';
import WeightChart from '../components/WeightChart';
import BodyMeasurements from '../components/BodyMeasurements';
import {
  bmi,
  bmiCategory,
  healthyRange,
  monthlyAverages,
  rangeDifference,
  round,
  weeklyAverages,
} from '../../shared/calc';
import { addDays } from '../../shared/dates';
import { fmtDay, fmtMonth, fmtWeek, signed } from '../lib/format';

type Range = 28 | 84 | 0;

const toneFor = (change: number | null) => (change === null ? undefined : change <= 0 ? 'good' : 'bad') as 'good' | 'bad' | undefined;

export default function WeightPage() {
  const { loading, error, profile, weights, today, summary } = useApp();
  const [range, setRange] = useState<Range>(84);
  const del = useDeleteWeight();

  const weekStart = profile?.weekStart ?? 1;
  const visible = useMemo(() => (range === 0 ? weights : weights.filter((w) => w.date >= addDays(today, -range))), [weights, range, today]);
  const weeks = useMemo(() => weeklyAverages(weights, weekStart).slice(-12).reverse(), [weights, weekStart]);
  const months = useMemo(() => monthlyAverages(weights).slice(-12).reverse(), [weights]);

  if (loading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;

  const latest = summary?.latest ?? null;
  const first = summary?.first ?? null;

  // ---- BMI / ideal weight
  let body: React.ReactNode = null;
  if (profile && latest) {
    const b = bmi(latest.kg, profile.heightCm);
    const cat = bmiCategory(b);
    const range_ = healthyRange(profile.heightCm);
    const diff = rangeDifference(latest.kg, range_);
    const toGoal = round(latest.kg - profile.goalWeightKg, 1);
    const startKg = first && first.kg > profile.goalWeightKg ? first.kg : null;
    const pct = startKg ? Math.max(0, Math.min(100, ((startKg - latest.kg) / (startKg - profile.goalWeightKg)) * 100)) : null;
    body = (
      <section className="card">
        <h2>BMI & ideal weight</h2>
        <div className="grid2">
          <Stat
            label="BMI"
            value={round(b, 1)}
            sub={cat}
            tone={cat === 'normal' ? 'good' : cat === 'underweight' ? 'warn' : 'bad'}
          />
          <Stat label="Healthy range" value={`${range_.min}–${range_.max}`} sub="kg (BMI 18.5–24.9)" />
        </div>
        <p className="mt">
          {diff > 0 && <>You are <b className="bad">{diff} kg above</b> the healthy range for your height.</>}
          {diff < 0 && <>You are <b className="warn">{-diff} kg below</b> the healthy range for your height.</>}
          {diff === 0 && <b className="good">You are inside the healthy range 🎉</b>}
        </p>
        <p>
          Goal {profile.goalWeightKg} kg:{' '}
          {toGoal > 0 ? <b>{toGoal} kg to go</b> : <b className="good">reached!</b>}
        </p>
        {pct !== null && (
          <>
            <div className="progress" style={{ marginTop: 6 }}><div style={{ width: `${pct}%` }} /></div>
            <p className="muted small">{round(pct)}% of the way from {startKg} kg to {profile.goalWeightKg} kg</p>
          </>
        )}
      </section>
    );
  } else if (!profile) {
    body = <div className="banner info">Set up your profile in <Link to="/settings">Settings</Link> to see BMI and your ideal weight.</div>;
  }

  return (
    <div className="stack">
      <h1>Body</h1>

      <section className="card">
        <WeightEntryForm today={today} existingKg={latest?.kg} />
      </section>

      {summary && latest && (
        <div className="grid2">
          <Stat label="Latest" value={`${latest.kg} kg`} sub={fmtDay(latest.date)} />
          <Stat
            label="Since start"
            value={summary.totalChange === null ? '—' : `${signed(summary.totalChange)} kg`}
            sub={first ? `from ${first.kg} kg` : undefined}
            tone={toneFor(summary.totalChange)}
          />
          <Stat
            label="Week average"
            value={summary.currentWeek ? `${summary.currentWeek.avg} kg` : '—'}
            sub={summary.weekChange !== null ? `${signed(summary.weekChange, 2)} vs last week` : 'no previous week'}
            tone={toneFor(summary.weekChange)}
          />
          <Stat
            label="Month average"
            value={summary.currentMonth ? `${summary.currentMonth.avg} kg` : '—'}
            sub={summary.monthChange !== null ? `${signed(summary.monthChange, 2)} vs last month` : 'no previous month'}
            tone={toneFor(summary.monthChange)}
          />
        </div>
      )}

      {body}

      <BodyMeasurements today={today} weekStart={weekStart} />

      <section className="card">
        <div className="row between" style={{ marginBottom: '.6rem' }}>
          <h2 style={{ margin: 0 }}>Trend</h2>
          <div style={{ width: 190 }}>
            <Segmented<Range>
              value={range}
              onChange={setRange}
              options={[{ value: 28, label: '4w' }, { value: 84, label: '12w' }, { value: 0, label: 'All' }]}
            />
          </div>
        </div>
        <WeightChart weights={visible} weekStart={weekStart} />
        <p className="muted small">Grey = daily weigh-ins · Green = weekly average (the number to trust — daily weight swings with water).</p>
      </section>

      {weeks.length > 0 && (
        <section className="card">
          <h2>Weekly averages</h2>
          <table>
            <thead><tr><th>Week</th><th className="r">Avg kg</th><th className="r">Change</th><th className="r">Days</th></tr></thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.key}>
                  <td>{fmtWeek(w.key)}</td>
                  <td className="r"><b>{w.avg.toFixed(2)}</b></td>
                  <td className={`r ${w.change === null ? '' : w.change <= 0 ? 'good' : 'bad'}`}>{w.change === null ? '—' : signed(w.change, 2)}</td>
                  <td className="r muted">{w.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {months.length > 0 && (
        <section className="card">
          <h2>Monthly averages</h2>
          <table>
            <thead><tr><th>Month</th><th className="r">Avg kg</th><th className="r">Change</th><th className="r">Days</th></tr></thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.key}>
                  <td>{fmtMonth(m.key)}</td>
                  <td className="r"><b>{m.avg.toFixed(2)}</b></td>
                  <td className={`r ${m.change === null ? '' : m.change <= 0 ? 'good' : 'bad'}`}>{m.change === null ? '—' : signed(m.change, 2)}</td>
                  <td className="r muted">{m.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {weights.length > 0 && (
        <section className="card">
          <h2>Recent entries</h2>
          <ErrorBanner error={del.error} />
          <table>
            <tbody>
              {[...weights].reverse().slice(0, 14).map((w) => (
                <tr key={w.date}>
                  <td>{fmtDay(w.date)}</td>
                  <td className="r"><b>{w.kg} kg</b></td>
                  <td className="r">
                    <button
                      className="ghost small"
                      aria-label={`Delete weight on ${w.date}`}
                      disabled={del.isPending}
                      onClick={() => confirm(`Delete ${w.kg} kg on ${w.date}?`) && del.mutate(w.date)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
