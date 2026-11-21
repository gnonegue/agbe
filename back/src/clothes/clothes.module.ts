import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers, HttpCode, Injectable, Logger, Module, NotFoundException, OnModuleDestroy, OnModuleInit, Optional, Post } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService, type Tx } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService, HOME } from '../character/character.service';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { gameHoursBetween, gameTimeAt } from '../economy/clock';
import { saleSplit } from '../economy/market';
import { closeQuote, npcDemandBp, outfitError, shopPrices, SLOTS, type Outfit } from '../economy/clothes';
import { sha256Hex } from '../common/crypto';

const ITEM_RE = /^[a-z0-9_]{2,32}$/;

class ItemDto {
  @Matches(ITEM_RE)
  itemId: string;
}
class BuyFromDto extends ItemDto {
  @IsUUID()
  shopId: string;
}
class WearDto {
  @IsOptional()
  @Matches(ITEM_RE)
  top?: string;

  @IsOptional()
  @Matches(ITEM_RE)
  bottom?: string;

  @IsOptional()
  @Matches(ITEM_RE)
  dress?: string;

  @IsOptional()
  @Matches(ITEM_RE)
  shoes?: string;
}
class RentDto {
  @IsInt()
  @Min(1)
  @Max(52)
  weeks: number;
}
class StockDto extends ItemDto {
  @IsInt()
  @Min(1)
  @Max(1000)
  qty: number;
}
class PriceDto extends ItemDto {
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  price: number;
}

function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

/** Tenue enregistrée dans l'apparence (look.wear), relue sans faire confiance à son contenu. */
function wearOf(look: unknown): Outfit | null {
  const w = look && typeof look === 'object' ? (look as Record<string, unknown>).wear : undefined;
  if (!w || typeof w !== 'object') return null;
  const out: Outfit = {};
  for (const s of SLOTS) {
    const v = (w as Record<string, unknown>)[s];
    if (typeof v === 'string' && ITEM_RE.test(v)) out[s] = v;
  }
  return out;
}

/** Le personnage est-il une femme ? (choix de l'éditeur d'apparence ; sinon tiré de l'identifiant comme côté client). */
function isFemale(look: unknown, id: string): boolean {
  const f = look && typeof look === 'object' ? (look as Record<string, unknown>).female : undefined;
  if (typeof f === 'boolean') return f;
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h & 1) === 1;
}

/**
 * Habillement : achat de vêtements en boutique (prix du catalogue) ou à la boutique d'un joueur (prix fixé par lui, borné),
 * garde-robe et tenue portée (choisie à la maison), location et gestion d'une boutique de vêtements par un joueur.
 * Le client n'envoie que des identifiants d'articles ; tous les prix sont décidés ici.
 */
