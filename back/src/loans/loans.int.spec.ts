import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { LoansService } from './loans.module';

// Prêt bancaire personnel : octroi immédiat dans le plafond, refus au-delà ou si déjà ouvert, prélèvement
// automatique à échéance, retard + pénalité si solde insuffisant puis rattrapage, remboursement anticipé
// total (clôture, permet un nouveau prêt) et partiel (réduit le capital restant).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Prêt bancaire personnel (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let settings: SettingsService;
  let chars: CharacterService;
  let svc: LoansService;
  let seq = 0;

  async function makeCharacter() {
    seq += 1;
    const acc = await prisma.account.create({ data: { email: `loan-${Date.now().toString(36)}-${seq}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: `p${seq}`, profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', locationId: 'home', energy: 100, hunger: 100, morale: 50, respect: 10, wallet: { create: {} } },
      include: { wallet: true },
    });
    return { account: acc, character: c, walletId: c.wallet!.id };
  }

  const balance = async (walletId: string) => (await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    settings = new SettingsService(prisma);
    chars = new CharacterService(prisma, ledger, settings);
    svc = new LoansService(prisma, ledger, settings, chars);
    for (const code of ['TREASURY', 'BANK', 'MARKET'] as const) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
  });

  beforeEach(async () => {
    await prisma.gameSetting.upsert({
      where: { key: 'bank.loans' },
      // Réglages de test : petite durée pour accélérer les échéances, 4 mensualités sur 40 jours de jeu (10 j/mensualité)
      create: { key: 'bank.loans', value: { capAmount: 500_000, rateBp: 1_000, termDays: 40, installmentsCount: 4, lateFeeBpPerDay: 100 } },
      update: { value: { capAmount: 500_000, rateBp: 1_000, termDays: 40, installmentsCount: 4, lateFeeBpPerDay: 100 } },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('octroi immédiat du montant demandé si dans le plafond, refus au-delà', async () => {
    const { account, walletId } = await makeCharacter();
    await expect(svc.request(account.id, 600_000)).rejects.toThrow('over_cap');
    const r = await svc.request(account.id, 200_000);
    expect(r.result.id).not.toBeNull();
    expect(await balance(walletId)).toBe(200_000n);
    const mine = await svc.mine(account.id);
    expect(mine.loan).toMatchObject({ principal: '200000', status: 'OPEN' });
  });

  it('refuse une nouvelle demande si un prêt est déjà ouvert', async () => {
    const { account } = await makeCharacter();
    await svc.request(account.id, 100_000);
    await expect(svc.request(account.id, 50_000)).rejects.toThrow('loan_already_open');
  });

  it('prélèvement automatique correct à échéance', async () => {
    const { account, walletId } = await makeCharacter();
    const r = await svc.request(account.id, 200_000);
    const loanId = r.result.id!;
    const loan = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } });
    // total = 200000 + intérêt simple (10 %/an, 40 j/360) = 200000 + 2222 = 202222 ; /4 mensualités, arrondi sup
    expect(loan.installmentAmount).toBe(50_556n);

    // Échéance pas encore due : rien ne se passe
    await svc.collectDue();
    expect(await balance(walletId)).toBe(200_000n);

    // Échéance atteinte : prélèvement de la mensualité
    await prisma.loan.update({ where: { id: loanId }, data: { nextDueGameDay: -1000 } });
    await svc.collectDue();
    const after = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } });
    expect(after.remaining).toBe(loan.remaining - 50_556n);
    expect(await balance(walletId)).toBe(200_000n - 50_556n);
    expect(after.status).toBe('OPEN');
  });

  it('retard + pénalité si solde insuffisant, puis rattrapage au prochain passage', async () => {
    const { account, walletId } = await makeCharacter();
    // Fonds juste assez pour l'octroi, puis on vide le portefeuille pour simuler l'insuffisance
    const r = await svc.request(account.id, 200_000);
    const loanId = r.result.id!;
    const loan = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } });
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    // Vider le portefeuille (tout renvoyer vers MARKET)
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: walletId, to: market, amount: 200_000n }] }));
    expect(await balance(walletId)).toBe(0n);

    await prisma.loan.update({ where: { id: loanId }, data: { nextDueGameDay: -1000 } });
    await svc.collectDue();
    const late = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } });
    expect(late.status).toBe('LATE');
    expect(late.lateSinceGameDay).not.toBeNull();
    expect(late.remaining).toBe(loan.remaining); // rien prélevé

    // Le joueur reçoit de l'argent, mais pas encore assez : toujours en retard, nextDueGameDay inchangé
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: walletId, amount: 10_000n }] }));
    await svc.collectDue();
    const stillLate = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } });
    expect(stillLate.status).toBe('LATE');

    // Assez d'argent, et 5 jours de jeu de retard simulés : rattrapage avec pénalité de retard
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: walletId, amount: 100_000n }] }));
    await prisma.loan.update({ where: { id: loanId }, data: { lateSinceGameDay: stillLate.lateSinceGameDay! - 5 } });
    const before = await balance(walletId);
    await svc.collectDue();
    const caught = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } });
    expect(caught.status).toBe('OPEN');
    expect(caught.totalPenaltyPaid).toBeGreaterThan(0n);
    const base = loan.installmentAmount;
    const charged = before - (await balance(walletId));
    expect(charged).toBeGreaterThan(base); // mensualité + pénalité
    expect(caught.remaining).toBe(loan.remaining - base); // la pénalité ne réduit pas le capital restant
  });

  it('remboursement anticipé total clôture le prêt et permet d’en redemander un nouveau', async () => {
    const { account, walletId } = await makeCharacter();
    const r = await svc.request(account.id, 100_000);
    const loanId = r.result.id!;
    const loan = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } });
    // Le capital restant dû inclut les intérêts : on crédite la différence pour pouvoir tout rembourser d'un coup.
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    const shortfall = loan.remaining - (await balance(walletId));
    if (shortfall > 0n) await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: walletId, amount: shortfall }] }));
    const rep = await svc.repay(account.id, Number(loan.remaining));
    expect(rep.result.closed).toBe(true);
    const closed = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } });
    expect(closed.status).toBe('CLOSED');
    expect(closed.remaining).toBe(0n);
    expect(await balance(walletId)).toBe(0n);

    // Un nouveau prêt est maintenant possible
    const r2 = await svc.request(account.id, 50_000);
    expect(r2.result.id).not.toBeNull();
  });

  it('remboursement anticipé partiel réduit bien le capital restant', async () => {
    const { account } = await makeCharacter();
    const r = await svc.request(account.id, 150_000);
    const loanId = r.result.id!;
    const loan = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } });
    const rep = await svc.repay(account.id, 30_000);
    expect(rep.result.closed).toBe(false);
    expect(BigInt(rep.result.remaining)).toBe(loan.remaining - 30_000n);
    await expect(svc.repay(account.id, Number(loan.remaining))).rejects.toThrow('over_remaining');
  });

  it('adminList : liste les prêts (lecture seule) avec le joueur et la progression, sans les modifier', async () => {
    const { account, character } = await makeCharacter();
    const r = await svc.request(account.id, 120_000);
    const loanId = r.result.id!;

    const rows = await svc.adminList();
    const row = rows.find((x) => x.id === loanId);
    expect(row).toBeDefined();
    expect(row).toMatchObject({ character: character.name, principal: '120000', status: 'OPEN' });
    expect(typeof row!.remaining).toBe('string');
    expect(typeof row!.totalPenaltyPaid).toBe('string');

    // Purement consultatif : le prêt reste ouvert, rien n'a été prélevé par la lecture admin.
    const stillOpen = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } });
    expect(stillOpen.status).toBe('OPEN');
    expect(stillOpen.remaining).toBe(BigInt(row!.remaining));
  });
});
