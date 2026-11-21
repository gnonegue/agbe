import { useTranslation } from 'react-i18next';
import { CURRENCIES, getCurrency, setCurrency, type Currency } from '../lib/currency';

/** Choix de la devise d'affichage des montants (FCFA, euro, dollar) : présentation seulement. */
export default function CurrencySwitch({ onChange }: { onChange?: (c: Currency) => void }) {
  const { t } = useTranslation();
  const cur = getCurrency();
  return (
    <div className="segmented" role="group">
      {CURRENCIES.map((c) => (
        <button
          key={c}
          type="button"
          className={cur === c ? 'seg active' : 'seg'}
          aria-pressed={cur === c}
          onClick={() => {
            setCurrency(c);
            onChange?.(c);
          }}
        >
          {t(`currency.${c}`)}
        </button>
      ))}
    </div>
  );
}
