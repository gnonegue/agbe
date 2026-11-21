import { BadRequestException, Body, ConflictException, Controller, Get, Headers, HttpCode, Injectable, Module, NotFoundException, Post } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService, type Tx } from '../ledger/ledger.service';
import { SettingsService, type SettingValue } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { gameTimeAt } from '../economy/clock';
import { applyEffects } from '../economy/needs';
import { enrollBlock, examPassed, type StudyKind } from '../economy/study';
import { sha256Hex } from '../common/crypto';

type StudyCfg = SettingValue<'study'>;

class EnrollDto {
  @IsIn(['BT', 'BTS', 'LICENCE', 'MASTER', 'DOCTORAT'])
  kind: StudyKind;

  @Matches(/^[a-z_]{2,24}$/)
  @IsOptional()
  domain?: string;

  @Matches(/^[a-z0-9]{1,8}$/)
  @IsOptional()
  series?: string;
}
class AttendDto {
  @IsInt()
  @Min(0)
  @Max(3)
  choice: number;
}

function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

/**
 * Études supérieures : bac technique, BTS, licence, master, doctorat. Inscription au lieu d'inscription, puis, année par année,
 * paiement de l'inscription, séances suivies depuis le téléphone (une par jour de jeu) et examen de fin d'année.
 */
