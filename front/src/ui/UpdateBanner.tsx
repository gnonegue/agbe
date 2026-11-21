import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { onUpdateState, reloadNow, type UpdateState } from '../lib/pwaUpdate';

/**
 * Carte « Mise à jour disponible » : n'apparaît qu'une fois la nouvelle version entièrement téléchargée, pour que
 * « Mettre à jour » ouvre vraiment la nouvelle version (et non l'ancienne, ce qui faisait revenir la carte en boucle).
 */
export default function UpdateBanner() {
  const { t } = useTranslation();
  const [state, setState] = useState<UpdateState>('idle');
  const [later, setLater] = useState(false);
  useEffect(() => onUpdateState(setState), []);
  if (state === 'applying') {
    return (
      <div className="update-banner" role="status" aria-live="polite">
        <span className="ub-ico spin" aria-hidden="true">🔄</span>
        <span className="ub-txt">
          <strong>{t('pwa.applying')}</strong>
          <small>{t('pwa.applyingText')}</small>
        </span>
      </div>
    );
  }
  if (state !== 'ready' || later) return null;
  return (
    <div className="update-banner" role="status">
      <span className="ub-ico" aria-hidden="true">🔄</span>
      <span className="ub-txt">
        <strong>{t('pwa.title')}</strong>
        <small>{t('pwa.updateReady')}</small>
      </span>
      <span className="ub-act">
        <button type="button" className="btn small ghost" onClick={() => setLater(true)}>{t('pwa.later')}</button>
        <button type="button" className="btn small primary" onClick={() => void reloadNow()}>{t('pwa.reload')}</button>
      </span>
    </div>
  );
}
