import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query, ServiceUnavailableException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AuthUser, ClientIp, CurrentUser, Public, Roles } from '../common/decorators';
import { ENV, Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { renderContactNotice, renderContactReply } from '../mail/mail.templates';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const TOPICS = ['board', 'plots', 'partner', 'game', 'other'] as const;
const TOPIC_FR: Record<(typeof TOPICS)[number] | 'bug', string> = { bug: 'Bug signalé en jeu', board: 'Panneau en ville', plots: 'Cases (mer, est, lagunes)', partner: 'Partenariat', game: 'Question sur le jeu', other: 'Autre' };
/** Au-delà, le formulaire refuse les nouveaux messages pendant l'heure (protège la boîte mail d'un envoi massif). */
const MAX_PER_HOUR = 40;

/**
 * Numéro WhatsApp en chiffres seuls, indicatif compris : « +228 90 00 00 00 », « 0022890000000 » → « 22890000000 ».
 * Un numéro togolais à 8 chiffres reçoit l'indicatif 228. Null si le numéro n'est pas plausible.
 */
export function normalizeWhatsapp(raw: string): string | null {
  let d = raw.replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(d)) return null;
  d = d.replace(/^\+/, '').replace(/^00/, '');
  if (d.length === 8) d = `228${d}`;
  return d.length >= 10 && d.length <= 15 && !d.startsWith('0') ? d : null;
}

class ContactDto {
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  company?: string;

  @Transform(trim)
  @IsString()
  @Matches(/^\+?[\d\s().-]{8,24}$/)
  whatsapp: string;

  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(120)
  email?: string;

  @IsIn(TOPICS)
  topic: (typeof TOPICS)[number];

  @Transform(trim)
  @IsString()
  @Length(10, 2000)
  message: string;

  @IsIn(['fr', 'en'])
  locale: 'fr' | 'en';

  /** Champ piège invisible : un humain le laisse vide, un robot le remplit. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

/** Bug signalé par un joueur connecté : le serveur ajoute lui-même le compte, le lieu et le navigateur. */
class BugDto {
  @Transform(trim)
  @IsString()
  @Length(10, 1500)
  message: string;

  /** Taille de l'écran (affichage seulement), ex. « 390x844 ». */
  @IsOptional()
  @Matches(/^\d{2,5}x\d{2,5}$/)
  viewport?: string;

  @IsIn(['fr', 'en'])
  locale: 'fr' | 'en';
}

class StatusDto {
  @IsIn(['NEW', 'READ', 'DONE'])
  status: 'NEW' | 'READ' | 'DONE';
}

class ReplyDto {
  @IsIn(['email', 'whatsapp'])
  channel: 'email' | 'whatsapp';

  @Transform(trim)
  @IsString()
  @Length(2, 2000)
  text: string;
}

class ListQuery {
  @IsOptional()
  @IsIn(['open', 'all'])
  view?: 'open' | 'all';

  /** Période de réception (jours AAAA-MM-JJ, bornes comprises) ; sans elle : tous les messages. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  /** Recherche par expéditeur : nom, société, e-mail, WhatsApp, ou compte joueur du contexte d'un bug (et texte du message). */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 64)
  q?: string;
}

/** Formulaire de contact (pages Contact et Annonces du site) : enregistré, puis envoyé par e-mail à l'équipe. */
@Controller('contact')
export class ContactController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  @HttpCode(204)
  @Post()
  async send(@Body() dto: ContactDto, @ClientIp() ip: string): Promise<void> {
    if (dto.website) return; // robot : même réponse, rien n'est gardé
    const whatsapp = normalizeWhatsapp(dto.whatsapp);
    if (!whatsapp) throw new BadRequestException('invalid_whatsapp');
    if ((await this.prisma.contactMessage.count({ where: { createdAt: { gt: new Date(Date.now() - 3_600_000) } } })) >= MAX_PER_HOUR) throw new ServiceUnavailableException('contact_busy');
    const m = await this.prisma.contactMessage.create({
      data: { name: dto.name, company: dto.company || null, whatsapp, email: dto.email || null, topic: dto.topic, message: dto.message, locale: dto.locale },
    });
    await this.audit.log('contact.received', { target: m.id, meta: { topic: m.topic }, ip });
    const to = (await this.settings.get('partners.contact')).email;
    const base = (this.env.MAIL_LINK_URL || this.env.PUBLIC_APP_URL).replace(/\/$/, '');
    if (to) {
      const mail = renderContactNotice({ name: m.name, company: m.company, whatsapp, email: m.email, topic: TOPIC_FR[dto.topic], message: m.message, adminUrl: `${base}/admin` });
      await this.mail.send({ to, ...mail, replyTo: m.email ?? undefined });
    }
  }
}

