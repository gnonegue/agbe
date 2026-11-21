import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { IndustryService } from './industry.module';
import { CompanyService } from '../company/company.service';
import { gameTimeAt } from '../economy/clock';
import { accrueRange, breakdownDay, clearance, costSwingBp, dayFactorBp, equipmentPrice, maintenanceEffBp, utilityShare, netPerDay, accruedNet, dailyReturnBp } from '../economy/industry';
import { SETTING_DEFAULTS, SETTING_SCHEMAS } from '../settings/settings.service';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

describe('Industrie : calculs purs', () => {
  const plant = { price: 120_000_000, maxStaff: 40, wagePerStaff: 3_500, dailyRevenueBp: 60 };
  it('aucun salarié : aucun bénéfice ; plein effectif : chiffre d’affaires moins salaires', () => {
    expect(netPerDay(plant, 0)).toBe(0n);
    expect(netPerDay(plant, 40)).toBe(720_000n - 140_000n);
  });
  it('trop peu de ventes pour couvrir salaires et charges : le site perd de l’argent', () => {
    expect(netPerDay({ ...plant, wagePerStaff: 10_000_000 }, 10)).toBeLessThan(0n);
    // Sans personnel, les charges fixes courent quand même
    expect(netPerDay({ ...plant, fixedCostBp: 8 }, 0)).toBe(-96_000n);
  });
  it('aléas : bons et mauvais jours, incidents, mais un site complet reste rentable en moyenne', () => {
    const risk = SETTING_DEFAULTS.industry.risk!;
    const f = Array.from({ length: 400 }, (_, d) => dayFactorBp('site-test', d, risk));
    expect(f.some((x) => x === 0)).toBe(true); // incidents
    expect(f.some((x) => x > 0 && x < 8_000)).toBe(true); // mauvais jours
    expect(f.some((x) => x > 12_000)).toBe(true); // bons jours
    expect(f.every((x) => x === 0 || (x >= risk.swingMinBp && x <= risk.swingMaxBp))).toBe(true);
    const site = { ...plant, fixedCostBp: risk.fixedCostBp };
    const days = Array.from({ length: 400 }, (_, d) => accrueRange(site, 40, 0, 'site-test', d, d + 1, risk, 60).net);
    expect(days.some((n) => n < 0n)).toBe(true); // des jours à perte
    expect(days.reduce((a, b) => a + b, 0n)).toBeGreaterThan(0n); // bénéfice sur la durée
  });
  it('catalogue par défaut valide : usines, zones franches, cultures et élevages, tous rentables, avec un démarrage', () => {
    const cfg = SETTING_SCHEMAS.industry.parse(SETTING_DEFAULTS.industry);
    for (const k of ['FACTORY', 'FREE_ZONE', 'FARM', 'LIVESTOCK']) expect(cfg.plants.some((p) => p.kind === k)).toBe(true);
    for (const raw of cfg.plants) {
      // Avec les charges fixes et l'eau et l'électricité (proportionnelles à la production), un site complet reste rentable
      const p = { ...raw, fixedCostBp: cfg.risk.fixedCostBp, utilityBp: cfg.risk.waterBp[raw.kind] + cfg.risk.powerBp[raw.kind] };
      expect(netPerDay(p, p.maxStaff)).toBeGreaterThan(0n);
      // Intérêts entre 0,1 % et 1 % du prix par jour de jeu, à plein effectif
      expect(dailyReturnBp(p, p.maxStaff)).toBeGreaterThanOrEqual(10);
      expect(dailyReturnBp(p, p.maxStaff)).toBeLessThanOrEqual(100);
      expect(p.startupGameDays).toBeGreaterThan(0);
    }
  });
  it('surproduction : invendus en stock les jours de faible demande, écoulés les jours de forte demande, dépréciés', () => {
    const r = { swingMinBp: 10_000, swingMaxBp: 10_000, incidentBp: 0, demandMinBp: 7_000, demandMaxBp: 13_000 };
    const site = { ...plant, fixedCostBp: 0 };
    let stock = 0n;
    let grew = false;
    let shrank = false;
    for (let d = 0; d < 60; d++) {
      const out = accrueRange(site, 40, 0, 'site-surplus', d, d + 1, r, 60, stock, 0);
      if (out.stock > stock) grew = true;
      if (out.stock < stock) shrank = true;
      stock = out.stock;
    }
    expect(grew && shrank).toBe(true);
    // Produits frais : le stock perd de sa valeur chaque jour
    const kept = accrueRange(site, 0, 0, 'x', 0, 1, { ...r, demandMinBp: 10_000, demandMaxBp: 10_000 }, 60, 1_000_000n, 400);
    expect(kept.stock).toBe(960_000n);
    // Braderie : plus de remise, plus de marchandise écoulée
    expect(clearance(1_000_000n, 1_000)).toEqual({ sold: 250_000n, proceeds: 225_000n });
    expect(clearance(1_000_000n, 4_000)).toEqual({ sold: 1_000_000n, proceeds: 600_000n });
  });
  it('forage et solaire : moins d’eau mais plus d’électricité (pompe), solaire contre l’électricité ; entretien et pannes', () => {
    const cfg = { waterSaveBp: 8_000, pumpPowerBp: 3_000, powerSaveBp: 6_000 };
    const base = utilityShare({ waterBp: 350, powerBp: 150 }, { borehole: false, solar: false }, cfg);
    const bore = utilityShare({ waterBp: 350, powerBp: 150 }, { borehole: true, solar: false }, cfg);
    const both = utilityShare({ waterBp: 350, powerBp: 150 }, { borehole: true, solar: true }, cfg);
    expect(bore.waterBp).toBe(70);
    expect(bore.powerBp).toBe(150 + 84); // la pompe consomme
    expect(bore.totalBp).toBeLessThan(base.totalBp);
    expect(both.powerBp).toBeLessThan(bore.powerBp);
    // Équipement en panne : plus aucune économie
    expect(utilityShare({ waterBp: 350, powerBp: 150 }, { borehole: true, solar: false, boreholeEffBp: 0 }, cfg)).toEqual(base);
    // Entretien : à neuf jusqu'à l'échéance, moitié en retard, en panne au-delà du double
    expect([maintenanceEffBp(10, 30), maintenanceEffBp(45, 30), maintenanceEffBp(61, 30)]).toEqual([10_000, 5_000, 0]);
    // Le solaire coûte cher, et toujours plus que le minimum
    expect(equipmentPrice(120_000_000, 1_500, 15_000_000)).toBe(18_000_000n);
    expect(equipmentPrice(25_000_000, 1_500, 15_000_000)).toBe(15_000_000n);
    // Pannes : elles arrivent, plus souvent quand l'entretien est en retard
    let onTime = 0;
    let late = 0;
    for (let k = 0; k < 400; k++) {
      if (breakdownDay(`k${k}`, 'solar', 0, 30, 60, 100) !== null) onTime++;
      if (breakdownDay(`k${k}`, 'solar', 0, 90, 30, 100) !== null) late++;
    }
    expect(onTime).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(onTime);
    // Coûts d'entretien variables selon le site et le jour (entre −30 % et +30 %)
    const swings = Array.from({ length: 60 }, (_, d) => costSwingBp('site', 'solar:service', d));
    expect(Math.min(...swings)).toBeGreaterThanOrEqual(7_000);
    expect(Math.max(...swings)).toBeLessThanOrEqual(13_000);
    expect(new Set(swings).size).toBeGreaterThan(20);
  });
  it('bénéfice couru plafonné en jours', () => {
    expect(accruedNet(1_000n, 2.5, 60)).toBe(2_500n);
    expect(accruedNet(1_000n, 500, 60)).toBe(60_000n);
  });
});

