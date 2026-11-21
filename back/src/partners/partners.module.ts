import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { sniffImage } from '../common/image';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AuthUser, ClientIp, CurrentUser, Public, Roles, AccountRequired } from '../common/decorators';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';
import { SettingsService } from '../settings/settings.service';
import { fitsGrid, overlaps } from '../economy/plots';
import { BrandVenuesService } from './brand-venues.service';

const COLOR = /^#[0-9a-fA-F]{6}$/;
/** Durée de diffusion d'un panneau réservé en libre-service (produits `board_7d` et `board_fixed_7d`). */
const BOARD_DAYS = 7;
/** Annonce rotative (tous les panneaux sans annonce fixe) : produit de base ; annonce fixe sur un panneau choisi : produit majoré. */
const ROTATING_PRODUCT = 'board_7d';
const FIXED_PRODUCT = 'board_fixed_7d';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Page « Annonces » du site, où revient une réservation faite depuis le site (sinon : le jeu). */
const sitePath = (site?: 'fr' | 'en') => (site === 'en' ? '/en/ads' : site === 'fr' ? '/annonces' : undefined);

/** Lien sortant : https uniquement, sans identifiants ni caractères de contrôle. */
export function safeHttpsUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BadRequestException('invalid_url');
  }
  if (u.protocol !== 'https:' || u.username || u.password || raw.length > 200 || /[\u0000-\u001f\s]/.test(raw)) throw new BadRequestException('invalid_url');
  return u.toString();
}

/** Modèles de bâtiments de marque dessinés par le jeu (mêmes identifiants côté client). */
export const BRAND_MODELS = ['tower', 'agency', 'restaurant', 'shop', 'station', 'transport', 'clinic', 'hotel'] as const;

class PartnerDto {
  @Transform(trim)
  @IsString()
  @Length(2, 64)
  name: string;

  @IsIn(['BRAND', 'SCHOOL', 'ARTIST', 'PROMOTER', 'INSTITUTION'])
  kind: 'BRAND' | 'SCHOOL' | 'ARTIST' | 'PROMOTER' | 'INSTITUTION';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 200)
  website?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 120)
  contact?: string;
}

class PartnerPatchDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Identité du partenaire, complétée par l'équipe (une demande d'espace ne donne que nom, société, WhatsApp et message). */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 64)
  name?: string;

  @IsOptional()
  @IsIn(['BRAND', 'SCHOOL', 'ARTIST', 'PROMOTER', 'INSTITUTION'])
  kind?: 'BRAND' | 'SCHOOL' | 'ARTIST' | 'PROMOTER' | 'INSTITUTION';

  /** Site web (https) ; chaîne vide = retirer. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 200)
  website?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 120)
  contact?: string;

  /** Formule attribuée après signature du contrat (facturé hors jeu). */
  @IsOptional()
  @IsIn(['NONE', 'BRONZE', 'SILVER', 'GOLD'])
  tier?: 'NONE' | 'BRONZE' | 'SILVER' | 'GOLD';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  months?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 40)
  placeLabel?: string;

  /** Modèle du bâtiment de marque (voir BRAND_MODELS). */
  @IsOptional()
  @IsIn(BRAND_MODELS)
  placeModel?: string;

  /** Emplacement du lieu de marque (identifiant de partners.spots), ou « none » pour le retirer. */
  @IsOptional()
  @Matches(/^([a-z0-9_]{2,32}|none)$/)
  placeSpot?: string;

  @IsOptional()
  @Matches(COLOR)
  placeColor?: string;

  /** Montré dans la section « Nos partenaires » du site public. */
  @IsOptional()
  @IsBoolean()
  showOnSite?: boolean;
}

class OfferDto {
  @IsUUID('4')
  partnerId: string;

  @IsIn(['JOB', 'EVENT'])
  kind: 'JOB' | 'EVENT';

  @Transform(trim)
  @IsString()
  @Length(2, 80)
  title: string;

  @Transform(trim)
  @IsString()
  @Length(2, 400)
  body: string;

  @Transform(trim)
  @IsString()
  @Length(2, 80)
  place: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 200)
  url?: string;

  @IsOptional()
  @IsDateString()
  happensAt?: string;

  @IsInt()
  @Min(1)
  @Max(365)
  days: number;
}

class OfferActiveDto {
  @IsBoolean()
  active: boolean;
}

class CampaignDto {
  @IsUUID('4')
  partnerId: string;

  @IsInt()
  @Min(-1)
  @Max(99)
  slot: number;

  @Transform(trim)
  @IsString()
  @Length(2, 40)
  title: string;

  @Transform(trim)
  @IsString()
  @Length(0, 80)
  subtitle: string;

  @Matches(COLOR)
  bg: string;

  @Matches(COLOR)
  fg: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 200)
  url?: string;

  /** Durée de diffusion en jours réels. */
  @IsInt()
  @Min(1)
  @Max(365)
  days: number;
}

/** Mise à jour d'une campagne par l'équipe : textes, couleurs, lien ; `days` repousse la fin (et relance une campagne terminée). */
class CampaignPatchDto {
  /** Autre panneau de la ville pour cette annonce (-1 = tous les panneaux) ; refusé s'il est déjà occupé. */
  @IsOptional()
  @IsInt()
  @Min(-1)
  @Max(99)
  slot?: number;

  /** Autre partenaire pour cette annonce (le plafond de sa formule s'applique comme à la création). */
  @IsOptional()
  @IsUUID('4')
  partnerId?: string;

  @Transform(trim)
  @IsString()
  @Length(2, 40)
  title: string;

  @Transform(trim)
  @IsString()
  @Length(0, 80)
  subtitle: string;

  @Matches(COLOR)
  bg: string;

  @Matches(COLOR)
  fg: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 200)
  url?: string;

  /** Nouvelle durée à partir d'aujourd'hui, en jours réels (sinon la date de fin ne change pas). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

  /** Nouvelles cases d'une annonce en mer, sur un lac ou à l'est (rectangle entier : les quatre valeurs ensemble). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  plotX?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  plotY?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(64)
  plotW?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(64)
  plotH?: number;
}

/** Réservation d'un panneau depuis le jeu (libre-service, comme sur Lagos Life). */
class BookDto {
  /** -1 = annonce rotative (tous les panneaux sans annonce fixe) ; 0..N-1 = fixe sur ce panneau précis (majoration). */
  @IsInt()
  @Min(-1)
  @Max(99)
  slot: number;

  @Transform(trim)
  @IsString()
  @Length(2, 64)
  advertiser: string;

  @Transform(trim)
  @IsString()
  @Length(2, 40)
  title: string;

  @Transform(trim)
  @IsString()
  @Length(0, 80)
  subtitle: string;

  @Matches(COLOR)
  bg: string;

  @Matches(COLOR)
  fg: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 200)
  url?: string;

  /** Réservation faite depuis le site (page « Annonces ») : après paiement, retour sur cette page dans cette langue. */
  @IsOptional()
  @IsIn(['fr', 'en'])
  site?: 'fr' | 'en';
}

/** Location de parcelles en mer : rectangle de cases + affiche (comme un panneau). */
class PlotDto {
  /** Espace de pub : « sea » (la mer) ou l'identifiant d'une zone de ad.zones. */
  @IsOptional()
  @Matches(/^[a-z_]{2,20}$/)
  zone?: string;

  /** Durée choisie, en nombre de périodes (parmi ad.plots.period.counts). */
  @IsInt()
  @Min(1)
  @Max(36)
  periods: number;

