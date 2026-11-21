// Lecture sûre des paramètres de retour de paiement, puis nettoyage de l'URL.
import { UUID_V4 } from './validate';
import { PAYMENT_ORIGINS } from './paymentOrigins';

export interface ReturnParams {
  purchase: string | null;
  mockPay: string | null;
  /** Jeton du lien « mot de passe oublié » reçu par e-mail. */
  reset: string | null;
  /** Retour de Google : session ouverte, suite à donner (finir l'inscription, mot de passe, 2FA) ou erreur. */
  google: { step: 'ok' | 'signup' | 'link' | 'mfa' } | { step: 'error'; reason: string } | null;
}

export function consumeReturnParams(): ReturnParams {
  const out: ReturnParams = { purchase: null, mockPay: null, reset: null, google: null };
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return out;
  }
  const p = url.searchParams.get('purchase');
  const m = url.searchParams.get('mockPay');
  const rs = url.searchParams.get('reset');
  if (rs && /^[A-Za-z0-9_-]{32,64}$/.test(rs)) out.reset = rs;
  const g = url.searchParams.get('google');
  if (g === 'ok' || g === 'signup' || g === 'link' || g === 'mfa') out.google = { step: g };
  else if (g === 'error') {
    const reason = url.searchParams.get('reason') ?? '';
    out.google = { step: 'error', reason: ['google_disabled', 'google_denied', 'google_failed', 'account_suspended'].includes(reason) ? reason : 'google_failed' };
  }
  if (p && UUID_V4.test(p)) out.purchase = p.toLowerCase();
  // Paiement simulé : développement uniquement ; en production le paramètre est ignoré.
  if (import.meta.env.DEV && m && UUID_V4.test(m)) out.mockPay = m.toLowerCase();
  if (url.search) {
    // Supprime tous les paramètres : rien de réinjectable ne reste dans l'historique.
    window.history.replaceState(null, '', url.pathname + url.hash);
  }
  return out;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * N'accepte qu'une URL https dont l'origine figure dans PAYMENT_ORIGINS.
 * En développement seulement : http://localhost / 127.0.0.1 et l'origine de l'app elle-même (fournisseur mock).
 */
export function safeRedirectUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  const dev = import.meta.env.DEV;
  const httpsOk = u.protocol === 'https:';
  const devHttpOk = dev && u.protocol === 'http:' && LOOPBACK.has(u.hostname);
  if (!httpsOk && !devHttpOk) return null;
  const allowed = PAYMENT_ORIGINS.includes(u.origin) || (dev && (u.origin === window.location.origin || devHttpOk));
  return allowed ? u.href : null;
}