/** Bug signalé depuis le jeu : arrive dans la même boîte que les messages du site (onglet Messages de l'administration). */
@Controller('contact')
export class BugReportController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @HttpCode(200)
  @Post('bug')
  async report(@CurrentUser() u: AuthUser, @Body() dto: BugDto, @ClientIp() ip: string, @Headers('user-agent') ua?: string) {
    if ((await this.prisma.contactMessage.count({ where: { createdAt: { gt: new Date(Date.now() - 3_600_000) } } })) >= MAX_PER_HOUR) throw new ServiceUnavailableException('contact_busy');
    const [acc, ch] = await Promise.all([
      this.prisma.account.findUnique({ where: { id: u.accountId }, select: { email: true, phone: true } }),
      this.prisma.character.findUnique({ where: { accountId: u.accountId }, select: { name: true, locationId: true } }),
    ]);
    const context = [`compte ${u.accountId}`, ch ? `lieu ${ch.locationId}` : null, dto.viewport ? `écran ${dto.viewport}` : null, ua ? ua.replace(/\s+/g, ' ') : null].filter(Boolean).join(' · ').slice(0, 400);
    const whatsapp = acc?.phone ? normalizeWhatsapp(acc.phone) ?? '' : '';
    const m = await this.prisma.contactMessage.create({
      data: { name: ch?.name ?? 'Joueur', whatsapp, email: acc?.email ?? null, topic: 'bug', message: dto.message, locale: dto.locale, context },
    });
    await this.audit.log('contact.bug', { actorId: u.accountId, target: m.id, ip });
    const to = (await this.settings.get('partners.contact')).email;
    const base = (this.env.MAIL_LINK_URL || this.env.PUBLIC_APP_URL).replace(/\/$/, '');
    if (to) {
      const mail = renderContactNotice({ name: m.name, company: null, whatsapp, email: m.email, topic: TOPIC_FR.bug, message: m.message, adminUrl: `${base}/admin`, context });
      await this.mail.send({ to, ...mail, replyTo: m.email ?? undefined });
    }
    return { ok: true };
  }
}

/** Onglet « Messages » de l'administration : lire, classer, répondre par e-mail ou WhatsApp. */
@Roles('ADMIN')
@Controller('admin/contact')
export class AdminContactController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query() q: ListQuery) {
    const search = q.q?.trim() || undefined;
    const digits = search?.replace(/\D/g, '') ?? '';
    const dayMs = 86_400_000;
    const from = q.from ? new Date(`${q.from}T00:00:00.000Z`) : undefined;
    const to = q.to ? new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + dayMs) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from >= to)) throw new BadRequestException('invalid_period');
    const [rows, unread] = await Promise.all([
      this.prisma.contactMessage.findMany({
        where: { ...(q.view === 'all' ? {} : { status: { not: 'DONE' as const } }), ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { company: { contains: search, mode: 'insensitive' as const } }, { email: { contains: search, mode: 'insensitive' as const } }, ...(digits ? [{ whatsapp: { contains: digits } }] : []), { context: { contains: search, mode: 'insensitive' as const } }, { message: { contains: search, mode: 'insensitive' as const } }] } : {}), ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}) },
        include: { replies: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.contactMessage.count({ where: { status: 'NEW' } }),
    ]);
    return { unread, messages: rows };
  }

  @HttpCode(204)
  @Post(':id/status')
  async setStatus(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: StatusDto, @ClientIp() ip: string): Promise<void> {
    const r = await this.prisma.contactMessage.updateMany({ where: { id }, data: { status: dto.status } });
    if (!r.count) throw new NotFoundException('not_found');
    await this.audit.log('admin.contact_status', { actorId: u.accountId, target: id, meta: { status: dto.status }, ip });
  }

  /** E-mail : envoyé par le serveur (réponse possible vers notre adresse). WhatsApp : lien prêt à ouvrir chez l'administrateur. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/reply')
  async reply(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: ReplyDto, @ClientIp() ip: string) {
    const m = await this.prisma.contactMessage.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('not_found');
    let url: string | null = null;
    if (dto.channel === 'email') {
      if (!m.email) throw new BadRequestException('no_email');
      const team = (await this.settings.get('partners.contact')).email;
      const sent = await this.mail.send({ to: m.email, ...renderContactReply({ locale: m.locale === 'en' ? 'en' : 'fr', name: m.name, reply: dto.text, original: m.message }), replyTo: team || undefined });
      if (!sent) throw new ServiceUnavailableException('mail_failed');
    } else {
      if (!m.whatsapp) throw new BadRequestException('no_whatsapp');
      url = `https://wa.me/${m.whatsapp}?text=${encodeURIComponent(dto.text)}`;
    }
    await this.prisma.$transaction([
      this.prisma.contactReply.create({ data: { messageId: id, channel: dto.channel, text: dto.text, byId: u.accountId } }),
      this.prisma.contactMessage.update({ where: { id }, data: { status: 'DONE' } }),
    ]);
    await this.audit.log('admin.contact_reply', { actorId: u.accountId, target: id, meta: { channel: dto.channel }, ip });
    return { url };
  }
}

@Module({ controllers: [ContactController, BugReportController, AdminContactController] })
export class ContactModule {}
