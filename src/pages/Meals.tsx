import { useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../lib/useApp';
import { useDeleteMeal, useMeals, useReviewDay, useReviews } from '../lib/queries';
import { ErrorBanner, Loading, Progress, Stat } from '../components/ui';
import { proteinTarget, sumNutrients } from '../../shared/calc';
import { addDays, isDateStr } from '../../shared/dates';
import { fmtDay, num } from '../lib/format';
import type { DayReview, Meal, MealReview, MealVerdict } from '../../shared/types';

const TYPE_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' } as const;

const VERDICT: Record<MealVerdict, { label: string; icon: string }> = {
  necessary: { label: 'Necessary', icon: '✅' },
  improve: { label: 'Could be lighter', icon: '🟡' },
  avoidable: { label: 'Avoidable', icon: '🔴' },
};

/** A tag is only valid while the meal is unchanged since the review. */
const tagFor = (review: DayReview | null, meal: Meal): MealReview | null => {
  const r = review?.meals.find((m) => m.id === meal.id);
  return r && Math.round(meal.calories) === r.calories ? r : null;
};

function MealCard({ meal, tag, onDelete, busy }: { meal: Meal; tag: MealReview | null; onDelete: () => void; busy: boolean }) {
  return (
    <article className={`card meal meal-${meal.mealType}`}>
      <div className="row between">
        <div>
          <b>{meal.time}</b> <span className="chip muted">{TYPE_LABEL[meal.mealType]}</span>
          {tag && <span className={`tag tag-${tag.verdict}`}>{VERDICT[tag.verdict].icon} {VERDICT[tag.verdict].label}</span>}
        </div>
        <b>{num(meal.calories)} kcal</b>
      </div>
      <ul className="meal-items">
        {meal.items.map((it, i) => (
          <li key={i}>
            <span>{it.name} <span className="muted small">{it.grams ? `· ${num(it.grams)} g` : ''}</span></span>
            <span className="muted">{num(it.calories)}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">P {num(meal.protein, 1)} g · C {num(meal.carbs, 1)} g · F {num(meal.fat, 1)} g
        {meal.fiber > 0 && <> · Fiber {num(meal.fiber, 1)} g</>}
        {meal.sugar > 0 && <> · Sugar {num(meal.sugar, 1)} g</>}
        {meal.sodium > 0 && <> · Na {num(meal.sodium)} mg</>}
      </p>
      {meal.note && <p className="small">📝 {meal.note}</p>}
      {tag && (tag.reason || tag.savableKcal > 0) && (
        <p className={`review-note review-${tag.verdict} small`}>
          {tag.reason}
          {tag.avoidItems.length > 0 && <> <b>Weak spot: {tag.avoidItems.join(', ')}.</b></>}
          {tag.savableKcal > 0 && <> Could have saved ≈ {num(tag.savableKcal)} kcal.</>}
        </p>
      )}
      <div className="row mt">
        <Link to={`/meals/${meal.id}`} className="btn secondary small">Edit</Link>
        <button className="ghost small" disabled={busy} onClick={onDelete}>Delete</button>
      </div>
    </article>
  );
}

export default function Meals() {
  const { loading, error, today, target, latest } = useApp();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const q = params.get('date');
  const date = q && isDateStr(q) ? q : today;
  const mealsQ = useMeals(date, date);
  const del = useDeleteMeal();
  const reviewsQ = useReviews(date, date);
  const reviewMut = useReviewDay();
  const review = reviewsQ.data?.[0] ?? null;

  // A finished day that went over target is reviewed automatically, once. Today is reviewed on demand.
  const autoTried = useRef<string | null>(null);
  useEffect(() => {
    if (!target || date >= today || mealsQ.isLoading || reviewsQ.isLoading || reviewMut.isPending) return;
    if (sumNutrients(mealsQ.data ?? []).calories <= target.target) return;
    if ((reviewsQ.data?.length ?? 0) > 0 || autoTried.current === date) return;
    autoTried.current = date;
    reviewMut.mutate(date);
  }, [target, date, today, mealsQ.isLoading, mealsQ.data, reviewsQ.isLoading, reviewsQ.data, reviewMut]);

  const go = (d: string) => setParams({ date: d }, { replace: true });

  if (loading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;

  const meals = mealsQ.data ?? [];
  const totals = sumNutrients(meals);
  const over = target ? totals.calories - target.target : 0;
  const stale = !!review && meals.some((m) => !tagFor(review, m));
  const saved = review ? review.meals.reduce((s, m) => s + m.savableKcal, 0) : 0;

  return (
    <div className="stack">
      <h1>Meals</h1>

      <div className="row between">
        <button className="secondary small" aria-label="Previous day" onClick={() => go(addDays(date, -1))}>◀</button>
        <div className="center grow">
          <b>{date === today ? 'Today' : fmtDay(date)}</b>
          <input type="date" value={date} max={today} onChange={(e) => e.target.value && go(e.target.value)} aria-label="Pick a date" style={{ marginTop: 4, textAlign: 'center' }} />
        </div>
        <button className="secondary small" aria-label="Next day" disabled={date >= today} onClick={() => go(addDays(date, 1))}>▶</button>
      </div>

      <section className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Day total</h2>
          <b>{num(totals.calories)}{target && <span className="muted"> / {num(target.target)}</span>} kcal</b>
        </div>
        {target && <div style={{ marginTop: 8 }}><Progress value={totals.calories} max={target.target} /></div>}
        <div className="grid3 mt">
          <Stat macro="p" label="Protein" value={`${num(totals.protein)} g`} sub={latest ? `of ${proteinTarget(latest.kg)} g` : undefined} bar={latest ? totals.protein / proteinTarget(latest.kg) : undefined} />
          <Stat macro="c" label="Carbs" value={`${num(totals.carbs)} g`} />
          <Stat macro="f" label="Fat" value={`${num(totals.fat)} g`} />
        </div>
      </section>

      {over > 0 && meals.length > 0 && (
        <section className="card review-card">
          <div className="row between">
            <h2 style={{ margin: 0 }}>Over target by {num(over)} kcal</h2>
            {!reviewMut.isPending && (
              <button className="secondary small" onClick={() => reviewMut.mutate(date)}>
                {review ? '↻ Re-run' : '✨ Review with AI'}
              </button>
            )}
          </div>
          {reviewMut.isPending && <p className="muted small"><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2, marginRight: 8, verticalAlign: '-2px' }} />Checking which meals you really needed…</p>}
          {review && !reviewMut.isPending && (
            <>
              {review.summary && <p>{review.summary}</p>}
              {saved > 0 && <p className="small"><b>Could have saved ≈ {num(saved)} kcal</b> across the tagged meals.</p>}
              {review.tip && <p className="review-tip small">💡 {review.tip}</p>}
              {stale && <p className="muted small">You changed meals after this review — tap Re-run to refresh the tags.</p>}
            </>
          )}
          {!review && !reviewMut.isPending && !reviewMut.error && <p className="muted small">AI tags each meal as necessary, could be lighter, or avoidable — judged by food quality, not just calories.</p>}
          <ErrorBanner error={reviewMut.error} />
        </section>
      )}

      <ErrorBanner error={mealsQ.error ?? del.error} />
      {mealsQ.isLoading && <Loading />}
      {!mealsQ.isLoading && meals.length === 0 && <p className="muted center">No meals logged for this day.</p>}
      {meals.map((m) => (
        <MealCard
          key={m.id}
          meal={m}
          tag={tagFor(review, m)}
          busy={del.isPending}
          onDelete={() => confirm(`Delete this ${TYPE_LABEL[m.mealType].toLowerCase()} (${m.calories} kcal)?`) && del.mutate(m.id)}
        />
      ))}

      <button className="fab" onClick={() => nav(`/meals/new?date=${date}`)}>＋ Add meal</button>
    </div>
  );
}
