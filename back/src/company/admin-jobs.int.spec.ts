import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { CompanyService } from './company.service';
import { monthOf } from '../economy/company';
import { gameTimeAt } from '../economy/clock';

// Administration des emplois : métiers du catalogue (création, fiche, paie, lieu) et offres de joueurs (modifier, retirer).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Administration des emplois (PostgreSQL)', () => {
  let prisma: PrismaService;
  let settings: SettingsService;
  let svc: CompanyService;
  let chars: CharacterService;
  let actor: string;
  let offerId: string;
  const tag = Date.now().toString(36);
  const jobId = `test_${tag}`.slice(0, 32);
  const venueId = `lieu_${tag}`.slice(0, 32);

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const ledger = new LedgerService(prisma);
    settings = new SettingsService(prisma);
    chars = new CharacterService(prisma, ledger, settings);
    svc = new CompanyService(prisma, ledger, settings, chars);
    // Lieu de travail propre au test (la base de test n'est pas semée)
    await prisma.venue.create({ data: { id: venueId, nameFr: 'Lieu test', nameEn: 'Test place', emoji: '🏢', descFr: '', descEn: '', districtFr: '', districtEn: '', x: 0, z: 0 } as never });
    const acc = await prisma.account.create({ data: { email: `adm-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    actor = acc.id;
    const bossAcc = await prisma.account.create({ data: { email: `bossj-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({ data: { accountId: bossAcc.id, name: 'Patron', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', wallet: { create: {} } } });
    const co = await prisma.company.create({ data: { characterId: c.id, name: `Atelier ${tag}`, activityId: 'pagnes', form: 'EI', status: 'REGISTERED', readyAt: new Date(), createdMonth: monthOf(gameTimeAt(await settings.clock(), Date.now()).day) } });
    offerId = (await prisma.jobOffer.create({ data: { companyId: co.id, roleFr: 'Couturière', roleEn: 'Seamstress', grossMonthly: 60_000 } })).id;
  });

  afterAll(async () => {
    // Le métier de test ne doit pas rester au catalogue : il fausserait les tranches de salaire des autres tests
    await prisma?.job.deleteMany({ where: { id: jobId } });
    await prisma?.gameSetting.deleteMany({ where: { key: { in: ['work.places', 'study'] } } });
    await prisma?.$disconnect();
  });

  it('crée un métier au catalogue, avec son lieu de travail, puis le modifie', async () => {
    // Créé inactif : un métier actif entrerait dans le calcul des tranches de salaire des emplois publics (autres tests en parallèle)
    await svc.adminCreateJob(actor, { id: jobId, level: 'DEBROUILLE', nameFr: 'Testeur', nameEn: 'Tester', payPerShift: 2_500, energyCost: 10, hungerCost: 5, shiftGameHours: 4, venueId, enabled: false });
    await expect(svc.adminCreateJob(actor, { id: jobId, level: 'DEBROUILLE', nameFr: 'Doublon', nameEn: 'Dup', payPerShift: 1, energyCost: 1, hungerCost: 1, shiftGameHours: 1 })).rejects.toThrow('job_exists');
    let view = await svc.adminOffers();
    expect(view.catalog.find((j) => j.id === jobId)?.venueId).toBe(venueId);
    expect(view.offers.some((o) => o.id === `job:${jobId}`)).toBe(true);

    await svc.adminUpdateJob(actor, jobId, { payPerShift: 4_000, nameFr: 'Testeur senior', venueId: null });
    view = await svc.adminOffers();
    const j = view.catalog.find((x) => x.id === jobId)!;
    expect(j.payPerShift).toBe(4_000);
    expect(j.nameFr).toBe('Testeur senior');
    expect(j.enabled).toBe(false);
    expect(j.venueId).toBeNull();
    await svc.adminUpdateJob(actor, jobId, { enabled: false });
    await expect(svc.adminUpdateJob(actor, 'inconnu_xx', { payPerShift: 1 })).rejects.toThrow('unknown_job');
    await expect(svc.adminUpdateJob(actor, jobId, { venueId: 'lieu_inexistant' })).rejects.toThrow('unknown_venue');
    expect(await prisma.auditLog.count({ where: { action: 'admin.job_updated', target: jobId } })).toBe(0); // pas d'audit sans service d'audit injecté
  });

  it('règle les diplômes acceptés : plusieurs options (niveau + domaines), un seul suffit', async () => {
    await expect(svc.adminUpdateJob(actor, jobId, { reqs: [{ min: 'LICENCE', domains: ['domaine_inconnu'] }] })).rejects.toThrow('unknown_domain');
    await svc.adminUpdateJob(actor, jobId, { level: 'QUALIFIE', reqs: [{ min: 'LICENCE', domains: ['informatique', 'compta'] }, { min: 'BTS', domains: ['commerce'] }] });
    let view = await svc.adminOffers();
    expect(view.domains.some((x) => x.id === 'informatique')).toBe(true);
    expect(view.catalog.find((j) => j.id === jobId)?.reqs).toEqual([{ min: 'LICENCE', domains: ['informatique', 'compta'] }, { min: 'BTS', domains: ['commerce'] }]);
    // Sans domaine : tous les domaines sont acceptés pour cette option ; les doublons sont ignorés
    await svc.adminUpdateJob(actor, jobId, { reqs: [{ min: 'BTS', domains: [] }, { min: 'BTS' }] });
    view = await svc.adminOffers();
    expect(view.catalog.find((j) => j.id === jobId)?.reqs).toEqual([{ min: 'BTS' }]);
    await svc.adminUpdateJob(actor, jobId, { reqs: [] });
    view = await svc.adminOffers();
    expect(view.catalog.find((j) => j.id === jobId)?.reqs).toEqual([]);
  });

  it('côté joueur : un seul des diplômes listés suffit pour accéder au métier', async () => {
    await svc.adminUpdateJob(actor, jobId, { level: 'DIPLOME', reqs: [{ min: 'LICENCE', domains: ['informatique', 'compta'] }, { min: 'BTS', domains: ['commerce'] }] });
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    const player = async (name: string, diplomas: { kind: string; domain: string }[]) => {
      const acc = await prisma.account.create({ data: { email: `dip-${name}-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
      const c = await prisma.character.create({ data: { accountId: acc.id, name, profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', wallet: { create: {} } } });
      for (const d of diplomas) await prisma.diploma.create({ data: { characterId: c.id, kind: d.kind, domain: d.domain } });
      return c.id;
    };
    const can = (id: string) => prisma.$transaction((tx) => chars.qualifiedFor(tx, id, job));
    expect(await can(await player('A', [{ kind: 'LICENCE', domain: 'compta' }]))).toBe(true); // première option, 2e domaine
    expect(await can(await player('B', [{ kind: 'BTS', domain: 'commerce' }]))).toBe(true); // deuxième option
    expect(await can(await player('C', [{ kind: 'MASTER', domain: 'informatique' }]))).toBe(true); // niveau plus élevé
    expect(await can(await player('D', [{ kind: 'BTS', domain: 'informatique' }]))).toBe(false); // BTS ne vaut que pour le commerce
    expect(await can(await player('E', [{ kind: 'LICENCE', domain: 'btp' }]))).toBe(false); // mauvais domaine
    expect(await can(await player('F', []))).toBe(false);
  });

  it('modifie l\'offre d\'un joueur dans les bornes du jeu, puis la retire', async () => {
    const rates = await settings.get('payroll.rates');
    const cfg = await settings.get('company.playerJobs');
    await expect(svc.adminUpdateOffer(actor, offerId, { grossMonthly: rates.smig - 1 })).rejects.toThrow('salary_below_smig');
    await expect(svc.adminUpdateOffer(actor, offerId, { grossMonthly: cfg.maxGross + 1 })).rejects.toThrow('salary_too_high');
    await svc.adminUpdateOffer(actor, offerId, { grossMonthly: 70_000, roleFr: 'Cheffe d\'atelier' });
    const o = await prisma.jobOffer.findUniqueOrThrow({ where: { id: offerId } });
    expect(o.grossMonthly).toBe(70_000);
    expect(o.roleFr).toBe('Cheffe d\'atelier');
    await svc.adminDeleteOffer(actor, offerId);
    expect(await prisma.jobOffer.findUnique({ where: { id: offerId } })).toBeNull();
    await expect(svc.adminDeleteOffer(actor, offerId)).rejects.toThrow('unknown_offer');
  });

  it('une offre déjà pourvue ne se modifie ni ne se retire', async () => {
    const co = await prisma.company.findFirstOrThrow({ where: { name: `Atelier ${tag}` } });
    const filled = await prisma.jobOffer.create({ data: { companyId: co.id, roleFr: 'Pourvue', roleEn: 'Filled', grossMonthly: 60_000, open: false } });
    await expect(svc.adminUpdateOffer(actor, filled.id, { grossMonthly: 61_000 })).rejects.toThrow('offer_not_open');
    await expect(svc.adminDeleteOffer(actor, filled.id)).rejects.toThrow('offer_not_open');
  });
});
