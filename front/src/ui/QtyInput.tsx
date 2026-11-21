import { useEffect, useState } from 'react';

/**
 * Champ de quantité : boutons − / + et saisie au clavier. Pendant la frappe le champ peut rester vide (on efface
 * le 1 pour taper 2, sans qu'il revienne) ; la valeur est ramenée entre `min` et `max` en quittant le champ.
 */
export default function QtyInput({ value, onChange, min = 1, max, label }: { value: number; onChange: (n: number) => void; min?: number; max: number; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const clamp = (n: number) => Math.max(min, Math.min(Math.max(min, max), n));
  return (
    <div className="qty-stepper">
      <button type="button" aria-label="−" disabled={value <= min} onClick={() => onChange(clamp(value - 1))}>−</button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={label}
        value={text}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
          setText(digits);
          if (digits) onChange(clamp(Number(digits)));
        }}
        onBlur={() => setText(String(value))}
      />
      <button type="button" aria-label="+" disabled={value >= max} onClick={() => onChange(clamp(value + 1))}>+</button>
    </div>
  );
}
