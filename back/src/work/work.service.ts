import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Character } from '@prisma/client';
import { randomInt, randomUUID } from 'node:crypto';
import { activeCompanyId } from '../company/active';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { gameHoursBetween, gameTimeAt, realMsAfterGameHours } from '../economy/clock';
import { applyEffects } from '../economy/needs';
import { generateMissions, type Mission } from './missions';
import { jobLastWorked, markJobWorked } from '../economy/job-cooldown';
import { payModeOf } from '../economy/public-jobs';
import { condition, fuelNeededMl } from '../vehicle/vehicle';

/** Origine de la moto d'une séance de zém. */
export type ZemBike = 'GOZEM' | 'OWN' | 'OWNER';

const needs = (c: { hunger: number; energy: number; hygiene: number; health: number; morale: number; respect: number }) => ({
  hunger: c.hunger, energy: c.energy, hygiene: c.hygiene, health: c.health, morale: c.morale, respect: c.respect,
});

/** Séances de travail en missions : le serveur génère les clients, le joueur accepte ou refuse, chaque mission est payée une fois. */
@Injectable()
export class WorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
  ) {}

  /** Lieu de partenaire où l'on est (id) si son modèle accueille ce métier, sinon null. */
  private async brandWorkplace(tx: Prisma.TransactionClient, venueId: string, jobId: string): Promise<string | null> {
    if (!venueId.startsWith('brand_')) return null;
    const v = await tx.venue.findFirst({ where: { id: venueId, enabled: true }, select: { x: true, z: true } });
    if (!v) return null;
    const p = await tx.partner.findFirst({ where: { placeX: v.x, placeZ: v.z, active: true }, select: { placeModel: true } });
    const services = await this.settings.get('partners.services');
    const svc = services[(p?.placeModel ?? 'agency') as keyof typeof services];
    return svc?.jobs.includes(jobId) ? venueId : null;
  }

  /** Séance ouverte du personnage (ou null). */
  async current(characterId: string) {
    const s = await this.prisma.workShift.findFirst({ where: { characterId, closedAt: null }, orderBy: { startedAt: 'desc' } });
    if (!s) return null;
    if (s.endsAt.getTime() < Date.now()) {
      await this.prisma.workShift.update({ where: { id: s.id }, data: { closedAt: new Date() } });
      return null;
    }
    return { id: s.id, kind: s.kind, sourceId: s.sourceId, orders: s.orders as unknown as Mission[], endsAt: s.endsAt.toISOString() };
  }

  start(accountId: string, kind: 'job' | 'company', bike?: ZemBike) {
    return this.chars.act(accountId, async (tx, c) => {
      const shiftId = randomUUID();
      const open = await tx.workShift.findFirst({ where: { characterId: c.id, closedAt: null, endsAt: { gt: new Date() } } });
      if (open) throw new ConflictException('shift_in_progress');
      const clock = await this.settings.clock();
      const now = Date.now();
      const zem = (await this.settings.get('transport.modes')).ZEM;
      // Lieux de la ville du joueur seulement (chaque ville a ses propres coordonnées).
      const places = (await tx.venue.findMany({ where: { enabled: true, city: c.city }, select: { id: true, x: true, z: true } }));
      let source: string;
      let hours: number;
      let energy: number;
      let hunger = 8;
      let hygiene = 6;
      let missions: Mission[];
      if (kind === 'job') {
        if (!c.jobId) throw new BadRequestException('no_job');
        const job = await tx.job.findUniqueOrThrow({ where: { id: c.jobId } });
        if (!job.enabled) throw new BadRequestException('job_disabled');
        // Métier salarié : il faut y avoir été embauché (le salaire est versé chaque mois, pas à chaque service)
        if (payModeOf(job.id, (await this.settings.get('jobs.public')).enabled, await this.settings.get('jobs.taskPaid')) === 'MONTHLY' && !(await tx.employee.findFirst({ where: { characterId: c.id, active: true, publicJobId: job.id }, select: { id: true } }))) throw new BadRequestException('job_needs_contract');
        const place = (await this.settings.get('work.places'))[job.id];
        // Le métier s'exerce à son lieu habituel, ou dans le bâtiment d'un partenaire dont le modèle l'accueille (réglage partners.services)
        const here = place && c.locationId !== place ? await this.brandWorkplace(tx, c.locationId, job.id) : null;
        if (place && c.locationId !== place && !here) throw new BadRequestException(`work_at_${place}`);
        if (place && !(await this.settings.get('work.anyHour')).includes(job.id)) await this.chars.assertOpen(here ?? place);
        const last = jobLastWorked(c.jobWorkedAt, job.id);
        if (last && gameHoursBetween(clock, last, now) < job.shiftGameHours) throw new BadRequestException('still_working');
        if (c.energy < job.energyCost) throw new BadRequestException('too_tired');
        if (c.health < 20) throw new BadRequestException('too_sick');
        if (job.id === 'zem_driver') await this.takeBike(tx, c, bike, shiftId);
        source = job.id;
        hours = job.shiftGameHours;
        energy = job.energyCost;
        hunger = job.hungerCost;
        hygiene = job.hygieneCost;
        // Séance commencée la nuit : paie majorée
        const night = await this.settings.get('work.night');
        const hour = gameTimeAt(clock, now).hour;
        const isNight = night.fromHour > night.toHour ? hour >= night.fromHour || hour < night.toHour : hour >= night.fromHour && hour < night.toHour;
        const target = isNight ? Math.floor((job.payPerShift * (10_000 + night.bonusBp)) / 10_000) : job.payPerShift;
        missions = generateMissions({ seed: `${c.id}:${now}`, source, count: source === 'zem_driver' || source === 'delivery_driver' || source === 'cargo_rider' ? 5 : 6, target, costRatioBp: 0, places, zem, start: c.locationId });
        await tx.character.update({ where: { id: c.id }, data: { lastWorkedAt: new Date(now), jobWorkedAt: markJobWorked(c.jobWorkedAt, job.id, now) } });
      } else {
        const coId = await activeCompanyId(tx, c.id);
        const co = coId ? await tx.company.findUnique({ where: { id: coId }, include: { employees: { where: { active: true } } } }) : null;
        if (!co) throw new NotFoundException('no_company');
        if (co.status !== 'REGISTERED') throw new BadRequestException('company_not_registered');
        const act = (await this.settings.get('company.activities')).find((a) => a.id === co.activityId);
        if (!act) throw new BadRequestException('unknown_company_activity');
        if (co.lastWorkedAt && gameHoursBetween(clock, co.lastWorkedAt.getTime(), now) < act.shiftGameHours) throw new BadRequestException('still_working');
        if (c.energy < act.energyCost) throw new BadRequestException('too_tired');
        source = act.id;
        hours = act.shiftGameHours;
        energy = act.energyCost;
        // Chaque salarié permet de servir plus de clients
        const count = 4 + co.employees.length * 2;
        missions = generateMissions({
          seed: `${co.id}:${now}`,
          source,
          count,
          target: act.revenue * (1 + co.employees.length * 0.5),
          costRatioBp: act.revenue > 0 ? Math.round((act.cost * 10_000) / act.revenue) : 0,
          places,
          zem,
          start: c.locationId,
        });
        await tx.company.update({ where: { id: co.id }, data: { lastWorkedAt: new Date(now) } });
      }
      const n = applyEffects(needs(c), { energy: -energy, hunger: -hunger, hygiene: -hygiene });
      await tx.character.update({ where: { id: c.id }, data: n });
      const shift = await tx.workShift.create({
        data: {
          id: shiftId,
          characterId: c.id,
          kind,
          sourceId: source,
          orders: missions as unknown as Prisma.InputJsonValue,
          endsAt: new Date(Math.ceil(realMsAfterGameHours(clock, now, hours))),
        },
      });
      return { shift: shift.id, missions: missions.length };
    });
  }

  /**
   * Moto d'une séance de zém : louée à Gozem (location à la séance), personnelle (carburant et usure, rien à verser)
   * ou confiée par un propriétaire (versement fixe, contrat signé à la station).
   */
  private async takeBike(tx: Prisma.TransactionClient, c: Character & { walletId: string }, bike: ZemBike | undefined, shiftId: string): Promise<void> {
    if (!bike) throw new BadRequestException('bike_required');
    const cfg = await this.settings.get('work.zemBike');
    if (bike === 'OWN') {
      const cat = await this.settings.get('vehicles.catalog');
      const rows = await tx.ownedVehicle.findMany({ where: { characterId: c.id, kind: 'MOTO', soldAt: null }, orderBy: { createdAt: 'asc' } });
      if (rows.length === 0) throw new BadRequestException('no_moto');
      const usable = rows.map((v) => ({ v, model: cat.models.find((m) => m.id === v.modelId)! })).filter((x) => x.model);
      const ok = usable.filter((x) => condition(x.v, x.model) >= cat.rules.minCondition);
      if (ok.length === 0) throw new BadRequestException('needs_repair');
      const meters = cfg.ownKm * 1000;
      const pick = ok.find((x) => x.v.fuelMl >= fuelNeededMl(meters, x.model));
      if (!pick) throw new BadRequestException('out_of_fuel');
      await tx.ownedVehicle.update({
        where: { id: pick.v.id },
        data: { fuelMl: pick.v.fuelMl - fuelNeededMl(meters, pick.model), odometerM: pick.v.odometerM + meters, sinceServiceM: pick.v.sinceServiceM + meters },
      });
      return;
    }
    if (bike === 'OWNER' && !c.zemContractAt) throw new BadRequestException('no_zem_contract');
    const fee = bike === 'GOZEM' ? cfg.gozemFee : cfg.ownerFee;
    if (fee > 0) {
      await this.ledger.post(tx, {
        kind: bike === 'GOZEM' ? 'ZEM_RENTAL' : 'ZEM_OWNER_FEE',
        idempotencyKey: `zem-bike:${shiftId}`,
        memo: bike,
        legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(fee) }],
      });
    }
  }

  /** Signer ou rompre le contrat d'une moto confiée par un propriétaire : à la station Gozem, sans frais. */
  zemContract(accountId: string, action: 'sign' | 'end') {
    return this.chars.act(accountId, async (tx, c) => {
      if (c.locationId !== 'station_zem') throw new BadRequestException('work_at_station_zem');
      if (action === 'sign' && c.zemContractAt) throw new ConflictException('zem_contract_exists');
      if (action === 'end' && !c.zemContractAt) throw new BadRequestException('no_zem_contract');
      await tx.character.update({ where: { id: c.id }, data: { zemContractAt: action === 'sign' ? new Date() : null } });
      return { contract: action === 'sign' };
    });
  }

  /** Accepter ou refuser une mission. Acceptée : paiement unique (clé d'idempotence = mission). */
  serve(accountId: string, shiftId: string, missionId: string, accept: boolean) {
    return this.chars.act(accountId, async (tx, c) => {
      // Verrou de la séance (requête paramétrée) : deux clics simultanés ne paient pas deux fois
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "work_shift" WHERE "id" = ${shiftId}::uuid AND "characterId" = ${c.id}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundException('unknown_shift');
      const s = await tx.workShift.findUniqueOrThrow({ where: { id: shiftId } });
      if (s.closedAt || s.endsAt.getTime() < Date.now()) throw new BadRequestException('shift_over');
      const orders = s.orders as unknown as Mission[];
      const m = orders.find((o) => o.id === missionId);
      if (!m) throw new NotFoundException('unknown_mission');
      if (m.status !== 'open') throw new ConflictException('mission_done');
      let paid = 0;
      let incident = false;
      if (accept) {
        incident = (m.kind === 'ride' || m.kind === 'delivery') && randomInt(10_000) < (await this.settings.get('transport.modes')).ZEM.riskBp;
        const gross = incident ? Math.floor(m.amount / 2) : m.amount;
        // Métier salarié : le service compte pour le salaire du mois, il n'est pas payé sur le moment
        const salaried = s.kind === 'job' && payModeOf(s.sourceId, (await this.settings.get('jobs.public')).enabled, await this.settings.get('jobs.taskPaid')) === 'MONTHLY';
        const net = salaried ? 0 : Math.max(0, gross - m.cost);
        if (net > 0) {
          await this.ledger.post(tx, {
            kind: s.kind === 'company' ? 'SALES' : 'WAGE',
            idempotencyKey: `mission:${s.id}:${m.id}`,
            memo: `${s.sourceId}:${m.kind}`,
            legs: [{ from: await this.ledger.systemWalletId(tx, s.kind === 'company' ? 'MARKET' : 'TREASURY'), to: c.walletId, amount: BigInt(net) }],
          });
        }
        if (s.kind === 'company') {
          // La séance garde l'entreprise visée (sa mission porte le revenu) : celle en cours au moment de l'encaissement
          const coId = await activeCompanyId(tx, c.id);
          if (coId) await tx.company.update({ where: { id: coId }, data: { pendingRevenue: { increment: BigInt(gross) } } });
        }
        const n = applyEffects(needs(c), { morale: 1, respect: m.kind === 'service' ? 1 : 0, health: incident ? -12 : 0 });
        await tx.character.update({ where: { id: c.id }, data: n });
        paid = net;
        m.status = 'done';
      } else {
        m.status = 'declined';
      }
      const allDone = orders.every((o) => o.status !== 'open');
      await tx.workShift.update({
        where: { id: s.id },
        data: { orders: orders as unknown as Prisma.InputJsonValue, ...(allDone ? { closedAt: new Date() } : {}) },
      });
      return { mission: m.id, paid, incident, finished: allDone };
    });
  }

  /** Terminer la séance avant la fin (les missions restantes sont perdues). */
  stop(accountId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      await tx.workShift.updateMany({ where: { characterId: c.id, closedAt: null }, data: { closedAt: new Date() } });
      return { stopped: true };
    });
  }
}
