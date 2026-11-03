import { useState, type FormEvent } from 'react';
import { api, setToken } from '../lib/api';
import { ErrorBanner, Spinner } from '../components/ui';

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await api<{ token: string }>('POST', '/login', { password });
      setToken(token);
      onSignedIn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
    <form className="login stack" onSubmit={submit}>
      <div><img className="login-logo" src="/favicon.svg" alt="" /></div>
      <h1>Fit Tracker</h1>
      <p className="muted">Enter your password to continue.</p>
      <ErrorBanner error={error} />
      <input
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
        aria-label="Password"
      />
      <button className="block" disabled={busy || !password}>
        {busy ? <Spinner /> : 'Sign in'}
      </button>
    </form>
    </div>
  );
}
