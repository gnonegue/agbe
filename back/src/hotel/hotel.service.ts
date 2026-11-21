import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService, type Tx } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService, needsOf } from '../character/character.service';
import { gameTimeAt } from '../economy/clock';
import { applyEffects, withMealEnergy } from '../economy/needs';
import { sha256Hex } from '../common/crypto';
import { activeStay } from './stay';

/** Chambres occupées d'une catégorie sur au moins une nuit de [from, to[. */
async function occupied(tx: Tx | PrismaService, venueId: string, roomType: string, from: number, to: number): Promise<number> {
  return tx.hotelStay.count({ where: { venueId, roomType, checkedOut: false, fromDay: { lt: to }, toDay: { gt: from } } });
}

/**
 * Hôtel : réservation de chambres par catégorie (nombre limité), séjour où l'on dort et se repose,
 * service en chambre, location de salles à la journée (réunion, fête).
 */
@Injectable()
export class HotelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
  ) {}

  private async today(): Promise<number> {
    return gameTimeAt(await this.settings.clock(), Date.now()).day;
  }

  async view(accountId: string) {
    const c = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
    if (!c) throw new NotFoundException('no_character');
    const cfg = await this.settings.get('hotel');
    const day = await this.today();
    const stay = await activeStay(this.prisma, c.id, cfg.venueId, day);
    const halls = await this.prisma.hallBooking.findMany({ where: { venueId: cfg.venueId, day: { gte: day, lt: day + 31 } }, select: { hallId: true, day: true, characterId: true } });
    return {
      day,
      venueId: cfg.venueId,
      maxNights: cfg.maxNights,
      rooms: await Promise.all(cfg.rooms.map(async (r) => ({ ...r, free: Math.max(0, r.count - (await occupied(this.prisma, cfg.venueId, r.id, day, day + 1))) }))),
      stay: stay ? { id: stay.id, roomType: stay.roomType, fromDay: stay.fromDay, toDay: stay.toDay, nightsLeft: stay.toDay - day } : null,
      roomService: cfg.roomService,
      halls: cfg.halls.map((h) => ({ ...h, booked: halls.filter((b) => b.hallId === h.id).map((b) => ({ day: b.day, mine: b.characterId === c.id })) })),
    };
  }

  /** Réserver des nuits à partir d'aujourd'hui (ou prolonger un séjour en cours) ; prix fixé par le réglage. */
  book(accountId: string, roomType: string, nights: number, idem?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const cfg = await this.settings.get('hotel');
      const room = cfg.rooms.find((r) => r.id === roomType);
      if (!room) throw new NotFoundException('unknown_room');
      if (nights < 1 || nights > cfg.maxNights) throw new BadRequestException('hotel_bad_nights');
      const day = await this.today();
      const cur = await activeStay(tx, c.id, cfg.venueId, day);
      if (cur && cur.roomType !== roomType) throw new ConflictException('hotel_other_room');
      const from = cur ? cur.toDay : day;
      if (from + nights - day > cfg.maxNights) throw new BadRequestException('hotel_bad_nights');
      const key = idem ? `hotel:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`hotel|${roomType}|${nights}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true };
      // Une réservation à la fois par catégorie : la dernière chambre libre ne part qu'une fois
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`hotel:${cfg.venueId}:${roomType}`}))`);
      if ((await occupied(tx, cfg.venueId, roomType, from, from + nights)) >= room.count) throw new ConflictException('hotel_full');
      const amount = BigInt(room.nightly) * BigInt(nights);
      if (amount > 0n) await this.ledger.post(tx, { kind: 'HOTEL', idempotencyKey: key, requestHash, memo: `${roomType}x${nights}`, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount }] });
      if (cur) await tx.hotelStay.update({ where: { id: cur.id }, data: { toDay: cur.toDay + nights, paid: { increment: amount } } });
      else await tx.hotelStay.create({ data: { characterId: c.id, venueId: cfg.venueId, roomType, fromDay: day, toDay: day + nights, paid: amount } });
      return { replay: false, roomType, nights, paid: amount.toString(), untilDay: from + nights };
    });
  }

  /** Départ anticipé : la chambre est libérée, les nuits restantes ne sont pas remboursées. */
  checkout(accountId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const cfg = await this.settings.get('hotel');
      const stay = await activeStay(tx, c.id, cfg.venueId, await this.today());
      if (!stay) throw new NotFoundException('no_stay');
      await tx.hotelStay.update({ where: { id: stay.id }, data: { checkedOut: true } });
      return { stay: stay.id };
    });
  }

  /** Service en chambre : réservé aux clients présents à l'hôtel. */
  order(accountId: string, itemId: string, idem?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const cfg = await this.settings.get('hotel');
      const item = cfg.roomService.find((i) => i.id === itemId);
      if (!item) throw new NotFoundException('unknown_item');
      if (c.locationId !== cfg.venueId) throw new BadRequestException('not_at_hotel');
      if (!(await activeStay(tx, c.id, cfg.venueId, await this.today()))) throw new BadRequestException('no_stay');
      const key = idem ? `room-service:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`room-service|${itemId}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true };
      if (item.price > 0) await this.ledger.post(tx, { kind: 'HOTEL', idempotencyKey: key, requestHash, memo: itemId, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(item.price) }] });
      await tx.character.update({ where: { id: c.id }, data: withMealEnergy(applyEffects(needsOf(c), { hunger: item.hunger, energy: item.energy, morale: item.morale, health: item.health }), item.hunger, await this.settings.get('food.meal')) });
      return { replay: false, item: itemId, paid: String(item.price) };
    });
  }

  /** Louer une salle pour un jour (réunion d'affaires…) ; une seule location par salle et par jour. */
  bookHall(accountId: string, hallId: string, inDays: number, idem?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const cfg = await this.settings.get('hotel');
      const hall = cfg.halls.find((h) => h.id === hallId);
      if (!hall) throw new NotFoundException('unknown_hall');
      if (inDays < 0 || inDays > 30) throw new BadRequestException('hall_bad_day');
      const day = (await this.today()) + inDays;
      const key = idem ? `hall:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`hall|${hallId}|${inDays}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true, day };
      await this.reserveHall(tx, c.id, cfg.venueId, hall, day, null);
      if (hall.daily > 0) await this.ledger.post(tx, { kind: 'HOTEL', idempotencyKey: key, requestHash, memo: `${hallId}:${day}`, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(hall.daily) }] });
      await tx.character.update({ where: { id: c.id }, data: applyEffects(needsOf(c), { respect: hall.respect }) });
      return { replay: false, hall: hallId, day, paid: String(hall.daily) };
    });
  }

  /** Réservation de salle (contrainte unique salle + jour) ; utilisée aussi pour les fêtes organisées à l'hôtel. */
  async reserveHall(tx: Tx, characterId: string, venueId: string, hall: { id: string; daily: number }, day: number, ceremonyId: string | null) {
    try {
      await tx.hallBooking.create({ data: { characterId, venueId, hallId: hall.id, day, paid: BigInt(hall.daily), ceremonyId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('hall_taken');
      throw e;
    }
  }
}
