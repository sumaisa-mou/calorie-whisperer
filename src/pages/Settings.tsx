import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../lib/useApp';
import { useSaveProfile } from '../lib/queries';
import { api, logout } from '../lib/api';
import { ErrorBanner, Loading, Stat } from '../components/ui';
import { ACTIVITY_LABELS, bmr, calorieTarget, cmToFeetInches, inchesToCm, round, tdee } from '../../shared/calc';
import { ageOn } from '../../shared/dates';
import { num } from '../lib/format';
import type { Activity, Profile } from '../../shared/types';

const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const DEFAULT_CM = inchesToCm(5, 4.5);

interface Form {
  sex: Profile['sex'];
  dob: string;
  feet: string;
  inches: string;
  activity: Activity;
  goalWeightKg: string;
  weeklyLossKg: string;
  timezone: string;
  weekStart: '0' | '1';
}

function toForm(p: Profile | null): Form {
  const { feet, inches } = cmToFeetInches(p?.heightCm ?? DEFAULT_CM);
  return {
    sex: p?.sex ?? 'female',
    dob: p?.dob ?? '',
    feet: String(feet),
    inches: String(inches),
    activity: p?.activity ?? 'light',
    goalWeightKg: String(p?.goalWeightKg ?? 60),
    weeklyLossKg: String(p?.weeklyLossKg ?? 0.5),
    timezone: p?.timezone ?? browserTz(),
    weekStart: p?.weekStart === 0 ? '0' : '1',
  };
}

export default function Settings() {
  const { loading, error, profile, latest, today } = useApp();
  const save = useSaveProfile();
  const nav = useNavigate();
  const [f, setF] = useState<Form>(() => toForm(null));
  const [saved, setSaved] = useState(false);
  const [exportErr, setExportErr] = useState<unknown>(null);

  useEffect(() => {
    if (!loading) setF(toForm(profile));
  }, [loading, profile]);

  if (loading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setSaved(false);
    setF((x) => ({ ...x, [k]: v }));
  };

  const heightCm = round(inchesToCm(Number(f.feet) || 0, Number(f.inches) || 0), 1);
  const draft: Profile = {
    sex: f.sex,
    dob: f.dob,
    heightCm,
    activity: f.activity,
    goalWeightKg: Number(f.goalWeightKg),
    weeklyLossKg: Number(f.weeklyLossKg),
    timezone: f.timezone,
    weekStart: f.weekStart === '0' ? 0 : 1,
  };
  const ready = !!f.dob && heightCm >= 100 && draft.goalWeightKg >= 30;
  const preview = ready && latest ? calorieTarget(draft, latest.kg, today) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    await save.mutateAsync(draft);
    setSaved(true);
    if (!profile) nav('/');
  }

  async function exportData() {
    setExportErr(null);
    try {
      const data = await api<unknown>('GET', '/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `fit-tracker-${today}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportErr(e);
    }
  }

  const age = f.dob ? ageOn(f.dob, today) : null;

  return (
    <div className="stack">
      <h1>Settings</h1>
      {!profile && <div className="banner info">Fill in your details once — everything else is calculated from them.</div>}

      <form className="card" onSubmit={submit}>
        <h2>Profile</h2>
        <div className="grid2">
          <div className="field">
            <label htmlFor="sex">Sex</label>
            <select id="sex" value={f.sex} onChange={(e) => set('sex', e.target.value as Profile['sex'])}>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="dob">Date of birth {age !== null && `(${age} y)`}</label>
            <input id="dob" type="date" required value={f.dob} max={today} onChange={(e) => set('dob', e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>Height — {heightCm} cm</label>
          <div className="row">
            <input aria-label="Feet" type="number" inputMode="numeric" min="3" max="8" value={f.feet} onChange={(e) => set('feet', e.target.value)} />
            <span className="muted">ft</span>
            <input aria-label="Inches" type="number" inputMode="decimal" step="0.1" min="0" max="11.9" value={f.inches} onChange={(e) => set('inches', e.target.value)} />
            <span className="muted">in</span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="act">Activity level</label>
          <select id="act" value={f.activity} onChange={(e) => set('activity', e.target.value as Activity)}>
            {(Object.keys(ACTIVITY_LABELS) as Activity[]).map((a) => (
              <option key={a} value={a}>{ACTIVITY_LABELS[a]}</option>
            ))}
          </select>
        </div>

        <div className="grid2">
          <div className="field">
            <label htmlFor="goal">Goal weight (kg)</label>
            <input id="goal" type="number" inputMode="decimal" step="0.1" min="30" max="250" required value={f.goalWeightKg} onChange={(e) => set('goalWeightKg', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="loss">Loss per week</label>
            <select id="loss" value={f.weeklyLossKg} onChange={(e) => set('weeklyLossKg', e.target.value)}>
              <option value="0">Maintain (0 kg)</option>
              <option value="0.25">Slow (0.25 kg)</option>
              <option value="0.5">Steady (0.5 kg)</option>
              <option value="0.75">Fast (0.75 kg)</option>
              <option value="1">Aggressive (1 kg)</option>
            </select>
          </div>
        </div>

        <div className="grid2">
          <div className="field">
            <label htmlFor="tz">Timezone</label>
            <input id="tz" list="tzlist" value={f.timezone} onChange={(e) => set('timezone', e.target.value)} />
            <datalist id="tzlist">
              {(Intl.supportedValuesOf?.('timeZone') ?? []).map((z) => <option key={z} value={z} />)}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="ws">Week starts on</label>
            <select id="ws" value={f.weekStart} onChange={(e) => set('weekStart', e.target.value as '0' | '1')}>
              <option value="1">Monday</option>
              <option value="0">Sunday</option>
            </select>
          </div>
        </div>

        <ErrorBanner error={save.error} />
        <button className="block mt" disabled={!ready || save.isPending}>
          {save.isPending ? 'Saving…' : saved ? 'Saved ✓' : 'Save profile'}
        </button>
      </form>

      {ready && latest && preview && (
        <section className="card">
          <h2>Your numbers (at {latest.kg} kg)</h2>
          <div className="grid2">
            <Stat label="BMR" value={num(round(bmr(draft.sex, latest.kg, heightCm, age ?? 30)))} sub="kcal/day at rest" />
            <Stat label="Maintenance" value={num(round(tdee(bmr(draft.sex, latest.kg, heightCm, age ?? 30), draft.activity)))} sub="kcal/day (TDEE)" />
            <Stat label="Daily target" value={num(preview.target)} sub={`≈ ${preview.effectiveWeeklyLossKg} kg/week`} />
            <Stat label="Safety floor" value={num(preview.floor)} sub="kcal — never go below" />
          </div>
          {preview.clamped && <p className="banner warn small mt">That loss rate is too aggressive; your target is held at the safety floor.</p>}
          <p className="muted small">Estimates from the Mifflin-St Jeor formula. Not medical advice — check with a doctor for health conditions.</p>
        </section>
      )}

      <section className="card stack">
        <h2>Data & account</h2>
        <button className="secondary block" onClick={exportData}>Export all data (JSON)</button>
        <ErrorBanner error={exportErr} />
        <button className="danger block" onClick={() => logout()}>Sign out</button>
      </section>
    </div>
  );
}
