import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sendBugReport } from '../api/endpoints';
import type { Locale } from '../api/types';
import { useGame } from './ctx';

const MIN = 10;
const MAX = 1500;

/** Signaler un bug : le message arrive dans la boîte « Messages » de l'équipe, avec le lieu et l'appareil ajoutés par le serveur. */
export default function BugsApp() {
  const { t, i18n } = useTranslation();
  const { run, busy } = useGame();
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const ok = text.trim().length >= MIN;

  const send = async () => {
    const r = await run(
      () => sendBugReport({ message: text.trim(), viewport: `${window.innerWidth}x${window.innerHeight}`, locale: (i18n.language === 'en' ? 'en' : 'fr') as Locale }),
      () => t('bugs.sent'),
    );
    if (r) {
      setText('');
      setSent(true);
    }
  };

  return (
    <section>
      <div className="panel">
        <p className="muted small-line">{t('bugs.intro')}</p>
        <label className="field">
          <textarea
            rows={7}
            maxLength={MAX}
            value={text}
            placeholder={t('bugs.placeholder')}
            aria-label={t('bugs.title')}
            onChange={(e) => {
              setText(e.target.value);
              setSent(false);
            }}
          />
          <small className="muted">{t('bugs.count', { n: text.trim().length, max: MAX })}</small>
        </label>
        {sent && <p className="chip up">✓ {t('bugs.thanks')}</p>}
        <button className="btn primary big" disabled={busy || !ok} onClick={() => void send()}>
          🐞 {busy ? t('bugs.sending') : t('bugs.send')}
        </button>
        <small className="muted">{t('bugs.privacy')}</small>
      </div>
    </section>
  );
}
