import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPartnerOffers, offerClick, type PartnerOffer } from '../api/endpoints';

/** Offres réelles des partenaires (emplois ou événements), avec lien vers leur site. */
export default function PartnerOffers({ kind }: { kind: 'JOB' | 'EVENT' }) {
  const { t, i18n } = useTranslation();
  const [offers, setOffers] = useState<PartnerOffer[]>([]);
  useEffect(() => {
    void getPartnerOffers().then((o) => setOffers(o.filter((x) => x.kind === kind)), () => setOffers([]));
  }, [kind]);
  if (offers.length === 0) return null;
  return (
    <div className="panel">
      <strong>{kind === 'JOB' ? `💼 ${t('partners.jobsTitle')}` : `🎉 ${t('partners.eventsTitle')}`}</strong>
      <small className="muted">{t('partners.realNotice')}</small>
      <ul className="list stacked">
        {offers.map((o) => (
          <li key={o.id} className="item">
            <div className="item-main">
              <strong>{o.title}</strong>
              <small>
                {o.partner} · {o.place}
                {o.happensAt ? ` · ${new Date(o.happensAt).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
              </small>
              <small className="muted">{o.body}</small>
            </div>
            {o.url && (
              <button
                className="btn small"
                onClick={() => {
                  void offerClick(o.id).catch(() => undefined);
                  window.open(o.url!, '_blank', 'noopener,noreferrer');
                }}
              >
                🔗 {kind === 'JOB' ? t('partners.apply') : t('partners.moreInfo')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
