import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { prepareLogo } from '../lib/image';

/**
 * Choix du logo d'un partenaire (facultatif) : aperçu sur damier (la transparence se voit), « Choisir » et « Retirer ».
 * `value` : image prête à envoyer, `null` = inchangé, `'remove'` = à supprimer ; `current` : logo déjà enregistré.
 */
export default function LogoField({ current, value, onChange }: { current: string | null; value: Blob | null | 'remove'; onChange: (v: Blob | null | 'remove') => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!(value instanceof Blob)) return setPreview(null);
    const u = URL.createObjectURL(value);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [value]);
  const shown = value === 'remove' ? null : preview ?? current;
  return (
    <div className="logo-field">
      <span className="logo-box" aria-hidden={!shown}>{shown ? <img src={shown} alt={t('admin.logo.label')} /> : <i>🖼️</i>}</span>
      <div className="logo-actions">
        <strong>{t('admin.logo.label')}</strong>
        <small>{t('admin.logo.hint')}</small>
        <div>
          <button type="button" className="adm-btn" onClick={() => input.current?.click()}>{shown ? t('admin.logo.change') : t('admin.logo.choose')}</button>
          {shown && <button type="button" className="adm-btn" onClick={() => { setError(null); onChange(value instanceof Blob || !current ? null : 'remove'); }}>{t('admin.logo.remove')}</button>}
        </div>
        {error && <small className="error">{error}</small>}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setError(null);
          try {
            onChange(await prepareLogo(f));
          } catch (err) {
            setError(t(`errors.${(err as Error).message === 'image_too_large' ? 'image_too_large' : 'invalid_image'}`));
          }
        }}
      />
    </div>
  );
}
