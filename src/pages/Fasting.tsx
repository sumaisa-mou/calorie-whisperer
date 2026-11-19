import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../lib/useApp';
import { useFastingPlan, useMeals, useSaveFastingPlan } from '../lib/queries';
import { ErrorBanner, Loading, Segmented, Stat } from '../components/ui';
import { addDays, nowTimeInTz, weekday } from '../../shared/dates';
import {
  currentFast,
  eatingWindow,
  FAST_MIN_KCAL,
  FAST_OPTIONS,
  fastingDays,
  fastLabel,
  mealFlow,
  NO_PLAN,
  summarizeEating,
  summarizeFasting,
} from '../../shared/fasting';
import { fmtDay, fmtHours } from '../lib/format';

type Tab = 'eat' | 'fast';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HISTORY_DAYS = 28;
const FLOW_DAYS = 7;
const MEAL_LABEL: Record<string, string> = { breakfast: '🍳 Breakfast', lunch: '🥗 Lunch', dinner: '🍽 Dinner', snack: '🍎 Snack', meal: '🍴 Meal' };

/** Re-renders every minute so the live clocks keep counting. */
function useMinuteTick() {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
}

export default function FastingPage() {
  const { loading, error, profile, today } = useApp();
  useMinuteTick();
  const planQ = useFastingPlan();
  const save = useSaveFastingPlan();
  const [picked, setPicked] = useState<Tab | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showAllFlow, setShowAllFlow] = useState(false);

  const from = addDays(today, -(HISTORY_DAYS - 1));
  // fetch a few days earlier so the first day still has a "previous meal" to measure from
  const mealsQ = useMeals(addDays(from, -4), today);
  const plan = planQ.data ?? NO_PLAN;
  const weekStart = profile?.weekStart ?? 1;
  const tz = profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const nowTime = nowTimeInTz(tz);

  const meals = mealsQ.data;
  const live = useMemo(() => (meals ? currentFast(meals, today, nowTime, plan) : null), [meals, today, nowTime, plan]);
  const win = useMemo(() => (meals ? eatingWindow(meals, today, nowTime, plan) : null), [meals, today, nowTime, plan]);
  const days = useMemo(() => (meals ? fastingDays(meals, from, today, plan) : []), [meals, from, today, plan]);
  const flow = useMemo(() => (meals ? mealFlow(meals, from, today).reverse() : []), [meals, from, today]);
  const fastSum = useMemo(() => summarizeFasting(days), [days]);
  const eatSum = useMemo(() => summarizeEating(days), [days]);
  const hasPlan = plan.some((h) => h > 0);

  if (loading || planQ.isLoading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;

  // while the eating window is open you are not fasting yet; open on whichever tab matters right now
  const eating = win?.state === 'open' && win.windowHours > 0;
  const tab: Tab = picked ?? (eating ? 'eat' : 'fast');

  const order = Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
  const setDay = (wd: number, hours: number) => save.mutate(plan.map((h, i) => (i === wd ? hours : h)));
  const history = [...days].reverse().filter((d) => d.firstMeal);
  const shown = showAll ? history : history.slice(0, 14);
  const flowShown = showAllFlow ? flow : flow.slice(0, FLOW_DAYS);
  const dayInfo = new Map(days.map((d) => [d.date, d]));
  const dayName = (date: string) => (date === today ? 'today' : date === addDays(today, 1) ? 'tomorrow' : DAY_NAMES[weekday(date)]);
  const toggleAll = (
    <>
      {history.length > 14 && (
        <button type="button" className="secondary small" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${history.length} days`}
        </button>
      )}
    </>
  );

  return (
    <div className="stack">
      <div className="header">
        <div>
          <h1>Fasting</h1>
          <div className="muted small">{fmtDay(today)}</div>
        </div>
      </div>

      <Segmented<Tab>
        value={tab}
        onChange={setPicked}
        options={[{ value: 'eat', label: '🍽 Eat' }, { value: 'fast', label: '⏳ Fast' }]}
      />

      {tab === 'eat' && (
        <>
          <section className="card stack">
            <h2 style={{ margin: 0 }}>Eating window</h2>
            {mealsQ.isLoading && <Loading />}
            {win && win.state === 'none' && (
              <>
                <p style={{ margin: 0 }}>
                  Not open yet — it opens with your first meal of {FAST_MIN_KCAL} kcal or more.
                </p>
                <p className="muted small" style={{ margin: 0 }}>
                  {win.windowHours > 0 ? `Today's goal is ${fastLabel(win.goalHours)}: ${win.windowHours}h to eat in.` : hasPlan ? 'No fasting goal today — eat freely.' : 'Set your schedule below to get a window.'}
                </p>
                {live && !live.done && live.goalHours > 0 && (
                  <button type="button" className="secondary small" onClick={() => setPicked('fast')}>
                    You're still fasting — {fmtHours(live.goalHours - live.elapsedHours)} left →
                  </button>
                )}
              </>
            )}
            {win && win.state !== 'none' && (
              <>
                <div>
                  {win.windowHours > 0 && win.state === 'open' ? (
                    <>
                      <div className="estimate-big">{fmtHours(win.remainingHours)} left</div>
                      <div className="muted small">of your {win.windowHours}h window ({fastLabel(win.goalHours)}) · closes at {win.closeTime}{win.closeDate !== today ? ` (${dayName(win.closeDate as string)})` : ''}</div>
                    </>
                  ) : win.state === 'closed' ? (
                    <div className="estimate-big">Window closed</div>
                  ) : (
                    <>
                      <div className="estimate-big">{fmtHours(win.elapsedHours)}</div>
                      <div className="muted small">eating so far today — no limit on a rest day</div>
                    </>
                  )}
                </div>
                {win.windowHours > 0 && (
                  <div className="progress"><div style={{ width: `${Math.min(100, (win.elapsedHours / win.windowHours) * 100)}%` }} /></div>
                )}
                {win.state === 'closed' && (
                  <div className="banner warn">
                    Your {win.windowHours}h window closed at {win.closeTime}. Time to fast — your fast starts after your last meal.
                  </div>
                )}
                <div className="grid2">
                  <Stat label="First meal" value={win.firstTime ?? '—'} />
                  <Stat label="Last meal" value={win.lastTime ?? '—'} />
                  <Stat label="Meals" value={win.meals} sub={`${win.kcal} kcal`} />
                  <Stat label="Window used" value={fmtHours(win.elapsedHours)} sub={win.windowHours > 0 ? `of ${win.windowHours}h` : 'no limit today'} />
                </div>
                {win.state === 'closed' && (
                  <button type="button" className="secondary small" onClick={() => setPicked('fast')}>Go to Fast →</button>
                )}
              </>
            )}
          </section>

          {hasPlan && eatSum.planned > 0 && (
            <section className="card stack">
              <h2 style={{ margin: 0 }}>Last 4 weeks</h2>
              <div className="grid2">
                <Stat label="Within window" value={`${eatSum.within} / ${eatSum.planned}`} sub={`${Math.round((eatSum.within / eatSum.planned) * 100)}% of planned days`} tone={eatSum.within / eatSum.planned >= 0.7 ? 'good' : 'warn'} />
                <Stat label="Average window" value={eatSum.avgWindowHours === null ? '—' : fmtHours(eatSum.avgWindowHours)} sub="first → last meal" />
              </div>
            </section>
          )}

          {flow.length > 0 && (
            <section className="card stack">
              <h2 style={{ margin: 0 }}>Meal timeline</h2>
              <p className="muted small" style={{ margin: 0 }}>Time between your meals each day. The last arrow is the overnight fast, which ends at your next meal — breakfast or lunch, whichever comes first.</p>
              {flowShown.map((f) => {
                const info = dayInfo.get(f.date);
                const goal = f.overnight ? plan[weekday(f.overnight.date)] : 0;
                const night = f.overnight && goal > 0 ? (f.overnight.hours >= goal ? 'good' : 'bad') : '';
                return (
                  <div className="flow-day" key={f.date}>
                    <div className="row between">
                      <b>{f.date === today ? 'Today' : fmtDay(f.date)}</b>
                      {info && info.windowHours !== null && (
                        <span className={`small ${info.windowOk === null ? 'muted' : info.windowOk ? 'good' : 'bad'}`}>
                          {info.windowOk === null ? '' : info.windowOk ? '✓ ' : '✗ '}window {fmtHours(info.windowHours)}{info.allowedWindowHours > 0 ? ` of ${info.allowedWindowHours}h` : ''}
                        </span>
                      )}
                    </div>
                    <div className="flow">
                      {f.meals.map((m, i) => (
                        <span className="flow-item" key={i}>
                          <span className="flow-node" title={`${m.calories} kcal`}>
                            {MEAL_LABEL[m.mealType] ?? m.mealType}
                            <small>{m.time}</small>
                          </span>
                          {i < f.meals.length - 1 && <span className="flow-gap">→ {fmtHours(f.gaps[i])} →</span>}
                        </span>
                      ))}
                      {f.overnight ? (
                        <span className="flow-item">
                          <span className={`flow-gap ${night}`}>→ {fmtHours(f.overnight.hours)} →</span>
                          <span className="flow-node next">
                            {MEAL_LABEL[f.overnight.mealType] ?? f.overnight.mealType}
                            <small>{f.overnight.time}{f.overnight.date !== addDays(f.date, 1) ? ` · ${fmtDay(f.overnight.date)}` : ''}</small>
                          </span>
                        </span>
                      ) : (
                        <span className="flow-gap">
                          {f.date === today && live ? `→ fasting now · ${fmtHours(live.elapsedHours)} so far` : '→ no later meal logged'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {flow.length > FLOW_DAYS && (
                <button type="button" className="secondary small" onClick={() => setShowAllFlow((v) => !v)}>
                  {showAllFlow ? 'Show fewer' : `Show all ${flow.length} days`}
                </button>
              )}
            </section>
          )}
        </>
      )}

      {tab === 'fast' && (
        <>
          <section className="card stack">
            <h2 style={{ margin: 0 }}>Fasting</h2>
            {mealsQ.isLoading && <Loading />}
            {!mealsQ.isLoading && !live && <p className="muted" style={{ margin: 0 }}>Log a meal and your fast starts counting after it.</p>}
            {live && eating && win && (
              <>
                <p style={{ margin: 0 }}>
                  <b>Not fasting yet</b> — your eating window is open until <b>{win.closeTime}</b>. Your fast starts after your last meal.
                </p>
                <p className="muted small" style={{ margin: 0 }}>
                  {live.goalHours > 0
                    ? `Tomorrow's goal is ${fastLabel(live.goalHours)}: leave ${live.goalHours}h between your last meal and your next one.`
                    : "No fasting goal tomorrow — a rest day."}
                </p>
                <button type="button" className="secondary small" onClick={() => setPicked('eat')}>See eating window →</button>
              </>
            )}
            {live && !eating && (
              <>
                <div>
                  <div className="estimate-big">{fmtHours(live.elapsedHours)}</div>
                  <div className="muted small">since your last meal at {live.sinceTime}{live.sinceDate !== today ? ` (${fmtDay(live.sinceDate)})` : ''}</div>
                </div>
                {live.goalHours > 0 ? (
                  <>
                    <div className="progress"><div style={{ width: `${Math.min(100, (live.elapsedHours / live.goalHours) * 100)}%` }} /></div>
                    {live.done ? (
                      <div className="banner info">
                        Goal reached ✓ — {fastLabel(live.goalHours)} for {dayName(live.goalDate)}. You can eat whenever you're ready.
                      </div>
                    ) : (
                      <p style={{ margin: 0 }}>
                        <b>{fmtHours(live.goalHours - live.elapsedHours)}</b> to go for {dayName(live.goalDate)}'s {fastLabel(live.goalHours)} goal
                        {live.reachedTime && <> — eat after <b>{live.reachedTime}</b>{live.reachedDate !== today ? ` (${dayName(live.reachedDate as string)})` : ''}</>}.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="muted small" style={{ margin: 0 }}>
                    No fasting goal for {dayName(live.goalDate)} — {hasPlan ? 'a rest day.' : 'set your schedule below.'}
                  </p>
                )}
              </>
            )}
          </section>

          {hasPlan && fastSum.planned > 0 && (
            <section className="card stack">
              <h2 style={{ margin: 0 }}>Last 4 weeks</h2>
              <div className="grid2">
                <Stat label="Goals hit" value={`${fastSum.hits} / ${fastSum.planned}`} sub={`${Math.round((fastSum.hits / fastSum.planned) * 100)}% of planned days`} tone={fastSum.hits / fastSum.planned >= 0.7 ? 'good' : 'warn'} />
                <Stat label="Streak" value={`${fastSum.streak} ${fastSum.streak === 1 ? 'day' : 'days'}`} sub="goals in a row" />
                <Stat label="Average fast" value={fastSum.avgHours === null ? '—' : fmtHours(fastSum.avgHours)} />
                <Stat label="Longest fast" value={fastSum.longestHours === null ? '—' : fmtHours(fastSum.longestHours)} />
              </div>
            </section>
          )}

          {history.length > 0 && (
            <section className="card stack">
              <h2 style={{ margin: 0 }}>Daily fasts</h2>
              <table>
                <thead><tr><th>Day</th><th className="r">Fast</th><th className="r">Goal</th></tr></thead>
                <tbody>
                  {shown.map((d) => (
                    <tr key={d.date}>
                      <td>{fmtDay(d.date)}</td>
                      <td className="r"><b>{d.fastHours === null ? '—' : fmtHours(d.fastHours)}</b></td>
                      <td className={`r ${d.hit === null ? 'muted' : d.hit ? 'good' : 'bad'}`}>
                        {d.goalHours === 0 ? '—' : `${d.hit === null ? '' : d.hit ? '✓ ' : '✗ '}${fastLabel(d.goalHours)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {toggleAll}
            </section>
          )}
        </>
      )}

      <section className="card stack">
        <h2 style={{ margin: 0 }}>My schedule</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Pick a goal for each day, e.g. 16:8 on two days and 12:12 on three. A day's goal is the fast that ends at your first meal that day; the rest of the 24 hours is that day's eating window.
        </p>
        {order.map((wd) => (
          <div className="row between" key={wd}>
            <label htmlFor={`fast-${wd}`} style={{ margin: 0, fontWeight: wd === weekday(today) ? 700 : 500 }}>
              {DAY_NAMES[wd]}
            </label>
            <select id={`fast-${wd}`} value={plan[wd]} disabled={save.isPending} onChange={(e) => setDay(wd, Number(e.target.value))} style={{ width: 130 }}>
              {FAST_OPTIONS.map((h) => (
                <option key={h} value={h}>{h === 0 ? 'Off' : `${fastLabel(h)} (${h}h fast)`}</option>
              ))}
              {!(FAST_OPTIONS as readonly number[]).includes(plan[wd]) && <option value={plan[wd]}>{plan[wd]}h fast</option>}
            </select>
          </div>
        ))}
        <ErrorBanner error={save.error ?? planQ.error} />
      </section>

      <p className="muted small">
        Based on the meals you log — a forgotten meal makes a fast look longer than it was. Meals under {FAST_MIN_KCAL} kcal (black coffee, tea) don't open the window or break a fast. This is a tracker, not medical advice; long fasts aren't right for everyone.
      </p>
    </div>
  );
}
