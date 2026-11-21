import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from './character.service';

// Achat du logement : prix payé une fois, puis plus de loyer (base réelle TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Achat du logement (PostgreSQL)', () => {
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
    const settings = new SettingsService(prisma);
    chars = new CharacterService(prisma, ledger, settings);
    for (const code of ['MARKET', 'LANDLORD']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    const tag = Date.now().toString(36);
    const acc = await prisma.account.create({ data: { email: `owner-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'Owner', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', wallet: { create: {} } },
      include: { wallet: true },
    });
    accountId = acc.id;
    walletId = c.wallet!.id;
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: walletId, amount: 1_200_000n }] }));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('achète le logement au prix du serveur, puis plus de loyer', async () => {
    const before = (await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance;
    const r = await chars.buyHome(accountId);
    expect(before - (await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance).toBe(BigInt(r.result.paid));
    expect(r.state.rent).toMatchObject({ owned: true, monthly: 0, overdue: false });
    await expect(chars.payRent(accountId)).rejects.toThrow('home_owned');
    await expect(chars.buyHome(accountId)).rejects.toThrow('home_owned');
  });
});
