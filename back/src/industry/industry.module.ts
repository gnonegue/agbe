import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsIn, IsInt, IsString, IsUUID, Matches, Max, Min } from 'class-validator';
import { Prisma } from '@prisma/client';
import { AccountRequired, AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { createHmac, randomInt } from 'node:crypto';
import { LedgerService, type Tx } from '../ledger/ledger.service';
import { SettingsService, type SettingValue } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { gameHoursBetween, gameTimeAt, realMsAfterGameHours } from '../economy/clock';
import { accrueRange, breakdownDay, costSwingBp, clearance, dayFactorBp, demandBp, equipmentPrice, maintenanceEffBp, utilityShare, dailyReturnBp, investorCut, investorValuation, netPerDay, revenuePerDay, stakePrice, wagesPerDay } from '../economy/industry';
import { sha256Hex } from '../common/crypto';
import { computePayroll } from '../economy/payroll';
import { cfeFee, monthOf } from '../economy/company';
import { GAME_DAYS_PER_MONTH } from '../economy/clock';

type Cfg = SettingValue<'industry'>;
type PlantDef = Cfg['plants'][number];

class CompanyRefDto {
  /** Entreprise immatriculée du joueur qui détient le site. */
  @IsUUID('4')
  companyId: string;
}
class EquipDto {
  @IsIn(['borehole', 'solar'])
  kind: 'borehole' | 'solar';
}
class BuildDto {
  @IsUUID('4')
  companyId: string;

  @IsString()
  @Matches(/^[a-z0-9_]{2,32}$/)
  catalogId: string;
}
class BuyDto {
  @IsUUID('4')
  companyId: string;

  @IsString()
  @Matches(/^[a-z0-9_]{2,32}$/)
  catalogId: string;

  @IsInt()
  @Min(0)
  @Max(49)
  unit: number;
}
class StaffDto {
  @IsInt()
  @Min(0)
  @Max(5_000)
  staff: number;
}
class StakeDto {
  @IsString()
  @Matches(/^[a-z0-9_]{2,32}$/)
  investorId: string;

  /** Part du capital cédée, en points de base (500 = 5 %). */
  @IsInt()
  @Min(100)
  @Max(10_000)
  shareBp: number;
}
class ClearDto {
  /** Remise sur le prix normal, en points de base (1000 = 10 %), de 10 à 50 %. */
  @IsInt()
  @Min(1_000)
  @Max(5_000)
  discountBp: number;
}
class PlantOfferDto {
  @IsString()
  @Matches(/^[a-z0-9_]{2,32}$/)
  roleId: string;

  @IsInt()
  @Min(1)
  @Max(100_000_000)
  grossMonthly: number;
}
class AskDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000_000_000_000)
  ask: number;
}

function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

/**
 * Industrie : usines et zones franches à acheter par les gros joueurs. On emploie du personnel (salaires décidés par le serveur),
 * le site produit un bénéfice net par jour de jeu, on peut faire entrer un investisseur PNJ au capital (il touche sa part des bénéfices)
 * et revendre le site à un autre joueur. Le serveur décide de tout : le client n'envoie que des intentions.
 */
