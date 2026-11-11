import { useMemo, useState, type FormEvent } from 'react';
import { useDeleteMeasurement, useMeasurements, useSaveMeasurement } from '../lib/queries';
import { summarizeMeasurements } from '../../shared/measurements';
import { fmtDay, fmtShort, signed } from '../lib/format';
import { ErrorBanner, Stat } from './ui';

// Smaller is the goal for both measurements.
const tone = (n: number) => (n === 0 ? undefined : n < 0 ? 'good' : 'bad') as 'good' | 'bad' | undefined;
const cls = (n: number) => (n === 0 ? '' : n < 0 ? 'good' : 'bad');

export default function BodyMeasurements({ today, weekStart }: { today: string; weekStart: 0 | 1 }) {
  const q = useMeasurements();
  const save = useSaveMeasurement();
  const del = useDeleteMeasurement();
  const [date, setDate] = useState(today);
  const [bust, setBust] = useState('');
  const [waist, setWaist] = useState('');

  const s = useMemo(() => summarizeMeasurements(q.data ?? [], today, weekStart), [q.data, today, weekStart]);
  const prev = s.rows[0]?.change ?? null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const b = Number(bust);
    const w = Number(waist);
    if (!(b >= 16 && b <= 100 && w >= 12 && w <= 100)) return;
    await save.mutateAsync({ date, bustIn: Math.round(b * 100) / 100, waistIn: Math.round(w * 100) / 100 });
    setBust('');
    setWaist('');
  }

  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>📏 Body measurements</h2>
      {!q.isLoading &&
        (s.due ? (
          <div className="banner warn">
            {s.latest ? `Weekly check-in due — last measured ${fmtDay(s.latest.date)}.` : 'Take your first measurement to start tracking.'}
          </div>
        ) : (
          <div className="banner info">Done for this week ✓ — next check-in {s.nextDue && fmtDay(s.nextDue)}.</div>
        ))}

      {s.latest && (
        <div className="grid2">
          <Stat label="Bust" value={`${s.latest.bustIn} in`} sub={prev ? `${signed(prev.bustIn, 2)} vs last time` : 'first measurement'} tone={prev ? tone(prev.bustIn) : undefined} />
          <Stat label="Waist" value={`${s.latest.waistIn} in`} sub={prev ? `${signed(prev.waistIn, 2)} vs last time` : 'first measurement'} tone={prev ? tone(prev.waistIn) : undefined} />
        </div>
      )}
      {s.sinceStart && s.first && (
        <p className="muted small" style={{ margin: 0 }}>
          Since {fmtShort(s.first.date)}: bust <b className={cls(s.sinceStart.bustIn)}>{signed(s.sinceStart.bustIn, 2)} in</b> · waist{' '}
          <b className={cls(s.sinceStart.waistIn)}>{signed(s.sinceStart.waistIn, 2)} in</b>
        </p>
      )}

      <form onSubmit={submit} className="stack">
        <div className="grid2">
          <div>
            <label htmlFor="m-bust">Bust (in)</label>
            <input id="m-bust" type="number" inputMode="decimal" step="0.25" min="16" max="100" placeholder={s.latest ? String(s.latest.bustIn) : 'e.g. 36'} value={bust} onChange={(e) => setBust(e.target.value)} />
          </div>
          <div>
            <label htmlFor="m-waist">Waist (in)</label>
            <input id="m-waist" type="number" inputMode="decimal" step="0.25" min="12" max="100" placeholder={s.latest ? String(s.latest.waistIn) : 'e.g. 29'} value={waist} onChange={(e) => setWaist(e.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor="m-date">Date</label>
          <input id="m-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
        </div>
        <ErrorBanner error={save.error ?? q.error} />
        <button className="block" disabled={save.isPending || !bust || !waist}>
          {save.isPending ? 'Saving…' : save.isSuccess && !bust ? 'Saved ✓' : 'Save measurements'}
        </button>
        <p className="muted small" style={{ margin: 0 }}>Measure at the same time each week (e.g. morning, relaxed) for comparable numbers.</p>
      </form>

      {s.rows.length > 0 && (
        <>
          <ErrorBanner error={del.error} />
          <table>
            <thead><tr><th>Date</th><th className="r">Bust</th><th className="r">Waist</th><th /></tr></thead>
            <tbody>
              {s.rows.slice(0, 12).map((r) => (
                <tr key={r.date}>
                  <td>{fmtShort(r.date)}</td>
                  <td className="r"><b>{r.bustIn}</b> {r.change && <span className={`small ${cls(r.change.bustIn)}`}>{signed(r.change.bustIn, 2)}</span>}</td>
                  <td className="r"><b>{r.waistIn}</b> {r.change && <span className={`small ${cls(r.change.waistIn)}`}>{signed(r.change.waistIn, 2)}</span>}</td>
                  <td className="r">
                    <button type="button" className="ghost small" aria-label={`Delete measurement on ${r.date}`} disabled={del.isPending} onClick={() => confirm(`Delete measurements from ${r.date}?`) && del.mutate(r.date)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
