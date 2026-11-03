import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/useApp';
import { sendChat } from '../lib/queries';
import { ErrorBanner, Spinner } from '../components/ui';

type Msg = { role: 'user' | 'assistant'; content: string };
const KEY = 'ft_chat';

const load = (): Msg[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.slice(-40) : [];
  } catch {
    return [];
  }
};

const SUGGESTIONS = [
  'How is my week going?',
  'What should I eat for the rest of today?',
  'Why might my weight not be dropping?',
];

export default function Chat() {
  const { today } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>(load);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(msgs.slice(-40)));
    } catch {
      /* ignore */
    }
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy]);

  async function send(content: string) {
    if (!content.trim() || busy) return;
    const next: Msg[] = [...msgs, { role: 'user', content: content.trim() }];
    setMsgs(next);
    setText('');
    setBusy(true);
    setError(null);
    try {
      const { reply } = await sendChat(next.slice(-20), today);
      setMsgs([...next, { role: 'assistant', content: reply }]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };

  return (
    <div className="stack" style={{ paddingBottom: 70 }}>
      <div className="header">
        <h1>Coach</h1>
        <div className="row">
          {msgs.length > 0 && <button className="ghost small" onClick={() => setMsgs([])}>Clear</button>}
          <Link to="/" className="btn secondary small">Close</Link>
        </div>
      </div>
      <p className="muted small">Knows your profile, weight trend and recent meals. AI advice — not medical advice.</p>

      <div className="chat">
        {msgs.length === 0 && (
          <div className="stack">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="secondary block" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>{m.content}</div>
        ))}
        {busy && <div className="bubble assistant"><Spinner /></div>}
        <ErrorBanner error={error} />
        <div ref={endRef} />
      </div>

      <form className="chatbar" onSubmit={submit}>
        <div>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about your progress…" aria-label="Message" maxLength={1000} />
          <button disabled={busy || !text.trim()}>Send</button>
        </div>
      </form>
    </div>
  );
}
