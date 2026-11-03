import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../lib/useApp';
import { useDaily } from '../lib/queries';
import { ErrorBanner, Loading, Segmented, Stat } from '../components/ui';
import WeightEntryForm from '../components/WeightEntryForm';
import { KCAL_PER_KG, balanceRows, balanceTotals, projectFromIntake, round } from '../../shared/calc';
import { addDays, rangeDays } from '../../shared/dates';
import { fmtShort, num, signed } from '../lib/format';

const GRID = '#94a3b8';
type Days = 7 | 14 | 30 | 90;

export default function Charts() {
  const { loading, error, profile, today, target, weights, latest } = useApp();
  const qc = useQueryClient();
  const [days, setDays] = useState<Days>(14);
  const from = addDays(today, -(days - 1));
  const dailyQ = useDaily(from, today);

  const data = useMemo(() => {
    const byDate = new Map((dailyQ.data ?? []).map((d) => [d.date, d]));
    return rangeDays(from, today).map((date) => ({
      date,
      consumed: byDate.get(date)?.calories ?? null,
      target: target?.target,
      tdee: target?.tdee,
    }));
  }, [dailyQ.data, from, today, target]);

  if (loading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;
  if (!profile) return <div className="banner info">Set up your profile in <Link to="/settings">Settings</Link> first.</div>;

  // Day-by-day table. Today is still in progress, so it is shown but kept out of the totals.
  const rows = target
    ? balanceRows(rangeDays(from, today), new Map((dailyQ.data ?? []).map((d) => [d.date, d.calories])), target.tdee)
    : [];
  const totals = balanceTotals(rows.filter((r) => r.date !== today));
  const grams = (g: number) => `${signed(g, 0)} g`;
  const tone = (n: number | null) => (n === null ? '' : n <= 0 ? 'good' : 'bad');

  const logged = (dailyQ.data ?? []).filter((d) => d.calories > 0);
  const proj = target ? projectFromIntake(logged.map((d) => d.calories), target.tdee) : null;
  const estChange = target ? logged.reduce((s, d) => s + (d.calories - target.tdee), 0) / KCAL_PER_KG : null;

  const inRange = weights.filter((w) => w.date >= from);
  const actual = inRange.length >= 2 ? round(inRange.at(-1)!.kg - inRange[0].kg, 1) : null;

  // average macros on logged days
  const n = logged.length || 1;
  const avg = {
    p: logged.reduce((s, d) => s + d.protein, 0) / n,
    c: logged.reduce((s, d) => s + d.carbs, 0) / n,
    f: logged.reduce((s, d) => s + d.fat, 0) / n,
  };
  const kcalFrom = { p: avg.p * 4, c: avg.c * 4, f: avg.f * 9 };
  const kcalSum = kcalFrom.p + kcalFrom.c + kcalFrom.f || 1;
  const pct = (v: number) => Math.round((v / kcalSum) * 100);

  return (
    <div className="stack">
      <h1>Calories</h1>
      <Segmented<Days>
        value={days}
        onChange={setDays}
        options={[{ value: 7, label: '7 days' }, { value: 14, label: '14 days' }, { value: 30, label: '30 days' }, { value: 90, label: '90 days' }]}
      />
      <ErrorBanner error={dailyQ.error} />

      {!target && <div className="banner warn">Log your weight to see target and maintenance lines.</div>}

      <section className="card">
        <h2>Eaten vs target</h2>
        <div className="chart" aria-label="Calories chart">
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={GRID} strokeOpacity={0.25} vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtShort} tick={{ fill: GRID, fontSize: 11 }} minTickGap={days > 14 ? 30 : 12} />
              <YAxis tick={{ fill: GRID, fontSize: 11 }} />
              <Tooltip
                labelFormatter={(l) => fmtShort(String(l))}
                formatter={(v, name) => [`${num(Number(v))} kcal`, name === 'consumed' ? 'Eaten' : name === 'target' ? 'Target' : 'Maintenance']}
                contentStyle={{ borderRadius: 10, border: '1px solid #33415566' }}
              />
              <Bar dataKey="consumed" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.date} fill={target && d.consumed !== null && d.consumed > target.target ? '#ef4444' : '#22c55e'} />
                ))}
              </Bar>
              <Line dataKey="target" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="tdee" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="muted small">
          <span className="dot" style={{ background: '#22c55e' }} />within target ·{' '}
          <span className="dot" style={{ background: '#ef4444' }} />over target ·{' '}
          <span className="dot" style={{ background: '#f59e0b' }} />target ·{' '}
          <span className="dot" style={{ background: '#94a3b8' }} />maintenance
        </p>
      </section>

      {!target && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Day by day</h2>
          <p style={{ margin: 0 }}>
            This table needs two things, both read automatically (the weight is always your <b>most recent</b> entry from the Weight tab):
          </p>
          <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
            <li>
              Profile: {profile ? <b className="good">saved ✓</b> : <b className="bad">not saved — <Link to="/settings">open Settings and tap “Save profile”</Link></b>}
            </li>
            <li>
              Latest weight:{' '}
              {latest ? <b className="good">{latest.kg} kg ✓</b> : <b className="bad">none found ({weights.length} entries loaded)</b>}
            </li>
          </ul>
          {profile && !latest && (
            <>
              <p className="muted small" style={{ margin: 0 }}>Log a weight here, or on the Weight tab:</p>
              <WeightEntryForm today={today} />
            </>
          )}
          <button className="secondary" onClick={() => qc.invalidateQueries()}>↻ Refresh data</button>
        </section>
      )}

      {target && (
        <section className="card">
          <h2>Day by day</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="r">Needed</th>
                  <th className="r">Eaten</th>
                  <th className="r">Balance</th>
                  <th className="r">Weight</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={r.date} className={r.date === today ? 'muted' : ''}>
                    <td>{fmtShort(r.date)}{r.date === today && <div className="small">so far</div>}</td>
                    <td className="r">{num(r.needed)}</td>
                    <td className="r">{r.consumed === null ? '—' : num(r.consumed)}</td>
                    <td className={`r ${tone(r.diff)}`}>{r.diff === null ? '—' : signed(r.diff, 0)}</td>
                    <td className={`r ${tone(r.grams)}`}><b>{r.grams === null ? '—' : grams(r.grams)}</b></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td><b>Total</b><div className="muted small">{totals.days} logged days</div></td>
                  <td className="r"><b>{num(totals.needed)}</b></td>
                  <td className="r"><b>{num(totals.consumed)}</b></td>
                  <td className={`r ${tone(totals.diff)}`}><b>{signed(totals.diff, 0)}</b></td>
                  <td className={`r ${tone(totals.grams)}`}><b>{grams(totals.grams)}</b></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="muted small">
            <b>Needed</b> = calories your body burns in a day (maintenance, at {latest ? `${latest.kg} kg` : 'your latest weight'}).
            <b> Weight ≈</b> = (eaten − needed) ÷ 7,700 kcal per kg, in grams: <span className="good">green = loss</span>, <span className="bad">red = gain</span>.
            Days with no meals logged are skipped, and today stays out of the total until it's over. It's an estimate — water and salt move the scale by far more than this.
          </p>
        </section>
      )}

      <section className="card">
        <h2>What this means for your weight</h2>
        {!proj || !target ? (
          <p className="muted">Log some meals to see the projection.</p>
        ) : (
          <>
            <div className="grid2">
              <Stat label="Avg eaten" value={`${num(proj.avgConsumed)}`} sub={`kcal/day · ${proj.days} days logged`} />
              <Stat label="Maintenance" value={num(target.tdee)} sub="kcal/day (you burn)" />
              <Stat
                label="Daily balance"
                value={`${signed(proj.avgDiff, 0)}`}
                sub="kcal vs maintenance"
                tone={proj.avgDiff <= 0 ? 'good' : 'bad'}
              />
              <Stat
                label="Projected pace"
                value={`${signed(proj.kgPerWeek, 2)} kg`}
                sub="per week at this intake"
                tone={proj.kgPerWeek <= 0 ? 'good' : 'bad'}
              />
            </div>
            <p className="mt small">
              Over these {days} days, the days you logged add up to an estimated <b>{signed(estChange ?? 0, 2)} kg</b>
              {actual !== null && <> · your scale changed <b>{signed(actual, 1)} kg</b> between your first and last weigh-in in this period</>}.
            </p>
            <p className="muted small">
              Estimates use 7,700 kcal ≈ 1 kg and only count days with meals logged. Missing logs make you look better than you are — compare with the weekly weight average.
            </p>
          </>
        )}
      </section>

      {logged.length > 0 && (
        <section className="card">
          <h2>Average macros</h2>
          <div className="macro-bar" aria-hidden>
            <div style={{ width: `${pct(kcalFrom.p)}%`, background: '#3b82f6' }} />
            <div style={{ width: `${pct(kcalFrom.c)}%`, background: '#f59e0b' }} />
            <div style={{ width: `${pct(kcalFrom.f)}%`, background: '#ec4899' }} />
          </div>
          <div className="grid3 mt">
            <Stat label="Protein" value={`${num(avg.p)} g`} sub={`${pct(kcalFrom.p)}% of kcal`} />
            <Stat label="Carbs" value={`${num(avg.c)} g`} sub={`${pct(kcalFrom.c)}% of kcal`} />
            <Stat label="Fat" value={`${num(avg.f)} g`} sub={`${pct(kcalFrom.f)}% of kcal`} />
          </div>
        </section>
      )}
    </div>
  );
}
