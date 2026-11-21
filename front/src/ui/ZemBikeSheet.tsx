import { useTranslation } from 'react-i18next';
import type { ZemBike } from '../api/endpoints';
import type { State } from '../api/types';
import { fcfa, localName } from '../lib/format';

interface PickerProps {
  state: State;
  busy: boolean;
  onStart: (bike: ZemBike) => void;
  onContract: (action: 'sign' | 'end') => void;
}

/** Choix de la moto d'une séance de zém : moto Gozem louée, moto personnelle, ou moto confiée par un propriétaire (contrat). */
export function ZemBikePicker({ state, busy, onStart, onContract }: PickerProps) {
  const { t, i18n } = useTranslation();
  const cfg = state.zemBike;
  if (!cfg) return null;
  const balance = BigInt(state.wallet.balance);
  const motos = state.vehicles.filter((v) => v.kind === 'MOTO');
  const ready = motos.find((v) => v.drivable && v.fuelMl >= cfg.ownKm * v.mlPerKm);
  const shown = ready ?? motos[0];
  const ownHint = !shown
    ? t('work.zemBike.ownNone')
    : ready
      ? t('work.zemBike.ownHint', { name: localName(ready, i18n.language), km: Math.floor(ready.fuelMl / Math.max(1, ready.mlPerKm)) })
      : t('work.zemBike.ownBad');
  const atStation = state.location === 'station_zem';
  const contract = !!state.zemContract;
  return (
    <>
      <ul className="catalog-list">
        <li>
          <button className="catalog-item" disabled={busy || balance < BigInt(cfg.gozemFee)} onClick={() => onStart('GOZEM')}>
            <span className="catalog-emoji" aria-hidden="true">🛵</span>
            <span className="catalog-name">{t('work.zemBike.gozem')}<br /><small className="muted">{t('work.zemBike.gozemHint')}</small></span>
            <b>{fcfa(cfg.gozemFee)}</b>
          </button>
        </li>
        <li>
          <button className="catalog-item" disabled={busy || !ready} onClick={() => onStart('OWN')}>
            <span className="catalog-emoji" aria-hidden="true">🏍️</span>
            <span className="catalog-name">{t('work.zemBike.own')}<br /><small className="muted">{ownHint}</small></span>
            <b>{t('work.zemBike.ownFuel', { km: cfg.ownKm })}</b>
          </button>
        </li>
        <li>
          <button className="catalog-item" disabled={busy || !contract || balance < BigInt(cfg.ownerFee)} onClick={() => onStart('OWNER')}>
            <span className="catalog-emoji" aria-hidden="true">🤝</span>
            <span className="catalog-name">{t('work.zemBike.owner')}<br /><small className="muted">{t('work.zemBike.ownerHint')}</small></span>
            <b>{fcfa(cfg.ownerFee)}</b>
          </button>
        </li>
      </ul>
      <p className="muted">{contract ? t('work.zemBike.contractOn', { amount: fcfa(cfg.ownerFee) }) : t('work.zemBike.contractOff')}</p>
      {/* Loin de la station : le clic ouvre le choix du moyen de déplacement vers Gozem, et le contrat se fait à l'arrivée */}
      <button className="btn small" disabled={busy} onClick={() => onContract(contract ? 'end' : 'sign')}>
        {contract ? t('work.zemBike.end') : t('work.zemBike.sign')}
      </button>
      {!atStation && <small className="muted"> {t('work.zemBike.farAway')}</small>}
    </>
  );
}

interface SheetProps extends PickerProps {
  onClose: () => void;
}

/** Feuille plein écran du choix de moto, ouverte au moment de commencer une séance de zém. */
export default function ZemBikeSheet({ onClose, ...picker }: SheetProps) {
  const { t } = useTranslation();
  return (
    <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="venue-card catalog" role="dialog" aria-modal="true" aria-label={t('work.zemBike.title')}>
        <div className="sheet-grip" aria-hidden="true" />
        <header className="venue-head">
          <span className="venue-emoji" aria-hidden="true">🛵</span>
          <div>
            <h2>{t('work.zemBike.title')}</h2>
            <small>{t('work.zemBike.intro')}</small>
          </div>
          <button className="btn ghost small close" onClick={onClose} aria-label={t('app.close')}>✕</button>
        </header>
        <ZemBikePicker {...picker} />
      </div>
    </div>
  );
}