@Injectable()
export class IndustryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
  ) {}

  /**
   * Catalogue avec le vrai coût des salariés, comme dans une entreprise : salaire brut (`wagePerStaff` par jour × 30 = brut
   * mensuel) + cotisations patronales CNSS et AMU, ramené au jour. Le chiffre d'affaires reste celui du catalogue.
   */
  private async cfg(): Promise<Cfg> {
    this.clockCache = await this.settings.clock();
    const cfg = await this.settings.get('industry');
    const rates = await this.settings.get('payroll.rates');
    return { ...cfg, plants: cfg.plants.map((p) => ({ ...p, fixedCostBp: cfg.risk.fixedCostBp, utilityBp: cfg.risk.waterBp[p.kind] + cfg.risk.powerBp[p.kind], grossWage: p.wagePerStaff, wagePerStaff: Number(computePayroll(BigInt(p.wagePerStaff * GAME_DAYS_PER_MONTH), rates).employerCost / BigInt(GAME_DAYS_PER_MONTH)) })) };
  }

  /** Part de la production dépensée en eau et en électricité pour ce site, selon son type et ses équipements. */
  private utilOf(cfg: Cfg, def: PlantDef, p: { borehole: boolean; solar: boolean; boreholeServicedAt?: Date | null; solarServicedAt?: Date | null }) {
    const eff = this.effOf(cfg, p);
    return utilityShare(
      { waterBp: cfg.risk.waterBp[def.kind], powerBp: cfg.risk.powerBp[def.kind] },
      { borehole: p.borehole, solar: p.solar, boreholeEffBp: eff.borehole, solarEffBp: eff.solar },
      { waterSaveBp: cfg.equipment.borehole.waterSaveBp, pumpPowerBp: cfg.equipment.borehole.pumpPowerBp, powerSaveBp: cfg.equipment.solar.powerSaveBp },
    );
  }

  /**
   * Coût du jour d'un entretien ou d'une réparation : part du prix de l'équipement, qui varie selon le site et le jour
   * (pièces, main-d'œuvre, déplacement du technicien) entre −30 % et +30 %.
   */
  private upkeepCost(cfg: Cfg, d: PlantDef, plantId: string, kind: 'borehole' | 'solar', repair: boolean): bigint {
    const e = cfg.equipment[kind];
    const base = (equipmentPrice(d.price, e.priceBp, e.minPrice) * BigInt(repair ? e.repairBp : e.serviceBp)) / 10_000n;
    const day = this.clockCache ? this.dayAt(this.clockCache, Date.now()) : 0;
    return (base * BigInt(costSwingBp(this.riskKey(plantId), `${kind}:${repair ? 'repair' : 'service'}`, day))) / 10_000n;
  }

  /** Jours de jeu depuis le dernier entretien de chaque équipement, et efficacité qui en découle. */
  private clockCache: Awaited<ReturnType<SettingsService['clock']>> | null = null;
  private effOf(cfg: Cfg, p: { id?: string; boreholeServicedAt?: Date | null; solarServicedAt?: Date | null }) {
    const clock = this.clockCache;
    const days = (d?: Date | null) => (d && clock ? gameHoursBetween(clock, d.getTime(), Date.now()) / 24 : 0);
    // Panne survenue depuis le dernier entretien (tirage secret par site et par jour) : l'équipement ne sert plus jusqu'à la réparation
    const broken = (kind: 'borehole' | 'solar', d?: Date | null) => {
      if (!d || !clock || !p.id) return false;
      const since = this.dayAt(clock, d.getTime());
      const e = cfg.equipment[kind];
      return breakdownDay(this.riskKey(p.id), kind, since, this.dayAt(clock, Date.now()), e.serviceEveryDays, e.breakdownBp) !== null;
    };
    const bBroken = broken('borehole', p.boreholeServicedAt);
    const sBroken = broken('solar', p.solarServicedAt);
    return {
      boreholeDays: days(p.boreholeServicedAt),
      solarDays: days(p.solarServicedAt),
      boreholeBroken: bBroken,
      solarBroken: sBroken,
      borehole: bBroken ? 0 : maintenanceEffBp(days(p.boreholeServicedAt), cfg.equipment.borehole.serviceEveryDays),
      solar: sBroken ? 0 : maintenanceEffBp(days(p.solarServicedAt), cfg.equipment.solar.serviceEveryDays),
    };
  }

  private def(cfg: Cfg, id: string): PlantDef {
    const d = cfg.plants.find((p) => p.id === id);
    if (!d) throw new NotFoundException('unknown_plant');
    return d;
  }

  /**
   * Clé des tirages d'aléas d'un site : mêlée à un secret du serveur (jamais envoyé au client), pour que personne ne puisse
   * calculer à l'avance les bons et mauvais jours d'un site. Seuls les tirages du jour et de la veille sont montrés.
   */
  private riskKey(plantId: string): string {
    return createHmac('sha256', process.env.JWT_ACCESS_SECRET ?? '').update(`industry-risk|${plantId}`).digest('hex');
  }

  /** Jour de jeu (décimal) d'un instant réel : sert au calcul jour par jour des aléas. */
  private dayAt(clock: Awaited<ReturnType<SettingsService['clock']>>, ms: number): number {
    return gameHoursBetween(clock, clock.epochRealMs, ms) / 24;
  }

  private async today(): Promise<number> {
    return gameTimeAt(await this.settings.clock(), Date.now()).day;
  }

  private async lock(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "industry_plant" WHERE "id" = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException('unknown_plant');
    return tx.industryPlant.findUniqueOrThrow({ where: { id } });
  }

  /** Ajoute au « à encaisser » le bénéfice couru depuis le dernier calcul, avec le personnel actuel. À appeler avant tout changement. */
  private async settle(tx: Tx, p: { id: string; catalogId: string; staff: number; pending: bigint; accruedAt: Date; readyAt: Date | null; stockValue: bigint; borehole: boolean; solar: boolean; boreholeServicedAt: Date | null; solarServicedAt: Date | null }, cfg: Cfg): Promise<bigint> {
    const def = this.def(cfg, p.catalogId);
    // Pendant le démarrage, aucun intérêt : on compte à partir de la mise en service
    const from = Math.max(p.accruedAt.getTime(), p.readyAt?.getTime() ?? 0);
    const clock = await this.settings.clock();
    const now = Date.now();
    const players = await this.playersOn(tx, p.id);
    // Jour par jour : bons et mauvais jours, incidents, salaires et charges fixes ; le résultat peut être une perte
    const res = from < now ? accrueRange(def, p.staff, players, this.riskKey(p.id), this.dayAt(clock, from), this.dayAt(clock, now), cfg.risk, cfg.maxAccrualDays, p.stockValue, cfg.risk.spoilBp[def.kind], this.utilOf(cfg, def, p).totalBp) : { net: 0n, revenue: 0n, stock: p.stockValue, accountedDays: 0, utilities: 0n };
    const pending = p.pending + res.net;
    // Le compteur n'avance que du temps réellement compté (jamais d'arrondi qui effacerait pertes ou impôt)
    const accruedAt = from < now ? new Date(Math.min(now, Math.floor(realMsAfterGameHours(clock, from, res.accountedDays * 24)))) : p.accruedAt;
    // Impôt OTR sur le chiffre d'affaires de la période (même taux que pour une entreprise), à payer à l'OTR
    const otrBp = (await this.settings.get('company.contributions')).otrBp;
    const tax = (res.revenue * BigInt(otrBp)) / 10_000n;
    const owner = await tx.industryPlant.findUniqueOrThrow({ where: { id: p.id }, select: { taxSince: true, companyId: true } });
    // Site d'une entreprise : son chiffre d'affaires est déclaré avec l'entreprise à l'OTR (impôt OTR seulement)
    if (owner.companyId && res.revenue > 0n) await tx.company.update({ where: { id: owner.companyId }, data: { pendingPlantRevenue: { increment: res.revenue } } });
    const ownTax = !owner.companyId && tax > 0n;
    await tx.industryPlant.update({
      where: { id: p.id },
      data: { pending, stockValue: res.stock, accruedAt, ...(ownTax ? { taxDue: { increment: tax }, taxSince: owner.taxSince ?? new Date() } : {}) },
    });
    return pending;
  }

  /** Entreprise immatriculée (et non fermée) du joueur, à laquelle rattacher un site. */
  private async ownCompany(tx: Tx, characterId: string, companyId: string) {
    const co = await tx.company.findFirst({ where: { id: companyId, characterId }, select: { id: true, status: true } });
    if (!co || co.status === 'CLOSED') throw new NotFoundException('no_company');
    if (co.status !== 'REGISTERED') throw new BadRequestException('company_not_registered');
    return co.id;
  }

  /** Salaires de mois clos encore dus à un joueur salarié du site : pas de vente tant qu'ils ne sont pas payés. */
  private async wagesDue(tx: Tx, plantId: string): Promise<boolean> {
    const closed = monthOf(await this.today()) - 1;
    return (await tx.employee.count({ where: { plantId, active: true, lastPaidMonth: { lt: closed } } })) > 0;
  }

  /** Joueurs salariés en poste sur un site. */
  private playersOn(db: Tx | PrismaService, plantId: string): Promise<number> {
    return db.employee.count({ where: { plantId, active: true } });
  }

  private async paidOut(tx: Tx, walletId: string, pending: bigint, p: { id: string; investorBp: number }, memo: string) {
    if (pending === 0n) return 0n;
    // Part de l'investisseur éventuel, sur les bénéfices comme sur les pertes
    const toOwner = pending - investorCut(pending, p.investorBp);
    if (toOwner > 0n) await this.ledger.post(tx, { kind: 'PLANT_YIELD', memo, legs: [{ from: await this.ledger.systemWalletId(tx, 'MARKET'), to: walletId, amount: toOwner }] });
    // Pertes : le propriétaire les couvre de sa poche (fonds insuffisants = action refusée)
    if (toOwner < 0n) await this.ledger.post(tx, { kind: 'PLANT_LOSS', memo, legs: [{ from: walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: -toOwner }] });
    return toOwner;
  }

  /** Catalogue (état de chaque exemplaire), mes sites et les offres du jour des investisseurs. */
  async view(accountId: string) {
    const me = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
    if (!me) throw new NotFoundException('no_character');
    const cfg = await this.cfg();
    const day = await this.today();
    const rows = await this.prisma.industryPlant.findMany();
    const clock = await this.settings.clock();
    const now = Date.now();
    const contrib = await this.settings.get('company.contributions');
    const cfe = await this.settings.get('company.cfe');
    const myIds = rows.filter((r) => r.characterId === me.id).map((r) => r.id);
    // Entreprises du joueur (un site s'achète au nom d'une entreprise immatriculée)
    const companies = await this.prisma.company.findMany({ where: { characterId: me.id, status: { not: 'CLOSED' } }, select: { id: true, name: true, status: true }, orderBy: { createdAt: 'asc' } });
    const employees = await this.prisma.employee.findMany({ where: { plantId: { in: myIds }, active: true }, orderBy: { hiredDay: 'asc' } });
    const offers = await this.prisma.plantJobOffer.findMany({ where: { plantId: { in: myIds }, open: true }, orderBy: { createdAt: 'desc' } });
    const bySlot = new Map(rows.map((r) => [`${r.catalogId}:${r.unit}`, r]));
    const sites = cfg.plants.map((d) => ({
      id: d.id,
      kind: d.kind,
      emoji: d.emoji,
      nameFr: d.nameFr,
      nameEn: d.nameEn,
      descFr: d.descFr,
      descEn: d.descEn,
      districtFr: d.districtFr,
      districtEn: d.districtEn,
      price: d.price.toString(),
      maxStaff: d.maxStaff,
      wagePerStaff: d.wagePerStaff,
      fullNetPerDay: netPerDay(d, d.maxStaff).toString(),
      // Intérêts : rendement net par jour à plein effectif (points de base du prix), après le démarrage
      fullReturnBp: dailyReturnBp(d, d.maxStaff),
      // Créer son propre site : prix et durée de construction
      buildPrice: ((BigInt(d.price) * BigInt(cfg.build.priceBp)) / 10_000n).toString(),
      buildDays: d.startupGameDays * cfg.build.startupMultiple,
      built: rows.filter((r) => r.catalogId === d.id && r.unit >= d.units).length,
      startupGameDays: d.startupGameDays,
      // Coût réel d'un salarié par jour (salaire + CNSS + AMU patronales) et salaire brut
      staffCostPerDay: d.wagePerStaff,
      grossWagePerDay: (d as PlantDef & { grossWage?: number }).grossWage ?? d.wagePerStaff,
      units: Array.from({ length: d.units }, (_, unit) => {
        const r = bySlot.get(`${d.id}:${unit}`);
        if (!r) return { unit, status: 'FREE' as const, price: d.price.toString(), plantId: null as string | null, ask: null as string | null };
        return { unit, status: r.characterId === me.id ? ('MINE' as const) : r.askPrice !== null ? ('LISTED' as const) : ('TAKEN' as const), price: d.price.toString(), plantId: r.characterId === me.id || r.askPrice !== null ? r.id : null, ask: r.askPrice !== null ? r.askPrice.toString() : null };
      }),
    }));
    const mine = rows
      .filter((r) => r.characterId === me.id)
      .map((r) => {
        const d = this.def(cfg, r.catalogId);
        const staffRows = employees.filter((e) => e.plantId === r.id);
        const players = staffRows.length;
        // Eau et électricité selon les équipements du site
        const util = this.utilOf(cfg, d, r);
        const net = netPerDay({ ...d, utilityBp: util.totalBp }, r.staff, players);
        const from = Math.max(r.accruedAt.getTime(), r.readyAt?.getTime() ?? 0);
        const live = from < now ? accrueRange(d, r.staff, players, this.riskKey(r.id), this.dayAt(clock, from), this.dayAt(clock, now), cfg.risk, cfg.maxAccrualDays, r.stockValue, cfg.risk.spoilBp[d.kind], util.totalBp) : { net: 0n, revenue: 0n, stock: r.stockValue, accountedDays: 0, utilities: 0n };
        const pending = r.pending + live.net;
        const todayIdx = Math.floor(this.dayAt(clock, now));
        const investor = r.investorId ? cfg.investors.find((i) => i.id === r.investorId) : undefined;
        return {
          id: r.id,
          catalogId: r.catalogId,
          companyId: r.companyId,
          companyName: companies.find((co) => co.id === r.companyId)?.name ?? null,
          unit: r.unit,
          paid: r.paid.toString(),
          staff: r.staff,
          maxStaff: d.maxStaff,
          netPerDay: net.toString(),
          revenuePerDay: revenuePerDay(d, r.staff + players).toString(),
          wagesPerDay: wagesPerDay(d, r.staff).toString(),
          returnBp: dailyReturnBp({ ...d, utilityBp: util.totalBp }, r.staff, players),
          // Aléas : ventes d'aujourd'hui et d'hier par rapport à la normale (0 = incident)
          todayBp: dayFactorBp(this.riskKey(r.id), todayIdx, cfg.risk),
          // Surproduction : demande du jour, stock invendu et sa dépréciation par jour
          demandBp: demandBp(this.riskKey(r.id), todayIdx, cfg.risk),
          stockValue: live.stock.toString(),
          spoilBp: cfg.risk.spoilBp[d.kind],
          // Eau et électricité : part de la production du jour
          utilityBp: util.totalBp,
          // Équipements : forage (eau) et installation solaire (électricité), avec leur prix selon la taille du site
          equipment: {
            borehole: r.borehole,
            solar: r.solar,
            // Entretien : efficacité actuelle, jours avant l'échéance (négatif = en retard), prix de l'entretien
            boreholeBroken: this.effOf(cfg, r).boreholeBroken,
            solarBroken: this.effOf(cfg, r).solarBroken,
            boreholeRepair: this.upkeepCost(cfg, d, r.id, 'borehole', true).toString(),
            solarRepair: this.upkeepCost(cfg, d, r.id, 'solar', true).toString(),
            boreholeEffBp: this.effOf(cfg, r).borehole,
            solarEffBp: this.effOf(cfg, r).solar,
            boreholeDueIn: Math.round(cfg.equipment.borehole.serviceEveryDays - this.effOf(cfg, r).boreholeDays),
            solarDueIn: Math.round(cfg.equipment.solar.serviceEveryDays - this.effOf(cfg, r).solarDays),
            boreholeService: this.upkeepCost(cfg, d, r.id, 'borehole', false).toString(),
            solarService: this.upkeepCost(cfg, d, r.id, 'solar', false).toString(),
            waterBp: util.waterBp,
            powerBp: util.powerBp,
            boreholePrice: equipmentPrice(d.price, cfg.equipment.borehole.priceBp, cfg.equipment.borehole.minPrice).toString(),
            solarPrice: equipmentPrice(d.price, cfg.equipment.solar.priceBp, cfg.equipment.solar.minPrice).toString(),
          },
          yesterdayBp: dayFactorBp(this.riskKey(r.id), todayIdx - 1, cfg.risk),
          fixedCostPerDay: ((BigInt(d.price) * BigInt(cfg.risk.fixedCostBp)) / 10_000n).toString(),
          // Joueurs salariés du site et offres d'emploi ouvertes
          players: staffRows.map((e) => ({ id: e.id, name: e.name, roleFr: e.roleFr, roleEn: e.roleEn, grossMonthly: e.grossMonthly, unpaidMonths: Math.max(0, monthOf(day) - 1 - e.lastPaidMonth) })),
          offers2: offers.filter((o) => o.plantId === r.id).map((o) => ({ id: o.id, roleFr: o.roleFr, roleEn: o.roleEn, grossMonthly: o.grossMonthly })),
          // Impôt OTR à payer (au dernier calcul) et retard éventuel
          taxDue: r.taxDue.toString(),
          taxOverdue: r.taxDue > 0n && !!r.taxSince && gameHoursBetween(clock, r.taxSince.getTime(), now) / 24 > GAME_DAYS_PER_MONTH + contrib.graceDays,
          // Démarrage en cours : aucun intérêt avant cette date
          readyAt: r.readyAt && r.readyAt.getTime() > now ? r.readyAt.toISOString() : null,
          pending: (pending - investorCut(pending, r.investorBp)).toString(),
          investor: investor ? { id: investor.id, emoji: investor.emoji, nameFr: investor.nameFr, nameEn: investor.nameEn, shareBp: r.investorBp, buyback: this.buyback(investor, d, r, day).toString() } : null,
          ask: r.askPrice !== null ? r.askPrice.toString() : null,
          offers: investor
            ? []
            : cfg.investors
                .filter((i) => d.price >= i.minPrice)
                .map((i) => {
                  const valuation = investorValuation(BigInt(d.price), i.offerBp, i.id, `${r.catalogId}:${r.unit}`, day);
                  return { id: i.id, emoji: i.emoji, nameFr: i.nameFr, nameEn: i.nameEn, bioFr: i.bioFr, bioEn: i.bioEn, maxShareBp: i.maxShareBp, valuation: valuation.toString() };
                }),
        };
      });
    return { day, transferTaxBp: cfg.transferTaxBp, otrBp: contrib.otrBp, cfeFee: cfe.feeSociety, companies, jobRoles: cfg.jobs.roles, maxOpenOffers: cfg.jobs.maxOpenOffers, smig: (await this.settings.get('payroll.rates')).smig, sites, mine };
  }

  private buyback(inv: Cfg['investors'][number], d: PlantDef, r: { catalogId: string; unit: number; investorBp: number }, day: number): bigint {
    const valuation = investorValuation(BigInt(d.price), inv.offerBp, inv.id, `${r.catalogId}:${r.unit}`, day);
    return (stakePrice(valuation, r.investorBp) * BigInt(10_000 + inv.buybackPremiumBp)) / 10_000n;
  }

  /** Achat d'un exemplaire encore libre, au prix du catalogue (payé à l'État). */
  buy(accountId: string, companyId: string, catalogId: string, unit: number, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `plantbuy:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`plantbuy|${companyId}|${catalogId}|${unit}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { catalogId, unit, replay: true };
      const cfg = await this.cfg();
      const d = this.def(cfg, catalogId);
      if (unit >= d.units) throw new NotFoundException('unknown_plant');
      if (await tx.industryPlant.findUnique({ where: { catalogId_unit: { catalogId, unit } }, select: { id: true } })) throw new ConflictException('plant_taken');
      const price = BigInt(d.price);
      // Le site est acheté au nom d'une entreprise déjà immatriculée (CFE, RCCM/NIF) : pas de nouveaux frais d'immatriculation
      const owner = await this.ownCompany(tx, c.id, companyId);
      const cfe = 0n;
      await this.ledger.post(tx, {
        kind: 'PLANT_BUY',
        idempotencyKey: key,
        requestHash,
        memo: `${catalogId}:${unit}`,
        legs: [
          { from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: price },
          ...(cfe > 0n ? [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'TREASURY'), amount: cfe }] : []),
        ],
      });
      try {
        const readyAt = new Date(Math.ceil(realMsAfterGameHours(await this.settings.clock(), Date.now(), d.startupGameDays * 24)));
        const p = await tx.industryPlant.create({ data: { catalogId, unit, characterId: c.id, companyId: owner, paid: price, readyAt, accruedAt: readyAt } });
        return { id: p.id, catalogId, unit, paid: price.toString(), cfeFee: cfe.toString(), readyAt: readyAt.toISOString(), replay: false };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('plant_taken');
        throw e;
      }
    });
  }

  /** Fixe le nombre de salariés (0 à la capacité). Le bénéfice couru jusque-là est d'abord arrêté avec l'ancien effectif. */
  setStaff(accountId: string, id: string, staff: number) {
    return this.chars.act(accountId, async (tx, c) => {
      const p = await this.lock(tx, id);
      if (p.characterId !== c.id) throw new NotFoundException('unknown_plant');
      const cfg = await this.cfg();
      const d = this.def(cfg, p.catalogId);
      if (staff === p.staff) throw new BadRequestException('staff_unchanged');
      if (staff + (await this.playersOn(tx, p.id)) > d.maxStaff) throw new BadRequestException('staff_over_capacity');
      // Un changement d'effectif par jour de jeu : pas de personnel ajouté ou retiré selon la journée en cours
      const today = await this.today();
      if (p.staffChangedDay === today) throw new BadRequestException('staff_changed_today');
      await this.settle(tx, p, cfg);
      await tx.industryPlant.update({ where: { id }, data: { staff, staffChangedDay: today } });
      return { id, staff, netPerDay: netPerDay(d, staff, await this.playersOn(tx, p.id)).toString() };
    });
  }

  /** Encaisse le bénéfice accumulé (moins la part de l'investisseur éventuel). */
  collect(accountId: string, id: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const p = await this.lock(tx, id);
      if (p.characterId !== c.id) throw new NotFoundException('unknown_plant');
      const cfg = await this.cfg();
      // Site acheté avant la règle « un site appartient à une entreprise » : à rattacher d'abord
      if (!p.companyId) throw new BadRequestException('plant_needs_company');
      const pending = await this.settle(tx, p, cfg);
      // Impôt OTR en retard (plus d'un mois plus le délai de grâce) : on règle d'abord l'OTR
      if (await this.taxOverdue(tx, p.id)) throw new BadRequestException('plant_tax_overdue');
      const received = await this.paidOut(tx, c.walletId, pending, p, p.catalogId);
      await tx.industryPlant.update({ where: { id }, data: { pending: 0n } });
      return { id, received: received.toString(), investorShare: (pending - received).toString() };
    });
  }

  /** Âge (jours de jeu) de l'impôt impayé le plus ancien, et seuil de retard (un mois + délai de grâce de l'entreprise). */
  private async taxAge(since: Date | null): Promise<{ days: number; limit: number; penaltyBpPerMonth: number }> {
    const contrib = await this.settings.get('company.contributions');
    const days = since ? gameHoursBetween(await this.settings.clock(), since.getTime(), Date.now()) / 24 : 0;
    return { days, limit: GAME_DAYS_PER_MONTH + contrib.graceDays, penaltyBpPerMonth: contrib.penaltyBpPerMonth };
  }

  private async taxOverdue(tx: Tx, id: string): Promise<boolean> {
    const r = await tx.industryPlant.findUniqueOrThrow({ where: { id }, select: { taxDue: true, taxSince: true } });
    if (r.taxDue <= 0n) return false;
    const a = await this.taxAge(r.taxSince);
    return a.days > a.limit;
  }

  /** Pénalité de retard : `penaltyBpPerMonth` par mois entamé au-delà du délai, comme pour la déclaration d'une entreprise. */
  private penalty(taxDue: bigint, a: { days: number; limit: number; penaltyBpPerMonth: number }): bigint {
    if (a.days <= a.limit) return 0n;
    const months = Math.ceil((a.days - a.limit) / GAME_DAYS_PER_MONTH);
    return (taxDue * BigInt(a.penaltyBpPerMonth * months)) / 10_000n;
  }

  /** Déclaration à l'OTR : l'impôt de tous les sites du joueur (plus les pénalités de retard) est payé au Trésor. */
  declare(accountId: string, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      if (c.locationId !== 'otr') throw new BadRequestException('not_at_otr');
      const key = idemKey ? `plantdeclare:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`plantdeclare|${c.id}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true, tax: '0', penalty: '0' };
      const cfg = await this.cfg();
      const mine = await tx.industryPlant.findMany({ where: { characterId: c.id }, select: { id: true }, orderBy: { id: 'asc' } });
      let tax = 0n;
      let penalty = 0n;
      for (const { id } of mine) {
        const p = await this.lock(tx, id);
        await this.settle(tx, p, cfg);
        const r = await tx.industryPlant.findUniqueOrThrow({ where: { id }, select: { taxDue: true, taxSince: true } });
        if (r.taxDue <= 0n) continue;
        tax += r.taxDue;
        penalty += this.penalty(r.taxDue, await this.taxAge(r.taxSince));
        await tx.industryPlant.update({ where: { id }, data: { taxDue: 0n, taxSince: null } });
      }
      if (tax === 0n) throw new BadRequestException('nothing_to_declare');
      await this.ledger.post(tx, { kind: 'TAX', idempotencyKey: key, requestHash, memo: `industry:${mine.length}`, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'TREASURY'), amount: tax + penalty }] });
      return { replay: false, tax: tax.toString(), penalty: penalty.toString() };
    });
  }

  /** Fait entrer un investisseur PNJ au capital : il verse tout de suite la somme au propriétaire et touche ensuite sa part des bénéfices. */
  sellStake(accountId: string, id: string, investorId: string, shareBp: number) {
    return this.chars.act(accountId, async (tx, c) => {
      const p = await this.lock(tx, id);
      if (p.characterId !== c.id) throw new NotFoundException('unknown_plant');
      if (p.investorId) throw new ConflictException('has_investor');
      if (p.askPrice !== null) throw new ConflictException('plant_listed');
      const cfg = await this.cfg();
      const d = this.def(cfg, p.catalogId);
      const inv = cfg.investors.find((i) => i.id === investorId);
      if (!inv || d.price < inv.minPrice) throw new NotFoundException('unknown_investor');
      if (shareBp > inv.maxShareBp) throw new BadRequestException('share_too_high');
      // Bénéfices couru jusque-là : ils restent entièrement au propriétaire
      const before = await this.settle(tx, p, cfg);
      // Impôt OTR en retard : aucun versement au propriétaire tant qu'il n'est pas payé (comme pour l'encaissement)
      if (await this.taxOverdue(tx, p.id)) throw new BadRequestException('plant_tax_overdue');
      await this.paidOut(tx, c.walletId, before, { id: p.id, investorBp: 0 }, p.catalogId);
      await tx.industryPlant.update({ where: { id }, data: { pending: 0n } });
      const valuation = investorValuation(BigInt(d.price), inv.offerBp, inv.id, `${p.catalogId}:${p.unit}`, await this.today());
      const amount = stakePrice(valuation, shareBp);
      if (amount > 0n) await this.ledger.post(tx, { kind: 'PLANT_STAKE', memo: `${p.catalogId}:${inv.id}`, legs: [{ from: await this.ledger.systemWalletId(tx, 'MARKET'), to: c.walletId, amount }] });
      await tx.industryPlant.update({ where: { id }, data: { investorId: inv.id, investorBp: shareBp } });
      return { id, investor: inv.id, shareBp, received: amount.toString() };
    });
  }

  /** Rachète la part de l'investisseur, au prix du jour majoré. */
  buyBack(accountId: string, id: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const p = await this.lock(tx, id);
      if (p.characterId !== c.id) throw new NotFoundException('unknown_plant');
      const cfg = await this.cfg();
      const inv = p.investorId ? cfg.investors.find((i) => i.id === p.investorId) : undefined;
      if (!inv) throw new NotFoundException('no_investor');
      // La part de l'investisseur sur le bénéfice déjà couru lui reste acquise : on solde d'abord
      const pending = await this.settle(tx, p, cfg);
      if (await this.taxOverdue(tx, p.id)) throw new BadRequestException('plant_tax_overdue');
      const received = await this.paidOut(tx, c.walletId, pending, p, p.catalogId);
      const price = this.buyback(inv, this.def(cfg, p.catalogId), p, await this.today());
      if (price > 0n) await this.ledger.post(tx, { kind: 'PLANT_BUYBACK', memo: `${p.catalogId}:${inv.id}`, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: price }] });
      await tx.industryPlant.update({ where: { id }, data: { investorId: null, investorBp: 0, pending: 0n } });
      return { id, paid: price.toString(), received: received.toString() };
    });
  }

  /**
   * Braderie du stock invendu (surproduction) : remise de 10 à 50 % pour écouler la marchandise tout de suite. Le produit de la
   * vente entre dans le résultat du site (part de l'investisseur et impôt OTR comme pour les autres ventes).
   */
  clearStock(accountId: string, id: string, discountBp: number) {
    return this.chars.act(accountId, async (tx, c) => {
      const p = await this.lock(tx, id);
      if (p.characterId !== c.id) throw new NotFoundException('unknown_plant');
      if (!Number.isInteger(discountBp) || discountBp < 1_000 || discountBp > 5_000) throw new BadRequestException('invalid_discount');
      const cfg = await this.cfg();
      await this.settle(tx, p, cfg);
      const row = await tx.industryPlant.findUniqueOrThrow({ where: { id }, select: { stockValue: true, taxSince: true } });
      const { sold, proceeds } = clearance(row.stockValue, discountBp);
      if (sold <= 0n) throw new BadRequestException('no_stock');
      const tax = (proceeds * BigInt((await this.settings.get('company.contributions')).otrBp)) / 10_000n;
      await tx.industryPlant.update({
        where: { id },
        data: { stockValue: { decrement: sold }, pending: { increment: proceeds }, ...(tax > 0n ? { taxDue: { increment: tax }, taxSince: row.taxSince ?? new Date() } : {}) },
      });
      return { id, sold: sold.toString(), proceeds: proceeds.toString() };
    });
  }

  /** Rattache un site (acheté avant la règle) à une de ses entreprises immatriculées ; ses salariés joueurs passent à l'entreprise. */
  attach(accountId: string, id: string, companyId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const p = await this.lock(tx, id);
      if (p.characterId !== c.id) throw new NotFoundException('unknown_plant');
      if (p.companyId) throw new ConflictException('plant_has_company');
      const co = await this.ownCompany(tx, c.id, companyId);
      // Le résultat couru jusque-là reste sous l'ancien régime (impôt du site), puis l'entreprise prend le relais
      await this.settle(tx, p, await this.cfg());
      await tx.industryPlant.update({ where: { id }, data: { companyId: co } });
      await tx.employee.updateMany({ where: { plantId: id, active: true }, data: { companyId: co } });
      return { id, companyId: co };
    });
  }

  /**
   * Créer son propre site (au lieu de racheter un site existant) : moins cher, mais la construction prend plus longtemps avant
   * les premiers revenus. Au nom d'une entreprise immatriculée, comme un achat. Le site créé prend le numéro libre suivant.
   */
  build(accountId: string, companyId: string, catalogId: string, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `plantbuild:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`plantbuild|${companyId}|${catalogId}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { catalogId, replay: true };
      const cfg = await this.cfg();
      const d = this.def(cfg, catalogId);
      const owner = await this.ownCompany(tx, c.id, companyId);
      // Verrou du type de site : deux créations simultanées ne prennent pas le même numéro
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`plantbuild:${catalogId}`}))`;
      const built = await tx.industryPlant.findMany({ where: { catalogId, unit: { gte: d.units } }, select: { unit: true } });
      if (built.length >= cfg.build.maxPerType) throw new BadRequestException('build_limit');
      const used = new Set(built.map((b) => b.unit));
      let unit = d.units;
      while (used.has(unit)) unit++;
      const price = (BigInt(d.price) * BigInt(cfg.build.priceBp)) / 10_000n;
      await this.ledger.post(tx, { kind: 'PLANT_BUILD', idempotencyKey: key, requestHash, memo: `${catalogId}:${unit}`, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: price }] });
      const readyAt = new Date(Math.ceil(realMsAfterGameHours(await this.settings.clock(), Date.now(), d.startupGameDays * cfg.build.startupMultiple * 24)));
      const p = await tx.industryPlant.create({ data: { catalogId, unit, characterId: c.id, companyId: owner, paid: price, readyAt, accruedAt: readyAt } });
      return { id: p.id, catalogId, unit, paid: price.toString(), readyAt: readyAt.toISOString(), replay: false };
    });
  }

  /**
   * Équiper un site : forage (moins d'eau du réseau, un peu plus d'électricité pour la pompe) ou installation solaire (moins
   * d'électricité). Prix selon la taille du site. Le résultat couru jusque-là est arrêté avec l'ancien équipement.
   */
  equip(accountId: string, id: string, kind: 'borehole' | 'solar', idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `plantequip:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`plantequip|${id}|${kind}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { id, kind, replay: true };
      const p = await this.lock(tx, id);
      if (p.characterId !== c.id) throw new NotFoundException('unknown_plant');
      if (p[kind]) throw new ConflictException('already_equipped');
      const cfg = await this.cfg();
      const d = this.def(cfg, p.catalogId);
      const e = cfg.equipment[kind];
      const price = equipmentPrice(d.price, e.priceBp, e.minPrice);
      await this.settle(tx, p, cfg);
      await this.ledger.post(tx, { kind: 'PLANT_EQUIP', idempotencyKey: key, requestHash, memo: `${kind}:${id}`, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: price }] });
      await tx.industryPlant.update({ where: { id }, data: { [kind]: true, [`${kind}ServicedAt`]: new Date() } });
      return { id, kind, paid: price.toString(), replay: false };
    });
  }

  /** Entretien d'un équipement (forage ou solaire) : il retrouve toute son efficacité. Coût : part du prix de l'équipement. */
  service(accountId: string, id: string, kind: 'borehole' | 'solar', idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `plantservice:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`plantservice|${id}|${kind}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { id, kind, replay: true };
      const p = await this.lock(tx, id);
      if (p.characterId !== c.id) throw new NotFoundException('unknown_plant');
      if (!p[kind]) throw new BadRequestException('not_equipped');
      const cfg = await this.cfg();
      const d = this.def(cfg, p.catalogId);
      const e = cfg.equipment[kind];
      // En panne : réparation (plus chère qu'un entretien) ; sinon entretien courant
      const broken = kind === 'borehole' ? this.effOf(cfg, p).boreholeBroken : this.effOf(cfg, p).solarBroken;
      const price = this.upkeepCost(cfg, d, p.id, kind, broken);
      // Le résultat couru jusque-là reste calculé avec l'efficacité d'avant l'entretien
      await this.settle(tx, p, cfg);
      if (price > 0n) await this.ledger.post(tx, { kind: 'PLANT_SERVICE', idempotencyKey: key, requestHash, memo: `${kind}:${id}`, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: price }] });
      await tx.industryPlant.update({ where: { id }, data: { [`${kind}ServicedAt`]: new Date() } });
      return { id, kind, paid: price.toString(), repaired: broken, replay: false };
    });
  }

  // ---------- joueurs salariés ----------

  /** Publie une offre d'emploi sur un de ses sites (poste du réglage, salaire entre le SMIG et le plafond du poste). */
  postOffer(accountId: string, id: string, roleId: string, grossMonthly: number) {
    return this.chars.act(accountId, async (tx, c) => {
      const p = await this.lock(tx, id);
      if (p.characterId !== c.id) throw new NotFoundException('unknown_plant');
      const cfg = await this.cfg();
      const d = this.def(cfg, p.catalogId);
      const role = cfg.jobs.roles.find((x) => x.id === roleId);
      if (!role) throw new BadRequestException('unknown_role');
      if (grossMonthly < (await this.settings.get('payroll.rates')).smig) throw new BadRequestException('salary_below_smig');
      if (grossMonthly > role.maxGross) throw new BadRequestException('salary_too_high');
      const open = await tx.plantJobOffer.count({ where: { plantId: id, open: true } });
      if (open >= cfg.jobs.maxOpenOffers) throw new BadRequestException('too_many_offers');
      // Effectif total (non-joueurs + joueurs + postes déjà proposés) dans la capacité du site
      if (p.staff + (await this.playersOn(tx, id)) + open + 1 > d.maxStaff) throw new BadRequestException('staff_over_capacity');
      const o = await tx.plantJobOffer.create({ data: { plantId: id, roleId: role.id, roleFr: role.nameFr, roleEn: role.nameEn, grossMonthly } });
      return { offer: o.id };
    });
  }

  closeOffer(accountId: string, offerId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const r = await tx.plantJobOffer.updateMany({ where: { id: offerId, open: true, plant: { characterId: c.id } }, data: { open: false } });
      if (r.count !== 1) throw new NotFoundException('unknown_offer');
      return { offer: offerId };
    });
  }

  /** Offres ouvertes des sites des autres joueurs, pour le tableau de l'appli Travail. */
  async openOffers(characterId: string) {
    const cfg = await this.cfg();
    const rows = await this.prisma.plantJobOffer.findMany({
      where: { open: true, plant: { characterId: { not: characterId } } },
      include: { plant: { select: { catalogId: true, unit: true, character: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((o) => {
      const d = cfg.plants.find((x) => x.id === o.plant.catalogId);
      const site = d ? `${d.emoji} ${d.nameFr}${d.units > 1 ? ` #${o.plant.unit + 1}` : ''}` : o.plant.catalogId;
      return { id: `plant:${o.id}`, company: site, activityId: '', boss: o.plant.character.name, roleFr: o.roleFr, roleEn: o.roleEn, grossMonthly: o.grossMonthly };
    });
  }

  /** Embauche d'un joueur sur un site (appelé par l'appli Travail) : un seul emploi salarié à la fois, comme ailleurs. */
  async hire(tx: Tx, c: { id: string; name: string }, offerId: string) {
    const offer = await tx.plantJobOffer.findUnique({ where: { id: offerId }, include: { plant: true } });
    if (!offer || !offer.open) throw new NotFoundException('unknown_offer');
    if (offer.plant.characterId === c.id) throw new BadRequestException('own_company');
    // Anti multi-comptes : même ancienneté minimale que pour un emploi chez un joueur
    const minAge = (await this.settings.get('transfer.limits')).minAccountAgeHours * 3_600_000;
    const accounts = await tx.account.findMany({ where: { character: { id: { in: [c.id, offer.plant.characterId] } } }, select: { createdAt: true, guest: true } });
    if (accounts.some((a) => a.guest)) throw new ForbiddenException('account_required');
    if (accounts.some((a) => Date.now() - a.createdAt.getTime() < minAge)) throw new ForbiddenException('job_account_too_new');
    if (await tx.employee.findFirst({ where: { characterId: c.id, active: true } })) throw new ConflictException('already_employed');
    const closed = await tx.plantJobOffer.updateMany({ where: { id: offer.id, open: true }, data: { open: false } });
    if (closed.count !== 1) throw new ConflictException('offer_taken');
    // Le bénéfice couru jusque-là est arrêté avec l'ancien effectif
    const p = await this.lock(tx, offer.plantId);
    await this.settle(tx, p, await this.cfg());
    const day = await this.today();
    // Immatriculation CNSS faite par le site à l'embauche
    const cnssNumber = `S${String(randomInt(100_000_000)).padStart(8, '0')}${String(randomInt(1000)).padStart(3, '0')}`;
    const e = await tx.employee.create({
      data: { plantId: offer.plantId, companyId: offer.plant.companyId, characterId: c.id, name: c.name, roleFr: offer.roleFr, roleEn: offer.roleEn, grossMonthly: offer.grossMonthly, hiredDay: day, hiredMonth: monthOf(day), lastPaidMonth: monthOf(day) - 1, cnssNumber },
    });
    return { employee: e.id, company: offer.roleFr };
  }

  /** Licenciement d'un joueur salarié par le propriétaire du site (les mois clos restent dus et se paient avec la paie). */
  fire(accountId: string, employeeId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const e = await tx.employee.findUnique({ where: { id: employeeId }, include: { plant: true } });
      if (!e || !e.active || !e.plant || e.plant.characterId !== c.id) throw new NotFoundException('unknown_employee');
      // Pas de licenciement pour ne pas payer : les mois clos dus se règlent d'abord avec la paie
      if (e.lastPaidMonth < monthOf(await this.today()) - 1) throw new BadRequestException('pay_before_firing');
      const p = await this.lock(tx, e.plant.id);
      await this.settle(tx, p, await this.cfg());
      await tx.employee.update({ where: { id: e.id }, data: { active: false } });
      return { employee: e.id };
    });
  }

  /**
   * Paie des mois clos de tous les joueurs salariés de ses sites, comme dans une entreprise : salaire net versé au salarié,
   * cotisations CNSS et AMU (salarié + employeur) et IRPP reversées au Trésor ; l'AMU du salarié est prolongée.
   */
  payroll(accountId: string, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `plantpayroll:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`plantpayroll|${c.id}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true, months: 0, net: '0', social: '0' };
      const day = await this.today();
      const closed = monthOf(day) - 1;
      const rates = await this.settings.get('payroll.rates');
      const staff = await tx.employee.findMany({ where: { plant: { characterId: c.id }, active: true, lastPaidMonth: { lt: closed } } });
      const legs: { from: string; to: string; amount: bigint }[] = [];
      let net = 0n;
      let social = 0n;
      let months = 0;
      for (const e of staff) {
        const n = BigInt(Math.max(0, closed - e.lastPaidMonth));
        if (n === 0n || !e.characterId) continue;
        const pay = computePayroll(BigInt(e.grossMonthly), rates);
        const wallet = await tx.wallet.findUnique({ where: { characterId: e.characterId }, select: { id: true } });
        if (!wallet) continue;
        legs.push({ from: c.walletId, to: wallet.id, amount: pay.net * n });
        net += pay.net * n;
        social += (pay.cnssEmployee + pay.amuEmployee + pay.irpp + pay.cnssEmployer + pay.amuEmployer) * n;
        months += Number(n);
        const emp = await tx.character.findUniqueOrThrow({ where: { id: e.characterId }, select: { amuPaidUntilGameDay: true } });
        await tx.character.update({ where: { id: e.characterId }, data: { amuPaidUntilGameDay: Math.max(emp.amuPaidUntilGameDay, day) + GAME_DAYS_PER_MONTH } });
        await tx.employee.update({ where: { id: e.id }, data: { lastPaidMonth: closed } });
      }
      if (months === 0) throw new BadRequestException('nothing_to_pay');
      if (social > 0n) legs.push({ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'TREASURY'), amount: social });
      await this.ledger.post(tx, { kind: 'PAYROLL', idempotencyKey: key, requestHash, memo: `industry:${c.id}`, legs: legs.filter((l) => l.amount > 0n) });
      return { replay: false, months, net: net.toString(), social: social.toString(), paid: (net + social).toString() };
    });
  }

  // ---------- revente entre joueurs ----------

  list(accountId: string, id: string, ask: number) {
    return this.chars.act(accountId, async (tx, c) => {
      const p = await this.lock(tx, id);
      if (p.characterId !== c.id) throw new NotFoundException('unknown_plant');
      if (p.askPrice !== null) throw new ConflictException('plant_listed');
      const cfg = await this.cfg();
      const d = this.def(cfg, p.catalogId);
      if (BigInt(ask) > BigInt(d.price) * BigInt(cfg.maxAskMultiple)) throw new BadRequestException('ask_too_high');
      // Un site dont l'impôt OTR est en retard ne se vend pas (payer d'abord à l'OTR)
      await this.settle(tx, p, cfg);
      if (await this.taxOverdue(tx, p.id)) throw new BadRequestException('plant_tax_overdue');
      if (await this.wagesDue(tx, p.id)) throw new BadRequestException('wages_due');
      if ((await tx.industryPlant.findUniqueOrThrow({ where: { id }, select: { pending: true } })).pending < 0n) throw new BadRequestException('losses_to_cover');
      await tx.industryPlant.update({ where: { id }, data: { askPrice: BigInt(ask) } });
      return { id, ask: String(ask) };
    });
  }

  unlist(accountId: string, id: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const p = await this.lock(tx, id);
      if (p.characterId !== c.id) throw new NotFoundException('unknown_plant');
      if (p.askPrice === null) throw new NotFoundException('not_listed');
      await tx.industryPlant.update({ where: { id }, data: { askPrice: null } });
      return { id };
    });
  }

  /** Achète un site mis en vente : le vendeur reçoit le prix (moins la taxe) et son bénéfice en attente ; salariés et investisseur suivent le site. */
  buyListing(accountId: string, id: string, companyId: string, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `plantsale:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`plantsale|${id}|${companyId}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { id, replay: true };
      const p = await this.lock(tx, id);
      if (p.askPrice === null) throw new NotFoundException('not_listed');
      if (p.characterId === c.id) throw new BadRequestException('own_plant');
      // Le site est repris par une entreprise immatriculée de l'acheteur
      const buyerCompany = await this.ownCompany(tx, c.id, companyId);
      const seller = await tx.character.findUnique({ where: { id: p.characterId }, select: { wallet: { select: { id: true } } } });
      if (!seller?.wallet) throw new NotFoundException('unknown_plant');
      const cfg = await this.cfg();
      const pending = await this.settle(tx, p, cfg);
      if (await this.taxOverdue(tx, p.id)) throw new ConflictException('plant_tax_overdue');
      // Salaires dus par le vendeur : jamais transmis à l'acheteur
      if (await this.wagesDue(tx, p.id)) throw new ConflictException('wages_due');
      // Pertes non couvertes par le vendeur : jamais transmises à l'acheteur
      if (pending < 0n) throw new ConflictException('losses_to_cover');
      // Un salarié du site ne rachète pas le site où il travaille (il serait son propre employé)
      if (await tx.employee.findFirst({ where: { plantId: id, characterId: c.id, active: true }, select: { id: true } })) throw new BadRequestException('own_plant');
      const ask = p.askPrice;
      // L'impôt dû par le vendeur doit être couvert par le prix : jamais d'effacement de dette par une vente à bas prix
      const owed = await tx.industryPlant.findUniqueOrThrow({ where: { id }, select: { taxDue: true, taxSince: true } });
      if (owed.taxDue > 0n && owed.taxDue + this.penalty(owed.taxDue, await this.taxAge(owed.taxSince)) > ask) throw new ConflictException('plant_tax_exceeds_price');
      await this.paidOut(tx, seller.wallet.id, pending, p, p.catalogId);
      const tax = (ask * BigInt(cfg.transferTaxBp)) / 10_000n;
      // Impôt OTR encore dû par le vendeur (et pénalités) : retenu sur son prix de vente et versé au Trésor
      const due = await tx.industryPlant.findUniqueOrThrow({ where: { id }, select: { taxDue: true, taxSince: true } });
      const sellerTax = due.taxDue > 0n ? due.taxDue + this.penalty(due.taxDue, await this.taxAge(due.taxSince)) : 0n;
      const withheld = sellerTax; // couvert par le prix (vérifié plus haut)
      const legs: { from: string; to: string; amount: bigint }[] = [];
      if (ask - withheld > 0n) legs.push({ from: c.walletId, to: seller.wallet.id, amount: ask - withheld });
      if (tax + withheld > 0n) legs.push({ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'TREASURY'), amount: tax + withheld });
      await this.ledger.post(tx, { kind: 'PLANT_SALE', idempotencyKey: key, requestHash, memo: id, legs });
      await tx.industryPlant.update({ where: { id }, data: { characterId: c.id, companyId: buyerCompany, paid: ask, askPrice: null, pending: 0n, taxDue: 0n, taxSince: null } });
      // Les salariés joueurs du site passent à l'entreprise de l'acheteur
      await tx.employee.updateMany({ where: { plantId: id, active: true }, data: { companyId: buyerCompany } });
      // Changement de propriétaire : les offres d'emploi publiées par le vendeur sont fermées
      await tx.plantJobOffer.updateMany({ where: { plantId: id, open: true }, data: { open: false } });
      return { id, paid: ask.toString(), tax: tax.toString(), replay: false };
    });
  }

  /** Annonces de sites à vendre par des joueurs. */
  async market() {
    const cfg = await this.cfg();
    const rows = await this.prisma.industryPlant.findMany({ where: { askPrice: { not: null } }, orderBy: { askPrice: 'asc' }, take: 50 });
    return {
      listings: rows.map((r) => {
        const d = this.def(cfg, r.catalogId);
        return { id: r.id, catalogId: r.catalogId, emoji: d.emoji, nameFr: d.nameFr, nameEn: d.nameEn, staff: r.staff, maxStaff: d.maxStaff, ask: r.askPrice!.toString(), investorBp: r.investorBp };
      }),
    };
  }
}

@Controller('industry')
export class IndustryController {
  constructor(private readonly svc: IndustryService) {}

  @Get()
  view(@CurrentUser() u: AuthUser) {
    return this.svc.view(u.accountId);
  }

  @Get('market')
  market() {
    return this.svc.market();
  }

  @HttpCode(200)
  @AccountRequired()
  @Post('buy')
  buy(@CurrentUser() u: AuthUser, @Body() dto: BuyDto, @Headers('idempotency-key') key?: string) {
    return this.svc.buy(u.accountId, dto.companyId, dto.catalogId, dto.unit, idem(key));
  }

  @HttpCode(200)
  @AccountRequired()
  @Post('build')
  build(@CurrentUser() u: AuthUser, @Body() dto: BuildDto, @Headers('idempotency-key') key?: string) {
    return this.svc.build(u.accountId, dto.companyId, dto.catalogId, idem(key));
  }

  @HttpCode(200)
  @Post(':id/equip')
  equip(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: EquipDto, @Headers('idempotency-key') key?: string) {
    return this.svc.equip(u.accountId, id, dto.kind, idem(key));
  }

  @HttpCode(200)
  @Post(':id/service')
  service(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: EquipDto, @Headers('idempotency-key') key?: string) {
    return this.svc.service(u.accountId, id, dto.kind, idem(key));
  }

  @HttpCode(200)
  @Post(':id/attach')
  attach(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: CompanyRefDto) {
    return this.svc.attach(u.accountId, id, dto.companyId);
  }

  @HttpCode(200)
  @Post(':id/clear-stock')
  clearStock(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: ClearDto) {
    return this.svc.clearStock(u.accountId, id, dto.discountBp);
  }

  @HttpCode(200)
  @Post('payroll')
  payroll(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.svc.payroll(u.accountId, idem(key));
  }

  @HttpCode(200)
  @Post('offers/:offerId/close')
  closeOffer(@CurrentUser() u: AuthUser, @Param('offerId', new ParseUUIDPipe({ version: '4' })) offerId: string) {
    return this.svc.closeOffer(u.accountId, offerId);
  }

  @HttpCode(200)
  @Post('employees/:employeeId/fire')
  fire(@CurrentUser() u: AuthUser, @Param('employeeId', new ParseUUIDPipe({ version: '4' })) employeeId: string) {
    return this.svc.fire(u.accountId, employeeId);
  }

  @HttpCode(200)
  @AccountRequired()
  @Post(':id/offers')
  postOffer(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: PlantOfferDto) {
    return this.svc.postOffer(u.accountId, id, dto.roleId, dto.grossMonthly);
  }

  @HttpCode(200)
  @Post('declare')
  declare(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.svc.declare(u.accountId, idem(key));
  }

  @HttpCode(200)
  @Post(':id/staff')
  staff(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: StaffDto) {
    return this.svc.setStaff(u.accountId, id, dto.staff);
  }

  @HttpCode(200)
  @Post(':id/collect')
  collect(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.svc.collect(u.accountId, id);
  }

  @HttpCode(200)
  @Post(':id/stake')
  stake(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: StakeDto) {
    return this.svc.sellStake(u.accountId, id, dto.investorId, dto.shareBp);
  }

  @HttpCode(200)
  @Post(':id/buyback')
  buyBack(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.svc.buyBack(u.accountId, id);
  }

  @HttpCode(200)
  @AccountRequired()
  @Post(':id/list')
  list(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: AskDto) {
    return this.svc.list(u.accountId, id, dto.ask);
  }

  @HttpCode(200)
  @Post(':id/unlist')
  unlist(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.svc.unlist(u.accountId, id);
  }

  @HttpCode(200)
  @AccountRequired()
  @Post(':id/buy-listing')
  buyListing(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: CompanyRefDto, @Headers('idempotency-key') key?: string) {
    return this.svc.buyListing(u.accountId, id, dto.companyId, idem(key));
  }
}

@Module({ controllers: [IndustryController], providers: [IndustryService, CharacterService] })
export class IndustryModule {}
