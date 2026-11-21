import { useTranslation } from 'react-i18next';
import type { Locale } from '../api/types';

const LANGS: { code: Locale; label: string }[] = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
];

/** Sélecteur de langue (les noms de langue s'écrivent dans leur propre langue). */
export default function LangSwitch({ onChange }: { onChange: (l: Locale) => void }) {
  const { i18n } = useTranslation();
  return (
    <div className="segmented" role="group">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          lang={l.code}
          className={i18n.language === l.code ? 'seg active' : 'seg'}
          aria-pressed={i18n.language === l.code}
          onClick={() => onChange(l.code)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
