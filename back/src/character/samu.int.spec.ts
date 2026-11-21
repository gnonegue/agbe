import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from './character.service';

// Urgence SAMU : appel quand la santé est basse, prise en charge à Dogta-Lafiè, sortie en forme, facture à régler.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('SAMU : urgence, hospitalisation et facture (PostgreSQL)', () => {
  let prisma: PrismaService;
  let chars: CharacterService;
  let accountId: string;
  let characterId: string;
  let walletId: string;
  const bal = async () => (await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const ledger = new LedgerService(prisma);
    chars = new CharacterService(prisma, ledger, new SettingsService(prisma));
    for (const code of ['TREASURY', 'MARKET']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    await prisma.venue.upsert({ where: { id: 'hopital_dogta' }, create: { id: 'hopital_dogta', emoji: '🏥', nameFr: 'Hôpital Dogta-Lafiè', nameEn: 'Dogta-Lafiè Hospital', districtFr: 'Agoè', districtEn: 'Agoè', descFr: '-', descEn: '-', x: 19, z: -398 }, update: { enabled: true } });
    const tag = Date.now().toString(36);
    const acc = await prisma.account.create({ data: { email: `samu-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'Patient', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'CHAMBRE_SALON', locationId: 'home', health: 20, energy: 10, hunger: 10, morale: 15, wallet: { create: {} } },
      include: { wallet: true },
    });
    accountId = acc.id;
    characterId = c.id;
    walletId = c.wallet!.id;
    const treasury = await ledger.systemWalletId(prisma, 'TREASURY');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: treasury, to: walletId, amount: 100_000n }] }));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('refuse l’appel quand on va bien, accepte quand la santé est basse', async () => {
    await prisma.character.update({ where: { id: characterId }, data: { health: 80 } });
    await expect(chars.callSamu(accountId)).rejects.toThrow('not_urgent');
    await prisma.character.update({ where: { id: characterId }, data: { health: 20 } });
    const r = await chars.callSamu(accountId);
    expect(r.result.hospital).toBe('hopital_dogta');
    expect(r.state.hospital).toMatchObject({ venueId: 'hopital_dogta' });
    expect(r.state.location).toBe('hopital_dogta');
    // Pendant la prise en charge, aucune action n'est possible
    await expect(chars.wash(accountId)).rejects.toThrow('in_hospital');
    await expect(chars.callSamu(accountId)).rejects.toThrow('in_hospital');
  });

  it('à la sortie : forces, énergie, faim et moral remontés, facture à régler, pas de nouvel appel tant qu’elle est impayée', async () => {
    await prisma.character.update({ where: { id: characterId }, data: { hospitalUntil: new Date(Date.now() - 1000) } });
    const s = await chars.state(accountId);
    expect(s.hospital).toBeNull();
    expect(s.needs).toMatchObject({ health: 80, energy: 80, hunger: 75, morale: 70 });
    expect(s.needs.hygiene).toBeGreaterThanOrEqual(70); // remontée seulement, jamais abaissée
    expect(s.medicalBill).toMatchObject({ amount: 15_000, fullAmount: 15_000, label: 'samu' });
    expect(s.samu.canCall).toBe(false);
    await prisma.character.update({ where: { id: characterId }, data: { health: 10 } });
    await expect(chars.callSamu(accountId)).rejects.toThrow('unpaid_bill');
  });

  it('la facture est prélevée une seule fois, puis le SAMU peut être rappelé', async () => {
    const before = await bal();
    const key = 'samuPayKey0000000001';
    const r = await chars.payMedicalBill(accountId, key);
    expect(r.result).toMatchObject({ paid: 15_000, covered: 0 });
    expect(await bal()).toBe(before - 15_000n);
    expect(r.state.medicalBill).toBeNull();
    // Même requête rejouée (réseau qui décroche) : reconnue, rien n'est prélevé une seconde fois
    expect((await chars.payMedicalBill(accountId, key)).result).toMatchObject({ replay: true });
    await expect(chars.payMedicalBill(accountId)).rejects.toThrow('no_bill');
    expect(await bal()).toBe(before - 15_000n);
  });

  it('avec l’AMU, la part prise en charge est déduite de la facture', async () => {
    await prisma.character.update({ where: { id: characterId }, data: { health: 15, amuPaidUntilGameDay: 1_000_000 } });
    await chars.callSamu(accountId);
    await prisma.character.update({ where: { id: characterId }, data: { hospitalUntil: new Date(Date.now() - 1000) } });
    const s = await chars.state(accountId);
    expect(s.medicalBill).toMatchObject({ amount: 3_000, fullAmount: 15_000 });
  });
});
