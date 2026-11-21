import {
  BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Injectable, Logger, Module, NotFoundException, OnModuleDestroy, OnModuleInit, Optional, Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsInt, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { ENV, Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { renderLoanClosedMail, renderLoanCollectedMail, renderLoanGrantedMail, renderLoanLateMail } from '../mail/mail.templates';
import { LiveModule } from '../live/live.module';
import { LiveService } from '../live/live.service';
import { gameTimeAt } from '../economy/clock';
import { loanAmountWithPenalty, loanDueNow, loanInstallment, loanRemainingAfterRepay, loanTotalDue } from '../economy/loans';
import { sha256Hex } from '../common/crypto';

/** Rythme du traitement périodique : prélèvement automatique des échéances dues. */
const TICK_MS = 30_000;

function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

/**
 * Prêt bancaire personnel : l'emprunteur est le personnage (pas son entreprise), un seul prêt actif
 * (OPEN/LATE) à la fois, plafond fixe réglé dans `game_setting` (`bank.loans`). Octroi immédiat (BANK → joueur),
 * mensualités fixes prélevées automatiquement à échéance (joueur → BANK) ; en cas de solde insuffisant, retard
 * + pénalité bornée, rattrapage automatique au prochain passage. Remboursement anticipé libre à tout moment.
 * Traitement périodique en mémoire (comme `tenders.module.ts` / `live.service.ts`), pas de cron externe.
 */
@Injectable()
export class LoansService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Loans');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly live?: LiveService,
    @Optional() @Inject(ENV) private readonly env?: Env,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async day(): Promise<number> {
    return gameTimeAt(await this.settings.clock(), Date.now()).day;
  }

  private appUrl(): string {
    return (this.env?.PUBLIC_APP_URL ?? 'https://agbe.tg').replace(/\/$/, '');
  }

  // ───────────── Joueur ─────────────

  /** État du prêt en cours (OPEN/LATE), ou du dernier prêt clos s'il n'y en a pas, plus les réglages pour le simuler. */
  async mine(accountId: string) {
    const ch = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
    if (!ch) throw new NotFoundException('no_character');
    const cfg = await this.settings.get('bank.loans');
    const open = await this.prisma.loan.findFirst({ where: { characterId: ch.id, status: { in: ['OPEN', 'LATE'] } } });
    const last = open ?? (await this.prisma.loan.findFirst({ where: { characterId: ch.id }, orderBy: { createdAt: 'desc' } }));
    const period = Math.max(1, Math.floor(cfg.termDays / cfg.installmentsCount));
    return {
      settings: { capAmount: cfg.capAmount, rateBp: cfg.rateBp, termDays: cfg.termDays, installmentsCount: cfg.installmentsCount, periodDays: period, lateFeeBpPerDay: cfg.lateFeeBpPerDay },
      loan: last
        ? {
            id: last.id,
            principal: last.principal.toString(),
            rateBp: last.rateBp,
            remaining: last.remaining.toString(),
            installmentAmount: last.installmentAmount.toString(),
            nextDueGameDay: last.nextDueGameDay,
            lateSinceGameDay: last.lateSinceGameDay,
            totalPenaltyPaid: last.totalPenaltyPaid.toString(),
            status: last.status,
            closedAt: last.closedAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  /** Demande d'un nouveau prêt : montant au choix ≤ plafond, refusé si un prêt est déjà ouvert. Octroi immédiat. */
  request(accountId: string, amount: number, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `loan-req:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`loan-request|${amount}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { id: null, replay: true };
      const cfg = await this.settings.get('bank.loans');
      if (amount <= 0 || amount > cfg.capAmount) throw new BadRequestException('over_cap');
      const existing = await tx.loan.findFirst({ where: { characterId: c.id, status: { in: ['OPEN', 'LATE'] } } });
      if (existing) throw new BadRequestException('loan_already_open');
      const today = await this.day();
      const principal = BigInt(amount);
      const total = loanTotalDue(principal, cfg.rateBp, cfg.termDays);
      const installment = loanInstallment(total, cfg.installmentsCount);
      const period = Math.max(1, Math.floor(cfg.termDays / cfg.installmentsCount));
      await this.ledger.post(tx, {
        kind: 'LOAN_DISBURSEMENT',
        idempotencyKey: key,
        requestHash,
        memo: 'loan',
        legs: [{ from: await this.ledger.systemWalletId(tx, 'BANK'), to: c.walletId, amount: principal }],
      });
      const loan = await tx.loan.create({
        data: {
          characterId: c.id,
          principal,
          rateBp: cfg.rateBp,
          termDays: cfg.termDays,
          installmentsCount: cfg.installmentsCount,
          installmentAmount: installment,
          remaining: total,
          nextDueGameDay: today + period,
          createdGameDay: today,
        },
      });
      return { id: loan.id, amount, installment: installment.toString(), period, replay: false };
    }).then(async (r) => {
      if (r.result.id && !r.result.replay) await this.notify(r.result.id, 'granted');
      return r;
    });
  }

  /** Remboursement anticipé libre (montant au choix) ; solde tout le capital restant clôture le prêt. */
  repay(accountId: string, amount: number, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `loan-repay:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`loan-repay|${amount}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { closed: false, replay: true };
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "loan" WHERE "characterId" = ${c.id}::uuid AND "status" IN ('OPEN', 'LATE') FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundException('no_open_loan');
      const loan = await tx.loan.findUniqueOrThrow({ where: { id: rows[0]!.id } });
      const amt = BigInt(amount);
      if (amt <= 0n || amt > loan.remaining) throw new BadRequestException('over_remaining');
      await this.ledger.post(tx, {
        kind: 'LOAN_REPAYMENT_EARLY',
        idempotencyKey: key,
        requestHash,
        memo: loan.id,
        legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'BANK'), amount: amt }],
      });
      const remaining = loanRemainingAfterRepay(loan.remaining, amt);
      const closed = remaining <= 0n;
      await tx.loan.update({
        where: { id: loan.id },
        data: { remaining, status: closed ? 'CLOSED' : 'OPEN', closedAt: closed ? new Date() : null, lateSinceGameDay: null },
      });
      return { id: loan.id, remaining: remaining.toString(), closed, replay: false };
    }).then(async (r) => {
      if (!r.result.replay && r.result.closed) await this.notify(r.result.id!, 'closed');
      return r;
    });
  }

  // ───────────── Admin ─────────────

  /** Lecture seule : prêts actifs (OPEN/LATE) et récents, avec le joueur, le capital, la progression et un éventuel retard. Aucune écriture d'argent ici. */
  async adminList() {
    const loans = await this.prisma.loan.findMany({ orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 300 });
    // `Loan` n'a pas de relation Prisma vers `Character` (seulement `characterId`) : second aller-retour groupé plutôt qu'un include.
    const chars = await this.prisma.character.findMany({
      where: { id: { in: [...new Set(loans.map((l) => l.characterId))] } },
      select: { id: true, name: true, account: { select: { username: true, email: true } } },
    });
    const byId = new Map(chars.map((c) => [c.id, c]));
    return loans.map((l) => {
      const c = byId.get(l.characterId);
      return {
        id: l.id,
        character: c?.name ?? '?',
        account: c?.account.username ?? c?.account.email ?? '',
        principal: l.principal.toString(),
        rateBp: l.rateBp,
        remaining: l.remaining.toString(),
        installmentAmount: l.installmentAmount.toString(),
        nextDueGameDay: l.nextDueGameDay,
        lateSinceGameDay: l.lateSinceGameDay,
        totalPenaltyPaid: l.totalPenaltyPaid.toString(),
        status: l.status,
        createdGameDay: l.createdGameDay,
        createdAt: l.createdAt.toISOString(),
        closedAt: l.closedAt?.toISOString() ?? null,
      };
    });
  }

  // ───────────── Traitement périodique ─────────────

  /** Un seul passage du traitement périodique : prélèvement des échéances dues. Appelable directement par les tests. */
  async tick(): Promise<void> {
    try {
      await this.collectDue();
    } catch (e) {
      this.log.warn(`prélèvement : ${(e as Error).message}`);
    }
  }

  /** Prélève chaque échéance due ; solde insuffisant → retard + pénalité, sans bloquer, rattrapé au tour suivant. */
  async collectDue(): Promise<void> {
    const today = await this.day();
    const cfg = await this.settings.get('bank.loans');
    const due = await this.prisma.loan.findMany({ where: { status: { in: ['OPEN', 'LATE'] }, nextDueGameDay: { lte: today } }, select: { id: true } });
    for (const row of due) {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "loan" WHERE "id" = ${row.id}::uuid AND "status" IN ('OPEN', 'LATE') FOR UPDATE`;
        if (locked.length === 0) return null;
        const loan = await tx.loan.findUniqueOrThrow({ where: { id: row.id } });
        if (loan.nextDueGameDay > today) return null; // déjà traitée entre-temps
        const wallet = await tx.wallet.findFirst({ where: { characterId: loan.characterId }, select: { id: true, balance: true } });
        if (!wallet) return null;
        const base = loanDueNow(loan.remaining, loan.installmentAmount);
        const lateDays = loan.lateSinceGameDay != null ? Math.max(0, today - loan.lateSinceGameDay) : 0;
        const amount = lateDays > 0 ? loanAmountWithPenalty(base, lateDays, cfg.lateFeeBpPerDay) : base;
        if (wallet.balance < amount) {
          await tx.loan.update({ where: { id: loan.id }, data: { status: 'LATE', lateSinceGameDay: loan.lateSinceGameDay ?? today } });
          return { kind: 'late' as const, loanId: loan.id, remaining: loan.remaining };
        }
        const penalty = amount - base;
        await this.ledger.post(tx, {
          kind: 'LOAN_REPAYMENT',
          idempotencyKey: `loan-due:${loan.id}:${loan.nextDueGameDay}`,
          requestHash: sha256Hex(`loan-due|${loan.id}|${loan.nextDueGameDay}`),
          memo: loan.id,
          legs: [{ from: wallet.id, to: await this.ledger.systemWalletId(tx, 'BANK'), amount }],
        });
        const remaining = loanRemainingAfterRepay(loan.remaining, base);
        const closed = remaining <= 0n;
        const period = Math.max(1, Math.floor(loan.termDays / loan.installmentsCount));
        await tx.loan.update({
          where: { id: loan.id },
          data: {
            remaining,
            totalPenaltyPaid: { increment: penalty },
            status: closed ? 'CLOSED' : 'OPEN',
            closedAt: closed ? new Date() : null,
            lateSinceGameDay: null,
            nextDueGameDay: closed ? loan.nextDueGameDay : loan.nextDueGameDay + period,
          },
        });
        return { kind: closed ? ('closed' as const) : ('collected' as const), loanId: loan.id, amount, remaining };
      });
      if (!outcome) continue;
      if (outcome.kind === 'late') await this.notify(outcome.loanId, 'late', { remaining: outcome.remaining.toString() });
      else if (outcome.kind === 'collected') await this.notify(outcome.loanId, 'collected', { amount: outcome.amount.toString(), remaining: outcome.remaining.toString() });
      else await this.notify(outcome.loanId, 'closed');
    }
  }

  private async notify(loanId: string, kind: 'granted' | 'collected' | 'late' | 'closed', data: { amount?: string; remaining?: string } = {}): Promise<void> {
    try {
      const loan = await this.prisma.loan.findUnique({ where: { id: loanId }, select: { characterId: true, installmentAmount: true, termDays: true, installmentsCount: true, principal: true } });
      if (!loan) return;
      const period = Math.max(1, Math.floor(loan.termDays / loan.installmentsCount));
      const vars = { amount: data.amount ?? loan.principal.toString(), installment: loan.installmentAmount.toString(), period, remaining: data.remaining ?? '0' };
      this.live?.notifyCharacter(loan.characterId, `loan_${kind}`, vars);
      if (!this.mail) return;
      const ch = await this.prisma.character.findUnique({ where: { id: loan.characterId }, select: { account: { select: { email: true, locale: true, username: true } } } });
      if (!ch?.account.email) return;
      const locale = ch.account.locale === 'en' ? 'en' : 'fr';
      const mailVars = { locale, name: ch.account.username, appUrl: this.appUrl(), ...vars } as const;
      const mail =
        kind === 'granted' ? renderLoanGrantedMail(mailVars) :
        kind === 'collected' ? renderLoanCollectedMail(mailVars) :
        kind === 'late' ? renderLoanLateMail(mailVars) :
        renderLoanClosedMail(mailVars);
      await this.mail.send({ to: ch.account.email, ...mail });
    } catch (e) {
      this.log.warn(`notification : ${(e as Error).message}`);
    }
  }
}

// ───────────── DTOs ─────────────

class LoanAmountDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  amount: number;
}

@Controller('loans')
export class LoansController {
  constructor(private readonly svc: LoansService) {}

  @Get('mine')
  mine(@CurrentUser() u: AuthUser) {
    return this.svc.mine(u.accountId);
  }

  @HttpCode(200)
  @Post('request')
  request(@CurrentUser() u: AuthUser, @Body() dto: LoanAmountDto, @Headers('idempotency-key') key?: string) {
    return this.svc.request(u.accountId, dto.amount, idem(key));
  }

  @HttpCode(200)
  @Post('repay')
  repay(@CurrentUser() u: AuthUser, @Body() dto: LoanAmountDto, @Headers('idempotency-key') key?: string) {
    return this.svc.repay(u.accountId, dto.amount, idem(key));
  }
}

/** Back-office : consultation des prêts bancaires des joueurs. Aucune route d'écriture ni d'annulation ici. */
@Roles('ADMIN')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/loans')
export class AdminLoansController {
  constructor(private readonly svc: LoansService) {}

  @Get()
  list() {
    return this.svc.adminList();
  }
}

@Module({ imports: [LiveModule], controllers: [LoansController, AdminLoansController], providers: [LoansService, CharacterService] })
export class LoansModule {}
