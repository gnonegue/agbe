import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { AccountController } from './account.controller';
import { DeletedAccountsService } from './deleted-accounts.service';

// Suppression de compte : compte fermé et vidé, identité gardée à part pour l'administration, effacée à l'échéance sauf enquête.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Suppression de compte (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ctrl: AccountController;
  let accountId: string;
  const tag = Date.now().toString(36);
  const phone = `+2289${String(Date.now()).slice(-7)}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const auth = { verifyPassword: async () => true };
    const audit = { log: async () => undefined };
    const settings = { get: async () => ({ days: 365 }) };
    ctrl = new AccountController(prisma, auth as never, audit as never, settings as never);
    const acc = await prisma.account.create({
      data: { email: `del-${tag}@test.tg`, phone, username: `del_${tag}`, googleSub: `g-del-${tag}`, passwordHash: 'x', birthDate: new Date('1995-05-05') },
    });
    accountId = acc.id;
    await prisma.character.create({ data: { accountId, name: `Kodjo ${tag}`.slice(0, 32), profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', wallet: { create: {} } } });
    await prisma.session.create({ data: { accountId, tokenHash: `h-del-${tag}`, familyId: crypto.randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) } });
    await prisma.auditLog.create({ data: { action: 'test.login', actorId: accountId, ip: '41.207.1.2' } });
    await prisma.auditLog.create({ data: { action: 'test.play', actorId: accountId, ip: '41.207.1.2' } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('vide le compte, garde l’identité dans l’archive et libère le numéro', async () => {
    await ctrl.remove({ accountId } as never, { password: 'x' } as never);
    const acc = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(acc).toMatchObject({ email: null, phone: null, username: null, googleSub: null });
    expect(acc.deletedAt).not.toBeNull();
    expect(await prisma.session.count({ where: { accountId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { actorId: accountId, ip: { not: null } } })).toBe(0);
    const arch = await prisma.deletedAccount.findUniqueOrThrow({ where: { accountId } });
    expect(arch).toMatchObject({ email: `del-${tag}@test.tg`, phone, username: `del_${tag}`, googleSub: `g-del-${tag}`, ips: ['41.207.1.2'], hold: false });
    expect(arch.characterName).toContain('Kodjo');
    expect(arch.purgeAt.getTime() - arch.deletedAt.getTime()).toBe(365 * 86_400_000);
    // Le même numéro peut servir à une nouvelle inscription
    const again = await prisma.account.create({ data: { phone, passwordHash: 'x', birthDate: new Date('1995-05-05') } });
    expect(again.phone).toBe(phone);
  });

  it('efface l’identité à l’échéance, sauf enquête en cours', async () => {
    const purge = new DeletedAccountsService(prisma);
    const later = new Date(Date.now() + 400 * 86_400_000);
    await prisma.deletedAccount.update({ where: { accountId }, data: { hold: true } });
    await purge.purge(later);
    expect(await prisma.deletedAccount.count({ where: { accountId } })).toBe(1);
    await prisma.deletedAccount.update({ where: { accountId }, data: { hold: false } });
    await purge.purge(later);
    expect(await prisma.deletedAccount.count({ where: { accountId } })).toBe(0);
  });
});
