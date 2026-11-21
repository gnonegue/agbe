import { useTranslation } from 'react-i18next';
import { SLEEP_EVENT } from '../game/Interior';
import { rest, wash } from '../api/endpoints';
import { fcfa, gameDuration } from '../lib/format';
import { useGame } from './ctx';

export default function RestApp() {
  const { t } = useTranslation();
  const { catalog, state, run, busy } = useGame();
  const wait = state.nextRestInGameHours;
  return (
    <section>
      <h2>{t('rest.title')}</h2>
      <div className="panel">
        <h3>{t('rest.restTitle')}</h3>
        <p>{t('rest.restText')}</p>
        {wait > 0 && <p className="muted">{t('rest.restIn', { time: gameDuration(wait) })}</p>}
        <button className="btn primary big" disabled={busy || wait > 0} onClick={() => void run(rest, () => t('rest.restDone')).then((r) => r && window.dispatchEvent(new Event(SLEEP_EVENT)))}>
          {t('rest.restNow')}
        </button>
      </div>
      <div className="panel">
        <h3>{t('rest.washTitle')}</h3>
        <p>{t('rest.washText', { gain: catalog?.wash.hygieneGain ?? 0 })}</p>
        <button
          className="btn primary big"
          disabled={busy || !catalog}
          onClick={() => void run(wash, () => t('rest.washDone'))}
        >
          {t('rest.washNow')}
        </button>
        <small className="muted">{t('rest.washBilledNote', { tariff: fcfa(catalog?.wash.price ?? 0) })}</small>
      </div>
    </section>
  );
}
