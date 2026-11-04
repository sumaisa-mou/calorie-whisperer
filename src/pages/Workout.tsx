import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/useApp';
import { useDeleteWorkout, useSaveWorkout, useWorkouts } from '../lib/queries';
import { ErrorBanner, Loading, Segmented, Stat } from '../components/ui';
import NumInput from '../components/NumInput';
import { activeMs, fmtClock, loadLive } from '../lib/liveWorkout';
import { addDays, nowTimeInTz, weekStartOf } from '../../shared/dates';
import { fmtDay, num } from '../lib/format';
import {
  estimateWorkout,
  GYM_PRESETS,
  INTENSITIES,
  kcalToFatG,
  sumWorkouts,
  countsForDate,
  type GymItem,
  type Workout,
  type WorkoutKind,
} from '../../shared/workout';

type Row = GymItem & { uid: string };
let uidN = 0;
const row = (name: string, met: number): Row => ({ uid: `w${++uidN}`, name, sets: 3, reps: 10, met });
const strip = ({ uid: _u, ...rest }: Row): GymItem => rest;

const KIND_LABEL: Record<WorkoutKind, string> = { walk: '🚶 Walk', gym: '🏋️ Gym session' };

export default function WorkoutPage() {
  const { loading, error, profile, today, latest } = useApp();
  const from = addDays(today, -20);
  const workoutsQ = useWorkouts(from, today);
  const save = useSaveWorkout();
  const del = useDeleteWorkout();
  const formRef = useRef<HTMLElement>(null);

  const [editId, setEditId] = useState<number | null>(null);
  const [kind, setKind] = useState<WorkoutKind>('walk');
  const [date, setDate] = useState<string>('');
  const [time, setTime] = useState('');
  const [minutes, setMinutes] = useState(20);
  const [steps, setSteps] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [note, setNote] = useState('');
  const [customName, setCustomName] = useState('');
  const [customMet, setCustomMet] = useState<number>(5);
  const [formError, setFormError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<number | null>(null);
  const liveNow = loadLive();

  const tz = profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateVal = date || today;
  const timeVal = time || nowTimeInTz(tz);

  const est = useMemo(
    () => (latest ? estimateWorkout({ kind, minutes, steps, items: rows.map(strip) }, latest.kg, profile?.heightCm) : null),
    [latest, kind, minutes, steps, rows, profile?.heightCm],
  );

  if (loading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;

  const workouts = workoutsQ.data ?? [];
  const weekFrom = weekStartOf(today, profile?.weekStart ?? 1);
  const week = sumWorkouts(workouts.filter((w) => countsForDate(w) >= weekFrom));
  const todayTotal = sumWorkouts(workouts.filter((w) => countsForDate(w) === today));
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const perDay = days.map((d) => ({ d, kcal: sumWorkouts(workouts.filter((w) => countsForDate(w) === d)).kcal }));
  const maxKcal = Math.max(1, ...perDay.map((x) => x.kcal));

  const grouped = [...workouts].reverse().reduce<Record<string, Workout[]>>((acc, w) => ((acc[countsForDate(w)] ??= []).push(w), acc), {});

  function reset() {
    setEditId(null);
    setDate('');
    setTime('');
    setMinutes(20);
    setSteps(0);
    setRows([]);
    setNote('');
    setFormError(null);
  }

  function edit(w: Workout) {
    setEditId(w.id);
    setKind(w.kind);
    setDate(w.date);
    setTime(w.time);
    setMinutes(w.minutes);
    setSteps(w.steps);
    setRows(w.items.map((i) => ({ ...i, uid: `w${++uidN}` })));
    setNote(w.note);
    setFormError(null);
    setJustSaved(null);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // editing sets/reps by hand replaces any exact per-set reps from the live tracker
  const patch = (uid: string, p: Partial<GymItem>) => setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...p, setReps: undefined } : r)));
  const togglePreset = (name: string, met: number) => setRows((rs) => (rs.some((r) => r.name === name) ? rs.filter((r) => r.name !== name) : [...rs, row(name, met)]));

  function addCustom() {
    const name = customName.trim();
    if (!name) return;
    setRows((rs) => [...rs, row(name, customMet)]);
    setCustomName('');
  }

  async function onSave() {
    setFormError(null);
    if (!(minutes >= 1)) return setFormError('Enter how many minutes you trained.');
    if (kind === 'gym' && rows.length === 0) return setFormError('Add at least one exercise.');
    try {
      const out = await save.mutateAsync({
        id: editId ?? undefined,
        workout: {
          date: dateVal,
          time: timeVal,
          kind,
          minutes: Math.round(minutes * 10) / 10,
          steps: kind === 'walk' ? Math.round(steps) : 0,
          items: kind === 'gym' ? rows.map((r) => ({ ...strip(r), name: r.name.trim(), sets: Math.max(1, Math.round(r.sets)), reps: Math.max(1, Math.round(r.reps)) })) : [],
          note: note.trim(),
        },
      });
      setJustSaved((out as { workout: Workout }).workout.kcal);
      reset();
    } catch {
      /* shown via ErrorBanner */
    }
  }

  return (
    <div className="stack">
      <div className="header">
        <div>
          <h1>Workout</h1>
          <div className="muted small">{fmtDay(today)}</div>
        </div>
      </div>

      <Link to="/workout/live" className="btn block live-start">
        {liveNow ? `▶ Resume gym session · ${fmtClock(activeMs(liveNow, Date.now()))}${liveNow.pausedAt ? ' (paused)' : ''}` : '▶ Start gym session'}
      </Link>

      <section className="hero">
        <h2>This week</h2>
        <div className="hero-main">
          <div className="hero-left">
            <div className="hero-big">{num(week.kcal)} <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>kcal burned</span></div>
            <div className="hero-sub">{num(week.minutes)} min active · ≈ {num(week.fatG, 1)} g fat</div>
          </div>
        </div>
        <div className="bars" aria-label="Calories burned, last 7 days">
          {perDay.map(({ d, kcal }) => (
            <div className={`bar ${d === today ? 'today' : ''}`} key={d} title={`${fmtDay(d)}: ${num(kcal)} kcal`}>
              <div className="bar-fill" style={{ height: `${Math.max(kcal > 0 ? 8 : 3, (kcal / maxKcal) * 100)}%` }} />
              <span>{fmtDay(d).slice(0, 2)}</span>
            </div>
          ))}
        </div>
        <p className="hero-note">
          {week.kcal > 0 ? (
            <>If every week were like this one, workouts alone would take off <b className="good">≈ {num(week.kgEffect, 2)} kg</b> a week — on top of what you eat.</>
          ) : (
            <>Log a walk or a gym session below to see what it adds up to.</>
          )}
        </p>
      </section>

      <div className="grid3">
        <Stat label="Today" value={`${num(todayTotal.kcal)} kcal`} />
        <Stat label="Minutes" value={num(todayTotal.minutes)} sub="today" />
        <Stat label="Fat" value={`${num(todayTotal.fatG, 1)} g`} sub="today" />
      </div>

      <section className="card stack" ref={formRef}>
        <h2 style={{ margin: 0 }}>{editId ? 'Edit workout' : 'Log workout'}</h2>
        {!latest && <div className="banner warn">Log your weight first — calories burned depend on it.</div>}
        <Segmented<WorkoutKind>
          value={kind}
          onChange={setKind}
          options={[{ value: 'walk', label: KIND_LABEL.walk }, { value: 'gym', label: KIND_LABEL.gym }]}
        />

        <div className="grid2">
          <div>
            <label htmlFor="wk-date">Date</label>
            <input id="wk-date" type="date" value={dateVal} max={today} onChange={(e) => setDate(e.target.value || today)} />
          </div>
          <div>
            <label htmlFor="wk-time">Time</label>
            <input id="wk-time" type="time" value={timeVal} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>

        <div className="grid2">
          <div>
            <label htmlFor="wk-min">{kind === 'walk' ? 'Walk (minutes)' : 'Session (minutes)'}</label>
            <NumInput id="wk-min" label="Minutes" value={minutes} onChange={setMinutes} />
          </div>
          {kind === 'walk' && (
            <div>
              <label htmlFor="wk-steps">Steps (optional)</label>
              <NumInput id="wk-steps" label="Steps" value={steps} onChange={setSteps} />
            </div>
          )}
        </div>

        {kind === 'gym' && (
          <>
            <div>
              <label>Tap to add exercises — tap again to remove</label>
              <div className="chips">
                {GYM_PRESETS.map((p) => (
                  <button type="button" key={p.name} className={`chip-btn ${rows.some((r) => r.name === p.name) ? 'on' : ''}`} onClick={() => togglePreset(p.name, p.met)}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="wk-custom">Or add your own category</label>
              <div className="row">
                <input id="wk-custom" className="grow" placeholder="e.g. Rowing machine" value={customName} maxLength={80} onChange={(e) => setCustomName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustom())} />
                <button type="button" className="secondary" disabled={!customName.trim()} onClick={addCustom}>＋ Add</button>
              </div>
              <div style={{ marginTop: 8 }}>
                <Segmented<number> value={customMet} onChange={setCustomMet} options={INTENSITIES.map((i) => ({ value: i.value, label: i.label }))} />
              </div>
              <p className="muted small">Pick how hard it feels — it sets the calorie estimate for your own categories.</p>
            </div>

            {rows.length > 0 && (
              <label style={{ margin: 0 }}>
                Your session — {rows.length} exercise{rows.length > 1 ? 's' : ''} (nothing is saved until you press Save)
              </label>
            )}
            {rows.map((r, idx) => (
              <div className="item-edit" key={r.uid}>
                <div className="row">
                  <b className="grow">{r.name}</b>
                  {est && est.itemKcal[idx] > 0 && <span className="chip">≈ {num(est.itemKcal[idx])} kcal</span>}
                  <button type="button" className="ghost small" aria-label={`Remove ${r.name}`} onClick={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))}>✕</button>
                </div>
                {r.setReps && <p className="muted small" style={{ margin: '.3rem 0 0' }}>Tracked reps: {r.setReps.join(' · ')} (changing sets/reps below replaces these)</p>}
                <div className="nums" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                  <div>
                    <label>Sets</label>
                    <NumInput label={`${r.name} sets`} value={r.sets} onChange={(n) => patch(r.uid, { sets: n })} />
                  </div>
                  <div>
                    <label>Reps</label>
                    <NumInput label={`${r.name} reps`} value={r.reps} onChange={(n) => patch(r.uid, { reps: n })} />
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        <div>
          <label htmlFor="wk-note">Note (optional)</label>
          <input id="wk-note" value={note} maxLength={500} placeholder="How did it feel?" onChange={(e) => setNote(e.target.value)} />
        </div>

        {est && latest && (
          <div className="estimate">
            <div>
              <div className="estimate-big">≈ {num(est.kcal)} kcal</div>
              <div className="muted small">≈ {num(est.fatG, 1)} g fat{est.distanceKm ? ` · ${est.distanceKm} km at ${est.speedKmh} km/h` : ''}{kind === 'gym' && est.repsPerMin !== undefined && rows.length > 0 ? ` · ${est.repsPerMin} reps/min (pace ×${est.paceFactor})` : ''}</div>
            </div>
            <div className="muted small right">at {latest.kg} kg</div>
          </div>
        )}

        <ErrorBanner error={save.error} />
        {formError && <div className="banner error" role="alert">{formError}</div>}
        {justSaved !== null && !editId && <div className="banner info">Saved ✓ — that's ≈ {num(justSaved)} kcal burned. Keep going!</div>}
        <div className="row">
          {editId !== null && <button type="button" className="secondary" onClick={reset}>Cancel</button>}
          <button className="grow" disabled={save.isPending || !latest} onClick={onSave}>
            {save.isPending ? 'Saving…' : `${editId ? 'Update' : 'Save'} workout${kind === 'gym' && rows.length > 0 ? ` (${rows.length} exercise${rows.length > 1 ? 's' : ''})` : ''}`}
          </button>
        </div>
        <p className="muted small">Calories are extra burn on top of your normal day (above resting), estimated from your weight. If your Settings activity level already counts exercise, pick a lower level so it isn't counted twice.</p>
      </section>

      <ErrorBanner error={workoutsQ.error ?? del.error} />
      {workoutsQ.isLoading && <Loading />}
      {!workoutsQ.isLoading && workouts.length === 0 && <p className="muted center">No workouts logged yet.</p>}
      {Object.entries(grouped).map(([d, list]) => (
        <section className="stack" key={d}>
          <h3 className="muted">{d === today ? 'Today' : fmtDay(d)}</h3>
          {list.map((w) => (
            <article className={`card meal workout-${w.kind}`} key={w.id}>
              <div className="row between">
                <div>
                  <b>{w.time}</b> <span className="chip muted">{KIND_LABEL[w.kind]}</span>
                  {countsForDate(w) !== w.date && <span className="muted small"> · after midnight, counts for {fmtDay(countsForDate(w))}</span>}
                </div>
                <b>{num(w.kcal)} kcal</b>
              </div>
              <p className="muted small">
                {num(w.minutes)} min · ≈ {num(kcalToFatG(w.kcal), 1)} g fat
                {w.kind === 'walk' && w.steps > 0 && <> · {num(w.steps)} steps</>}
              </p>
              {w.items.length > 0 && (
                <ul className="meal-items">
                  {w.items.map((i, idx) => (
                    <li key={idx}>
                      <span>{i.name}</span>
                      <span className="muted">{i.setReps ? `${i.sets} set${i.sets > 1 ? 's' : ''}: ${i.setReps.join(' · ')}` : `${i.sets} × ${i.reps}`}</span>
                    </li>
                  ))}
                </ul>
              )}
              {w.note && <p className="small">📝 {w.note}</p>}
              <div className="row mt">
                <button className="secondary small" onClick={() => edit(w)}>Edit</button>
                <button className="ghost small" disabled={del.isPending} onClick={() => confirm(`Delete this ${w.kind === 'walk' ? 'walk' : 'gym session'} (${num(w.kcal)} kcal)?`) && del.mutate(w.id)}>Delete</button>
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
