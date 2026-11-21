import { useTranslation } from 'react-i18next';
import SearchSelect from '../ui/SearchSelect';

const HOUSING = ['VILLA', 'CHAMBRE_SALON', 'ENTRER_COUCHER'];

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

// Unité devinée d'après le nom du champ (le serveur revalide tout avec son schéma strict)
type Unit = 'pct' | 'fcfa' | 'hours' | 'days' | 'months' | 'points' | null;
function unitOf(key: string): Unit {
  if (/Bp$|^bp$|Bp[A-Z]/.test(key) || key === 'rateBp') return 'pct';
  if (/GameHours|Hours$/.test(key)) return 'hours';
  if (/Days$|^days$/.test(key)) return 'days';
  if (/Months$|^months$/.test(key)) return 'months';
  if (/Respect$|Morale$|Gain$|^respect$|^morale$|^health$|^energy$|^hunger$|^hygiene$/.test(key)) return 'points';
  if (/price|Price|fee|Fee|monthly|Monthly|amount|Amount|cost|Cost|revenue|capital|Capital|fine|Fine|pay|Pay|salary|Salary|balance|Balance|Max$|Min$|^min$|^max$|^VILLA$|^CHAMBRE_SALON$|^ENTRER_COUCHER$|^WIFI$|^RICH$|^MIDDLE$|^POOR$|^EI$|^SARL$|^SA$|Savings$/.test(key))
    return 'fcfa';
  return null;
}

/** Libellé lisible : traduction connue, sinon le nom du champ mis en forme (« voluntaryMonthly » → « Voluntary monthly »). */
function useLabel() {
  const { t } = useTranslation();
  return (key: string) => {
    const known = t(`admin.sf.${key}`, { defaultValue: '' });
    if (known) return known;
    const s = key.replace(/Bp$/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
}

function NumberField({ k, value, onChange }: { k: string; value: number; onChange: (v: number) => void }) {
  const { t, i18n } = useTranslation();
  const label = useLabel();
  const unit = unitOf(k);
  const shown = unit === 'pct' ? value / 100 : value;
  // Couleur d'un vêtement (0xRRGGBB) : sélecteur de couleur plutôt qu'un grand nombre
  if (k === 'color' && value > 63) {
    const hex = `#${Math.max(0, Math.min(0xffffff, value)).toString(16).padStart(6, '0')}`;
    return (
      <label className="sf-field">
        <span>{label(k)}</span>
        <div className="sf-input">
          <input type="color" value={hex} onChange={(e) => onChange(parseInt(e.target.value.slice(1), 16))} />
          <em className="mono">{hex}</em>
        </div>
      </label>
    );
  }
  return (
    <label className="sf-field">
      <span>{label(k)}</span>
      <div className="sf-input">
        <input
          type="number"
          step={unit === 'pct' ? 0.01 : Number.isInteger(value) ? 1 : 'any'}
          value={Number.isFinite(shown) ? shown : 0}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            onChange(unit === 'pct' ? Math.round(n * 100) : Number.isInteger(value) ? Math.round(n) : n);
          }}
        />
        {unit && <em>{t(`admin.unit.${unit}`)}</em>}
      </div>
      {unit === 'fcfa' && Math.abs(value) >= 10_000 && <small className="sf-hint">{new Intl.NumberFormat(i18n.language).format(value)} FCFA</small>}
    </label>
  );
}

