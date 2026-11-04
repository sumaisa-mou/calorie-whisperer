import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../lib/useApp';
import { useSaveWorkout } from '../lib/queries';
import { ErrorBanner, Loading, Segmented } from '../components/ui';
import { activeMs, fmtClock, loadLive, saveLive, toItems, type Live } from '../lib/liveWorkout';
import { estimateWorkout, GYM_PRESETS, INTENSITIES } from '../../shared/workout';
import { nowTimeInTz, todayInTz } from '../../shared/dates';
import { num } from '../lib/format';

const MAX_SETS = 30;

type WakeLock = { release(): Promise<void> };
type NavWithWakeLock = Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLock> } };

export default function LiveWorkout() {
  const { loading, profile, latest } = useApp();
  const nav = useNavigate();
  const save = useSaveWorkout();
  const [live, setLive] = useState<Live>(() => loadLive() ?? { startedAt: Date.now(), sets: [], current: null, pausedMs: 0, pausedAt: null });
  const [now, setNow] = useState(() => Date.now());
  const [reps, setReps] = useState('');
  const [customName, setCustomName] = useState('');
  const [customMet, setCustomMet] = useState<number>(5);
  const [formError, setFormError] = useState<string | null>(null);
  const repsRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  // persist every change so a refresh / locked phone never loses the session
  useEffect(() => {
    if (!finished.current) saveLive(live);
  }, [live]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // keep the screen on while training (where the browser supports it)
  useEffect(() => {
    let lock: WakeLock | null = null;
    const acquire = async () => {
      try {
        lock = (await (navigator as NavWithWakeLock).wakeLock?.request('screen')) ?? null;
      } catch {
        /* not supported / denied */
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && acquire();
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, []);

  const paused = live.pausedAt !== null;
  const elapsedMs = activeMs(live, now);
  const elapsedMin = elapsedMs / 60000;
  const items = useMemo(() => toItems(live.sets), [live.sets]);
  const est = useMemo(
    () => (latest ? estimateWorkout({ kind: 'gym', minutes: elapsedMin, steps: 0, items }, latest.kg, profile?.heightCm) : null),
    [latest, elapsedMin, items, profile?.heightCm],
  );

  if (loading) return <Loading />;

  const current = live.current;
  const currentSets = current ? live.sets.filter((s) => s.name === current.name).length : 0;
  const planItem = current ? live.plan?.find((p) => p.name === current.name) : undefined;
  const pause = () => setLive((l) => (l.pausedAt ? l : { ...l, pausedAt: Date.now() }));
  const resume = () => setLive((l) => (l.pausedAt ? { ...l, pausedMs: l.pausedMs + (Date.now() - l.pausedAt), pausedAt: null } : l));
  const pick = (name: string, met: number) => {
    if (paused) return;
    setLive((l) => ({ ...l, current: { name, met } }));
    setFormError(null);
    setTimeout(() => repsRef.current?.focus(), 0);
  };

  function addSet() {
    if (!current || paused) return;
    const n = Math.round(Number(reps));
    if (!Number.isFinite(n) || n < 1 || n > 500) return setFormError('Enter the reps for this set (1–500).');
    if (currentSets >= MAX_SETS) return setFormError(`Max ${MAX_SETS} sets per exercise.`);
    setFormError(null);
    setLive((l) => ({ ...l, sets: [...l.sets, { name: current.name, met: current.met, reps: n }] }));
    setReps('');
    repsRef.current?.focus();
  }

  function addCustom() {
    const name = customName.trim();
    if (!name) return;
    pick(name, customMet);
    setCustomName('');
  }

  function discard() {
    if (!confirm('Discard this session? Nothing will be saved.')) return;
    finished.current = true;
    saveLive(null);
    nav('/workout', { replace: true });
  }

  async function finish() {
    setFormError(null);
    if (live.sets.length === 0) return setFormError('Add at least one set before finishing.');
    const started = new Date(live.startedAt);
    const tz = profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      await save.mutateAsync({
        workout: {
          date: todayInTz(tz, started),
          time: nowTimeInTz(tz, started),
          kind: 'gym',
          minutes: Math.min(600, Math.max(1, Math.round(activeMs(live, Date.now()) / 6000) / 10)),
          steps: 0,
          items,
          note: '',
        },
      });
      finished.current = true;
      saveLive(null);
      nav('/workout', { replace: true });
    } catch {
      /* shown by ErrorBanner */
    }
  }

  return (
    <div className="stack live">
      <div className="header">
        <h1>Gym session</h1>
        <button className="ghost small" onClick={discard}>Discard</button>
      </div>

      <section className="hero">
        <div className="row between">
          <h2 style={{ margin: 0 }}>{paused ? 'Paused' : 'Time'}</h2>
          <button type="button" className="pause-btn" onClick={paused ? resume : pause}>
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
        </div>
        <div className={`live-timer ${paused ? 'is-paused' : ''}`} aria-live="off">{fmtClock(elapsedMs)}</div>
        <div className="hero-main" style={{ marginTop: '.6rem' }}>
          <div>
            <div className="hero-big">≈ {num(est?.kcal ?? 0)} <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>kcal</span></div>
            <div className="hero-sub">≈ {num(est?.fatG ?? 0, 1)} g fat · {live.sets.length} set{live.sets.length === 1 ? '' : 's'} · {items.length} exercise{items.length === 1 ? '' : 's'}</div>
            {est?.repsPerMin !== undefined && live.sets.length > 0 && (
              <div className="hero-sub">{num(est.repsPerMin, 1)} reps/min · pace ×{est.paceFactor}</div>
            )}
          </div>
        </div>
      </section>

      {!latest && <div className="banner warn">Log your weight first — calories burned depend on it, and the session can't be saved without it.</div>}

      {live.plan && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Today's plan</h2>
          {live.plan.map((p) => {
            const done = live.sets.filter((s) => s.name === p.name).length;
            const complete = done >= p.sets;
            return (
              <button type="button" key={p.name} disabled={paused} className={`plan-row ${current?.name === p.name ? 'on' : ''} ${complete ? 'done' : ''}`} onClick={() => pick(p.name, p.met)}>
                <span className="grow" style={{ textAlign: 'left' }}>
                  <b>{complete ? '✓ ' : ''}{p.name}</b>
                  {p.note && <span className="muted small" style={{ display: 'block', fontWeight: 500 }}>{p.note}</span>}
                </span>
                <span className="chip">{Math.min(done, p.sets)}/{p.sets} × {p.reps}</span>
              </button>
            );
          })}
        </section>
      )}

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Exercise</h2>
        <div className="chips">
          {GYM_PRESETS.map((p) => (
            <button type="button" key={p.name} className={`chip-btn ${current?.name === p.name ? 'on' : ''}`} disabled={paused} onClick={() => pick(p.name, p.met)}>
              {p.name}
            </button>
          ))}
          {items
            .filter((i) => !GYM_PRESETS.some((p) => p.name === i.name))
            .map((i) => (
              <button type="button" key={i.name} className={`chip-btn ${current?.name === i.name ? 'on' : ''}`} disabled={paused} onClick={() => pick(i.name, i.met)}>
                {i.name}
              </button>
            ))}
        </div>
        <div>
          <label htmlFor="lv-custom">Or add your own category</label>
          <div className="row">
            <input id="lv-custom" className="grow" placeholder="e.g. Rowing machine" value={customName} maxLength={80} onChange={(e) => setCustomName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustom())} />
            <button type="button" className="secondary" disabled={!customName.trim()} onClick={addCustom}>Use</button>
          </div>
          <div style={{ marginTop: 8 }}>
            <Segmented<number> value={customMet} onChange={setCustomMet} options={INTENSITIES.map((i) => ({ value: i.value, label: i.label }))} />
          </div>
        </div>
      </section>

      <section className="card stack">
        {current ? (
          <>
            <h2 style={{ margin: 0 }}>{current.name} — Set {currentSets + 1}{planItem ? <span className="muted small" style={{ fontWeight: 600 }}> · target {planItem.reps} reps</span> : null}</h2>
            <form className="row" onSubmit={(e) => (e.preventDefault(), addSet())}>
              <input
                ref={repsRef}
                className="reps-input grow"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder={planItem ? `Reps (target ${planItem.reps})` : 'Reps'}
                aria-label="Reps"
                disabled={paused}
                value={reps}
                onChange={(e) => setReps(e.target.value.replace(/\D/g, '').slice(0, 3))}
              />
              <button disabled={!reps || paused}>＋ Add set</button>
            </form>
          </>
        ) : (
          <p className="muted center" style={{ margin: 0 }}>Pick an exercise above, then enter your reps for each set.</p>
        )}
        {paused && <div className="banner info">Paused — the clock is stopped. Resume to keep logging sets.</div>}
        {formError && <div className="banner error" role="alert">{formError}</div>}
      </section>

      {items.length > 0 && (
        <section className="card stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}>This session</h2>
            <button className="ghost small" onClick={() => setLive((l) => ({ ...l, sets: l.sets.slice(0, -1) }))}>↩ Undo last set</button>
          </div>
          {items.map((it, idx) => (
            <div className="item-edit" key={it.name}>
              <div className="row">
                <b className="grow">{it.name}</b>
                {est && est.itemKcal[idx] > 0 && <span className="chip">≈ {num(est.itemKcal[idx])} kcal</span>}
              </div>
              <p className="small" style={{ margin: '.35rem 0 0' }}>
                {it.setReps!.map((r, i) => (
                  <span key={i} className="set-pill">Set {i + 1}: <b>{r}</b></span>
                ))}
              </p>
            </div>
          ))}
        </section>
      )}

      <ErrorBanner error={save.error} />
      <div className="live-bar">
        <button className="block" disabled={save.isPending || !latest || live.sets.length === 0} onClick={finish}>
          {save.isPending ? 'Saving…' : `Finish & save · ${fmtClock(elapsedMs)}`}
        </button>
      </div>
    </div>
  );
}