  @Transform(trim)
  @IsString()
  @Length(2, 64)
  advertiser: string;

  @Transform(trim)
  @IsString()
  @Length(2, 40)
  title: string;

  @Transform(trim)
  @IsString()
  @Length(0, 80)
  subtitle: string;

  @Matches(COLOR)
  bg: string;

  @Matches(COLOR)
  fg: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 200)
  url?: string;

  @IsInt()
  @Min(0)
  @Max(199)
  x: number;

  @IsInt()
  @Min(0)
  @Max(99)
  y: number;

  @IsInt()
  @Min(1)
  @Max(20)
  w: number;

  @IsInt()
  @Min(1)
  @Max(20)
  h: number;

  /** Réservation faite depuis le site (page « Annonces ») : après paiement, retour sur cette page dans cette langue. */
  @IsOptional()
  @IsIn(['fr', 'en'])
  site?: 'fr' | 'en';
}

/** Grille et emplacement (slot) d'un espace de pub (« sea » ou une zone de ad.zones) ; null si inconnu. */
async function adZone(settings: SettingsService, id: string) {
  if (id === 'sea') {
    const g = await settings.get('sea.plots');
    return { id, slot: -2, grid: { cols: g.cols, rows: g.rows, cell: g.cell, originX: g.originX, originZ: g.originZ, maxSide: g.maxSide, days: g.days } };
  }
  const z = (await settings.get('ad.zones')).find((x) => x.id === id);
  return z ? { id, slot: z.slot, grid: { cols: z.cols, rows: z.rows, cell: z.cell, originX: z.originX, originZ: z.originZ, maxSide: z.maxSide, days: 7 } } : null;
}

/** Campagnes qui occupent des cases : en ligne, en validation, ou réservées depuis moins de 24 h. */
function liveOrHeldWhere(now: Date) {
  return {
    OR: [
      { status: 'APPROVED' as const, endsAt: { gt: now } },
      { status: 'PENDING' as const },
      { status: 'AWAITING_PAYMENT' as const, createdAt: { gt: new Date(now.getTime() - 86_400_000) } },
    ],
  };
}

/** Annonce posée par l'équipe sur des cases de la mer, des lacs ou de la zone est (publiée tout de suite, sans paiement). */
class AdminPlotDto {
  @IsUUID('4')
  partnerId: string;

  @Matches(/^[a-z_]{2,20}$/)
  zone: string;

  @IsInt()
  @Min(0)
  @Max(500)
  x: number;

  @IsInt()
  @Min(0)
  @Max(500)
  y: number;

  @IsInt()
  @Min(1)
  @Max(20)
  w: number;

  @IsInt()
  @Min(1)
  @Max(20)
  h: number;

  @IsInt()
  @Min(1)
  @Max(365)
  days: number;

  @Transform(trim)
  @IsString()
  @Length(2, 40)
  title: string;

  @Transform(trim)
  @IsString()
  @Length(0, 80)
  subtitle: string;

  @Matches(COLOR)
  bg: string;

  @Matches(COLOR)
  fg: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 200)
  url?: string;
}

class StatusDto {
  @IsIn(['APPROVED', 'REJECTED', 'ENDED'])
  status: 'APPROVED' | 'REJECTED' | 'ENDED';
}

