import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../lib/useApp';
import { analyzePhoto, analyzeText, searchFoods, useDeleteMeal, useMeal, useSaveMeal } from '../lib/queries';
import { ErrorBanner, Loading, Segmented, Spinner } from '../components/ui';
import NumInput from '../components/NumInput';
import { fileToJpegBase64 } from '../lib/image';
import { mealTypeForTime, round, scaleItem, sumNutrients } from '../../shared/calc';
import { isDateStr, nowTimeInTz } from '../../shared/dates';
import { num } from '../lib/format';
import type { FoodItem, FoodSearchHit, MealType } from '../../shared/types';

type Row = FoodItem & { uid: string };
let uidN = 0;
const withUid = (i: FoodItem): Row => ({ ...i, uid: `r${++uidN}` });
const blank = (): Row => withUid({ name: '', grams: 100, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 });
const stripUid = ({ uid: _u, ...rest }: Row): FoodItem => rest;

type Source = 'photo' | 'text' | 'search' | 'manual';

export default function MealEdit() {
  const { id: idParam } = useParams();
  const editId = idParam ? Number(idParam) : null;
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { profile, today, loading } = useApp();
  const existing = useMeal(editId);
  const save = useSaveMeal();
  const del = useDeleteMeal();

  const qDate = params.get('date');
  const [date, setDate] = useState(qDate && isDateStr(qDate) ? qDate : today);
  const [time, setTime] = useState('');
  const [mealType, setMealType] = useState<MealType>('lunch');
  const [typeTouched, setTypeTouched] = useState(false);
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [aiNotes, setAiNotes] = useState('');
  const [source, setSource] = useState<Source>('photo');
  const [formError, setFormError] = useState<string | null>(null);
  const initialised = useRef(false);

  // initialise once the profile (timezone) / existing meal is available
  useEffect(() => {
    if (initialised.current || loading) return;
    if (editId !== null) {
      if (!existing.data) return;
      const m = existing.data;
      setDate(m.date);
      setTime(m.time);
      setMealType(m.mealType);
      setTypeTouched(true);
      setNote(m.note);
      setRows(m.items.map(withUid));
    } else {
      const t = nowTimeInTz(profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
      setTime(t);
      setMealType(mealTypeForTime(t));
    }
    initialised.current = true;
  }, [loading, editId, existing.data, profile]);

  if (loading || (editId !== null && existing.isLoading)) return <Loading />;
  if (editId !== null && existing.error) return <ErrorBanner error={existing.error} />;

  const totals = sumNutrients(rows);
  const addItems = (items: FoodItem[]) => setRows((r) => [...r.filter((x) => x.name.trim() || x.calories > 0), ...items.map(withUid)]);
  const patch = (uid: string, p: Partial<FoodItem>) => setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...p } : r)));
  const changeGrams = (uid: string, g: number) => setRows((rs) => rs.map((r) => (r.uid === uid ? { ...scaleItem(r, g), uid } : r)));

  async function onSave() {
    setFormError(null);
    const items = rows.filter((r) => r.name.trim()).map(stripUid);
    if (items.length === 0) return setFormError('Add at least one food item with a name.');
    if (!/^\d{2}:\d{2}$/.test(time)) return setFormError('Pick a valid time.');
    await save.mutateAsync({
      id: editId ?? undefined,
      meal: { date, time, mealType, note: note.trim(), items: items.map((i) => ({ ...i, name: i.name.trim() })) },
    });
    nav(`/meals?date=${date}`, { replace: true });
  }

  async function onDelete() {
    if (editId === null || !confirm('Delete this meal?')) return;
    await del.mutateAsync(editId);
    nav(`/meals?date=${date}`, { replace: true });
  }

  return (
    <div className="stack">
      <div className="header">
        <h1>{editId ? 'Edit meal' : 'Add meal'}</h1>
        <Link to={`/meals?date=${date}`} className="btn secondary small">Cancel</Link>
      </div>

      <section className="card stack">
        <div className="grid2">
          <div>
            <label htmlFor="m-date">Date</label>
            <input id="m-date" type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </div>
          <div>
            <label htmlFor="m-time">Time</label>
            <input
              id="m-time"
              type="time"
              value={time}
              onChange={(e) => {
                setTime(e.target.value);
                if (!typeTouched && e.target.value) setMealType(mealTypeForTime(e.target.value));
              }}
            />
          </div>
        </div>
        <div>
          <label htmlFor="m-type">Meal</label>
          <select id="m-type" value={mealType} onChange={(e) => { setMealType(e.target.value as MealType); setTypeTouched(true); }}>
            <option value="breakfast">Breakfast</option>
            <option value="lunch">Lunch</option>
            <option value="dinner">Dinner</option>
            <option value="snack">Snack</option>
          </select>
        </div>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Add food</h2>
        <Segmented<Source>
          value={source}
          onChange={setSource}
          options={[
            { value: 'photo', label: '📷 Photo' },
            { value: 'text', label: '✍️ Describe' },
            { value: 'search', label: '🔎 Search' },
            { value: 'manual', label: 'Manual' },
          ]}
        />
        {source === 'photo' && <PhotoSource onResult={(items, notes) => { addItems(items); setAiNotes(notes); }} />}
        {source === 'text' && <TextSource onResult={(items, notes) => { addItems(items); setAiNotes(notes); }} />}
        {source === 'search' && <SearchSource onPick={(it) => addItems([it])} />}
        {source === 'manual' && <button className="secondary block" onClick={() => setRows((r) => [...r, blank()])}>＋ Add an empty item</button>}
      </section>

      {aiNotes && <div className="banner info small">🤖 {aiNotes}</div>}

      {rows.length > 0 && (
        <section className="card">
          <h2>Items <span className="muted small">— check and fix anything that looks off</span></h2>
          {rows.map((r) => (
            <div className="item-edit" key={r.uid}>
              <div className="row">
                <input
                  className="grow"
                  placeholder="Food name"
                  aria-label="Food name"
                  value={r.name}
                  onChange={(e) => patch(r.uid, { name: e.target.value })}
                />
                {r.confidence !== undefined && (
                  <span className={`chip ${r.confidence >= 0.7 ? '' : 'warn'}`} title="AI confidence">
                    AI {Math.round(r.confidence * 100)}%
                  </span>
                )}
                <button className="ghost small" aria-label={`Remove ${r.name || 'item'}`} onClick={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))}>✕</button>
              </div>
              <div className="nums">
                <div><label>Grams</label><NumInput label="Grams" value={r.grams} onChange={(g) => changeGrams(r.uid, g)} /></div>
                <div><label>kcal</label><NumInput label="Calories" value={r.calories} onChange={(v) => patch(r.uid, { calories: v })} /></div>
                <div><label>Protein</label><NumInput label="Protein g" value={r.protein} onChange={(v) => patch(r.uid, { protein: v })} /></div>
                <div><label>Carbs</label><NumInput label="Carbs g" value={r.carbs} onChange={(v) => patch(r.uid, { carbs: v })} /></div>
              </div>
              <details style={{ marginTop: 6 }}>
                <summary className="muted small">More nutrients</summary>
                <div className="nums" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
                  <div><label>Fat</label><NumInput label="Fat g" value={r.fat} onChange={(v) => patch(r.uid, { fat: v })} /></div>
                  <div><label>Fiber</label><NumInput label="Fiber g" value={r.fiber} onChange={(v) => patch(r.uid, { fiber: v })} /></div>
                  <div><label>Sugar</label><NumInput label="Sugar g" value={r.sugar} onChange={(v) => patch(r.uid, { sugar: v })} /></div>
                  <div><label>Sodium mg</label><NumInput label="Sodium mg" value={r.sodium} onChange={(v) => patch(r.uid, { sodium: v })} /></div>
                </div>
              </details>
            </div>
          ))}
          <p className="muted small mt">Changing grams rescales that item's nutrients automatically. AI numbers are estimates — hidden oil and portion depth are the usual culprits.</p>
        </section>
      )}

      <section className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Meal total</h2>
          <b style={{ fontSize: '1.3rem' }}>{num(totals.calories)} kcal</b>
        </div>
        <p className="muted small">P {num(totals.protein, 1)} g · C {num(totals.carbs, 1)} g · F {num(totals.fat, 1)} g · Fiber {num(totals.fiber, 1)} g · Sugar {num(totals.sugar, 1)} g · Na {num(totals.sodium)} mg</p>
        <div className="field">
          <label htmlFor="m-note">Note (optional)</label>
          <input id="m-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. cooked in 1 tbsp oil" />
        </div>
      </section>

      {formError && <div className="banner error" role="alert">{formError}</div>}
      <ErrorBanner error={save.error ?? del.error} />
      <button className="block" disabled={save.isPending || rows.length === 0} onClick={onSave}>
        {save.isPending ? 'Saving…' : editId ? 'Save changes' : 'Save meal'}
      </button>
      {editId !== null && <button className="danger block" disabled={del.isPending} onClick={onDelete}>Delete meal</button>}
    </div>
  );
}

