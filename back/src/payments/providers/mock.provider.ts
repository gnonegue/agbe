import { createHmac } from 'node:crypto';
import { CheckoutInput, CheckoutResult, InvalidSignatureError, PaymentProvider, RawWebhook, WebhookEvent } from '../payment-provider';
import { safeEqual } from '../../common/crypto';

/**
 * Fournisseur factice pour le développement : simule un opérateur qui signe ses notifications en HMAC-SHA256.
 * Interdit en production (refusé au démarrage par la validation de configuration).
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  constructor(
    private readonly secret: string,
    private readonly appUrl: string,
  ) {}

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const providerRef = `mock_${input.purchaseId}`;
    return { providerRef, redirectUrl: `${this.appUrl}/?mockPay=${encodeURIComponent(input.purchaseId)}` };
  }

  sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('hex');
  }

  async parseWebhook(req: RawWebhook): Promise<WebhookEvent> {
    const sig = req.headers['x-mock-signature'];
    if (typeof sig !== 'string' || !safeEqual(sig, this.sign(req.rawBody.toString('utf8')))) throw new InvalidSignatureError();
    const data = JSON.parse(req.rawBody.toString('utf8')) as Partial<WebhookEvent>;
    if (
      typeof data.eventId !== 'string' ||
      typeof data.providerRef !== 'string' ||
      !['PAID', 'FAILED', 'CANCELLED', 'PENDING'].includes(String(data.status)) ||
      !Number.isSafeInteger(data.amount) ||
      typeof data.currency !== 'string'
    ) {
      throw new InvalidSignatureError();
    }
    return data as WebhookEvent;
  }
}
