import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { CompanyService } from './company.service';
import { gameTimeAt } from '../economy/clock';
import { monthOf } from '../economy/company';
import { BankService } from '../bank/bank.module';

// Plusieurs entreprises, vente, fermeture, ventes automatiques des salariés, DAT versés automatiquement (base réelle TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Portefeuille d\'entreprises (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let settings: SettingsService;
  let svc: CompanyService;
  const boss = { account: '', character: '', wallet: '' };
  const balance = async (w: string) => (await prisma.wallet.findUniqueOrThrow({ where: { id: w } })).balance;
  const company = async (name: string, status: 'REGISTERED' | 'PENDING_CFE' = 'REGISTERED') =>
    prisma.company.create({ data: { characterId: boss.character, name, activityId: 'pagnes', form: 'EI', status, readyAt: new Date(), createdMonth: monthOf(gameTimeAt(await settings.clock(), Date.now()).day) } });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    settings = new SettingsService(prisma);
    svc = new CompanyService(prisma, ledger, settings, new CharacterService(prisma, ledger, settings));
    for (const code of ['TREASURY', 'BANK', 'MARKET']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    const tag = Date.now().toString(36);
    const acc = await prisma.account.create({ data: { email: `pf-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'Patron', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', wallet: { create: {} } },
      include: { wallet: true },
    });
    Object.assign(boss, { account: acc.id, character: c.id, wallet: c.wallet!.id });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('deux entreprises, sélection, vente au prix du serveur, fermeture, plafond', async () => {
    const a = await company('Boutique A');
    const b = await company('Boutique B');
    expect((await svc.select(boss.account, b.id)).result.company).toBe(b.id);
    // Vente : 120 séances × (9 000 − 6 000)
    const before = await balance(boss.wallet);
    const r = await svc.sell(boss.account, b.id);
    expect(r.result.price).toBe('360000');
    expect((await balance(boss.wallet)) - before).toBe(360_000n);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('CLOSED');
    // Une entreprise vendue ne se revend pas, l'autre devient celle en cours
    await expect(svc.sell(boss.account, b.id)).rejects.toThrow('no_company');
    await expect(svc.select(boss.account, b.id)).rejects.toThrow('no_company');
    // Fermer : rien n'est versé
    const mid = await balance(boss.wallet);
    expect((await svc.close(boss.account, a.id)).result.price).toBe('0');
    expect(await balance(boss.wallet)).toBe(mid);
    expect(await prisma.company.count({ where: { characterId: boss.character, status: { not: 'CLOSED' } } })).toBe(0);
  });

  it('un salarié vend à la place du patron, le bénéfice est versé au grand livre', async () => {
    const co = await company('Boutique C');
    await prisma.character.update({ where: { id: boss.character }, data: { activeCompanyId: co.id } });
    const nowMonth = monthOf(gameTimeAt(await settings.clock(), Date.now()).day);
    await prisma.employee.create({ data: { companyId: co.id, name: 'Vendeur', roleFr: 'Vendeur', roleEn: 'Seller', grossMonthly: 52_500, hiredDay: 0, hiredMonth: nowMonth, lastPaidMonth: nowMonth - 1 } });
    // Première passe : le compteur démarre ; on le recule de 2 séances (12 h de jeu)
    await svc.autoSalesTick();
    const clock = await settings.clock();
    const back = new Date(Date.now() - (12 * 60 * clock.secondsPerGameDay * 1000) / 1440 - 1000);
    await prisma.company.update({ where: { id: co.id }, data: { lastAutoSaleAt: back } });
    const before = await balance(boss.wallet);
    await svc.autoSalesTick();
    // 2 séances × 1 salarié × 3 000 × 35 % = 2 100
    expect((await balance(boss.wallet)) - before).toBe(2_100n);
    const after = await prisma.company.findUniqueOrThrow({ where: { id: co.id } });
    expect(after.pendingRevenue).toBe(6_300n);
    // Pas de double paiement tout de suite
    await svc.autoSalesTick();
    expect((await balance(boss.wallet)) - before).toBe(2_100n);
    // Fermer exige d'être à jour : un salarié en retard de paie bloque la fermeture
    await prisma.employee.updateMany({ where: { companyId: co.id }, data: { lastPaidMonth: nowMonth - 3 } });
    await expect(svc.close(boss.account, co.id)).rejects.toThrow('pay_payroll_first');
    await prisma.employee.updateMany({ where: { companyId: co.id }, data: { active: false } });
    await prisma.company.update({ where: { id: co.id }, data: { status: 'CLOSED' } });
  });

  it('un salarié non payé depuis plus d\'un mois ne vend plus pour le patron', async () => {
    const co = await company('Boutique Z');
    const month = monthOf(gameTimeAt(await settings.clock(), Date.now()).day);
    await prisma.employee.create({ data: { companyId: co.id, name: 'Impayé', roleFr: 'Vendeur', roleEn: 'Seller', grossMonthly: 52_500, hiredDay: 0, hiredMonth: 0, lastPaidMonth: month - 4 } });
    await svc.autoSalesTick();
    const clock = await settings.clock();
    await prisma.company.update({ where: { id: co.id }, data: { lastAutoSaleAt: new Date(Date.now() - (12 * 60 * clock.secondsPerGameDay * 1000) / 1440 - 1000) } });
    const before = await balance(boss.wallet);
    await svc.autoSalesTick();
    expect((await balance(boss.wallet)) - before).toBe(0n);
    await prisma.company.update({ where: { id: co.id }, data: { status: 'CLOSED' } });
  });

  it('le plafond d\'entreprises est respecté', async () => {
    const cfg = await settings.get('company.portfolio');
    const open = await prisma.company.count({ where: { characterId: boss.character, status: { not: 'CLOSED' } } });
    for (let i = open; i < cfg.maxCompanies; i++) await company(`Boutique P${i}`);
    await prisma.character.update({ where: { id: boss.character }, data: { locationId: 'cfe' } });
    const m = await ledger.systemWalletId(prisma, 'MARKET');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: m, to: boss.wallet, amount: 500_000n }] }));
    await expect(svc.create(boss.account, { form: 'EI', name: 'Trop', activityId: 'pagnes' })).rejects.toThrow('too_many_companies');
  });

  it('un DAT arrivé à échéance est versé automatiquement', async () => {
    const bank = new BankService(ledger, settings, new CharacterService(prisma, ledger, settings), prisma);
    const day = gameTimeAt(await settings.clock(), Date.now()).day;
    const bm = await ledger.systemWalletId(prisma, 'BANK');
    const m = await ledger.systemWalletId(prisma, 'MARKET');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: m, to: bm, amount: 100_000n }] }));
    const dep = await prisma.bankDeposit.create({ data: { characterId: boss.character, bankId: 'boa', kind: 'TERM', principal: 100_000n, yearBp: 600, startDay: day - 100, termDays: 30, lastAccruedDay: day - 100 } });
    const before = await balance(boss.wallet);
    expect(await bank.payMaturedTerms()).toBeGreaterThanOrEqual(1);
    expect((await balance(boss.wallet)) - before).toBeGreaterThanOrEqual(100_000n);
    expect((await prisma.bankDeposit.findUniqueOrThrow({ where: { id: dep.id } })).closedAt).not.toBeNull();
  });
});
