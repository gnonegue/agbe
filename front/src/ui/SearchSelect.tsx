import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { matches } from '../lib/search';

export interface SearchOption {
  value: string;
  label: string;
  /** Petite ligne sous le libellé (ex. « Pris par … »). */
  hint?: string;
  disabled?: boolean;
}

/**
 * Liste déroulante avec recherche (à la manière de Select2) : un bouton affiche le choix, un clic ouvre la liste
 * avec un champ de recherche (sans accents ni majuscules). Clavier : ↑ ↓ pour se déplacer, Entrée pour choisir,
 * Échap pour fermer.
 */
export default function SearchSelect({ value, options, onChange, placeholder, searchLabel, empty }: { value: string; options: SearchOption[]; onChange: (v: string) => void; placeholder: string; searchLabel: string; empty: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useId();
  const shown = useMemo(() => options.filter((o) => matches(q, o.label, o.hint ?? '')), [options, q]);
  const current = options.find((o) => o.value === value);
  useEffect(() => {
    if (!open) return;
    setQ('');
    setHi(Math.max(0, options.findIndex((o) => o.value === value)));
    window.setTimeout(() => input.current?.focus(), 0);
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, options, value]);
  const pick = (o: SearchOption | undefined) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
  };
  return (
    <div className={open ? 'ss open' : 'ss'} ref={box}>
      <button type="button" className="ss-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={current ? '' : 'ss-ph'}>{current?.label ?? placeholder}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="ss-pop">
          <input
            ref={input}
            className="ss-search"
            value={q}
            placeholder={searchLabel}
            aria-label={searchLabel}
            aria-controls={list}
            onChange={(e) => {
              setQ(e.target.value);
              setHi(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(shown.length - 1, hi + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(0, hi - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); pick(shown[hi]); }
              else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
            }}
          />
          <ul id={list} role="listbox" className="ss-list">
            {shown.length === 0 && <li className="ss-empty">{empty}</li>}
            {shown.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled}
                className={`${i === hi ? 'hi ' : ''}${o.value === value ? 'on ' : ''}${o.disabled ? 'off' : ''}`}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              >
                <span>{o.label}</span>
                {o.hint && <small>{o.hint}</small>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