/** Panneaux vus par les joueurs : campagnes validées et en cours, avec le site du partenaire. */
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('boards')
export class BillboardsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /** Offre publicitaire publique (visiteurs non connectés) : prix fixés par le serveur, formules et contact. */
  @Public()
  @Get('offer')
  async offer() {
    const board = await this.prisma.product.findFirst({ where: { id: ROTATING_PRODUCT, kind: 'AD_BOARD', active: true } });
    const fixed = await this.prisma.product.findFirst({ where: { id: FIXED_PRODUCT, kind: 'AD_BOARD', active: true } });
    // Prix d'une case selon le lieu (mer, est de la ville, lagunes) ; espaces sans tarif actif : non proposés
    const places: { zone: string; price: number }[] = [];
    for (const zone of ['sea', ...(await this.settings.get('ad.zones')).map((z) => z.id)]) {
      const p = await this.plotProduct(zone);
      if (p) places.push({ zone, price: p.priceAmount });
    }
    return {
      board: board ? { price: board.priceAmount, days: BOARD_DAYS } : null,
      boardFixed: fixed ? { price: fixed.priceAmount, days: BOARD_DAYS } : null,
      plot: places.length ? { price: Math.min(...places.map((p) => p.price)), periodDays: (await this.settings.get('ad.plots.period')).days, places } : null,
      tiers: await this.settings.get('partners.tiers'),
      contact: await this.settings.get('partners.contact'),
    };
  }

  /**
   * Réserver un panneau : crée l'annonce (non diffusée) puis l'intention de paiement réel.
   * Le paiement confirmé par le fournisseur la fait passer en validation ; l'équipe l'approuve avant diffusion.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @AccountRequired()
  @Post('book')
  async book(@CurrentUser() u: AuthUser, @Body() dto: BookDto, @ClientIp() ip: string) {
    // Le serveur choisit le tarif : rotatif (défaut) ou fixe sur un panneau précis (majoré)
    const rotating = dto.slot === -1;
    const product = await this.prisma.product.findFirst({ where: { id: rotating ? ROTATING_PRODUCT : FIXED_PRODUCT, kind: 'AD_BOARD', active: true } });
    if (!product) throw new NotFoundException('unknown_product');
    // Une annonce fixe ne s'affiche que sur le panneau réservé : il doit exister dans la ville
    if (dto.slot >= (await this.settings.get('ad.boards')).count) throw new BadRequestException('unknown_board');
    const { max: rotationMax, panels: rotationPanels } = await this.settings.get('ad.rotation');
    // Les derniers panneaux restent à la rotation : sinon, des panneaux tous vendus en fixe, plus aucune annonce rotative visible
    if (!rotating && dto.slot >= (await this.settings.get('ad.boards')).count - rotationPanels) throw new BadRequestException('board_rotation_only');
    const url = safeHttpsUrl(dto.url);
    const contact = await this.accountContact(u.accountId);
    let partner = await this.prisma.partner.findFirst({ where: { accountId: u.accountId, name: dto.advertiser } });
    if (!partner) partner = await this.prisma.partner.create({ data: { name: dto.advertiser, kind: 'BRAND', accountId: u.accountId, website: url, contact } });
    else if (partner.contact !== contact) partner = await this.prisma.partner.update({ where: { id: partner.id }, data: { contact } });
    const campaign = await this.prisma.$transaction(async (tx) => {
      // Un panneau, un annonceur à la fois : deux réservations simultanées ne prennent pas le même
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7302)`;
      const held = await tx.campaign.count({ where: { slot: dto.slot, ...this.liveOrHeld(new Date()) } });
      // Fixe : un annonceur par panneau. Rotatif : plafond d'annonces en même temps pour que chacune reste visible
      if (rotating ? held >= rotationMax : held > 0) throw new ConflictException(rotating ? 'rotation_full' : 'board_taken');
      return tx.campaign.create({
        data: { partnerId: partner.id, slot: dto.slot, title: dto.title, subtitle: dto.subtitle, bg: dto.bg, fg: dto.fg, url, status: 'AWAITING_PAYMENT', days: BOARD_DAYS, endsAt: new Date(Date.now() + BOARD_DAYS * 86_400_000) },
      });
    });
    await this.audit.log('billboard.booked', { actorId: u.accountId, target: campaign.id, meta: { slot: dto.slot, rotating, advertiser: dto.advertiser }, ip });
    try {
      return { campaignId: campaign.id, ...(await this.payments.checkout(u.accountId, product.id, { campaignId: campaign.id, returnPath: sitePath(dto.site) })) };
    } catch (e) {
      await this.prisma.campaign.delete({ where: { id: campaign.id } });
      throw e;
    }
  }

  /** Parcelles en mer : grille, affiches en ligne et cases déjà prises (en attente de paiement ou de validation). */
  /** Grille et emplacement (slot) d'un espace de pub ; null si inconnu. */
  /** Contact de l'annonceur : l'e-mail et le téléphone de son compte (la réservation exige un compte). */
  private async accountContact(accountId: string): Promise<string | null> {
    const a = await this.prisma.account.findUnique({ where: { id: accountId }, select: { email: true, phone: true } });
    return [a?.email, a?.phone].filter(Boolean).join(' · ').slice(0, 120) || null;
  }

  private zoneOf(id: string) {
    return adZone(this.settings, id);
  }

  /** Parcelles occupées d'un espace (en ligne avec leur affiche, ou simplement réservées). */
  private async plotsIn(slot: number) {
    const now = new Date();
    const rows = await this.prisma.campaign.findMany({
      where: { slot, ...this.liveOrHeld(now) },
      include: { partner: { select: { name: true, website: true, active: true } } },
    });
    const withImage = new Set((await this.prisma.campaignImage.findMany({ where: { campaignId: { in: rows.map((r) => r.id) } }, select: { campaignId: true } })).map((x) => x.campaignId));
    return rows.map((c) => ({
      id: c.id,
      x: c.plotX!,
      y: c.plotY!,
      w: c.plotW!,
      h: c.plotH!,
      live: c.status === 'APPROVED' && c.partner.active,
      ...(c.status === 'APPROVED' && c.partner.active ? { hasImage: withImage.has(c.id), endsAt: c.endsAt, title: c.title, subtitle: c.subtitle, bg: c.bg, fg: c.fg, url: c.url ?? c.partner.website, partner: c.partner.name } : {}),
    }));
  }

  /** Panneaux réservables et ceux déjà pris (en ligne, en validation ou en attente de paiement) : page de réservation du site. */
  @Get('slots')
  async slots() {
    const rows = await this.prisma.campaign.findMany({ where: { slot: { gte: 0 }, ...this.liveOrHeld(new Date()) }, select: { slot: true }, distinct: ['slot'] });
    const rotating = await this.prisma.campaign.count({ where: { slot: -1, ...this.liveOrHeld(new Date()) } });
    const { count } = await this.settings.get('ad.boards');
    const rotation = await this.settings.get('ad.rotation');
    return { count, taken: rows.map((r) => r.slot).sort((a, b) => a - b), rotating, rotatingMax: rotation.max, rotationFrom: count - rotation.panels };
  }

  /** Tarif d'une case dans un espace : produit `plot_<espace>` actif (sinon l'espace n'est pas à louer). */
  private plotProduct(zone: string) {
    return this.prisma.product.findFirst({ where: { id: `plot_${zone}`, kind: 'AD_PLOT', active: true } });
  }

  @Get('plots')
  async plots() {
    const sea = (await this.zoneOf('sea'))!;
    const product = await this.plotProduct('sea');
    const zones = [];
    for (const z of await this.settings.get('ad.zones')) {
      const zone = (await this.zoneOf(z.id))!;
      zones.push({ id: zone.id, grid: zone.grid, price: (await this.plotProduct(zone.id))?.priceAmount ?? null, plots: await this.plotsIn(zone.slot) });
    }
    return {
      grid: sea.grid,
      /** Prix d'une case en mer pour une période de `periodDays` jours (chaque zone a son `price`). */
      pricePerPlot: product?.priceAmount ?? null,
      periodDays: (await this.settings.get('ad.plots.period')).days,
      periods: (await this.settings.get('ad.plots.period')).counts,
      plots: await this.plotsIn(-2),
      zones,
    };
  }

  /** Campagnes qui occupent des cases : en ligne, en validation, ou réservées depuis moins de 24 h. */
  private liveOrHeld(now: Date) {
    return liveOrHeldWhere(now);
  }

  /** Louer des parcelles : vérifie la grille et les chevauchements sous verrou, puis crée l'intention de paiement réel. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @AccountRequired()
  @Post('plots/book')
  async bookPlots(@CurrentUser() u: AuthUser, @Body() dto: PlotDto, @ClientIp() ip: string) {
    const zone = await this.zoneOf(dto.zone ?? 'sea');
    if (!zone) throw new BadRequestException('unknown_zone');
    const contact = await this.accountContact(u.accountId);
    const grid = zone.grid;
    const rect = { x: dto.x, y: dto.y, w: dto.w, h: dto.h };
    if (!fitsGrid(rect, grid.cols, grid.rows, grid.maxSide)) throw new BadRequestException('plot_out_of_grid');
    const per = await this.settings.get('ad.plots.period');
    if (!per.counts.includes(dto.periods)) throw new BadRequestException('invalid_duration');
    const days = dto.periods * per.days;
    const product = await this.plotProduct(zone.id);
    if (!product) throw new NotFoundException('unknown_product');
    const url = safeHttpsUrl(dto.url);
    const campaign = await this.prisma.$transaction(async (tx) => {
      // Un seul placement à la fois : deux réservations simultanées ne prennent pas les mêmes cases
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7301)`;
      const taken = await tx.campaign.findMany({ where: { slot: zone.slot, ...this.liveOrHeld(new Date()) }, select: { plotX: true, plotY: true, plotW: true, plotH: true } });
      if (taken.some((t) => overlaps(rect, { x: t.plotX!, y: t.plotY!, w: t.plotW!, h: t.plotH! }))) throw new ConflictException('plot_taken');
      let partner = await tx.partner.findFirst({ where: { accountId: u.accountId, name: dto.advertiser } });
      if (!partner) partner = await tx.partner.create({ data: { name: dto.advertiser, kind: 'BRAND', accountId: u.accountId, website: url, contact } });
      else if (partner.contact !== contact) partner = await tx.partner.update({ where: { id: partner.id }, data: { contact } });
      return tx.campaign.create({
        data: {
          partnerId: partner.id, slot: zone.slot, plotX: rect.x, plotY: rect.y, plotW: rect.w, plotH: rect.h,
          title: dto.title, subtitle: dto.subtitle, bg: dto.bg, fg: dto.fg, url, status: 'AWAITING_PAYMENT',
          days, endsAt: new Date(Date.now() + days * 86_400_000),
        },
      });
    });
    await this.audit.log('plots.booked', { actorId: u.accountId, target: campaign.id, meta: { ...rect, advertiser: dto.advertiser }, ip });
    try {
      return { campaignId: campaign.id, ...(await this.payments.checkout(u.accountId, product.id, { campaignId: campaign.id, units: rect.w * rect.h * dto.periods, returnPath: sitePath(dto.site) })) };
    } catch (e) {
      await this.prisma.campaign.delete({ where: { id: campaign.id } });
      throw e;
    }
  }

  /** Image de l'annonce (parcelles) : propriétaire de la réservation, avant validation ; format et taille revérifiés. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AccountRequired()
  @HttpCode(204)
  @Post('plots/:id/image')
  async uploadImage(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req: Request, @ClientIp() ip: string) {
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new BadRequestException('invalid_image');
    if (body.length > 400 * 1024) throw new BadRequestException('image_too_large');
    const info = sniffImage(body);
    if (!info || info.width < 64 || info.height < 64 || info.width > 2048 || info.height > 2048) throw new BadRequestException('invalid_image');
    const c = await this.prisma.campaign.findUnique({ where: { id }, include: { partner: { select: { accountId: true } } } });
    if (!c || c.partner.accountId !== u.accountId) throw new NotFoundException('not_found');
    if (c.status !== 'AWAITING_PAYMENT' && c.status !== 'PENDING') throw new BadRequestException('campaign_locked');
    const data = { mime: info.mime, width: info.width, height: info.height, data: new Uint8Array(body) };
    await this.prisma.campaignImage.upsert({ where: { campaignId: id }, create: { campaignId: id, ...data }, update: data });
    await this.audit.log('plots.image', { actorId: u.accountId, target: id, meta: { bytes: body.length, ...info }, ip });
  }

  /** Image publique d'une annonce validée et en ligne (jamais avant la validation de l'équipe). */
  @Public()
  @Get(':id/image')
  async image(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Res() res: Response) {
    const c = await this.prisma.campaign.findUnique({ where: { id }, include: { partner: { select: { active: true } } } });
    const img = c && c.status === 'APPROVED' && c.partner.active && c.endsAt > new Date() ? await this.prisma.campaignImage.findUnique({ where: { campaignId: id } }) : null;
    if (!img) throw new NotFoundException('not_found');
    res.setHeader('Content-Type', img.mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Disposition', 'inline');
    res.end(Buffer.from(img.data));
  }

  /** Mes publicités : statut, période et statistiques (espace partenaire léger dans le jeu). */
  @Get('mine')
  async mine(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.campaign.findMany({
      where: { partner: { accountId: u.accountId }, status: { not: 'AWAITING_PAYMENT' } },
      include: { partner: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const withImage = new Set((await this.prisma.campaignImage.findMany({ where: { campaignId: { in: rows.map((r) => r.id) } }, select: { campaignId: true } })).map((x) => x.campaignId));
    return rows.map((c) => ({ id: c.id, partner: c.partner.name, title: c.title, slot: c.slot, status: c.status, views: c.views, clicks: c.clicks, endsAt: c.endsAt, days: c.days, hasImage: withImage.has(c.id) }));
  }

  /**
   * Vitrine du site public : toutes les annonces validées et en ligne (panneaux, mer, zones), sans connexion.
   * Ni statistiques ni contact de l'annonceur.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('showcase')
  async showcase() {
    const now = new Date();
    const rows = await this.prisma.campaign.findMany({
      where: { status: 'APPROVED', startsAt: { lte: now }, endsAt: { gt: now }, partner: { active: true } },
      include: { partner: { select: { name: true, website: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const withImage = new Set((await this.prisma.campaignImage.findMany({ where: { campaignId: { in: rows.map((r) => r.id) } }, select: { campaignId: true } })).map((x) => x.campaignId));
    const zones = new Map((await this.settings.get('ad.zones')).map((z) => [z.slot, z.id]));
    return rows.map((c) => ({
      id: c.id,
      where: c.slot >= -1 ? 'board' : c.slot === -2 ? 'sea' : (zones.get(c.slot) ?? 'zone'),
      title: c.title,
      subtitle: c.subtitle,
      bg: c.bg,
      fg: c.fg,
      url: c.url ?? c.partner.website,
      partner: c.partner.name,
      hasImage: withImage.has(c.id),
      endsAt: c.endsAt,
    }));
  }

  /**
   * Section « Nos partenaires » du site public : vide tant que le réglage partners.showcase la cache,
   * sinon les partenaires actifs cochés « Afficher sur le site » dans /admin (formule en cours d'abord).
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('partners')
  async sitePartners() {
    if (!(await this.settings.get('partners.showcase')).show) return [];
    const rows = await this.prisma.partner.findMany({ where: { active: true, showOnSite: true }, orderBy: { name: 'asc' }, take: 60 });
    const rank = { GOLD: 0, SILVER: 1, BRONZE: 2, NONE: 3 } as const;
    return rows
      .map((p) => ({ id: p.id, name: p.name, kind: p.kind, website: p.website, color: p.placeColor, tier: activeTier(p) }))
      .sort((a, b) => rank[a.tier] - rank[b.tier]);
  }

  @Get()
  async list() {
    const now = new Date();
    const rows = await this.prisma.campaign.findMany({
      where: { status: 'APPROVED', slot: { gt: -2 }, startsAt: { lte: now }, endsAt: { gt: now }, partner: { active: true } },
      include: { partner: { select: { name: true, kind: true, website: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const withImage = new Set((await this.prisma.campaignImage.findMany({ where: { campaignId: { in: rows.map((r) => r.id) } }, select: { campaignId: true } })).map((x) => x.campaignId));
    return rows.map((c) => ({
      hasImage: withImage.has(c.id),
      id: c.id,
      slot: c.slot,
      title: c.title,
      subtitle: c.subtitle,
      bg: c.bg,
      fg: c.fg,
      url: c.url ?? c.partner.website,
      partner: c.partner.name,
      partnerKind: c.partner.kind,
      endsAt: c.endsAt,
    }));
  }

  @HttpCode(204)
  @Post(':id/view')
  async view(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    await this.prisma.campaign.updateMany({ where: { id, status: 'APPROVED' }, data: { views: { increment: 1 } } });
  }

  @HttpCode(204)
  @Post(':id/click')
  async click(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    await this.prisma.campaign.updateMany({ where: { id, status: 'APPROVED' }, data: { clicks: { increment: 1 } } });
  }
}

/** Formule en cours (une formule échue vaut « aucune »). */
function activeTier(p: { tier: string; tierEndsAt: Date | null }): 'NONE' | 'BRONZE' | 'SILVER' | 'GOLD' {
  if (p.tier === 'NONE' || (p.tierEndsAt && p.tierEndsAt.getTime() <= Date.now())) return 'NONE';
  return p.tier as 'BRONZE' | 'SILVER' | 'GOLD';
}

/** Formule visée par un emplacement VIP, déduite de son identifiant (…_or_…, …_argent_…, …_bronze_…) ; Argent par défaut. */
export function spotTier(id: string): 'GOLD' | 'SILVER' | 'BRONZE' {
  return /(^|_)or(_|$)/.test(id) ? 'GOLD' : /(^|_)bronze(_|$)/.test(id) ? 'BRONZE' : 'SILVER';
}

class SpotRequestDto {
  @IsString()
  @Matches(/^[a-z0-9_]{2,32}$/)
  spotId: string;

  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 80)
  company?: string;

  @Transform(trim)
  @IsString()
  @Matches(/^\+?[\d\s().-]{8,24}$/)
  whatsapp: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 120)
  email?: string;

  @Transform(trim)
  @IsString()
  @Length(10, 1000)
  message: string;
}

class SpotApproveDto {
  /** Durée de la formule accordée, en mois (30 jours). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  months?: number;
}

/** Présence des partenaires dans le jeu : lieux de marque, offres d'emploi, événements. */
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('partners')
export class PartnersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get('places')
  async places() {
    const tiers = await this.settings.get('partners.tiers');
    const rows = await this.prisma.partner.findMany({ where: { active: true, tier: { not: 'NONE' }, placeX: { not: null }, placeZ: { not: null } } });
    const logos = new Map((await this.prisma.partnerLogo.findMany({ where: { partnerId: { in: rows.map((r) => r.id) } }, select: { partnerId: true, updatedAt: true } })).map((l) => [l.partnerId, l.updatedAt.getTime()]));
    return rows
      .filter((p) => {
        const t = activeTier(p);
        return t !== 'NONE' && tiers[t].brandPlace;
      })
      .map((p) => ({ id: p.id, name: p.name, kind: p.kind, tier: activeTier(p), label: p.placeLabel ?? p.name, x: p.placeX!, z: p.placeZ!, color: p.placeColor ?? '#1f6feb', model: p.placeModel ?? 'agency', url: p.website, logo: logos.has(p.id) ? `/api/partners/${p.id}/logo?v=${logos.get(p.id)}` : null }));
  }

  /** Logo d'un partenaire actif (image publique, comme son enseigne en ville). */
  @Public()
  @Get(':id/logo')
  async logo(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Res() res: Response) {
    const l = await this.prisma.partnerLogo.findUnique({ where: { partnerId: id }, include: { partner: { select: { active: true } } } });
    if (!l || !l.partner.active) throw new NotFoundException('not_found');
    res.setHeader('Content-Type', l.mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Disposition', 'inline');
    res.end(Buffer.from(l.data));
  }

  /**
   * Emplacements VIP encore libres (liste des espaces verts réservés aux partenaires Argent et Or) : le jeu y dessine une
   * balise « VIP SPACE » cliquable pour en faire la demande. La formule se déduit de l'identifiant (…_or_…, …_argent_…).
   */
  @Get('free-spots')
  async freeSpots(@CurrentUser() u: AuthUser) {
    const spots = await this.settings.get('partners.spots');
    const tiers = await this.settings.get('partners.tiers');
    const fx = await this.settings.get('fx.rates');
    // Tarif indicatif affiché au joueur : prix mensuel × durée par défaut (réglages admin), converti au taux des réglages.
    // Information seulement : le prix réel est fixé à la validation, jamais lu depuis le client.
    const priceOf = (tier: 'GOLD' | 'SILVER' | 'BRONZE') => {
      const r = tiers[tier];
      const conv = (xof: number, cur: 'EUR' | 'USD') => (fx[cur] ? Math.round(xof / fx[cur]!) : null);
      const total = r.monthlyPrice * r.defaultMonths;
      return { months: r.defaultMonths, monthly: { xof: r.monthlyPrice, eur: conv(r.monthlyPrice, 'EUR'), usd: conv(r.monthlyPrice, 'USD') }, total: { xof: total, eur: conv(total, 'EUR'), usd: conv(total, 'USD') } };
    };
    const taken = new Set((await this.places()).map((p) => `${p.x}:${p.z}`));
    const mine = new Set((await this.prisma.spotRequest.findMany({ where: { accountId: u.accountId, status: 'PENDING' }, select: { spotId: true } })).map((r) => r.spotId));
    // Un bâtiment de marque occupe environ 16 × 14 m : les espaces libres voisins qu'il recouvrirait ne sont plus proposés
    const built = (await this.places()).map((p) => ({ x: p.x, z: p.z }));
    const half = (id: string) => (/(^|_)bronze(_|$)/.test(id) ? [5, 4.5] : /(^|_)or(_|$)/.test(id) ? [10.5, 7.5] : [7, 6]);
    const covered = (s: { id: string; x: number; z: number }) => {
      const [hw, hd] = half(s.id);
      return built.some((b) => Math.abs(s.x - b.x) < 8 + hw && Math.abs(s.z - (b.z + 0.5)) < 7 + hd);
    };
    return spots
      .filter((s) => !taken.has(`${s.x}:${s.z}`) && !covered(s))
      .map((s) => ({ id: s.id, nameFr: s.nameFr, nameEn: s.nameEn, x: s.x, z: s.z, tier: /(^|_)(or|argent|bronze)(_|$)/.test(s.id) ? spotTier(s.id) : null, price: priceOf(spotTier(s.id)), requested: mine.has(s.id) }));
  }

  /**
   * Demande d'un emplacement VIP : liée aux coordonnées de l'emplacement (lues dans les réglages, jamais envoyées par le
   * client), refusée si l'emplacement est déjà occupé ; l'administration la valide ou la refuse.
   */
  @AccountRequired()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('spot-requests')
  async requestSpot(@CurrentUser() u: AuthUser, @Body() dto: SpotRequestDto, @ClientIp() ip: string) {
    const spot = (await this.settings.get('partners.spots')).find((s) => s.id === dto.spotId);
    if (!spot) throw new BadRequestException('unknown_spot');
    const digits = dto.whatsapp.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) throw new BadRequestException('invalid_whatsapp');
    if ((await this.places()).some((p) => p.x === spot.x && p.z === spot.z)) throw new ConflictException('spot_taken');
    if (await this.prisma.spotRequest.findFirst({ where: { accountId: u.accountId, spotId: spot.id, status: 'PENDING' }, select: { id: true } })) throw new ConflictException('request_pending');
    try {
      const r = await this.prisma.spotRequest.create({
        data: { accountId: u.accountId, spotId: spot.id, x: spot.x, z: spot.z, tier: spotTier(spot.id), name: dto.name, company: dto.company || null, whatsapp: digits, email: dto.email || null, message: dto.message },
      });
      await this.audit.log('partner.spot_requested', { actorId: u.accountId, target: r.id, meta: { spot: spot.id }, ip });
      return { id: r.id, status: r.status };
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('request_pending');
      throw e;
    }
  }

  @Get('offers')
  async offers() {
    const now = new Date();
    const rows = await this.prisma.partnerOffer.findMany({
      where: { kind: 'EVENT', active: true, endsAt: { gt: now }, partner: { active: true, tier: { not: 'NONE' } } },
      include: { partner: { select: { name: true, tier: true, tierEndsAt: true } } },
      orderBy: [{ kind: 'asc' }, { happensAt: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return rows
      .filter((o) => activeTier(o.partner) !== 'NONE')
      .map((o) => ({ id: o.id, kind: o.kind, title: o.title, body: o.body, place: o.place, url: o.url, happensAt: o.happensAt, partner: o.partner.name, tier: activeTier(o.partner) }));
  }

  @HttpCode(204)
  @Post('offers/:id/click')
  async click(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    await this.prisma.partnerOffer.updateMany({ where: { id, active: true }, data: { clicks: { increment: 1 } } });
  }
}

/** Gestion des partenaires et de leurs campagnes (équipe AGBE, rôle ADMIN + 2FA). */
@Roles('ADMIN')
@Controller('admin')
export class AdminPartnersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly brandVenues: BrandVenuesService,
  ) {}

  /** Durée (mois) d'une formule : celle demandée, sinon la durée par défaut du réglage ; refusée hors des bornes de la formule. */
  private async tierMonths(tier: 'BRONZE' | 'SILVER' | 'GOLD', requested?: number): Promise<number> {
    const r = (await this.settings.get('partners.tiers'))[tier];
    const months = requested ?? r.defaultMonths;
    if (months < r.minMonths || months > r.maxMonths) throw new BadRequestException('invalid_duration');
    return months;
  }

  /** Plafond d'une formule pour un partenaire (offres d'emploi, événements du mois, panneaux). */
  private async quota(partnerId: string, what: 'jobs' | 'eventsPerMonth' | 'boards' | 'rotating') {
    const p = await this.prisma.partner.findUnique({ where: { id: partnerId } });
    if (!p) throw new NotFoundException('not_found');
    const t = activeTier(p);
    return { partner: p, max: t === 'NONE' ? null : (await this.settings.get('partners.tiers'))[t][what] };
  }

  @Get('partners')
  async partners() {
    const rows = await this.prisma.partner.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { campaigns: true } } } });
    const logos = new Map((await this.prisma.partnerLogo.findMany({ select: { partnerId: true, updatedAt: true } })).map((l) => [l.partnerId, l.updatedAt.getTime()]));
    return rows.map((p) => ({ ...p, logo: logos.has(p.id) ? `/api/partners/${p.id}/logo?v=${logos.get(p.id)}` : null }));
  }

  @Post('partners')
  async createPartner(@CurrentUser() u: AuthUser, @Body() dto: PartnerDto, @ClientIp() ip: string) {
    const p = await this.prisma.partner.create({ data: { name: dto.name, kind: dto.kind, website: safeHttpsUrl(dto.website), contact: dto.contact || null } });
    await this.audit.log('admin.partner_created', { actorId: u.accountId, target: p.id, meta: { name: p.name }, ip });
    return p;
  }

  /** Demandes d'emplacement VIP (par défaut celles en attente), avec l'état de l'emplacement. */
  @Get('spot-requests')
  async spotRequests(@Query('status') status?: string) {
    const st = status === 'APPROVED' || status === 'REJECTED' || status === 'all' ? status : 'PENDING';
    const rows = await this.prisma.spotRequest.findMany({ where: st === 'all' ? {} : { status: st }, orderBy: { createdAt: 'desc' }, take: 200 });
    const spots = await this.settings.get('partners.spots');
    const holders = await this.prisma.partner.findMany({ where: { placeX: { not: null }, placeZ: { not: null } }, select: { id: true, name: true, placeX: true, placeZ: true, active: true, tier: true, tierEndsAt: true } });
    return rows.map((r) => {
      const spot = spots.find((s) => s.id === r.spotId);
      const holder = holders.find((h) => h.placeX === r.x && h.placeZ === r.z && h.active && activeTier(h) !== 'NONE');
      return { ...r, spotNameFr: spot?.nameFr ?? r.spotId, spotNameEn: spot?.nameEn ?? r.spotId, takenBy: holder ? { id: holder.id, name: holder.name } : null };
    });
  }

  /**
   * Approuve une demande : crée le partenaire (formule de l'emplacement, durée choisie) et lui attribue l'emplacement.
   * Refusé si l'emplacement est déjà occupé ; les autres demandes en attente sur ce même emplacement sont refusées.
   */
  @Post('spot-requests/:id/approve')
  async approveSpot(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: SpotApproveDto, @ClientIp() ip: string) {
    const req = await this.prisma.spotRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('not_found');
    if (req.status !== 'PENDING') throw new ConflictException('already_decided');
    if (!(await this.settings.get('partners.spots')).some((s) => s.id === req.spotId && s.x === req.x && s.z === req.z)) throw new BadRequestException('unknown_spot');
    const months = await this.tierMonths(req.tier as 'BRONZE' | 'SILVER' | 'GOLD', dto.months);
    try {
      const partner = await this.prisma.$transaction(async (tx) => {
        const other = await tx.partner.findFirst({ where: { placeX: req.x, placeZ: req.z } });
        if (other) {
          if (other.active && activeTier(other) !== 'NONE') throw new ConflictException('spot_taken');
          // Ancien occupant dont la formule est terminée : l'emplacement lui est retiré
          await tx.partner.update({ where: { id: other.id }, data: { placeX: null, placeZ: null } });
        }
        const label = (req.company || req.name).slice(0, 40);
        const p = await tx.partner.create({
          data: {
            name: (req.company || req.name).slice(0, 64),
            kind: 'BRAND',
            contact: req.whatsapp,
            accountId: req.accountId,
            tier: req.tier,
            tierEndsAt: new Date(Date.now() + months * 30 * 86_400_000),
            placeLabel: label,
            placeX: req.x,
            placeZ: req.z,
            placeColor: req.tier === 'GOLD' ? '#d69a12' : req.tier === 'BRONZE' ? '#a8683a' : '#7d8ba0',
            placeModel: 'agency',
            active: true,
          },
        });
        await tx.spotRequest.update({ where: { id }, data: { status: 'APPROVED', partnerId: p.id, decidedAt: new Date(), decidedBy: u.accountId } });
        await tx.spotRequest.updateMany({ where: { id: { not: id }, x: req.x, z: req.z, status: 'PENDING' }, data: { status: 'REJECTED', decidedAt: new Date(), decidedBy: u.accountId } });
        return p;
      });
      await this.brandVenues.sync();
      await this.audit.log('admin.spot_approved', { actorId: u.accountId, target: id, meta: { spot: req.spotId, partner: partner.id, months }, ip });
      return { id, status: 'APPROVED', partnerId: partner.id };
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('spot_taken');
      throw e;
    }
  }

  @Post('spot-requests/:id/reject')
  async rejectSpot(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @ClientIp() ip: string) {
    const r = await this.prisma.spotRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REJECTED', decidedAt: new Date(), decidedBy: u.accountId } });
    if (r.count === 0) throw new ConflictException('already_decided');
    await this.audit.log('admin.spot_rejected', { actorId: u.accountId, target: id, ip });
    return { id, status: 'REJECTED' };
  }

  /** Emplacements des lieux de marque, avec le partenaire qui occupe chacun (liste de choix de l'admin). */
  @Get('partners/spots')
  async spots() {
    const spots = await this.settings.get('partners.spots');
    const placed = await this.prisma.partner.findMany({ where: { placeX: { not: null }, placeZ: { not: null } }, select: { id: true, name: true, placeX: true, placeZ: true } });
    return spots.map((s) => {
      const p = placed.find((q) => q.placeX === s.x && q.placeZ === s.z);
      return { ...s, takenBy: p ? { id: p.id, name: p.name } : null };
    });
  }

  @Patch('partners/:id')
  async patchPartner(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: PartnerPatchDto, @ClientIp() ip: string) {
    const tier =
      dto.tier === undefined
        ? {}
        : dto.tier === 'NONE'
          ? { tier: dto.tier, tierEndsAt: null }
          : { tier: dto.tier, tierEndsAt: new Date(Date.now() + (await this.tierMonths(dto.tier, dto.months)) * 30 * 86_400_000) };
    // Emplacement choisi dans la liste : jamais deux partenaires au même endroit
    let place: { placeX?: number | null; placeZ?: number | null } = {};
    if (dto.placeSpot === 'none') place = { placeX: null, placeZ: null };
    else if (dto.placeSpot) {
      const spot = (await this.settings.get('partners.spots')).find((s) => s.id === dto.placeSpot);
      if (!spot) throw new BadRequestException('unknown_spot');
      const other = await this.prisma.partner.findFirst({ where: { id: { not: id }, placeX: spot.x, placeZ: spot.z } });
      if (other) throw new BadRequestException('spot_taken');
      place = { placeX: spot.x, placeZ: spot.z };
    }
    const p = await this.prisma.partner
      .update({ where: { id }, data: { active: dto.active, name: dto.name, kind: dto.kind, website: dto.website === undefined ? undefined : dto.website === '' ? null : safeHttpsUrl(dto.website), contact: dto.contact === undefined ? undefined : dto.contact || null, showOnSite: dto.showOnSite, placeLabel: dto.placeLabel, placeColor: dto.placeColor, placeModel: dto.placeModel, ...place, ...tier } })
      .catch(() => {
        throw new NotFoundException('not_found');
      });
    await this.brandVenues.sync();
    await this.audit.log('admin.partner_updated', { actorId: u.accountId, target: id, meta: { active: dto.active, showOnSite: dto.showOnSite, tier: dto.tier, months: dto.months }, ip });
    return p;
  }

  @Get('campaigns')
  async campaigns() {
    // Toutes les annonces en attente (à modérer), puis les 200 plus récentes : aucune attente ne disparaît de la liste
    const include = { partner: { select: { name: true, contact: true } } };
    const [pending, recent] = await Promise.all([
      this.prisma.campaign.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' }, include }),
      this.prisma.campaign.findMany({ where: { status: { not: 'PENDING' } }, orderBy: { createdAt: 'desc' }, include, take: 200 }),
    ]);
    const all = [...pending, ...recent];
    const withImage = new Set((await this.prisma.campaignImage.findMany({ where: { campaignId: { in: all.map((c) => c.id) } }, select: { campaignId: true } })).map((x) => x.campaignId));
    return all.map((c) => ({ ...c, hasImage: withImage.has(c.id) }));
  }

  @Post('campaigns')
  async createCampaign(@CurrentUser() u: AuthUser, @Body() dto: CampaignDto, @ClientIp() ip: string) {
    // Panneau fixe (un numéro précis) ou rotatif (« tous panneaux », slot -1) : deux plafonds distincts par formule
    const rotating = dto.slot === -1;
    const { partner, max } = await this.quota(dto.partnerId, rotating ? 'rotating' : 'boards');
    if (max !== null) {
      const live = await this.prisma.campaign.count({ where: { partnerId: partner.id, status: { in: ['PENDING', 'APPROVED'] }, endsAt: { gt: new Date() }, purchaseId: null, slot: rotating ? -1 : { gte: 0 } } });
      if (live >= max) throw new BadRequestException(rotating ? 'tier_rotating_limit' : 'tier_boards_limit');
    }
    const c = await this.prisma.campaign.create({
      data: {
        partnerId: partner.id,
        slot: dto.slot,
        title: dto.title,
        subtitle: dto.subtitle,
        bg: dto.bg,
        fg: dto.fg,
        url: safeHttpsUrl(dto.url),
        endsAt: new Date(Date.now() + dto.days * 86_400_000),
      },
    });
    await this.audit.log('admin.campaign_created', { actorId: u.accountId, target: c.id, meta: { partner: partner.name, slot: c.slot }, ip });
    return c;
  }

  @Post('campaigns/plot')
  async createPlotCampaign(@CurrentUser() u: AuthUser, @Body() dto: AdminPlotDto, @ClientIp() ip: string) {
    const zone = await adZone(this.settings, dto.zone);
    if (!zone) throw new BadRequestException('unknown_zone');
    const partner = await this.prisma.partner.findUnique({ where: { id: dto.partnerId } });
    if (!partner) throw new NotFoundException('not_found');
    const rect = { x: dto.x, y: dto.y, w: dto.w, h: dto.h };
    if (!fitsGrid(rect, zone.grid.cols, zone.grid.rows, zone.grid.maxSide)) throw new BadRequestException('plot_out_of_grid');
    const c = await this.prisma.$transaction(async (tx) => {
      // Même verrou que les réservations des joueurs : jamais deux annonces sur les mêmes cases
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7301)`;
      const taken = await tx.campaign.findMany({ where: { slot: zone.slot, ...liveOrHeldWhere(new Date()) }, select: { plotX: true, plotY: true, plotW: true, plotH: true } });
      if (taken.some((t) => overlaps(rect, { x: t.plotX!, y: t.plotY!, w: t.plotW!, h: t.plotH! }))) throw new ConflictException('plot_taken');
      return tx.campaign.create({
        data: {
          partnerId: partner.id, slot: zone.slot, plotX: rect.x, plotY: rect.y, plotW: rect.w, plotH: rect.h,
          title: dto.title, subtitle: dto.subtitle, bg: dto.bg, fg: dto.fg, url: safeHttpsUrl(dto.url),
          status: 'APPROVED', days: dto.days, endsAt: new Date(Date.now() + dto.days * 86_400_000),
        },
      });
    });
    await this.audit.log('admin.campaign_created', { actorId: u.accountId, target: c.id, meta: { partner: partner.name, zone: zone.id, ...rect }, ip });
    return c;
  }

  /** Logo d'un partenaire, envoyé par l'équipe : PNG, JPEG ou WebP de 32 à 1024 px, 300 Ko au plus (format revérifié sur les octets). */
  @HttpCode(204)
  @Post('partners/:id/logo')
  async setLogo(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req: Request, @ClientIp() ip: string) {
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new BadRequestException('invalid_image');
    if (body.length > 300 * 1024) throw new BadRequestException('image_too_large');
    const info = sniffImage(body);
    if (!info || info.width < 32 || info.height < 32 || info.width > 1024 || info.height > 1024) throw new BadRequestException('invalid_image');
    if (!(await this.prisma.partner.findUnique({ where: { id } }))) throw new NotFoundException('not_found');
    const data = { mime: info.mime, width: info.width, height: info.height, data: new Uint8Array(body) };
    await this.prisma.partnerLogo.upsert({ where: { partnerId: id }, create: { partnerId: id, ...data }, update: data });
    await this.audit.log('admin.partner_logo', { actorId: u.accountId, target: id, meta: { bytes: body.length, ...info }, ip });
  }

  @HttpCode(204)
  @Delete('partners/:id/logo')
  async removeLogo(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @ClientIp() ip: string) {
    await this.prisma.partnerLogo.deleteMany({ where: { partnerId: id } });
    await this.audit.log('admin.partner_logo_removed', { actorId: u.accountId, target: id, ip });
  }

  /** Image d'une campagne, envoyée par l'équipe (mêmes contrôles de format et de taille que pour les annonceurs). */
  @HttpCode(204)
  @Post('campaigns/:id/image')
  async adminImage(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Req() req: Request, @ClientIp() ip: string) {
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new BadRequestException('invalid_image');
    if (body.length > 400 * 1024) throw new BadRequestException('image_too_large');
    const info = sniffImage(body);
    if (!info || info.width < 64 || info.height < 64 || info.width > 2048 || info.height > 2048) throw new BadRequestException('invalid_image');
    if (!(await this.prisma.campaign.findUnique({ where: { id } }))) throw new NotFoundException('not_found');
    const data = { mime: info.mime, width: info.width, height: info.height, data: new Uint8Array(body) };
    await this.prisma.campaignImage.upsert({ where: { campaignId: id }, create: { campaignId: id, ...data }, update: data });
    await this.audit.log('admin.campaign_image', { actorId: u.accountId, target: id, meta: { bytes: body.length, ...info }, ip });
  }

  @Delete('campaigns/:id/image')
  @HttpCode(204)
  async adminImageDelete(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @ClientIp() ip: string) {
    await this.prisma.campaignImage.deleteMany({ where: { campaignId: id } });
    await this.audit.log('admin.campaign_image_removed', { actorId: u.accountId, target: id, ip });
  }

  @Get('campaigns/:id/image')
  async campaignImage(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Res() res: Response) {
    const img = await this.prisma.campaignImage.findUnique({ where: { campaignId: id } });
    if (!img) throw new NotFoundException('not_found');
    res.setHeader('Content-Type', img.mime);
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(img.data));
  }

  @Patch('campaigns/:id')
  async patchCampaign(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: CampaignPatchDto, @ClientIp() ip: string) {
    const current = await this.prisma.campaign.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('not_found');
    if (current.status === 'AWAITING_PAYMENT') throw new BadRequestException('campaign_unpaid');
    // Nouvelle durée : la campagne repart d'aujourd'hui ; une campagne terminée est relancée (une refusée reste refusée)
    const period = dto.days ? { endsAt: new Date(Date.now() + dto.days * 86_400_000), ...(current.status === 'ENDED' ? { status: 'APPROVED' as const, startsAt: new Date() } : {}) } : {};
    const rectGiven = [dto.plotX, dto.plotY, dto.plotW, dto.plotH];
    const wantsRect = rectGiven.some((v) => v !== undefined);
    if (wantsRect && (rectGiven.some((v) => v === undefined) || current.slot >= -1)) throw new BadRequestException('invalid_plot');
    // Changement de panneau : seulement pour une annonce de panneau, vers un panneau qui existe et qui est libre
    const newSlot = dto.slot !== undefined && dto.slot !== current.slot ? dto.slot : null;
    if (newSlot !== null) {
      if (current.slot < -1) throw new BadRequestException('invalid_slot');
      if (newSlot >= (await this.settings.get('ad.boards')).count) throw new BadRequestException('unknown_board');
      if (newSlot >= 0 && (await this.prisma.campaign.count({ where: { slot: newSlot, id: { not: id }, ...liveOrHeldWhere(new Date()) } }))) throw new ConflictException('board_taken');
    }
    // Changement de partenaire ou de type de panneau (fixe / rotatif) : même plafond de formule qu'à la création
    const targetPartner = dto.partnerId ?? current.partnerId;
    const targetSlot = newSlot ?? current.slot;
    if ((dto.partnerId && dto.partnerId !== current.partnerId) || (newSlot !== null && (newSlot === -1) !== (current.slot === -1))) {
      const rotating = targetSlot === -1;
      if (targetSlot >= -1 && !current.purchaseId) {
        const { max } = await this.quota(targetPartner, rotating ? 'rotating' : 'boards');
        if (max !== null) {
          const live = await this.prisma.campaign.count({ where: { partnerId: targetPartner, id: { not: id }, status: { in: ['PENDING', 'APPROVED'] }, endsAt: { gt: new Date() }, purchaseId: null, slot: rotating ? -1 : { gte: 0 } } });
          if (live >= max) throw new BadRequestException(rotating ? 'tier_rotating_limit' : 'tier_boards_limit');
        }
      } else if (!(await this.prisma.partner.findUnique({ where: { id: dto.partnerId }, select: { id: true } }))) throw new NotFoundException('not_found');
    }
    const data = { title: dto.title, subtitle: dto.subtitle, bg: dto.bg, fg: dto.fg, url: dto.url ? safeHttpsUrl(dto.url) : null, ...(dto.partnerId ? { partnerId: dto.partnerId } : {}), ...(newSlot !== null ? { slot: newSlot } : {}), ...period };
    const c = await this.prisma.$transaction(async (tx) => {
      if (wantsRect) {
        // Déplacer ou redimensionner les cases : même grille, mêmes verrous et mêmes conflits que pour une création
        const zone = (await this.settings.get('ad.zones')).find((z) => z.slot === current.slot);
        const grid = current.slot === -2 ? (await this.settings.get('sea.plots')) : zone;
        if (!grid) throw new BadRequestException('unknown_zone');
        const rect = { x: dto.plotX!, y: dto.plotY!, w: dto.plotW!, h: dto.plotH! };
        if (!fitsGrid(rect, grid.cols, grid.rows, grid.maxSide)) throw new BadRequestException('plot_out_of_grid');
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(7301)`;
        const taken = await tx.campaign.findMany({ where: { slot: current.slot, id: { not: id }, ...liveOrHeldWhere(new Date()) }, select: { plotX: true, plotY: true, plotW: true, plotH: true } });
        if (taken.some((t) => overlaps(rect, { x: t.plotX!, y: t.plotY!, w: t.plotW!, h: t.plotH! }))) throw new ConflictException('plot_taken');
        return tx.campaign.update({ where: { id }, data: { ...data, plotX: rect.x, plotY: rect.y, plotW: rect.w, plotH: rect.h } });
      }
      return tx.campaign.update({ where: { id }, data });
    });
    await this.audit.log('admin.campaign_updated', { actorId: u.accountId, target: id, meta: { days: dto.days ?? null, relaunched: current.status === 'ENDED' && !!dto.days, moved: wantsRect }, ip });
    return c;
  }

  @Post('campaigns/:id/status')
  async setStatus(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: StatusDto, @ClientIp() ip: string) {
    const current = await this.prisma.campaign.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('not_found');
    if (current.status === 'AWAITING_PAYMENT') throw new BadRequestException('campaign_unpaid');
    // Une campagne payée démarre à sa validation, pour la durée achetée
    const period = dto.status === 'APPROVED' && current.purchaseId ? { startsAt: new Date(), endsAt: new Date(Date.now() + current.days * 86_400_000) } : {};
    const c = await this.prisma.campaign.update({ where: { id }, data: { status: dto.status, ...period } }).catch(() => {
      throw new NotFoundException('not_found');
    });
    await this.audit.log('admin.campaign_status', { actorId: u.accountId, target: id, meta: { status: dto.status }, ip });
    return c;
  }
}