@Injectable()
export class StudyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
  ) {}

  /** Leçon d'une séance : on parcourt les leçons du domaine, en repartant d'un décalage différent chaque année. */
  private lesson(cfg: StudyCfg, domain: string, kind: StudyKind, year: number, done: number) {
    const d = cfg.domains.find((x) => x.id === domain);
    if (!d) throw new NotFoundException('unknown_domain');
    const idx = ((year - 1) * cfg.cycles[kind].sessionsPerYear + done) % d.lessons.length;
    return d.lessons[idx]!;
  }

  /** Catalogue, diplômes du joueur et cursus en cours (avec la leçon du jour, sans la réponse). */
  async state(accountId: string) {
    const cfg = await this.settings.get('study');
    const ch = await this.prisma.character.findUnique({ where: { accountId }, include: { diplomas: true, study: true } });
    if (!ch) throw new NotFoundException('no_character');
    const t = gameTimeAt(await this.settings.clock(), Date.now());
    const s = ch.study;
    const cyc = s ? cfg.cycles[s.kind as StudyKind] : null;
    const lesson = s && cyc && s.paid && s.sessionsDone < cyc.sessionsPerYear && s.lastSessionDay !== t.day ? this.lesson(cfg, s.domain, s.kind as StudyKind, s.year, s.sessionsDone) : null;
    return {
      venueId: cfg.venueId,
      domains: cfg.domains.map((d) => ({ id: d.id, emoji: d.emoji, nameFr: d.nameFr, nameEn: d.nameEn })),
      bt: cfg.bt,
      cycles: cfg.cycles,
      minCorrectBp: cfg.minCorrectBp,
      jobReq: cfg.jobReq,
      diplomas: ch.diplomas.map((d) => ({ kind: d.kind, domain: d.domain, series: d.series, obtainedAt: d.obtainedAt })),
      study: s && cyc && {
        kind: s.kind,
        domain: s.domain,
        series: s.series,
        year: s.year,
        years: cyc.years,
        fee: cyc.fee,
        paid: s.paid,
        sessionsDone: s.sessionsDone,
        sessions: cyc.sessionsPerYear,
        correctAnswers: s.correctAnswers,
        attendedToday: s.lastSessionDay === t.day,
        lesson: lesson ? { textFr: lesson.textFr, textEn: lesson.textEn, qFr: lesson.qFr, qEn: lesson.qEn, choicesFr: lesson.choicesFr, choicesEn: lesson.choicesEn } : null,
      },
    };
  }

  private async pay(tx: Tx, c: { id: string; walletId: string }, fee: number, memo: string, key?: string) {
    const idemKey = key ? `study:${c.id}:${key}` : undefined;
    const requestHash = sha256Hex(`study|${memo}`);
    if (idemKey && (await this.ledger.findReplay(tx, idemKey, requestHash))) return true;
    if (fee > 0) await this.ledger.post(tx, { kind: 'STUDY_FEE', idempotencyKey: idemKey, requestHash, memo, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(fee) }] });
    return false;
  }

  /** S'inscrire à un cursus (au lieu d'inscription) : l'inscription de la première année est payée tout de suite. */
  enroll(accountId: string, dto: EnrollDto, key?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const cfg = await this.settings.get('study');
      if (c.locationId !== cfg.venueId) throw new BadRequestException(`go_to_${cfg.venueId}`);
      if (await tx.study.findUnique({ where: { characterId: c.id } })) throw new ConflictException('already_studying');
      let domain = dto.domain;
      let series: string | null = null;
      if (dto.kind === 'BT') {
        const bt = cfg.bt.find((b) => b.series === dto.series);
        if (!bt) throw new NotFoundException('unknown_series');
        domain = bt.domain;
        series = bt.series;
      } else if (!domain || !cfg.domains.some((d) => d.id === domain)) throw new NotFoundException('unknown_domain');
      const diplomas = await tx.diploma.findMany({ where: { characterId: c.id } });
      const block = enrollBlock(dto.kind, domain!, diplomas);
      if (block) throw new BadRequestException(block);
      const replay = await this.pay(tx, c, cfg.cycles[dto.kind].fee, `${dto.kind}:${domain}:1`, key);
      if (replay) return { replay: true };
      await tx.study.create({ data: { characterId: c.id, kind: dto.kind, domain: domain!, series, year: 1, paid: true } });
      return { replay: false, fee: cfg.cycles[dto.kind].fee };
    });
  }

  /** Payer l'inscription de l'année en cours (depuis le téléphone). */
  register(accountId: string, key?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const cfg = await this.settings.get('study');
      const s = await tx.study.findUnique({ where: { characterId: c.id } });
      if (!s) throw new BadRequestException('not_studying');
      if (s.paid) throw new ConflictException('already_paid');
      const fee = cfg.cycles[s.kind as StudyKind].fee;
      const replay = await this.pay(tx, c, fee, `${s.kind}:${s.domain}:${s.year}`, key);
      if (replay) return { replay: true };
      await tx.study.update({ where: { id: s.id }, data: { paid: true } });
      return { replay: false, fee };
    });
  }

  /** Suivre la séance du jour (une par jour de jeu, depuis n'importe où) ; la réponse est corrigée par le serveur. */
  attend(accountId: string, choice: number) {
    return this.chars.act(accountId, async (tx, c) => {
      const cfg = await this.settings.get('study');
      const s = await tx.study.findUnique({ where: { characterId: c.id } });
      if (!s) throw new BadRequestException('not_studying');
      const cyc = cfg.cycles[s.kind as StudyKind];
      if (!s.paid) throw new BadRequestException('fee_unpaid');
      if (s.sessionsDone >= cyc.sessionsPerYear) throw new BadRequestException('exam_due');
      const t = gameTimeAt(await this.settings.clock(), Date.now());
      if (s.lastSessionDay === t.day) throw new BadRequestException('already_attended_today');
      if (c.energy < 10) throw new BadRequestException('too_tired');
      const lesson = this.lesson(cfg, s.domain, s.kind as StudyKind, s.year, s.sessionsDone);
      const correct = choice === lesson.answer;
      await tx.study.update({ where: { id: s.id }, data: { sessionsDone: s.sessionsDone + 1, correctAnswers: s.correctAnswers + (correct ? 1 : 0), lastSessionDay: t.day } });
      const n = applyEffects({ hunger: c.hunger, energy: c.energy, hygiene: c.hygiene, health: c.health, morale: c.morale, respect: c.respect }, { energy: -cfg.sessionEnergy, hunger: -cfg.sessionHunger, morale: correct ? 2 : 0 });
      await tx.character.update({ where: { id: c.id }, data: n });
      return { correct, answer: lesson.answer, session: s.sessionsDone + 1, sessions: cyc.sessionsPerYear };
    });
  }

  /** Examen de fin d'année : réussi, on passe à l'année suivante (ou on est diplômé) ; raté, on redouble. */
  exam(accountId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const cfg = await this.settings.get('study');
      const s = await tx.study.findUnique({ where: { characterId: c.id } });
      if (!s) throw new BadRequestException('not_studying');
      const cyc = cfg.cycles[s.kind as StudyKind];
      if (s.sessionsDone < cyc.sessionsPerYear) throw new BadRequestException('sessions_left');
      const passed = examPassed(s.correctAnswers, cyc.sessionsPerYear, cfg.minCorrectBp);
      if (!passed) {
        // Redoublement : l'année est à refaire (séances à zéro, inscription à repayer)
        await tx.study.update({ where: { id: s.id }, data: { sessionsDone: 0, correctAnswers: 0, paid: false } });
        return { passed: false, graduated: false, year: s.year };
      }
      if (s.year >= cyc.years) {
        await tx.diploma.create({ data: { characterId: c.id, kind: s.kind, domain: s.domain, series: s.series } });
        await tx.study.delete({ where: { id: s.id } });
        await tx.character.update({ where: { id: c.id }, data: applyEffects({ hunger: c.hunger, energy: c.energy, hygiene: c.hygiene, health: c.health, morale: c.morale + 10, respect: c.respect }, { respect: cfg.respectReward[s.kind as StudyKind] }) });
        return { passed: true, graduated: true, kind: s.kind, domain: s.domain };
      }
      await tx.study.update({ where: { id: s.id }, data: { year: s.year + 1, sessionsDone: 0, correctAnswers: 0, paid: false } });
      return { passed: true, graduated: false, year: s.year + 1 };
    });
  }

  /** Abandonner le cursus en cours (les frais déjà payés sont perdus). */
  quit(accountId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const del = await tx.study.deleteMany({ where: { characterId: c.id } });
      if (del.count === 0) throw new BadRequestException('not_studying');
      return { quit: true };
    });
  }
}

@Controller('study')
export class StudyController {
  constructor(private readonly svc: StudyService) {}

  @Get()
  state(@CurrentUser() u: AuthUser) {
    return this.svc.state(u.accountId);
  }

  @HttpCode(200)
  @Post('enroll')
  enroll(@CurrentUser() u: AuthUser, @Body() dto: EnrollDto, @Headers('idempotency-key') key?: string) {
    return this.svc.enroll(u.accountId, dto, idem(key));
  }

  @HttpCode(200)
  @Post('register')
  register(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.svc.register(u.accountId, idem(key));
  }

  @HttpCode(200)
  @Post('attend')
  attend(@CurrentUser() u: AuthUser, @Body() dto: AttendDto) {
    return this.svc.attend(u.accountId, dto.choice);
  }

  @HttpCode(200)
  @Post('exam')
  exam(@CurrentUser() u: AuthUser) {
    return this.svc.exam(u.accountId);
  }

  @HttpCode(200)
  @Post('quit')
  quit(@CurrentUser() u: AuthUser) {
    return this.svc.quit(u.accountId);
  }
}

@Module({ controllers: [StudyController], providers: [StudyService, CharacterService] })
export class StudyModule {}
