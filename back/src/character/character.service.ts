import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Character, Prisma, type OwnedVehicle } from '@prisma/client';
import { breakdownRiskBp, condition, fuelNeededMl, type VehicleModel, type VehicleRules } from '../vehicle/vehicle';
import { Optional } from '@nestjs/common';
import { LiveService } from '../live/live.service';
import { randomInt } from 'node:crypto';
import { activeCompanyId } from '../company/active';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService, Tx } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { type ClockConfig, gameHoursBetween, gameTimeAt, GAME_DAYS_PER_MONTH, realMsAfterGameHours } from '../economy/clock';
import { sha256Hex } from '../common/crypto';
import { isOpen } from '../economy/hours';
import { applyEffects, decayNeeds, Needs, withMealEnergy } from '../economy/needs';
import { applyRate } from '../economy/money';
import { conditionAvailability, drawCondition, settleDestiny, type Condition, type ConditionAvailability, type ConditionCounts } from '../economy/destiny';
import { companySalePrice, computeDeclaration } from '../economy/company';
import { distanceMeters, fare, travelEnergy, type TransportMode } from '../economy/transport';
import { arrearsTotal, downgrade, HOUSING_LADDER, nextRentPayment, overdueDays, overdueMonths, withLateFee } from '../economy/rent';
import { CreateCharacterDto } from './character.dto';
import { meetsReq } from '../economy/study';
import { powerBill, waterBill } from '../economy/utilities';
import { jobLastWorked, markJobWorked } from '../economy/job-cooldown';
import { payModeOf } from '../economy/public-jobs';
import { leisureLast, TV_HOUSING } from '../economy/leisure';
import { sleepGameHours } from '../economy/sleep';
import { familyDay, familyHelp, illnessDay, outageHours } from '../economy/life';
import { activeEvents, transportFactorBp } from '../economy/events';
import { activeStay } from '../hotel/stay';

const MAX_RENT_MONTHS_AHEAD = 3;
export const BILLS = ['ELEC', 'WATER', 'WIFI'] as const;
export type Bill = (typeof BILLS)[number];
const BILL_FIELD = { ELEC: 'elecPaidUntilGameDay', WATER: 'waterPaidUntilGameDay', WIFI: 'wifiPaidUntilGameDay' } as const;
export const HOME = 'home';
type Housing = 'VILLA' | 'CHAMBRE_SALON' | 'ENTRER_COUCHER';

export function needsOf(c: Character): Needs {
  return { hunger: c.hunger, energy: c.energy, hygiene: c.hygiene, health: c.health, morale: c.morale, respect: c.respect };
}

