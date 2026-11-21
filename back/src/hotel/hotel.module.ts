import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Module, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsInt, Matches, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { CharacterService } from '../character/character.service';
import { HotelService } from './hotel.service';

function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

class BookDto {
  @Matches(/^[a-z_]{2,24}$/)
  roomType: string;

  @IsInt()
  @Min(1)
  @Max(60)
  nights: number;
}
class OrderDto {
  @Matches(/^[a-z0-9_]{2,32}$/)
  itemId: string;
}
class HallDto {
  @Matches(/^[a-z_]{2,24}$/)
  hallId: string;

  @IsInt()
  @Min(0)
  @Max(30)
  inDays: number;
}

@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('hotel')
export class HotelController {
  constructor(private readonly svc: HotelService) {}

  @Get()
  view(@CurrentUser() u: AuthUser) {
    return this.svc.view(u.accountId);
  }

  @HttpCode(200)
  @Post('book')
  book(@CurrentUser() u: AuthUser, @Body() dto: BookDto, @Headers('idempotency-key') key?: string) {
    return this.svc.book(u.accountId, dto.roomType, dto.nights, idem(key));
  }

  @HttpCode(200)
  @Post('checkout')
  checkout(@CurrentUser() u: AuthUser) {
    return this.svc.checkout(u.accountId);
  }

  @HttpCode(200)
  @Post('order')
  order(@CurrentUser() u: AuthUser, @Body() dto: OrderDto, @Headers('idempotency-key') key?: string) {
    return this.svc.order(u.accountId, dto.itemId, idem(key));
  }

  @HttpCode(200)
  @Post('hall')
  hall(@CurrentUser() u: AuthUser, @Body() dto: HallDto, @Headers('idempotency-key') key?: string) {
    return this.svc.bookHall(u.accountId, dto.hallId, dto.inDays, idem(key));
  }
}

@Module({ controllers: [HotelController], providers: [HotelService, CharacterService], exports: [HotelService] })
export class HotelModule {}
