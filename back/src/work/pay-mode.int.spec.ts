import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { CompanyService } from '../company/company.service';
import { WorkService } from './work.service';

// Mode de paiement : à la tâche (payé à chaque service) ou salarié (embauche, services comptés, salaire mensuel) — base réelle.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Paiement à la tâche ou au mois (PostgreSQL)', () => {
  let prisma: PrismaService;
  let work: WorkService;
  let chars: CharacterService;
  let company: CompanyService;
  let accountId: string;
  let characterId: string;
  let walletId: string;
  const bal = async () => (await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance;
  const fresh = (place: string) => prisma.character.update({ where: { id: characterId }, data: { jobWorkedAt: {}, energy: 100, hunger: 100, hygiene: 100, health: 100, locationId: place } });
  const finish = (shift: string) => prisma.workShift.update({ where: { id: shift }, data: { closedAt: new Date() } });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const ledger = new LedgerService(prisma);
    const settings = new SettingsService(prisma);
    chars = new CharacterService(prisma, ledger, settings);
    work = new WorkService(prisma, ledger, settings, chars);
    company = new CompanyService(prisma, ledger, settings, chars);
    for (const code of ['TREASURY', 'MARKET', 'FEES', 'BANK']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    // Lieux de travail habituels des deux métiers (réglage work.places par défaut)
    for (const id of ['lavage_auto', 'boutique']) {
      await prisma.venue.upsert({ where: { id }, create: { id, emoji: '🏢', nameFr: id, nameEn: id, districtFr: '-', districtEn: '-', descFr: '-', descEn: '-', x: 0, z: 0 }, update: { enabled: true } });
    }
    // Un métier à la tâche (réglage par défaut) et un métier salarié (absent de la liste)
    await prisma.job.upsert({ where: { id: 'car_washer' }, create: { id: 'car_washer', level: 'DEBROUILLE', nameFr: 'Laveur', nameEn: 'Washer', payPerShift: 2_100, energyCost: 5, hungerCost: 5, shiftGameHours: 6 }, update: { enabled: true } });
    await prisma.job.upsert({ where: { id: 'shop_clerk' }, create: { id: 'shop_clerk', level: 'DEBROUILLE', nameFr: 'Vendeur', nameEn: 'Clerk', payPerShift: 2_600, energyCost: 5, hungerCost: 5, shiftGameHours: 6 }, update: { enabled: true } });
    await prisma.gameSetting.deleteMany({ where: { key: { in: ['work.places', 'jobs.taskPaid'] } } });
    const tag = Date.now().toString(36);
    const acc = await prisma.account.create({ data: { email: `pm-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'Travailleur', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'CHAMBRE_SALON', locationId: 'lavage_auto', energy: 100, wallet: { create: {} } },
      include: { wallet: true },
    });
    accountId = acc.id;
    characterId = c.id;
    walletId = c.wallet!.id;
  });

  afterAll(async () => {
    await prisma?.employee.deleteMany({ where: { characterId } });
    await prisma?.$disconnect();
  });

  it('le catalogue et les offres distinguent les deux modes', async () => {
    const board = await company.board(accountId);
    expect(board.some((o) => o.id === 'job:shop_clerk')).toBe(true);
    // Un métier à la tâche n'a pas d'employeur public
    expect(board.some((o) => o.id === 'job:car_washer')).toBe(false);
    await expect(company.acceptOffer(accountId, 'job:car_washer')).rejects.toThrow('unknown_offer');
  });

  it('à la tâche : on choisit le métier, chaque mission est payée tout de suite', async () => {
    await chars.takeJob(accountId, 'car_washer');
    await fresh('lavage_auto');
    const before = await bal();
    const shift = (await work.start(accountId, 'job')).result.shift;
    const s = await prisma.workShift.findUniqueOrThrow({ where: { id: shift } });
    const m = (s.orders as unknown as { id: string }[])[0]!;
    const r = await work.serve(accountId, shift, m.id, true);
    expect(r.result.paid).toBeGreaterThan(0);
    expect(await bal()).toBe(before + BigInt(r.result.paid));
    await finish(shift);
  });

  it('salarié : refusé sans embauche, puis le service n’est pas payé sur le moment mais compte pour le salaire', async () => {
    await expect(chars.takeJob(accountId, 'shop_clerk')).rejects.toThrow('job_needs_contract');
    await company.acceptOffer(accountId, 'job:shop_clerk');
    // Pas de paiement instantané non plus par l'ancienne action « travailler »
    await expect(chars.work(accountId)).rejects.toThrow('job_monthly');
    const me = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    expect(me.jobId).toBe('shop_clerk');
    await fresh('boutique');
    const before = await bal();
    const shift = (await work.start(accountId, 'job')).result.shift;
    const s = await prisma.workShift.findUniqueOrThrow({ where: { id: shift } });
    const m = (s.orders as unknown as { id: string }[])[0]!;
    expect((await work.serve(accountId, shift, m.id, true)).result.paid).toBe(0);
    expect(await bal()).toBe(before);
    await finish(shift);
    // Le service fait compte dans le décompte du salaire (voir emplois publics)
    expect(await prisma.workShift.count({ where: { characterId, sourceId: 'shop_clerk', closedAt: { not: null } } })).toBe(1);
  });

  it('démission : le métier salarié est libéré, il ne se reprend que par une nouvelle embauche, et on peut postuler ailleurs', async () => {
    await company.quit(accountId);
    // Le métier quitté ne reste plus occupé : le joueur retombe sur son autre métier
    const me = await prisma.character.findUniqueOrThrow({ where: { accountId } });
    expect(me.jobIds).not.toContain('shop_clerk');
    expect(me.jobId).not.toBe('shop_clerk');
    // Reprendre ce métier salarié exige un nouveau contrat
    await expect(chars.takeJob(accountId, 'shop_clerk')).rejects.toThrow('job_needs_contract');
    // Plus aucun emploi actif : une nouvelle candidature n'est plus refusée pour « déjà employé »
    expect(await prisma.employee.count({ where: { characterId: me.id, active: true } })).toBe(0);
  });
});
