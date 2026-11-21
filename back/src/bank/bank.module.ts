import { BadRequestException, Body, Controller, Headers, HttpCode, Injectable, Logger, Module, NotFoundException, OnModuleDestroy, OnModuleInit, Optional, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IsInt, IsString, Matches, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { gameTimeAt } from '../economy/clock';
import { GAME_DAYS_PER_MONTH, matured, simpleInterest } from '../economy/bank';
import { sha256Hex } from '../common/crypto';

class SavingsDto {
  @IsString()
  @Matches(/^[a-z]{2,16}$/)
  bankId: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000_000)
  amount: number;
}
class TermDto extends SavingsDto {
  @IsInt()
  @Min(1)
  @Max(120)
  months: number;
}

function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

type Tx = Parameters<Parameters<CharacterService['act']>[1]>[0];
const MAX_OPEN_TERMS = 10;

/**
 * Banques et microfinance : livret d'épargne par banque et dépôts à terme (DAT) dont le taux dépend de la durée.
 * Ouvrir un livret ou un DAT se fait en agence (aux heures d'ouverture) ; versements, retraits et clôtures
 * ensuite depuis le téléphone. Fonds détenus par le portefeuille BANK, intérêts versés par le Trésor.
 */
@Injectable()
export class BankService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  onModuleInit(): void {
    if (!this.prisma) return;
    this.timer = setInterval(() => void this.payMaturedTerms(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Les DAT arrivés à échéance sont versés automatiquement (capital + intérêts) : plus besoin de passer en agence ni de les clôturer. */
  async payMaturedTerms(): Promise<number> {
    if (!this.prisma) return 0;
    let paid = 0;
    try {
      const day = await this.day();
      const rows = await this.prisma.bankDeposit.findMany({ where: { kind: 'TERM', closedAt: null }, select: { id: true, characterId: true, startDay: true, termDays: true } });
      for (const r of rows.filter((x) => matured(x.startDay, x.termDays ?? 0, day))) {
        const ch = await this.prisma.character.findUnique({ where: { id: r.characterId }, select: { accountId: true } });
        if (!ch) continue;
        try {
          await this.closeTerm(ch.accountId, r.id);
          paid++;
        } catch (e) {
          new Logger('Bank').warn(`DAT ${r.id} non versé : ${(e as Error).message}`);
        }
      }
    } catch (e) {
      new Logger('Bank').warn(`Versement des DAT : ${(e as Error).message}`);
    }
    return paid;
  }

  private async day() {
    return gameTimeAt(await this.settings.clock(), Date.now()).day;
  }

  private async bank(bankId: string) {
    const b = (await this.settings.get('banks')).find((x) => x.id === bankId);
    if (!b) throw new NotFoundException('unknown_bank');
    return b;
  }

  /** Il faut être dans une agence de cette banque, ouverte. */
  private async atAgency(locationId: string, bankId: string) {
    if (!locationId.startsWith(`bank_${bankId}_`)) throw new BadRequestException('bank_go_agency');
    await this.chars.assertOpen(locationId);
  }

  /** Capitalise les intérêts dus sur les livrets du personnage (Trésor → Banque). */
  private async accrueAll(tx: Tx, characterId: string, day: number) {
    const banks = await this.settings.get('banks');
    const rows = await tx.bankDeposit.findMany({ where: { characterId, kind: 'SAVINGS', closedAt: null } });
    let total = 0n;
    for (const r of rows) {
      if (day === r.lastAccruedDay) continue;
      const interest = simpleInterest(r.principal, r.yearBp, day - r.lastAccruedDay);
      if (interest > 0n) {
        await this.ledger.post(tx, {
          kind: 'BANK_INTEREST',
          idempotencyKey: `bank-int:${r.id}:${day}`,
          memo: r.bankId,
          legs: [{ from: await this.ledger.systemWalletId(tx, 'TREASURY'), to: await this.ledger.systemWalletId(tx, 'BANK'), amount: interest }],
        });
      }
      // Le taux du livret suit le barème courant de la banque
      const rate = banks.find((b) => b.id === r.bankId)?.savingsYearBp ?? r.yearBp;
      await tx.bankDeposit.update({ where: { id: r.id }, data: { principal: { increment: interest }, lastAccruedDay: day, yearBp: rate } });
      total += interest;
    }
    return total;
  }

  /** État : barèmes, agences, livrets à jour et DAT. */
  view(accountId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const day = await this.day();
      const interest = await this.accrueAll(tx, c.id, day);
      const rows = await tx.bankDeposit.findMany({ where: { characterId: c.id, closedAt: null }, orderBy: { createdAt: 'asc' } });
      return {
        day,
        interest: interest.toString(),
        banks: await this.settings.get('banks'),
        savings: rows.filter((r) => r.kind === 'SAVINGS').map((r) => ({ bankId: r.bankId, balance: r.principal.toString(), yearBp: r.yearBp })),
        terms: rows
          .filter((r) => r.kind === 'TERM')
          .map((r) => ({
            id: r.id,
            bankId: r.bankId,
            principal: r.principal.toString(),
            yearBp: r.yearBp,
            months: Math.round((r.termDays ?? 0) / GAME_DAYS_PER_MONTH),
            startDay: r.startDay,
            endDay: r.startDay + (r.termDays ?? 0),
            interest: simpleInterest(r.principal, r.yearBp, r.termDays ?? 0).toString(),
            matured: matured(r.startDay, r.termDays ?? 0, day),
          })),
      };
    });
  }

