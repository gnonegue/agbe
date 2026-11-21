import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { gameTimeAt } from '../economy/clock';
import { CharacterService } from './character.service';

// Loyer impayé : pénalité, expulsion vers le logement inférieur avec dette, remboursement, déménagement avec caution.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Loyer en retard et expulsion (PostgreSQL)', () => {
  let prisma: PrismaService;
  let settings: SettingsService;
  let chars: CharacterService;
  let ledger: LedgerService;
  let today: number;

  async function tenant(paidUntil: number, funds: bigint) {
    const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const acc = await prisma.account.create({ data: { email: `rent-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'Locataire', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'MIDDLE', birthMode: 'FREE_CHOICE', housing: 'CHAMBRE_SALON', rentPaidUntilGameDay: paidUntil, rentNagDay: paidUntil, locationId: 'home', wallet: { create: {} } },
      include: { wallet: true },
    });
    const treasury = await ledger.systemWalletId(prisma, 'TREASURY');
    if (funds > 0n) await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: treasury, to: c.wallet!.id, amount: funds }] }));
    return { accountId: acc.id, walletId: c.wallet!.id };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    settings = new SettingsService(prisma);
    chars = new CharacterService(prisma, ledger, settings);
    for (const code of ['TREASURY', 'MARKET', 'LANDLORD']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    today = gameTimeAt(await settings.clock(), Date.now()).day;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('un mois de retard se paie majoré de la pénalité, sans effacer le retard', async () => {
    const { accountId } = await tenant(today - 5, 100_000n);
    const res = await chars.payRent(accountId);
    expect(res.result.paid).toBe(26_250); // 5 jours de retard : +5 %
    expect(res.state.rent.paidUntilGameDay).toBe(today + 25);
  });

  it('expulse après 3 mois, laisse une dette, puis permet de rembourser et de déménager', async () => {
    const { accountId, walletId } = await tenant(today - 95, 0n);
    const { state } = await chars.rest(accountId).catch(async () => ({ state: await chars.state(accountId) }));
    // La sieste lancée pour déclencher la mise à jour du loyer endort le personnage : on le réveille pour la suite du test
    await prisma.character.updateMany({ where: { accountId }, data: { sleepUntil: null } });
    expect(state.housing).toBe('ENTRER_COUCHER');
    expect(state.rent.debt).toBe(String(48_750 + 41_250 + 33_750 + 26_250)); // 4 mois dus, en retard de 95, 65, 35 et 5 jours
    await expect(chars.moveHousing(accountId, 'VILLA')).rejects.toThrow('rent_debt');
    const treasury = await ledger.systemWalletId(prisma, 'TREASURY');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: treasury, to: walletId, amount: 300_000n }] }));
    await chars.payRentDebt(accountId);
    const moved = await chars.moveHousing(accountId, 'CHAMBRE_SALON');
    expect(moved.result.paid).toBe(75_000);
    expect(moved.state.rent.deposit).toBe('50000');
    expect(moved.state.rent.overdue).toBe(false);
  });
});
