import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from './character.service';

// Recommencer sa vie : argent du jeu rendu au Trésor, argent acheté reporté, grand livre équilibré.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Recommencer sa vie (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let chars: CharacterService;
  let accountId: string;
  let walletId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    chars = new CharacterService(prisma, ledger, new SettingsService(prisma));
    for (const code of ['TREASURY', 'PURCHASES', 'CARRY']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    const tag = Date.now().toString(36);
    const acc = await prisma.account.create({ data: { email: `restart-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'Ancien', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', wallet: { create: {} } },
      include: { wallet: true },
    });
    accountId = acc.id;
    walletId = c.wallet!.id;
    const treasury = await ledger.systemWalletId(prisma, 'TREASURY');
    const purchases = await ledger.systemWalletId(prisma, 'PURCHASES');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: treasury, to: walletId, amount: 50_000n }] }));
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'PURCHASE', legs: [{ from: purchases, to: walletId, amount: 20_000n }] }));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('clôt le personnage, met de côté l’argent acheté et le reporte sur le suivant', async () => {
    await expect(chars.restart(accountId)).resolves.toBeUndefined();
    expect(await prisma.character.findUnique({ where: { accountId } })).toBeNull();
    const old = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(old.balance).toBe(0n);
    expect(old.characterId).toBeNull();
    expect((await prisma.account.findUniqueOrThrow({ where: { id: accountId } })).restartCarry).toBe(20_000n);
    await expect(chars.restart(accountId)).rejects.toThrow('no_character');

    const s = await chars.create(accountId, { name: 'Nouveau', profile: 'LOCAL', region: 'MARITIME', mode: 'FREE_CHOICE', condition: 'POOR' } as never);
    const capital = BigInt((await new SettingsService(prisma).get('start.capital')).POOR);
    expect(BigInt(s.wallet.balance)).toBe(capital + 20_000n);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: accountId } })).restartCarry).toBe(0n);
  });
});
