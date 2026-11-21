import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { completeMockPayment } from '../api/endpoints';
import i18n, { errorText } from '../i18n';
import mockFr from '../i18n/mockpay.fr.json';
import mockEn from '../i18n/mockpay.en.json';

// Écran de DÉVELOPPEMENT uniquement : chargé par import dynamique sous import.meta.env.DEV,
// il est absent du bundle de production (textes compris, d'où leurs fichiers de traduction dédiés).
i18n.addResourceBundle('fr', 'translation', mockFr, true, false);
i18n.addResourceBundle('en', 'translation', mockEn, true, false);

/** Page « Paiement simulé » (fournisseur mock, développement uniquement). */
export default function MockPay({ purchaseId, onDone }: { purchaseId: string; onDone: (paidId: string | null) => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await completeMockPayment(purchaseId);
      onDone(purchaseId);
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : 'unknown'));
      setBusy(false);
    }
  }

  return (
    <div className="screen mockpay">
      <div className="card">
        <h1>{t('mockPay.title')}</h1>
        <p className="warning">{t('mockPay.text')}</p>
        <p className="mono">{t('mockPay.purchase', { id: purchaseId.slice(0, 8) })}</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary big" disabled={busy} onClick={() => void confirm()}>{t('mockPay.confirm')}</button>
        <button className="btn ghost" disabled={busy} onClick={() => onDone(purchaseId)}>{t('mockPay.cancel')}</button>
      </div>
    </div>
  );
}
