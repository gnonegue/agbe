import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService, needsOf } from '../character/character.service';
import { gameTimeAt } from '../economy/clock';
import { applyEffects } from '../economy/needs';
import { priceBounds, rankOf, saleSplit } from '../economy/market';
import { wholesaleFactorBp } from '../economy/events';
import { sha256Hex } from '../common/crypto';

/**
 * Marché entre joueurs : location d'étal, achat en gros, prix fixés par le vendeur dans des bornes,
 * vente aux autres joueurs avec taxe de marché, inventaire et usage des marchandises.
 */
@Injectable()
export class MarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
  ) {}

  private async today(): Promise<number> {
    return gameTimeAt(await this.settings.clock(), Date.now()).day;
  }

  private async good(id: string) {
    const g = (await this.settings.get('market.goods')).find((x) => x.id === id);
    if (!g) throw new NotFoundException('unknown_good');
    return g;
  }

  async wholesalePrice(goodId: string, day: number): Promise<number> {
    const g = await this.good(goodId);
    const f = wholesaleFactorBp(goodId, day, await this.settings.get('economy.events'));
    return Math.max(1, Math.round((g.wholesale * f) / 10_000));
  }

  async mine(accountId: string) {
    const c = await this.prisma.character.findUnique({ where: { accountId }, include: { stall: { include: { items: { orderBy: { goodId: 'asc' } } } }, inventory: { where: { qty: { gt: 0 } }, orderBy: { goodId: 'asc' } } } });
    if (!c) throw new NotFoundException('no_character');
    const rules = await this.settings.get('market.rules');
    const day = await this.today();
    const goods = await this.settings.get('market.goods');
    const wholesale = Object.fromEntries(await Promise.all(goods.map(async (g) => [g.id, await this.wholesalePrice(g.id, day)] as const)));
    return {
      day,
      wholesale,
      stall: c.stall
        ? {
            id: c.stall.id,
            venueId: c.stall.venueId,
            paidUntilDay: c.stall.paidUntilDay,
            open: c.stall.paidUntilDay > day,
            sales: c.stall.sales.toString(),
            rank: rankOf(c.stall.sales, rules.ranks),
            items: c.stall.items.map((i) => ({ goodId: i.goodId, qty: i.qty, price: i.price })),
          }
        : null,
      inventory: c.inventory.map((i) => ({ goodId: i.goodId, qty: i.qty })),
    };
  }

  /** Étals ouverts des autres joueurs dans le marché où l'on se trouve. */
  async stalls(accountId: string) {
    const c = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true, locationId: true } });
    if (!c) throw new NotFoundException('no_character');
    const rules = await this.settings.get('market.rules');
    if (!rules.venues.includes(c.locationId)) return { venueId: c.locationId, stalls: [] };
    const day = await this.today();
    const rows = await this.prisma.stall.findMany({
      where: { venueId: c.locationId, paidUntilDay: { gt: day }, characterId: { not: c.id }, items: { some: { qty: { gt: 0 } } } },
      include: { character: { select: { name: true } }, items: { where: { qty: { gt: 0 } }, orderBy: { goodId: 'asc' } } },
      orderBy: { sales: 'desc' },
      take: 50,
    });
    return {
      venueId: c.locationId,
      stalls: rows.map((s) => ({ id: s.id, seller: s.character.name, rank: rankOf(s.sales, rules.ranks).id, items: s.items.map((i) => ({ goodId: i.goodId, qty: i.qty, price: i.price })) })),
    };
  }

  /** Louer (ou prolonger) un étal dans le marché où l'on se trouve ; loyer versé à la commune (Trésor). */
  rent(accountId: string, weeks: number, idem?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const rules = await this.settings.get('market.rules');
      if (!rules.venues.includes(c.locationId)) throw new BadRequestException('not_at_market');
      if (weeks < 1 || weeks > rules.maxWeeks) throw new BadRequestException('stall_bad_weeks');
      const day = await this.today();
      const s = await tx.stall.findUnique({ where: { characterId: c.id } });
      if (s && s.paidUntilDay > day && s.venueId !== c.locationId) throw new ConflictException('stall_elsewhere');
      const from = s && s.paidUntilDay > day ? s.paidUntilDay : day;
      if (from + weeks * 7 - day > rules.maxWeeks * 7) throw new BadRequestException('stall_bad_weeks');
      const amount = BigInt(rules.weeklyRent) * BigInt(weeks);
      const key = idem ? `stall:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`stall|${c.locationId}|${weeks}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true, paidUntilDay: s?.paidUntilDay ?? day };
      if (amount > 0n) await this.ledger.post(tx, { kind: 'STALL_RENT', idempotencyKey: key, requestHash, memo: c.locationId, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'TREASURY'), amount }] });
      const paidUntilDay = from + weeks * 7;
      // Étal déménagé (l'ancien a expiré) : le stock suit la vendeuse
      await tx.stall.upsert({ where: { characterId: c.id }, create: { characterId: c.id, venueId: c.locationId, paidUntilDay }, update: { venueId: c.locationId, paidUntilDay } });
      return { replay: false, paidUntilDay, paid: amount.toString() };
    });
  }

  /** Achat en gros au prix du jour (calculé par le serveur), sur place, pour garnir son étal. */
  wholesale(accountId: string, goodId: string, qty: number, idem?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const rules = await this.settings.get('market.rules');
      if (!rules.venues.includes(c.locationId)) throw new BadRequestException('not_at_market');
      const day = await this.today();
      const s = await tx.stall.findUnique({ where: { characterId: c.id } });
      if (!s || s.paidUntilDay <= day) throw new BadRequestException('stall_closed');
      const g = await this.good(goodId);
      const unit = await this.wholesalePrice(goodId, day);
      const item = await tx.stallItem.findUnique({ where: { stallId_goodId: { stallId: s.id, goodId } } });
      if ((item?.qty ?? 0) + qty > rules.maxStock) throw new BadRequestException('stall_stock_full');
      const amount = BigInt(unit) * BigInt(qty);
      const key = idem ? `wholesale:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`wholesale|${goodId}|${qty}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true, paid: '0' };
      await this.ledger.post(tx, { kind: 'WHOLESALE', idempotencyKey: key, requestHash, memo: `${goodId}x${qty}`, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount }] });
      // Prix de vente proposé par défaut : prix de gros + 30 %, dans les bornes
      const price = item?.price ?? Math.min(priceBounds(g.wholesale, g.maxMarkupBp).max, Math.round(unit * 1.3));
      await tx.stallItem.upsert({ where: { stallId_goodId: { stallId: s.id, goodId } }, create: { stallId: s.id, goodId, qty, price }, update: { qty: { increment: qty } } });
      return { replay: false, paid: amount.toString(), unit };
    });
  }

  /** Le vendeur fixe son prix, dans les bornes de la marchandise (aucun prix hors limites, aucun mouvement d'argent). */
  setPrice(accountId: string, goodId: string, price: number) {
    return this.chars.act(accountId, async (tx, c) => {
      const g = await this.good(goodId);
      const b = priceBounds(g.wholesale, g.maxMarkupBp);
      if (price < b.min || price > b.max) throw new BadRequestException('price_out_of_bounds');
      const s = await tx.stall.findUnique({ where: { characterId: c.id } });
      if (!s) throw new NotFoundException('no_stall');
      const r = await tx.stallItem.updateMany({ where: { stallId: s.id, goodId }, data: { price } });
      if (r.count !== 1) throw new NotFoundException('not_in_stall');
      return { goodId, price };
    });
  }

  /** Retirer du stock de l'étal vers son inventaire (sans remboursement). */
  withdraw(accountId: string, goodId: string, qty: number) {
    return this.chars.act(accountId, async (tx, c) => {
      const s = await tx.stall.findUnique({ where: { characterId: c.id } });
      if (!s) throw new NotFoundException('no_stall');
      const r = await tx.stallItem.updateMany({ where: { stallId: s.id, goodId, qty: { gte: qty } }, data: { qty: { decrement: qty } } });
      if (r.count !== 1) throw new BadRequestException('not_enough_stock');
      await tx.inventoryItem.upsert({ where: { characterId_goodId: { characterId: c.id, goodId } }, create: { characterId: c.id, goodId, qty }, update: { qty: { increment: qty } } });
      return { goodId, qty };
    });
  }

  /** Achat à l'étal d'un autre joueur, sur place, au prix affiché par le vendeur (lu en base, jamais envoyé par le client). */
  buy(accountId: string, stallId: string, goodId: string, qty: number, idem?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const rules = await this.settings.get('market.rules');
      if (qty < 1 || qty > rules.maxBuy) throw new BadRequestException('bad_quantity');
      const s = await tx.stall.findUnique({ where: { id: stallId }, include: { character: { select: { id: true } } } });
      if (!s) throw new NotFoundException('no_stall');
      if (s.characterId === c.id) throw new ForbiddenException('own_stall');
      if (s.venueId !== c.locationId) throw new BadRequestException('not_at_stall');
      if (s.paidUntilDay <= (await this.today())) throw new BadRequestException('stall_closed');
      const key = idem ? `buy:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`buy|${stallId}|${goodId}|${qty}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true, paid: '0' };
      const item = await tx.stallItem.findUnique({ where: { stallId_goodId: { stallId, goodId } } });
      if (!item) throw new NotFoundException('not_in_stall');
      // Stock décrémenté sous condition : deux acheteurs ne peuvent pas prendre la même marchandise
      const r = await tx.stallItem.updateMany({ where: { id: item.id, qty: { gte: qty } }, data: { qty: { decrement: qty } } });
      if (r.count !== 1) throw new BadRequestException('not_enough_stock');
      const split = saleSplit(item.price, qty, rules.taxBp);
      const seller = await tx.wallet.findUniqueOrThrow({ where: { characterId: s.characterId }, select: { id: true } });
      const legs = [{ from: c.walletId, to: seller.id, amount: split.total }];
      if (split.tax > 0n) legs.push({ from: seller.id, to: await this.ledger.systemWalletId(tx, 'TREASURY'), amount: split.tax });
      await this.ledger.post(tx, { kind: 'MARKET_SALE', idempotencyKey: key, requestHash, memo: `${stallId}:${goodId}x${qty}`, legs });
      await tx.stall.update({ where: { id: s.id }, data: { sales: { increment: split.total } } });
      await tx.inventoryItem.upsert({ where: { characterId_goodId: { characterId: c.id, goodId } }, create: { characterId: c.id, goodId, qty }, update: { qty: { increment: qty } } });
      return { replay: false, paid: split.total.toString(), unit: item.price };
    });
  }

  /** Utiliser une marchandise de son inventaire : effets sur les besoins (manger, se laver, s'habiller…). */
  use(accountId: string, goodId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const g = await this.good(goodId);
      const r = await tx.inventoryItem.updateMany({ where: { characterId: c.id, goodId, qty: { gte: 1 } }, data: { qty: { decrement: 1 } } });
      if (r.count !== 1) throw new BadRequestException('not_in_inventory');
      const n = applyEffects(needsOf(c), g.effects);
      await tx.character.update({ where: { id: c.id }, data: n });
      return { goodId, effects: g.effects };
    });
  }
}
