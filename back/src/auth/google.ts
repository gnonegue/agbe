// Connexion avec Google (OpenID Connect, flux « code d'autorisation » avec PKCE) : fonctions pures et appels réseau isolés.
// Le jeton d'identité est reçu directement du point d'échange de Google, en TLS, contre le secret du client : sa signature
// n'a pas à être revérifiée (OpenID Connect Core, 3.1.3.7). On contrôle en revanche émetteur, audience, expiration, nonce
// et adresse vérifiée.
import { createHash, randomBytes } from 'node:crypto';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export interface GoogleProfile {
  /** Identifiant stable du compte Google (ne change jamais, contrairement à l'adresse). */
  sub: string;
  email: string;
  name: string;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

/** Paire PKCE : le secret reste côté serveur, seule son empreinte part chez Google. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export const randomState = (): string => b64url(randomBytes(24));

/** Adresse de la page de choix de compte Google. */
export function authorizeUrl(p: { clientId: string; redirectUri: string; state: string; nonce: string; challenge: string; locale: 'fr' | 'en' }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
    hl: p.locale,
  });
  return `${GOOGLE_AUTH_URL}?${q.toString()}`;
}

/** Contrôle les revendications du jeton d'identité ; lève `google_invalid_token` au moindre doute. */
export function checkIdToken(idToken: string, expect: { clientId: string; nonce: string; now?: number }): GoogleProfile {
  const fail = (): never => {
    throw new Error('google_invalid_token');
  };
  const parts = idToken.split('.');
  if (parts.length !== 3) return fail();
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return fail();
  }
  const now = Math.floor((expect.now ?? Date.now()) / 1000);
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (typeof c.iss !== 'string' || !ISSUERS.includes(c.iss)) return fail();
  if (!aud.includes(expect.clientId)) return fail();
  if (typeof c.exp !== 'number' || c.exp + 60 < now) return fail();
  if (c.nonce !== expect.nonce) return fail();
  if (typeof c.sub !== 'string' || c.sub.length < 1 || c.sub.length > 64) return fail();
  if (typeof c.email !== 'string' || c.email_verified !== true) return fail();
  const email = c.email.trim().toLowerCase();
  if (email.length > 254 || !email.includes('@')) return fail();
  return { sub: c.sub, email, name: typeof c.name === 'string' ? c.name.slice(0, 80) : '' };
}

/** Échange le code contre le jeton d'identité (le secret du client ne quitte jamais le serveur). */
export async function exchangeCode(
  p: { clientId: string; clientSecret: string; redirectUri: string; code: string; verifier: string },
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchFn(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: p.clientId,
      client_secret: p.clientSecret,
      code: p.code,
      code_verifier: p.verifier,
      grant_type: 'authorization_code',
      redirect_uri: p.redirectUri,
    }).toString(),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error('google_exchange_failed');
  const body = (await res.json()) as { id_token?: unknown };
  if (typeof body.id_token !== 'string') throw new Error('google_exchange_failed');
  return body.id_token;
}
