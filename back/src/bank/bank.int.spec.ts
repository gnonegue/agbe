import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { BankService } from './bank.module';

// Banques : livret et DAT, en agence, via le grand livre (base réelle TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Banques (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let settings: SettingsService;
  let bank: BankService;
  let accountId: string;
  let characterId: string;
  let walletId: string;
  const balance = async () => (await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    settings = new SettingsService(prisma);
    const chars = new CharacterService(prisma, ledger, settings);
    bank = new BankService(ledger, settings, chars);
    // Toutes les agences ouvertes pour le test (aucun horaire dans la base de test)
    await prisma.gameSetting.upsert({ where: { key: 'venues.hours' }, create: { key: 'venues.hours', value: {} }, update: { value: {} } });
    for (const code of ['TREASURY', 'BANK', 'MARKET']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    const tag = Date.now().toString(36);
    const acc = await prisma.account.create({ data: { email: `bank-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'Épargnant', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', locationId: 'port', wallet: { create: {} } },
      include: { wallet: true },
    });
    accountId = acc.id;
    characterId = c.id;
    walletId = c.wallet!.id;
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: walletId, amount: 1_000_000n }] }));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('ouverture en agence seulement, puis versement et retrait du livret', async () => {
    await expect(bank.deposit(accountId, 'ecobank', 50_000)).rejects.toThrow('bank_go_agency');
    await prisma.character.update({ where: { id: characterId }, data: { locationId: 'bank_ecobank_1' } });
    await expect(bank.deposit(accountId, 'ecobank', 1_000)).rejects.toThrow('bank_min_savings');
    await bank.deposit(accountId, 'ecobank', 50_000);
    // Hors agence : versement possible depuis le téléphone une fois le livret ouvert
    await prisma.character.update({ where: { id: characterId }, data: { locationId: 'port' } });
    await bank.deposit(accountId, 'ecobank', 10_000);
    await expect(bank.withdraw(accountId, 'ecobank', 70_000)).rejects.toThrow('savings_insufficient');
    await bank.withdraw(accountId, 'ecobank', 20_000);
    const v = await bank.view(accountId);
    expect(v.result.savings).toEqual([expect.objectContaining({ bankId: 'ecobank', balance: '40000' })]);
    expect(await balance()).toBe(960_000n);
  });

  it('DAT : taux selon la durée, rupture anticipée sans intérêts, échéance avec intérêts', async () => {
    await expect(bank.openTerm(accountId, 'fucec', 12, 100_000)).rejects.toThrow('bank_go_agency');
    await prisma.character.update({ where: { id: characterId }, data: { locationId: 'bank_fucec_1' } });
    await expect(bank.openTerm(accountId, 'fucec', 7, 100_000)).rejects.toThrow('unknown_term');
    const t12 = await bank.openTerm(accountId, 'fucec', 12, 100_000);
    const rate = (await settings.get('banks')).find((b) => b.id === 'fucec')!.terms.find((t) => t.months === 12)!.yearBp;
    expect(t12.result.interest).toBe(String((100_000 * rate) / 10_000));
    const before = await balance();
    const broken = await bank.closeTerm(accountId, t12.result.id!);
    expect(broken.result).toMatchObject({ early: true, interest: '0' });
    expect((await balance()) - before).toBe(100_000n);
    // Échéance simulée : on recule le jour d'ouverture
    const t3 = await bank.openTerm(accountId, 'fucec', 3, 200_000);
    await prisma.bankDeposit.update({ where: { id: t3.result.id! }, data: { startDay: -1000 } });
    const b2 = await balance();
    const paid = await bank.closeTerm(accountId, t3.result.id!);
    expect(paid.result.early).toBe(false);
    expect((await balance()) - b2).toBe(200_000n + BigInt(paid.result.interest));
    expect(BigInt(paid.result.interest)).toBeGreaterThan(0n);
    await expect(bank.closeTerm(accountId, t3.result.id!)).rejects.toThrow('not_found');
  });
});
