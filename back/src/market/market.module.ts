import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Module, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsUUID, Matches, Max, Min } from 'class-validator';
import { AccountRequired, AuthUser, CurrentUser } from '../common/decorators';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { CharacterService } from '../character/character.service';
import { MarketService } from './market.service';

const GOOD = /^[a-z0-9_]{2,32}$/;

class RentDto {
  @IsInt()
  @Min(1)
  @Max(52)
  weeks: number;
}
class GoodQtyDto {
  @Matches(GOOD)
  goodId: string;

  @IsInt()
  @Min(1)
  @Max(100_000)
  qty: number;
}
class PriceDto {
  @Matches(GOOD)
  goodId: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  price: number;
}
class BuyDto extends GoodQtyDto {
  @IsUUID('4')
  stallId: string;
}
class UseDto {
  @Matches(GOOD)
  goodId: string;
}

function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

@Throttle({ default: { limit: 90, ttl: 60_000 } })
@Controller('market')
export class MarketController {
  constructor(private readonly svc: MarketService) {}

  @Get()
  mine(@CurrentUser() u: AuthUser) {
    return this.svc.mine(u.accountId);
  }

  @Get('stalls')
  stalls(@CurrentUser() u: AuthUser) {
    return this.svc.stalls(u.accountId);
  }

  @AccountRequired()
  @HttpCode(200)
  @Post('stall')
  rent(@CurrentUser() u: AuthUser, @Body() dto: RentDto, @Headers('idempotency-key') key?: string) {
    return this.svc.rent(u.accountId, dto.weeks, idem(key));
  }

  @AccountRequired()
  @HttpCode(200)
  @Post('wholesale')
  wholesale(@CurrentUser() u: AuthUser, @Body() dto: GoodQtyDto, @Headers('idempotency-key') key?: string) {
    return this.svc.wholesale(u.accountId, dto.goodId, dto.qty, idem(key));
  }

  @AccountRequired()
  @HttpCode(200)
  @Post('price')
  price(@CurrentUser() u: AuthUser, @Body() dto: PriceDto) {
    return this.svc.setPrice(u.accountId, dto.goodId, dto.price);
  }

  @AccountRequired()
  @HttpCode(200)
  @Post('withdraw')
  withdraw(@CurrentUser() u: AuthUser, @Body() dto: GoodQtyDto) {
    return this.svc.withdraw(u.accountId, dto.goodId, dto.qty);
  }

  @AccountRequired()
  @HttpCode(200)
  @Post('buy')
  buy(@CurrentUser() u: AuthUser, @Body() dto: BuyDto, @Headers('idempotency-key') key?: string) {
    return this.svc.buy(u.accountId, dto.stallId, dto.goodId, dto.qty, idem(key));
  }

  @HttpCode(200)
  @Post('use')
  use(@CurrentUser() u: AuthUser, @Body() dto: UseDto) {
    return this.svc.use(u.accountId, dto.goodId);
  }
}

@Module({ controllers: [MarketController], providers: [MarketService, CharacterService], exports: [MarketService] })
export class MarketModule {}
