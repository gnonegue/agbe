import { useTranslation } from 'react-i18next';
import PartnerOffers from '../ui/PartnerOffers';
import { useGame } from './ctx';

/** Récit complet « Ma vie ». */
export default function JournalApp() {
  const { t } = useTranslation();
  const { journal } = useGame();
  return (
    <section className="journal">
      <h2>{t('journal.title')}</h2>
      {journal.length === 0 ? (
        <p className="muted">{t('journal.empty')}</p>
      ) : (
        <ol>
          {journal.map((e) => (
            <li key={e.id}>
              <span className="when">{t('hud.time', { day: e.day, time: e.time })}</span>
              <span>{e.text}</span>
            </li>
          ))}
        </ol>
      )}
      <PartnerOffers kind="EVENT" />
    </section>
  );
}
