import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Injectable, Module, NotFoundException, Post } from '@nestjs/common';
import { IsInt, Matches, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService, type Tx } from '../ledger/ledger.service';
import { SettingsService, type SettingValue } from '../settings/settings.service';
import { CharacterService, HOME, needsOf } from '../character/character.service';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { gameHoursBetween, realMsAfterGameHours } from '../economy/clock';
import { applyEffects, withMealEnergy } from '../economy/needs';
import { freshLots, shelfDays, takeFromLots } from '../economy/kitchen';
import { sha256Hex } from '../common/crypto';

type KitchenCfg = SettingValue<'kitchen'>;

/** Les restes d'un plat sont rangés sous cet identifiant dans le garde-manger. */
const dishId = (foodId: string) => `dish_${foodId}`;

class BuyDto {
  @Matches(/^[a-z_]{2,24}$/)
  itemId: string;

  @IsInt()
  @Min(1)
  @Max(20)
  qty: number;
}
class IdDto {
  @Matches(/^[a-z_]{2,24}$/)
  id: string;
}
class RecipeDto {
  @Matches(/^[a-z_]{2,24}$/)
  recipeId: string;
}
class CookDto {
  @Matches(/^[a-z_]{2,24}$/)
  recipeId: string;

  @Matches(/^[a-z_]{2,24}$/)
  stoveId: string;
}
class FoodDto {
  @Matches(/^[a-z_]{2,32}$/)
  foodId: string;
}
class FreezeDto extends FoodDto {
  @IsInt()
  @Min(1)
  @Max(12)
  qty: number;
}

function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

/**
 * Cuisine à la maison : ingrédients et combustibles achetés au marché, appareils (réfrigérateur, réchauds), recettes, restes.
 * Le serveur décide de tout : le client n'envoie que des identifiants (ingrédient, recette, appareil), jamais un prix.
 */
