import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ClientIp, Public } from '../common/decorators';
import { CookieCsrfGuard } from '../auth/auth.controller';
import { InitDto } from './init.dto';
import { InitService } from './init.service';

@Controller('init')
export class InitController {
  constructor(private readonly init: InitService) {}

  /** La page /init s'affiche-t-elle ? (activée par INIT_SECRET, et pas encore faite) */
  @Public()
  @Get()
  status() {
    return this.init.status();
  }

  @Public()
  @Post()
  @HttpCode(200)
  @UseGuards(CookieCsrfGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  run(@Body() dto: InitDto, @ClientIp() ip: string) {
    return this.init.run(dto, ip);
  }
}
