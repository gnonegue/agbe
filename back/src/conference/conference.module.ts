import { BadRequestException, Controller, Get, Headers, HttpCode, Injectable, Logger, Module, NotFoundException, OnModuleDestroy, OnModuleInit, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { gameTimeAt } from '../economy/clock';
import { applyEffects } from '../economy/needs';
import { conferenceIndex, nextConferences } from '../economy/conference';
import { sha256Hex } from '../common/crypto';
import { LiveModule } from '../live/live.module';
import { LiveService } from '../live/live.service';

/** Vérification de l'annonce aux joueurs connectés (secondes réelles ≈ 1 minute de jeu au rythme par défaut). */
const ANNOUNCE_TICK_MS = 20_000;

/**
 * Conférences publiques programmées : une tous les quelques jours de jeu, à heure fixe, sur un sujet qui change.
 * On paie l'entrée en s'asseyant (à l'heure, avec un retard toléré), on reste jusqu'à la fin, puis on reçoit
 * moral et respect. La ville est prévenue 1 h avant et au début.
 */
@Injectable()
export class ConferenceService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Conference');
  private timer: NodeJS.Timeout | null = null;
  /** Annonces déjà faites (jour:moment) ; en mémoire : un redémarrage peut au pire répéter une annonce. */
  private readonly announced = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
    private readonly live: LiveService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.announceTick(), ANNOUNCE_TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async now() {
    const t = gameTimeAt(await this.settings.clock(), Date.now());
    return { t, minute: t.hour * 60 + t.minute };
  }

  /** Conférence du jour (sujet compris) ou null. */
  private async today(day: number) {
    const cfg = await this.settings.get('conference');
    const i = conferenceIndex(day, cfg);
    return i === null ? null : { cfg, topic: cfg.topics[i % cfg.topics.length]! };
  }

  /** Prochaines conférences, et la place du joueur à celle du jour. */
  async list(accountId: string) {
    const c = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
    if (!c) throw new NotFoundException('no_character');
    const cfg = await this.settings.get('conference');
    const { t, minute } = await this.now();
    const seat = await this.prisma.conferenceSeat.findUnique({ where: { characterId_day: { characterId: c.id, day: t.day } } });
    const start = cfg.startHour * 60;
    return {
      venueId: cfg.venueId,
      startHour: cfg.startHour,
      hours: cfg.hours,
      fee: cfg.fee,
      lateMinutes: cfg.lateMinutes,
      day: t.day,
      upcoming: nextConferences(t.day, minute, cfg, 3).map((x) => {
        const topic = cfg.topics[x.index % cfg.topics.length]!;
        const isToday = x.day === t.day;
        return {
          day: x.day,
          ...topic,
          inSession: isToday && minute >= start && minute < start + cfg.hours * 60,
          seated: isToday && !!seat && !seat.rewarded,
          done: isToday && !!seat?.rewarded,
        };
      }),
    };
  }

  /** Entrer : sur place, pendant la conférence et au plus tard `lateMinutes` après le début ; l'entrée est payée ici. */
  sit(accountId: string, idem?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const { t, minute } = await this.now();
      const conf = await this.today(t.day);
      if (!conf) throw new BadRequestException('no_conference_today');
      const { cfg, topic } = conf;
      if (c.locationId !== cfg.venueId) throw new BadRequestException(`go_to_${cfg.venueId}`);
      const seat = await tx.conferenceSeat.findUnique({ where: { characterId_day: { characterId: c.id, day: t.day } } });
      // Déjà entré (retour après être sorti) : la place est gardée, rien n'est payé deux fois
      if (seat) {
        if (seat.rewarded) throw new BadRequestException('conference_done');
        return { endHour: cfg.startHour + cfg.hours, fee: 0 };
      }
      const start = cfg.startHour * 60;
      if (minute < start || minute >= start + cfg.hours * 60) throw new BadRequestException('not_conference_time');
      if (minute >= start + cfg.lateMinutes) throw new BadRequestException('conference_too_late');
      if (c.energy < cfg.energy) throw new BadRequestException('too_tired');
      const key = idem ? `conference:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`conference|${t.day}`);
      if (cfg.fee > 0) {
        await this.ledger.post(tx, {
          kind: 'CONFERENCE_FEE',
          idempotencyKey: key,
          requestHash,
          memo: topic.id,
          legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(cfg.fee) }],
        });
      }
      await tx.conferenceSeat.create({ data: { characterId: c.id, day: t.day, topicId: topic.id } });
      return { endHour: cfg.startHour + cfg.hours, fee: cfg.fee };
    });
  }

  /** Fin de la conférence : resté jusqu'au bout, sur place, on gagne moral et respect (une fois). */
  finish(accountId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const { t, minute } = await this.now();
      const conf = await this.today(t.day);
      if (!conf) throw new BadRequestException('no_conference_today');
      const { cfg } = conf;
      if (c.locationId !== cfg.venueId) throw new BadRequestException(`go_to_${cfg.venueId}`);
      const seat = await tx.conferenceSeat.findUnique({ where: { characterId_day: { characterId: c.id, day: t.day } } });
      if (!seat) throw new BadRequestException('not_seated');
      if (seat.rewarded) throw new BadRequestException('conference_done');
      // Une minute de jeu de marge pour l'écart entre l'horloge du téléphone et celle du serveur
      if (minute < (cfg.startHour + cfg.hours) * 60 - 1) throw new BadRequestException('conference_not_over');
      // Garde contre un double appel simultané : seule la première mise à jour compte
      const r = await tx.conferenceSeat.updateMany({ where: { id: seat.id, rewarded: false }, data: { rewarded: true } });
      if (r.count === 0) throw new BadRequestException('conference_done');
      const n = applyEffects(
        { hunger: c.hunger, energy: c.energy, hygiene: c.hygiene, health: c.health, morale: c.morale, respect: c.respect },
        { morale: cfg.morale, respect: cfg.respect, energy: -cfg.energy },
      );
      await tx.character.update({ where: { id: c.id }, data: n });
      return { morale: cfg.morale, respect: cfg.respect };
    });
  }

  /** Prévient la ville du lieu de la conférence : 1 h avant, puis au début (pendant le retard toléré). */
  async announceTick(): Promise<void> {
    try {
      const { t, minute } = await this.now();
      const conf = await this.today(t.day);
      if (!conf) return;
      const { cfg, topic } = conf;
      const start = cfg.startHour * 60;
      const when = minute >= start - 60 && minute < start ? 'soon' : minute >= start && minute < start + cfg.lateMinutes ? 'now' : null;
      if (!when || this.announced.has(`${t.day}:${when}`)) return;
      this.announced.add(`${t.day}:${when}`);
      if (this.announced.size > 20) this.announced.delete(this.announced.values().next().value!);
      const venue = await this.prisma.venue.findUnique({ where: { id: cfg.venueId }, select: { city: true } });
      if (!venue) return;
      this.live.announce(venue.city, 'conference', { when, emoji: topic.emoji, titleFr: topic.titleFr, titleEn: topic.titleEn, speaker: topic.speaker, venueId: cfg.venueId, hour: cfg.startHour });
    } catch (e) {
      this.log.warn(`annonce : ${(e as Error).message}`);
    }
  }
}

function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

@Controller('conference')
export class ConferenceController {
  constructor(private readonly svc: ConferenceService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.accountId);
  }

  @HttpCode(200)
  @Post('sit')
  sit(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.svc.sit(u.accountId, idem(key));
  }

  @HttpCode(200)
  @Post('finish')
  finish(@CurrentUser() u: AuthUser) {
    return this.svc.finish(u.accountId);
  }
}

@Module({ imports: [LiveModule], controllers: [ConferenceController], providers: [ConferenceService, CharacterService] })
export class ConferenceModule {}
