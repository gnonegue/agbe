import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import * as google from './google';

vi.mock('./google', async (orig) => ({ ...(await orig<typeof import('./google')>()), exchangeCode: vi.fn() }));

// Connexion avec Google : nouveau compte (profil à compléter), compte existant (mot de passe demandé), compte déjà lié (session directe).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const CLIENT = 'client-123.apps.googleusercontent.com';
const client = { ip: '1.2.3.4', userAgent: 'test' };
const idToken = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 3000, email_verified: true, ...claims })).toString('base64url')}.s`;

d('Connexion avec Google (PostgreSQL)', () => {
  let prisma: PrismaService;
  let auth: AuthService;
  let jwt: JwtService;
  const tag = Date.now().toString(36);
  const ids: string[] = [];

  /** Simule le tour complet chez Google : renvoie ce que le serveur fait du retour (code + état). */
  async function comeBack(profile: { sub: string; email: string; name?: string }) {
    const { stateToken } = await auth.googleStart('fr');
    const st = jwt.decode(stateToken) as { state: string; nonce: string };
    vi.mocked(google.exchangeCode).mockResolvedValueOnce(idToken({ ...profile, nonce: st.nonce }));
    return auth.googleCallback({ code: 'code', state: st.state }, stateToken, client);
  }
  const signup = { username: `kofi_${tag}`, phone: '+22890000001', birthDate: '1990-05-05', acceptTerms: true as const, locale: 'fr' as const };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    jwt = new JwtService();
    const env = { JWT_ACCESS_SECRET: 'x'.repeat(40), JWT_ACCESS_TTL_SECONDS: 900, REFRESH_TTL_DAYS: 30, GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: 'secret', PUBLIC_APP_URL: 'https://agbe.test' };
    auth = new AuthService(prisma, jwt, { log: vi.fn() } as never, env as never, { send: vi.fn() } as never);
  });

  beforeEach(() => vi.mocked(google.exchangeCode).mockReset());

  afterAll(async () => {
    await prisma.account.deleteMany({ where: { id: { in: ids } } });
    await prisma?.$disconnect();
  });

  it('nouvelle personne : Google fournit l’adresse, la personne complète le reste, puis la connexion suivante est directe', async () => {
    const email = `nouveau-${tag}@gmail.com`;
    const out = await comeBack({ sub: `g-${tag}-1`, email, name: 'Koffi Mensah' });
    expect(out).toMatchObject({ kind: 'pending', next: 'signup' });
    const token = (out as { token: string }).token;
    expect(await auth.googlePending(token)).toEqual({ kind: 'signup', email, name: 'Koffi Mensah' });

    await expect(auth.googleComplete(token, { ...signup, birthDate: '2015-01-01' }, client)).rejects.toThrow('underage');
    const tokens = await auth.googleComplete(token, signup, client);
    expect(tokens.accessToken).toBeTruthy();
    const acc = await prisma.account.findUniqueOrThrow({ where: { email } });
    ids.push(acc.id);
    expect(acc).toMatchObject({ googleSub: `g-${tag}-1`, username: signup.username, phone: signup.phone, guest: false });
    expect(await prisma.consent.count({ where: { accountId: acc.id } })).toBe(2);
    // Pas de mot de passe utilisable : personne ne peut se connecter avec une valeur devinée
    await expect(auth.login({ identifier: email, password: 'nimportequoi-123' }, client)).rejects.toThrow('invalid_credentials');

    const again = await comeBack({ sub: `g-${tag}-1`, email });
    expect(again.kind).toBe('tokens');
  });

  it('refuse un nom d’utilisateur déjà pris', async () => {
    const out = await comeBack({ sub: `g-${tag}-2`, email: `autre-${tag}@gmail.com` });
    await expect(auth.googleComplete((out as { token: string }).token, { ...signup, phone: '+22890000002' }, client)).rejects.toThrow('username_taken');
  });

  it('adresse déjà inscrite par mot de passe : le mot de passe est exigé avant de lier Google', async () => {
    const email = `ancien-${tag}@gmail.com`;
    const acc = await prisma.account.create({ data: { email, username: `ancien_${tag}`, passwordHash: await argon2.hash('mon-mot-de-passe-1'), birthDate: new Date('1990-01-01') } });
    ids.push(acc.id);
    const out = await comeBack({ sub: `g-${tag}-3`, email });
    expect(out).toMatchObject({ kind: 'pending', next: 'link' });
    const token = (out as { token: string }).token;
    // Pas de liaison automatique : quelqu'un qui aurait inscrit cette adresse avant son propriétaire garderait la main
    expect((await prisma.account.findUniqueOrThrow({ where: { id: acc.id } })).googleSub).toBeNull();
    await expect(auth.googleLink(token, 'mauvais-mot-de-passe', client)).rejects.toThrow('invalid_credentials');
    expect((await prisma.account.findUniqueOrThrow({ where: { id: acc.id } })).googleSub).toBeNull();
    const r = await auth.googleLink(token, 'mon-mot-de-passe-1', client);
    expect(r.kind).toBe('tokens');
    expect((await prisma.account.findUniqueOrThrow({ where: { id: acc.id } })).googleSub).toBe(`g-${tag}-3`);
    expect((await comeBack({ sub: `g-${tag}-3`, email })).kind).toBe('tokens');
  });

  it('compte suspendu : refusé ; double authentification : le défi est transmis', async () => {
    const sus = await prisma.account.create({ data: { email: `susp-${tag}@gmail.com`, googleSub: `g-${tag}-4`, passwordHash: 'x', birthDate: new Date('1990-01-01'), suspendedAt: new Date() } });
    const mfa = await prisma.account.create({ data: { email: `mfa-${tag}@gmail.com`, googleSub: `g-${tag}-5`, passwordHash: 'x', birthDate: new Date('1990-01-01'), totpEnabled: true } });
    ids.push(sus.id, mfa.id);
    expect(await comeBack({ sub: `g-${tag}-4`, email: sus.email! })).toEqual({ kind: 'error', reason: 'account_suspended' });
    const out = await comeBack({ sub: `g-${tag}-5`, email: mfa.email! });
    expect(out).toMatchObject({ kind: 'pending', next: 'mfa' });
    expect(await auth.googlePending((out as { token: string }).token)).toMatchObject({ kind: 'mfa', mfaToken: expect.any(String) });
  });

  it('état falsifié, cookie absent ou refus de la personne : aucune session', async () => {
    const { stateToken } = await auth.googleStart('en');
    expect(await auth.googleCallback({ code: 'c', state: 'autre-etat' }, stateToken, client)).toEqual({ kind: 'error', reason: 'google_failed' });
    expect(await auth.googleCallback({ code: 'c', state: 'x' }, undefined, client)).toEqual({ kind: 'error', reason: 'google_failed' });
    expect(await auth.googleCallback({ error: 'access_denied' }, stateToken, client)).toEqual({ kind: 'error', reason: 'google_denied' });
  });

  it('un jeton de liaison ne sert pas à créer un compte, et inversement', async () => {
    const link = await comeBack({ sub: `g-${tag}-6`, email: `ancien-${tag}@gmail.com` });
    await expect(auth.googleComplete((link as { token: string }).token, signup, client)).rejects.toThrow('google_failed');
    await expect(auth.googleLink('jeton-invalide', 'x', client)).rejects.toThrow('google_failed');
  });
});
