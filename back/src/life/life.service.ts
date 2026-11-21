import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { LiveService } from '../live/live.service';
import type { CeremonyKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService, needsOf } from '../character/character.service';
import { gameTimeAt, GAME_DAYS_PER_MONTH } from '../economy/clock';
import { applyEffects } from '../economy/needs';
import { applyRate } from '../economy/money';
import { activeEvents } from '../economy/events';
import { sha256Hex } from '../common/crypto';
import { HotelService } from '../hotel/hotel.service';

export type Equipment = 'generator' | 'solar' | 'waterTank';
const EQUIP_PRICE: Record<Equipment, 'generatorPrice' | 'solarPrice' | 'tankPrice'> = { generator: 'generatorPrice', solar: 'solarPrice', waterTank: 'tankPrice' };

/** Santé (consultation, traitement), famille (demandes), cérémonies entre joueurs, équipements contre les coupures. */
@Injectable()
export class LifeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
    private readonly hotel: HotelService,
    @Optional() private readonly live?: LiveService,
  ) {}

  private async today(): Promise<number> {
    return gameTimeAt(await this.settings.clock(), Date.now()).day;
  }

  /** Part restant à la charge du patient : l'AMU rembourse `coverageBp` si le joueur est couvert. */
  private async patientShare(price: number, amuPaidUntilGameDay: number): Promise<bigint> {
    const amu = await this.settings.get('amu');
    const covered = amuPaidUntilGameDay >= (await this.today());
    const full = BigInt(price);
    return covered ? full - applyRate(full, amu.coverageBp) : full;
  }

  private async atHospital(locationId: string) {
    if (!(await this.settings.get('amu')).hospitals.includes(locationId)) throw new BadRequestException('not_at_hospital');
  }

  // ───────────── Santé ─────────────

  /**
   * Dossier de la consultation en cours : examen, analyses demandées (avec résultats une fois faites), puis interprétation
   * et ordonnance. Les montants affichés sont la part du patient (l'AMU rembourse le reste). Maladie révélée seulement
   * après les analyses.
   */
  private async visitView(v: { id: string; day: number; status: string; illnessId: string | null; orders: unknown; results: unknown }, amuPaidUntilGameDay: number) {
    const wk = await this.settings.get('health.workup');
    const key = v.illnessId && wk.byIllness[v.illnessId] ? v.illnessId : 'healthy';
    const plan = wk.byIllness[key]!;
    const orders = Array.isArray(v.orders) ? (v.orders as string[]) : [];
    const done = new Set(Array.isArray(v.results) ? (v.results as { id: string }[]).map((r) => r.id) : []);
    const analysed = v.status === 'ANALYZED' || v.status === 'TREATED';
    const analyses = [];
    let pending = 0n;
    for (const id of orders) {
      const a = wk.analyses.find((x) => x.id === id);
      if (!a) continue;
      const price = await this.patientShare(a.price, amuPaidUntilGameDay);
      if (!done.has(id)) pending += price;
      const r = done.has(id) ? a.results[key] ?? a.results.healthy : undefined;
      analyses.push({ id, nameFr: a.nameFr, nameEn: a.nameEn, unit: a.unit, refFr: a.refFr, refEn: a.refEn, full: a.price, price: price.toString(), done: done.has(id), result: r ? { valueFr: r.valueFr, valueEn: r.valueEn, flag: r.flag } : null });
    }
    let prescription: { items: typeof plan.prescription; total: number; patientTotal: string } | null = null;
    if (analysed && plan.prescription.length > 0) {
      const total = plan.prescription.reduce((sum, i) => sum + i.price, 0);
      prescription = { items: plan.prescription, total, patientTotal: (await this.patientShare(total, amuPaidUntilGameDay)).toString() };
    }
    return {
      id: v.id,
      day: v.day,
      status: v.status,
      vitals: plan.vitals,
      examFr: plan.examFr,
      examEn: plan.examEn,
      analyses,
      pendingTotal: pending.toString(),
      interpretation: analysed ? { illness: v.illnessId, fr: plan.interpretFr, en: plan.interpretEn } : null,
      prescription,
    };
  }

  /** Consultation ouverte du personnage, ou null (aucune, terminée, ou maladie différente depuis). */
  private async openVisit(tx: Pick<PrismaService, 'medicalVisit'>, c: { id: string; illnessId: string | null }) {
    const v = await tx.medicalVisit.findFirst({ where: { characterId: c.id, status: { in: ['CONSULTED', 'ANALYZED'] } }, orderBy: { createdAt: 'desc' } });
    return v && v.illnessId === c.illnessId ? v : null;
  }

  async currentVisit(accountId: string) {
    const c = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true, illnessId: true, amuPaidUntilGameDay: true } });
    if (!c) throw new NotFoundException('no_character');
    const v = await this.openVisit(this.prisma, c);
    return { visit: v ? await this.visitView(v, c.amuPaidUntilGameDay) : null };
  }

  /** Consultation à l'hôpital : examen clinique (constantes) et demandes d'analyses ; le diagnostic vient après les résultats. */
  consult(accountId: string, idem?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      await this.atHospital(c.locationId);
      const rules = await this.settings.get('health.rules');
      const key = idem ? `consult:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex('consult');
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) {
        const v = await this.openVisit(tx as never, c);
        return { replay: true, paid: '0', visit: v ? await this.visitView(v, c.amuPaidUntilGameDay) : null };
      }
      // Consultation déjà ouverte pour cette même maladie : on la reprend (examen et analyses déjà faits) au lieu de refaire
      // et de repayer les mêmes tests ; une nouvelle visite n'est possible qu'après le traitement ou un changement de maladie
      const open = await this.openVisit(tx as never, c);
      if (open) return { replay: true, paid: '0', visit: await this.visitView(open, c.amuPaidUntilGameDay) };
      const pay = await this.patientShare(rules.consultPrice, c.amuPaidUntilGameDay);
      if (pay > 0n) await this.ledger.post(tx, { kind: 'HEALTH', idempotencyKey: key, requestHash, memo: 'consult', legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: pay }] });
      // Une nouvelle consultation remplace la précédente non terminée
      await tx.medicalVisit.updateMany({ where: { characterId: c.id, status: { in: ['CONSULTED', 'ANALYZED'] } }, data: { status: 'CLOSED' } });
      const wk = await this.settings.get('health.workup');
      const plan = wk.byIllness[c.illnessId && wk.byIllness[c.illnessId] ? c.illnessId : 'healthy']!;
      const v = await tx.medicalVisit.create({ data: { characterId: c.id, day: await this.today(), illnessId: c.illnessId, status: 'CONSULTED', orders: plan.orders } });
      return { replay: false, paid: pay.toString(), visit: await this.visitView(v, c.amuPaidUntilGameDay) };
    });
  }

  /** Faire toutes les analyses demandées : le laboratoire est payé (part du patient), résultats, interprétation et ordonnance suivent. */
  analyses(accountId: string, idem?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      await this.atHospital(c.locationId);
      const key = idem ? `analyses:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex('analyses');
      const v = await this.openVisit(tx as never, c);
      if (!v) throw new BadRequestException('consult_first');
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true, paid: '0', visit: await this.visitView(v, c.amuPaidUntilGameDay) };
      if (v.status !== 'CONSULTED') throw new BadRequestException('analyses_done');
      const wk = await this.settings.get('health.workup');
      const orders = (v.orders as string[]).map((id) => wk.analyses.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a);
      const total = orders.reduce((sum, a) => sum + a.price, 0);
      const pay = await this.patientShare(total, c.amuPaidUntilGameDay);
      if (pay > 0n) await this.ledger.post(tx, { kind: 'HEALTH', idempotencyKey: key, requestHash, memo: 'analyses', legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: pay }] });
      const results = orders.map((a) => ({ id: a.id }));
      const updated = await tx.medicalVisit.update({ where: { id: v.id }, data: { status: 'ANALYZED', results } });
      // Le diagnostic est posé : le nom de la maladie apparaît et le traitement devient possible
      if (c.illnessId) await tx.character.update({ where: { id: c.id }, data: { diagnosed: true } });
      return { replay: false, paid: pay.toString(), visit: await this.visitView(updated, c.amuPaidUntilGameDay) };
    });
  }

  /** « Se traiter » : on règle l'ordonnance (part du patient), la maladie est soignée et la santé remonte. */
  treat(accountId: string, idem?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      await this.atHospital(c.locationId);
      if (!c.illnessId) throw new BadRequestException('not_ill');
      const v = await this.openVisit(tx as never, c);
      if (!v || v.status !== 'ANALYZED') throw new BadRequestException('consult_first');
      const wk = await this.settings.get('health.workup');
      const ill = (await this.settings.get('health.illnesses')).find((i) => i.id === c.illnessId);
      const rules = await this.settings.get('health.rules');
      const key = idem ? `treat:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`treat|${c.illnessId}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true, paid: '0' };
      // Montant décidé par le serveur : somme de l'ordonnance, à défaut le prix du traitement de la maladie
      const items = wk.byIllness[c.illnessId]?.prescription ?? [];
      const full = items.length > 0 ? items.reduce((sum, i) => sum + i.price, 0) : ill?.treatment ?? 0;
      const pay = await this.patientShare(full, c.amuPaidUntilGameDay);
      if (pay > 0n) await this.ledger.post(tx, { kind: 'HEALTH', idempotencyKey: key, requestHash, memo: `treat:${c.illnessId}`, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: pay }] });
      const n = applyEffects(needsOf(c), { health: rules.healOnTreat, morale: 5 });
      await tx.character.update({ where: { id: c.id }, data: { ...n, illnessId: null, illnessDay: null, diagnosed: false } });
      await tx.medicalVisit.update({ where: { id: v.id }, data: { status: 'TREATED' } });
      return { replay: false, paid: pay.toString(), covered: (BigInt(full) - pay).toString(), cured: c.illnessId };
    });
  }

  // ───────────── Famille ─────────────

  async family(accountId: string) {
    const c = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
    if (!c) throw new NotFoundException('no_character');
    const rows = await this.prisma.familyRequest.findMany({ where: { characterId: c.id }, orderBy: { createdAt: 'desc' }, take: 20 });
    return rows.map((r) => ({ id: r.id, kind: r.kind, amount: r.amount.toString(), day: r.day, expiresDay: r.expiresDay, status: r.status }));
  }

  /** Répondre à une demande de la famille : envoyer l'argent (respect gagné) ou refuser (respect perdu). */
  answerFamily(accountId: string, id: string, pay: boolean, idem?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const r = await tx.familyRequest.findUnique({ where: { id } });
      if (!r || r.characterId !== c.id) throw new NotFoundException('unknown_request');
      if (r.status !== 'PENDING') throw new ConflictException('request_closed');
      const rule = (await this.settings.get('family.rules')).requests.find((x) => x.id === r.kind);
      const closed = await tx.familyRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: pay ? 'PAID' : 'REFUSED' } });
      if (closed.count !== 1) throw new ConflictException('request_closed');
      if (pay) {
        await this.ledger.post(tx, { kind: 'FAMILY', idempotencyKey: idem ? `family:${c.id}:${idem}` : `family:${id}`, requestHash: sha256Hex(`family|${id}`), memo: r.kind, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: r.amount }] });
      }
      const n = applyEffects(needsOf(c), pay ? { respect: rule?.paidRespect ?? 0, morale: rule?.paidMorale ?? 0 } : { respect: -(rule?.refusedRespect ?? 0), morale: -(rule?.refusedMorale ?? 0) });
      await tx.character.update({ where: { id: c.id }, data: n });
      return { id, paid: pay ? r.amount.toString() : '0' };
    });
  }

  // ───────────── Cérémonies entre joueurs ─────────────

  async ceremonies(accountId: string) {
    const c = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true, locationId: true } });
    if (!c) throw new NotFoundException('no_character');
    const today = await this.today();
    const rows = await this.prisma.ceremony.findMany({
      where: { cancelled: false, day: { gte: today - 1 } },
      include: { host: { select: { id: true, name: true } }, guests: { select: { characterId: true, gift: true } } },
      orderBy: { day: 'asc' },
      take: 50,
    });
    return {
      today,
      list: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        venueId: r.venueId,
        day: r.day,
        host: r.host.name,
        mine: r.host.id === c.id,
        guests: r.guests.length,
        attended: r.guests.some((g) => g.characterId === c.id),
        gifts: r.host.id === c.id ? r.guests.reduce((s, g) => s + g.gift, 0n).toString() : null,
        canAttend: r.day === today && r.venueId === c.locationId && r.host.id !== c.id,
      })),
    };
  }

  /** Organiser une cérémonie : la fête est payée d'avance (traiteur, chaises, bâches, musique), respect gagné. */
  async organize(accountId: string, kind: CeremonyKind, venueId: string, inDays: number, idem?: string) {
    let announce: (() => void) | null = null;
    const r = await this.chars.act(accountId, async (tx, c) => {
      const rules = await this.settings.get('ceremony.rules');
      if (inDays < rules.minDaysAhead || inDays > rules.maxDaysAhead) throw new BadRequestException('ceremony_bad_day');
      // Lieux de fête prévus par le réglage (« home » désigne le logement de chacun : les invités ne pourraient pas s'y retrouver)
      if (!rules.venues.includes(venueId)) throw new BadRequestException('ceremony_bad_venue');
      const venue = await tx.venue.findUnique({ where: { id: venueId }, select: { enabled: true } });
      if (!venue?.enabled) throw new NotFoundException('unknown_venue');
      const hotel = await this.settings.get('hotel');
      const hall = venueId === hotel.venueId ? hotel.halls.find((h) => h.id === hotel.partyHall) : undefined;
      const today = await this.today();
      const recent = await tx.ceremony.count({ where: { hostId: c.id, cancelled: false, day: { gte: today - GAME_DAYS_PER_MONTH } } });
      if (recent >= rules.maxPerMonth) throw new BadRequestException('ceremony_too_many');
      const k = rules.kinds[kind];
      const key = idem ? `ceremony:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`ceremony|${kind}|${venueId}|${inDays}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true };
      // Fête à l'hôtel : la salle des fêtes est louée pour le jour dit, en plus de la fête
      const cost = k.cost + (hall?.daily ?? 0);
      if (cost > 0) await this.ledger.post(tx, { kind: 'CEREMONY', idempotencyKey: key, requestHash, memo: kind, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(cost) }] });
      const cer = await tx.ceremony.create({ data: { hostId: c.id, kind, venueId, day: today + inDays, cost: BigInt(cost) } });
      if (hall) await this.hotel.reserveHall(tx, c.id, venueId, hall, today + inDays, cer.id);
      announce = () => this.live?.announce(c.city, 'ceremony', { host: c.name, ceremony: kind, venueId, day: today + inDays });
      await tx.character.update({ where: { id: c.id }, data: applyEffects(needsOf(c), { respect: k.respect, morale: 5 }) });
      return { replay: false, ceremony: cer.id, day: cer.day, paid: String(cost) };
    });
    (announce as (() => void) | null)?.();
    return r;
  }

  /** Assister à une cérémonie le jour dit, sur place, avec un don à l'hôte (montant choisi dans les bornes). */
  attend(accountId: string, id: string, gift: number, idem?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const rules = await this.settings.get('ceremony.rules');
      if (!Number.isInteger(gift) || gift < rules.minGift || gift > rules.maxGift) throw new BadRequestException('gift_out_of_bounds');
      const cer = await tx.ceremony.findUnique({ where: { id } });
      if (!cer || cer.cancelled) throw new NotFoundException('unknown_ceremony');
      if (cer.hostId === c.id) throw new ForbiddenException('own_ceremony');
      if (cer.day !== (await this.today())) throw new BadRequestException('ceremony_not_today');
      if (cer.venueId !== c.locationId) throw new BadRequestException('not_at_ceremony');
      if (await tx.ceremonyGuest.findUnique({ where: { ceremonyId_characterId: { ceremonyId: id, characterId: c.id } } })) throw new ConflictException('already_attended');
      const host = await tx.wallet.findUnique({ where: { characterId: cer.hostId }, select: { id: true } });
      if (!host) throw new NotFoundException('unknown_ceremony');
      if (gift > 0) await this.ledger.post(tx, { kind: 'CEREMONY_GIFT', idempotencyKey: idem ? `gift:${c.id}:${idem}` : `gift:${id}:${c.id}`, requestHash: sha256Hex(`gift|${id}|${gift}`), memo: id, legs: [{ from: c.walletId, to: host.id, amount: BigInt(gift) }] });
      await tx.ceremonyGuest.create({ data: { ceremonyId: id, characterId: c.id, gift: BigInt(gift) } });
      await tx.character.update({ where: { id: c.id }, data: applyEffects(needsOf(c), { respect: rules.guestRespect, morale: rules.guestMorale, hunger: 15 }) });
      return { ceremony: id, gift: String(gift) };
    });
  }

  cancelCeremony(accountId: string, id: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const cer = await tx.ceremony.findUnique({ where: { id }, include: { _count: { select: { guests: true } } } });
      if (!cer || cer.hostId !== c.id || cer.cancelled) throw new NotFoundException('unknown_ceremony');
      if (cer._count.guests > 0) throw new BadRequestException('ceremony_has_guests');
      // Fête annulée : les frais engagés ne sont pas rendus, et l'annulation coûte le respect gagné
      const k = (await this.settings.get('ceremony.rules')).kinds[cer.kind];
      await tx.ceremony.update({ where: { id }, data: { cancelled: true } });
      await tx.hallBooking.deleteMany({ where: { ceremonyId: id } }); // la salle redevient libre (la location n'est pas remboursée)
      await tx.character.update({ where: { id: c.id }, data: applyEffects(needsOf(c), { respect: -k.respect }) });
      return { ceremony: id };
    });
  }

  // ───────────── Coupures et équipements ─────────────

  /** Acheter un équipement contre les coupures (installé au logement, prix fixé par le réglage). */
  equip(accountId: string, kind: Equipment, idem?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      if (c.homeless) throw new BadRequestException('homeless');
      if (c[kind]) throw new ConflictException('already_equipped');
      const out = await this.settings.get('utilities.outages');
      const price = BigInt(out[EQUIP_PRICE[kind]]);
      const key = idem ? `equip:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`equip|${kind}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true };
      if (price > 0n) await this.ledger.post(tx, { kind: 'EQUIPMENT', idempotencyKey: key, requestHash, memo: kind, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: price }] });
      await tx.character.update({ where: { id: c.id }, data: { [kind]: true } });
      return { replay: false, kind, paid: price.toString() };
    });
  }

  /** Actualité économique de la semaine (commune à tous les joueurs). */
  async events() {
    const today = await this.today();
    return { day: today, events: activeEvents(today, await this.settings.get('economy.events')).map((e) => e.id) };
  }
}
