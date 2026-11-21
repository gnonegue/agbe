import { BadRequestException, Body, ConflictException, Controller, Get, Headers, HttpCode, Injectable, Logger, Module, NotFoundException, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { randomInt } from 'node:crypto';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { gameHoursBetween, gameTimeAt } from '../economy/clock';
import { accrued, savingsInterest, STOCK_RANGES, stockHistory, stockPrice, stockSeries, type StockRange } from '../economy/invest';
import { tax } from '../economy/trade';
import { sha256Hex } from '../common/crypto';

class StockDto {
  @IsString()
  @Matches(/^[A-Z]{2,8}$/)
  symbol: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  qty: number;
}
class HistoryQuery {
  @IsString()
  @Matches(/^[A-Z]{2,8}$/)
  symbol: string;

  @IsOptional()
  @IsIn(Object.keys(STOCK_RANGES))
  range?: StockRange;
}
class AmountDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000_000_000)
  amount: number;
}
class VentureDto {
  @IsString()
  @Matches(/^[a-z0-9_]{2,32}$/)
  id: string;
}

function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

/**
 * Investissements du jeu : bourse simulée (sociétés fictives), saisons agricoles et secondes activités.
 * Cours et résultats décidés par le serveur ; tout mouvement passe par le grand livre.
 */
