# Brancher un vrai fournisseur de paiement

Cette page explique comment ajouter FedaPay, CinetPay ou tout autre opérateur (Mobile Money, carte). Seul un fournisseur `mock` (développement) existe aujourd'hui. Le reste du code (achat, webhook, crédit au grand livre) est déjà écrit et ne change pas : tu ajoutes **un fichier** et **une ligne d'enregistrement**.

> **Ne jamais deviner l'API d'un fournisseur.** Les noms d'en-têtes, le format de la signature, les champs JSON, les statuts et les URL ci-dessous sont des **exemples à remplacer** par ce que dit la documentation officielle du fournisseur choisi. Lis-la en entier (création de transaction, notifications, vérification de statut, environnement de test) avant d'écrire une ligne.

## Vue d'ensemble du flux

1. Le joueur choisit un produit : `POST /api/payments/checkout { id: "coins_small" }`.
2. Le serveur crée un `Purchase` (montant et devise pris dans la table `product`, jamais du client) et appelle `provider.createCheckout(...)`.
3. Le front redirige le joueur vers `redirectUrl` (page de paiement du fournisseur).
4. Le fournisseur appelle notre URL de notification : `POST /api/payments/webhook/<nom du fournisseur>`.
5. Le serveur vérifie la signature (`parseWebhook`), re-vérifie le statut si possible (`fetchStatus`), puis crédite le portefeuille une seule fois.
6. Le joueur revient sur `/?purchase=<id>` ; le front interroge le statut toutes les 3 s pendant 1 minute.

La logique d'application (déduplication, montant, idempotence, crédit) est dans `back/src/payments/payments.service.ts`. Tu n'as pas à la toucher.

## Le contrat `PaymentProvider`

Défini dans `back/src/payments/payment-provider.ts`.

| Élément | Rôle |
|---|---|
| `name` | Nom du fournisseur, en minuscules (`^[a-z0-9_-]{2,32}$`). C'est la valeur de `PAYMENT_PROVIDER`, enregistrée dans `Purchase.provider`, et la fin de l'URL du webhook. |
| `createCheckout(input)` | Crée la transaction chez l'opérateur et renvoie `{ providerRef, redirectUrl }`. |
| `parseWebhook(req)` | Vérifie la signature de la notification et la transforme en `WebhookEvent`. Lève `InvalidSignatureError` si elle est invalide. |
| `fetchStatus?(providerRef)` | Optionnel mais recommandé : interroge l'opérateur de serveur à serveur et renvoie `{ status, amount, currency }`. |

Les types :

- `CheckoutInput` : `purchaseId`, `amount` (entier, FCFA), `currency` (ex. `XOF`), `description`, `customer { email?, phone? }`, `returnUrl` (retour sur le jeu), `notifyUrl` (notre webhook).
- `CheckoutResult` : `providerRef` (référence de la transaction chez l'opérateur, stockée et utilisée pour retrouver l'achat) et `redirectUrl`.
- `WebhookEvent` : `eventId` (identifiant unique de la notification chez l'opérateur, sert à ne traiter un événement qu'une fois), `providerRef`, `status` (`PAID`, `FAILED`, `CANCELLED` ou `PENDING`), `amount`, `currency`.
- `RawWebhook` : `rawBody` (`Buffer`, le corps exact reçu) et `headers`.

Comment le service s'en sert :

- Le montant d'un événement est comparé à celui de notre base ; en cas de différence, rien n'est crédité (audit `payment.amount_mismatch`).
- Un `eventId` déjà vu est ignoré (contrainte unique en base).
- L'achat ne passe à `PAID` qu'une fois ; le crédit utilise la clé `purchase:<id>`.
- Si `fetchStatus` existe, le service l'appelle avant de créditer et ignore la notification si statut, montant ou devise diffèrent.

## Les 4 règles de sécurité

Écrites en tête de `payment-provider.ts`, elles sont obligatoires :

1. **Le montant et la devise viennent toujours de notre base** (`Purchase`), jamais du client.
2. **Un paiement n'est crédité que sur notification signée de l'opérateur**, vérifiée en temps constant sur le **corps brut** de la requête. Jamais sur la parole du téléphone ni sur l'URL de retour.
3. **Re-vérifier le statut par un appel serveur à serveur** (`fetchStatus`) quand l'opérateur le permet.
4. **Les secrets (clé API, secret webhook) ne viennent que des variables d'environnement.**

## Squelette de `providers/exemple.provider.ts`

À créer sous `back/src/payments/providers/` (renomme `exemple` par le nom du fournisseur). Tout ce qui est marqué `À VÉRIFIER` dépend de la documentation officielle.

