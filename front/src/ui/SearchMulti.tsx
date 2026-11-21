import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { matches } from '../lib/search';
import type { SearchOption } from './SearchSelect';

/**
 * Liste déroulante à choix multiples avec recherche (sans accents ni majuscules) : la liste reste ouverte pour cocher
 * plusieurs entrées ; les choix sont affichés en pastilles que l'on retire d'un clic. Clavier : ↑ ↓, Entrée, Échap.
 */
export default function SearchMulti({ values, options, onChange, placeholder, searchLabel, empty, removeLabel }: { values: string[]; options: SearchOption[]; onChange: (v: string[]) => void; placeholder: string; searchLabel: string; empty: string; removeLabel: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useId();
  const shown = useMemo(() => options.filter((o) => matches(q, o.label, o.hint ?? '')), [options, q]);
  useEffect(() => {
    if (!open) return;
    setQ('');
    setHi(0);
    window.setTimeout(() => input.current?.focus(), 0);
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const toggle = (o: SearchOption | undefined) => {
    if (!o || o.disabled) return;
    onChange(values.includes(o.value) ? values.filter((v) => v !== o.value) : [...values, o.value]);
  };
  const chosen = values.map((v) => options.find((o) => o.value === v)).filter((o): o is SearchOption => !!o);
  return (
    <div className={open ? 'ss ssm open' : 'ss ssm'} ref={box}>
      <div className="ssm-field" onClick={() => setOpen(true)}>
        {chosen.length === 0 && <span className="ss-ph">{placeholder}</span>}
        {chosen.map((o) => (
          <span key={o.value} className="ssm-chip">
            {o.label}
            <button type="button" aria-label={`${removeLabel} ${o.label}`} onClick={(e) => { e.stopPropagation(); toggle(o); }}>×</button>
          </span>
        ))}
        <button type="button" className="ssm-arrow" aria-haspopup="listbox" aria-expanded={open} aria-label={placeholder} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      {open && (
        <div className="ss-pop">
          <input
            ref={input}
            className="ss-search"
            value={q}
            placeholder={searchLabel}
            aria-label={searchLabel}
            aria-controls={list}
            onChange={(e) => { setQ(e.target.value); setHi(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(shown.length - 1, hi + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(0, hi - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); toggle(shown[hi]); }
              else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
            }}
          />
          <ul id={list} role="listbox" aria-multiselectable="true" className="ss-list">
            {shown.length === 0 && <li className="ss-empty">{empty}</li>}
            {shown.map((o, i) => {
              const on = values.includes(o.value);
              return (
                <li key={o.value} role="option" aria-selected={on} aria-disabled={o.disabled} className={`${i === hi ? 'hi ' : ''}${on ? 'on ' : ''}${o.disabled ? 'off' : ''}`} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); toggle(o); }}>
                  <span><i className={on ? 'ssm-box on' : 'ssm-box'} aria-hidden="true">{on ? '✓' : ''}</i>{o.label}</span>
                  {o.hint && <small>{o.hint}</small>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
