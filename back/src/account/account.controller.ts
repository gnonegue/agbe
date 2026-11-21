import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Module, Patch } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { randomToken } from '../common/crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { CurrencyDto, LocaleDto, PasswordConfirmDto } from '../auth/auth.dto';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { invalidateAccountState } from '../common/guards';
import { SettingsService } from '../settings/settings.service';
import { DeletedAccountsService } from './deleted-accounts.service';

function maskEmail(e: string | null): string | null {
  if (!e) return null;
  const [u, d] = e.split('@');
  return `${u.slice(0, 2)}***@${d}`;
}

@Controller('me')
export class AccountController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  async me(@CurrentUser() user: AuthUser) {
    const a = await this.prisma.account.findUniqueOrThrow({
      where: { id: user.accountId },
      select: { id: true, email: true, phone: true, username: true, locale: true, currency: true, role: true, totpEnabled: true, totpBackupCodes: true, guest: true, createdAt: true, character: { select: { id: true } } },
    });
    return {
      id: a.id,
      username: a.username,
      email: maskEmail(a.email),
      phone: a.phone ? `${a.phone.slice(0, 4)}****${a.phone.slice(-2)}` : null,
      locale: a.locale,
      currency: a.currency,
      role: a.role,
      totpEnabled: a.totpEnabled,
      // Codes de secours encore valables (les codes eux-mêmes ne sont jamais renvoyés) : le joueur est prévenu avant d'être à court
      backupCodesLeft: a.totpEnabled ? a.totpBackupCodes.length : null,
      hasCharacter: a.character !== null,
      guest: a.guest,
      createdAt: a.createdAt,
    };
  }

  @Patch('locale')
  async setLocale(@CurrentUser() user: AuthUser, @Body() dto: LocaleDto) {
    await this.prisma.account.update({ where: { id: user.accountId }, data: { locale: dto.locale } });
    return { locale: dto.locale };
  }

  @Patch('currency')
  async setCurrency(@CurrentUser() user: AuthUser, @Body() dto: CurrencyDto) {
    await this.prisma.account.update({ where: { id: user.accountId }, data: { currency: dto.currency } });
    return { currency: dto.currency };
  }

  /** Export complet des données personnelles du joueur (droit d'accès). */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Get('export')
  async export(@CurrentUser() user: AuthUser) {
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: user.accountId },
      select: {
        email: true,
        phone: true,
        birthDate: true,
        locale: true,
        createdAt: true,
        totpEnabled: true,
        consents: { select: { kind: true, version: true, acceptedAt: true } },
        sessions: { select: { createdAt: true, expiresAt: true, revokedAt: true, ip: true, userAgent: true }, orderBy: { createdAt: 'desc' } },
        purchases: { select: { id: true, productId: true, amount: true, currency: true, status: true, createdAt: true, paidAt: true } },
        character: { select: { name: true, profile: true, region: true, birthCondition: true, createdAt: true, wallet: { select: { id: true, balance: true } } } },
      },
    });
    const walletId = account.character?.wallet?.id;
    const ledger = walletId
      ? await this.prisma.ledgerEntry.findMany({
          where: { walletId },
          orderBy: { createdAt: 'desc' },
          select: { amount: true, balanceAfter: true, createdAt: true, transaction: { select: { kind: true, memo: true } } },
        })
      : [];
    const audit = await this.prisma.auditLog.findMany({ where: { actorId: user.accountId }, select: { action: true, ip: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
    const { character, ...rest } = account;
    return {
      ...rest,
      character: character
        ? { name: character.name, profile: character.profile, region: character.region, birthCondition: character.birthCondition, createdAt: character.createdAt, balance: character.wallet?.balance.toString() }
        : null,
      ledger: ledger.map((e) => ({ kind: e.transaction.kind, memo: e.transaction.memo, amount: e.amount.toString(), balanceAfter: e.balanceAfter.toString(), at: e.createdAt })),
      audit,
    };
  }

  /**
   * Suppression du compte : il est fermé et anonymisé (plus de connexion, e-mail / téléphone / nom libérés).
   * L'identité est gardée à part pour l'administration (table deleted_account : fraude, abus, litiges) puis effacée
   * automatiquement après `account.deletedRetention.days` jours, sauf enquête en cours. Le grand livre et les achats
   * sont conservés (obligation comptable).
   */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(204)
  @Delete()
  async remove(@CurrentUser() user: AuthUser, @Body() dto: PasswordConfirmDto): Promise<void> {
    if (!(await this.auth.verifyPassword(user.accountId, dto.password))) throw new ForbiddenException('invalid_password');
    const neutralHash = await argon2.hash(randomToken(), { type: argon2.argon2id });
    const { days } = await this.settings.get('account.deletedRetention');
    const id = user.accountId;
    await this.prisma.$transaction(async (tx) => {
      // Identité gardée à part pour l'administration (fraude, abus, litige de paiement), effacée après `days` jours
      const acc = await tx.account.findUniqueOrThrow({ where: { id }, include: { character: { select: { name: true } } } });
      const ips = await tx.auditLog.findMany({ where: { actorId: id, ip: { not: null } }, select: { ip: true }, distinct: ['ip'], orderBy: { createdAt: 'desc' }, take: 50 });
      const now = new Date();
      await tx.deletedAccount.create({
        data: {
          accountId: id,
          username: acc.username,
          email: acc.email,
          phone: acc.phone,
          googleSub: acc.googleSub,
          birthDate: acc.birthDate,
          characterName: acc.character?.name ?? null,
          ips: ips.map((r) => r.ip!),
          createdAt: acc.createdAt,
          deletedAt: now,
          purgeAt: new Date(now.getTime() + days * 86_400_000),
        },
      });
      await tx.session.deleteMany({ where: { accountId: id } });
      await tx.consent.deleteMany({ where: { accountId: id } });
      await tx.passwordReset.deleteMany({ where: { accountId: id } });
      await tx.character.updateMany({ where: { accountId: id }, data: { name: 'Ancien joueur' } });
      await tx.auditLog.updateMany({ where: { actorId: id }, data: { ip: null } });
      await tx.account.update({
        where: { id },
        data: {
          email: null,
          phone: null,
          username: null,
          googleSub: null,
          birthDate: new Date('1900-01-01T00:00:00Z'),
          locale: 'fr',
          passwordHash: neutralHash,
          totpSecret: null,
          totpEnabled: false,
          tokenVersion: { increment: 1 }, // invalide immédiatement les jetons d'accès en cours
          deletedAt: now,
        },
      });
    });
    invalidateAccountState(user.accountId);
    // L'IP n'est pas conservée pour l'événement de suppression.
    await this.audit.log('account.deleted', { actorId: user.accountId });
  }
}

@Module({ imports: [AuthModule], controllers: [AccountController], providers: [DeletedAccountsService] })
export class AccountModule {}