  deposit(accountId: string, bankId: string, amount: number, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `bank:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`bank-deposit|${bankId}|${amount}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { amount: 0, replay: true };
      const b = await this.bank(bankId);
      const day = await this.day();
      await this.accrueAll(tx, c.id, day);
      let acc = await tx.bankDeposit.findFirst({ where: { characterId: c.id, bankId, kind: 'SAVINGS', closedAt: null } });
      if (!acc) {
        // Ouverture du livret : en agence, avec le dépôt minimum
        await this.atAgency(c.locationId, bankId);
        if (amount < b.minSavings) throw new BadRequestException('bank_min_savings');
        acc = await tx.bankDeposit.create({ data: { characterId: c.id, bankId, kind: 'SAVINGS', yearBp: b.savingsYearBp, startDay: day, lastAccruedDay: day } });
      }
      const max = BigInt((await this.settings.get('savings')).maxBalance);
      if (acc.principal + BigInt(amount) > max) throw new BadRequestException('savings_limit');
      await this.ledger.post(tx, { kind: 'BANK_DEPOSIT', idempotencyKey: key, requestHash, memo: bankId, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'BANK'), amount: BigInt(amount) }] });
      await tx.bankDeposit.update({ where: { id: acc.id }, data: { principal: { increment: BigInt(amount) } } });
      return { amount, replay: false };
    });
  }

  withdraw(accountId: string, bankId: string, amount: number, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `bank:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`bank-withdraw|${bankId}|${amount}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { amount: 0, replay: true };
      await this.accrueAll(tx, c.id, await this.day());
      const acc = await tx.bankDeposit.findFirst({ where: { characterId: c.id, bankId, kind: 'SAVINGS', closedAt: null } });
      if (!acc || acc.principal < BigInt(amount)) throw new BadRequestException('savings_insufficient');
      await this.ledger.post(tx, { kind: 'BANK_WITHDRAW', idempotencyKey: key, requestHash, memo: bankId, legs: [{ from: await this.ledger.systemWalletId(tx, 'BANK'), to: c.walletId, amount: BigInt(amount) }] });
      await tx.bankDeposit.update({ where: { id: acc.id }, data: { principal: { decrement: BigInt(amount) } } });
      return { amount, replay: false };
    });
  }

  /** Ouvrir un DAT en agence : durée choisie dans le barème, taux figé pour toute la durée. */
  openTerm(accountId: string, bankId: string, months: number, amount: number, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `bank:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`bank-term|${bankId}|${months}|${amount}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { amount: 0, replay: true };
      const b = await this.bank(bankId);
      const term = b.terms.find((x) => x.months === months);
      if (!term) throw new BadRequestException('unknown_term');
      await this.atAgency(c.locationId, bankId);
      if (amount < b.minTerm) throw new BadRequestException('bank_min_term');
      if ((await tx.bankDeposit.count({ where: { characterId: c.id, kind: 'TERM', closedAt: null } })) >= MAX_OPEN_TERMS) throw new BadRequestException('too_many_terms');
      const day = await this.day();
      await this.ledger.post(tx, { kind: 'BANK_TERM', idempotencyKey: key, requestHash, memo: `${bankId}:${months}m`, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'BANK'), amount: BigInt(amount) }] });
      const d = await tx.bankDeposit.create({
        data: { characterId: c.id, bankId, kind: 'TERM', principal: BigInt(amount), yearBp: term.yearBp, startDay: day, termDays: months * GAME_DAYS_PER_MONTH, lastAccruedDay: day },
      });
      return { id: d.id, amount, interest: simpleInterest(BigInt(amount), term.yearBp, months * GAME_DAYS_PER_MONTH).toString(), replay: false };
    });
  }

  /** Clôturer un DAT : à l'échéance capital + intérêts ; avant, capital seul (intérêts perdus). */
  closeTerm(accountId: string, id: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "bank_deposit" WHERE "id" = ${id}::uuid AND "characterId" = ${c.id}::uuid AND "closedAt" IS NULL FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundException('not_found');
      const d = await tx.bankDeposit.findUniqueOrThrow({ where: { id } });
      if (d.kind !== 'TERM') throw new NotFoundException('not_found');
      const day = await this.day();
      const due = matured(d.startDay, d.termDays ?? 0, day);
      const interest = due ? simpleInterest(d.principal, d.yearBp, d.termDays ?? 0) : 0n;
      const legs = [{ from: await this.ledger.systemWalletId(tx, 'BANK'), to: c.walletId, amount: d.principal }];
      if (interest > 0n) legs.push({ from: await this.ledger.systemWalletId(tx, 'TREASURY'), to: c.walletId, amount: interest });
      await this.ledger.post(tx, { kind: due ? 'BANK_TERM_PAID' : 'BANK_TERM_BROKEN', idempotencyKey: `bank-close:${d.id}`, memo: d.bankId, legs });
      await tx.bankDeposit.update({ where: { id }, data: { closedAt: new Date() } });
      return { principal: d.principal.toString(), interest: interest.toString(), early: !due };
    });
  }
}

