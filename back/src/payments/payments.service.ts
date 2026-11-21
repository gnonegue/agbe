import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../common/audit.service';
import { ENV, Env } from '../config/env';
import { PAYMENT_PROVIDER, PaymentProvider, RawWebhook, WebhookEvent } from './payment-provider';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) readonly provider: PaymentProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Le joueur choisit un produit ; le serveur fixe le prix et crée l'intention d'achat. */
  async checkout(accountId: string, productId: string, opts: { campaignId?: string; units?: number; returnPath?: '/annonces' | '/en/ads' } = {}) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product || !product.active) throw new NotFoundException('unknown_product');
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId }, include: { character: true } });
    if (product.kind === 'COINS' && !account.character) throw new BadRequestException('no_character');
    // Un panneau ne s'achète que via une réservation (campagne créée juste avant, au nom du même compte)
    const isAd = product.kind === 'AD_BOARD' || product.kind === 'AD_PLOT';
    if (isAd !== !!opts.campaignId) throw new BadRequestException('unknown_product');
    // Prix à l'unité (parcelles) : quantité décidée par le serveur, montant figé sur l'achat
    const units = product.kind === 'AD_PLOT' ? opts.units ?? 0 : 1;
    // Parcelles : cases × semaines (au plus 8 × 8 cases pendant 52 semaines)
    if (!Number.isInteger(units) || units < 1 || units > 3328) throw new BadRequestException('invalid_quantity');

    // Les achats restés en attente plus de 24 h expirent.
    await this.prisma.purchase.updateMany({ where: { accountId, status: 'PENDING', createdAt: { lt: new Date(Date.now() - 86_400_000) } }, data: { status: 'CANCELLED' } });
    const pending = await this.prisma.purchase.count({ where: { accountId, status: 'PENDING', createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
    if (pending >= 5) throw new BadRequestException('too_many_pending_purchases');

    const purchase = await this.prisma.purchase.create({
      data: { accountId, productId: product.id, amount: product.priceAmount * units, currency: product.currency, coinsGranted: product.coinsGranted, provider: this.provider.name },
    });
    const r = await this.provider.createCheckout({
      purchaseId: purchase.id,
      amount: purchase.amount,
      currency: purchase.currency,
      description: `AGBE — ${product.nameFr}`,
      customer: { email: account.email, phone: account.phone },
      // Retour après paiement : le jeu, ou la page « Annonces » du site pour une réservation faite depuis le site
      returnUrl: `${this.env.PUBLIC_APP_URL}${opts.returnPath ?? '/'}?purchase=${purchase.id}`,
      notifyUrl: `${this.env.PUBLIC_API_URL}/api/payments/webhook/${this.provider.name}`,
    });
    await this.prisma.purchase.update({ where: { id: purchase.id }, data: { providerRef: r.providerRef } });
    if (opts.campaignId) await this.prisma.campaign.update({ where: { id: opts.campaignId }, data: { purchaseId: purchase.id } });
    await this.audit.log('payment.checkout', { actorId: accountId, target: purchase.id, meta: { product: product.id, amount: purchase.amount } });
    return { purchaseId: purchase.id, redirectUrl: r.redirectUrl };
  }

  async status(accountId: string, purchaseId: string) {
    const p = await this.prisma.purchase.findFirst({ where: { id: purchaseId, accountId }, select: { id: true, status: true, productId: true, amount: true, currency: true, paidAt: true } });
    if (!p) throw new NotFoundException();
    return p;
  }

  async handleWebhook(raw: RawWebhook): Promise<void> {
    const event = await this.provider.parseWebhook(raw); // lève si signature invalide
    await this.applyEvent(event);
  }

  /**
   * Applique un événement de paiement vérifié. Idempotent :
   *  - un même eventId n'est traité qu'une fois (contrainte unique) ;
   *  - l'achat ne passe à PAID qu'une seule fois (mise à jour conditionnelle) ;
   *  - le crédit au grand livre porte la clé `purchase:<id>`.
   */
  async applyEvent(event: WebhookEvent): Promise<void> {
    if (this.provider.fetchStatus) {
      const check = await this.provider.fetchStatus(event.providerRef);
      if (check.status !== event.status || check.amount !== event.amount || check.currency !== event.currency) {
        this.logger.warn(`webhook/status mismatch for ${event.providerRef}`);
        await this.audit.log('payment.status_mismatch', { target: event.providerRef });
        return;
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const seen = await tx.paymentEvent.findUnique({
        where: { provider_eventId: { provider: this.provider.name, eventId: event.eventId } },
      });
      if (seen) return; // déjà traité
      // En cas de course, la contrainte unique fait échouer la seconde transaction entière : rien n'est crédité deux fois.
      await tx.paymentEvent.create({
        data: { provider: this.provider.name, eventId: event.eventId, payload: event as unknown as Prisma.InputJsonValue },
      });

      const purchase = await tx.purchase.findUnique({
        where: { provider_providerRef: { provider: this.provider.name, providerRef: event.providerRef } },
        include: { product: true, account: { include: { character: { include: { wallet: true } } } } },
      });
      if (!purchase) {
        await this.audit.log('payment.unknown_ref', { target: event.providerRef }, tx);
        return;
      }
      if (event.amount !== purchase.amount || event.currency !== purchase.currency) {
        // Montant falsifié ou incohérent : on ne crédite rien.
        await this.audit.log('payment.amount_mismatch', { target: purchase.id, meta: { expected: purchase.amount, got: event.amount } }, tx);
        return;
      }

      if (event.status === 'PAID') {
        // Paiement tardif : un PAID signé qui arrive après un FAILED ou une annulation (achat expiré au bout de 24 h)
        // est crédité quand même, car l'argent a bien été encaissé. La mise à jour conditionnelle garantit un seul passage à PAID.
        const claimed = await tx.purchase.updateMany({ where: { id: purchase.id, status: { in: ['PENDING', 'FAILED', 'CANCELLED'] } }, data: { status: 'PAID', paidAt: new Date() } });
        if (claimed.count !== 1) return;
        if (purchase.status !== 'PENDING') await this.audit.log('payment.late_paid', { actorId: purchase.accountId, target: purchase.id, meta: { previous: purchase.status } }, tx);
        const wallet = purchase.account.character?.wallet;
        // Quantité figée à la création de l'achat : une modification ultérieure du catalogue ne change rien.
        if (purchase.product.kind === 'COINS' && purchase.coinsGranted > 0 && wallet) {
          await this.ledger.post(tx, {
            kind: 'PURCHASE',
            idempotencyKey: `purchase:${purchase.id}`,
            memo: purchase.product.id,
            legs: [{ from: await this.ledger.systemWalletId(tx, 'PURCHASES'), to: wallet.id, amount: BigInt(purchase.coinsGranted) }],
          });
        }
        // Panneau payé : la campagne passe en validation par l'équipe (jamais diffusée sans contrôle)
        if (purchase.product.kind === 'AD_BOARD' || purchase.product.kind === 'AD_PLOT') {
          await tx.campaign.updateMany({ where: { purchaseId: purchase.id, status: 'AWAITING_PAYMENT' }, data: { status: 'PENDING' } });
        }
        await this.audit.log('payment.paid', { actorId: purchase.accountId, target: purchase.id, meta: { amount: purchase.amount } }, tx);
      } else if (event.status === 'FAILED' || event.status === 'CANCELLED') {
        await tx.purchase.updateMany({ where: { id: purchase.id, status: 'PENDING' }, data: { status: event.status } });
      }
    });
  }
}