@Injectable()
export class CharacterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    // Temps réel (notifier le destinataire d'un envoi d'argent) ; absent dans les tests unitaires
    @Optional() private readonly live?: LiveService,
  ) {}

  /** Effectif de personnages par condition de départ, et ce qui reste choisissable selon le plafond (réglage start.quota). */
  async conditionAvailability(db: Pick<Prisma.TransactionClient, 'character'> = this.prisma): Promise<ConditionAvailability> {
    const rows = await db.character.groupBy({ by: ['birthCondition'], _count: { _all: true } });
    const counts: ConditionCounts = { RICH: 0, MIDDLE: 0, POOR: 0 };
    for (const r of rows) counts[r.birthCondition as Condition] = r._count._all;
    return conditionAvailability(counts, await this.settings.get('start.quota'));
  }

  async create(accountId: string, dto: CreateCharacterDto) {
    if (dto.mode === 'FREE_CHOICE' && !dto.condition) throw new BadRequestException('condition_required');
    if (dto.mode !== 'FREE_CHOICE' && dto.condition) throw new BadRequestException('condition_not_allowed_with_destiny');
    const drawn = dto.mode === 'DESTINY' ? drawCondition(await this.settings.get('destiny.weights')) : null;
    const respectBonus = dto.mode === 'DESTINY' ? await this.settings.get('destiny.bonusRespect') : 0;
    const capitals = await this.settings.get('start.capital');
    const housings = await this.settings.get('start.housing');
    const clock = await this.settings.clock();
    const today = gameTimeAt(clock, Date.now()).day;

    try {
      const id = await this.prisma.$transaction(async (tx) => {
        // Les créations sont mises en file : le plafond par condition se calcule sur un effectif à jour (verrou tenu jusqu'à la fin)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('agbe:character-condition-quota'))`;
        const available = await this.conditionAvailability(tx);
        let condition: Condition;
        if (dto.mode === 'FREE_CHOICE') {
          condition = dto.condition!;
          if (!available[condition]) throw new BadRequestException('condition_full');
        } else {
          condition = settleDestiny(drawn!, available);
        }
        const capital = capitals[condition];
        const housing = housings[condition];
        const c = await tx.character.create({
          data: {
            accountId,
            name: dto.name,
            profile: dto.profile,
            region: dto.region,
            birthCondition: condition,
            birthMode: dto.mode,
            housing,
            respect: Math.min(100, 10 + respectBonus),
            rentPaidUntilGameDay: today + GAME_DAYS_PER_MONTH,
            rentNagDay: today,
            // Premier mois d'électricité et d'eau compris à l'emménagement ; wifi à souscrire
            elecPaidUntilGameDay: today + GAME_DAYS_PER_MONTH,
            waterPaidUntilGameDay: today + GAME_DAYS_PER_MONTH,
            wallet: { create: {} },
          },
          include: { wallet: true },
        });
        if (capital > 0) {
          await this.ledger.post(tx, {
            kind: 'START_CAPITAL',
            idempotencyKey: `start:${c.id}`,
            legs: [{ from: await this.ledger.systemWalletId(tx, 'TREASURY'), to: c.wallet!.id, amount: BigInt(capital) }],
          });
        }
        // Report des FCFA achetés en argent réel lors d'une vie précédente
        const acc = await tx.account.findUniqueOrThrow({ where: { id: accountId }, select: { restartCarry: true } });
        if (acc.restartCarry > 0n) {
          await this.ledger.post(tx, {
            kind: 'LIFE_CARRY',
            idempotencyKey: `carry:${c.id}`,
            legs: [{ from: await this.ledger.systemWalletId(tx, 'CARRY'), to: c.wallet!.id, amount: acc.restartCarry }],
          });
          await tx.account.update({ where: { id: accountId }, data: { restartCarry: 0n } });
        }
        return c.id;
      });
      return this.state(accountId, id);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('character_exists');
      throw e;
    }
  }

  /**
   * Recommencer sa vie : tout le patrimoine du jeu repart au système par le grand livre
   * (solde du portefeuille → Trésor, épargne détenue par la Banque → Trésor), les positions sont
   * effacées, le portefeuille vidé est détaché (son historique reste), puis le personnage est supprimé.
   * Les achats réels (compte) ne sont pas touchés.
   */
  async restart(accountId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "character" WHERE "accountId" = ${accountId}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundException('no_character');
      const id = rows[0].id;
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { characterId: id } });
      const treasury = await this.ledger.systemWalletId(tx, 'TREASURY');
      // L'argent acheté en argent réel (et déjà reporté d'une vie précédente) n'est jamais perdu :
      // la part du solde qui en provient est mise de côté pour le prochain personnage.
      const bought = await tx.ledgerEntry.aggregate({
        _sum: { amount: true },
        where: { walletId: wallet.id, amount: { gt: 0 }, transaction: { kind: { in: ['PURCHASE', 'LIFE_CARRY'] } } },
      });
      const carry = wallet.balance < (bought._sum.amount ?? 0n) ? wallet.balance : (bought._sum.amount ?? 0n);
      const legs = [
        ...(carry > 0n ? [{ from: wallet.id, to: await this.ledger.systemWalletId(tx, 'CARRY'), amount: carry }] : []),
        ...(wallet.balance - carry > 0n ? [{ from: wallet.id, to: treasury, amount: wallet.balance - carry }] : []),
      ];
      if (legs.length > 0) await this.ledger.post(tx, { kind: 'LIFE_RESTART', idempotencyKey: `restart:${id}`, legs });
      if (carry > 0n) await tx.account.update({ where: { id: accountId }, data: { restartCarry: { increment: carry } } });
      const savings = await tx.savingsAccount.findUnique({ where: { characterId: id } });
      if (savings && savings.balance > 0n) {
        await this.ledger.post(tx, {
          kind: 'LIFE_RESTART',
          idempotencyKey: `restart-savings:${id}`,
          legs: [{ from: await this.ledger.systemWalletId(tx, 'BANK'), to: treasury, amount: savings.balance }],
        });
      }
      // Livrets et DAT : capital détenu par la Banque, rendu au Trésor
      const deposits = await tx.bankDeposit.aggregate({ _sum: { principal: true }, where: { characterId: id, closedAt: null } });
      if ((deposits._sum.principal ?? 0n) > 0n) {
        await this.ledger.post(tx, {
          kind: 'LIFE_RESTART',
          idempotencyKey: `restart-bank:${id}`,
          legs: [{ from: await this.ledger.systemWalletId(tx, 'BANK'), to: treasury, amount: deposits._sum.principal! }],
        });
      }
      await tx.bankDeposit.deleteMany({ where: { characterId: id } });
      await tx.savingsAccount.deleteMany({ where: { characterId: id } });
      await tx.holding.deleteMany({ where: { characterId: id } });
      await tx.stockHolding.deleteMany({ where: { characterId: id } });
      await tx.venture.deleteMany({ where: { characterId: id } });
      await tx.estatePlot.deleteMany({ where: { characterId: id } });
      await tx.workShift.deleteMany({ where: { characterId: id } });
      await tx.wallet.update({ where: { id: wallet.id }, data: { characterId: null, archivedAt: new Date() } });
      await tx.character.delete({ where: { id } });
    });
  }

  /** Verrouille la ligne du personnage (SELECT … FOR UPDATE, requête paramétrée) puis applique l'usure des besoins. */
  private async lockAndDecay(tx: Tx, accountId: string): Promise<Character & { walletId: string }> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "character" WHERE "accountId" = ${accountId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException('no_character');
    const c = await tx.character.findUniqueOrThrow({ where: { id: rows[0].id }, include: { wallet: { select: { id: true } } } });
    const clock = await this.settings.clock();
    const cfg = await this.settings.get('needs.decay');
    const nowMs = Date.now();
    // Usure appliquée par heures de jeu ENTIÈRES ; l'ancre n'avance que du temps consommé.
    // Ainsi, multiplier les actions ne « gèle » pas les besoins (aucune fraction perdue à l'arrondi).
    if (c.sleepUntil && c.sleepUntil.getTime() <= nowMs) {
      const woke = await this.finishSleep(tx, c, 1);
      Object.assign(c, woke);
    }
    // SAMU : à l'échéance, le patient sort (besoins remontés, facture) ; pendant le séjour les besoins ne baissent pas
    if (c.hospitalUntil && c.hospitalUntil.getTime() <= nowMs) Object.assign(c, await this.dischargeHospital(tx, c));
    else if (c.hospitalUntil) return { ...c, walletId: c.wallet!.id };
    const whole = Math.floor(gameHoursBetween(clock, c.needsUpdatedAt.getTime(), nowMs));
    if (whole <= 0) return this.settleLife(tx, await this.settleRent(tx, { ...c, walletId: c.wallet!.id }));
    const anchor =
      whole >= cfg.maxDecayGameHours
        ? new Date(nowMs) // plafond hors ligne : au-delà, le personnage s'est reposé
        : new Date(Math.floor(realMsAfterGameHours(clock, c.needsUpdatedAt.getTime(), whole)));
    const n = decayNeeds(needsOf(c), whole, cfg);
    const updated = await tx.character.update({ where: { id: c.id }, data: { ...n, needsUpdatedAt: anchor } });
    return this.settleLife(tx, await this.settleRent(tx, { ...updated, walletId: c.wallet!.id }));
  }

  /**
   * Vie quotidienne, une fois par jour de jeu écoulé (rattrapage plafonné) : maladie qui s'aggrave ou qui guérit,
   * risque d'en attraper une, demande d'argent de la famille, aide de la famille en cas de coup dur, coupures au logement.
   */
  private async settleLife(tx: Tx, c: Character & { walletId: string }): Promise<Character & { walletId: string }> {
    const clock = await this.settings.clock();
    const now = Date.now();
    const today = gameTimeAt(clock, now).day;
    if (c.lifeCheckedDay >= today) return c;
    if (c.lifeCheckedDay < 0) {
      const updated = await tx.character.update({ where: { id: c.id }, data: { lifeCheckedDay: today } });
      return { ...updated, walletId: c.walletId };
    }
    const [illnesses, hr, fr, out] = await Promise.all([this.settings.get('health.illnesses'), this.settings.get('health.rules'), this.settings.get('family.rules'), this.settings.get('utilities.outages')]);
    const rand = (n: number) => randomInt(n);
    const data: Prisma.CharacterUpdateInput = { lifeCheckedDay: today };
    let n = needsOf(c);
    // Demandes de la famille restées sans réponse : refus implicite
    const expired = await tx.familyRequest.findMany({ where: { characterId: c.id, status: 'PENDING', expiresDay: { lt: today } } });
    for (const r of expired) {
      const rule = fr.requests.find((x) => x.id === r.kind);
      if (rule) n = applyEffects(n, { respect: -rule.refusedRespect, morale: -rule.refusedMorale });
    }
    if (expired.length) await tx.familyRequest.updateMany({ where: { id: { in: expired.map((r) => r.id) } }, data: { status: 'EXPIRED' } });
    let pending = (await tx.familyRequest.count({ where: { characterId: c.id, status: 'PENDING' } })) > 0;
    let illness = c.illnessId ? { id: c.illnessId, day: c.illnessDay ?? today } : null;
    let helped = false;
    const balance = (await tx.wallet.findUniqueOrThrow({ where: { id: c.walletId }, select: { balance: true } })).balance;
    const days = Math.min(today - c.lifeCheckedDay, hr.maxCatchUpDays);
    for (let d = today - days + 1; d <= today; d++) {
      const r = illnessDay({ day: d, needs: n, current: illness }, illnesses, hr, rand);
      n = applyEffects(n, r.effects);
      if (r.fellIll) data.diagnosed = false;
      illness = r.illness;
      const req = familyDay({ condition: c.birthCondition, pending }, fr, rand);
      if (req) {
        await tx.familyRequest.create({ data: { characterId: c.id, kind: req.kind, amount: BigInt(req.amount), day: d, expiresDay: d + fr.answerDays } });
        pending = true;
      }
      const help = helped ? 0 : familyHelp({ condition: c.birthCondition, balance }, fr, rand);
      if (help > 0) {
        helped = true;
        await this.ledger.post(tx, { kind: 'FAMILY_HELP', idempotencyKey: `family-help:${c.id}:${d}`, legs: [{ from: await this.ledger.systemWalletId(tx, 'MARKET'), to: c.walletId, amount: BigInt(help) }] });
      }
    }
    data.illnessId = illness?.id ?? null;
    data.illnessDay = illness?.day ?? null;
    if (!illness) data.diagnosed = false;
    // Coupures du jour au logement (les équipements protègent ; seul le jour courant compte)
    if (!c.homeless) {
      const ph = outageHours(out.powerDailyBp, out.powerHours, rand);
      if (ph > 0) {
        data.powerCutUntil = new Date(Math.ceil(realMsAfterGameHours(clock, now, ph)));
        if (!c.generator && !c.solar) n = applyEffects(n, { morale: -out.powerMorale });
      }
      const wh = outageHours(out.waterDailyBp, out.waterHours, rand);
      if (wh > 0) {
        data.waterCutUntil = new Date(Math.ceil(realMsAfterGameHours(clock, now, wh)));
        if (!c.waterTank) n = applyEffects(n, { hygiene: -out.waterHygiene });
      }
    }
    const updated = await tx.character.update({ where: { id: c.id }, data: { ...data, ...n } });
    return { ...updated, walletId: c.walletId };
  }

  /**
   * Loyer impayé : chaque semaine de retard, le propriétaire réclame (respect et moral en baisse) ;
   * au-delà du délai, expulsion vers le logement inférieur (ou la rue), les arriérés majorés deviennent une dette
   * diminuée de la caution gardée par le propriétaire.
   */
  private async settleRent(tx: Tx, c: Character & { walletId: string }): Promise<Character & { walletId: string }> {
    if (c.homeOwned || c.homeless) return c;
    const today = gameTimeAt(await this.settings.clock(), Date.now()).day;
    // Partie antérieure aux règles de retard : l'ancien retard est pardonné une fois, le compteur part d'aujourd'hui
    if (c.rentNagDay < 0) {
      const updated = await tx.character.update({ where: { id: c.id }, data: { rentNagDay: today, rentPaidUntilGameDay: Math.max(c.rentPaidUntilGameDay, today) } });
      return { ...updated, walletId: c.walletId };
    }
    const m = overdueMonths(c.rentPaidUntilGameDay, today);
    if (m === 0) return c;
    const rules = await this.settings.get('rent.rules');
    const data: Prisma.CharacterUpdateInput = {};
    let n = needsOf(c);
    const from = Math.max(c.rentPaidUntilGameDay, c.rentNagDay);
    const weeks = Math.floor((today - from) / 7);
    if (weeks > 0) {
      n = applyEffects(n, { respect: -rules.nagRespect * weeks, morale: -rules.nagMorale * weeks });
      data.rentNagDay = from + weeks * 7;
    }
    if (today - c.rentPaidUntilGameDay > rules.evictAfterMonths * GAME_DAYS_PER_MONTH) {
      const monthly = BigInt((await this.settings.get('rent.monthly'))[c.housing as Housing] ?? 0);
      const owed = arrearsTotal(monthly, c.rentPaidUntilGameDay, today, rules.lateFeeBpPerDay) - c.rentDeposit;
      const next = downgrade(c.housing);
      n = applyEffects(n, { respect: -rules.evictRespect, morale: -rules.evictMorale });
      Object.assign(data, {
        rentDebt: c.rentDebt + (owed > 0n ? owed : 0n),
        rentDeposit: 0n,
        housing: next ?? c.housing,
        homeless: next === null,
        rentPaidUntilGameDay: today,
        rentNagDay: today,
        homeX: null,
        homeZ: null,
      });
    }
    const updated = await tx.character.update({ where: { id: c.id }, data: { ...data, ...n } });
    return { ...updated, walletId: c.walletId };
  }

  /** Exécute une action sur le personnage verrouillé (usure appliquée) et renvoie le résultat + l'état. */
  async act<T>(accountId: string, fn: (tx: Tx, c: Character & { walletId: string }) => Promise<T>, opts: { whileAsleep?: boolean; whileHospital?: boolean } = {}) {
    const result = await this.prisma.$transaction(async (tx) => {
      const c = await this.lockAndDecay(tx, accountId);
      if (!opts.whileHospital && c.hospitalUntil && c.hospitalUntil.getTime() > Date.now()) throw new BadRequestException('in_hospital');
      if (!opts.whileAsleep && c.sleepUntil) throw new BadRequestException('asleep');
      if (c.tripUntil && c.tripUntil.getTime() > Date.now()) throw new BadRequestException('on_trip');
      return fn(tx, c);
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 10_000,
    });
    return { result, state: await this.state(accountId) };
  }

  private async freezerState(characterId: string, owned: boolean) {
    const cfg = await this.settings.get('freezer');
    const items = owned ? await this.prisma.freezerItem.findMany({ where: { characterId, qty: { gt: 0 } }, orderBy: { foodId: 'asc' } }) : [];
    return { owned, price: cfg.price, capacity: cfg.capacity, discountBp: cfg.discountBp, used: items.reduce((a, i) => a + i.qty, 0), items: items.map((i) => ({ foodId: i.foodId, qty: i.qty })) };
  }

  /** Actes à faire une seule fois par jour de jeu (consultation, tests) déjà faits : l'interface les grise. */
  private async doneToday(characterId: string): Promise<string[]> {
    const ids = await this.settings.get('activities.oncePerDay');
    if (ids.length === 0) return [];
    const walletId = (await this.prisma.wallet.findFirst({ where: { character: { id: characterId } }, select: { id: true } }))?.id;
    if (!walletId) return [];
    const [clock, rows] = await Promise.all([
      this.settings.clock(),
      this.prisma.ledgerTransaction.findMany({ where: { kind: 'ACTIVITY', memo: { in: ids }, entries: { some: { walletId } } }, orderBy: { createdAt: 'desc' }, take: 60, select: { memo: true, createdAt: true } }),
    ]);
    const now = Date.now();
    return [...new Set(rows.filter((r) => gameHoursBetween(clock, r.createdAt.getTime(), now) < 24).map((r) => r.memo!))];
  }

  async state(accountId: string, characterId?: string) {
    let c = await this.prisma.character.findFirst({
      where: characterId ? { id: characterId, accountId } : { accountId },
      include: { wallet: { select: { balance: true, currency: true } }, job: true },
    });
    if (!c) throw new NotFoundException('no_character');
    // Sortie d'hôpital arrivée à échéance pendant l'absence : appliquée avant d'afficher l'état
    // Idem pour le sommeil : au réveil, l'énergie est rendue tout de suite à la lecture (et non à la prochaine action du joueur)
    if ((c.hospitalUntil && c.hospitalUntil.getTime() <= Date.now()) || (c.sleepUntil && c.sleepUntil.getTime() <= Date.now())) {
      await this.prisma.$transaction((tx) => this.lockAndDecay(tx, accountId));
      c = (await this.prisma.character.findFirst({ where: { id: c.id }, include: { wallet: { select: { balance: true, currency: true } }, job: true } }))!;
    }
    const unpaidBill = await this.prisma.medicalBill.findFirst({ where: { characterId: c.id, paidAt: null }, orderBy: { createdAt: 'asc' } });
    const samuCfg = await this.settings.get('emergency.samu');
    const vehicleCatalog = await this.settings.get('vehicles.catalog');
    const ownedVehicles = await this.prisma.ownedVehicle.findMany({ where: { characterId: c.id, soldAt: null }, orderBy: { createdAt: 'asc' } });
    const clock = await this.settings.clock();
    const now = Date.now();
    const time = gameTimeAt(clock, now);
    // Affichage : on calcule l'usure sans écrire (l'écriture se fait lors des actions).
    const n = decayNeeds(needsOf(c), Math.floor(gameHoursBetween(clock, c.needsUpdatedAt.getTime(), now)), await this.settings.get('needs.decay'));
    const rent = (await this.settings.get('rent.monthly'))[c.housing as 'VILLA' | 'CHAMBRE_SALON' | 'ENTRER_COUCHER'] ?? 0;
    const restCfg = await this.settings.get('action.rest');
    const heldIds = [...new Set([...c.jobIds, ...(c.jobId ? [c.jobId] : [])])];
    const held = heldIds.length > 0 ? await this.prisma.job.findMany({ where: { id: { in: heldIds } } }) : [];
    const [jobsPublic, taskPaid] = await Promise.all([this.settings.get('jobs.public'), this.settings.get('jobs.taskPaid')]);
    const waitFor = (j: { id: string; shiftGameHours: number }) => {
      const last = jobLastWorked(c.jobWorkedAt, j.id);
      return last ? Math.max(0, j.shiftGameHours - gameHoursBetween(clock, last, now)) : 0;
    };
    return {
      id: c.id,
      name: c.name,
      profile: c.profile,
      region: c.region,
      birthCondition: c.birthCondition,
      birthMode: c.birthMode,
      housing: c.housing,
      look: c.look,
      homePos: c.homeX !== null && c.homeZ !== null ? { x: c.homeX, z: c.homeZ } : null,
      // Modèle de la maison construite où l'on habite (dessin de la maison sur la carte), sinon null
      homeStyle: c.homeOwned && c.homeX !== null ? await this.homeStyle(c.id) : null,
      location: c.locationId,
      city: c.city,
      trip: c.tripUntil && c.tripUntil.getTime() > now ? { until: c.tripUntil.toISOString(), to: c.city, from: c.tripFrom, since: c.tripStart?.toISOString() ?? null } : null,
      hasCar: ownedVehicles.some((v) => v.kind === 'CAR'),
      hasMoto: ownedVehicles.some((v) => v.kind === 'MOTO'),
      zemContract: !!c.zemContractAt,
      zemBike: await this.settings.get('work.zemBike'),
      vehicles: ownedVehicles.map((v) => {
        const m = vehicleCatalog.models.find((x) => x.id === v.modelId);
        const cond = m ? condition(v, m) : 0;
        return { id: v.id, kind: v.kind, modelId: v.modelId, nameFr: m?.nameFr ?? v.modelId, nameEn: m?.nameEn ?? v.modelId, emoji: m?.emoji ?? '🚗', fuelMl: v.fuelMl, tankMl: m ? m.tankL * 1000 : 0, mlPerKm: m?.mlPerKm ?? 0, condition: cond, drivable: cond >= vehicleCatalog.rules.minCondition, serviceDue: !!m && v.sinceServiceM >= m.serviceEveryKm * 1000 };
      }),
      fuelPricePerL: vehicleCatalog.fuelPricePerL,
      company: await this.companyState(c.id, time.day),
      shift: await this.openShift(c.id),
      needs: n,
      wallet: { balance: c.wallet!.balance.toString(), currency: c.wallet!.currency },
      job: c.job ? { id: c.job.id, nameFr: c.job.nameFr, nameEn: c.job.nameEn, payPerShift: c.job.payPerShift, shiftGameHours: c.job.shiftGameHours, payMode: payModeOf(c.job.id, jobsPublic.enabled, taskPaid) } : null,
      hospital: c.hospitalUntil && c.hospitalUntil.getTime() > now ? { until: c.hospitalUntil.toISOString(), startedAt: c.hospitalStartedAt?.toISOString() ?? null, venueId: c.locationId } : null,
      medicalBill: unpaidBill ? { id: unpaidBill.id, amount: unpaidBill.amount, fullAmount: unpaidBill.fullAmount, label: unpaidBill.label, createdAt: unpaidBill.createdAt.toISOString() } : null,
      samu: {
        callBelowHealth: samuCfg.callBelowHealth,
        stayGameHours: samuCfg.stayGameHours,
        fee: samuCfg.fee,
        hospitalId: samuCfg.hospitalByCity[c.city] ?? samuCfg.hospitalByCity.default,
        canCall: n.health <= samuCfg.callBelowHealth && !unpaidBill && !(c.hospitalUntil && c.hospitalUntil.getTime() > now),
      },
      jobs: held.map((j) => ({ id: j.id, nameFr: j.nameFr, nameEn: j.nameEn, emoji: j.emoji, payPerShift: j.payPerShift, shiftGameHours: j.shiftGameHours, payMode: payModeOf(j.id, jobsPublic.enabled, taskPaid), nextInGameHours: waitFor(j) })),
      maxJobs: await this.settings.get('work.maxJobs'),
      nextWorkInGameHours: c.job && jobLastWorked(c.jobWorkedAt, c.job.id) ? Math.max(0, c.job.shiftGameHours - gameHoursBetween(clock, jobLastWorked(c.jobWorkedAt, c.job.id)!, now)) : 0,
      nextTvInGameHours: await this.leisureWait(clock, now, c.leisureAt, 'tv'),
      nextReadInGameHours: await this.leisureWait(clock, now, c.leisureAt, 'read'),
      hasTv: TV_HOUSING.includes(c.housing),
      freezer: await this.freezerState(c.id, c.hasFreezer),
      doneToday: await this.doneToday(c.id),
      nextMusicInGameHours: c.lastMusicAt ? Math.max(0, (await this.settings.get('action.music')).cooldownGameHours - gameHoursBetween(clock, c.lastMusicAt.getTime(), now)) : 0,
      sleepPlan: await (async () => {
        const r = await this.settings.get('action.sleep');
        const t = gameTimeAt(clock, now);
        return { hours: sleepGameHours(t.hour * 60 + t.minute, r), fromHour: r.fromHour };
      })(),
      sleep: c.sleepUntil && c.sleepUntil.getTime() > now ? { startedAt: c.sleepStartedAt?.toISOString() ?? null, until: c.sleepUntil.toISOString() } : null,
      nextRestInGameHours: c.lastRestAt ? Math.max(0, restCfg.cooldownGameHours - gameHoursBetween(clock, c.lastRestAt.getTime(), now)) : 0,
      rent: await this.rentView(c, time.day, rent),
      bills: await this.billsView(c, time.day),
      amu: await (async () => {
        const a = await this.settings.get('amu');
        return { covered: c.amuPaidUntilGameDay >= time.day, paidUntilGameDay: c.amuPaidUntilGameDay, monthly: a.voluntaryMonthly, coverageBp: a.coverageBp, hospitals: a.hospitals };
      })(),
      gameTime: time,
      secondsPerGameDay: clock.secondsPerGameDay,
      // Maladie : le nom n'est connu qu'après une consultation ; avant, seuls les symptômes sont visibles
      illness: c.illnessId ? { id: c.diagnosed ? c.illnessId : null, sinceDay: c.illnessDay, diagnosed: c.diagnosed } : null,
      familyPending: await this.prisma.familyRequest.count({ where: { characterId: c.id, status: 'PENDING' } }),
      outages: {
        power: !!c.powerCutUntil && c.powerCutUntil.getTime() > now,
        water: !!c.waterCutUntil && c.waterCutUntil.getTime() > now,
        powerUntil: c.powerCutUntil && c.powerCutUntil.getTime() > now ? c.powerCutUntil.toISOString() : null,
        waterUntil: c.waterCutUntil && c.waterCutUntil.getTime() > now ? c.waterCutUntil.toISOString() : null,
      },
      equipment: { generator: c.generator, solar: c.solar, waterTank: c.waterTank },
      // Actualité économique de la semaine (commune à tous) : le front ajuste ses estimations de tarif
      economy: await (async () => {
        const ev = await this.settings.get('economy.events');
        return { events: activeEvents(time.day, ev).map((e) => e.id), transportBp: transportFactorBp(time.day, ev) };
      })(),
    };
  }

  /** Séance de travail en cours (missions), ou null. */
  private async openShift(characterId: string) {
    const s = await this.prisma.workShift.findFirst({ where: { characterId, closedAt: null, endsAt: { gt: new Date() } }, orderBy: { startedAt: 'desc' } });
    return s ? { id: s.id, kind: s.kind, sourceId: s.sourceId, orders: s.orders, endsAt: s.endsAt.toISOString() } : null;
  }

  /** Loyer : échéance, retard et pénalité, délai avant expulsion, dette, caution, logements proposés. */
  private async rentView(c: Character, today: number, monthly: number) {
    const rules = await this.settings.get('rent.rules');
    const rents = await this.settings.get('rent.monthly');
    const prices = await this.settings.get('housing.price');
    const tenant = !c.homeOwned && !c.homeless;
    const months = tenant ? overdueMonths(c.rentPaidUntilGameDay, today) : 0;
    return {
      monthly: c.homeOwned ? 0 : monthly,
      paidUntilGameDay: c.rentPaidUntilGameDay,
      overdue: months > 0,
      overdueMonths: months,
      nextPayment: tenant ? nextRentPayment(BigInt(monthly), c.rentPaidUntilGameDay, today, rules.lateFeeBpPerDay).toString() : '0',
      lateFeeBpPerDay: rules.lateFeeBpPerDay,
      overdueDays: tenant ? overdueDays(c.rentPaidUntilGameDay, today) : 0,
      evictInDays: months > 0 ? rules.evictAfterMonths * GAME_DAYS_PER_MONTH - (today - c.rentPaidUntilGameDay) : null,
      owned: c.homeOwned,
      homeless: c.homeless,
      debt: c.rentDebt.toString(),
      deposit: c.rentDeposit.toString(),
      price: c.homeOwned ? 0 : (prices[c.housing as Housing] ?? 0),
      offers: HOUSING_LADDER.map((h) => ({ housing: h, monthly: rents[h], deposit: rents[h] * rules.depositMonths, price: prices[h] })),
    };
  }

  /** Résumé de l'entreprise pour l'état du jeu (null si aucune). */
  private async companyState(characterId: string, today: number) {
    const all = await this.prisma.company.findMany({ where: { characterId, status: { not: 'CLOSED' } }, orderBy: { createdAt: 'asc' } });
    const activeId = await activeCompanyId(this.prisma, characterId);
    const co = all.find((x) => x.id === activeId);
    if (!co) return null;
    const clock = await this.settings.clock();
    const now = Date.now();
    const act = (await this.settings.get('company.activities')).find((a) => a.id === co.activityId);
    const decl = computeDeclaration(
      { lastDeclaredMonth: co.lastDeclaredMonth, createdMonth: co.createdMonth, today, pendingRevenue: co.pendingRevenue, plantRevenue: co.pendingPlantRevenue },
      await this.settings.get('company.contributions'),
    );
    return {
      id: co.id,
      companies: all.map((x) => ({ id: x.id, name: x.name, activityId: x.activityId, status: x.status })),
      maxCompanies: (await this.settings.get('company.portfolio')).maxCompanies,
      salePrice: act && co.status === 'REGISTERED' ? companySalePrice(act, await this.prisma.employee.count({ where: { companyId: co.id, active: true } }), await this.settings.get('company.portfolio')).toString() : '0',
      name: co.name,
      form: co.form,
      activityId: co.activityId,
      status: co.status,
      readyInGameHours: co.status === 'PENDING_CFE' ? Math.max(0, gameHoursBetween(clock, now, co.readyAt.getTime())) : 0,
      rccm: co.rccm,
      nif: co.nif,
      cnssNumber: co.cnssNumber,
      nextShiftInGameHours: co.lastWorkedAt && act ? Math.max(0, act.shiftGameHours - gameHoursBetween(clock, co.lastWorkedAt.getTime(), now)) : 0,
      pendingRevenue: co.pendingRevenue.toString(),
      declaration: decl ? Object.fromEntries(Object.entries(decl).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])) : null,
    };
  }

  eat(accountId: string, foodId: string, idem?: string) {
    return this.act(accountId, async (tx, c) => {
      const key = idem ? `eat:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`eat|${foodId}`);
      // Rejeu : on renvoie le résultat sans réappliquer aucun effet ni débit.
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { food: foodId, paid: 0, replay: true };
      const food = await tx.foodItem.findUnique({ where: { id: foodId } });
      if (!food || !food.enabled) throw new NotFoundException('unknown_food');
      await this.ledger.post(tx, {
        kind: 'FOOD',
        idempotencyKey: key,
        requestHash,
        memo: food.id,
        legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(food.price) }],
      });
      // Un vrai repas remonte l'énergie au moins au plancher des paramètres (food.meal)
      const n = withMealEnergy(applyEffects(needsOf(c), { hunger: food.hunger, energy: food.energy, morale: food.morale, health: food.health }), food.hunger, await this.settings.get('food.meal'));
      await tx.character.update({ where: { id: c.id }, data: n });
      return { food: food.id, paid: food.price, replay: false };
    });
  }

  /** Acheter un congélateur (une seule fois) : prix décidé par le serveur, payé au marché. */
  buyFreezer(accountId: string) {
    return this.act(accountId, async (tx, c) => {
      if (c.locationId !== HOME) throw new BadRequestException('not_at_home');
      if (c.hasFreezer) throw new ConflictException('already_owned');
      const cfg = await this.settings.get('freezer');
      await this.ledger.post(tx, { kind: 'FREEZER', memo: 'freezer', legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(cfg.price) }] });
      await tx.character.update({ where: { id: c.id }, data: { hasFreezer: true } });
      return { paid: cfg.price };
    });
  }

  /** Ravitailler le congélateur : `qty` portions d'un plat, avec la remise « en gros », dans la limite de la capacité. */
  stockFreezer(accountId: string, foodId: string, qty: number, idem?: string) {
    return this.act(accountId, async (tx, c) => {
      // Rejeu (double appui, réseau qui décroche) : ni second débit ni portions en double
      const key = idem ? `freezer-stock:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`freezer-stock|${foodId}|${qty}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { food: foodId, qty, paid: '0', replay: true };
      if (c.locationId !== HOME) throw new BadRequestException('not_at_home');
      if (!c.hasFreezer) throw new BadRequestException('no_freezer');
      const cfg = await this.settings.get('freezer');
      const food = await tx.foodItem.findUnique({ where: { id: foodId } });
      if (!food || !food.enabled) throw new NotFoundException('unknown_food');
      const used = (await tx.freezerItem.aggregate({ where: { characterId: c.id }, _sum: { qty: true } }))._sum.qty ?? 0;
      if (used + qty > cfg.capacity) throw new BadRequestException('freezer_full');
      const unit = (BigInt(food.price) * BigInt(10_000 - cfg.discountBp)) / 10_000n;
      const total = unit * BigInt(qty);
      if (total > 0n) await this.ledger.post(tx, { kind: 'FREEZER_STOCK', idempotencyKey: key, requestHash, memo: `${food.id}x${qty}`, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: total }] });
      await tx.freezerItem.upsert({ where: { characterId_foodId: { characterId: c.id, foodId } }, create: { characterId: c.id, foodId, qty }, update: { qty: { increment: qty } } });
      return { food: food.id, qty, paid: total.toString(), replay: false };
    });
  }

  /** Manger une portion du congélateur : mêmes effets que le plat, sans rien payer sur le moment. */
  eatFromFreezer(accountId: string, foodId: string) {
    return this.act(accountId, async (tx, c) => {
      if (c.locationId !== HOME) throw new BadRequestException('not_at_home');
      const taken = await tx.freezerItem.updateMany({ where: { characterId: c.id, foodId, qty: { gte: 1 } }, data: { qty: { decrement: 1 } } });
      if (taken.count !== 1) throw new BadRequestException('not_in_freezer');
      const food = await tx.foodItem.findUnique({ where: { id: foodId } });
      if (!food) throw new NotFoundException('unknown_food');
      const n = withMealEnergy(applyEffects(needsOf(c), { hunger: food.hunger, energy: food.energy, morale: food.morale, health: food.health }), food.hunger, await this.settings.get('food.meal'));
      await tx.character.update({ where: { id: c.id }, data: n });
      return { food: food.id };
    });
  }

  /** Métier ouvert au personnage : sans diplôme, ou certificat d'un cours qui le débloque, ou diplôme qui remplit sa condition. */
  async qualifiedFor(tx: Tx, characterId: string, job: { id: string; level: string }): Promise<boolean> {
    if (job.level === 'DEBROUILLE') return true;
    const courses = (await this.settings.get('school.courses')).filter((x) => x.unlocks.includes(job.id)).map((x) => x.id);
    const byCourse = courses.length > 0 && (await tx.enrollment.count({ where: { characterId, courseId: { in: courses }, completedAt: { not: null } } })) > 0;
    const req = (await this.settings.get('study')).jobReq[job.id];
    const byDiploma = !!req && meetsReq(req, await tx.diploma.findMany({ where: { characterId }, select: { kind: true, domain: true } }));
    return byCourse || byDiploma;
  }

  takeJob(accountId: string, jobId: string) {
    return this.act(accountId, async (tx, c) => {
      const job = await tx.job.findUnique({ where: { id: jobId } });
      if (!job || !job.enabled) throw new NotFoundException('unknown_job');
      if (!(await this.qualifiedFor(tx, c.id, job))) throw new BadRequestException('job_locked');
      // Métier salarié : il faut d'abord y être embauché (candidature dans l'appli Travail)
      if (payModeOf(job.id, (await this.settings.get('jobs.public')).enabled, await this.settings.get('jobs.taskPaid')) === 'MONTHLY' && !(await tx.employee.findFirst({ where: { characterId: c.id, active: true, publicJobId: job.id }, select: { id: true } }))) throw new BadRequestException('job_needs_contract');
      // Plusieurs métiers à la fois (plafond work.maxJobs) ; reprendre un métier déjà occupé revient à le rendre actif.
      const held = new Set([...c.jobIds, ...(c.jobId ? [c.jobId] : [])]);
      if (!held.has(job.id) && held.size >= (await this.settings.get('work.maxJobs'))) {
        // Au plafond : le nouveau métier prend la place d'un métier à la tâche (le métier actif d'abord, sinon le plus ancien), pour
        // changer de métier quand on veut. Un emploi salarié se quitte par la démission (contrat) : jamais remplacé en silence.
        const enabled = (await this.settings.get('jobs.public')).enabled;
        const taskPaid = await this.settings.get('jobs.taskPaid');
        const victim = [...new Set([...(c.jobId ? [c.jobId] : []), ...c.jobIds])].find((id) => payModeOf(id, enabled, taskPaid) !== 'MONTHLY');
        if (!victim) throw new BadRequestException('too_many_jobs');
        held.delete(victim);
      }
      held.add(job.id);
      await tx.character.update({ where: { id: c.id }, data: { jobId: job.id, jobIds: [...held] } });
      return { job: job.id };
    });
  }

  /** Part du patient pour un acte à l'hôpital conventionné (l'AMU rembourse `coverageBp` si le joueur est couvert). */
  private async hospitalShare(c: { amuPaidUntilGameDay: number }, hospitalId: string, full: number): Promise<number> {
    const amu = await this.settings.get('amu');
    const insured = amu.hospitals.includes(hospitalId) && c.amuPaidUntilGameDay >= gameTimeAt(await this.settings.clock(), Date.now()).day;
    return insured ? full - Math.floor((full * amu.coverageBp) / 10_000) : full;
  }

  /** Sortie de l'hôpital après une urgence : forces, énergie, faim, moral remontés (jamais abaissés), maladie soignée, facture. */
  private async dischargeHospital(tx: Tx, c: Character): Promise<Character> {
    const cfg = await this.settings.get('emergency.samu');
    const r = cfg.restore;
    const n = needsOf(c);
    // Le patient est déjà sur place (`c.locationId`, posé par `callSamu` dans sa propre ville) : on garde cet hôpital.
    const hospitalId = c.locationId ?? cfg.hospitalByCity[c.city] ?? cfg.hospitalByCity.default;
    const amount = await this.hospitalShare(c, hospitalId, cfg.fee);
    if (amount > 0) await tx.medicalBill.create({ data: { characterId: c.id, amount, fullAmount: cfg.fee, label: 'samu' } });
    return tx.character.update({
      where: { id: c.id },
      data: {
        health: Math.max(n.health, r.health),
        energy: Math.max(n.energy, r.energy),
        hunger: Math.max(n.hunger, r.hunger),
        hygiene: Math.max(n.hygiene, r.hygiene),
        morale: Math.max(n.morale, r.morale),
        illnessId: null,
        illnessDay: null,
        diagnosed: false,
        hospitalUntil: null,
        hospitalStartedAt: null,
        needsUpdatedAt: new Date(),
        locationId: hospitalId,
      },
    });
  }

  /** Appeler le SAMU quand la santé est basse : transfert à l'hôpital de sa ville, prise en charge de quelques heures, puis facture. */
  callSamu(accountId: string) {
    return this.act(accountId, async (tx, c) => {
      const cfg = await this.settings.get('emergency.samu');
      if (c.health > cfg.callBelowHealth) throw new BadRequestException('not_urgent');
      if (await tx.medicalBill.findFirst({ where: { characterId: c.id, paidAt: null } })) throw new BadRequestException('unpaid_bill');
      const hospitalId = cfg.hospitalByCity[c.city] ?? cfg.hospitalByCity.default;
      const venue = await tx.venue.findUnique({ where: { id: hospitalId }, select: { enabled: true } });
      if (!venue?.enabled) throw new BadRequestException('hospital_unavailable');
      const now = Date.now();
      const until = new Date(Math.ceil(realMsAfterGameHours(await this.settings.clock(), now, cfg.stayGameHours)));
      await tx.character.update({ where: { id: c.id }, data: { hospitalStartedAt: new Date(now), hospitalUntil: until, locationId: hospitalId, sleepUntil: null, sleepStartedAt: null } });
      return { hospital: hospitalId, until: until.toISOString() };
    });
  }

  /** Régler la facture de soins (urgence) : prélevée sur le portefeuille, montant décidé par le serveur. */
  payMedicalBill(accountId: string, idem?: string) {
    return this.act(accountId, async (tx, c) => {
      // Rejeu d'un paiement déjà fait : on ne règle pas la facture suivante à la place
      const key = idem ? `samu:${c.id}:${idem}` : undefined;
      if (key && (await this.ledger.findReplay(tx, key, sha256Hex('samu-pay')))) return { paid: 0, covered: 0, replay: true };
      const bill = await tx.medicalBill.findFirst({ where: { characterId: c.id, paidAt: null }, orderBy: { createdAt: 'asc' } });
      if (!bill) throw new BadRequestException('no_bill');
      await this.ledger.post(tx, { kind: 'MEDICAL_BILL', idempotencyKey: key ?? `medical-bill:${bill.id}`, requestHash: key ? sha256Hex('samu-pay') : sha256Hex(`medical-bill|${bill.id}`), memo: bill.label, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(bill.amount) }] });
      await tx.medicalBill.update({ where: { id: bill.id }, data: { paidAt: new Date() } });
      return { paid: bill.amount, covered: bill.fullAmount - bill.amount, replay: false };
    });
  }

  /** Quitte un métier (le métier actif par défaut) ; un autre métier occupé prend alors le relais. */
  quitJob(accountId: string, jobId?: string) {
    return this.act(accountId, async (tx, c) => {
      const held = new Set([...c.jobIds, ...(c.jobId ? [c.jobId] : [])]);
      const target = jobId ?? c.jobId;
      if (!target || !held.has(target)) throw new BadRequestException('no_job');
      held.delete(target);
      const active = c.jobId === target ? ([...held][0] ?? null) : c.jobId;
      await tx.character.update({ where: { id: c.id }, data: { jobId: active, jobIds: [...held] } });
      // Emploi salarié public : quitter le métier met fin à son contrat (sinon « déjà employé » bloquerait toute nouvelle candidature)
      await tx.employee.updateMany({ where: { characterId: c.id, active: true, publicJobId: target }, data: { active: false } });
      return { job: active };
    });
  }

  work(accountId: string) {
    return this.act(accountId, async (tx, c) => {
      if (!c.jobId) throw new BadRequestException('no_job');
      const job = await tx.job.findUniqueOrThrow({ where: { id: c.jobId } });
      if (!job.enabled) throw new BadRequestException('job_disabled');
      // Un métier salarié ne se paie pas au service : le salaire est versé chaque mois (voir /jobs/salary)
      if (payModeOf(job.id, (await this.settings.get('jobs.public')).enabled, await this.settings.get('jobs.taskPaid')) === 'MONTHLY') throw new BadRequestException('job_monthly');
      const clock = await this.settings.clock();
      const last = jobLastWorked(c.jobWorkedAt, job.id);
      if (last && gameHoursBetween(clock, last, Date.now()) < job.shiftGameHours) {
        throw new BadRequestException('still_working');
      }
      if (c.energy < job.energyCost) throw new BadRequestException('too_tired');
      if (c.health < 20) throw new BadRequestException('too_sick');

      const incident = job.riskPercent > 0 && randomInt(100) < job.riskPercent;
      const gross = incident ? Math.floor(job.payPerShift / 2) : job.payPerShift;
      // Salarié du privé : cotisations salariales CNSS et AMU retenues à la source (l'employeur les reverse)
      const rates = await this.settings.get('payroll.rates');
      const cnss = Math.floor((gross * rates.cnssEmployeeBp) / 10_000);
      const amu = Math.floor((gross * rates.amuEmployeeBp) / 10_000);
      const pay = gross - cnss - amu;
      await this.ledger.post(tx, {
        kind: 'WAGE',
        idempotencyKey: `work:${c.id}:${Date.now()}`,
        memo: job.id,
        legs: [{ from: await this.ledger.systemWalletId(tx, 'TREASURY'), to: c.walletId, amount: BigInt(pay) }],
      });
      const today = gameTimeAt(clock, Date.now()).day;
      const n = applyEffects(needsOf(c), {
        energy: -job.energyCost,
        hunger: -job.hungerCost,
        hygiene: -job.hygieneCost,
        health: incident ? -15 : 0,
        morale: incident ? -10 : 2,
      });
      await tx.character.update({ where: { id: c.id }, data: { ...n, lastWorkedAt: new Date(), jobWorkedAt: markJobWorked(c.jobWorkedAt, job.id, Date.now()), amuPaidUntilGameDay: Math.max(c.amuPaidUntilGameDay, today + GAME_DAYS_PER_MONTH) } });
      return { paid: pay, gross, cnss, amu, incident };
    });
  }

  /** Client de l'hôtel présent sur place avec un séjour en cours : il peut dormir et se reposer dans sa chambre. */
  private async inHotelRoom(tx: Tx, c: Character): Promise<boolean> {
    const cfg = await this.settings.get('hotel');
    if (c.locationId !== cfg.venueId) return false;
    return !!(await activeStay(tx, c.id, cfg.venueId, gameTimeAt(await this.settings.clock(), Date.now()).day));
  }

  /** Se coucher (à partir de `action.sleep.fromHour`) : on dort jusqu'à l'heure de réveil, entre 6 et 8 h de jeu ; l'énergie revient au réveil. */
  sleep(accountId: string) {
    return this.act(accountId, async (tx, c) => {
      if (c.locationId !== HOME && !(await this.inHotelRoom(tx, c))) throw new BadRequestException('not_at_home');
      const cfg = await this.settings.get('action.sleep');
      const now = Date.now();
      const clock = await this.settings.clock();
      const t = gameTimeAt(clock, now);
      const hours = sleepGameHours(t.hour * 60 + t.minute, cfg);
      if (hours === null) throw new BadRequestException('not_bedtime');
      const until = new Date(Math.ceil(realMsAfterGameHours(clock, now, hours)));
      await tx.character.update({ where: { id: c.id }, data: { sleepStartedAt: new Date(now), sleepUntil: until } });
      return { sleepUntil: until.toISOString() };
    });
  }

  /** Se réveiller avant l'heure : énergie au prorata du temps dormi. */
  wake(accountId: string) {
    return this.act(
      accountId,
      async (tx, c) => {
        if (!c.sleepUntil || !c.sleepStartedAt) return { energyGain: 0 };
        const span = c.sleepUntil.getTime() - c.sleepStartedAt.getTime();
        const ratio = span > 0 ? Math.min(1, (Date.now() - c.sleepStartedAt.getTime()) / span) : 1;
        const after = await this.finishSleep(tx, c, ratio);
        return { energyGain: after.energy - c.energy };
      },
      { whileAsleep: true },
    );
  }

  /** Fin de nuit : énergie (moins si courant coupé, bien moins à la rue) et moral selon les conditions. */
  private async finishSleep(tx: Tx, c: Character, ratio: number): Promise<Character> {
    const clock = await this.settings.clock();
    const cfg = await this.settings.get('action.sleep');
    const rest = await this.settings.get('action.rest');
    // Sieste : sommeil plus court que la nuit minimale, récompensé comme un repos
    const nap = !!c.sleepStartedAt && !!c.sleepUntil && gameHoursBetween(clock, c.sleepStartedAt.getTime(), c.sleepUntil.getTime()) < 4;
    const gain = nap ? rest.energyGain : cfg.energyGain;
    const moraleBase = nap ? 2 : cfg.moraleGain;
    const today = gameTimeAt(clock, Date.now()).day;
    const dark = c.elecPaidUntilGameDay < today;
    const wifi = !dark && c.wifiPaidUntilGameDay >= today;
    const full = c.homeless ? Math.floor(gain / 4) : dark ? Math.floor(gain / 2) : gain;
    const n = applyEffects(needsOf(c), { energy: Math.round(full * ratio), morale: Math.round((c.homeless ? -5 : dark ? -2 : moraleBase + (wifi ? (nap ? 3 : 2) : 0)) * ratio) });
    return tx.character.update({ where: { id: c.id }, data: { ...n, sleepStartedAt: null, sleepUntil: null, lastRestAt: new Date() } });
  }

  rest(accountId: string) {
    return this.act(accountId, async (tx, c) => {
      if (c.locationId !== HOME && !(await this.inHotelRoom(tx, c))) throw new BadRequestException('not_at_home');
      const cfg = await this.settings.get('action.rest');
      const clock = await this.settings.clock();
      if (c.lastRestAt && gameHoursBetween(clock, c.lastRestAt.getTime(), Date.now()) < cfg.cooldownGameHours) {
        throw new BadRequestException('cannot_rest_yet');
      }
      // Sieste : on dort `napGameHours` heures de jeu ; l'énergie est rendue au réveil (voir finishSleep)
      if (cfg.napGameHours > 0) {
        const now = Date.now();
        const until = new Date(Math.ceil(realMsAfterGameHours(clock, now, cfg.napGameHours)));
        await tx.character.update({ where: { id: c.id }, data: { sleepStartedAt: new Date(now), sleepUntil: until } });
        return { energyGain: 0, powerCut: false, napUntil: until.toISOString() };
      }
      // Courant coupé : pas de ventilateur, sommeil moins réparateur ; wifi actif : un peu de moral en plus
      const today = gameTimeAt(clock, Date.now()).day;
      const dark = c.elecPaidUntilGameDay < today;
      const wifi = !dark && c.wifiPaidUntilGameDay >= today;
      // À la rue : on dort mal et on perd le moral
      const energyGain = c.homeless ? Math.floor(cfg.energyGain / 4) : dark ? Math.floor(cfg.energyGain / 2) : cfg.energyGain;
      const n = applyEffects(needsOf(c), { energy: energyGain, morale: c.homeless ? -5 : dark ? -2 : wifi ? 5 : 2 });
      await tx.character.update({ where: { id: c.id }, data: { ...n, lastRestAt: new Date() } });
      return { energyGain, powerCut: dark };
    });
  }

  /** Adhésion volontaire à l'AMU (indépendant, sans emploi) : un mois de couverture, au plus 3 mois d'avance. */
  payAmu(accountId: string, idem?: string) {
    return this.act(accountId, async (tx, c) => {
      const key = idem ? `amu:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex('amu');
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { paid: 0, replay: true };
      const cfg = await this.settings.get('amu');
      const today = gameTimeAt(await this.settings.clock(), Date.now()).day;
      if (c.amuPaidUntilGameDay - today >= MAX_RENT_MONTHS_AHEAD * GAME_DAYS_PER_MONTH) throw new BadRequestException('amu_paid_ahead');
      if (cfg.voluntaryMonthly > 0) {
        await this.ledger.post(tx, {
          kind: 'AMU',
          idempotencyKey: key,
          requestHash,
          legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'TREASURY'), amount: BigInt(cfg.voluntaryMonthly) }],
        });
      }
      await tx.character.update({ where: { id: c.id }, data: { amuPaidUntilGameDay: Math.max(c.amuPaidUntilGameDay, today) + GAME_DAYS_PER_MONTH } });
      return { paid: cfg.voluntaryMonthly, replay: false };
    });
  }

  /** Écouter de la musique à la maison : un peu de moral et d'énergie, avec un délai entre deux écoutes. */
  listenMusic(accountId: string) {
    return this.act(accountId, async (tx, c) => {
      if (c.locationId !== HOME) throw new BadRequestException('not_at_home');
      const cfg = await this.settings.get('action.music');
      const clock = await this.settings.clock();
      if (c.lastMusicAt && gameHoursBetween(clock, c.lastMusicAt.getTime(), Date.now()) < cfg.cooldownGameHours) throw new BadRequestException('cannot_music_yet');
      const n = applyEffects(needsOf(c), { morale: cfg.moraleGain, energy: cfg.energyGain });
      await tx.character.update({ where: { id: c.id }, data: { ...n, lastMusicAt: new Date() } });
      return { moraleGain: cfg.moraleGain, energyGain: cfg.energyGain };
    });
  }

  private async leisureWait(clock: ClockConfig, now: number, at: Prisma.JsonValue, kind: 'tv' | 'read'): Promise<number> {
    const last = leisureLast(at, kind);
    if (!last) return 0;
    const cfg = await this.settings.get(kind === 'tv' ? 'action.tv' : 'action.read');
    return Math.max(0, cfg.cooldownGameHours - gameHoursBetween(clock, last, now));
  }

  /** Loisir gratuit à la maison : télé (logement qui en a une) ou lecture, chacun avec son délai. */
  leisure(accountId: string, kind: 'tv' | 'read') {
    return this.act(accountId, async (tx, c) => {
      if (c.locationId !== HOME) throw new BadRequestException('not_at_home');
      if (kind === 'tv' && !TV_HOUSING.includes(c.housing)) throw new BadRequestException('no_tv');
      if (kind === 'tv' && c.powerCutUntil && c.powerCutUntil.getTime() > Date.now() && !c.generator && !c.solar) throw new BadRequestException('power_outage');
      const cfg = await this.settings.get(kind === 'tv' ? 'action.tv' : 'action.read');
      const clock = await this.settings.clock();
      const last = leisureLast(c.leisureAt, kind);
      if (last && gameHoursBetween(clock, last, Date.now()) < cfg.cooldownGameHours) throw new BadRequestException(kind === 'tv' ? 'cannot_tv_yet' : 'cannot_read_yet');
      const n = applyEffects(needsOf(c), { morale: cfg.moraleGain, energy: cfg.energyGain });
      const leisureAt = { ...(c.leisureAt && typeof c.leisureAt === 'object' && !Array.isArray(c.leisureAt) ? c.leisureAt : {}), [kind]: new Date().toISOString() };
      await tx.character.update({ where: { id: c.id }, data: { ...n, leisureAt } });
      return { moraleGain: cfg.moraleGain, energyGain: cfg.energyGain };
    });
  }

  wash(accountId: string, idem?: string) {
    return this.act(accountId, async (tx, c) => {
      const key = idem ? `wash:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex('wash');
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { paid: 0, replay: true };
      if (c.locationId !== HOME) throw new BadRequestException('not_at_home');
      if (c.waterPaidUntilGameDay < gameTimeAt(await this.settings.clock(), Date.now()).day) throw new BadRequestException('water_cut');
      if (c.waterCutUntil && c.waterCutUntil.getTime() > Date.now() && !c.waterTank) throw new BadRequestException('water_outage');
      // Se laver ne se paie pas sur le moment : l'eau consommée est comptée et réglée avec la facture d'eau du mois.
      const cfg = await this.settings.get('action.wash');
      const n = applyEffects(needsOf(c), { hygiene: cfg.hygieneGain, morale: 1 });
      await tx.character.update({ where: { id: c.id }, data: { ...n, waterShowers: { increment: 1 } } });
      // Coût estimé de cette douche sur la facture (litres d'une douche au prix de la première tranche)
      const w = await this.settings.get('bills.water');
      return { paid: 0, billed: Math.round((w.showerLitres * (w.tranches[0]?.price ?? 0)) / 1000), replay: false };
    });
  }

  payRent(accountId: string, idem?: string) {
    return this.act(accountId, async (tx, c) => {
      const key = idem ? `rent:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`rent|${c.housing}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { paid: 0, replay: true };
      if (c.homeOwned) throw new BadRequestException('home_owned');
      if (c.homeless) throw new BadRequestException('homeless');
      const rent = (await this.settings.get('rent.monthly'))[c.housing as 'VILLA' | 'CHAMBRE_SALON' | 'ENTRER_COUCHER'];
      if (rent === undefined) throw new BadRequestException('unknown_housing');
      const today = gameTimeAt(await this.settings.clock(), Date.now()).day;
      if (c.rentPaidUntilGameDay - today >= MAX_RENT_MONTHS_AHEAD * GAME_DAYS_PER_MONTH) throw new BadRequestException('rent_paid_ahead');
      // En retard : on règle le plus ancien mois dû, majoré de la pénalité ; rien n'est effacé
      const late = overdueMonths(c.rentPaidUntilGameDay, today);
      const amount = nextRentPayment(BigInt(rent), c.rentPaidUntilGameDay, today, (await this.settings.get('rent.rules')).lateFeeBpPerDay);
      if (amount > 0n) {
        await this.ledger.post(tx, {
          kind: 'RENT',
          idempotencyKey: key,
          requestHash,
          legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'LANDLORD'), amount }],
        });
      }
      const base = late > 0 ? c.rentPaidUntilGameDay : Math.max(c.rentPaidUntilGameDay, today);
      await tx.character.update({ where: { id: c.id }, data: { rentPaidUntilGameDay: base + GAME_DAYS_PER_MONTH, respect: Math.min(100, c.respect + (late > 0 ? 0 : 1)) } });
      return { paid: Number(amount), replay: false };
    });
  }

  /** Rembourser la dette laissée par une expulsion (en partie si le solde ne suffit pas). */
  payRentDebt(accountId: string, idem?: string) {
    return this.act(accountId, async (tx, c) => {
      const key = idem ? `rentdebt:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`rentdebt|${c.rentDebt}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { paid: 0, replay: true };
      if (c.rentDebt <= 0n) throw new BadRequestException('no_rent_debt');
      const w = await tx.wallet.findUniqueOrThrow({ where: { id: c.walletId }, select: { balance: true } });
      const amount = w.balance < c.rentDebt ? w.balance : c.rentDebt;
      if (amount <= 0n) throw new BadRequestException('insufficient_funds');
      await this.ledger.post(tx, {
        kind: 'RENT_DEBT',
        idempotencyKey: key,
        requestHash,
        legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'LANDLORD'), amount }],
      });
      await tx.character.update({ where: { id: c.id }, data: { rentDebt: c.rentDebt - amount } });
      return { paid: Number(amount), replay: false };
    });
  }

  /**
   * Changer de logement (ou en retrouver un après la rue) : la caution de l'ancien logement est rendue,
   * la nouvelle caution et le premier mois sont payés. Interdit avec un loyer en retard ou une dette.
   */
  moveHousing(accountId: string, housing: string, idem?: string) {
    return this.act(accountId, async (tx, c) => {
      const key = idem ? `move:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`move|${housing}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { paid: 0, replay: true };
      const target = HOUSING_LADDER.find((h) => h === housing);
      if (!target) throw new BadRequestException('unknown_housing');
      if (c.homeOwned) throw new BadRequestException('home_owned');
      if (c.rentDebt > 0n) throw new BadRequestException('rent_debt');
      const today = gameTimeAt(await this.settings.clock(), Date.now()).day;
      if (!c.homeless && overdueMonths(c.rentPaidUntilGameDay, today) > 0) throw new BadRequestException('rent_overdue');
      if (!c.homeless && target === c.housing) throw new BadRequestException('same_housing');
      const rules = await this.settings.get('rent.rules');
      const monthly = BigInt((await this.settings.get('rent.monthly'))[target]);
      const deposit = monthly * BigInt(rules.depositMonths);
      const net = deposit + monthly - c.rentDeposit;
      const landlord = await this.ledger.systemWalletId(tx, 'LANDLORD');
      if (net !== 0n) {
        await this.ledger.post(tx, {
          kind: 'RENT_MOVE',
          idempotencyKey: key,
          requestHash,
          memo: target,
          legs: [net > 0n ? { from: c.walletId, to: landlord, amount: net } : { from: landlord, to: c.walletId, amount: -net }],
        });
      }
      const n = applyEffects(needsOf(c), { morale: c.homeless ? 15 : 5 });
      await tx.character.update({
        where: { id: c.id },
        data: { ...n, housing: target, homeless: false, rentDeposit: deposit, rentPaidUntilGameDay: today + GAME_DAYS_PER_MONTH, rentNagDay: today, homeX: null, homeZ: null },
      });
      return { paid: Number(net), replay: false };
    });
  }

  /** Factures du logement : montant mensuel, échéance, retard (le wifi est facultatif). */
  /** Jours de retard d'une facture : le retard ne court pas avant la création du personnage (jamais abonné jusque-là). */
  private async billDaysLate(paidUntilGameDay: number, createdAt: Date, today: number): Promise<number> {
    const born = gameTimeAt(await this.settings.clock(), createdAt.getTime()).day;
    return overdueDays(Math.max(paidUntilGameDay, born), today);
  }

  /**
   * Facture d'électricité du mois, selon le contexte du joueur : abonnement du logement, éclairage, appareils installés
   * (meubles du logement en place, appareils de cuisine, congélateur), cuissons au réchaud électrique depuis la dernière facture,
   * panneaux solaires ; énergie facturée par tranches de kWh.
   */
  private async powerOf(db: Tx | PrismaService, c: { id: string; housing: string; solar: boolean; elecKwhUsed: number; hasFreezer: boolean }) {
    const p = await this.settings.get('bills.power');
    const h = c.housing as Housing;
    const [furniture, kitchen] = await Promise.all([
      db.homeItem.findMany({ where: { characterId: c.id, housing: c.housing }, select: { itemId: true } }),
      db.kitchenAppliance.findMany({ where: { characterId: c.id }, select: { applianceId: true } }),
    ]);
    const ids = [...furniture.map((f) => f.itemId), ...kitchen.map((k) => k.applianceId), ...(c.hasFreezer ? ['freezer'] : [])];
    const appliances = ids.filter((id) => (p.applianceKwh[id] ?? 0) > 0);
    const appliancesKwh = appliances.reduce((n, id) => n + (p.applianceKwh[id] ?? 0), 0);
    const bill = powerBill({ baseKwh: p.baseKwh[h] ?? 0, appliancesKwh, cookingKwh: c.elecKwhUsed, solarBp: c.solar ? p.solarBp : 0 }, p.subscription[h] ?? 0, p.tranches);
    return { ...bill, appliances, appliancesKwh, baseKwh: p.baseKwh[h] ?? 0, cookingKwh: c.elecKwhUsed };
  }

  /** Facture d'eau du mois : abonnement + besoins du logement + douches + cuisine depuis la dernière facture, par tranches de m³. */
  private async waterOf(c: { housing: string; waterShowers: number; waterLitresUsed: number }) {
    const w = await this.settings.get('bills.water');
    const h = c.housing as Housing;
    return waterBill({ baseLitres: w.baseLitres[h] ?? 0, showers: c.waterShowers, showerLitres: w.showerLitres, cookingLitres: c.waterLitresUsed }, w.subscription[h] ?? 0, w.tranches);
  }

  private async billsView(c: { id: string; housing: string; createdAt: Date; elecPaidUntilGameDay: number; waterPaidUntilGameDay: number; wifiPaidUntilGameDay: number; waterShowers: number; waterLitresUsed: number; solar: boolean; elecKwhUsed: number; hasFreezer: boolean }, today: number) {
    const cfg = await this.settings.get('bills.monthly');
    const power = await this.powerOf(this.prisma, c);
    const fee = (await this.settings.get('rent.rules')).lateFeeBpPerDay;
    const late = { ELEC: await this.billDaysLate(c.elecPaidUntilGameDay, c.createdAt, today), WATER: await this.billDaysLate(c.waterPaidUntilGameDay, c.createdAt, today) };
    const h = c.housing as Housing;
    // Eau : besoins du logement + douches + cuisine, par tranches de m³
    const water = await this.waterOf(c);
    const usage = { showers: c.waterShowers, tariff: 0, amount: 0 };
    const one = (bill: Bill, monthly: number) => {
      const paidUntilGameDay = c[BILL_FIELD[bill]];
      const base = monthly;
      const overdue = bill !== 'WIFI' && today > paidUntilGameDay;
      // Facture en retard : majorée de la pénalité pour chaque jour de retard (le wifi est un abonnement, sans pénalité)
      const daysLate = bill === 'WIFI' || !overdue ? 0 : late[bill];
      return { monthly, ...(bill === 'WATER' ? { usage } : {}), due: withLateFee(BigInt(base), daysLate, fee).toString(), daysLate, paidUntilGameDay, overdue, active: today <= paidUntilGameDay };
    };
    return { ELEC: { ...one('ELEC', power.total), power }, WATER: { ...one('WATER', water.total), water }, WIFI: one('WIFI', cfg.WIFI) };
  }

  /** Payer un mois de facture (CEET, TdE ou box wifi) ; au plus 3 mois d'avance. Montant décidé par le serveur. */
  payBill(accountId: string, bill: Bill, idem?: string) {
    return this.act(accountId, async (tx, c) => {
      const key = idem ? `bill:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`bill|${bill}|${c.housing}`);
      if (c.homeless) throw new BadRequestException('homeless');
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { paid: 0, replay: true };
      const cfg = await this.settings.get('bills.monthly');
      // Électricité : selon l'équipement et l'usage (voir powerOf) ; eau et wifi : tarif du réglage
      const monthly = bill === 'WIFI' ? cfg.WIFI : bill === 'ELEC' ? (await this.powerOf(tx, c)).total : (await this.waterOf(c)).total;
      if (monthly === undefined) throw new BadRequestException('unknown_housing');
      const today = gameTimeAt(await this.settings.clock(), Date.now()).day;
      const field = BILL_FIELD[bill];
      // Électricité et eau en retard : 1 % (réglable) par jour de retard ; le wifi n'a pas de pénalité
      const late = bill !== 'WIFI' && today > c[field] ? await this.billDaysLate(c[field], c.createdAt, today) : 0;
      // Eau : douches et cuisine comptées depuis la dernière facture (compteurs remis à zéro au paiement)
      const base = monthly;
      const amount = Number(withLateFee(BigInt(base), late, (await this.settings.get('rent.rules')).lateFeeBpPerDay));
      if (c[field] - today >= MAX_RENT_MONTHS_AHEAD * GAME_DAYS_PER_MONTH) throw new BadRequestException('bill_paid_ahead');
      if (amount > 0) {
        await this.ledger.post(tx, {
          kind: 'BILL',
          idempotencyKey: key,
          requestHash,
          legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(amount) }],
        });
      }
      await tx.character.update({ where: { id: c.id }, data: { [field]: Math.max(c[field], today) + GAME_DAYS_PER_MONTH, ...(bill === 'WATER' ? { waterShowers: 0, waterLitresUsed: 0 } : {}), ...(bill === 'ELEC' ? { elecKwhUsed: 0 } : {}) } });
      return { paid: amount, replay: false };
    });
  }

  /** Acheter son logement : prix décidé par le serveur, payé au propriétaire ; le loyer s'arrête. */
  buyHome(accountId: string, idem?: string) {
    return this.act(accountId, async (tx, c) => {
      const key = idem ? `home:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`home|${c.housing}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { paid: 0, replay: true };
      if (c.homeOwned) throw new BadRequestException('home_owned');
      if (c.homeless) throw new BadRequestException('homeless');
      if (c.rentDebt > 0n) throw new BadRequestException('rent_debt');
      if (overdueMonths(c.rentPaidUntilGameDay, gameTimeAt(await this.settings.clock(), Date.now()).day) > 0) throw new BadRequestException('rent_overdue');
      const price = (await this.settings.get('housing.price'))[c.housing as Housing];
      if (price === undefined) throw new BadRequestException('unknown_housing');
      await this.ledger.post(tx, {
        kind: 'HOME_PURCHASE',
        idempotencyKey: key,
        requestHash,
        memo: c.housing,
        // La caution versée au propriétaire vient en déduction du prix
        legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'LANDLORD'), amount: BigInt(price) - c.rentDeposit }],
      });
      const n = applyEffects(needsOf(c), { morale: 20, respect: 15 });
      await tx.character.update({ where: { id: c.id }, data: { ...n, homeOwned: true, rentDeposit: 0n } });
      return { paid: price, replay: false };
    });
  }

  /** Position d'un lieu (ou du logement du personnage) sur la carte. */
  private async positionOf(tx: Tx, c: Character, id: string): Promise<{ x: number; z: number; city: string } | null> {
    if (id === HOME) {
      // Le logement est à Lomé
      const p = c.homeX !== null && c.homeZ !== null ? { x: c.homeX, z: c.homeZ } : (await this.settings.get('home.position'))[c.housing as Housing];
      return p ? { ...p, city: 'lome' } : null;
    }
    const v = await tx.venue.findUnique({ where: { id }, select: { x: true, z: true, enabled: true, city: true } });
    return v && v.enabled ? { x: v.x, z: v.z, city: v.city } : null;
  }

  /** Voyage en car vers une autre ville, depuis la gare : tarif et durée fixés par le réglage, arrivée à la gare d'en face. */
  intercity(accountId: string, to: string, idem?: string) {
    return this.act(accountId, async (tx, c) => {
      const cfg = await this.settings.get('travel.intercity');
      const here = cfg.cities.find((x) => x.id === c.city);
      const dest = cfg.cities.find((x) => x.id === to);
      if (!dest) throw new NotFoundException('unknown_city');
      if (!here || c.locationId !== here.gare) throw new BadRequestException('not_at_gare');
      if (to === c.city) throw new BadRequestException('already_there');
      // Voyages fermés : on ne quitte pas Lomé ; un joueur resté dans une autre ville peut toujours rentrer
      if (!cfg.enabled && to !== 'lome') throw new BadRequestException('intercity_closed');
      const route = cfg.routes.find((r) => (r.a === c.city && r.b === to) || (r.b === c.city && r.a === to));
      if (!route) throw new BadRequestException('no_route');
      const key = idem ? `intercity:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`intercity|${c.city}|${to}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true, to };
      const clock = await this.settings.clock();
      const now = Date.now();
      const price = route.price > 0 ? (BigInt(route.price) * BigInt(transportFactorBp(gameTimeAt(clock, now).day, await this.settings.get('economy.events'))) + 5_000n) / 10_000n : 0n;
      if (price > 0n) await this.ledger.post(tx, { kind: 'TRANSPORT', idempotencyKey: key, requestHash, memo: `CAR:${c.city}-${to}`, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: price }] });
      const tripUntil = new Date(Math.ceil(realMsAfterGameHours(clock, now, route.hours)));
      const n = applyEffects(needsOf(c), { energy: -cfg.energyPerHour * route.hours, hygiene: -2 * route.hours });
      await tx.character.update({ where: { id: c.id }, data: { ...n, city: to, locationId: dest.gare, tripUntil, tripFrom: c.city, tripStart: new Date(now) } });
      return { replay: false, to, paid: price.toString(), hours: route.hours, arrival: tripUntil.toISOString() };
    });
  }

  /** Le personnage possède-t-il une voiture (bien de type CAR acheté au port) ? */
  private async ownsCar(tx: Prisma.TransactionClient, characterId: string): Promise<boolean> {
    const cars = (await this.settings.get('port.goods')).goods.filter((g) => g.kind === 'CAR').map((g) => g.id);
    return cars.length > 0 && (await tx.holding.count({ where: { characterId, goodId: { in: cars }, qty: { gt: 0 } } })) > 0;
  }

  /** Se rendre dans un lieu : le serveur calcule la distance et le tarif, débite, puis déplace le personnage. */
  travel(accountId: string, to: string, mode: TransportMode, idem?: string, vehicleId?: string) {
    return this.act(accountId, async (tx, c) => {
      const key = idem ? `travel:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`travel|${to}|${mode}|${vehicleId ?? ''}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { to, mode, paid: '0', incident: false, replay: true };
      const dest = await this.positionOf(tx, c, to);
      if (!dest) throw new NotFoundException('unknown_venue');
      if (c.locationId === to) throw new BadRequestException('already_there');
      if (dest.city !== c.city) throw new BadRequestException('other_city');
      const from = await this.positionOf(tx, c, c.locationId);
      const meters = from ? distanceMeters(from.x, from.z, dest.x, dest.z) : 0;
      const cfg = (await this.settings.get('transport.modes'))[mode];
      if (!cfg) throw new BadRequestException('mode_disabled');
      // Véhicule personnel : pas de tarif, mais du carburant, de l'usure et un risque de panne si l'entretien est dépassé
      let own: { v: OwnedVehicle; model: VehicleModel; need: number; rules: VehicleRules } | null = null;
      if (mode === 'CAR' || mode === 'MOTO') {
        const cat = await this.settings.get('vehicles.catalog');
        const rows = await tx.ownedVehicle.findMany({ where: { characterId: c.id, kind: mode, soldAt: null, ...(vehicleId ? { id: vehicleId } : {}) }, orderBy: { createdAt: 'asc' } });
        if (rows.length === 0) throw new BadRequestException(mode === 'CAR' ? 'no_car' : 'no_moto');
        const usable = rows.map((v) => ({ v, model: cat.models.find((m) => m.id === v.modelId)! })).filter((x) => x.model);
        const ok = usable.filter((x) => condition(x.v, x.model) >= cat.rules.minCondition);
        if (ok.length === 0) throw new BadRequestException('needs_repair');
        const withFuel = ok.find((x) => x.v.fuelMl >= fuelNeededMl(meters, x.model));
        if (!withFuel) throw new BadRequestException('out_of_fuel');
        own = { ...withFuel, need: fuelNeededMl(meters, withFuel.model), rules: cat.rules };
      }
      // Pénurie de carburant et autres événements de la semaine : le tarif suit (la marche reste gratuite)
      const base = fare(meters, cfg);
      const price = base > 0n ? (base * BigInt(transportFactorBp(gameTimeAt(await this.settings.clock(), Date.now()).day, await this.settings.get('economy.events'))) + 5_000n) / 10_000n : base;
      if (price > 0n) {
        await this.ledger.post(tx, {
          kind: 'TRANSPORT',
          idempotencyKey: key,
          requestHash,
          memo: `${mode}:${to}`,
          legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: price }],
        });
      }
      let incident = cfg.riskBp > 0 && randomInt(10_000) < cfg.riskBp;
      let breakdown = false;
      let vehicleLeft: { id: string; fuelMl: number; condition: number } | null = null;
      if (own) {
        const since = own.v.sinceServiceM + meters;
        // Entretien dépassé : le véhicule peut tomber en panne (dégâts à réparer, remorquage jusqu'à destination)
        breakdown = randomInt(10_000) < breakdownRiskBp(since, own.model, own.rules);
        const damage = own.v.damage + (breakdown ? own.rules.breakdownDamage : 0);
        const updated = await tx.ownedVehicle.update({ where: { id: own.v.id }, data: { fuelMl: own.v.fuelMl - own.need, odometerM: own.v.odometerM + meters, sinceServiceM: since, damage } });
        vehicleLeft = { id: updated.id, fuelMl: updated.fuelMl, condition: condition(updated, own.model) };
        if (breakdown) incident = true;
      }
      const n = applyEffects(needsOf(c), { energy: -travelEnergy(meters, cfg), health: incident && !breakdown ? -10 : 0, morale: incident ? -5 : 0 });
      await tx.character.update({ where: { id: c.id }, data: { ...n, locationId: to } });
      // Rentrer chez soi termine la séance de travail en cours : le panneau du service ne suit plus le joueur à la maison
      const shiftEnded = to === HOME && (await tx.workShift.updateMany({ where: { characterId: c.id, closedAt: null }, data: { closedAt: new Date() } })).count > 0;
      return { to, mode, meters, paid: price.toString(), incident, breakdown, shiftEnded, vehicle: vehicleLeft, fuelUsedMl: own?.need ?? 0, replay: false };
    });
  }

  /** Style dessiné de la maison construite sur un terrain où le personnage a emménagé. */
  private async homeStyle(characterId: string): Promise<string | null> {
    const h = await this.prisma.landHolding.findFirst({ where: { characterId, movedIn: true }, select: { useId: true } });
    if (!h?.useId) return null;
    return (await this.settings.get('land')).uses.find((u) => u.id === h.useId)?.style ?? null;
  }

  /** Apparence choisie par le joueur (gratuite, sans effet sur l'argent). */
  async setLook(accountId: string, look: Record<string, unknown>) {
    const c = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true, look: true } });
    if (!c) throw new NotFoundException('no_character');
    // La tenue composée (vêtements achetés) se garde quand on change de coiffure ou de teint
    const wear = c.look && typeof c.look === 'object' && !Array.isArray(c.look) ? (c.look as Record<string, unknown>).wear : undefined;
    await this.prisma.character.update({ where: { id: c.id }, data: { look: (wear ? { ...look, wear } : look) as Prisma.InputJsonValue } });
    return { result: { saved: true }, state: await this.state(accountId) };
  }

  /** Refuse une action dans un lieu fermé à l'heure de jeu actuelle. */
  async assertOpen(venueId: string) {
    const hour = gameTimeAt(await this.settings.clock(), Date.now()).hour;
    if (!isOpen((await this.settings.get('venues.hours'))[venueId], hour)) throw new BadRequestException('venue_closed');
  }

  /** Activité d'un lieu : il faut s'y trouver ; prix et effets décidés par le serveur. */
  activity(accountId: string, activityId: string, idem?: string) {
    return this.act(accountId, async (tx, c) => {
      const key = idem ? `activity:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`activity|${activityId}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { activity: activityId, paid: 0, replay: true };
      const a = await tx.venueActivity.findUnique({ where: { id: activityId }, include: { venue: { select: { enabled: true } } } });
      if (!a || !a.enabled || !a.venue.enabled) throw new NotFoundException('unknown_activity');
      if (c.locationId !== a.venueId) throw new BadRequestException('not_at_venue');
      await this.assertOpen(a.venueId);
      // Consultation et tests : une seule fois par jour de jeu, pas de répétition (ni de facturation) sans fin au même hôpital
      if ((await this.settings.get('activities.oncePerDay')).includes(a.id)) {
        const last = await tx.ledgerTransaction.findFirst({ where: { kind: 'ACTIVITY', memo: a.id, entries: { some: { walletId: c.walletId } } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
        if (last && gameHoursBetween(await this.settings.clock(), last.createdAt.getTime(), Date.now()) < 24) throw new BadRequestException('already_done_today');
      }
      // Assuré AMU dans un hôpital conventionné : l'AMU paie sa part, le patient ne paie que le reste (ticket modérateur)
      const amuCfg = await this.settings.get('amu');
      const insured = amuCfg.hospitals.includes(a.venueId) && c.amuPaidUntilGameDay >= gameTimeAt(await this.settings.clock(), Date.now()).day;
      const price = insured ? a.price - Math.floor((a.price * amuCfg.coverageBp) / 10_000) : a.price;
      if (price > 0) {
        await this.ledger.post(tx, {
          kind: 'ACTIVITY',
          idempotencyKey: key,
          requestHash,
          memo: a.id,
          legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(price) }],
        });
      }
      const n = withMealEnergy(applyEffects(needsOf(c), { hunger: a.hunger, energy: a.energy, hygiene: a.hygiene, health: a.health, morale: a.morale, respect: a.respect }), a.hunger, await this.settings.get('food.meal'));
      await tx.character.update({ where: { id: c.id }, data: n });
      return { activity: a.id, paid: price, fullPrice: a.price, amu: insured, replay: false };
    });
  }

  /** Transfert de type mobile money entre joueurs, avec frais. */
  /**
   * Suggestions pour le champ « destinataire » : joueurs dont le nom d'utilisateur commence par la saisie (2 caractères
   * au moins, 8 résultats), ou le joueur dont c'est l'identifiant exact. Jamais d'e-mail ni de téléphone.
   */
  async searchRecipients(accountId: string, qRaw: string): Promise<{ characterId: string; name: string; username: string }[]> {
    const q = String(qRaw ?? '').trim().replace(/^@/, '').toLowerCase();
    const where: Prisma.AccountWhereInput = { id: { not: accountId }, deletedAt: null, guest: false, suspendedAt: null, character: { isNot: null } };
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(q)) where.character = { is: { id: q } };
    else if (/^[a-z0-9_.]{2,20}$/.test(q)) where.username = { startsWith: q };
    else return [];
    const rows = await this.prisma.account.findMany({ where, orderBy: { username: 'asc' }, take: 8, select: { username: true, character: { select: { id: true, name: true } } } });
    return rows.flatMap((r) => (r.username && r.character ? [{ characterId: r.character.id, name: r.character.name, username: r.username }] : []));
  }

  /** Destinataire d'un envoi d'argent : nom d'utilisateur exact → identifiant du personnage. Rien d'autre n'est révélé. */
  async lookupRecipient(accountId: string, usernameRaw: string): Promise<{ characterId: string; name: string; username: string }> {
    const username = String(usernameRaw ?? '').trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_.]{3,20}$/.test(username)) throw new BadRequestException('invalid_username');
    const acc = await this.prisma.account.findFirst({ where: { username, deletedAt: null, guest: false, suspendedAt: null }, select: { id: true, character: { select: { id: true, name: true } } } });
    if (!acc?.character) throw new NotFoundException('recipient_not_found');
    if (acc.id === accountId) throw new BadRequestException('same_wallet');
    return { characterId: acc.character.id, name: acc.character.name, username };
  }

  async transfer(accountId: string, toCharacterId: string, amount: number, memo: string | undefined, idem?: string) {
    let senderName = '';
    const out = await this.act(accountId, async (tx, c) => {
      senderName = c.name;
      if (toCharacterId === c.id) throw new BadRequestException('same_wallet');
      // Retire contrôles, < >, et caractères invisibles ou d'inversion bidirectionnelle (usurpation visuelle).
      const cleanMemo = memo
        ?.replace(/[\u0000-\u001f\u007f-\u009f<>\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '')
        .trim()
        .slice(0, 80);
      const key = idem ? `transfer:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`transfer|${toCharacterId}|${amount}|${cleanMemo ?? ''}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { amount, fee: '0', replay: true };

      // Anti multi-comptes : ancienneté minimale du compte émetteur (vérifiée avant tout le reste),
      // puis plafonds glissants d'envoi et de réception.
      const limits = await this.settings.get('transfer.limits');
      const account = await tx.account.findUniqueOrThrow({ where: { id: accountId }, select: { createdAt: true } });
      if (Date.now() - account.createdAt.getTime() < limits.minAccountAgeHours * 3_600_000) throw new ForbiddenException('account_too_new');

      const to = await tx.wallet.findUnique({ where: { characterId: toCharacterId }, select: { id: true } });
      if (!to) throw new NotFoundException('recipient_not_found');
      const value = BigInt(amount);
      // Sérialise les transferts vers un même destinataire (verrou consultatif, libéré en fin de transaction).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${to.id}))`;
      const since = new Date(Date.now() - 86_400_000);
      const [sent, received] = await Promise.all([
        tx.ledgerEntry.aggregate({ where: { walletId: c.walletId, amount: { lt: 0 }, createdAt: { gte: since }, transaction: { kind: 'TRANSFER' } }, _sum: { amount: true } }),
        tx.ledgerEntry.aggregate({ where: { walletId: to.id, amount: { gt: 0 }, createdAt: { gte: since }, transaction: { kind: 'TRANSFER' } }, _sum: { amount: true } }),
      ]);
      if (-(sent._sum.amount ?? 0n) + value > BigInt(limits.dailySendMax)) throw new BadRequestException('daily_send_limit');
      if ((received._sum.amount ?? 0n) + value > BigInt(limits.dailyReceiveMax)) throw new BadRequestException('daily_receive_limit');

      const cfg = await this.settings.get('transfer.fee');
      let fee = applyRate(value, cfg.rateBp);
      if (fee < BigInt(cfg.min)) fee = BigInt(cfg.min);
      if (fee > BigInt(cfg.max)) fee = BigInt(cfg.max);
      const legs = [{ from: c.walletId, to: to.id, amount: value }];
      if (fee > 0n) legs.push({ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'FEES'), amount: fee });
      await this.ledger.post(tx, {
        kind: 'TRANSFER',
        idempotencyKey: key,
        requestHash,
        memo: cleanMemo,
        legs,
      });
      return { amount, fee: fee.toString(), replay: false };
    });
    // Le destinataire est prévenu tout de suite s'il est en ligne (sinon il le verra dans son historique)
    if (!out.result.replay) {
      this.live?.notifyCharacter(toCharacterId, 'money', { from: senderName, amount: out.result.amount });
      // Trace dans leur conversation privée : « X a envoyé … » (serveur seul : le client ne peut pas la fabriquer)
      const sender = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
      if (sender) void this.live?.moneyTrace(sender.id, toCharacterId, Number(out.result.amount));
    }
    return out;
  }

  async history(accountId: string, limit: number) {
    const c = await this.prisma.character.findUnique({ where: { accountId }, include: { wallet: { select: { id: true } } } });
    if (!c?.wallet) throw new NotFoundException('no_character');
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { walletId: c.wallet.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: { transaction: { select: { kind: true, memo: true } } },
    });
    return entries.map((e) => ({
      id: e.id,
      kind: e.transaction.kind,
      memo: e.transaction.memo,
      amount: e.amount.toString(),
      balanceAfter: e.balanceAfter.toString(),
      at: e.createdAt,
    }));
  }
}
