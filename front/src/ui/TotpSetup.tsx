import qrcode from 'qrcode-generator';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Clé TOTP base32 groupée par 4 pour une saisie manuelle sans erreur. */
const groupBy4 = (s: string) => s.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');

/**
 * Code QR du lien otpauth, généré dans le navigateur : la clé secrète n'est jamais envoyée à un service
 * extérieur de fabrication d'images. Toujours noir sur blanc, avec la marge de 4 modules exigée par les lecteurs.
 */
function Qr({ url, label }: { url: string; label: string }) {
  const qr = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(url);
    q.make();
    const n = q.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { n, d };
  }, [url]);
  return (
    <svg className="totp-qr" viewBox={`-4 -4 ${qr.n + 8} ${qr.n + 8}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-4} y={-4} width={qr.n + 8} height={qr.n + 8} fill="#fff" />
      <path d={qr.d} fill="#000" />
    </svg>
  );
}

/** En-tête d'une étape : pastille numérotée, titre et aide ; le contenu de l'étape suit en pleine largeur, centré. */
function Step({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="totp-head">
      <span className="totp-n" aria-hidden="true">{n}</span>
      <div>
        <strong>{title}</strong>
        {hint && <small>{hint}</small>}
      </div>
    </div>
  );
}

/**
 * Activation de la double authentification, en trois étapes : installer une application, scanner le code QR
 * (ou saisir la clé à la main), puis taper le code à 6 chiffres. Partagé par l'appli Réglages et l'espace admin.
 */
export default function TotpSetup({ totp, code, onCode }: { totp: { secret: string; otpauthUrl: string }; code: string; onCode: (code: string) => void }) {
  const { t } = useTranslation();
  const codeId = useId();
  const [copied, setCopied] = useState<'secret' | 'link' | null>(null);
  const copy = async (what: 'secret' | 'link') => {
    try {
      await navigator.clipboard.writeText(what === 'secret' ? totp.secret : totp.otpauthUrl);
      setCopied(what);
      window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
    } catch {
      setCopied(null);
    }
  };
  return (
    <ol className="totp-steps">
      <li>
        <Step n={1} title={t('settings.totpStep1')} hint={t('settings.totpStep1Hint')} />
      </li>
      <li>
        <Step n={2} title={t('settings.totpStep2')} hint={t('settings.totpStep2Hint')} />
        <div className="totp-qr-card">
          <Qr url={totp.otpauthUrl} label={t('settings.totpQr')} />
        </div>
        <details className="totp-manual">
          <summary>{t('settings.totpManual')}</summary>
          <span className="muted">{t('settings.totpSecret')}</span>
          <div className="copy-row">
            <code className="mono selectable secret">{groupBy4(totp.secret)}</code>
            <button type="button" className="btn small" onClick={() => void copy('secret')}>{copied === 'secret' ? t('settings.copied') : t('settings.copy')}</button>
          </div>
          <span className="muted">{t('settings.totpLink')}</span>
          <div className="copy-row">
            <code className="mono selectable totp-link">{totp.otpauthUrl}</code>
            <button type="button" className="btn small" onClick={() => void copy('link')}>{copied === 'link' ? t('settings.copied') : t('settings.copy')}</button>
          </div>
        </details>
      </li>
      <li>
        <label htmlFor={codeId}>
          <Step n={3} title={t('settings.totpCode')} />
        </label>
        <input
          id={codeId}
          className="totp-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          maxLength={6}
          value={code}
          onChange={(e) => onCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          required
        />
      </li>
    </ol>
  );
}
