// ───────────────────────────────────────────────────────────────────────────
// Contrat commun à tous les fournisseurs de paiement (FedaPay, CinetPay, carte…).
// Le choix du fournisseur se fait par configuration (PAYMENT_PROVIDER) : aucun autre code ne change.
//
// Règles de sécurité imposées à chaque implémentation :
//  1. Le montant et la devise viennent TOUJOURS de notre base (Purchase), jamais du client.
//  2. Un paiement n'est crédité QUE sur notification signée de l'opérateur, vérifiée en temps constant
//     sur le corps brut de la requête — jamais sur la parole du téléphone ni sur l'URL de retour.
//  3. Si l'opérateur le permet, re-vérifier le statut par un appel serveur à serveur (`fetchStatus`).
//  4. Les secrets (clé API, secret webhook) ne viennent que des variables d'environnement.
// ───────────────────────────────────────────────────────────────────────────

export interface CheckoutInput {
  purchaseId: string;
  amount: number;
  currency: string;
  description: string;
  customer: { email?: string | null; phone?: string | null };
  returnUrl: string;
  notifyUrl: string;
}

export interface CheckoutResult {
  /** Référence de la transaction chez l'opérateur. */
  providerRef: string;
  /** Page de paiement de l'opérateur vers laquelle rediriger le joueur. */
  redirectUrl: string;
}

export type PaymentStatus = 'PAID' | 'FAILED' | 'CANCELLED' | 'PENDING';

export interface WebhookEvent {
  /** Identifiant unique de l'événement chez l'opérateur (déduplication). */
  eventId: string;
  providerRef: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
}

export interface RawWebhook {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

export class InvalidSignatureError extends Error {
  constructor() {
    super('invalid_signature');
  }
}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  /** Vérifie la signature et décode l'événement ; lève InvalidSignatureError si invalide. */
  parseWebhook(req: RawWebhook): Promise<WebhookEvent>;
  /** Vérification serveur à serveur du statut (recommandé). */
  fetchStatus?(providerRef: string): Promise<{ status: PaymentStatus; amount: number; currency: string }>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
