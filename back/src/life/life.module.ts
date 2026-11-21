import { LiveModule } from '../live/live.module';
import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsInt, Matches, Max, Min } from 'class-validator';
import type { CeremonyKind } from '@prisma/client';
import { AccountRequired, AuthUser, CurrentUser } from '../common/decorators';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { CharacterService } from '../character/character.service';
import { LifeService, type Equipment } from './life.service';
import { HotelModule } from '../hotel/hotel.module';

const uuid = new ParseUUIDPipe({ version: '4' });
function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

class AnswerDto {
  @IsBoolean()
  pay: boolean;
}
class OrganizeDto {
  @IsIn(['DOT', 'BAPTEME', 'FUNERAILLES', 'ANNIVERSAIRE'])
  kind: CeremonyKind;

  @Matches(/^[a-z0-9_]{2,32}$/)
  venueId: string;

  @IsInt()
  @Min(0)
  @Max(90)
  inDays: number;
}
class AttendDto {
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  gift: number;
}
class EquipDto {
  @IsIn(['generator', 'solar', 'waterTank'])
  kind: Equipment;
}

@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller()
export class LifeController {
  constructor(private readonly svc: LifeService) {}

  @HttpCode(200)
  @Post('health/consult')
  consult(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.svc.consult(u.accountId, idem(key));
  }

  @Get('health/visit')
  visit(@CurrentUser() u: AuthUser) {
    return this.svc.currentVisit(u.accountId);
  }

  @HttpCode(200)
  @Post('health/analyses')
  analyses(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.svc.analyses(u.accountId, idem(key));
  }

  @HttpCode(200)
  @Post('health/treat')
  treat(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.svc.treat(u.accountId, idem(key));
  }

  @Get('family')
  family(@CurrentUser() u: AuthUser) {
    return this.svc.family(u.accountId);
  }

  @HttpCode(200)
  @Post('family/:id/answer')
  answer(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: AnswerDto, @Headers('idempotency-key') key?: string) {
    return this.svc.answerFamily(u.accountId, id, dto.pay, idem(key));
  }

  @Get('ceremonies')
  ceremonies(@CurrentUser() u: AuthUser) {
    return this.svc.ceremonies(u.accountId);
  }

  @AccountRequired()
  @HttpCode(200)
  @Post('ceremonies')
  organize(@CurrentUser() u: AuthUser, @Body() dto: OrganizeDto, @Headers('idempotency-key') key?: string) {
    return this.svc.organize(u.accountId, dto.kind, dto.venueId, dto.inDays, idem(key));
  }

  @AccountRequired()
  @HttpCode(200)
  @Post('ceremonies/:id/attend')
  attend(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: AttendDto, @Headers('idempotency-key') key?: string) {
    return this.svc.attend(u.accountId, id, dto.gift, idem(key));
  }

  @HttpCode(200)
  @Post('ceremonies/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return this.svc.cancelCeremony(u.accountId, id);
  }

  @HttpCode(200)
  @Post('home/equipment')
  equip(@CurrentUser() u: AuthUser, @Body() dto: EquipDto, @Headers('idempotency-key') key?: string) {
    return this.svc.equip(u.accountId, dto.kind, idem(key));
  }

  @Get('economy/events')
  events() {
    return this.svc.events();
  }
}

@Module({ imports: [HotelModule, LiveModule], controllers: [LifeController], providers: [LifeService, CharacterService] })
export class LifeModule {}
