import { useEffect, useState } from 'react';

/** Numeric text input that tolerates partial typing ("1.", "") and syncs when the value is changed from outside. */
export default function NumInput({
  value,
  onChange,
  label,
  id,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  id?: string;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText((t) => (Number(t) === value ? t : String(value)));
  }, [value]);

  return (
    <input
      id={id}
      aria-label={label}
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = Number(t);
        if (t.trim() === '') onChange(0);
        else if (Number.isFinite(n) && n >= 0) onChange(n);
      }}
      onFocus={(e) => e.target.select()}
    />
  );
}