@Injectable()
export class KitchenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
  ) {}

  /** Catalogue et état du joueur : appareils possédés, garde-manger (quantités bonnes, première péremption). */
  async state(accountId: string) {
    const cfg = await this.settings.get('kitchen');
    const me = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
    const now = new Date();
    const clock = await this.settings.clock();
    const [owned, lots] = me
      ? await Promise.all([
          this.prisma.kitchenAppliance.findMany({ where: { characterId: me.id }, select: { applianceId: true } }),
          this.prisma.pantryLot.findMany({ where: { characterId: me.id, qty: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
        ])
      : [[], []];
    const pantry = new Map<string, { itemId: string; qty: number; expiresAt: Date | null }>();
    for (const l of lots) {
      const p = pantry.get(l.itemId) ?? { itemId: l.itemId, qty: 0, expiresAt: null };
      p.qty += l.qty;
      if (l.expiresAt && (!p.expiresAt || l.expiresAt < p.expiresAt)) p.expiresAt = l.expiresAt;
      pantry.set(l.itemId, p);
    }
    return {
      items: cfg.items,
      appliances: cfg.appliances,
      recipes: cfg.recipes,
      rules: { fridgeShelfBp: cfg.fridgeShelfBp, leftoverDays: cfg.leftoverDays, leftoverFridgeDays: cfg.leftoverFridgeDays, homeMoraleBonus: cfg.homeMoraleBonus, electricFee: cfg.electricFee, maxLeftovers: cfg.maxLeftovers },
      owned: owned.map((o) => o.applianceId),
      // Première péremption en jours de jeu (null : ne se périme pas)
      pantry: [...pantry.values()].map((p) => ({ itemId: p.itemId, qty: p.qty, daysLeft: p.expiresAt ? Math.round((gameHoursBetween(clock, now.getTime(), p.expiresAt.getTime()) / 24) * 10) / 10 : null })),
    };
  }

  // ---------- garde-manger ----------

  /** Retire les lots périmés (jetés) avant toute action. */
  private async clean(tx: Tx, characterId: string): Promise<void> {
    await tx.pantryLot.deleteMany({ where: { characterId, expiresAt: { lte: new Date() } } });
  }

  /** Prélève `qty` unités d'un produit (lots qui périment le plus tôt d'abord) ; échoue avec `code` s'il en manque. */
  private async take(tx: Tx, characterId: string, itemId: string, qty: number, code: string): Promise<void> {
    const lots = await tx.pantryLot.findMany({ where: { characterId, itemId, qty: { gt: 0 } } });
    const plan = takeFromLots(lots, qty, Date.now());
    if (!plan) throw new BadRequestException(code);
    for (const p of plan) await tx.pantryLot.update({ where: { id: p.id }, data: { qty: { decrement: p.take } } });
    await tx.pantryLot.deleteMany({ where: { characterId, itemId, qty: { lte: 0 } } });
  }

  private async hasFridge(tx: Tx, characterId: string): Promise<boolean> {
    return (await tx.kitchenAppliance.count({ where: { characterId, applianceId: { in: (await this.settings.get('kitchen')).appliances.filter((a) => a.kind === 'FRIDGE').map((a) => a.id) } } })) > 0;
  }

  private async expiry(tx: Tx, characterId: string, days: number, cfg: KitchenCfg): Promise<Date | null> {
    const d = shelfDays(days, await this.hasFridge(tx, characterId), cfg.fridgeShelfBp);
    return d > 0 ? new Date(Math.ceil(realMsAfterGameHours(await this.settings.clock(), Date.now(), d * 24))) : null;
  }

  // ---------- achats ----------

  /** Acheter des ingrédients ou du combustible dans un lieu qui les vend. */
  buy(accountId: string, itemId: string, qty: number, key?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const cfg = await this.settings.get('kitchen');
      const item = cfg.items.find((i) => i.id === itemId);
      if (!item) throw new NotFoundException('unknown_item');
      if (!item.venues.includes(c.locationId)) throw new BadRequestException('not_at_shop');
      const idemKey = key ? `grocery:${c.id}:${key}` : undefined;
      const requestHash = sha256Hex(`grocery|${itemId}|${qty}`);
      if (idemKey && (await this.ledger.findReplay(tx, idemKey, requestHash))) return { itemId, qty, replay: true };
      await this.clean(tx, c.id);
      await this.ledger.post(tx, { kind: 'GROCERY', idempotencyKey: idemKey, requestHash, memo: `${itemId}x${qty}`, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(item.price) * BigInt(qty) }] });
      await tx.pantryLot.create({ data: { characterId: c.id, itemId, qty: item.pack * qty, expiresAt: await this.expiry(tx, c.id, item.shelfDays, cfg) } });
      return { itemId, qty: item.pack * qty, paid: String(BigInt(item.price) * BigInt(qty)), replay: false };
    });
  }

  /**
   * Acheter d'un coup ce qu'il manque pour une recette : pour chaque ingrédient, le nombre de lots nécessaires pour
   * atteindre la quantité demandée (compte tenu du garde-manger). Un seul prélèvement, tout ou rien ; livré chez soi,
   * sans déplacement (contrairement à l'achat à l'unité, qui se fait sur place).
   */
  buyRecipe(accountId: string, recipeId: string, key?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const cfg = await this.settings.get('kitchen');
      const recipe = cfg.recipes.find((r) => r.id === recipeId);
      if (!recipe) throw new NotFoundException('unknown_recipe');
      const idemKey = key ? `grocery:${c.id}:${key}` : undefined;
      const requestHash = sha256Hex(`grocery-recipe|${recipeId}`);
      if (idemKey && (await this.ledger.findReplay(tx, idemKey, requestHash))) return { recipeId, replay: true };
      await this.clean(tx, c.id);
      const lots = await tx.pantryLot.findMany({ where: { characterId: c.id, itemId: { in: recipe.items.map((i) => i.id) }, qty: { gt: 0 } } });
      const toBuy: { itemId: string; packs: number; units: number; price: bigint; shelfDays: number }[] = [];
      for (const need of recipe.items) {
        const item = cfg.items.find((i) => i.id === need.id);
        if (!item) throw new NotFoundException('unknown_item');
        const have = lots.filter((l) => l.itemId === need.id).reduce((n, l) => n + l.qty, 0);
        const missing = need.qty - have;
        if (missing <= 0) continue;
        const packs = Math.ceil(missing / item.pack);
        toBuy.push({ itemId: item.id, packs, units: packs * item.pack, price: BigInt(item.price) * BigInt(packs), shelfDays: item.shelfDays });
      }
      if (toBuy.length === 0) throw new BadRequestException('nothing_to_buy');
      const total = toBuy.reduce((n, b) => n + b.price, 0n);
      await this.ledger.post(tx, { kind: 'GROCERY', idempotencyKey: idemKey, requestHash, memo: `recipe:${recipeId}`, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: total }] });
      for (const b of toBuy) await tx.pantryLot.create({ data: { characterId: c.id, itemId: b.itemId, qty: b.units, expiresAt: await this.expiry(tx, c.id, b.shelfDays, cfg) } });
      return { recipeId, items: toBuy.map((b) => ({ itemId: b.itemId, qty: b.units })), paid: String(total), replay: false };
    });
  }

  /** Acheter un appareil (une seule fois chacun) dans un lieu qui le vend ; il est installé à la maison. */
  buyAppliance(accountId: string, id: string, key?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const cfg = await this.settings.get('kitchen');
      const ap = cfg.appliances.find((a) => a.id === id);
      if (!ap) throw new NotFoundException('unknown_appliance');
      if (!ap.venues.includes(c.locationId)) throw new BadRequestException('not_at_shop');
      if (await tx.kitchenAppliance.findUnique({ where: { characterId_applianceId: { characterId: c.id, applianceId: id } } })) throw new BadRequestException('already_owned');
      const idemKey = key ? `appliance:${c.id}:${key}` : undefined;
      const requestHash = sha256Hex(`appliance|${id}`);
      if (idemKey && (await this.ledger.findReplay(tx, idemKey, requestHash))) return { id, replay: true };
      await this.ledger.post(tx, { kind: 'APPLIANCE', idempotencyKey: idemKey, requestHash, memo: id, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(ap.price) }] });
      await tx.kitchenAppliance.create({ data: { characterId: c.id, applianceId: id } });
      return { id, paid: String(ap.price), replay: false };
    });
  }

  // ---------- cuisiner et manger ----------

  /**
   * Cuisiner : consomme les ingrédients et le combustible, le cuisinier mange une portion tout de suite (effets du plat,
   * bonus « fait maison », fatigue de la préparation) et le reste devient des portions de restes.
   */
  cook(accountId: string, recipeId: string, stoveId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      if (c.locationId !== HOME) throw new BadRequestException('not_at_home');
      const cfg = await this.settings.get('kitchen');
      const recipe = cfg.recipes.find((r) => r.id === recipeId);
      if (!recipe) throw new NotFoundException('unknown_recipe');
      const stove = cfg.appliances.find((a) => a.id === stoveId && a.kind === 'STOVE');
      if (!stove) throw new NotFoundException('unknown_appliance');
      if (!(await tx.kitchenAppliance.findUnique({ where: { characterId_applianceId: { characterId: c.id, applianceId: stove.id } } }))) throw new BadRequestException('no_appliance');
      const food = await tx.foodItem.findUnique({ where: { id: recipe.foodId } });
      if (!food || !food.enabled) throw new NotFoundException('unknown_food');
      await this.clean(tx, c.id);
      // Place pour les restes
      const leftovers = recipe.portions - 1;
      if (leftovers > 0) {
        const kept = (await tx.pantryLot.aggregate({ where: { characterId: c.id, itemId: { startsWith: 'dish_' } }, _sum: { qty: true } }))._sum.qty ?? 0;
        if (kept + leftovers > cfg.maxLeftovers) throw new BadRequestException('leftovers_full');
      }
      for (const it of recipe.items) await this.take(tx, c.id, it.id, it.qty, 'missing_ingredient');
      // Eau de cuisine (cuisson, vaisselle) : au compteur, payée avec la facture d'eau du mois
      const cookLitres = (await this.settings.get('bills.water')).cookLitres;
      if (cookLitres > 0) await tx.character.update({ where: { id: c.id }, data: { waterLitresUsed: { increment: cookLitres } } });
      if (stove.fuel === 'ELECTRIC') {
        // Réchaud électrique : la cuisson passe au compteur, payée avec la facture d'électricité du mois
        const kwh = (await this.settings.get('bills.power')).cookKwh;
        if (kwh > 0) await tx.character.update({ where: { id: c.id }, data: { elecKwhUsed: { increment: kwh } } });
      } else if (stove.fuelItem) {
        await this.take(tx, c.id, stove.fuelItem, 1, 'no_fuel');
      }
      const n0 = withMealEnergy(applyEffects(needsOf(c), { hunger: food.hunger, energy: food.energy, morale: food.morale + cfg.homeMoraleBonus, health: food.health }), food.hunger, await this.settings.get('food.meal'));
      await tx.character.update({ where: { id: c.id }, data: applyEffects(n0, { energy: -recipe.effort }) });
      if (leftovers > 0) await tx.pantryLot.create({ data: { characterId: c.id, itemId: dishId(food.id), qty: leftovers, expiresAt: await this.expiry(tx, c.id, (await this.hasFridge(tx, c.id)) ? cfg.leftoverFridgeDays : cfg.leftoverDays, { ...cfg, fridgeShelfBp: 10_000 }) } });
      return { food: food.id, portions: recipe.portions, leftovers };
    });
  }

  /** Manger une portion de restes. */
  eatDish(accountId: string, foodId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      if (c.locationId !== HOME) throw new BadRequestException('not_at_home');
      const cfg = await this.settings.get('kitchen');
      const food = await tx.foodItem.findUnique({ where: { id: foodId } });
      if (!food) throw new NotFoundException('unknown_food');
      await this.clean(tx, c.id);
      await this.take(tx, c.id, dishId(foodId), 1, 'no_dish');
      const n = withMealEnergy(applyEffects(needsOf(c), { hunger: food.hunger, energy: food.energy, morale: food.morale + cfg.homeMoraleBonus, health: food.health }), food.hunger, await this.settings.get('food.meal'));
      await tx.character.update({ where: { id: c.id }, data: n });
      return { food: food.id };
    });
  }

  /** Mettre des restes au congélateur : ils ne se périment plus. */
  freezeDish(accountId: string, foodId: string, qty: number) {
    return this.chars.act(accountId, async (tx, c) => {
      if (c.locationId !== HOME) throw new BadRequestException('not_at_home');
      if (!c.hasFreezer) throw new BadRequestException('no_freezer');
      const fz = await this.settings.get('freezer');
      await this.clean(tx, c.id);
      const used = (await tx.freezerItem.aggregate({ where: { characterId: c.id }, _sum: { qty: true } }))._sum.qty ?? 0;
      if (used + qty > fz.capacity) throw new BadRequestException('freezer_full');
      await this.take(tx, c.id, dishId(foodId), qty, 'no_dish');
      await tx.freezerItem.upsert({ where: { characterId_foodId: { characterId: c.id, foodId } }, create: { characterId: c.id, foodId, qty }, update: { qty: { increment: qty } } });
      return { food: foodId, qty };
    });
  }
}