```ts
import { createHmac } from 'node:crypto';
import { CheckoutInput, CheckoutResult, InvalidSignatureError, PaymentProvider, PaymentStatus, RawWebhook, WebhookEvent } from '../payment-provider';
import { safeEqual } from '../../common/crypto';

// Correspondance entre les statuts de l'opérateur et les nôtres.
// À VÉRIFIER : liste exacte des statuts dans la documentation du fournisseur.
const STATUS_MAP: Record<string, PaymentStatus> = {
  approved: 'PAID',
  declined: 'FAILED',
  canceled: 'CANCELLED',
  pending: 'PENDING',
};

export class ExempleProvider implements PaymentProvider {
  readonly name = 'exemple'; // = valeur de PAYMENT_PROVIDER, fin de l'URL du webhook

  constructor(
    private readonly apiKey: string,        // PAYMENT_API_KEY
    private readonly webhookSecret: string, // PAYMENT_WEBHOOK_SECRET
  ) {
    // Refuser de démarrer si un secret manque (mieux vaut un échec au démarrage qu'un webhook non vérifié).
    if (!apiKey || !webhookSecret) throw new Error('exemple provider: PAYMENT_API_KEY and PAYMENT_WEBHOOK_SECRET are required');
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    // À VÉRIFIER : URL, méthode, authentification et corps de la requête de création de transaction.
    const res = await fetch('https://api.exemple.tld/v1/transactions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: input.amount,           // entier en FCFA, vient de notre base
        currency: input.currency,
        description: input.description,
        reference: input.purchaseId,    // utile pour retrouver l'achat côté opérateur
        callback_url: input.notifyUrl,  // notre webhook
        return_url: input.returnUrl,
        customer: input.customer,
      }),
      signal: AbortSignal.timeout(10_000), // toujours un délai maximal
    });
    if (!res.ok) throw new Error(`exemple createCheckout failed: ${res.status}`);
    const data = (await res.json()) as { id?: unknown; payment_url?: unknown }; // À VÉRIFIER : noms des champs
    if (typeof data.id !== 'string' || typeof data.payment_url !== 'string') throw new Error('exemple: unexpected response');
    return { providerRef: data.id, redirectUrl: data.payment_url };
  }

  /** Vérifie la signature sur le CORPS BRUT, en temps constant, puis décode l'événement. */
  async parseWebhook(req: RawWebhook): Promise<WebhookEvent> {
    // À VÉRIFIER : nom exact de l'en-tête de signature (et éventuel horodatage) chez le fournisseur.
    const header = req.headers['x-exemple-signature'];
    const received = Array.isArray(header) ? header[0] : header;
    if (typeof received !== 'string') throw new InvalidSignatureError();

    // À VÉRIFIER : algorithme, texte exact signé (corps seul ? horodatage + corps ?) et encodage (hex ? base64 ?).
    const expected = createHmac('sha256', this.webhookSecret).update(req.rawBody).digest('hex');
    if (!safeEqual(received, expected)) throw new InvalidSignatureError(); // temps constant

    // Seulement APRÈS la signature, on lit le JSON.
    const data = JSON.parse(req.rawBody.toString('utf8')) as Record<string, unknown>;
    // À VÉRIFIER : noms des champs (identifiant d'événement, référence, statut, montant, devise).
    const status = STATUS_MAP[String(data.status)];
    if (
      typeof data.event_id !== 'string' ||
      typeof data.transaction_id !== 'string' ||
      !status ||
      !Number.isSafeInteger(data.amount) ||
      typeof data.currency !== 'string'
    ) {
      throw new InvalidSignatureError();
    }
    return { eventId: data.event_id, providerRef: data.transaction_id, status, amount: data.amount as number, currency: data.currency };
  }

  /** Appel serveur à serveur : on ne fait pas confiance à la seule notification. */
  async fetchStatus(providerRef: string): Promise<{ status: PaymentStatus; amount: number; currency: string }> {
    // À VÉRIFIER : URL et réponse de la consultation d'une transaction.
    const res = await fetch(`https://api.exemple.tld/v1/transactions/${encodeURIComponent(providerRef)}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`exemple fetchStatus failed: ${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;
    const status = STATUS_MAP[String(data.status)] ?? 'PENDING';
    if (!Number.isSafeInteger(data.amount) || typeof data.currency !== 'string') throw new Error('exemple: unexpected response');
    return { status, amount: data.amount as number, currency: data.currency };
  }
}
```

Points d'attention :

- Si le fournisseur envoie un identifiant d'événement différent à chaque tentative d'envoi d'une même notification, la déduplication ne repose plus que sur le passage de l'achat à `PAID` (déjà protégé). Choisis pour `eventId` un identifiant stable (par exemple l'identifiant de la transaction combiné au statut) si le fournisseur n'en donne pas.
- Le corps brut (`rawBody`) est fourni par NestJS (`rawBody: true` dans `main.ts`). Ne le reconstruis jamais à partir d'un JSON déjà interprété : la signature ne correspondrait plus.
- Certains opérateurs signent aussi un horodatage : refuse les notifications trop anciennes si la documentation le prévoit (anti-rejeu).
- Gère les montants dans l'unité du fournisseur : le FCFA n'a pas de centimes, mais vérifie s'il attend des entiers en FCFA ou en sous-unité.

## Enregistrer le fournisseur : `payments.module.ts`

Dans `providerFactory` (fichier `back/src/payments/payments.module.ts`), ajoute un `case` avant le `default` :

```ts
import { ExempleProvider } from './providers/exemple.provider';
// ...
    case 'exemple':
      return new ExempleProvider(env.PAYMENT_API_KEY, env.PAYMENT_WEBHOOK_SECRET);
