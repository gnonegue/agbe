import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

// Mot de passe posé par un administrateur : nouveau hachage, sessions révoquées, invités et mots de passe faibles refusés.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Mot de passe réinitialisé par un admin (PostgreSQL)', () => {
  let prisma: PrismaService;
  let auth: AuthService;
  let accountId: string;
  let guestId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    auth = new AuthService(prisma, {} as never, {} as never, {} as never, {} as never);
    const tag = Date.now().toString(36);
    const acc = await prisma.account.create({ data: { email: `reset-${tag}@test.tg`, username: `reset_${tag}`, passwordHash: await argon2.hash('ancien-mot-de-passe'), birthDate: new Date('1990-01-01') } });
    accountId = acc.id;
    await prisma.session.create({ data: { accountId, tokenHash: `h-${tag}`, familyId: crypto.randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) } });
    guestId = (await prisma.account.create({ data: { guest: true, passwordHash: 'x', birthDate: new Date('1990-01-01') } })).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('pose le nouveau mot de passe et révoque toutes les sessions', async () => {
    const before = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    await auth.adminSetPassword(accountId, 'Nouveau-Mot-2026');
    const after = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(await argon2.verify(after.passwordHash, 'Nouveau-Mot-2026')).toBe(true);
    expect(await argon2.verify(after.passwordHash, 'ancien-mot-de-passe')).toBe(false);
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    expect(await prisma.session.count({ where: { accountId, revokedAt: null } })).toBe(0);
  });

  it('refuse un mot de passe égal à l’identifiant', async () => {
    const acc = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    await expect(auth.adminSetPassword(accountId, acc.email!)).rejects.toThrow('weak_password');
  });

  it('refuse un compte invité et un compte inconnu', async () => {
    await expect(auth.adminSetPassword(guestId, 'Nouveau-Mot-2026')).rejects.toThrow('account_required');
    await expect(auth.adminSetPassword('00000000-0000-4000-8000-000000000000', 'Nouveau-Mot-2026')).rejects.toThrow('not_found');
  });
});
