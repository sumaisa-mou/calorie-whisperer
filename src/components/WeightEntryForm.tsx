import { useState, type FormEvent } from 'react';
import { useSaveWeight } from '../lib/queries';
import { ErrorBanner } from './ui';

export default function WeightEntryForm({ today, existingKg }: { today: string; existingKg?: number }) {
  const [date, setDate] = useState(today);
  const [kg, setKg] = useState('');
  const save = useSaveWeight();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = Number(kg);
    if (!Number.isFinite(v) || v < 20 || v > 400) return;
    await save.mutateAsync({ date, kg: Math.round(v * 10) / 10 });
    setKg('');
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="row">
        <div className="grow">
          <label htmlFor="w-kg">Weight (kg)</label>
          <input
            id="w-kg"
            type="number"
            inputMode="decimal"
            step="0.1"
            min="20"
            max="400"
            placeholder={existingKg ? String(existingKg) : 'e.g. 72.4'}
            value={kg}
            onChange={(e) => setKg(e.target.value)}
          />
        </div>
        <div className="grow">
          <label htmlFor="w-date">Date</label>
          <input id="w-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
        </div>
      </div>
      <ErrorBanner error={save.error} />
      <button className="block" disabled={save.isPending || !kg}>
        {save.isPending ? 'Saving…' : save.isSuccess && !kg ? 'Saved ✓ — add another' : 'Save weight'}
      </button>
    </form>
  );
}
