import { useMemo } from 'react';
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { weeklyAverages } from '../../shared/calc';
import { weekStartOf } from '../../shared/dates';
import type { WeightEntry } from '../../shared/types';
import { fmtShort } from '../lib/format';

const GRID = '#94a3b8';

export default function WeightChart({ weights, weekStart }: { weights: WeightEntry[]; weekStart: 0 | 1 }) {
  const data = useMemo(() => {
    const avgs = new Map(weeklyAverages(weights, weekStart).map((w) => [w.key, w.avg]));
    return weights.map((w) => ({ date: w.date, kg: w.kg, weekAvg: avgs.get(weekStartOf(w.date, weekStart)) }));
  }, [weights, weekStart]);

  if (data.length < 2) {
    return <p className="muted small center" style={{ padding: '2rem 0' }}>Log at least two weigh-ins to see the chart.</p>;
  }
  const kgs = data.map((d) => d.kg);
  const lo = Math.floor(Math.min(...kgs) - 0.5);
  const hi = Math.ceil(Math.max(...kgs) + 0.5);

  return (
    <div className="chart" aria-label="Weight chart">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={GRID} strokeOpacity={0.25} vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtShort} tick={{ fill: GRID, fontSize: 11 }} minTickGap={28} />
          <YAxis domain={[lo, hi]} tick={{ fill: GRID, fontSize: 11 }} allowDecimals={false} />
          <Tooltip
            labelFormatter={(l) => fmtShort(String(l))}
            formatter={(v, name) => [`${v} kg`, name === 'kg' ? 'Daily' : 'Week average']}
            contentStyle={{ borderRadius: 10, border: '1px solid #33415566' }}
          />
          <Line type="monotone" dataKey="kg" stroke="#94a3b8" strokeWidth={1.5} dot={{ r: 3, fill: '#94a3b8' }} isAnimationActive={false} />
          <Line type="stepAfter" dataKey="weekAvg" stroke="#22c55e" strokeWidth={3} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
