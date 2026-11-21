import { randomInt } from 'node:crypto';
import {
  BadRequestException, Body, ConflictException, Controller, Get, Headers, HttpCode, Inject, Injectable, Logger, Module, NotFoundException, OnModuleDestroy, OnModuleInit, Optional, Param, ParseUUIDPipe, Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { activeCompanyId } from '../company/active';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { ENV, Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { renderTenderAwardedMail, renderTenderPaidMail, renderTenderRejectedMail } from '../mail/mail.templates';
import { LiveModule } from '../live/live.module';
import { LiveService } from '../live/live.service';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { gameHoursBetween, gameTimeAt, realMsAfterGameHours } from '../economy/clock';
import { selectTopCandidates, tenderMinPhysicalHours, tenderRealizationCost, tenderScore } from '../economy/tenders';
import { randomMultiTender, randomTenderContent } from '../economy/tenderContent';
import { sha256Hex } from '../common/crypto';

/** Rythme du traitement périodique : clôture des candidatures, génération automatique. */
const TICK_MS = 30_000;

function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

/**
 * Marchés publics (tenders) : l'État publie un besoin (secteur, places, budget PLAFOND, délai max, nombre de
 * séances de travail nécessaires), les entreprises immatriculées de ce secteur candidatent avec un prix ET un
 * délai de leur choix (≤ plafond/délai max) avant la date limite ; à cette date, les meilleures candidatures
 * sont retenues (score pondéré prix bas + délai court, départage déterministe par ancienneté). Une fois
 * retenu, le joueur doit RÉELLEMENT travailler (`advance()`, comme une séance de travail d'entreprise, débit du
 * coût réel du secteur) jusqu'à accomplir le nombre de séances requis ; le dernier appel qui termine le travail
 * déclenche, dans la même transaction, le paiement du prix QU'IL a proposé (jamais le plafond annoncé).
 * Traitement périodique en mémoire (comme `live.service.ts`) : clôture des candidatures et génération
 * automatique seulement — plus de paiement par échéance de temps (il est déclenché par la fin du travail).
 */
@Injectable()
export class TendersService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Tenders');
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

  private async now() {
    const cfg = await this.settings.clock();
    return { cfg, t: gameTimeAt(cfg, Date.now()) };
  }

  private appUrl(): string {
    return (this.env?.PUBLIC_APP_URL ?? 'https://agbe.tg').replace(/\/$/, '');
  }

  private async myCompany(accountId: string) {
    const ch = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
    if (!ch) throw new NotFoundException('no_character');
    const id = await activeCompanyId(this.prisma, ch.id);
    return id ? this.prisma.company.findUnique({ where: { id } }) : null;
  }

  private async sectorActivity(sector: string) {
    const act = (await this.settings.get('company.activities')).find((a) => a.id === sector);
    if (!act) throw new BadRequestException('unknown_company_activity');
    return act;
  }

  // ───────────── Joueur ─────────────

  /** Marchés ouverts dont le secteur correspond à l'entreprise du joueur courant (immatriculée). */
  async openForMe(accountId: string) {
    const company = await this.myCompany(accountId);
    if (!company || company.status !== 'REGISTERED') return { sector: null, tenders: [] as unknown[] };
    const now = Date.now();
    const tenders = await this.prisma.publicTender.findMany({
      where: { OR: [{ sector: company.activityId }, { sectors: { has: company.activityId } }], status: 'OPEN', applicationDeadlineAt: { gt: new Date(now) } },
      orderBy: { applicationDeadlineAt: 'asc' },
      include: { applications: { where: { companyId: company.id }, select: { id: true } }, _count: { select: { applications: true } } },
    });
    const act = await this.sectorActivity(company.activityId).catch(() => null);
    return {
      sector: company.activityId,
      tenders: tenders.map((t) => ({
        id: t.id,
        sector: t.sector,
        /** Tous les domaines couverts par le marché (le principal d'abord). */
        sectors: [t.sector, ...t.sectors],
        titleFr: t.titleFr,
        titleEn: t.titleEn,
        descriptionFr: t.descriptionFr,
        descriptionEn: t.descriptionEn,
        slots: t.slots,
        maxBudget: t.maxBudget.toString(),
        maxHours: t.maxHours,
        requiredSessions: t.requiredSessions,
        realizationCost: act ? tenderRealizationCost(t.requiredSessions, act.cost).toString() : '0',
        minProposedHours: act ? tenderMinPhysicalHours(t.requiredSessions, act.shiftGameHours) : 0,
        applicationDeadlineAt: t.applicationDeadlineAt.toISOString(),
        applicants: t._count.applications,
        alreadyApplied: t.applications.length > 0,
      })),
    };
  }

  /**
   * Candidature d'une entreprise (une seule par marché) : prix ET délai proposés par le candidat (≤ plafond du
   * marché / délai max, ≥ délai minimum physique dérivé de `requiredSessions`). Le prix payé si retenue puis
   * terminée est celui proposé, jamais le plafond annoncé par le marché.
   */
  async apply(accountId: string, tenderId: string, proposedPrice: number, proposedHours: number, idemKey?: string) {
    const company = await this.myCompany(accountId);
    if (!company) throw new NotFoundException('no_company');
    if (company.status !== 'REGISTERED') throw new BadRequestException('company_not_registered');
    const tender = await this.prisma.publicTender.findUnique({ where: { id: tenderId } });
    if (!tender) throw new NotFoundException('unknown_tender');
    if (tender.status !== 'OPEN' || tender.applicationDeadlineAt.getTime() <= Date.now()) throw new BadRequestException('tender_closed');
    if (tender.sector !== company.activityId && !tender.sectors.includes(company.activityId)) throw new BadRequestException('wrong_sector');
    if (proposedPrice < 1 || BigInt(proposedPrice) > tender.maxBudget) throw new BadRequestException('over_budget');
    // Le coût et la durée d'une séance sont ceux du domaine de l'entreprise qui candidate
    const act = await this.sectorActivity(company.activityId);
    const minHours = tenderMinPhysicalHours(tender.requiredSessions, act.shiftGameHours);
    if (proposedHours < minHours) throw new BadRequestException('under_min_hours');
    if (proposedHours > tender.maxHours) throw new BadRequestException('over_delay');

    const existing = await this.prisma.tenderApplication.findUnique({ where: { tenderId_companyId: { tenderId, companyId: company.id } } });
    if (existing) {
      // Rejeu idempotent : même candidature exacte → on renvoie le résultat déjà enregistré sans en créer une seconde.
      if (idemKey && existing.proposedHours === proposedHours && existing.proposedPrice === BigInt(proposedPrice)) return { id: existing.id, replay: true };
      throw new ConflictException('already_applied');
    }
    const app = await this.prisma.tenderApplication.create({
      data: { tenderId, companyId: company.id, proposedPrice: BigInt(proposedPrice), proposedHours },
    });
    return { id: app.id, replay: false };
  }

  /** Mes candidatures (en attente, retenues en cours de travail, terminées payées, rejetées). */
  async myApplications(accountId: string) {
    const company = await this.myCompany(accountId);
    if (!company) return [];
    const apps = await this.prisma.tenderApplication.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: 'desc' },
      include: { tender: true, company: { select: { activityId: true } } },
    });
    const activities = await this.settings.get('company.activities');
    return apps.map((a) => {
      const act = activities.find((x) => x.id === a.company.activityId);
      return {
        id: a.id,
        tenderId: a.tenderId,
        sector: a.company.activityId,
        sectors: [a.tender.sector, ...a.tender.sectors],
        titleFr: a.tender.titleFr,
        titleEn: a.tender.titleEn,
        descriptionFr: a.tender.descriptionFr,
        descriptionEn: a.tender.descriptionEn,
        status: a.status,
        maxBudget: a.tender.maxBudget.toString(),
        proposedPrice: a.proposedPrice.toString(),
        proposedHours: a.proposedHours,
        tenderStatus: a.tender.status,
        sessionsCompleted: a.sessionsCompleted,
        sessionsRequired: a.tender.requiredSessions,
        realizationCost: act ? tenderRealizationCost(a.tender.requiredSessions, act.cost).toString() : '0',
        sessionCost: act ? act.cost : 0,
        shiftGameHours: act ? act.shiftGameHours : 0,
        startedAt: a.startedAt?.toISOString() ?? null,
        endsAt: a.endsAt?.toISOString() ?? null,
        lastAdvancedAt: a.lastAdvancedAt?.toISOString() ?? null,
        paidAt: a.paidAt?.toISOString() ?? null,
      };
    });
  }

  /**
   * Action de gameplay réelle : avance le travail d'une candidature retenue (comme une séance de travail
   * d'entreprise). Débite le coût réel de la séance (`company.activities[sector].cost`) du joueur vers le
   * portefeuille système MARKET ; si cette séance termine le nombre requis, paie dans la MÊME transaction le
   * prix proposé (jamais le plafond) du portefeuille TREASURY vers le joueur, et clôture la candidature (PAID).
   * Cadence : rejouable seulement après `shiftGameHours` d'heures de jeu depuis le dernier appel (ou depuis la
   * sélection pour le premier), comme une séance de travail classique.
   */
  advance(accountId: string, applicationId: string, idemKey?: string) {
    return this.chars
      .act(accountId, async (tx, c) => {
        const app = await tx.tenderApplication.findUnique({ where: { id: applicationId }, include: { tender: true, company: { select: { characterId: true, name: true, activityId: true } } } });
        if (!app) throw new NotFoundException('unknown_application');
        if (app.company.characterId !== c.id) throw new NotFoundException('unknown_application');
        if (app.status !== 'SELECTED') throw new BadRequestException('application_not_selected');

        const activities = await this.settings.get('company.activities');
        const act = activities.find((x) => x.id === app.company.activityId);
        if (!act) throw new BadRequestException('unknown_company_activity');

        const clock = await this.settings.clock();
        const last = app.lastAdvancedAt ?? app.startedAt;
        if (last && gameHoursBetween(clock, last.getTime(), Date.now()) < act.shiftGameHours) throw new BadRequestException('still_working');

        const costKey = idemKey ? `tender-advance-cost:${app.id}:${idemKey}` : undefined;
        const costHash = idemKey ? sha256Hex(`tender-advance-cost|${app.id}|${idemKey}`) : undefined;
        const costRes = await this.ledger.post(tx, {
          kind: 'TENDER_WORK_COST',
          idempotencyKey: costKey,
          requestHash: costHash,
          memo: app.tenderId,
          legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(act.cost) }],
        });
        if (costRes.replay) {
          const current = await tx.tenderApplication.findUniqueOrThrow({ where: { id: app.id } });
          return { id: app.id, sessionsCompleted: current.sessionsCompleted, sessionsRequired: app.tender.requiredSessions, paid: current.status === 'PAID', replay: true, notify: null as null };
        }

        const sessionsCompleted = app.sessionsCompleted + 1;
        const now = new Date();
        if (sessionsCompleted >= app.tender.requiredSessions) {
          await this.ledger.post(tx, {
            kind: 'TENDER_PAYOUT',
            idempotencyKey: `tender_payout:${app.id}`,
            requestHash: sha256Hex(`tender_payout|${app.id}`),
            memo: app.tenderId,
            legs: [{ from: await this.ledger.systemWalletId(tx, 'TREASURY'), to: c.walletId, amount: app.proposedPrice }],
          });
          await tx.tenderApplication.update({ where: { id: app.id }, data: { sessionsCompleted, lastAdvancedAt: now, status: 'PAID', paidAt: now } });
          return {
            id: app.id,
            sessionsCompleted,
            sessionsRequired: app.tender.requiredSessions,
            paid: true,
            replay: false,
            notify: { characterId: c.id, name: app.company.name, sector: app.company.activityId, amount: app.proposedPrice.toString() },
          };
        }
        await tx.tenderApplication.update({ where: { id: app.id }, data: { sessionsCompleted, lastAdvancedAt: now } });
        return { id: app.id, sessionsCompleted, sessionsRequired: app.tender.requiredSessions, paid: false, replay: false, notify: null as null };
      })
      .then(async (r) => {
        if (r.result.notify) await this.notifyOutcome(r.result.notify, 'paid', { sector: r.result.notify.sector, amount: r.result.notify.amount });
        return r;
      });
  }

  // ───────────── Admin ─────────────

  async adminList() {
    const tenders = await this.prisma.publicTender.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { _count: { select: { applications: true } } } });
    return tenders.map((t) => ({
      id: t.id,
      sector: t.sector,
      sectors: t.sectors,
      titleFr: t.titleFr,
      titleEn: t.titleEn,
      descriptionFr: t.descriptionFr,
      descriptionEn: t.descriptionEn,
      slots: t.slots,
      maxBudget: t.maxBudget.toString(),
      maxHours: t.maxHours,
      requiredSessions: t.requiredSessions,
      status: t.status,
      applicationDeadlineAt: t.applicationDeadlineAt.toISOString(),
      createdByAdminId: t.createdByAdminId,
      applicants: t._count.applications,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  async adminApplications(tenderId: string) {
    const apps = await this.prisma.tenderApplication.findMany({
      where: { tenderId },
      orderBy: { score: 'desc' },
      include: { company: { select: { name: true, activityId: true } }, tender: { select: { titleFr: true, titleEn: true, descriptionFr: true, descriptionEn: true, maxBudget: true, requiredSessions: true } } },
    });
    return apps.map((a) => ({
      id: a.id,
      company: a.company.name,
      sector: a.company.activityId,
      titleFr: a.tender.titleFr,
      titleEn: a.tender.titleEn,
      descriptionFr: a.tender.descriptionFr,
      descriptionEn: a.tender.descriptionEn,
      maxBudget: a.tender.maxBudget.toString(),
      proposedPrice: a.proposedPrice.toString(),
      proposedHours: a.proposedHours,
      status: a.status,
      score: a.score,
      sessionsCompleted: a.sessionsCompleted,
      sessionsRequired: a.tender.requiredSessions,
      startedAt: a.startedAt?.toISOString() ?? null,
      endsAt: a.endsAt?.toISOString() ?? null,
      paidAt: a.paidAt?.toISOString() ?? null,
    }));
  }

  async adminCreate(
    adminId: string,
    input: { sector: string; sectors?: string[]; titleFr: string; titleEn: string; descriptionFr: string; descriptionEn: string; slots: number; maxBudget: number; maxHours: number; requiredSessions: number; applicationWindowGameHours: number },
    idemKey?: string,
  ) {
    if (idemKey) {
      const existing = await this.prisma.publicTender.findUnique({ where: { idempotencyKey: idemKey } });
      if (existing) return { id: existing.id, replay: true };
    }
    const activities = await this.settings.get('company.activities');
    const extra = [...new Set(input.sectors ?? [])].filter((x) => x !== input.sector);
    if (![input.sector, ...extra].every((id) => activities.some((a) => a.id === id))) throw new BadRequestException('unknown_company_activity');
    const { cfg } = await this.now();
    const deadline = new Date(Math.ceil(realMsAfterGameHours(cfg, Date.now(), input.applicationWindowGameHours)));
    const t = await this.prisma.publicTender.create({
      data: {
        sector: input.sector,
        sectors: extra,
        titleFr: input.titleFr,
        titleEn: input.titleEn,
        descriptionFr: input.descriptionFr,
        descriptionEn: input.descriptionEn,
        slots: input.slots,
        maxBudget: BigInt(input.maxBudget),
        maxHours: input.maxHours,
        requiredSessions: input.requiredSessions,
        applicationDeadlineAt: deadline,
        createdByAdminId: adminId,
        idempotencyKey: idemKey,
      },
    });
    return { id: t.id, replay: false };
  }

  /** Annulation : seulement avant attribution (OPEN) — personne n'est payé, les candidatures en attente sont rejetées. */
  async adminCancel(tenderId: string) {
    const t = await this.prisma.publicTender.findUnique({ where: { id: tenderId } });
    if (!t) throw new NotFoundException('unknown_tender');
    if (t.status !== 'OPEN') throw new BadRequestException('tender_not_open');
    await this.prisma.$transaction([
      this.prisma.publicTender.update({ where: { id: tenderId }, data: { status: 'CANCELLED' } }),
      this.prisma.tenderApplication.updateMany({ where: { tenderId, status: 'PENDING' }, data: { status: 'REJECTED' } }),
    ]);
    return { id: tenderId, cancelled: true };
  }

  // ───────────── Traitement périodique ─────────────

  /** Un seul passage du traitement périodique : clôture, génération automatique. Appelable directement par les tests. */
  async tick(): Promise<void> {
    try {
      await this.closeExpired();
    } catch (e) {
      this.log.warn(`clôture : ${(e as Error).message}`);
    }
    try {
      await this.autoGenerate();
    } catch (e) {
      this.log.warn(`génération : ${(e as Error).message}`);
    }
  }

  /** Clôture les candidatures des marchés dont la date limite est passée : sélection des meilleures, notification. */
  async closeExpired(): Promise<void> {
    const due = await this.prisma.publicTender.findMany({
      where: { status: 'OPEN', applicationDeadlineAt: { lte: new Date() } },
      include: { applications: { where: { status: 'PENDING' }, include: { company: { select: { id: true, name: true, activityId: true, characterId: true } } } } },
    });
    if (due.length === 0) return;
    const cfg = await this.settings.clock();
    const weights = (await this.settings.get('market.tenders')).scoreWeightsBp;
    for (const t of due) {
      const scored = t.applications.map((a) => ({
        id: a.id,
        score: tenderScore({ proposedPrice: a.proposedPrice, proposedHours: a.proposedHours }, t.maxBudget, t.maxHours, weights),
        createdAtMs: a.createdAt.getTime(),
        app: a,
      }));
      const { selected, rejected } = selectTopCandidates(scored, t.slots);
      const now = Date.now();
      await this.prisma.$transaction(async (tx) => {
        for (const s of selected) {
          const endsAt = new Date(Math.ceil(realMsAfterGameHours(cfg, now, s.app.proposedHours)));
          await tx.tenderApplication.update({ where: { id: s.id }, data: { status: 'SELECTED', score: s.score, startedAt: new Date(now), endsAt, lastAdvancedAt: new Date(now) } });
        }
        for (const r of rejected) {
          await tx.tenderApplication.update({ where: { id: r.id }, data: { status: 'REJECTED', score: r.score } });
        }
        await tx.publicTender.update({ where: { id: t.id }, data: { status: 'AWARDED' } });
      });
      for (const s of selected) await this.notifyOutcome(s.app.company, 'awarded', { sector: s.app.company.activityId, amount: s.app.proposedPrice.toString(), hours: s.app.proposedHours });
      for (const r of rejected) await this.notifyOutcome(r.app.company, 'rejected', { sector: r.app.company.activityId, amount: '0' });
    }
  }

  /** Génère un marché système si la génération automatique est activée et que la cadence réglée est écoulée. */
  async autoGenerate(): Promise<void> {
    const cfgTenders = await this.settings.get('market.tenders');
    if (!cfgTenders.autoGenerate || cfgTenders.sectors.length === 0) return;
    const clock = await this.settings.clock();
    const last = await this.prisma.publicTender.findFirst({ where: { createdByAdminId: null }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    if (last) {
      const gameHoursElapsed = gameHoursBetween(clock, last.createdAt.getTime(), Date.now());
      if (gameHoursElapsed < cfgTenders.cadenceGameHours) return;
    }
    // Tous les domaines du jeu (ceux du réglage et toute activité ajoutée depuis) : aucune entreprise ne reste sans marché
    const activityIds = (await this.settings.get('company.activities')).map((a) => a.id);
    const all = [...new Set([...cfgTenders.sectors, ...activityIds])].filter((id) => activityIds.includes(id));
    // Une part des marchés couvre plusieurs domaines à la fois
    const multi = randomInt(10_000) < cfgTenders.multiSectorChanceBp ? randomMultiTender(activityIds) : null;
    const sector = multi ? multi.sectors[0]! : all[randomInt(all.length)]!;
    const slots = randomInt(cfgTenders.slotsRange[0], cfgTenders.slotsRange[1] + 1);
    const maxBudget = randomInt(cfgTenders.budgetRange[0], cfgTenders.budgetRange[1] + 1);
    const maxHours = randomInt(cfgTenders.maxHoursRange[0], cfgTenders.maxHoursRange[1] + 1);
    const requiredSessions = randomInt(cfgTenders.sessionsRange[0], cfgTenders.sessionsRange[1] + 1);
    const deadline = new Date(Math.ceil(realMsAfterGameHours(clock, Date.now(), cfgTenders.applicationWindowGameHours)));
    const content = multi ? multi.content : randomTenderContent(sector);
    await this.prisma.publicTender.create({
      data: {
        sector,
        sectors: multi ? multi.sectors.slice(1) : [],
        titleFr: content.titleFr,
        titleEn: content.titleEn,
        descriptionFr: content.descriptionFr,
        descriptionEn: content.descriptionEn,
        slots,
        maxBudget: BigInt(maxBudget),
        maxHours,
        requiredSessions,
        applicationDeadlineAt: deadline,
        createdByAdminId: null,
      },
    });
  }

  private async notifyOutcome(company: { name: string; characterId: string }, kind: 'awarded' | 'rejected' | 'paid', data: { sector: string; amount: string; hours?: number }): Promise<void> {
    try {
      this.live?.notifyCharacter(company.characterId, `tender_${kind}`, { company: company.name, sector: data.sector, amount: data.amount, hours: data.hours ?? 0 });
      if (!this.mail) return;
      const ch = await this.prisma.character.findUnique({ where: { id: company.characterId }, select: { account: { select: { email: true, locale: true, username: true } } } });
      if (!ch?.account.email) return;
      const locale = ch.account.locale === 'en' ? 'en' : 'fr';
      const vars = { locale, name: ch.account.username, company: company.name, sector: data.sector, amount: data.amount, hours: data.hours, appUrl: this.appUrl() } as const;
      const mail = kind === 'awarded' ? renderTenderAwardedMail(vars) : kind === 'rejected' ? renderTenderRejectedMail(vars) : renderTenderPaidMail(vars);
      await this.mail.send({ to: ch.account.email, ...mail });
    } catch (e) {
      this.log.warn(`notification : ${(e as Error).message}`);
    }
  }
}

// ───────────── DTOs ─────────────

class ApplyDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  proposedPrice: number;

  @IsInt()
  @Min(1)
  @Max(2000)
  proposedHours: number;
}

const SECTOR_RE = /^[a-z0-9_]{2,32}$/;

class AdminCreateTenderDto {
  @Matches(SECTOR_RE)
  sector: string;

  /** Autres domaines couverts par le même marché (facultatif). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @Matches(SECTOR_RE, { each: true })
  sectors?: string[];

  @IsString()
  @Length(2, 160)
  titleFr: string;

  @IsString()
  @Length(2, 160)
  titleEn: string;

  @IsString()
  @Length(2, 600)
  descriptionFr: string;

  @IsString()
  @Length(2, 600)
  descriptionEn: string;

  @IsInt()
  @Min(1)
  @Max(50)
  slots: number;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  maxBudget: number;

  @IsInt()
  @Min(1)
  @Max(2000)
  maxHours: number;

  @IsInt()
  @Min(1)
  @Max(200)
  requiredSessions: number;

  @IsInt()
  @Min(1)
  @Max(500)
  applicationWindowGameHours: number;
}

@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('tenders')
export class TendersController {
  constructor(private readonly svc: TendersService) {}

  @Get()
  open(@CurrentUser() u: AuthUser) {
    return this.svc.openForMe(u.accountId);
  }

  @Get('mine')
  mine(@CurrentUser() u: AuthUser) {
    return this.svc.myApplications(u.accountId);
  }

  @HttpCode(200)
  @Post(':id/apply')
  apply(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: ApplyDto, @Headers('idempotency-key') key?: string) {
    return this.svc.apply(u.accountId, id, dto.proposedPrice, dto.proposedHours, idem(key));
  }

  /** Avance le travail d'une candidature retenue (séance de travail réelle, débit du coût, paiement si terminée). */
  @HttpCode(200)
  @Post('applications/:id/advance')
  advance(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Headers('idempotency-key') key?: string) {
    return this.svc.advance(u.accountId, id, idem(key));
  }
}

/** Back-office : publication manuelle d'un marché, liste de tous les marchés et de leurs candidatures, annulation. */
@Roles('ADMIN')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/tenders')
export class AdminTendersController {
  constructor(private readonly svc: TendersService) {}

  @Get()
  list() {
    return this.svc.adminList();
  }

  @Get(':id/applications')
  applications(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.svc.adminApplications(id);
  }

  @HttpCode(200)
  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: AdminCreateTenderDto, @Headers('idempotency-key') key?: string) {
    return this.svc.adminCreate(u.accountId, dto, idem(key));
  }

  @HttpCode(200)
  @Post(':id/cancel')
  cancel(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.svc.adminCancel(id);
  }
}

@Module({ imports: [LiveModule], controllers: [TendersController, AdminTendersController], providers: [TendersService, CharacterService] })
export class TendersModule {}
