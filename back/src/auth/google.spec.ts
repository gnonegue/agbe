import { describe, expect, it, vi } from 'vitest';
import { authorizeUrl, checkIdToken, exchangeCode, pkcePair } from './google';

const CLIENT = 'client-123.apps.googleusercontent.com';
const now = Date.UTC(2026, 9, 24, 12, 0, 0);
const jwt = (claims: Record<string, unknown>) => `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const good = { iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor(now / 1000) + 3000, nonce: 'n1', sub: '1098765', email: 'Koffi@Gmail.com', email_verified: true, name: 'Koffi Mensah' };

describe('Connexion avec Google', () => {
  it('PKCE : l’empreinte envoyée à Google est celle du secret gardé côté serveur', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkcePair().verifier).not.toBe(verifier);
  });

  it('construit l’adresse de la page de choix de compte', () => {
    const u = new URL(authorizeUrl({ clientId: CLIENT, redirectUri: 'https://agbe.tg/api/auth/google/callback', state: 's', nonce: 'n', challenge: 'c', locale: 'fr' }));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('redirect_uri')).toBe('https://agbe.tg/api/auth/google/callback');
    expect(u.searchParams.get('client_secret')).toBeNull();
  });

  it('accepte un jeton valide et met l’adresse en minuscules', () => {
    expect(checkIdToken(jwt(good), { clientId: CLIENT, nonce: 'n1', now })).toEqual({ sub: '1098765', email: 'koffi@gmail.com', name: 'Koffi Mensah' });
  });

  it.each([
    ['mauvaise audience', { aud: 'autre-client' }],
    ['mauvais émetteur', { iss: 'https://evil.example' }],
    ['expiré', { exp: Math.floor(now / 1000) - 600 }],
    ['nonce différent', { nonce: 'rejoue' }],
    ['adresse non vérifiée', { email_verified: false }],
    ['sans adresse', { email: undefined }],
    ['sans identifiant', { sub: '' }],
  ])('refuse un jeton : %s', (_n, patch) => {
    expect(() => checkIdToken(jwt({ ...good, ...patch }), { clientId: CLIENT, nonce: 'n1', now })).toThrow('google_invalid_token');
  });

  it('refuse un jeton mal formé', () => {
    expect(() => checkIdToken('pas-un-jeton', { clientId: CLIENT, nonce: 'n1', now })).toThrow('google_invalid_token');
    expect(() => checkIdToken('a.!!!.c', { clientId: CLIENT, nonce: 'n1', now })).toThrow('google_invalid_token');
  });

  it('échange le code avec le secret du client, sans jamais l’exposer ailleurs', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ id_token: 'abc' }), { status: 200 }));
    const t = await exchangeCode({ clientId: CLIENT, clientSecret: 'S3CR3T', redirectUri: 'https://x/cb', code: 'c', verifier: 'v' }, fetchFn as never);
    expect(t).toBe('abc');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.body).toContain('code_verifier=v');
    await expect(exchangeCode({ clientId: CLIENT, clientSecret: 'S', redirectUri: 'x', code: 'c', verifier: 'v' }, (async () => new Response('{}', { status: 400 })) as never)).rejects.toThrow('google_exchange_failed');
  });
});