@Injectable()
export class InvestService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  onModuleInit(): void {
    this.timer = setInterval(() => void this.collectAllDue(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Récoltes et revenus des activités : versés automatiquement dès qu'il y a quelque chose à encaisser. */
  async collectAllDue(): Promise<number> {
    let n = 0;
    try {
      const rows = await this.prisma.venture.findMany({ where: { closedAt: null } });
      for (const v of rows) {
        const el = await this.elapsedDays(v.startedAt);
        const due = v.kind === 'FARM' ? (el >= v.totalDays ? v.payout : 0n) : accrued(v.payout, v.totalDays, el, v.activeDays);
        if (due <= v.collected && el < Math.min(v.totalDays, v.activeDays)) continue;
        const ch = await this.prisma.character.findUnique({ where: { id: v.characterId }, select: { accountId: true } });
        if (!ch) continue;
        try {
          await this.collect(ch.accountId, v.id);
          n++;
        } catch (e) {
          new Logger('Invest').warn(`Placement ${v.id} non encaissé : ${(e as Error).message}`);
        }
      }
    } catch (e) {
      new Logger('Invest').warn(`Encaissement automatique : ${(e as Error).message}`);
    }
    return n;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
  ) {}

  private async day() {
    return gameTimeAt(await this.settings.clock(), Date.now()).day;
  }

  /** Temps de jeu en jours, arrondi à l'heure de jeu : le cours des actions change à chaque heure de jeu. */
  private async marketTime() {
    const g = gameTimeAt(await this.settings.clock(), Date.now());
    return Math.floor(g.totalMinutes / 60) / 24;
  }

  private async elapsedDays(startedAt: Date) {
    return gameHoursBetween(await this.settings.clock(), startedAt.getTime(), Date.now()) / 24;
  }

  /** État d'un placement vu par le joueur (le résultat d'une récolte reste caché jusqu'au bout). */
  private async ventureView(v: { id: string; optionId: string; kind: string; invested: bigint; payout: bigint; totalDays: number; activeDays: number; collected: bigint; startedAt: Date; closedAt: Date | null }) {
    const el = await this.elapsedDays(v.startedAt);
    const done = el >= v.totalDays;
    const failed = v.activeDays < v.totalDays && el >= v.activeDays;
    const available = v.kind === 'FARM' ? (done ? v.payout - v.collected : 0n) : accrued(v.payout, v.totalDays, el, v.activeDays) - v.collected;
    return {
      id: v.id,
      optionId: v.optionId,
      kind: v.kind,
      invested: v.invested.toString(),
      collected: v.collected.toString(),
      available: (available > 0n ? available : 0n).toString(),
      progress: Math.min(1, el / v.totalDays),
      daysLeft: Math.max(0, Math.ceil(v.totalDays - el)),
      done,
      failed: v.kind === 'BUSINESS' ? failed : done && v.payout < v.invested,
      result: v.kind === 'FARM' && done ? v.payout.toString() : null,
      closed: !!v.closedAt,
    };
  }

  async view(accountId: string) {
    const ch = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
    if (!ch) throw new NotFoundException('no_character');
    const cfg = await this.settings.get('invest');
    const t = await this.marketTime();
    const day = Math.floor(t);
    const held = await this.prisma.stockHolding.findMany({ where: { characterId: ch.id } });
    const ventures = await this.prisma.venture.findMany({ where: { characterId: ch.id }, orderBy: { startedAt: 'desc' }, take: 20 });
    return {
      day,
      feeBp: cfg.feeBp,
      stocks: cfg.stocks.map((s) => {
        const price = stockPrice(s.symbol, s.base, s.driftBp, s.volBp, t);
        // 13 clôtures précédentes puis le cours de l'heure
        const series = [...(day > 0 ? stockSeries(s.symbol, s.base, s.driftBp, s.volBp, day - 1, 13) : []), price];
        const h = held.find((x) => x.symbol === s.symbol);
        const prev = stockPrice(s.symbol, s.base, s.driftBp, s.volBp, Math.max(0, t - 1));
        return { symbol: s.symbol, nameFr: s.nameFr, nameEn: s.nameEn, sectorFr: s.sectorFr, sectorEn: s.sectorEn, volBp: s.volBp, price, changeBp: Math.round(((price - prev) * 10_000) / prev), series, held: h?.qty ?? 0, heldCost: (h?.cost ?? 0n).toString() };
      }),
      options: cfg.options.map(({ minReturnBp: _a, maxReturnBp: _b, failBp, ...o }) => ({ ...o, riskBp: failBp })),
      ventures: await Promise.all(ventures.map((v) => this.ventureView(v))),
    };
  }

  /** Historique d'une action sur une période, avec les repères qui aident à juger le cours actuel. */
  async history(symbol: string, range: StockRange = '30d') {
    const cfg = await this.settings.get('invest');
    const s = cfg.stocks.find((x) => x.symbol === symbol);
    if (!s) throw new NotFoundException('unknown_stock');
    const t = await this.marketTime();
    const points = stockHistory(s.symbol, s.base, s.driftBp, s.volBp, t, range);
    const prices = points.map((x) => x.p);
    const first = prices[0]!;
    const last = prices[prices.length - 1]!;
    return {
      symbol,
      range,
      now: t,
      points,
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      changeBp: Math.round(((last - first) * 10_000) / first),
    };
  }

  buyStock(accountId: string, symbol: string, qty: number, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `stock:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`stock-buy|${symbol}|${qty}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { symbol, qty: 0, paid: '0', replay: true };
      const cfg = await this.settings.get('invest');
      const s = cfg.stocks.find((x) => x.symbol === symbol);
      if (!s) throw new NotFoundException('unknown_stock');
      const h = await tx.stockHolding.findUnique({ where: { characterId_symbol: { characterId: c.id, symbol } } });
      if ((h?.qty ?? 0) + qty > cfg.maxSharesPerStock) throw new BadRequestException('stock_limit');
      const amount = BigInt(stockPrice(s.symbol, s.base, s.driftBp, s.volBp, await this.marketTime())) * BigInt(qty);
      const fee = tax(amount, cfg.feeBp);
      await this.ledger.post(tx, {
        kind: 'STOCK_BUY',
        idempotencyKey: key,
        requestHash,
        memo: `${symbol}x${qty}`,
        legs: [
          { from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount },
          ...(fee > 0n ? [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'FEES'), amount: fee }] : []),
        ],
      });
      await tx.stockHolding.upsert({
        where: { characterId_symbol: { characterId: c.id, symbol } },
        create: { characterId: c.id, symbol, qty, cost: amount + fee },
        update: { qty: { increment: qty }, cost: { increment: amount + fee } },
      });
      return { symbol, qty, paid: (amount + fee).toString(), fee: fee.toString(), replay: false };
    });
  }

  sellStock(accountId: string, symbol: string, qty: number, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `stock:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`stock-sell|${symbol}|${qty}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { symbol, qty: 0, received: '0', replay: true };
      const cfg = await this.settings.get('invest');
      const s = cfg.stocks.find((x) => x.symbol === symbol);
      if (!s) throw new NotFoundException('unknown_stock');
      const h = await tx.stockHolding.findUnique({ where: { characterId_symbol: { characterId: c.id, symbol } } });
      if (!h || h.qty < qty) throw new BadRequestException('not_enough_shares');
      const gross = BigInt(stockPrice(s.symbol, s.base, s.driftBp, s.volBp, await this.marketTime())) * BigInt(qty);
      const fee = tax(gross, cfg.feeBp);
      await this.ledger.post(tx, {
        kind: 'STOCK_SELL',
        idempotencyKey: key,
        requestHash,
        memo: `${symbol}x${qty}`,
        legs: [
          { from: await this.ledger.systemWalletId(tx, 'MARKET'), to: c.walletId, amount: gross },
          ...(fee > 0n ? [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'FEES'), amount: fee }] : []),
        ],
      });
      const costOut = (h.cost * BigInt(qty)) / BigInt(h.qty);
      if (h.qty === qty) await tx.stockHolding.delete({ where: { characterId_symbol: { characterId: c.id, symbol } } });
      else await tx.stockHolding.update({ where: { characterId_symbol: { characterId: c.id, symbol } }, data: { qty: { decrement: qty }, cost: { decrement: costOut } } });
      const received = gross - fee;
      return { symbol, qty, received: received.toString(), profit: (received - costOut).toString(), replay: false };
    });
  }

  /** Verse les intérêts dus depuis le dernier versement (Trésor → banque), dans la transaction en cours. */
  private async accrue(tx: Parameters<Parameters<CharacterService['act']>[1]>[0], characterId: string) {
    const day = await this.day();
    const cfg = await this.settings.get('savings');
    await tx.$executeRaw`SELECT 1 FROM "savings_account" WHERE "characterId" = ${characterId}::uuid FOR UPDATE`;
    let acc = await tx.savingsAccount.findUnique({ where: { characterId } });
    if (!acc) acc = await tx.savingsAccount.create({ data: { characterId, lastAccruedDay: day } });
    const interest = savingsInterest(acc.balance, cfg.dailyBp, day - acc.lastAccruedDay);
    if (interest > 0n) {
      await this.ledger.post(tx, {
        kind: 'SAVINGS_INTEREST',
        idempotencyKey: `savings:${characterId}:${day}`,
        memo: `${day - acc.lastAccruedDay}d`,
        legs: [{ from: await this.ledger.systemWalletId(tx, 'TREASURY'), to: await this.ledger.systemWalletId(tx, 'BANK'), amount: interest }],
      });
    }
    if (day !== acc.lastAccruedDay) acc = await tx.savingsAccount.update({ where: { characterId }, data: { balance: { increment: interest }, lastAccruedDay: day } });
    return { acc, cfg, interest };
  }

  /** Compte épargne : solde à jour des intérêts. */
  savings(accountId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const { acc, cfg, interest } = await this.accrue(tx, c.id);
      return { balance: acc.balance.toString(), dailyBp: cfg.dailyBp, maxBalance: cfg.maxBalance, interest: interest.toString() };
    });
  }

  deposit(accountId: string, amount: number, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `savings:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`deposit|${amount}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { amount: 0, replay: true };
      const { acc, cfg } = await this.accrue(tx, c.id);
      if (acc.balance + BigInt(amount) > BigInt(cfg.maxBalance)) throw new BadRequestException('savings_limit');
      await this.ledger.post(tx, { kind: 'SAVINGS_DEPOSIT', idempotencyKey: key, requestHash, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'BANK'), amount: BigInt(amount) }] });
      await tx.savingsAccount.update({ where: { characterId: c.id }, data: { balance: { increment: BigInt(amount) } } });
      return { amount, replay: false };
    });
  }

  withdraw(accountId: string, amount: number, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `savings:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`withdraw|${amount}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { amount: 0, replay: true };
      const { acc } = await this.accrue(tx, c.id);
      if (acc.balance < BigInt(amount)) throw new BadRequestException('savings_insufficient');
      await this.ledger.post(tx, { kind: 'SAVINGS_WITHDRAW', idempotencyKey: key, requestHash, legs: [{ from: await this.ledger.systemWalletId(tx, 'BANK'), to: c.walletId, amount: BigInt(amount) }] });
      await tx.savingsAccount.update({ where: { characterId: c.id }, data: { balance: { decrement: BigInt(amount) } } });
      return { amount, replay: false };
    });
  }

  /** Lancer un placement : le serveur tire le résultat (rendement, échec éventuel) au lancement. */
  startVenture(accountId: string, optionId: string, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `venture:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`venture|${optionId}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { option: optionId, replay: true };
      const cfg = await this.settings.get('invest');
      const o = cfg.options.find((x) => x.id === optionId);
      if (!o) throw new NotFoundException('unknown_option');
      if ((await tx.venture.count({ where: { characterId: c.id, closedAt: null } })) >= cfg.maxOpenVentures) throw new BadRequestException('too_many_ventures');
      const invested = BigInt(o.cost);
      const failed = randomInt(10_000) < o.failBp;
      const lo = Math.min(o.minReturnBp, o.maxReturnBp);
      const ret = lo + randomInt(Math.abs(o.maxReturnBp - o.minReturnBp) + 1);
      let payout = (invested * BigInt(10_000 + ret)) / 10_000n;
      let activeDays = o.gameDays;
      if (failed) {
        // Récolte ratée : on sauve jusqu'à 40 % ; activité : elle s'arrête en cours de route
        if (o.kind === 'FARM') payout = (invested * BigInt(randomInt(4_001))) / 10_000n;
        else activeDays = 1 + randomInt(Math.max(1, o.gameDays - 1));
      }
      await this.ledger.post(tx, {
        kind: 'INVEST',
        idempotencyKey: key,
        requestHash,
        memo: o.id,
        legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: invested }],
      });
      const v = await tx.venture.create({ data: { characterId: c.id, optionId: o.id, kind: o.kind, invested, payout, totalDays: o.gameDays, activeDays } });
      return { option: o.id, venture: v.id, invested: invested.toString(), replay: false };
    });
  }

  /** Encaisser : récolte à la fin de la saison, ou revenu accumulé d'une activité. */
  collect(accountId: string, id: string) {
    return this.chars.act(accountId, async (tx, c) => {
      // Verrou de la ligne : deux encaissements simultanés ne paient pas deux fois
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "venture" WHERE "id" = ${id}::uuid AND "characterId" = ${c.id}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundException('unknown_venture');
      const v = await tx.venture.findUniqueOrThrow({ where: { id } });
      if (v.closedAt) throw new ConflictException('venture_closed');
      const el = await this.elapsedDays(v.startedAt);
      const due = v.kind === 'FARM' ? (el >= v.totalDays ? v.payout : 0n) : accrued(v.payout, v.totalDays, el, v.activeDays);
      const amount = due - v.collected;
      if (v.kind === 'FARM' && el < v.totalDays) throw new BadRequestException('harvest_not_ready');
      if (amount > 0n) {
        await this.ledger.post(tx, {
          kind: 'INVEST_PAYOUT',
          idempotencyKey: `venture:${v.id}:${due.toString()}`,
          memo: v.optionId,
          legs: [{ from: await this.ledger.systemWalletId(tx, 'MARKET'), to: c.walletId, amount }],
        });
      }
      const finished = el >= Math.min(v.totalDays, v.activeDays);
      await tx.venture.update({ where: { id: v.id }, data: { collected: due > v.collected ? due : v.collected, ...(finished ? { closedAt: new Date() } : {}) } });
      return { venture: v.id, received: (amount > 0n ? amount : 0n).toString(), closed: finished };
    });
  }
}

