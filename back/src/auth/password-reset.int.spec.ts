import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { sha256Hex } from '../common/crypto';

// Mot de passe oublié : lien par e-mail à usage unique, expiration, une seule demande par minute, sessions révoquées.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Réinitialisation du mot de passe par e-mail (PostgreSQL)', () => {
  let prisma: PrismaService;
  let auth: AuthService;
  const sent: { to: string; text: string; subject: string }[] = [];
  let accountId: string;
  let email: string;
  let guestId: string;
  let tunnelId: string | undefined;
  const env: { PUBLIC_APP_URL: string; MAIL_LINK_URL?: string } = { PUBLIC_APP_URL: 'https://agbe.test' };
  const tokenOf = () => /reset=([A-Za-z0-9_-]+)/.exec(sent[sent.length - 1]!.text)![1]!;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const mail = { send: vi.fn(async (m: { to: string; text: string; subject: string }) => (sent.push(m), true)) };
    auth = new AuthService(prisma, {} as never, { log: vi.fn() } as never, env as never, mail as never);
    const tag = Date.now().toString(36);
    email = `oubli-${tag}@test.tg`;
    const acc = await prisma.account.create({ data: { email, username: `oubli_${tag}`, passwordHash: await argon2.hash('ancien-mot-de-passe'), birthDate: new Date('1990-01-01'), failedLogins: 9, lockedUntil: new Date(Date.now() + 600_000) } });
    accountId = acc.id;
    await prisma.session.create({ data: { accountId, tokenHash: `h-${tag}`, familyId: crypto.randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) } });
    guestId = (await prisma.account.create({ data: { guest: true, passwordHash: 'x', birthDate: new Date('1990-01-01') } })).id;
  });

  afterAll(async () => {
    await prisma.account.deleteMany({ where: { id: { in: [accountId, guestId, ...(tunnelId ? [tunnelId] : [])] } } });
    await prisma?.$disconnect();
  });

  const settle = () => new Promise((r) => setTimeout(r, 300));

  it('n’envoie rien pour une adresse inconnue (même réponse)', async () => {
    await expect(auth.requestPasswordReset('inconnu@test.tg', '1.2.3.4')).resolves.toBeUndefined();
    await settle();
    expect(sent).toHaveLength(0);
  });

  it('envoie un lien, ne stocke que son empreinte, et limite à un envoi par minute', async () => {
    await auth.requestPasswordReset(email.toUpperCase(), '1.2.3.4');
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(email);
    expect(sent[0]!.text).toContain('https://agbe.test/?reset=');
    const token = tokenOf();
    const row = await prisma.passwordReset.findUniqueOrThrow({ where: { tokenHash: sha256Hex(token) } });
    expect(row.tokenHash).not.toContain(token);
    await auth.requestPasswordReset(email, '1.2.3.4');
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('refuse un mot de passe faible puis accepte le bon, une seule fois', async () => {
    const token = tokenOf();
    await expect(auth.resetPasswordWithToken(token, email, '1.2.3.4')).rejects.toThrow('weak_password');
    await auth.resetPasswordWithToken(token, 'Nouveau-Mot-2026', '1.2.3.4');
    const acc = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(await argon2.verify(acc.passwordHash, 'Nouveau-Mot-2026')).toBe(true);
    expect(acc.failedLogins).toBe(0);
    expect(acc.lockedUntil).toBeNull();
    expect(await prisma.session.count({ where: { accountId, revokedAt: null } })).toBe(0);
    await expect(auth.resetPasswordWithToken(token, 'Autre-Mot-2026-x', '1.2.3.4')).rejects.toThrow('invalid_reset_token');
    await settle();
    expect(sent[sent.length - 1]!.subject).toMatch(/modifié|changed/);
  });

  it('refuse un jeton expiré ou inconnu', async () => {
    await expect(auth.resetPasswordWithToken('x'.repeat(43), 'Nouveau-Mot-2026', 'ip')).rejects.toThrow('invalid_reset_token');
    const token = 'e'.repeat(43);
    await prisma.passwordReset.create({ data: { accountId, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() - 1000) } });
    await expect(auth.resetPasswordWithToken(token, 'Nouveau-Mot-2026', 'ip')).rejects.toThrow('invalid_reset_token');
  });

  it('l’administrateur envoie un lien (pas de limite d’une minute) et un nouveau lien invalide l’ancien', async () => {
    const before = sent.length;
    expect(await auth.sendResetLink(accountId, accountId, '1.2.3.4')).toBe(true);
    const first = tokenOf();
    expect(await auth.sendResetLink(accountId, accountId, '1.2.3.4')).toBe(true);
    expect(sent.length).toBe(before + 2);
    await expect(auth.resetPasswordWithToken(first, 'Nouveau-Mot-2027', 'ip')).rejects.toThrow('invalid_reset_token');
    await auth.resetPasswordWithToken(tokenOf(), 'Nouveau-Mot-2027', 'ip');
  });

  it('refuse un invité et un compte inconnu côté administrateur', async () => {
    await expect(auth.sendResetLink(guestId, accountId, 'ip')).rejects.toThrow('email_required');
    await expect(auth.sendResetLink('00000000-0000-4000-8000-000000000000', accountId, 'ip')).rejects.toThrow('not_found');
  });

  it('met MAIL_LINK_URL dans le lien quand elle est définie (tunnel de test, PUBLIC_APP_URL en localhost)', async () => {
    const tag = Date.now().toString(36);
    const acc = await prisma.account.create({ data: { email: `tunnel-${tag}@test.tg`, username: `tunnel_${tag}`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    tunnelId = acc.id;
    env.PUBLIC_APP_URL = 'http://localhost:5173';
    env.MAIL_LINK_URL = 'https://essai.trycloudflare.com/';
    await auth.requestPasswordReset(acc.email!, '1.2.3.4');
    await settle();
    expect(sent[sent.length - 1]!.text).toContain('https://essai.trycloudflare.com/?reset=');
    expect(sent[sent.length - 1]!.text).not.toContain('localhost');
  });
});
