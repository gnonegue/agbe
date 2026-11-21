import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { waterBill } from '../economy/utilities';
import { CharacterService } from './character.service';

// Factures du logement : montant décidé par le serveur, échéance repoussée d'un mois, eau coupée si impayée.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Factures CEET, TdE et wifi (PostgreSQL)', () => {
  let prisma: PrismaService;
  let chars: CharacterService;
  let accountId: string;
  let walletId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const ledger = new LedgerService(prisma);
    chars = new CharacterService(prisma, ledger, new SettingsService(prisma));
    for (const code of ['TREASURY', 'MARKET']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    const tag = Date.now().toString(36);
    const acc = await prisma.account.create({ data: { email: `bills-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'Locataire', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'CHAMBRE_SALON', locationId: 'home', wallet: { create: {} } },
      include: { wallet: true },
    });
    accountId = acc.id;
    walletId = c.wallet!.id;
    const treasury = await ledger.systemWalletId(prisma, 'TREASURY');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: treasury, to: walletId, amount: 100_000n }] }));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('refuse la douche tant que l’eau est impayée, puis la rétablit après paiement', async () => {
    await expect(chars.wash(accountId)).rejects.toThrow('water_cut');
    // Facture d'eau sans douche : abonnement + besoins du logement, au tarif de la tranche
    const w = await new SettingsService(prisma).get('bills.water');
    const expected = waterBill({ baseLitres: w.baseLitres.CHAMBRE_SALON, showers: 0, showerLitres: w.showerLitres, cookingLitres: 0 }, w.subscription.CHAMBRE_SALON, w.tranches).total;
    const res = await chars.payBill(accountId, 'WATER');
    expect(res.result.paid).toBe(expected);
    const s = await chars.state(accountId);
    expect(s.bills.WATER.overdue).toBe(false);
    expect(s.bills.ELEC.overdue).toBe(true);
    expect(s.bills.WIFI.active).toBe(false);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance).toBe(100_000n - BigInt(expected));
  });

  it('la douche ne se paie pas sur le moment : elle est comptée et facturée avec l’eau du mois', async () => {
    const settings = new SettingsService(prisma);
    const w = await settings.get('bills.water');
    const bill = (showers: number) => waterBill({ baseLitres: w.baseLitres.CHAMBRE_SALON, showers, showerLitres: w.showerLitres, cookingLitres: 0 }, w.subscription.CHAMBRE_SALON, w.tranches).total;
    const before = (await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance;
    expect((await chars.wash(accountId)).result).toMatchObject({ paid: 0 });
    await chars.wash(accountId);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance).toBe(before); // rien prélevé
    const s = await chars.state(accountId);
    expect(s.bills.WATER.usage!.showers).toBe(2);
    // Les douches font grimper la facture (litres au tarif des tranches)
    expect(bill(2)).toBeGreaterThan(bill(0));
    expect(BigInt(s.bills.WATER.due!)).toBe(BigInt(bill(2)));
    // Fin de mois : abonnement + consommation, puis le compteur repart à zéro
    const paid = await chars.payBill(accountId, 'WATER');
    expect(paid.result.paid).toBe(bill(2));
    expect((await chars.state(accountId)).bills.WATER.usage!.showers).toBe(0);
  });
});
