import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import type { Prisma } from '@prisma/client';
import { Equals, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { AuthUser, ClientIp, CurrentUser, Roles } from '../common/decorators';
import { countryOf } from '../common/geo';
import { gameTimeAt } from '../economy/clock';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { invalidateAccountState } from '../common/guards';
import { LiveModule } from '../live/live.module';
import { LiveService } from '../live/live.service';

class ProductEditDto {
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  priceAmount: number;

  @IsBoolean()
  active: boolean;

  /** Pièces créditées (packs de recharge uniquement). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  coinsGranted?: number;
}

/** Nouveau pack de recharge : le paiement réel crédite `coinsGranted` FCFA du jeu (voir payments.service). */
class ProductCreateDto {
  @Matches(/^[a-z0-9_]{3,32}$/)
  id: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 64)
  nameFr: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 64)
  nameEn: string;

  @IsInt()
  @Min(1)
  @Max(100_000_000)
  priceAmount: number;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  coinsGranted: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Période d'analyse (jours UTC inclus, AAAA-MM-JJ). Par défaut : les 30 derniers jours. */
class PeriodDto {
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @IsOptional()
  @Matches(DAY)
  to?: string;
}

class AuditQueryDto extends PeriodDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

class HoldDto {
  @IsBoolean()
  hold: boolean;
}

class UsersQueryDto extends PeriodDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(0, 64)
  q?: string;

  @IsOptional()
  @IsIn(['all', 'players', 'guests', 'admins', 'suspended', 'deleted', 'online', 'playing'])
  kind?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  page?: number;
}

class SuspendDto {
  @IsBoolean()
  suspended: boolean;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(0, 200)
  reason?: string;
}

class RoleDto {
  @IsIn(['PLAYER', 'ADMIN'])
  role: 'PLAYER' | 'ADMIN';
}

/** Outil support : ajuste le solde d'un joueur (positif = crédit, négatif = débit), via le grand livre. */
class AdjustBalanceDto {
  @IsInt()
  @Min(-100_000_000)
  @Max(100_000_000)
  amount: number;
}

class ResetPasswordDto {
  @Equals('RESET')
  confirm!: string;

  /** Absent : mot de passe temporaire généré par le serveur. Présent : celui choisi par l'admin. */
  @IsOptional()
  @IsString()
  @Length(10, 128, { message: 'password_length' })
  password?: string;
}

/** Bornes [début, fin[ d'une période, au plus 366 jours. */
function period(q: PeriodDto, defaultDays = 30): { from: Date; to: Date; days: number } {
  const dayMs = 86_400_000;
  const to = q.to ? new Date(`${q.to}T00:00:00.000Z`).getTime() + dayMs : Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) + dayMs;
  const from = q.from ? new Date(`${q.from}T00:00:00.000Z`).getTime() : to - defaultDays * dayMs;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new BadRequestException('invalid_period');
  const days = Math.round((to - from) / dayMs);
  if (days > 366) throw new BadRequestException('period_too_long');
  return { from: new Date(from), to: new Date(to), days };
}

