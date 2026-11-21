import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ContactTopic } from '../api/endpoints';

const ICON: Record<ContactTopic, string> = { board: '🪧', plots: '🌊', partner: '🤝', game: '🎮', other: '💬' };

/** Liste déroulante du sujet (formulaire de contact) : icône, libellé et précision ; clavier (flèches, Entrée, Échap). */
export default function TopicSelect({ value, options, onChange, label }: { value: ContactTopic; options: ContactTopic[]; onChange: (v: ContactTopic) => void; label: string }) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(options.indexOf(value));
  const root = useRef<HTMLDivElement>(null);

  // Un clic en dehors referme la liste
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const pick = (v: ContactTopic) => {
    onChange(v);
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return setOpen(false);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setActive(options.indexOf(value));
        return setOpen(true);
      }
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
    }
    if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault();
      pick(options[active]!);
    }
  };

  return (
    <div className={open ? 'topic-select open' : 'topic-select'} ref={root}>
      <button
        type="button"
        className="topic-select-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`${label} : ${t(`contact.topics.${value}`)}`}
        onClick={() => {
          setActive(options.indexOf(value));
          setOpen((o) => !o);
        }}
        onKeyDown={onKey}
      >
        <span className="topic-ico" aria-hidden="true">{ICON[value]}</span>
        <span className="topic-text">
          <strong>{t(`contact.topics.${value}`)}</strong>
          <small>{t(`contact.topicDesc.${value}`)}</small>
        </span>
        <svg className="topic-chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul className="topic-list" id={`${id}-list`} role="listbox" aria-label={label}>
          {options.map((o, i) => (
            <li
              key={o}
              role="option"
              aria-selected={o === value}
              className={i === active ? 'active' : undefined}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(o)}
            >
              <span className="topic-ico" aria-hidden="true">{ICON[o]}</span>
              <span className="topic-text">
                <strong>{t(`contact.topics.${o}`)}</strong>
                <small>{t(`contact.topicDesc.${o}`)}</small>
              </span>
              {o === value && (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="topic-check">
                  <path d="m5 12 5 5 9-10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