@Roles('ADMIN')
@Controller('admin/offers')
export class AdminOffersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  list() {
    return this.prisma.partnerOffer.findMany({ orderBy: { createdAt: 'desc' }, include: { partner: { select: { name: true } } }, take: 200 });
  }

  /** Publier une offre dans la limite de la formule du partenaire. */
  @Post()
  async create(@CurrentUser() u: AuthUser, @Body() dto: OfferDto, @ClientIp() ip: string) {
    const p = await this.prisma.partner.findUnique({ where: { id: dto.partnerId } });
    if (!p) throw new NotFoundException('not_found');
    const t = activeTier(p);
    if (t === 'NONE') throw new BadRequestException('tier_required');
    const rules = (await this.settings.get('partners.tiers'))[t];
    const now = new Date();
    // Les emplois ne viennent pas des partenaires : ils sont créés par les joueurs (leur entreprise) ou par l'équipe
    if (dto.kind === 'JOB') throw new BadRequestException('partner_jobs_not_allowed');
    {
      if (!dto.happensAt) throw new BadRequestException('event_date_required');
      const since = new Date(now.getTime() - 30 * 86_400_000);
      const recent = await this.prisma.partnerOffer.count({ where: { partnerId: p.id, kind: 'EVENT', createdAt: { gt: since } } });
      if (recent >= rules.eventsPerMonth) throw new BadRequestException('tier_events_limit');
    }
    const o = await this.prisma.partnerOffer.create({
      data: {
        partnerId: p.id,
        kind: dto.kind,
        title: dto.title,
        body: dto.body,
        place: dto.place,
        url: safeHttpsUrl(dto.url),
        happensAt: dto.kind === 'EVENT' && dto.happensAt ? new Date(dto.happensAt) : null,
        endsAt: new Date(now.getTime() + dto.days * 86_400_000),
      },
    });
    await this.audit.log('admin.offer_created', { actorId: u.accountId, target: o.id, meta: { partner: p.name, kind: o.kind }, ip });
    return o;
  }

  @Post(':id/active')
  async setActive(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: OfferActiveDto, @ClientIp() ip: string) {
    const o = await this.prisma.partnerOffer.update({ where: { id }, data: { active: dto.active } }).catch(() => {
      throw new NotFoundException('not_found');
    });
    await this.audit.log('admin.offer_active', { actorId: u.accountId, target: id, meta: { active: dto.active }, ip });
    return o;
  }
}

@Module({ imports: [PaymentsModule], providers: [BrandVenuesService], exports: [BrandVenuesService], controllers: [BillboardsController, PartnersController, AdminPartnersController, AdminOffersController] })
export class PartnersModule {}
