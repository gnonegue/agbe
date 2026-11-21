import { Controller, Get, Module, Req } from '@nestjs/common';
import type { Request } from 'express';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { PrismaModule, PrismaService } from './prisma/prisma.service';
import { AuditModule } from './common/audit.service';
import { SettingsModule } from './settings/settings.service';
import { LedgerModule } from './ledger/ledger.service';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.service';
import { AccountModule } from './account/account.controller';
import { CharacterModule } from './character/character.controller';
import { CompanyModule } from './company/company.controller';
import { ContactModule } from './contact/contact.module';
import { PartnersModule } from './partners/partners.module';
import { SchoolModule } from './school/school.module';
import { ConferenceModule } from './conference/conference.module';
import { TradeModule } from './trade/trade.module';
import { LandModule } from './land/land.module';
import { KitchenModule } from './kitchen/kitchen.module';
import { HomeModule } from './home/home.module';
import { ClothesModule } from './clothes/clothes.module';
import { StudyModule } from './study/study.module';
import { InvestModule } from './invest/invest.module';
import { IndustryModule } from './industry/industry.module';
import { BankModule } from './bank/bank.module';
import { CatalogModule } from './catalog/catalog.controller';
import { PaymentsModule } from './payments/payments.module';
import { AdminModule } from './admin/admin.module';
import { InitModule } from './init/init.module';
import { LiveModule } from './live/live.module';
import { TontineModule } from './tontine/tontine.module';
import { MarketModule } from './market/market.module';
import { LifeModule } from './life/life.module';
import { VehicleModule } from './vehicle/vehicle.module';
import { HotelModule } from './hotel/hotel.module';
import { TendersModule } from './tenders/tenders.module';
import { LoansModule } from './loans/loans.module';
import { AccountThrottlerGuard, JwtAuthGuard, RolesGuard } from './common/guards';
import { SafeExceptionFilter } from './common/http-exception.filter';
import { Public, Roles } from './common/decorators';
import { LiveService } from './live/live.service';

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
}

/**
 * Diagnostic d'exploitation (administrateurs) : processus Node qui répond, mémoire, adresse IP vue par l'API (pour régler
 * TRUST_PROXY_HOPS derrière le proxy de l'hébergeur) et nombre de joueurs connectés au temps réel.
 * Recharger plusieurs fois : un numéro de processus qui change indique que l'hébergeur lance plusieurs instances.
 */
@Roles('ADMIN')
@Controller('admin/diag')
class DiagController {
  constructor(private readonly live: LiveService) {}

  @Get()
  diag(@Req() req: Request) {
    const m = process.memoryUsage();
    const mb = (n: number) => Math.round(n / 1048576);
    return {
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      memoryMB: { rss: mb(m.rss), heapUsed: mb(m.heapUsed), heapTotal: mb(m.heapTotal) },
      ipSeen: req.ip ?? null,
      forwardedFor: String(req.headers['x-forwarded-for'] ?? '').slice(0, 300),
      live: this.live.stats(),
    };
  }
}

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuditModule,
    MailModule,
    SettingsModule,
    LedgerModule,
    JwtModule.register({ global: true }),
    // Limite globale par IP ; des limites plus strictes s'appliquent aux routes sensibles (@Throttle).
    // En multi-instance, brancher un stockage Redis partagé.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    AuthModule,
    AccountModule,
    CharacterModule,
    CompanyModule,
    PartnersModule,
    ContactModule,
    SchoolModule,
    ConferenceModule,
    TradeModule,
    LandModule,
    KitchenModule,
    HomeModule,
    ClothesModule,
    StudyModule,
    InvestModule,
    IndustryModule,
    BankModule,
    CatalogModule,
    PaymentsModule,
    AdminModule,
    InitModule,
    LiveModule,
    TontineModule,
    MarketModule,
    LifeModule,
    VehicleModule,
    HotelModule,
    TendersModule,
    LoansModule,
  ],
  controllers: [HealthController, DiagController],
  providers: [
    // Ordre : authentification → limitation de débit (par compte si connecté, sinon par IP) → rôles.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AccountThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: SafeExceptionFilter },
  ],
})
export class AppModule {}
