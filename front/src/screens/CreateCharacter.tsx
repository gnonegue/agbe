import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { createCharacter, getConditionAvailability } from '../api/endpoints';
import type { BirthMode, Condition, Profile, Region, State } from '../api/types';
import { errorText } from '../i18n';
import { NAME_RE, normalizeName } from '../lib/validate';

const PROFILES: Profile[] = ['LOCAL', 'DIASPORA', 'FOREIGNER'];
// Prototype : seule Maritime (Lomé) est jouable ; les autres régions sont affichées.
const REGIONS: { id: Region; open: boolean }[] = [
  { id: 'MARITIME', open: true },
  { id: 'PLATEAUX', open: false },
  { id: 'CENTRALE', open: false },
  { id: 'KARA', open: false },
  { id: 'SAVANES', open: false },
];
const CONDITIONS: Condition[] = ['RICH', 'MIDDLE', 'POOR'];

export default function CreateCharacter({ onCreated }: { onCreated: (s: State) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [profile, setProfile] = useState<Profile>('LOCAL');
  const [region, setRegion] = useState<Region>('MARITIME');
  const [mode, setMode] = useState<BirthMode>('FREE_CHOICE');
  const [condition, setCondition] = useState<Condition>('MIDDLE');
  // Conditions encore ouvertes (plafond par condition) ; inconnu tant que le serveur n'a pas répondu : tout reste choisissable
  const [open, setOpen] = useState<Record<Condition, boolean>>({ RICH: true, MIDDLE: true, POOR: true });
  const refreshOpen = () =>
    getConditionAvailability()
      .then((a) => {
        setOpen(a);
        setCondition((c) => (a[c] ? c : (['MIDDLE', 'POOR', 'RICH'] as Condition[]).find((x) => a[x]) ?? 'POOR'));
      })
      .catch(() => undefined);
  useEffect(() => {
    void refreshOpen();
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    const n = normalizeName(name);
    if (!NAME_RE.test(n)) return setError(t('create.nameInvalid'));
    setBusy(true);
    try {
      const s = await createCharacter({ name: n, profile, region, mode, ...(mode === 'FREE_CHOICE' ? { condition } : {}) });
      onCreated(s);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'condition_full') {
        // Plafond atteint pour cette condition : on dit laquelle, pourquoi, et quoi faire (puis on rafraîchit les places)
        setError(t('create.conditionFullError', { condition: t(`create.conditions.${condition}`) }));
        void refreshOpen();
      } else setError(errorText(e instanceof ApiError ? e.code : 'unknown'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen create">
      <div className="flagband" aria-hidden="true" />
      <form className="card" onSubmit={submit} noValidate>
        <h1>{t('create.title')}</h1>
        <p className="muted">{t('create.intro')}</p>

        <label className="field">
          <span>{t('create.name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoComplete="nickname" required />
          <small>{t('create.nameHint')}</small>
        </label>

        <fieldset className="choices">
          <legend>{t('create.profile')}</legend>
          {PROFILES.map((p) => (
            <button type="button" key={p} className={profile === p ? 'choice active' : 'choice'} aria-pressed={profile === p} onClick={() => setProfile(p)}>
              <strong>{t(`create.profiles.${p}`)}</strong>
              <small>{t(`create.profileHints.${p}`)}</small>
            </button>
          ))}
        </fieldset>

        <fieldset className="choices">
          <legend>{t('create.region')}</legend>
          {REGIONS.map((r) => (
            <button
              type="button"
              key={r.id}
              disabled={!r.open}
              className={`choice ${r.open ? 'featured' : 'locked'} ${region === r.id ? 'active' : ''}`}
              aria-pressed={region === r.id}
              onClick={() => r.open && setRegion(r.id)}
            >
              <strong>{t(`regions.${r.id}`)}</strong>
              <small className={r.open ? 'badge ok' : 'badge'}>{r.open ? t('create.featured') : t('create.comingSoon')}</small>
            </button>
          ))}
        </fieldset>

        <fieldset className="choices">
          <legend>{t('create.mode')}</legend>
          {(['FREE_CHOICE', 'DESTINY'] as BirthMode[]).map((m) => (
            <button type="button" key={m} className={mode === m ? 'choice active' : 'choice'} aria-pressed={mode === m} onClick={() => setMode(m)}>
              <strong>{t(`create.modes.${m}`)}</strong>
              <small>{t(`create.modeHints.${m}`)}</small>
            </button>
          ))}
        </fieldset>

        {mode === 'FREE_CHOICE' ? (
          <fieldset className="choices conditions">
            {CONDITIONS.map((c) => (
              <button type="button" key={c} disabled={!open[c]} className={`choice cond-${c} ${condition === c ? 'active' : ''}${open[c] ? '' : ' locked'}`} aria-pressed={condition === c} onClick={() => open[c] && setCondition(c)}>
                <strong>{t(`create.conditions.${c}`)}</strong>
                {!open[c] && <small className="badge">{t('create.conditionFull')}</small>}
                <small>{t(`create.conditionStart.${c}`)}</small>
                <span className="pro">
                  <b>{t('create.advantages')}</b>{' '}
                  {t(`create.conditionPros.${c}`)}
                </span>
                <span className="con">
                  <b>{t('create.difficulties')}</b>{' '}
                  {t(`create.conditionCons.${c}`)}
                </span>
              </button>
            ))}
          </fieldset>
        ) : (
          <p className="warning" role="note">{t('create.destinyWarning')}</p>
        )}
        {mode === 'FREE_CHOICE' && CONDITIONS.some((c) => !open[c]) && <p className="muted" role="note">{t('create.conditionFullHint')}</p>}

        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary big" disabled={busy}>
          {mode === 'DESTINY' ? t('create.submitDestiny') : t('create.submit')}
        </button>
      </form>
    </div>
  );
}