```

## Variables d'environnement

Dans le `.env` de la racine (déploiement, voir `docs/DEPLOIEMENT.md`) :

```
PAYMENT_PROVIDER=exemple
PAYMENT_API_KEY=...          # clé secrète de l'API, depuis le tableau de bord du fournisseur
PAYMENT_WEBHOOK_SECRET=...   # secret de signature des notifications
```

En local (`back/.env`), `PAYMENT_PROVIDER=mock` reste la valeur par défaut. Pour tester un vrai fournisseur en local, utilise son mode « bac à sable » et une URL publique temporaire vers ton API pour la notification (`PUBLIC_API_URL`), car l'opérateur doit pouvoir t'appeler. Note : le fournisseur `mock` est automatiquement refusé en production.

Dans le tableau de bord du fournisseur, déclare l'URL de notification :
`https://<ton-domaine>/api/payments/webhook/exemple`

Cette route est publique, mais n'accepte que les requêtes correctement signées. Elle est limitée à 120 requêtes par minute et par IP côté API, et nginx limite le corps à 64 Ko.

## Autoriser la page de paiement dans le front

Le front refuse toute redirection vers une origine qu'il ne connaît pas. Ajoute l'origine exacte de la page de paiement du fournisseur dans `front/src/lib/paymentOrigins.ts` :

```ts
export const PAYMENT_ORIGINS: readonly string[] = ['https://checkout.exemple.tld'];
```

Origine exacte : `https` + nom d'hôte (+ port), sans chemin ni barre finale. Récupère-la dans la documentation (ou en regardant la `redirectUrl` renvoyée en bac à sable), puis reconstruis le front. Si l'origine manque, le joueur ne sera pas redirigé.

## Tests à faire

Fais au minimum ces cas (avec des tests automatisés dans `back/src/payments/` quand c'est possible, en t'inspirant du mock, et manuellement en bac à sable) :

1. **Signature invalide ou absente** : la requête est refusée (401) et rien n'est crédité.
2. **Corps modifié après signature** : même résultat (la signature porte sur le corps brut).
3. **Rejeu** : renvoyer exactement la même notification valide ne crédite qu'une fois.
4. **Montant modifié** (notification valide mais montant différent de l'achat) : rien n'est crédité, un événement `payment.amount_mismatch` apparaît dans l'audit.
5. **Double notification** (deux envois simultanés) : un seul crédit, le grand livre reste équilibré.
6. **Référence inconnue** : ignorée (`payment.unknown_ref`).
7. **Échec puis succès** : voir la limite ci-dessous.
8. Après chaque essai : `npm run ledger:verify` doit afficher `"ok": true`.

Paiement tardif : si un événement `FAILED` (ou l'expiration de l'achat après 24 h) précède un `PAID` signé pour le même achat, le `PAID` est quand même crédité, une seule fois, et l'audit enregistre `payment.late_paid`. Un `FAILED` reçu après un `PAID` ne change rien.

## Audit dédié obligatoire

Le code d'un fournisseur de paiement manipule de l'argent réel : **il doit être audité séparément avant la mise en production** (vérification de signature, gestion des erreurs, délais, journaux sans secret, tests ci-dessus, relecture par une personne qui ne l'a pas écrit). Lance aussi `npm test`, `npm audit` et les tests d'argent. Ne mets aucun secret de test ou de production dans le dépôt.