/** Back-office équipe : rôle ADMIN + double authentification obligatoire en production (voir RolesGuard). */
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly auth: AuthService,
    private readonly live: LiveService,
  ) {}

  @Get('settings')
  all() {
    return this.settings.all();
  }

  @Put('settings/:key')
  async set(@CurrentUser() u: AuthUser, @Param('key') key: string, @Body('value') value: unknown, @ClientIp() ip: string) {
    const saved = await this.settings.set(key, value, u.accountId);
    await this.audit.log('admin.setting_updated', { actorId: u.accountId, target: key, meta: saved as object, ip });
    return { key, value: saved };
  }

  /** Produits payants (recharges, panneaux, parcelles) : prix réel en FCFA, modifiable par l'équipe. */
  @Get('products')
  products() {
    return this.prisma.product.findMany({ orderBy: [{ kind: 'asc' }, { priceAmount: 'asc' }], select: { id: true, kind: true, nameFr: true, nameEn: true, priceAmount: true, currency: true, coinsGranted: true, active: true } });
  }

  @Post('products')
  async addProduct(@CurrentUser() u: AuthUser, @Body() dto: ProductCreateDto, @ClientIp() ip: string) {
    if (await this.prisma.product.findUnique({ where: { id: dto.id } })) throw new ConflictException('product_exists');
    const saved = await this.prisma.product.create({ data: { ...dto, kind: 'COINS', currency: 'XOF', active: true } });
    await this.audit.log('admin.product_created', { actorId: u.accountId, target: saved.id, meta: { price: saved.priceAmount, coins: saved.coinsGranted }, ip });
    return saved;
  }

  @Put('products/:id')
  async setProduct(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ProductEditDto, @ClientIp() ip: string) {
    const before = await this.prisma.product.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('unknown_product');
    const coins = before.kind === 'COINS' && dto.coinsGranted ? { coinsGranted: dto.coinsGranted } : {};
    const saved = await this.prisma.product.update({ where: { id }, data: { priceAmount: dto.priceAmount, active: dto.active, ...coins } });
    await this.audit.log('admin.product_updated', { actorId: u.accountId, target: id, meta: { from: before.priceAmount, to: saved.priceAmount, active: saved.active, coins: saved.coinsGranted }, ip });
    return saved;
  }

  @Get('audit')
  async auditLog(@Query() q: AuditQueryDto) {
    const where = q.from || q.to ? (({ from, to }) => ({ createdAt: { gte: from, lt: to } }))(period(q)) : {};
    const rows = await this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: q.limit ?? 200 });
    // Nom lisible de l'auteur (nom d'utilisateur, sinon personnage, sinon « invité »)
    const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const accs = await this.prisma.account.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, guest: true, character: { select: { name: true } } } });
    const name = new Map(accs.map((a) => [a.id, a.username ? `@${a.username}` : a.character?.name ?? (a.guest ? 'invité' : null)]));
    return rows.map((r) => ({ ...r, actorName: r.actorId ? name.get(r.actorId) ?? null : null }));
  }

  /** Comptes (hors supprimés) : recherche, type, période d'inscription, 25 par page. « deleted » : l'archive des comptes supprimés. */
  @Get('users')
  async users(@Query() q: UsersQueryDto) {
    const take = 25;
    if (q.kind === 'deleted') return this.deletedUsers(q, take);
    const s = q.q?.toLowerCase();
    // « En ligne » : flux temps réel ouvert ; « En train de jouer » : en ligne et position envoyée dans la dernière minute (onglet actif)
    const online = this.live.onlineAccountIds();
    const playing = this.live.playingAccountIds();
    const where = {
      deletedAt: null,
      ...(q.kind === 'online' ? { id: { in: [...online] } } : q.kind === 'playing' ? { id: { in: [...playing] } } : {}),
      ...(q.from || q.to ? { createdAt: (({ from, to }) => ({ gte: from, lt: to }))(period(q)) } : {}),
      ...(q.kind === 'players' ? { guest: false, role: 'PLAYER' as const } : q.kind === 'guests' ? { guest: true } : q.kind === 'admins' ? { role: 'ADMIN' as const } : q.kind === 'suspended' ? { suspendedAt: { not: null } } : {}),
      ...(s ? { OR: [{ username: { contains: s } }, { email: { contains: s } }, { phone: { contains: s } }, { character: { name: { contains: q.q, mode: 'insensitive' as const } } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.account.count({ where }),
      this.prisma.account.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page ?? 0) * take,
        take,
        select: {
          id: true, username: true, email: true, phone: true, role: true, guest: true, googleSub: true, totpEnabled: true, createdAt: true, suspendedAt: true, locale: true,
          character: { select: { name: true, housing: true, respect: true, needsUpdatedAt: true, wallet: { select: { balance: true } } } },
          purchases: { where: { status: 'PAID' }, select: { amount: true } },
          sessions: { orderBy: { authAt: 'desc' }, take: 1, select: { authAt: true } },
        },
      }),
    ]);
    return {
      total,
      pageSize: take,
      items: rows.map(({ character, purchases, sessions, googleSub, ...a }) => ({
        ...a,
        google: googleSub !== null,
        presence: playing.has(a.id) ? ('playing' as const) : online.has(a.id) ? ('online' as const) : null,
        lastLogin: sessions[0]?.authAt ?? null,
        spent: purchases.reduce((n, p) => n + p.amount, 0),
        character: character && { name: character.name, housing: character.housing, respect: character.respect, lastPlayed: character.needsUpdatedAt, balance: (character.wallet?.balance ?? 0n).toString() },
      })),
    };
  }

  /**
   * Comptes supprimés encore dans la durée de conservation : identité gardée (nom, téléphone, e-mail, IP…), recherche,
   * période de suppression ; « rejoined » = comptes actifs qui ont aujourd'hui le même téléphone, e-mail ou compte Google.
   */
  private async deletedUsers(q: UsersQueryDto, take: number) {
    const s = q.q?.trim();
    const where = {
      ...(q.from || q.to ? { deletedAt: (({ from, to }) => ({ gte: from, lt: to }))(period(q)) } : {}),
      ...(s
        ? {
            OR: [
              { username: { contains: s.toLowerCase() } },
              { email: { contains: s.toLowerCase() } },
              { phone: { contains: s } },
              { characterName: { contains: s, mode: 'insensitive' as const } },
              { ips: { has: s } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.deletedAccount.count({ where }),
      this.prisma.deletedAccount.findMany({ where, orderBy: { deletedAt: 'desc' }, skip: (q.page ?? 0) * take, take }),
    ]);
    const links: Prisma.AccountWhereInput[] = rows.flatMap((r) => [
      ...(r.email ? [{ email: r.email }] : []),
      ...(r.phone ? [{ phone: r.phone }] : []),
      ...(r.googleSub ? [{ googleSub: r.googleSub }] : []),
    ]);
    const actives = links.length ? await this.prisma.account.findMany({ where: { deletedAt: null, OR: links }, select: { id: true, username: true, email: true, phone: true, googleSub: true } }) : [];
    return {
      total,
      pageSize: take,
      items: rows.map(({ googleSub, ...r }) => ({
        ...r,
        google: googleSub !== null,
        rejoined: actives.filter((a) => (r.email && a.email === r.email) || (r.phone && a.phone === r.phone) || (googleSub && a.googleSub === googleSub)).map((a) => ({ id: a.id, username: a.username })),
      })),
    };
  }

  /** Enquête en cours : l'identité du compte supprimé n'est plus effacée à l'échéance (jusqu'à ce qu'on lève la garde). */
  @Post('users/:id/hold')
  async holdDeleted(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HoldDto, @ClientIp() ip: string) {
    const r = await this.prisma.deletedAccount.updateMany({ where: { accountId: id }, data: { hold: dto.hold } });
    if (!r.count) throw new NotFoundException('not_found');
    await this.audit.log('admin.deleted_account_hold', { actorId: u.accountId, target: id, meta: { hold: dto.hold }, ip });
    return { hold: dto.hold };
  }

  @Post('users/:id/suspend')
  async suspend(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SuspendDto, @ClientIp() ip: string) {
    if (id === u.accountId) throw new ForbiddenException('cannot_target_self');
    const acc = await this.prisma.account.findFirst({ where: { id, deletedAt: null } });
    if (!acc) throw new NotFoundException('not_found');
    await this.prisma.account.update({ where: { id }, data: { suspendedAt: dto.suspended ? new Date() : null } });
    invalidateAccountState(id);
    if (dto.suspended) await this.auth.logoutAll(id);
    await this.audit.log(dto.suspended ? 'admin.user_suspended' : 'admin.user_unsuspended', { actorId: u.accountId, target: id, meta: { reason: dto.reason ?? null }, ip });
    return { ok: true };
  }

  @Post('users/:id/logout')
  async forceLogout(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ClientIp() ip: string) {
    if (!(await this.prisma.account.findFirst({ where: { id, deletedAt: null } }))) throw new NotFoundException('not_found');
    await this.auth.logoutAll(id);
    await this.audit.log('admin.user_logged_out', { actorId: u.accountId, target: id, ip });
    return { ok: true };
  }

  /**
   * Mot de passe d'un joueur (pas le sien : chacun change le sien depuis ses réglages). Sans `password`, un mot de
   * passe temporaire est généré côté serveur et renvoyé une seule fois ; avec `password`, celui choisi par l'admin
   * (même politique qu'à l'inscription). Sessions révoquées ; le secret n'est jamais journalisé.
   */
  @Post('users/:id/password')
  async resetPassword(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordDto, @ClientIp() ip: string) {
    if (id === u.accountId) throw new ForbiddenException('cannot_target_self');
    const acc = await this.prisma.account.findFirst({ where: { id, deletedAt: null } });
    if (!acc) throw new NotFoundException('not_found');
    if (acc.guest) throw new BadRequestException('account_required');
    if (dto.password) {
      await this.auth.adminSetPassword(id, dto.password);
      await this.audit.log('admin.user_password_reset', { actorId: u.accountId, target: id, meta: { chosen: true }, ip });
      return { ok: true };
    }
    const password = await this.auth.resetPassword(id);
    await this.audit.log('admin.user_password_reset', { actorId: u.accountId, target: id, ip });
    return { password };
  }

  /** Envoie au joueur un lien de réinitialisation par e-mail (il choisit lui-même son mot de passe). `sent` = false si le SMTP n'est pas configuré. */
  @Post('users/:id/reset-link')
  async sendResetLink(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ClientIp() ip: string) {
    if (id === u.accountId) throw new ForbiddenException('cannot_target_self');
    return { sent: await this.auth.sendResetLink(id, u.accountId, ip) };
  }

  /** Rôle : on ne change pas le sien (pas de retrait accidentel du dernier accès), un invité ne devient pas admin. */
  @Post('users/:id/role')
  async setRole(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoleDto, @ClientIp() ip: string) {
    if (id === u.accountId) throw new ForbiddenException('cannot_target_self');
    const acc = await this.prisma.account.findFirst({ where: { id, deletedAt: null } });
    if (!acc) throw new NotFoundException('not_found');
    if (acc.guest && dto.role === 'ADMIN') throw new BadRequestException('account_required');
    await this.prisma.account.update({ where: { id }, data: { role: dto.role } });
    await this.auth.logoutAll(id); // nouveaux droits pris en compte à la prochaine connexion
    await this.audit.log('admin.user_role', { actorId: u.accountId, target: id, meta: { from: acc.role, to: dto.role }, ip });
    return { ok: true };
  }

  /** Outil support : crédite ou débite le portefeuille d'un joueur, prélevé sur/reversé à la trésorerie (grand livre). */
  @Post('users/:id/adjust-balance')
  async adjustBalance(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdjustBalanceDto, @ClientIp() ip: string) {
    if (dto.amount === 0) throw new BadRequestException('zero_amount');
    const acc = await this.prisma.account.findFirst({ where: { id, deletedAt: null }, select: { character: { select: { wallet: { select: { id: true } } } } } });
    if (!acc?.character?.wallet) throw new NotFoundException('not_found');
    const walletId = acc.character.wallet.id;
    const amount = BigInt(Math.abs(dto.amount));
    await this.prisma.$transaction(async (tx) => {
      const treasury = await this.ledger.systemWalletId(tx, 'TREASURY');
      const legs = dto.amount > 0 ? [{ from: treasury, to: walletId, amount }] : [{ from: walletId, to: treasury, amount }];
      return this.ledger.post(tx, { kind: 'ADMIN_ADJUST', legs, memo: `admin:${u.accountId}` });
    });
    invalidateAccountState(id);
    await this.audit.log('admin.adjust_balance', { actorId: u.accountId, target: id, meta: { amount: dto.amount }, ip });
    return { ok: true, amount: dto.amount };
  }

  /** Support : annule la facture de soins impayée du joueur sans la prélever (débloque un nouvel appel au SAMU). */
  @Post('users/:id/waive-medical-bill')
  async waiveMedicalBill(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ClientIp() ip: string) {
    const acc = await this.prisma.account.findFirst({ where: { id, deletedAt: null }, select: { character: { select: { id: true } } } });
    if (!acc?.character) throw new NotFoundException('not_found');
    const bill = await this.prisma.medicalBill.findFirst({ where: { characterId: acc.character.id, paidAt: null }, orderBy: { createdAt: 'asc' } });
    if (!bill) throw new NotFoundException('no_bill');
    await this.prisma.medicalBill.update({ where: { id: bill.id }, data: { paidAt: new Date() } });
    invalidateAccountState(id);
    await this.audit.log('admin.waive_medical_bill', { actorId: u.accountId, target: id, meta: { billId: bill.id, amount: bill.amount }, ip });
    return { ok: true };
  }

  @Get('ledger/verify')
  verify() {
    return this.ledger.verify();
  }

  @Get('stats')
  async stats(@Query() q: PeriodDto) {
    const now = Date.now();
    const day = 86_400_000;
    const { from, to, days } = period(q);
    const inPeriod = { gte: from, lt: to };
    const [accounts, guests, newAccounts, characters, active, paid, recent, byKind, supply, housing, pending, live, sessions] = await Promise.all([
      this.prisma.account.count({ where: { deletedAt: null } }),
      this.prisma.account.count({ where: { deletedAt: null, guest: true } }),
      this.prisma.account.count({ where: { deletedAt: null, createdAt: inPeriod } }),
      this.prisma.character.count(),
      this.prisma.character.count({ where: { needsUpdatedAt: { gte: new Date(now - day) } } }),
      this.prisma.purchase.aggregate({ where: { status: 'PAID', paidAt: inPeriod }, _sum: { amount: true }, _count: true }),
      this.prisma.purchase.findMany({ where: { status: 'PAID', paidAt: inPeriod }, select: { amount: true, paidAt: true } }),
      this.prisma.purchase.findMany({ where: { status: 'PAID', paidAt: inPeriod }, select: { amount: true, product: { select: { kind: true } } } }),
      this.prisma.wallet.aggregate({ where: { characterId: { not: null } }, _sum: { balance: true } }),
      this.prisma.character.groupBy({ by: ['housing'], _count: true }),
      this.prisma.campaign.count({ where: { status: 'PENDING' } }),
      this.prisma.campaign.findMany({ where: { status: { in: ['APPROVED', 'PENDING'] }, endsAt: { gt: new Date(now) } }, select: { slot: true, plotW: true, plotH: true } }),
      this.prisma.session.findMany({ where: { createdAt: inPeriod, ip: { not: null } }, select: { accountId: true, ip: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    // Pays des joueurs connectés pendant la période : un par compte (sa session la plus récente), résolu depuis l'IP
    // (base GeoLite2 embarquée, aucun appel réseau, jamais l'IP elle-même renvoyée).
    const lastIpByAccount = new Map<string, string>();
    for (const s of sessions) lastIpByAccount.set(s.accountId, s.ip!);
    const byCountry = new Map<string, number>();
    for (const ip of lastIpByAccount.values()) {
      const code = countryOf(ip) ?? 'XX';
      byCountry.set(code, (byCountry.get(code) ?? 0) + 1);
    }
    const countries = [...byCountry.entries()].map(([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n);
    // Recettes de la période, jour par jour (jours sans vente à 0)
    const daily = Array.from({ length: days }, (_, i) => ({ day: new Date(from.getTime() + i * day).toISOString().slice(0, 10), amount: 0 }));
    for (const r of recent) {
      const d = daily.find((x) => x.day === r.paidAt!.toISOString().slice(0, 10));
      if (d) d.amount += r.amount;
    }
    const kinds: Record<string, number> = {};
    for (const r of byKind) kinds[r.product.kind] = (kinds[r.product.kind] ?? 0) + r.amount;
    // Occupation des espaces pub (cases louées / cases disponibles)
    const sea = await this.settings.get('sea.plots');
    const zones = [{ id: 'sea', slot: -2, cells: sea.cols * sea.rows }, ...(await this.settings.get('ad.zones')).map((z) => ({ id: z.id, slot: z.slot, cells: z.cols * z.rows }))];
    const occupancy = zones.map((z) => ({ id: z.id, cells: z.cells, used: live.filter((c) => c.slot === z.slot).reduce((a, c) => a + (c.plotW ?? 0) * (c.plotH ?? 0), 0) }));
    // Foncier : quarts vendus par zone, propriétaires, titres délivrés, exploitations, terrains en vente, valeur payée
    const land = await this.settings.get('land');
    const [quartersByZone, holdingsByZone, owners, titled, built, listed, paidSum] = await Promise.all([
      this.prisma.landQuarter.groupBy({ by: ['zoneId'], _count: { _all: true } }),
      this.prisma.landHolding.groupBy({ by: ['zoneId'], _count: { _all: true } }),
      this.prisma.landHolding.groupBy({ by: ['characterId'] }),
      this.prisma.landHolding.count({ where: { status: 'TITLED' } }),
      this.prisma.landHolding.count({ where: { useId: { not: null } } }),
      this.prisma.landListing.count(),
      this.prisma.landHolding.aggregate({ _sum: { paid: true } }),
    ]);
    // Études : cursus en cours et diplômes délivrés par niveau
    const [studying, diplomaByKind] = await Promise.all([this.prisma.study.count(), this.prisma.diploma.groupBy({ by: ['kind'], _count: { _all: true } })]);
    // Habillement : vêtements possédés, joueurs habillés, boutiques de joueurs ouvertes et leurs ventes, articles les plus portés
    const today = gameTimeAt(await this.settings.clock(), Date.now()).day;
    const [garments, dressedOwners, shopsOpen, shopSales, topGarments] = await Promise.all([
      this.prisma.garment.count(),
      this.prisma.garment.groupBy({ by: ['characterId'] }),
      this.prisma.clothingShop.count({ where: { paidUntilDay: { gt: today } } }),
      this.prisma.clothingShop.aggregate({ _sum: { sales: true } }),
      this.prisma.garment.groupBy({ by: ['itemId'], _count: { _all: true }, orderBy: { _count: { itemId: 'desc' } }, take: 5 }),
    ]);
    const soldQ = new Map(quartersByZone.map((r) => [r.zoneId, r._count._all]));
    const holdN = new Map(holdingsByZone.map((r) => [r.zoneId, r._count._all]));
    return {
      from: from.toISOString().slice(0, 10),
      to: new Date(to.getTime() - day).toISOString().slice(0, 10),
      education: { studying, byKind: Object.fromEntries(diplomaByKind.map((d) => [d.kind, d._count._all])) },
      clothes: { garments, owners: dressedOwners.length, shopsOpen, shopSales: (shopSales._sum.sales ?? 0n).toString(), top: await (async () => {
        const items = await this.settings.get('clothes.items');
        return topGarments.map((g) => {
          const it = items.find((x) => x.id === g.itemId);
          return { itemId: g.itemId, n: g._count._all, emoji: it?.emoji ?? '👕', nameFr: it?.nameFr ?? g.itemId, nameEn: it?.nameEn ?? g.itemId };
        });
      })() },
      land: {
        owners: owners.length,
        holdings: [...holdN.values()].reduce((a, n) => a + n, 0),
        m2: [...soldQ.values()].reduce((a, n) => a + n, 0) * land.quarterM2,
        titled,
        built,
        listed,
        paid: (paidSum._sum.paid ?? 0n).toString(),
        zones: land.zones.map((z) => ({ id: z.id, nameFr: z.nameFr, nameEn: z.nameEn, water: !!z.water, holdings: holdN.get(z.id) ?? 0, soldQuarters: soldQ.get(z.id) ?? 0, totalQuarters: z.cols * z.rows * 4 })),
      },
      accounts,
      guests,
      newAccounts,
      characters,
      active,
      purchases: paid._count,
      revenue: paid._sum.amount ?? 0,
      daily,
      byKind: kinds,
      moneySupply: (supply._sum.balance ?? 0n).toString(),
      housing: Object.fromEntries(housing.map((h) => [h.housing, h._count])),
      pendingAds: pending,
      liveBoards: live.filter((c) => c.slot >= -1).length,
      occupancy,
      countries,
    };
  }
}

@Module({ imports: [AuthModule, LiveModule], controllers: [AdminController] })
export class AdminModule {}