@Injectable()
export class ClothesService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
    @Optional() private readonly logger: Logger = new Logger('Clothes'),
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.npcTick(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Clients du quartier (PNJ) : dans chaque boutique ouverte et garnie, ils passent à un rythme réglé (`npcVisitsPerDay`),
   * regardent un article au hasard et l'achètent selon son prix (cher = peu d'achats, nul au-delà de 140 % du prix public).
   * La vente suit les règles des ventes entre joueurs : argent du marché vers le vendeur, taxe au Trésor, stock décrémenté.
   * Même hors ligne, le vendeur voit son stock se vendre : le loyer peut être couvert sans clients réels.
   */
  async npcTick(): Promise<number> {
    let sold = 0;
    try {
      const rules = await this.settings.get('clothes.rules');
      if (rules.npcVisitsPerDay <= 0) return 0;
      const catalog = await this.settings.get('clothes.items');
      const clock = await this.settings.clock();
      const day = await this.today();
      const shops = await this.prisma.clothingShop.findMany({ where: { paidUntilDay: { gt: day }, items: { some: { qty: { gt: 0 } } } }, select: { id: true } });
      for (const sh of shops) {
        try {
          const n = await this.prisma.$transaction(async (tx) => {
            const s = await tx.clothingShop.findUnique({ where: { id: sh.id }, include: { items: { where: { qty: { gt: 0 } } } } });
            if (!s || s.paidUntilDay <= day || s.items.length === 0) return 0;
            const now = Date.now();
            const last = s.lastNpcSaleAt ?? s.createdAt;
            const elapsedDays = gameHoursBetween(clock, last.getTime(), now) / 24;
            const visitsF = Math.min(elapsedDays, rules.npcMaxCatchUpDays) * rules.npcVisitsPerDay;
            if (visitsF < 1) return 0;
            const visits = Math.floor(visitsF) + (randomInt(1_000) / 1_000 < visitsF - Math.floor(visitsF) ? 1 : 0);
            await tx.clothingShop.update({ where: { id: s.id }, data: { lastNpcSaleAt: new Date(now) } });
            const seller = await tx.wallet.findUnique({ where: { characterId: s.characterId }, select: { id: true } });
            if (!seller) return 0;
            const stock = new Map(s.items.map((i) => [i.id, i]));
            let made = 0;
            for (let v = 0; v < visits; v++) {
              const open = [...stock.values()].filter((i) => i.qty > 0);
              if (open.length === 0) break;
              const line = open[randomInt(open.length)]!;
              const retail = catalog.find((g) => g.id === line.itemId)?.price ?? 0;
              if (randomInt(10_000) >= npcDemandBp(line.price, retail)) continue;
              const r = await tx.clothingShopItem.updateMany({ where: { id: line.id, qty: { gte: 1 } }, data: { qty: { decrement: 1 } } });
              if (r.count !== 1) continue;
              line.qty -= 1;
              const split = saleSplit(line.price, 1, rules.taxBp);
              const legs = [{ from: await this.ledger.systemWalletId(tx, 'MARKET'), to: seller.id, amount: split.total }];
              if (split.tax > 0n) legs.push({ from: seller.id, to: await this.ledger.systemWalletId(tx, 'TREASURY'), amount: split.tax });
              await this.ledger.post(tx, { kind: 'CLOTHES_NPC_SALE', memo: `${s.id}:${line.itemId}`, legs });
              await tx.clothingShop.update({ where: { id: s.id }, data: { sales: { increment: split.total } } });
              made++;
            }
            return made;
          });
          sold += n;
        } catch (e) {
          this.logger.warn(`Clients de la boutique ${sh.id} : ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.logger.warn(`Clients des boutiques : ${(e as Error).message}`);
    }
    return sold;
  }

  private async today(): Promise<number> {
    return gameTimeAt(await this.settings.clock(), Date.now()).day;
  }

  private async item(id: string) {
    const g = (await this.settings.get('clothes.items')).find((x) => x.id === id);
    if (!g) throw new NotFoundException('unknown_garment');
    return g;
  }

  /** Dans une boutique de vêtements ouverte ? */
  private async atShop(locationId: string): Promise<void> {
    if (!(await this.settings.get('clothes.rules')).venues.includes(locationId)) throw new BadRequestException('not_at_clothes_shop');
    await this.chars.assertOpen(locationId);
  }

  private async give(tx: Tx, characterId: string, itemId: string): Promise<void> {
    if (await tx.garment.findUnique({ where: { characterId_itemId: { characterId, itemId } } })) throw new ConflictException('garment_already_owned');
    await tx.garment.create({ data: { characterId, itemId } });
  }

  /** Catalogue, règles, garde-robe, tenue portée, sa boutique et les boutiques des joueurs du lieu où l'on se trouve. */
  async state(accountId: string) {
    const c = await this.prisma.character.findUnique({
      where: { accountId },
      select: { id: true, look: true, locationId: true, garments: { select: { itemId: true }, orderBy: { createdAt: 'asc' } }, clothingShop: { include: { items: { orderBy: { itemId: 'asc' } } } } },
    });
    if (!c) throw new NotFoundException('no_character');
    const [items, rules, day] = await Promise.all([this.settings.get('clothes.items'), this.settings.get('clothes.rules'), this.today()]);
    const here = rules.venues.includes(c.locationId) ? c.locationId : null;
    const shops = here
      ? await this.prisma.clothingShop.findMany({
          where: { venueId: here, paidUntilDay: { gt: day }, characterId: { not: c.id }, items: { some: { qty: { gt: 0 } } } },
          include: { character: { select: { name: true } }, items: { where: { qty: { gt: 0 } }, orderBy: { itemId: 'asc' } } },
          orderBy: { sales: 'desc' },
          take: 50,
        })
      : [];
    const s = c.clothingShop;
    return {
      items,
      rules,
      female: isFemale(c.look, c.id),
      owned: c.garments.map((g) => g.itemId),
      wear: wearOf(c.look),
      here,
      shop: s
        ? {
            id: s.id,
            venueId: s.venueId,
            paidUntilDay: s.paidUntilDay,
            open: s.paidUntilDay > day,
            sales: s.sales.toString(),
            items: s.items.map((i) => ({ itemId: i.itemId, qty: i.qty, price: i.price })),
            // Ce que rapporterait la fermeture maintenant (stock racheté, loyer remboursé en partie)
            closeQuote: (() => {
              const q = closeQuote(
                s.items.map((i) => ({ qty: i.qty, wholesale: shopPrices(items.find((g) => g.id === i.itemId)?.price ?? 0, rules.wholesaleBp, rules.maxPriceBp).wholesale })),
                Math.max(0, s.paidUntilDay - day),
                rules.weeklyRent,
                rules.closeBuybackBp,
                rules.closeRentRefundBp,
              );
              return { buyback: q.buyback.toString(), refund: q.refund.toString() };
            })(),
          }
        : null,
      shops: shops.map((x) => ({ id: x.id, seller: x.character.name, items: x.items.map((i) => ({ itemId: i.itemId, qty: i.qty, price: i.price })) })),
    };
  }

  /** Acheter un vêtement au prix du catalogue, dans une boutique de vêtements. */
  buy(accountId: string, itemId: string, key?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      await this.atShop(c.locationId);
      const g = await this.item(itemId);
      const idemKey = key ? `clothes:${c.id}:${key}` : undefined;
      const requestHash = sha256Hex(`clothes|${itemId}`);
      if (idemKey && (await this.ledger.findReplay(tx, idemKey, requestHash))) return { itemId, replay: true };
      await this.give(tx, c.id, itemId);
      await this.ledger.post(tx, { kind: 'CLOTHES', idempotencyKey: idemKey, requestHash, memo: itemId, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(g.price) }] });
      return { itemId, paid: String(g.price), replay: false };
    });
  }

  /** Acheter à la boutique d'un autre joueur, au prix affiché (lu en base) ; taxe sur la vente au Trésor. */
  buyFrom(accountId: string, shopId: string, itemId: string, key?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      await this.atShop(c.locationId);
      const rules = await this.settings.get('clothes.rules');
      const s = await tx.clothingShop.findUnique({ where: { id: shopId } });
      if (!s) throw new NotFoundException('no_clothing_shop');
      if (s.characterId === c.id) throw new ForbiddenException('own_clothing_shop');
      if (s.venueId !== c.locationId) throw new BadRequestException('not_at_clothing_shop');
      if (s.paidUntilDay <= (await this.today())) throw new BadRequestException('clothing_shop_closed');
      const idemKey = key ? `clothes-shop:${c.id}:${key}` : undefined;
      const requestHash = sha256Hex(`clothes-shop|${shopId}|${itemId}`);
      if (idemKey && (await this.ledger.findReplay(tx, idemKey, requestHash))) return { itemId, replay: true };
      const line = await tx.clothingShopItem.findUnique({ where: { shopId_itemId: { shopId, itemId } } });
      if (!line) throw new NotFoundException('not_in_clothing_shop');
      // Stock décrémenté sous condition : deux acheteurs ne peuvent pas prendre la dernière pièce
      const r = await tx.clothingShopItem.updateMany({ where: { id: line.id, qty: { gte: 1 } }, data: { qty: { decrement: 1 } } });
      if (r.count !== 1) throw new BadRequestException('not_enough_stock');
      await this.give(tx, c.id, itemId);
      const split = saleSplit(line.price, 1, rules.taxBp);
      const seller = await tx.wallet.findUniqueOrThrow({ where: { characterId: s.characterId }, select: { id: true } });
      const legs = [{ from: c.walletId, to: seller.id, amount: split.total }];
      if (split.tax > 0n) legs.push({ from: seller.id, to: await this.ledger.systemWalletId(tx, 'TREASURY'), amount: split.tax });
      await this.ledger.post(tx, { kind: 'CLOTHES_SALE', idempotencyKey: idemKey, requestHash, memo: `${shopId}:${itemId}`, legs });
      await tx.clothingShop.update({ where: { id: s.id }, data: { sales: { increment: split.total } } });
      return { itemId, paid: split.total.toString(), replay: false };
    });
  }

  /** Composer sa tenue avant de sortir (à la maison) ; sans aucune pièce, on revient à la tenue d'origine. */
  wear(accountId: string, outfit: Outfit) {
    return this.chars.act(accountId, async (tx, c) => {
      if (c.locationId !== HOME) throw new BadRequestException('dress_at_home');
      const sel: Outfit = {};
      for (const s of SLOTS) if (outfit[s]) sel[s] = outfit[s];
      const look = c.look && typeof c.look === 'object' && !Array.isArray(c.look) ? { ...(c.look as Record<string, unknown>) } : {};
      if (Object.keys(sel).length === 0) delete look.wear;
      else {
        const owned = new Set((await tx.garment.findMany({ where: { characterId: c.id }, select: { itemId: true } })).map((g) => g.itemId));
        const err = outfitError(sel, await this.settings.get('clothes.items'), owned, isFemale(c.look, c.id));
        if (err) throw new BadRequestException(err);
        look.wear = sel;
      }
      await tx.character.update({ where: { id: c.id }, data: { look: look as Prisma.InputJsonValue } });
      return { wear: (look.wear as Outfit | undefined) ?? null };
    });
  }

  // ---------- boutique d'un joueur ----------

  /** Louer (ou prolonger) sa boutique dans la boutique de vêtements où l'on se trouve ; loyer versé au Trésor. */
  rent(accountId: string, weeks: number, key?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const rules = await this.settings.get('clothes.rules');
      if (!rules.venues.includes(c.locationId)) throw new BadRequestException('not_at_clothes_shop');
      if (weeks < 1 || weeks > rules.maxWeeks) throw new BadRequestException('shop_bad_weeks');
      const day = await this.today();
      const s = await tx.clothingShop.findUnique({ where: { characterId: c.id } });
      if (s && s.paidUntilDay > day && s.venueId !== c.locationId) throw new ConflictException('clothing_shop_elsewhere');
      const from = s && s.paidUntilDay > day ? s.paidUntilDay : day;
      if (from + weeks * 7 - day > rules.maxWeeks * 7) throw new BadRequestException('shop_bad_weeks');
      const amount = BigInt(rules.weeklyRent) * BigInt(weeks);
      const idemKey = key ? `clothes-rent:${c.id}:${key}` : undefined;
      const requestHash = sha256Hex(`clothes-rent|${c.locationId}|${weeks}`);
      if (idemKey && (await this.ledger.findReplay(tx, idemKey, requestHash))) return { replay: true, paidUntilDay: s?.paidUntilDay ?? day };
      if (amount > 0n) await this.ledger.post(tx, { kind: 'SHOP_RENT', idempotencyKey: idemKey, requestHash, memo: c.locationId, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'TREASURY'), amount }] });
      const paidUntilDay = from + weeks * 7;
      // Boutique déménagée (l'ancienne a expiré) : le stock suit le vendeur
      await tx.clothingShop.upsert({ where: { characterId: c.id }, create: { characterId: c.id, venueId: c.locationId, paidUntilDay }, update: { venueId: c.locationId, paidUntilDay } });
      return { replay: false, paidUntilDay, paid: amount.toString() };
    });
  }

  /** Garnir sa boutique : achat en gros au fournisseur (part du prix public), sur place. */
  stock(accountId: string, itemId: string, qty: number, key?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const rules = await this.settings.get('clothes.rules');
      await this.atShop(c.locationId);
      const s = await tx.clothingShop.findUnique({ where: { characterId: c.id } });
      if (!s || s.paidUntilDay <= (await this.today())) throw new BadRequestException('clothing_shop_closed');
      if (s.venueId !== c.locationId) throw new BadRequestException('not_at_clothing_shop');
      const g = await this.item(itemId);
      const p = shopPrices(g.price, rules.wholesaleBp, rules.maxPriceBp);
      const line = await tx.clothingShopItem.findUnique({ where: { shopId_itemId: { shopId: s.id, itemId } } });
      if ((line?.qty ?? 0) + qty > rules.maxStock) throw new BadRequestException('shop_stock_full');
      const idemKey = key ? `clothes-stock:${c.id}:${key}` : undefined;
      const requestHash = sha256Hex(`clothes-stock|${itemId}|${qty}`);
      if (idemKey && (await this.ledger.findReplay(tx, idemKey, requestHash))) return { replay: true, paid: '0' };
      const amount = BigInt(p.wholesale) * BigInt(qty);
      await this.ledger.post(tx, { kind: 'CLOTHES_WHOLESALE', idempotencyKey: idemKey, requestHash, memo: `${itemId}x${qty}`, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount }] });
      // Prix proposé par défaut : le prix public, dans les bornes
      await tx.clothingShopItem.upsert({ where: { shopId_itemId: { shopId: s.id, itemId } }, create: { shopId: s.id, itemId, qty, price: Math.min(p.max, Math.max(p.min, g.price)) }, update: { qty: { increment: qty } } });
      return { replay: false, paid: amount.toString(), unit: p.wholesale };
    });
  }

  /** Le vendeur fixe son prix entre le prix de gros et le maximum autorisé (aucun mouvement d'argent). */
  setPrice(accountId: string, itemId: string, price: number) {
    return this.chars.act(accountId, async (tx, c) => {
      const rules = await this.settings.get('clothes.rules');
      const p = shopPrices((await this.item(itemId)).price, rules.wholesaleBp, rules.maxPriceBp);
      if (price < p.min || price > p.max) throw new BadRequestException('price_out_of_bounds');
      const s = await tx.clothingShop.findUnique({ where: { characterId: c.id } });
      if (!s) throw new NotFoundException('no_clothing_shop');
      const r = await tx.clothingShopItem.updateMany({ where: { shopId: s.id, itemId }, data: { price } });
      if (r.count !== 1) throw new NotFoundException('not_in_clothing_shop');
      return { itemId, price };
    });
  }

  /**
   * Fermer sa boutique : le fournisseur rachète le stock invendu (part du prix de gros) et une part du loyer payé d'avance
   * mais non consommé est remboursée. La boutique disparaît ; on pourra en rouvrir une plus tard.
   */
  closeShop(accountId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const rules = await this.settings.get('clothes.rules');
      const items = await this.settings.get('clothes.items');
      const day = await this.today();
      const s = await tx.clothingShop.findUnique({ where: { characterId: c.id }, include: { items: true } });
      if (!s) throw new NotFoundException('no_clothing_shop');
      const q = closeQuote(
        s.items.map((i) => ({ qty: i.qty, wholesale: shopPrices(items.find((g) => g.id === i.itemId)?.price ?? 0, rules.wholesaleBp, rules.maxPriceBp).wholesale })),
        Math.max(0, s.paidUntilDay - day),
        rules.weeklyRent,
        rules.closeBuybackBp,
        rules.closeRentRefundBp,
      );
      // Suppression d'abord : deux fermetures simultanées ne remboursent qu'une fois
      const gone = await tx.clothingShop.deleteMany({ where: { id: s.id } });
      if (gone.count !== 1) throw new NotFoundException('no_clothing_shop');
      if (q.buyback > 0n) await this.ledger.post(tx, { kind: 'CLOTHES_BUYBACK', idempotencyKey: `clothes-close:${s.id}:stock`, memo: s.venueId, legs: [{ from: await this.ledger.systemWalletId(tx, 'MARKET'), to: c.walletId, amount: q.buyback }] });
      if (q.refund > 0n) await this.ledger.post(tx, { kind: 'SHOP_RENT_REFUND', idempotencyKey: `clothes-close:${s.id}:rent`, memo: s.venueId, legs: [{ from: await this.ledger.systemWalletId(tx, 'TREASURY'), to: c.walletId, amount: q.refund }] });
      return { closed: true, buyback: q.buyback.toString(), refund: q.refund.toString() };
    });
  }

  /** Prendre une pièce de son stock pour sa propre garde-robe (sans remboursement). */
  take(accountId: string, itemId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const s = await tx.clothingShop.findUnique({ where: { characterId: c.id } });
      if (!s) throw new NotFoundException('no_clothing_shop');
      const r = await tx.clothingShopItem.updateMany({ where: { shopId: s.id, itemId, qty: { gte: 1 } }, data: { qty: { decrement: 1 } } });
      if (r.count !== 1) throw new BadRequestException('not_enough_stock');
      await this.give(tx, c.id, itemId);
      return { itemId };
    });
  }
}

@Controller('clothes')
export class ClothesController {
  constructor(private readonly svc: ClothesService) {}

  @Get()
  state(@CurrentUser() u: AuthUser) {
    return this.svc.state(u.accountId);
  }

  @HttpCode(200)
  @Post('buy')
  buy(@CurrentUser() u: AuthUser, @Body() dto: ItemDto, @Headers('idempotency-key') key?: string) {
    return this.svc.buy(u.accountId, dto.itemId, idem(key));
  }

  @HttpCode(200)
  @Post('buy-from')
  buyFrom(@CurrentUser() u: AuthUser, @Body() dto: BuyFromDto, @Headers('idempotency-key') key?: string) {
    return this.svc.buyFrom(u.accountId, dto.shopId, dto.itemId, idem(key));
  }

  @HttpCode(200)
  @Post('wear')
  wear(@CurrentUser() u: AuthUser, @Body() dto: WearDto) {
    return this.svc.wear(u.accountId, { top: dto.top, bottom: dto.bottom, dress: dto.dress, shoes: dto.shoes });
  }

  @HttpCode(200)
  @Post('shop/rent')
  rent(@CurrentUser() u: AuthUser, @Body() dto: RentDto, @Headers('idempotency-key') key?: string) {
    return this.svc.rent(u.accountId, dto.weeks, idem(key));
  }

  @HttpCode(200)
  @Post('shop/stock')
  stock(@CurrentUser() u: AuthUser, @Body() dto: StockDto, @Headers('idempotency-key') key?: string) {
    return this.svc.stock(u.accountId, dto.itemId, dto.qty, idem(key));
  }

  @HttpCode(200)
  @Post('shop/price')
  price(@CurrentUser() u: AuthUser, @Body() dto: PriceDto) {
    return this.svc.setPrice(u.accountId, dto.itemId, dto.price);
  }

  @HttpCode(200)
  @Post('shop/close')
  close(@CurrentUser() u: AuthUser) {
    return this.svc.closeShop(u.accountId);
  }

  @HttpCode(200)
  @Post('shop/take')
  take(@CurrentUser() u: AuthUser, @Body() dto: ItemDto) {
    return this.svc.take(u.accountId, dto.itemId);
  }
}

@Module({ controllers: [ClothesController], providers: [ClothesService, CharacterService] })
export class ClothesModule {}