@Controller('invest')
export class InvestController {
  constructor(private readonly svc: InvestService) {}

  @Get()
  view(@CurrentUser() u: AuthUser) {
    return this.svc.view(u.accountId);
  }

  /** Sigle en paramètre de requête : les chemins en majuscules sont refusés (routage sensible à la casse, main.ts). */
  @Get('stocks/history')
  history(@Query() q: HistoryQuery) {
    return this.svc.history(q.symbol, q.range);
  }

  @HttpCode(200)
  @Post('stocks/buy')
  buy(@CurrentUser() u: AuthUser, @Body() dto: StockDto, @Headers('idempotency-key') key?: string) {
    return this.svc.buyStock(u.accountId, dto.symbol, dto.qty, idem(key));
  }

  @HttpCode(200)
  @Post('stocks/sell')
  sell(@CurrentUser() u: AuthUser, @Body() dto: StockDto, @Headers('idempotency-key') key?: string) {
    return this.svc.sellStock(u.accountId, dto.symbol, dto.qty, idem(key));
  }

  @HttpCode(200)
  @Post('savings')
  savings(@CurrentUser() u: AuthUser) {
    return this.svc.savings(u.accountId);
  }

  @HttpCode(200)
  @Post('savings/deposit')
  deposit(@CurrentUser() u: AuthUser, @Body() dto: AmountDto, @Headers('idempotency-key') key?: string) {
    return this.svc.deposit(u.accountId, dto.amount, idem(key));
  }

  @HttpCode(200)
  @Post('savings/withdraw')
  withdraw(@CurrentUser() u: AuthUser, @Body() dto: AmountDto, @Headers('idempotency-key') key?: string) {
    return this.svc.withdraw(u.accountId, dto.amount, idem(key));
  }

  @HttpCode(200)
  @Post('ventures')
  start(@CurrentUser() u: AuthUser, @Body() dto: VentureDto, @Headers('idempotency-key') key?: string) {
    return this.svc.startVenture(u.accountId, dto.id, idem(key));
  }

  @HttpCode(200)
  @Post('ventures/:id/collect')
  collect(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.svc.collect(u.accountId, id);
  }
}

@Module({ controllers: [InvestController], providers: [InvestService, CharacterService] })
export class InvestModule {}
