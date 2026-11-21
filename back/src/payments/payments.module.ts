import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Inject, Module, NotFoundException, Param, ParseUUIDPipe, Post, Req, UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { AuthUser, CurrentUser, Public, AccountRequired } from '../common/decorators';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { CodeDto } from '../character/character.dto';
import { InvalidSignatureError, PAYMENT_PROVIDER, PaymentProvider } from './payment-provider';
import { PaymentsService } from './payments.service';
import { MockPaymentProvider } from './providers/mock.provider';
import { randomToken } from '../common/crypto';

/**
 * Registre des fournisseurs. Pour brancher FedaPay, CinetPay ou autre :
 *  1. créer `providers/<nom>.provider.ts` qui implémente PaymentProvider ;
 *  2. l'ajouter ici ;
 *  3. mettre PAYMENT_PROVIDER=<nom> + PAYMENT_API_KEY + PAYMENT_WEBHOOK_SECRET dans l'environnement.
 */
function providerFactory(env: Env): PaymentProvider {
  switch (env.PAYMENT_PROVIDER) {
    case 'mock':
      if (env.NODE_ENV === 'production' || env.ALLOW_MOCK_PAYMENTS !== 'true') throw new Error('mock payment provider is not allowed here');
      return new MockPaymentProvider(env.PAYMENT_WEBHOOK_SECRET || randomToken(), env.PUBLIC_APP_URL);
    default:
      throw new Error(`Unknown PAYMENT_PROVIDER "${env.PAYMENT_PROVIDER}". Implement it in src/payments/providers and register it in payments.module.ts.`);
  }
}

@AccountRequired()
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('provider')
  provider() {
    return { provider: this.payments.provider.name };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('checkout')
  checkout(@CurrentUser() u: AuthUser, @Body() dto: CodeDto) {
    return this.payments.checkout(u.accountId, dto.id);
  }

  @Get('purchase/:id')
  status(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.payments.status(u.accountId, id);
  }

  /** Notification de l'opérateur : publique, mais n'est acceptée qu'avec une signature valide. */
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(200)
  @Post('webhook/:provider')
  async webhook(@Param('provider') provider: string, @Req() req: Request & { rawBody?: Buffer }) {
    if (provider !== this.payments.provider.name) throw new NotFoundException();
    if (!req.rawBody || req.rawBody.length === 0) throw new BadRequestException();
    try {
      await this.payments.handleWebhook({ rawBody: req.rawBody, headers: req.headers });
    } catch (e) {
      if (e instanceof InvalidSignatureError || e instanceof SyntaxError) throw new UnauthorizedException();
      throw e;
    }
    return { ok: true };
  }

  /** Développement uniquement : simule la notification signée de l'opérateur pour un achat du joueur. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('mock/:id/complete')
  async mockComplete(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const p = this.payments.provider;
    if (this.env.NODE_ENV === 'production' || this.env.ALLOW_MOCK_PAYMENTS !== 'true' || !(p instanceof MockPaymentProvider)) throw new ForbiddenException();
    const purchase = await this.prisma.purchase.findFirst({ where: { id, accountId: u.accountId } });
    if (!purchase?.providerRef) throw new NotFoundException();
    const body = JSON.stringify({ eventId: randomUUID(), providerRef: purchase.providerRef, status: 'PAID', amount: purchase.amount, currency: purchase.currency });
    await this.payments.handleWebhook({ rawBody: Buffer.from(body), headers: { 'x-mock-signature': p.sign(body) } });
    return this.payments.status(u.accountId, id);
  }
}

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, { provide: PAYMENT_PROVIDER, inject: [ENV], useFactory: providerFactory }],
  exports: [PaymentsService],
})
export class PaymentsModule {}