@Controller('kitchen')
export class KitchenController {
  constructor(private readonly svc: KitchenService) {}

  @Get()
  state(@CurrentUser() u: AuthUser) {
    return this.svc.state(u.accountId);
  }

  @HttpCode(200)
  @Post('buy')
  buy(@CurrentUser() u: AuthUser, @Body() dto: BuyDto, @Headers('idempotency-key') key?: string) {
    return this.svc.buy(u.accountId, dto.itemId, dto.qty, idem(key));
  }

  @HttpCode(200)
  @Post('buy-recipe')
  buyRecipe(@CurrentUser() u: AuthUser, @Body() dto: RecipeDto, @Headers('idempotency-key') key?: string) {
    return this.svc.buyRecipe(u.accountId, dto.recipeId, idem(key));
  }

  @HttpCode(200)
  @Post('buy-appliance')
  buyAppliance(@CurrentUser() u: AuthUser, @Body() dto: IdDto, @Headers('idempotency-key') key?: string) {
    return this.svc.buyAppliance(u.accountId, dto.id, idem(key));
  }

  @HttpCode(200)
  @Post('cook')
  cook(@CurrentUser() u: AuthUser, @Body() dto: CookDto) {
    return this.svc.cook(u.accountId, dto.recipeId, dto.stoveId);
  }

  @HttpCode(200)
  @Post('eat-dish')
  eatDish(@CurrentUser() u: AuthUser, @Body() dto: FoodDto) {
    return this.svc.eatDish(u.accountId, dto.foodId);
  }

  @HttpCode(200)
  @Post('freeze-dish')
  freezeDish(@CurrentUser() u: AuthUser, @Body() dto: FreezeDto) {
    return this.svc.freezeDish(u.accountId, dto.foodId, dto.qty);
  }
}

@Module({ controllers: [KitchenController], providers: [KitchenService, CharacterService] })
export class KitchenModule {}
