import { LiveModule } from '../live/live.module';
import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsInt, Matches, Max, Min } from 'class-validator';
import { AccountRequired, AuthUser, CurrentUser } from '../common/decorators';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { CharacterService } from '../character/character.service';
import { TontineService } from './tontine.service';

class CreateTontineDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value))
  @Matches(/^[\p{L}\p{N}][\p{L}\p{N} '&.\-]{1,39}$/u, { message: 'invalid_tontine_name' })
  name: string;

  @IsInt()
  @Min(1)
  @Max(100_000_000)
  contribution: number;

  @IsInt()
  @Min(1)
  @Max(90)
  periodDays: number;

  @IsInt()
  @Min(2)
  @Max(50)
  maxMembers: number;
}

const uuid = new ParseUUIDPipe({ version: '4' });

function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

@AccountRequired()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('tontines')
export class TontineController {
  constructor(private readonly svc: TontineService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.accountId);
  }

  @HttpCode(200)
  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateTontineDto) {
    return this.svc.create(u.accountId, dto);
  }

  @HttpCode(200)
  @Post(':id/join')
  join(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return this.svc.join(u.accountId, id);
  }

  @HttpCode(200)
  @Post(':id/leave')
  leave(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return this.svc.leave(u.accountId, id);
  }

  @HttpCode(200)
  @Post(':id/start')
  start(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return this.svc.start(u.accountId, id);
  }

  @HttpCode(200)
  @Post(':id/pay')
  pay(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Headers('idempotency-key') key?: string) {
    return this.svc.pay(u.accountId, id, idem(key));
  }

  @HttpCode(200)
  @Post(':id/collect')
  collect(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return this.svc.collect(u.accountId, id);
  }
}

@Module({ imports: [LiveModule], controllers: [TontineController], providers: [TontineService, CharacterService] })
export class TontineModule {}
