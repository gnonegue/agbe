import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { TendersService } from './tenders.module';
import { pickTenderContent } from '../economy/tenderContent';
import { gameTimeAt } from '../economy/clock';
import { monthOf } from '../economy/company';

// Marchés publics : candidature par enchère (prix ET délai proposés par le candidat, coût de réalisation connu
// avant de candidater), sélection par score prix bas + délai court, travail réel (advance()) qui débite le coût
// de chaque séance et paie le prix proposé (jamais le plafond) une fois le travail terminé, annulation ne paie
// personne.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

// Secteur de test : coût par séance et durée alignés sur `company.activities` par défaut pour 'pagnes'.
const SECTOR = 'pagnes';

d('Marchés publics (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let settings: SettingsService;
  let chars: CharacterService;
  let svc: TendersService;
  let seq = 0;
  let sectorCost = 0;
  let shiftGameHours = 0;

  async function makeCompany(sector: string, status: 'REGISTERED' | 'PENDING_CFE' = 'REGISTERED', fund = 0n) {
    seq += 1;
    const acc = await prisma.account.create({ data: { email: `tender-${Date.now().toString(36)}-${seq}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: `co${seq}`, profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'CHAMBRE_SALON', locationId: 'home', energy: 100, hunger: 100, morale: 50, respect: 10, wallet: { create: {} } },
      include: { wallet: true },
    });
    const createdMonth = monthOf(gameTimeAt(await settings.clock(), Date.now()).day);
    const co = await prisma.company.create({ data: { characterId: c.id, name: `Co${seq}`, activityId: sector, form: 'EI', status, readyAt: new Date(), createdMonth } });
    if (fund > 0n) {
      await prisma.$transaction(async (tx) => {
        await ledger.post(tx, { kind: 'TEST_FUND', legs: [{ from: await ledger.systemWalletId(tx, 'TREASURY'), to: c.wallet!.id, amount: fund }] });
      });
    }
    return { account: acc, character: c, company: co, walletId: c.wallet!.id };
  }

  /** Ligne `PublicTender` de test : contenu (titre/description) rempli à partir du catalogue déterministe. */
  function tenderData(sector: string, extra: { slots: number; maxBudget: bigint; maxHours: number; requiredSessions: number; applicationDeadlineAt: Date }) {
    const content = pickTenderContent(sector, 0);
    return { sector, ...content, ...extra };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    settings = new SettingsService(prisma);
    await prisma.gameSetting.deleteMany({ where: { key: 'market.tenders' } });
    chars = new CharacterService(prisma, ledger, settings);
    svc = new TendersService(prisma, ledger, settings, chars);
    for (const code of ['TREASURY', 'MARKET'] as const) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    const act = (await settings.get('company.activities')).find((a) => a.id === SECTOR)!;
    sectorCost = act.cost;
    shiftGameHours = act.shiftGameHours;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('candidature hors secteur refusée', async () => {
    const { account } = await makeCompany(SECTOR);
    const t = await prisma.publicTender.create({ data: tenderData('maquis', { slots: 1, maxBudget: 100_000n, maxHours: 48, requiredSessions: 3, applicationDeadlineAt: new Date(Date.now() + 3_600_000) }) });
    await expect(svc.apply(account.id, t.id, 50_000, 24)).rejects.toThrow('wrong_sector');
  });

  it('un marché multi-domaines accepte les entreprises de chacun de ses domaines, refuse les autres', async () => {
    const t = await prisma.publicTender.create({ data: { ...tenderData('maquis', { slots: 2, maxBudget: 500_000n, maxHours: 240, requiredSessions: 2, applicationDeadlineAt: new Date(Date.now() + 3_600_000) }), sectors: [SECTOR, 'couture'] } });
    const inside = await makeCompany(SECTOR);
    const main = await makeCompany('maquis');
    const outside = await makeCompany('droit');
    const open = await svc.openForMe(inside.account.id);
    expect((open.tenders as { id: string; sectors: string[] }[]).find((x) => x.id === t.id)?.sectors).toEqual(['maquis', SECTOR, 'couture']);
    const ok = await svc.apply(inside.account.id, t.id, 100_000, 240);
    expect(ok.replay).toBe(false);
    await svc.apply(main.account.id, t.id, 100_000, 240);
    await expect(svc.apply(outside.account.id, t.id, 100_000, 240)).rejects.toThrow('wrong_sector');
  });

  it('prix proposé au-dessus du plafond refusé', async () => {
    const { account } = await makeCompany(SECTOR);
    const t = await prisma.publicTender.create({ data: tenderData(SECTOR, { slots: 1, maxBudget: 200_000n, maxHours: 96, requiredSessions: 3, applicationDeadlineAt: new Date(Date.now() + 3_600_000) }) });
    await expect(svc.apply(account.id, t.id, 300_000, 24)).rejects.toThrow('over_budget');
  });

  it('délai proposé sous le minimum physique (séances requises × durée d’une séance) refusé', async () => {
    const { account } = await makeCompany(SECTOR);
    const requiredSessions = 10;
    const t = await prisma.publicTender.create({ data: tenderData(SECTOR, { slots: 1, maxBudget: 200_000n, maxHours: 9_999, requiredSessions, applicationDeadlineAt: new Date(Date.now() + 3_600_000) }) });
    const minHours = requiredSessions * shiftGameHours;
    await expect(svc.apply(account.id, t.id, 50_000, minHours - 1)).rejects.toThrow('under_min_hours');
  });

  it('délai proposé au-dessus du délai max refusé', async () => {
    const { account } = await makeCompany(SECTOR);
    const t = await prisma.publicTender.create({ data: tenderData(SECTOR, { slots: 1, maxBudget: 200_000n, maxHours: 48, requiredSessions: 1, applicationDeadlineAt: new Date(Date.now() + 3_600_000) }) });
    await expect(svc.apply(account.id, t.id, 50_000, 72)).rejects.toThrow('over_delay');
  });

  it('sélectionne par score prix bas + délai court au-delà des places', async () => {
    const t = await prisma.publicTender.create({ data: tenderData(SECTOR, { slots: 1, maxBudget: 200_000n, maxHours: 96, requiredSessions: 1, applicationDeadlineAt: new Date(Date.now() + 3_600_000) }) });
    const worse = await makeCompany(SECTOR); // prix élevé, délai long : moins bon score
    const better = await makeCompany(SECTOR); // prix bas, délai court : meilleur score
    await svc.apply(worse.account.id, t.id, 190_000, 90);
    await svc.apply(better.account.id, t.id, 50_000, 10);

    await prisma.publicTender.update({ where: { id: t.id }, data: { applicationDeadlineAt: new Date(Date.now() - 1_000) } });
    await svc.closeExpired();

    const apps = await prisma.tenderApplication.findMany({ where: { tenderId: t.id } });
    const winner = apps.find((a) => a.companyId === better.company.id)!;
    const loser = apps.find((a) => a.companyId === worse.company.id)!;
    expect(winner.status).toBe('SELECTED');
    expect(loser.status).toBe('REJECTED');
    expect(winner.endsAt).not.toBeNull();
    expect((await prisma.publicTender.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('AWARDED');
  });

  it('advance() refusé si la cadence (durée d’une séance) n’est pas écoulée', async () => {
    const t = await prisma.publicTender.create({ data: tenderData(SECTOR, { slots: 1, maxBudget: 200_000n, maxHours: 96, requiredSessions: 2, applicationDeadlineAt: new Date(Date.now() + 3_600_000) }) });
    const a = await makeCompany(SECTOR, 'REGISTERED', 1_000_000n);
    const applied = await svc.apply(a.account.id, t.id, 100_000, 2 * shiftGameHours);
    await prisma.publicTender.update({ where: { id: t.id }, data: { applicationDeadlineAt: new Date(Date.now() - 1_000) } });
    await svc.closeExpired();

    // Premier appel immédiatement après la sélection : la cadence (shiftGameHours) n'est pas écoulée.
    await expect(svc.advance(a.account.id, applied.id)).rejects.toThrow('still_working');
  });

  it('advance() refusé proprement si le solde est insuffisant, sans qu’aucun argent ne bouge', async () => {
    const t = await prisma.publicTender.create({ data: tenderData(SECTOR, { slots: 1, maxBudget: 200_000n, maxHours: 96, requiredSessions: 1, applicationDeadlineAt: new Date(Date.now() + 3_600_000) }) });
    const a = await makeCompany(SECTOR, 'REGISTERED', 0n); // aucun fonds
    const applied = await svc.apply(a.account.id, t.id, 150_000, shiftGameHours);
    await prisma.publicTender.update({ where: { id: t.id }, data: { applicationDeadlineAt: new Date(Date.now() - 1_000) } });
    await svc.closeExpired();
    // Recule artificiellement l'horodatage de sélection pour passer la cadence.
    await prisma.tenderApplication.update({ where: { id: applied.id }, data: { startedAt: new Date(0), lastAdvancedAt: new Date(0) } });

    await expect(svc.advance(a.account.id, applied.id)).rejects.toThrow('insufficient_funds');
    const balance = await prisma.wallet.findUniqueOrThrow({ where: { id: a.walletId } });
    expect(balance.balance).toBe(0n);
    const app = await prisma.tenderApplication.findUniqueOrThrow({ where: { id: applied.id } });
    expect(app.sessionsCompleted).toBe(0);
    expect(app.status).toBe('SELECTED');
  });

  it('advance() débite le coût de la séance à chaque appel réussi, et le dernier appel qui complète le travail paie le PRIX PROPOSÉ (pas maxBudget) dans la même opération', async () => {
    const requiredSessions = 2;
    const proposedPrice = 77_000; // délibérément différent de maxBudget pour vérifier qu'on ne paie jamais le plafond
    const t = await prisma.publicTender.create({ data: tenderData(SECTOR, { slots: 1, maxBudget: 200_000n, maxHours: 96, requiredSessions, applicationDeadlineAt: new Date(Date.now() + 3_600_000) }) });
    const fund = BigInt(sectorCost) * BigInt(requiredSessions) + 10_000n;
    const a = await makeCompany(SECTOR, 'REGISTERED', fund);
    const applied = await svc.apply(a.account.id, t.id, proposedPrice, requiredSessions * shiftGameHours);
    await prisma.publicTender.update({ where: { id: t.id }, data: { applicationDeadlineAt: new Date(Date.now() - 1_000) } });
    await svc.closeExpired();
    await prisma.tenderApplication.update({ where: { id: applied.id }, data: { startedAt: new Date(0), lastAdvancedAt: new Date(0) } });

    // Première séance : débite le coût, ne paie rien (travail pas terminé).
    const r1 = await svc.advance(a.account.id, applied.id);
    expect((r1.result as { sessionsCompleted: number }).sessionsCompleted).toBe(1);
    expect((r1.result as { paid: boolean }).paid).toBe(false);
    const balanceAfter1 = await prisma.wallet.findUniqueOrThrow({ where: { id: a.walletId } });
    expect(balanceAfter1.balance).toBe(fund - BigInt(sectorCost));

    // Deuxième (dernière) séance : débite le coût ET paie le prix proposé, dans le même appel.
    await prisma.tenderApplication.update({ where: { id: applied.id }, data: { lastAdvancedAt: new Date(0) } });
    const r2 = await svc.advance(a.account.id, applied.id);
    expect((r2.result as { sessionsCompleted: number }).sessionsCompleted).toBe(2);
    expect((r2.result as { paid: boolean }).paid).toBe(true);
    const balanceAfter2 = await prisma.wallet.findUniqueOrThrow({ where: { id: a.walletId } });
    expect(balanceAfter2.balance).toBe(fund - BigInt(sectorCost) * 2n + BigInt(proposedPrice));

    const app = await prisma.tenderApplication.findUniqueOrThrow({ where: { id: applied.id } });
    expect(app.status).toBe('PAID');
    expect(app.paidAt).not.toBeNull();
    expect(app.sessionsCompleted).toBe(requiredSessions);
  });

  it('un marché annulé ne paie personne', async () => {
    const t = await prisma.publicTender.create({ data: tenderData(SECTOR, { slots: 1, maxBudget: 200_000n, maxHours: 96, requiredSessions: 1, applicationDeadlineAt: new Date(Date.now() + 3_600_000) }) });
    const a = await makeCompany(SECTOR);
    await svc.apply(a.account.id, t.id, 100_000, shiftGameHours);
    await svc.adminCancel(t.id);
    expect((await prisma.publicTender.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('CANCELLED');

    await prisma.publicTender.update({ where: { id: t.id }, data: { applicationDeadlineAt: new Date(Date.now() - 1_000) } });
    await svc.closeExpired();
    const balance = await prisma.wallet.findUniqueOrThrow({ where: { id: a.walletId } });
    expect(balance.balance).toBe(0n);
    const app = await prisma.tenderApplication.findUniqueOrThrow({ where: { tenderId_companyId: { tenderId: t.id, companyId: a.company.id } } });
    expect(app.status).toBe('REJECTED');
  });

  it('candidater à nouveau après annulation d’un marché est refusé (annuler ne retire pas la candidature)', async () => {
    const t = await prisma.publicTender.create({ data: tenderData(SECTOR, { slots: 1, maxBudget: 200_000n, maxHours: 96, requiredSessions: 1, applicationDeadlineAt: new Date(Date.now() + 3_600_000) }) });
    const a = await makeCompany(SECTOR);
    await svc.apply(a.account.id, t.id, 100_000, shiftGameHours);
    await expect(svc.apply(a.account.id, t.id, 110_000, shiftGameHours)).rejects.toThrow('already_applied');
  });

  it('autoGenerate() tire aussi requiredSessions dans sessionsRange', async () => {
    await prisma.publicTender.deleteMany({});
    await svc.autoGenerate();
    const created = await prisma.publicTender.findFirstOrThrow({ where: { createdByAdminId: null }, orderBy: { createdAt: 'desc' } });
    const cfgTenders = await settings.get('market.tenders');
    expect(created.requiredSessions).toBeGreaterThanOrEqual(cfgTenders.sessionsRange[0]);
    expect(created.requiredSessions).toBeLessThanOrEqual(cfgTenders.sessionsRange[1]);
  });

  it('adminCreate() enregistre requiredSessions saisi par l’admin', async () => {
    const r = await svc.adminCreate('00000000-0000-4000-8000-000000000000', {
      sector: 'btp',
      titleFr: 'Réfection sur mesure',
      titleEn: 'Custom resurfacing',
      descriptionFr: 'Description de test rédigée par un admin.',
      descriptionEn: 'Test description written by an admin.',
      slots: 1,
      maxBudget: 100_000,
      maxHours: 24,
      requiredSessions: 7,
      applicationWindowGameHours: 24,
    });
    const t = await prisma.publicTender.findUniqueOrThrow({ where: { id: r.id } });
    expect(t.requiredSessions).toBe(7);
  });
});
