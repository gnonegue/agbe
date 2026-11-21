import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Injectable, Module, NotFoundException, Optional, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { gameTimeAt } from '../economy/clock';
import { applyEffects } from '../economy/needs';
import { dailySellLimit, dayPrice, remoteBuyPrice, remoteSellPrice, sellQuote, tax } from '../economy/trade';
import { AuditService } from '../common/audit.service';
import { sha256Hex } from '../common/crypto';

class TradeDto {
  @IsString()
  @Matches(/^[a-z0-9_]{2,32}$/)
  id: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  qty: number;

  /** Depuis le téléphone, sans être sur place : achat au prix du jour, revente au cours de rachat. */
  @IsOptional()
  @IsBoolean()
  remote?: boolean;
}

function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

/**
 * Commerce au port : acheter une marchandise là où elle arrive, la revendre là où elle se vend.
 * Prix du jour, droits de douane (import) et taxe à l'export décidés par le serveur ; tout passe par le grand livre.
 */
@Injectable()
export class TradeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private async market() {
    const cfg = await this.settings.get('port.goods');
    const day = gameTimeAt(await this.settings.clock(), Date.now()).day;
    const raw = (g: (typeof cfg.goods)[number], side: 'buy' | 'sell') => dayPrice(side === 'buy' ? g.buyPrice : g.sellPrice, g.id, side, day, cfg.swingBp);
    // Le prix de revente est plafonné par rapport au coût de revient du jour (voir sellQuote)
    const price = (g: (typeof cfg.goods)[number], side: 'buy' | 'sell') => (side === 'buy' ? raw(g, 'buy') : sellQuote(raw(g, 'buy'), raw(g, 'sell'), g.kind, g.taxBp, cfg.maxMarginBp));
    // Prix d'un achat à distance : jamais inférieur à la revente sur place, plus l'écart de commodité
    const remoteBuy = (g: (typeof cfg.goods)[number]) => remoteBuyPrice(price(g, 'buy'), cfg.remoteSpreadBp);
    return { cfg, day, price, remoteBuy };
  }

  /** Quantité déjà vendue aujourd'hui (jour de jeu en cours) par ce joueur pour cette marchandise : lue dans le grand livre. */
  private async soldToday(db: Pick<PrismaService, 'ledgerTransaction'>, walletId: string, goodId: string): Promise<number> {
    const clock = await this.settings.clock();
    const day = gameTimeAt(clock, Date.now()).day;
    const since = new Date(clock.epochRealMs + day * clock.secondsPerGameDay * 1000);
    const rows = await db.ledgerTransaction.findMany({
      where: { kind: 'TRADE_SELL', memo: { startsWith: `${goodId}x` }, createdAt: { gte: since }, entries: { some: { walletId, amount: { gt: 0 } } } },
      select: { memo: true },
    });
    return rows.reduce((s, r) => s + (Number((r.memo ?? '').slice(goodId.length + 1).split(' ')[0]) || 0), 0);
  }

  /** Marchandises avec les prix du jour et le stock du joueur. */
  async list(accountId: string) {
    const ch = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
    if (!ch) throw new NotFoundException('no_character');
    const { cfg, day, price, remoteBuy } = await this.market();
    const held = await this.prisma.holding.findMany({ where: { characterId: ch.id } });
    const wallet = await this.prisma.wallet.findFirst({ where: { character: { id: ch.id } }, select: { id: true } });
    return {
      day,
      goods: await Promise.all(cfg.goods.map(async (g) => {
        const h = held.find((x) => x.goodId === g.id);
        const buyToday = price(g, 'buy');
        // Les voitures restent à acheter sur place ; les marchandises s'échangent aussi à distance
        const remote = g.kind !== 'CAR';
        const soldToday = wallet ? await this.soldToday(this.prisma, wallet.id, g.id) : 0;
        return { ...g, buyToday, sellToday: price(g, 'sell'), remote, remoteBuy: remote ? remoteBuy(g) : 0, remoteSell: remote ? remoteSellPrice(buyToday, cfg.remoteSpreadBp) : 0, soldToday, dailyMax: dailySellLimit(g.id, day, cfg.dailyMinSell, cfg.dailyMaxSell), held: h?.qty ?? 0, heldCost: (h?.cost ?? 0n).toString() };
      })),
    };
  }

  buy(accountId: string, goodId: string, qty: number, idemKey?: string, remote = false) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `trade:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`trade-buy|${goodId}|${qty}|${remote ? 'remote' : 'here'}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { good: goodId, qty: 0, paid: '0', replay: true };
      const { cfg, price, remoteBuy } = await this.market();
      const g = cfg.goods.find((x) => x.id === goodId);
      if (!g) throw new NotFoundException('unknown_good');
      if (remote) {
        if (g.kind === 'CAR') throw new BadRequestException('remote_not_allowed');
      } else {
        if (c.locationId !== g.buyAt) throw new BadRequestException(`buy_at_${g.buyAt}`);
        await this.chars.assertOpen(g.buyAt);
      }
      const h = await tx.holding.findUnique({ where: { characterId_goodId: { characterId: c.id, goodId } } });
      if ((h?.qty ?? 0) + qty > g.maxQty) throw new BadRequestException('stock_limit');
      const goods = BigInt(remote ? remoteBuy(g) : price(g, 'buy')) * BigInt(qty);
      // Droits de douane payés à l'achat d'une marchandise importée (commerce local et export : pas de douane)
      const duty = g.kind === 'IMPORT' || g.kind === 'CAR' ? tax(goods, g.taxBp) : 0n;
      const legs = [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: goods }];
      if (duty > 0n) legs.push({ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'TREASURY'), amount: duty });
      await this.ledger.post(tx, { kind: 'TRADE_BUY', idempotencyKey: key, requestHash, memo: `${g.id}x${qty}${remote ? ' remote' : ''}`, legs });
      await tx.holding.upsert({
        where: { characterId_goodId: { characterId: c.id, goodId } },
        create: { characterId: c.id, goodId, qty, cost: goods + duty },
        update: { qty: { increment: qty }, cost: { increment: goods + duty } },
      });
      if (g.respect > 0) {
        const n = applyEffects({ hunger: c.hunger, energy: c.energy, hygiene: c.hygiene, health: c.health, morale: c.morale, respect: c.respect }, { respect: g.respect, morale: 5 });
        await tx.character.update({ where: { id: c.id }, data: n });
      }
      return { good: g.id, qty, paid: (goods + duty).toString(), duty: duty.toString(), replay: false };
    });
  }

  sell(accountId: string, goodId: string, qty: number, idemKey?: string, remote = false) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `trade:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`trade-sell|${goodId}|${qty}|${remote ? 'remote' : 'here'}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { good: goodId, qty: 0, received: '0', replay: true };
      const { cfg, day, price } = await this.market();
      const g = cfg.goods.find((x) => x.id === goodId);
      if (!g) throw new NotFoundException('unknown_good');
      if (remote) {
        if (g.kind === 'CAR') throw new BadRequestException('remote_not_allowed');
      } else {
        if (c.locationId !== g.sellAt) throw new BadRequestException(`sell_at_${g.sellAt}`);
        await this.chars.assertOpen(g.sellAt);
      }
      const h = await tx.holding.findUnique({ where: { characterId_goodId: { characterId: c.id, goodId } } });
      if (!h || h.qty < qty) throw new BadRequestException('not_enough_stock');
      // Profondeur du marché : au-delà de la quantité écoulable par jour de jeu, les acheteurs sont servis (revenir demain)
      if ((await this.soldToday(tx, c.walletId, g.id)) + qty > dailySellLimit(g.id, day, cfg.dailyMinSell, cfg.dailyMaxSell)) throw new BadRequestException('market_saturated');
      // À distance : cours de rachat (sous le prix d'achat du jour), sans export donc sans taxe à l'export
      const unit = remote ? remoteSellPrice(price(g, 'buy'), cfg.remoteSpreadBp) : price(g, 'sell');
      const gross = BigInt(unit) * BigInt(qty);
      // Taxe à l'export retenue à la vente au port
      const exportTax = g.kind === 'EXPORT' && !remote ? tax(gross, g.taxBp) : 0n;
      const legs = [{ from: await this.ledger.systemWalletId(tx, 'MARKET'), to: c.walletId, amount: gross }];
      if (exportTax > 0n) legs.push({ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'TREASURY'), amount: exportTax });
      await this.ledger.post(tx, { kind: 'TRADE_SELL', idempotencyKey: key, requestHash, memo: `${g.id}x${qty}${remote ? ' remote' : ''}`, legs });
      // Le prix de revient restant est réduit au prorata des unités vendues
      const costOut = (h.cost * BigInt(qty)) / BigInt(h.qty);
      if (h.qty === qty) await tx.holding.delete({ where: { characterId_goodId: { characterId: c.id, goodId } } });
      else await tx.holding.update({ where: { characterId_goodId: { characterId: c.id, goodId } }, data: { qty: { decrement: qty }, cost: { decrement: costOut } } });
      const received = gross - exportTax;
      // Surveillance : un gros bénéfice sur une seule vente laisse une trace dans le journal d'audit
      if (received - costOut >= BigInt(cfg.alertProfit)) await this.audit?.log('trade.big_profit', { actorId: accountId, target: g.id, meta: { qty, profit: (received - costOut).toString(), remote } }, tx);
      return { good: g.id, qty, received: received.toString(), tax: exportTax.toString(), profit: (received - costOut).toString(), replay: false };
    });
  }
}

// Cadence limitée : le commerce ne se joue pas à la mitraillette (scripts)
@Throttle({ default: { limit: 40, ttl: 60_000 } })
@Controller('trade')
export class TradeController {
  constructor(private readonly svc: TradeService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.accountId);
  }

  @HttpCode(200)
  @Post('buy')
  buy(@CurrentUser() u: AuthUser, @Body() dto: TradeDto, @Headers('idempotency-key') key?: string) {
    return this.svc.buy(u.accountId, dto.id, dto.qty, idem(key), dto.remote === true);
  }

  @HttpCode(200)
  @Post('sell')
  sell(@CurrentUser() u: AuthUser, @Body() dto: TradeDto, @Headers('idempotency-key') key?: string) {
    return this.svc.sell(u.accountId, dto.id, dto.qty, idem(key), dto.remote === true);
  }
}

@Module({ controllers: [TradeController], providers: [TradeService, CharacterService] })
export class TradeModule {}
