import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../lib/useApp';
import { useDeleteMeal, useMeals } from '../lib/queries';
import { ErrorBanner, Loading, Progress, Stat } from '../components/ui';
import { sumNutrients } from '../../shared/calc';
import { addDays, isDateStr } from '../../shared/dates';
import { fmtDay, num } from '../lib/format';
import type { Meal } from '../../shared/types';

const TYPE_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' } as const;

function MealCard({ meal, onDelete, busy }: { meal: Meal; onDelete: () => void; busy: boolean }) {
  return (
    <article className={`card meal meal-${meal.mealType}`}>
      <div className="row between">
        <div>
          <b>{meal.time}</b> <span className="chip muted">{TYPE_LABEL[meal.mealType]}</span>
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
      <div className="row mt">
        <Link to={`/meals/${meal.id}`} className="btn secondary small">Edit</Link>
        <button className="ghost small" disabled={busy} onClick={onDelete}>Delete</button>
      </div>
    </article>
  );
}

export default function Meals() {
  const { loading, error, today, target } = useApp();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const q = params.get('date');
  const date = q && isDateStr(q) ? q : today;
  const mealsQ = useMeals(date, date);
  const del = useDeleteMeal();

  const go = (d: string) => setParams({ date: d }, { replace: true });

  if (loading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;

  const meals = mealsQ.data ?? [];
  const totals = sumNutrients(meals);

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
          <Stat macro="p" label="Protein" value={`${num(totals.protein)} g`} />
          <Stat macro="c" label="Carbs" value={`${num(totals.carbs)} g`} />
          <Stat macro="f" label="Fat" value={`${num(totals.fat)} g`} />
        </div>
      </section>

      <ErrorBanner error={mealsQ.error ?? del.error} />
      {mealsQ.isLoading && <Loading />}
      {!mealsQ.isLoading && meals.length === 0 && <p className="muted center">No meals logged for this day.</p>}
      {meals.map((m) => (
        <MealCard
          key={m.id}
          meal={m}
          busy={del.isPending}
          onDelete={() => confirm(`Delete this ${TYPE_LABEL[m.mealType].toLowerCase()} (${m.calories} kcal)?`) && del.mutate(m.id)}
        />
      ))}

      <button className="fab" onClick={() => nav(`/meals/new?date=${date}`)}>＋ Add meal</button>
    </div>
  );
}