/** Formulaire généré à partir de la valeur d'un paramètre (objet, liste, nombre, texte, oui/non). */
export function SettingFields({ name, value, onChange, depth = 0 }: { name: string; value: Json; onChange: (v: Json) => void; depth?: number }) {
  const { t } = useTranslation();
  const label = useLabel();

  if (typeof value === 'number') return <NumberField k={name} value={value} onChange={onChange} />;
  if (typeof value === 'boolean')
    return (
      <label className="sf-field sf-bool">
        <span>{label(name)}</span>
        <span className="adm-switch">
          <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
          <span />
        </span>
      </label>
    );
  // Type de logement : liste déroulante (valeurs exactes attendues par le serveur)
  if (typeof value === 'string' && HOUSING.includes(value))
    return (
      <label className="sf-field">
        <span>{label(name)}</span>
        <SearchSelect value={value} options={HOUSING.map((h) => ({ value: h, label: t(`housing.${h}`, { defaultValue: h }) }))} onChange={onChange} placeholder={label(name)} searchLabel={t('admin.ss.search')} empty={t('admin.ss.empty')} />
      </label>
    );
  if (typeof value === 'string' || value === null)
    return (
      <label className="sf-field">
        <span>{label(name)}</span>
        <div className="sf-input"><input value={value ?? ''} onChange={(e) => onChange(e.target.value)} /></div>
      </label>
    );

  if (Array.isArray(value)) {
    // Liste de valeurs simples : une ligne de petits champs
    if (value.every((x) => typeof x !== 'object' || x === null)) {
      return (
        <div className="sf-field sf-wide">
          <span>{label(name)}</span>
          <div className="sf-chips">
            {value.map((x, i) => (
              <span key={i} className="sf-chip">
                {typeof x === 'number' ? (
                  <input type="number" value={x} onChange={(e) => onChange(value.map((y, j) => (j === i ? Math.round(Number(e.target.value) || 0) : y)))} />
                ) : (
                  <input value={String(x ?? '')} onChange={(e) => onChange(value.map((y, j) => (j === i ? e.target.value : y)))} />
                )}
                <button type="button" aria-label={t('admin.sfRemove')} onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
            <button type="button" className="adm-btn" onClick={() => onChange([...value, value.length ? (typeof value[value.length - 1] === 'number' ? value[value.length - 1]! : '') : 0])}>+ {t('admin.sfAdd')}</button>
          </div>
        </div>
      );
    }
    // Liste d'éléments : une carte par élément, avec ajout (copie du dernier) et suppression
    return (
      <div className="sf-group sf-wide">
        {depth > 0 && <div className="sf-group-head"><strong>{label(name)}</strong><small className="adm-dim">{value.length}</small></div>}
        <div className="sf-items">
          {value.map((item, i) => {
            const title = item && typeof item === 'object' && !Array.isArray(item) ? String(item.nameFr ?? item.titleFr ?? item.name ?? item.id ?? `#${i + 1}`) : `#${i + 1}`;
            return (
              <details key={i} className="sf-item">
                <summary><span>{title}</span><button type="button" className="adm-btn danger" onClick={(e) => { e.preventDefault(); onChange(value.filter((_, j) => j !== i)); }}>{t('admin.sfRemove')}</button></summary>
                <SettingFields name={`${name}[${i}]`} value={item} onChange={(v) => onChange(value.map((y, j) => (j === i ? v : y)))} depth={depth + 1} />
              </details>
            );
          })}
        </div>
        {value.length > 0 && <button type="button" className="adm-btn" onClick={() => onChange([...value, JSON.parse(JSON.stringify(value[value.length - 1]))])}>+ {t('admin.sfDuplicate')}</button>}
      </div>
    );
  }

  // Objet : une grille de champs, les sous-objets en blocs
  const entries = Object.entries(value);
  const simple = entries.filter(([, v]) => typeof v !== 'object' || v === null);
  const nested = entries.filter(([, v]) => typeof v === 'object' && v !== null);
  return (
    <div className={depth === 0 ? 'sf-root' : 'sf-obj'}>
      {simple.length > 0 && (
        <div className="sf-grid">
          {simple.map(([k, v]) => (
            <SettingFields key={k} name={k} value={v} onChange={(nv) => onChange({ ...value, [k]: nv })} depth={depth + 1} />
          ))}
        </div>
      )}
      {nested.map(([k, v]) =>
        Array.isArray(v) ? (
          <SettingFields key={k} name={k} value={v} onChange={(nv) => onChange({ ...value, [k]: nv })} depth={depth + 1} />
        ) : (
          <fieldset key={k} className="sf-sub">
            <legend>{label(k)}</legend>
            <SettingFields name={k} value={v} onChange={(nv) => onChange({ ...value, [k]: nv })} depth={depth + 1} />
          </fieldset>
        ),
      )}
    </div>
  );
}

/** Paramètre « large » (liste d'éléments) : sa carte prend toute la largeur. */
export function isWideSetting(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((x) => x !== null && typeof x === 'object');
  if (v && typeof v === 'object') return Object.values(v).some(isWideSetting) || Object.keys(v).length > 12;
  return false;
}