@Controller('bank')
export class BankController {
  constructor(private readonly svc: BankService) {}

  @HttpCode(200)
  @Post('state')
  state(@CurrentUser() u: AuthUser) {
    return this.svc.view(u.accountId);
  }

  @HttpCode(200)
  @Post('savings/deposit')
  deposit(@CurrentUser() u: AuthUser, @Body() dto: SavingsDto, @Headers('idempotency-key') key?: string) {
    return this.svc.deposit(u.accountId, dto.bankId, dto.amount, idem(key));
  }

  @HttpCode(200)
  @Post('savings/withdraw')
  withdraw(@CurrentUser() u: AuthUser, @Body() dto: SavingsDto, @Headers('idempotency-key') key?: string) {
    return this.svc.withdraw(u.accountId, dto.bankId, dto.amount, idem(key));
  }

  @HttpCode(200)
  @Post('terms')
  open(@CurrentUser() u: AuthUser, @Body() dto: TermDto, @Headers('idempotency-key') key?: string) {
    return this.svc.openTerm(u.accountId, dto.bankId, dto.months, dto.amount, idem(key));
  }

  @HttpCode(200)
  @Post('terms/:id/close')
  close(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.svc.closeTerm(u.accountId, id);
  }
}

@Module({ controllers: [BankController], providers: [BankService, CharacterService] })
export class BankModule {}
