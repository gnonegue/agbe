import { BadRequestException, Body, ConflictException, Controller, Get, Headers, HttpCode, Injectable, Module, NotFoundException, Post } from '@nestjs/common';
import { IsInt, IsString, Matches, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { gameTimeAt } from '../economy/clock';
import { applyEffects } from '../economy/needs';
import { sha256Hex } from '../common/crypto';

class CourseDto {
  @IsString()
  @Matches(/^[a-z0-9_]{2,32}$/)
  id: string;
}
class AttendDto extends CourseDto {
  @IsInt()
  @Min(0)
  @Max(3)
  choice: number;
}

/** Minute de la journée de jeu, début et fin du cours (en minutes). */
function classWindow(c: { startHour: number; hours: number }, t: { hour: number; minute: number }) {
  return { now: t.hour * 60 + t.minute, start: c.startHour * 60, end: (c.startHour + c.hours) * 60 };
}

/**
 * Cours du soir et apprentissages : inscription payante (une seule fois), puis chaque jour une séance sur place.
 * On entre en classe pendant le cours (avec un retard toléré), on le suit jusqu'au bout, et la question n'est posée
 * qu'à la fin. Le certificat débloque des métiers.
 */
@Injectable()
export class SchoolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
  ) {}

  private async course(id: string) {
    const c = (await this.settings.get('school.courses')).find((x) => x.id === id);
    if (!c) throw new NotFoundException('unknown_course');
    return c;
  }

  /** Catalogue des cours (sans les réponses) avec l'avancement du joueur et la leçon du jour. */
  async list(accountId: string) {
    const ch = await this.prisma.character.findUnique({ where: { accountId }, include: { enrollments: true } });
    if (!ch) throw new NotFoundException('no_character');
    const t = gameTimeAt(await this.settings.clock(), Date.now());
    const { lateMinutes } = await this.settings.get('school.class');
    return (await this.settings.get('school.courses')).map((c) => {
      const e = ch.enrollments.find((x) => x.courseId === c.id);
      const next = e && !e.completedAt ? c.lessons[e.sessionsDone] : undefined;
      const w = classWindow(c, t);
      return {
        id: c.id,
        venueId: c.venueId,
        emoji: c.emoji,
        nameFr: c.nameFr,
        nameEn: c.nameEn,
        teacher: c.teacher,
        startHour: c.startHour,
        hours: c.hours,
        fee: c.fee,
        unlocks: c.unlocks,
        sessions: c.lessons.length,
        enrolled: !!e,
        sessionsDone: e?.sessionsDone ?? 0,
        correctAnswers: e?.correctAnswers ?? 0,
        completed: !!e?.completedAt,
        attendedToday: e?.lastSessionDay === t.day,
        inSession: w.now >= w.start && w.now < w.end,
        /** Assis en classe aujourd'hui, question pas encore posée : il revient à sa place (ou répond si le cours est fini). */
        seated: !!e && e.classDay === t.day && e.lastSessionDay !== t.day,
        lateMinutes,
        lesson: next ? { textFr: next.textFr, textEn: next.textEn, qFr: next.qFr, qEn: next.qEn, choicesFr: next.choicesFr, choicesEn: next.choicesEn } : null,
      };
    });
  }

  enroll(accountId: string, id: string, idem?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const course = await this.course(id);
      const key = idem ? `enroll:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`enroll|${id}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true };
      if (c.locationId !== course.venueId) throw new BadRequestException(`go_to_${course.venueId}`);
      if (await tx.enrollment.findUnique({ where: { characterId_courseId: { characterId: c.id, courseId: id } } })) throw new ConflictException('already_enrolled');
      if (course.fee > 0) {
        await this.ledger.post(tx, {
          kind: 'SCHOOL_FEE',
          idempotencyKey: key,
          requestHash,
          memo: id,
          legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(course.fee) }],
        });
      }
      await tx.enrollment.create({ data: { characterId: c.id, courseId: id } });
      return { replay: false, fee: course.fee };
    });
  }

  /** Entrer en classe : sur place, pendant le cours et au plus tard `lateMinutes` après le début, une fois par jour. */
  sit(accountId: string, id: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const course = await this.course(id);
      if (c.locationId !== course.venueId) throw new BadRequestException(`go_to_${course.venueId}`);
      const t = gameTimeAt(await this.settings.clock(), Date.now());
      const e = await tx.enrollment.findUnique({ where: { characterId_courseId: { characterId: c.id, courseId: id } } });
      if (!e) throw new BadRequestException('not_enrolled');
      if (e.completedAt) throw new BadRequestException('course_completed');
      if (e.lastSessionDay === t.day) throw new BadRequestException('already_attended_today');
      const w = classWindow(course, t);
      // Déjà assis (retour après être sorti de la salle) : on reprend sa place
      if (e.classDay === t.day) return { endHour: course.startHour + course.hours };
      if (w.now < w.start || w.now >= w.end) throw new BadRequestException('not_class_time');
      if (w.now >= w.start + (await this.settings.get('school.class')).lateMinutes) throw new BadRequestException('class_too_late');
      if (c.energy < 10) throw new BadRequestException('too_tired');
      await tx.enrollment.update({ where: { id: e.id }, data: { classDay: t.day } });
      return { endHour: course.startHour + course.hours };
    });
  }

  /** Question de fin de séance : après avoir suivi le cours jusqu'au bout, sur place ; la réponse est corrigée par le serveur. */
  attend(accountId: string, id: string, choice: number) {
    return this.chars.act(accountId, async (tx, c) => {
      const course = await this.course(id);
      if (c.locationId !== course.venueId) throw new BadRequestException(`go_to_${course.venueId}`);
      const t = gameTimeAt(await this.settings.clock(), Date.now());
      const e = await tx.enrollment.findUnique({ where: { characterId_courseId: { characterId: c.id, courseId: id } } });
      if (!e) throw new BadRequestException('not_enrolled');
      if (e.completedAt) throw new BadRequestException('course_completed');
      if (e.lastSessionDay === t.day) throw new BadRequestException('already_attended_today');
      if (e.classDay !== t.day) throw new BadRequestException('not_seated');
      // Une minute de jeu de marge (≈ 2,5 s) pour l'écart entre l'horloge du téléphone et celle du serveur
      const w = classWindow(course, t);
      if (w.now < w.end - 1) throw new BadRequestException('class_not_over');
      const lesson = course.lessons[e.sessionsDone]!;
      const correct = choice === lesson.answer;
      const done = e.sessionsDone + 1;
      const completed = done >= course.lessons.length;
      await tx.enrollment.update({
        where: { id: e.id },
        data: { sessionsDone: done, correctAnswers: e.correctAnswers + (correct ? 1 : 0), lastSessionDay: t.day, ...(completed ? { completedAt: new Date() } : {}) },
      });
      const n = applyEffects(
        { hunger: c.hunger, energy: c.energy, hygiene: c.hygiene, health: c.health, morale: c.morale, respect: c.respect },
        { energy: -8, hunger: -5, morale: correct ? 3 : 0, respect: (correct ? 1 : 0) + (completed ? 5 : 0) },
      );
      await tx.character.update({ where: { id: c.id }, data: n });
      return { correct, answer: lesson.answer, session: done, sessions: course.lessons.length, completed, unlocks: completed ? course.unlocks : [] };
    });
  }
}

function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

@Controller('school')
export class SchoolController {
  constructor(private readonly svc: SchoolService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.accountId);
  }

  @HttpCode(200)
  @Post('enroll')
  enroll(@CurrentUser() u: AuthUser, @Body() dto: CourseDto, @Headers('idempotency-key') key?: string) {
    return this.svc.enroll(u.accountId, dto.id, idem(key));
  }

  @HttpCode(200)
  @Post('sit')
  sit(@CurrentUser() u: AuthUser, @Body() dto: CourseDto) {
    return this.svc.sit(u.accountId, dto.id);
  }

  @HttpCode(200)
  @Post('attend')
  attend(@CurrentUser() u: AuthUser, @Body() dto: AttendDto) {
    return this.svc.attend(u.accountId, dto.id, dto.choice);
  }
}

@Module({ controllers: [SchoolController], providers: [SchoolService, CharacterService] })
export class SchoolModule {}
