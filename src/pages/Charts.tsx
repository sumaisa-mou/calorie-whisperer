import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../lib/useApp';
import { useDaily, useWorkouts } from '../lib/queries';
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
  const workoutsQ = useWorkouts(from, today);
  const burnByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of workoutsQ.data ?? []) m.set(w.date, (m.get(w.date) ?? 0) + w.kcal);
    return m;
  }, [workoutsQ.data]);

  const data = useMemo(() => {
    const byDate = new Map((dailyQ.data ?? []).map((d) => [d.date, d]));
    return rangeDays(from, today).map((date) => ({
      date,
      consumed: byDate.get(date)?.calories ?? null,
      target: target?.target,
      tdee: target ? target.tdee + Math.round(burnByDate.get(date) ?? 0) : undefined,
    }));
  }, [dailyQ.data, from, today, target, burnByDate]);

  if (loading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;
  if (!profile) return <div className="banner info">Set up your profile in <Link to="/settings">Settings</Link> first.</div>;

  // Day-by-day table. Today is still in progress, so it is shown but kept out of the totals.
  const rows = target
    ? balanceRows(rangeDays(from, today), new Map((dailyQ.data ?? []).map((d) => [d.date, d.calories])), target.tdee, burnByDate)
    : [];

  // What the scale actually did: each weigh-in minus the weigh-in before it.
  const scale = new Map<string, { kg: number; change: number | null }>();
  weights.forEach((w, i) => scale.set(w.date, { kg: w.kg, change: i > 0 ? round(w.kg - weights[i - 1].kg, 2) : null }));
  const countedRows = rows.filter((r) => r.date !== today && r.consumed !== null);
  const scaleTotal = countedRows.reduce((s, r) => s + (scale.get(r.date)?.change ?? 0), 0);
  const scaleDays = countedRows.filter((r) => scale.get(r.date)?.change != null).length;
  const totals = balanceTotals(rows.filter((r) => r.date !== today));
  const grams = (g: number) => `${signed(g, 0)} g`;
  const tone = (n: number | null) => (n === null ? '' : n <= 0 ? 'good' : 'bad');

  const logged = (dailyQ.data ?? []).filter((d) => d.calories > 0);
  const needOf = (date: string) => (target ? target.tdee + (burnByDate.get(date) ?? 0) : 0);
  const avgNeed = logged.length ? logged.reduce((s, d) => s + needOf(d.date), 0) / logged.length : 0;
  const proj = target ? projectFromIntake(logged.map((d) => d.calories), avgNeed) : null;
  const estChange = target ? logged.reduce((s, d) => s + (d.calories - needOf(d.date)), 0) / KCAL_PER_KG : null;

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
                formatter={(v, name) => [`${num(Number(v))} kcal`, name === 'consumed' ? 'Eaten' : name === 'target' ? 'Target' : 'Needed (maintenance + gym)']}
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
          <span className="dot" style={{ background: '#94a3b8' }} />needed (maintenance + gym)
        </p>
        <p className="muted small">
          A red bar only means you went over your <b>target</b>, which is set below what your body burns. Weight goes up only when you eat more than the dashed line.
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
                  <th className="r">Est.</th>
                  <th className="r">Scale</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={r.date} className={r.date === today ? 'muted' : ''}>
                    <td>{fmtShort(r.date)}{r.date === today && <div className="small">so far</div>}</td>
                    <td className="r">{num(r.needed + r.burned)}{r.burned > 0 && <div className="small good">+{num(r.burned)} gym</div>}</td>
                    <td className="r">{r.consumed === null ? '—' : num(r.consumed)}</td>
                    <td className={`r ${tone(r.diff)}`}>{r.diff === null ? '—' : signed(r.diff, 0)}</td>
                    <td className={`r ${tone(r.grams)}`}><b>{r.grams === null ? '—' : grams(r.grams)}</b></td>
                    <td className="r">
                      {scale.has(r.date) ? (
                        <>
                          <b>{scale.get(r.date)!.kg}</b>
                          {scale.get(r.date)!.change !== null && <div className={`small ${tone(scale.get(r.date)!.change)}`}>{signed(scale.get(r.date)!.change!, 2)} kg</div>}
                        </>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td><b>Total</b><div className="muted small">{totals.days} logged days</div></td>
                  <td className="r"><b>{num(totals.needed + totals.burned)}</b></td>
                  <td className="r"><b>{num(totals.consumed)}</b></td>
                  <td className={`r ${tone(totals.diff)}`}><b>{signed(totals.diff, 0)}</b></td>
                  <td className={`r ${tone(totals.grams)}`}><b>{grams(totals.grams)}</b></td>
                  <td className={`r ${scaleDays ? tone(scaleTotal) : ''}`}>{scaleDays ? <b>{signed(scaleTotal, 2)} kg</b> : '—'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="muted small">
            <b>Needed</b> = what your body burns in a day (maintenance at {latest ? `${latest.kg} kg` : 'your latest weight'}) <b>+ your logged gym/walk burn</b>.
            <b> Balance</b> = eaten − needed. <b>Est.</b> = balance ÷ 7,700 kcal per kg, in grams of body fat: <span className="good">green = loss</span>, <span className="bad">red = gain</span>.
            <b> Scale</b> = your actual weigh-in that day and how much it moved since your previous weigh-in.
            The scale also swings by hundreds of grams from water, salt and food still in your gut, so one day rarely matches the estimate — compare the <b>Total</b> row over a week or more.
            Days with no meals logged are skipped, and today stays out of the total until it's over.
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
              <Stat label={avgNeed > target.tdee ? 'Maintenance + gym' : 'Maintenance'} value={num(avgNeed)} sub="kcal/day (you burn)" />
              <Stat
                label="Daily balance"
                value={`${signed(proj.avgDiff, 0)}`}
                sub="kcal vs what you burn"
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
            <Stat macro="p" label="Protein" value={`${num(avg.p)} g`} sub={`${pct(kcalFrom.p)}% of kcal`} />
            <Stat macro="c" label="Carbs" value={`${num(avg.c)} g`} sub={`${pct(kcalFrom.c)}% of kcal`} />
            <Stat macro="f" label="Fat" value={`${num(avg.f)} g`} sub={`${pct(kcalFrom.f)}% of kcal`} />
          </div>
        </section>
      )}
    </div>
  );
}