d('Industrie (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let svc: IndustryService;
  const P: { account: string; character: string; wallet: string; company: string }[] = [];
  const balance = async (w: string) => (await prisma.wallet.findUniqueOrThrow({ where: { id: w } })).balance;
  async function player(tag: string, funds: bigint) {
    const acc = await prisma.account.create({ data: { email: `${tag}-${Date.now().toString(36)}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: tag, profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', locationId: 'home', wallet: { create: {} } },
      include: { wallet: true },
    });
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: c.wallet!.id, amount: funds }] }));
    // Un site s'achète au nom d'une entreprise immatriculée
    const co = await prisma.company.create({ data: { characterId: c.id, name: `Société ${tag}`, activityId: 'pagnes', form: 'SARL', status: 'REGISTERED', readyAt: new Date(), createdMonth: Math.floor(gameTimeAt(await new SettingsService(prisma).clock(), Date.now()).day / 30), lastDeclaredMonth: Math.floor(gameTimeAt(await new SettingsService(prisma).clock(), Date.now()).day / 30) - 1 } });
    P.push({ account: acc.id, character: c.id, wallet: c.wallet!.id, company: co.id });
  }

  /** Changement d'effectif (un seul par jour de jeu dans le jeu) : les tests en font plusieurs, on lève la limite avant chacun. */
  const setStaff = async (account: string, id: string, staff: number) => {
    await prisma.industryPlant.update({ where: { id }, data: { staffChangedDay: null } });
    return svc.setStaff(account, id, staff);
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    const settings = new SettingsService(prisma);
    svc = new IndustryService(prisma, ledger, settings, new CharacterService(prisma, ledger, settings));
    await prisma.industryPlant.deleteMany({});
    // Aléas désactivés pour les parcours (résultats reproductibles) ; ils ont leur propre test
    const calm = { ...SETTING_DEFAULTS.industry, risk: { swingMinBp: 10_000, swingMaxBp: 10_000, incidentBp: 0, fixedCostBp: 0, demandMinBp: 10_000, demandMaxBp: 10_000, spoilBp: { FACTORY: 0, FREE_ZONE: 0, FARM: 0, LIVESTOCK: 0 } } };
    await prisma.gameSetting.upsert({ where: { key: 'industry' }, create: { key: 'industry', value: calm }, update: { value: calm } });
    for (const code of ['MARKET', 'TREASURY']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    await player('patron', 500_000_000n);
    await player('rival', 500_000_000n);
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('achat d’une savonnerie : argent débité, double achat refusé, prix pas assez fort refusé', async () => {
    const before = await balance(P[0]!.wallet);
    // Sans entreprise immatriculée à soi : refusé
    await expect(svc.buy(P[0]!.account, P[1]!.company, 'savonnerie', 0)).rejects.toThrow('no_company');
    const r = (await svc.buy(P[0]!.account, P[0]!.company, 'savonnerie', 0)).result;
    expect(r.paid).toBe('120000000');
    // Prix du site seulement : l'entreprise est déjà immatriculée au CFE
    expect(before - (await balance(P[0]!.wallet))).toBe(120_000_000n);
    expect((await prisma.industryPlant.findFirstOrThrow({ where: { catalogId: 'savonnerie', unit: 0 } })).companyId).toBe(P[0]!.company);
    await expect(svc.buy(P[1]!.account, P[1]!.company, 'savonnerie', 0)).rejects.toThrow('plant_taken');
    await expect(svc.buy(P[1]!.account, P[1]!.company, 'raffinerie', 0)).rejects.toThrow();
  });

  it('créer son propre site : moins cher qu’un rachat, construction plus longue, numéro suivant', async () => {
    const before = await balance(P[1]!.wallet);
    await expect(svc.build(P[1]!.account, P[0]!.company, 'porcherie')).rejects.toThrow('no_company');
    const a = (await svc.build(P[1]!.account, P[1]!.company, 'porcherie')).result;
    const b = (await svc.build(P[1]!.account, P[1]!.company, 'porcherie')).result;
    const units = SETTING_DEFAULTS.industry.plants.find((x) => x.id === 'porcherie')!.units;
    expect([a.unit, b.unit]).toEqual([units, units + 1]);
    expect(a.paid).toBe(String((80_000_000 * 8_000) / 10_000));
    expect(before - (await balance(P[1]!.wallet))).toBe(BigInt(a.paid!) * 2n);
    // Construction : bien plus longue que le démarrage d'un site racheté
    const ready = new Date(a.readyAt!).getTime() - Date.now();
    expect(ready).toBeGreaterThan(20 * 3_600_000);
    await prisma.industryPlant.deleteMany({ where: { id: { in: [a.id!, b.id!] } } });
  });

  it('employés, bénéfice accumulé, encaissement', async () => {
    const id = (await svc.view(P[0]!.account)).mine[0]!.id;
    await expect(setStaff(P[0]!.account, id, 999)).rejects.toThrow('staff_over_capacity');
    await setStaff(P[0]!.account, id, 40);
    // Démarrage : rien à encaisser avant la mise en service
    const starting = (await svc.view(P[0]!.account)).mine[0]!;
    expect(starting.readyAt).not.toBeNull();
    expect(starting.pending).toBe('0');
    expect((await svc.collect(P[0]!.account, id)).result.received).toBe('0');
    // Mise en service, puis une journée de jeu s'est écoulée
    await prisma.industryPlant.update({ where: { id }, data: { readyAt: new Date(Date.now() - 3_600_000 * 2) } });
    await prisma.industryPlant.update({ where: { id }, data: { accruedAt: new Date(Date.now() - 24 * 3600 * 1000 / 24 * 24) } });
    const v = (await svc.view(P[0]!.account)).mine[0]!;
    // Salariés au coût réel (salaire + CNSS + AMU patronales) : moins que l'ancien calcul sans cotisations
    expect(BigInt(v.netPerDay)).toBeGreaterThan(0n);
    expect(BigInt(v.netPerDay)).toBeLessThan(580_000n);
    const b = await balance(P[0]!.wallet);
    const got = (await svc.collect(P[0]!.account, id)).result;
    expect(BigInt(got.received)).toBeGreaterThan(0n);
    expect((await balance(P[0]!.wallet)) - b).toBe(BigInt(got.received));
  });

  it('investisseur PNJ : paie la part, prend sa part des bénéfices, rachat possible', async () => {
    const id = (await svc.view(P[0]!.account)).mine[0]!.id;
    const offers = (await svc.view(P[0]!.account)).mine[0]!.offers;
    expect(offers.length).toBeGreaterThan(0);
    const inv = offers.find((o) => o.id === 'aboubakar')!;
    await expect(svc.sellStake(P[0]!.account, id, 'aboubakar', 9_000)).rejects.toThrow('share_too_high');
    await expect(svc.sellStake(P[0]!.account, id, 'milliardaire_asie', 3_000)).rejects.toThrow('unknown_investor');
    const b = await balance(P[0]!.wallet);
    const s = (await svc.sellStake(P[0]!.account, id, 'aboubakar', 3_000)).result;
    expect(BigInt(s.received)).toBe((BigInt(inv.valuation) * 3_000n) / 10_000n);
    // Le propriétaire reçoit la part vendue, plus le petit bénéfice couru jusque-là (versé avant l'entrée de l'investisseur)
    const gain = (await balance(P[0]!.wallet)) - b;
    expect(gain).toBeGreaterThanOrEqual(BigInt(s.received));
    expect(gain - BigInt(s.received)).toBeLessThan(100_000n);
    await expect(svc.sellStake(P[0]!.account, id, 'aboubakar', 1_000)).rejects.toThrow('has_investor');
    await prisma.industryPlant.update({ where: { id }, data: { accruedAt: new Date(Date.now() - 3_600_000) } });
    const c = (await svc.collect(P[0]!.account, id)).result;
    expect(BigInt(c.investorShare)).toBeGreaterThan(0n);
    expect(BigInt(c.received)).toBeGreaterThan(BigInt(c.investorShare));
    const bb = (await svc.buyBack(P[0]!.account, id)).result;
    expect(BigInt(bb.paid)).toBeGreaterThan(BigInt(s.received));
    expect((await prisma.industryPlant.findUniqueOrThrow({ where: { id } })).investorId).toBeNull();
  });

  it('impôt : le chiffre d’affaires du site va à son entreprise (déclaration OTR de l’entreprise) ; ancien impôt du site et rattachement', async () => {
    const id = (await svc.view(P[0]!.account)).mine[0]!.id;
    const rev0 = (await prisma.company.findUniqueOrThrow({ where: { id: P[0]!.company } })).pendingPlantRevenue;
    await prisma.industryPlant.update({ where: { id }, data: { accruedAt: new Date(Date.now() - 3_600_000), taxDue: 0n, taxSince: null } });
    await svc.collect(P[0]!.account, id);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: P[0]!.company } })).pendingPlantRevenue).toBeGreaterThan(rev0);
    expect((await prisma.industryPlant.findUniqueOrThrow({ where: { id } })).taxDue).toBe(0n);
    // Ancien impôt propre au site (avant la règle) en retard : encaissement, investisseur et vente bloqués jusqu'au paiement à l'OTR
    await prisma.industryPlant.update({ where: { id }, data: { taxDue: 50_000n, taxSince: new Date(Date.now() - 60 * 3_600_000) } });
    await expect(svc.collect(P[0]!.account, id)).rejects.toThrow('plant_tax_overdue');
    await expect(svc.sellStake(P[0]!.account, id, 'aboubakar', 1_000)).rejects.toThrow('plant_tax_overdue');
    await expect(svc.list(P[0]!.account, id, 150_000_000)).rejects.toThrow('plant_tax_overdue');
    await expect(svc.declare(P[0]!.account)).rejects.toThrow('not_at_otr');
    await prisma.character.update({ where: { id: P[0]!.character }, data: { locationId: 'otr' } });
    const before = await balance(P[0]!.wallet);
    const d = (await svc.declare(P[0]!.account)).result;
    expect(BigInt(d.tax)).toBe(50_000n);
    expect(BigInt(d.penalty)).toBeGreaterThan(0n);
    expect(before - (await balance(P[0]!.wallet))).toBe(BigInt(d.tax) + BigInt(d.penalty));
    await prisma.character.update({ where: { id: P[0]!.character }, data: { locationId: 'home' } });
    // Site acheté avant la règle (sans entreprise) : rattachement obligatoire avant d'encaisser
    await prisma.industryPlant.update({ where: { id }, data: { companyId: null } });
    await expect(svc.collect(P[0]!.account, id)).rejects.toThrow('plant_needs_company');
    await expect(svc.attach(P[0]!.account, id, P[1]!.company)).rejects.toThrow('no_company');
    await svc.attach(P[0]!.account, id, P[0]!.company);
    await svc.collect(P[0]!.account, id);
  });

  it('joueurs salariés : offre, embauche, effectif, paie comme une entreprise, licenciement après paiement', async () => {
    const id = (await svc.view(P[0]!.account)).mine[0]!.id;
    // Comptes assez anciens pour un emploi entre joueurs (anti multi-comptes)
    await prisma.account.updateMany({ where: { id: { in: [P[0]!.account, P[1]!.account] } }, data: { createdAt: new Date(Date.now() - 30 * 24 * 3_600_000) } });
    await setStaff(P[0]!.account, id, 39);
    await expect(svc.postOffer(P[0]!.account, id, 'ouvrier', 500_000)).rejects.toThrow('salary_too_high');
    const o = (await svc.postOffer(P[0]!.account, id, 'ouvrier', 100_000)).result.offer;
    // 39 non-joueurs + 1 poste proposé = capacité (40) : pas de poste en plus
    await expect(svc.postOffer(P[0]!.account, id, 'ouvrier', 100_000)).rejects.toThrow('staff_over_capacity');
    const offers = await svc.openOffers(P[1]!.character);
    expect(offers.some((x) => x.id === `plant:${o}`)).toBe(true);
    expect(await svc.openOffers(P[0]!.character)).toEqual([]); // jamais ses propres offres
    const hired = await prisma.$transaction((tx) => svc.hire(tx, { id: P[1]!.character, name: 'rival' }, o));
    const mine = (await svc.view(P[0]!.account)).mine[0]!;
    expect(mine.players.length).toBe(1);
    // Le site tourne avec 39 + 1 : le joueur compte dans l'effectif
    await expect(setStaff(P[0]!.account, id, 40)).rejects.toThrow('staff_over_capacity');
    // Paie : deux mois clos dus
    const closed = Math.floor((await svc.view(P[0]!.account)).day / 30) - 1;
    await prisma.employee.update({ where: { id: hired.employee }, data: { lastPaidMonth: closed - 2 } });
    await expect(svc.fire(P[0]!.account, hired.employee)).rejects.toThrow('pay_before_firing');
    // Pas de vente tant que des salaires sont dus (la dette ne passe jamais à l'acheteur)
    await expect(svc.list(P[0]!.account, id, 150_000_000)).rejects.toThrow('wages_due');
    const before = await balance(P[1]!.wallet);
    const pay = (await svc.payroll(P[0]!.account)).result;
    expect(pay.months).toBe(2);
    expect((await balance(P[1]!.wallet)) - before).toBe(BigInt(pay.net));
    expect(BigInt(pay.social)).toBeGreaterThan(0n);
    await expect(svc.payroll(P[0]!.account)).rejects.toThrow('nothing_to_pay');
    // Le salarié du site ne compte pas dans les ventes automatiques de l'entreprise (pas de double revenu)
    await prisma.company.update({ where: { id: P[0]!.company }, data: { lastAutoSaleAt: new Date(Date.now() - 48 * 3_600_000) } });
    const settings2 = new SettingsService(prisma);
    const companies = new CompanyService(prisma, ledger, settings2, new CharacterService(prisma, ledger, settings2));
    const sales0 = await prisma.ledgerTransaction.count({ where: { kind: 'SALES', memo: { contains: 'auto' } } });
    await companies.autoSalesTick();
    expect(await prisma.ledgerTransaction.count({ where: { kind: 'SALES', memo: { contains: 'auto' } } })).toBe(sales0);
    await svc.fire(P[0]!.account, hired.employee);
    expect((await svc.view(P[0]!.account)).mine[0]!.players.length).toBe(0);
    await setStaff(P[0]!.account, id, 40);
  });

  it('pertes : le propriétaire les couvre de sa poche, et le site ne se vend pas tant qu’elles ne sont pas couvertes', async () => {
    const id = (await svc.view(P[0]!.account)).mine[0]!.id;
    await prisma.industryPlant.update({ where: { id }, data: { pending: -1_000_000n, accruedAt: new Date(), taxDue: 0n, taxSince: null } });
    await expect(svc.list(P[0]!.account, id, 150_000_000)).rejects.toThrow('losses_to_cover');
    const before = await balance(P[0]!.wallet);
    const c = (await svc.collect(P[0]!.account, id)).result;
    expect(BigInt(c.received)).toBeLessThan(0n);
    expect((await balance(P[0]!.wallet)) - before).toBe(BigInt(c.received));
    expect((await prisma.industryPlant.findUniqueOrThrow({ where: { id } })).pending).toBe(0n);
  });

  it('braderie : le stock invendu se vend avec une remise, le produit entre dans le résultat (et l’impôt OTR)', async () => {
    const id = (await svc.view(P[0]!.account)).mine[0]!.id;
    await prisma.industryPlant.update({ where: { id }, data: { stockValue: 1_000_000n, pending: 0n, accruedAt: new Date(), taxDue: 0n, taxSince: null } });
    await expect(svc.clearStock(P[0]!.account, id, 500)).rejects.toThrow();
    const r = (await svc.clearStock(P[0]!.account, id, 2_000)).result;
    expect(r).toMatchObject({ sold: '500000', proceeds: '400000' });
    const row = await prisma.industryPlant.findUniqueOrThrow({ where: { id } });
    expect(row.stockValue).toBe(500_000n);
    expect(row.pending).toBe(400_000n);
    expect(row.taxDue).toBeGreaterThan(0n);
    await prisma.industryPlant.update({ where: { id }, data: { stockValue: 0n, pending: 0n, taxDue: 0n, taxSince: null } });
  });

  it('effectif : un changement par jour de jeu ; les calculs rapprochés ne font perdre ni pertes ni impôt', async () => {
    const id = (await svc.view(P[0]!.account)).mine[0]!.id;
    await setStaff(P[0]!.account, id, 30);
    await expect(svc.setStaff(P[0]!.account, id, 20)).rejects.toThrow('staff_changed_today');
    await expect(setStaff(P[0]!.account, id, 30)).rejects.toThrow('staff_unchanged');
    // Plusieurs encaissements à la suite : le compteur n'avance que du temps compté, jamais au-delà de maintenant
    const before = (await prisma.industryPlant.findUniqueOrThrow({ where: { id } })).accruedAt.getTime();
    for (let i = 0; i < 3; i++) await svc.collect(P[0]!.account, id);
    const after = (await prisma.industryPlant.findUniqueOrThrow({ where: { id } })).accruedAt.getTime();
    expect(after).toBeGreaterThanOrEqual(before);
    expect(after).toBeLessThanOrEqual(Date.now());
    await setStaff(P[0]!.account, id, 40);
  });

  it('équipements : forage et solaire payés selon la taille du site, puis entretien', async () => {
    const id = (await svc.view(P[0]!.account)).mine[0]!.id;
    const before = await balance(P[0]!.wallet);
    const eq = (await svc.view(P[0]!.account)).mine[0]!.equipment;
    const s = (await svc.equip(P[0]!.account, id, 'solar')).result;
    expect(s.paid).toBe(eq.solarPrice);
    await expect(svc.equip(P[0]!.account, id, 'solar')).rejects.toThrow('already_equipped');
    await svc.equip(P[0]!.account, id, 'borehole');
    expect(before - (await balance(P[0]!.wallet))).toBe(BigInt(eq.solarPrice) + BigInt(eq.boreholePrice));
    const after = (await svc.view(P[0]!.account)).mine[0]!.equipment;
    expect(after.solar && after.borehole).toBe(true);
    // Entretien en retard : l'efficacité baisse, l'entretien la rétablit
    await prisma.industryPlant.update({ where: { id }, data: { solarServicedAt: new Date(Date.now() - 90 * 3_600_000) } });
    expect((await svc.view(P[0]!.account)).mine[0]!.equipment.solarEffBp).toBeLessThan(10_000);
    // Le prix affiché (variable selon le jour) est exactement celui facturé
    const shown = (await svc.view(P[0]!.account)).mine[0]!.equipment;
    const done = (await svc.service(P[0]!.account, id, 'solar')).result;
    expect(done.paid).toBe(done.repaired ? shown.solarRepair : shown.solarService);
    const fixed = (await svc.view(P[0]!.account)).mine[0]!.equipment;
    expect(fixed.solarDueIn).toBeGreaterThan(50);
    await expect(svc.service(P[1]!.account, id, 'solar')).rejects.toThrow('unknown_plant');
  });

  it('revente à un autre joueur : prix, taxe, le site change de main', async () => {
    const id = (await svc.view(P[0]!.account)).mine[0]!.id;
    await expect(svc.list(P[0]!.account, id, 9_000_000_000)).rejects.toThrow('ask_too_high');
    // Impôt dû supérieur au prix demandé : vente refusée (la dette n'est jamais effacée par une vente à bas prix)
    await svc.list(P[0]!.account, id, 1_000);
    await prisma.industryPlant.update({ where: { id }, data: { taxDue: 5_000_000n, taxSince: new Date() } });
    await expect(svc.buyListing(P[1]!.account, id, P[1]!.company)).rejects.toThrow('plant_tax_exceeds_price');
    expect((await prisma.industryPlant.findUniqueOrThrow({ where: { id } })).taxDue).toBeGreaterThanOrEqual(5_000_000n);
    await svc.unlist(P[0]!.account, id);
    await prisma.industryPlant.update({ where: { id }, data: { taxDue: 0n, taxSince: null } });
    await svc.list(P[0]!.account, id, 150_000_000);
    await expect(svc.buyListing(P[0]!.account, id, P[0]!.company)).rejects.toThrow('own_plant');
    const seller = await balance(P[0]!.wallet);
    const buyer = await balance(P[1]!.wallet);
    await svc.buyListing(P[1]!.account, id, P[1]!.company);
    expect(buyer - (await balance(P[1]!.wallet))).toBe(150_000_000n + 4_500_000n);
    // Le vendeur touche le prix, moins l'impôt OTR qu'il devait encore (retenu et versé au Trésor)
    expect((await balance(P[0]!.wallet)) - seller).toBeGreaterThan(149_000_000n);
    expect((await prisma.industryPlant.findUniqueOrThrow({ where: { id } })).taxDue).toBe(0n);
    expect((await prisma.industryPlant.findUniqueOrThrow({ where: { id } })).characterId).toBe(P[1]!.character);
  });
});