// ---------------------------------------------------------------------------- sources

type ResultCb = (items: FoodItem[], notes: string) => void;

function PhotoSource({ onResult }: { onResult: ResultCb }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function pick(f: File | undefined) {
    if (!f) return;
    setError(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const b64 = await fileToJpegBase64(file);
      const res = await analyzePhoto(b64, 'image/jpeg', note);
      if (res.items.length === 0) {
        setError(new Error(res.notes || 'No food was recognised in that photo.'));
      } else {
        onResult(res.items, res.notes);
        setFile(null);
        setPreview(null); // image is discarded — never stored
        setNote('');
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {preview ? (
        <img className="photo-preview" src={preview} alt="Meal preview" />
      ) : (
        <label className="btn secondary block" style={{ cursor: 'pointer', color: 'var(--text)', fontSize: '1rem', margin: 0 }}>
          📷 Take or choose a photo
          <input type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
        </label>
      )}
      <div>
        <label htmlFor="p-note">Tell the AI what it can't see (optional)</label>
        <input id="p-note" value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 2 rotis, cooked in 1 tbsp ghee" />
      </div>
      <ErrorBanner error={error} />
      <div className="row">
        {preview && <button className="secondary" onClick={() => { setFile(null); setPreview(null); }}>Retake</button>}
        <button className="grow" disabled={!file || busy} onClick={run}>{busy ? <><Spinner /> Analysing…</> : 'Analyse photo'}</button>
      </div>
      <p className="muted small">The photo is sent to the AI for this one request and is not saved by this app.</p>
    </div>
  );
}

function TextSource({ onResult }: { onResult: ResultCb }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await analyzeText(text);
      if (res.items.length === 0) setError(new Error(res.notes || "Couldn't find any food in that description."));
      else {
        onResult(res.items, res.notes);
        setText('');
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <textarea value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="e.g. two boiled eggs, a slice of toast with butter and a cup of milk tea with sugar" aria-label="Describe your meal" />
      <ErrorBanner error={error} />
      <button className="block" disabled={busy || text.trim().length < 2} onClick={run}>{busy ? <><Spinner /> Estimating…</> : 'Estimate nutrition'}</button>
    </div>
  );
}

function SearchSource({ onPick }: { onPick: (item: FoodItem) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<FoodSearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      setHits(await searchFoods(q.trim()));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <form className="row" onSubmit={run}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search packaged foods (Open Food Facts)" aria-label="Search foods" />
        <button disabled={busy || q.trim().length < 2}>{busy ? <Spinner /> : 'Search'}</button>
      </form>
      <ErrorBanner error={error} />
      {hits && hits.length === 0 && <p className="muted small">No results. Try different words or use Describe.</p>}
      {hits?.map((h, i) => (
        <button
          key={i}
          className="secondary block"
          style={{ justifyContent: 'space-between', textAlign: 'left' }}
          onClick={() => onPick({ name: h.brand ? `${h.name} (${h.brand})` : h.name, grams: 100, ...h.per100g })}
        >
          <span className="grow">{h.name}{h.brand && <span className="muted small"> · {h.brand}</span>}</span>
          <span className="muted small">{round(h.per100g.calories)} kcal/100 g</span>
        </button>
      ))}
      {hits && hits.length > 0 && <p className="muted small">Added at 100 g — change the grams below.</p>}
    </div>
  );
}
