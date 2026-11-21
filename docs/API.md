# AGBE — Contrat d'API (v0.1)

Base : `/api` (en dev, le front Vite proxifie `/api` → `http://127.0.0.1:3000`).
Toutes les réponses sont JSON. Erreurs : `{ "statusCode": number, "error": string | string[] }` (tableau pour les erreurs de validation ; 413 `payload_too_large`, 429 `too_many_requests`) — `error` est un **code** (ex. `insufficient_funds`) à traduire côté front.
Les montants d'argent du portefeuille sont des **chaînes** (BigInt sérialisé), ex. `"75000"`.

## Authentification

- Jeton d'accès JWT (15 min) renvoyé dans le corps → à garder **en mémoire uniquement** (jamais localStorage), envoyé en `Authorization: Bearer <token>`.
- Jeton de rafraîchissement dans un cookie `httpOnly; SameSite=Strict` posé par le serveur (invisible pour le JS).
- Les routes `/auth/register|login|mfa|refresh|logout` exigent l'en-tête **`X-AGBE-CSRF: 1`** et `credentials: 'include'`.
- Au chargement de l'app : `POST /auth/refresh` **seulement** si l'indicateur non sensible `localStorage['agbe.hadSession']==='1'` (posé après connexion, retiré à la déconnexion). 401/403 → écran de connexion ; 429/5xx/réseau → écran « Connexion impossible — Réessayer » (la session n'est pas perdue).
- Deux rafraîchissements simultanés (deux onglets) sont tolérés : un jeton remplacé depuis moins de 30 s reste accepté. Au-delà, sa réutilisation est traitée comme un vol (toute la famille de sessions est révoquée).
- Sur un 401 d'une route protégée : tenter une fois `/auth/refresh` puis rejouer la requête.

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| POST | /auth/register | `{ username, email?, phone?, password, birthDate: "AAAA-MM-JJ", acceptTerms: true, locale: "fr"\|"en" }` (email **ou** phone E.164 `+228…`, mot de passe 10–128) | `{ accessToken, expiresIn }` · erreurs : `underage` (403), `account_exists` (409), `username_taken` (409), `invalid_username` (nom : 3–20 caractères `a-z 0-9 _ .`), `email_or_phone_required`, `invalid_birth_date`, `weak_password` |
| POST | /auth/login | `{ identifier, password }` (identifier : e-mail, téléphone ou nom d'utilisateur) | `{ accessToken, expiresIn }` ou `{ mfaRequired: true, mfaToken }` · `invalid_credentials` (401) |
| GET | /auth/providers | — | `{ google: boolean }` : moyens de connexion proposés (bouton Google affiché seulement si configuré) |
| GET | /auth/google/start?lang=fr\|en | — | 302 vers la page de choix de compte Google (cookie d'état `agbe_gs`, 10 min : état, nonce, secret PKCE). Navigation complète, pas d'appel XHR. |
| GET | /auth/google/callback | `code`, `state` (Google) | 302 vers `/?google=ok` (session ouverte : `POST /auth/refresh` la récupère), `/?google=signup\|link\|mfa` (suite à donner, cookie provisoire `agbe_gp`, 15 min) ou `/?google=error&reason=google_denied\|google_failed\|google_disabled\|account_suspended` |
| POST | /auth/google/pending | — (cookie `agbe_gp`) | `{ kind: "signup"\|"link"\|"mfa", email?, name?, mfaToken? }` · `google_failed` (401) |
| POST | /auth/google/complete | `{ username, phone, birthDate, acceptTerms: true, locale }` (kind `signup`) | `{ accessToken, expiresIn }` · `underage`, `username_taken`, `account_exists`, `invalid_birth_date`… |
| POST | /auth/google/link | `{ password }` (kind `link`) : mot de passe du compte existant de même adresse | `{ accessToken, expiresIn }` ou `{ mfaRequired: true, mfaToken }` · `invalid_credentials` |
| POST | /auth/google/done | — | 204 : efface le cookie provisoire |
| POST | /auth/refresh | — | `{ accessToken, expiresIn }` |
| POST | /auth/logout | — | 204 |
| POST | /auth/logout-all | — (Bearer) | 204 |
| POST | /auth/totp/setup | `{ password }` (Bearer) — ré-authentification obligatoire | `{ otpauthUrl, secret }` · `invalid_password` |
| POST | /auth/totp/enable | `{ code }` (Bearer) | `{ backupCodes }` : 8 codes de secours à 10 chiffres, montrés une seule fois ; toutes les sessions et jetons sont révoqués |
| POST | /auth/mfa | `{ mfaToken, code }` — `code` : 6 chiffres (appli) **ou 10 chiffres (code de secours, usage unique)**, pour se connecter sans l'appli quand le téléphone est perdu | session · `invalid_mfa` |
| POST | /auth/totp/backup-codes | `{ password }` (Bearer) | `{ backupCodes }` : 8 nouveaux codes, les anciens cessent de fonctionner |
| POST | /auth/password | `{ current, next }` (Bearer, `next` 10–128) | 204 — toutes les sessions et jetons sont révoqués, se reconnecter · `invalid_password`, `same_password`, `weak_password` |
| POST | /auth/forgot-password | `{ email }` (public, 5 / 10 min / IP) | 204 **toujours** (compte inconnu, invité ou envoi trop rapproché : même réponse). Envoie par e-mail un lien `PUBLIC_APP_URL/?reset=<jeton>` valable 1 h, à usage unique, un seul actif ; 1 envoi / min / compte |
| POST | /auth/reset-password | `{ token, password }` (public, `password` 10–128) | 204 — jeton consommé, mot de passe changé, sessions révoquées, verrouillages levés, e-mail de confirmation · `invalid_reset_token`, `weak_password`, `password_length` |

Sécurité des sessions : un jeton d'accès est invalidé **immédiatement** (401) après déconnexion globale, changement de mot de passe, activation 2FA, suppression du compte ou détection de vol. Une session dure au maximum 30 jours (12 h pour un ADMIN) depuis la connexion, même avec rotation.

## Compte (Bearer)

| GET | /me | → `{ id, email (masqué), phone (masqué), locale, role, totpEnabled, backupCodesLeft (codes de secours 2FA restants, null sans 2FA), hasCharacter, createdAt }` |
|---|---|---|
| PATCH | /me/locale | `{ locale }` |
| GET | /me/export | export des données personnelles |
| DELETE | /me | `{ password }` → 204 |

## Public

- `GET /catalog` → `{ jobs[] (chaque métier porte `payMode` : `TASK` payé à chaque service, ou `MONTHLY` salarié : embauche via `/jobs/accept`, salaire mensuel via `/jobs/salary` ; réglage `jobs.taskPaid`), foods[], products[], rent: {VILLA, CHAMBRE_SALON, ENTRER_COUCHER}, wash: {price, hygieneGain}, transferFee: {rateBp, min, max} }`
  - job : `{ id, level, nameFr, nameEn, payPerShift, energyCost, hungerCost, hygieneCost, shiftGameHours, riskPercent }` (seuls `level: "DEBROUILLE"` sont accessibles au prototype)
  - food : `{ id, nameFr, nameEn, price, hunger, energy, morale, health }`
  - product : `{ id, kind: "COINS"|"PREMIUM", nameFr, nameEn, priceAmount, currency, coinsGranted }` (prix réel en FCFA)
- `GET /clock` → `{ now, secondsPerGameDay, gameTime: { totalMinutes, day, hour, minute, month, dayOfMonth } }`
- `GET /economy/payroll?gross=52500` → simulation de paie (toutes valeurs en chaînes) : `gross, cnssEmployee, amuEmployee, irpp, net, cnssEmployer, amuEmployer, employerCost, belowSmig`
- `GET /health`

## Personnage (Bearer)

`POST /character` — `{ name (2–24 lettres), profile: LOCAL|DIASPORA|FOREIGNER, region: MARITIME|PLATEAUX|CENTRALE|KARA|SAVANES, mode: FREE_CHOICE|DESTINY, condition?: RICH|MIDDLE|POOR }` (`condition` obligatoire en FREE_CHOICE, interdite en DESTINY) → **State**. La condition de départ est plafonnée (réglage `start.quota`) : si « riche » ou « moyen » est complet, un choix libre échoue avec `condition_full` et le mode DESTINY descend d'un cran (riche → moyen → pauvre). « Pauvre » n'est jamais bloqué. Le contrôle et la création se font sous un verrou (une seule création à la fois).

`GET /character/conditions` → `{ RICH: boolean, MIDDLE: boolean, POOR: true }` : conditions encore choisissables (l'écran de création grise les autres).

`GET /character` → **State** (404 `no_character` si aucun)

**State** :
```json
{
  "id": "uuid", "name": "Kossi", "profile": "LOCAL", "region": "MARITIME",
  "birthCondition": "POOR", "birthMode": "DESTINY", "housing": "ENTRER_COUCHER",
  "needs": { "hunger": 80, "energy": 80, "hygiene": 80, "health": 90, "morale": 70, "respect": 20 },
  "wallet": { "balance": "5000", "currency": "XOF" },
  "job": null | { "id", "nameFr", "nameEn", "payPerShift", "shiftGameHours" },
  "nextWorkInGameHours": 0, "nextRestInGameHours": 0,
  "rent": { "monthly": 8000, "paidUntilGameDay": 320, "overdue": false },
  "gameTime": { "day": 290, "hour": 14, "minute": 5, "month": 9, "dayOfMonth": 21, "totalMinutes": 0 },
  "secondsPerGameDay": 3600
}
```

Actions (toutes renvoient `{ result, state }`) — en-tête optionnel `Idempotency-Key` (16–64 car. `[A-Za-z0-9_-]`) recommandé sur les actions payantes.
Une clé rejouée avec **la même** requête renvoie `result.replay: true` sans aucun effet ni débit ; avec une requête **différente** : 409 `idempotency_key_reused`. Générer une nouvelle clé par action utilisateur :

| POST | /character/eat | `{ id: foodId }` → result `{ food, paid }` · `insufficient_funds` |
|---|---|---|
| POST | /character/job | `{ id: jobId }` : prend un métier ou rend actif un métier déjà occupé ; jusqu'à `work.maxJobs` (3) métiers en même temps · `job_locked`, `too_many_jobs` |
| POST | /character/job/quit | `{ id? }` : quitte ce métier (le métier actif par défaut) ; un autre métier occupé devient actif · `no_job` |
| GET | /character/search | `?q=` (2 car. min : début du `@nom` ou identifiant exact) → `[{ characterId, name, username }]` (8 max, ni e-mail ni téléphone) |
| GET | /character/lookup | `?username=` exact → `{ characterId, name, username }` · `recipient_not_found`, `invalid_username`, `same_wallet` |
| POST | /character/samu | — : appel du SAMU quand la santé ≤ `emergency.samu.callBelowHealth` ; transfert à l'hôpital, personnage indisponible `stayGameHours` · `not_urgent`, `unpaid_bill`, `in_hospital` |
| POST | /character/samu/pay | — : règle la facture de soins (prélèvement serveur, part AMU déduite) · `no_bill` |
| POST | /character/work | — → `{ paid, incident }` · `no_job`, `still_working`, `too_tired`, `too_sick` |
| POST | /character/rest | — · `cannot_rest_yet` |
| POST | /character/wash | — → `{ paid }` |
| POST | /character/rent | — → `{ paid }` (plus ancien mois dû, pénalité de retard comprise) · `rent_paid_ahead`, `homeless` |
| POST | /character/rent/debt | — → `{ paid }` (dette d'expulsion, en partie si le solde manque) · `no_rent_debt` |
| POST | /character/move | `{ housing }` → `{ paid }` (caution + 1er mois, ancienne caution rendue) · `rent_debt`, `rent_overdue`, `same_housing`, `home_owned` |
| POST | /character/transfer | `{ toCharacterId, amount (entier ≥1), memo? }` → `{ amount, fee, replay }` · `recipient_not_found`, `same_wallet`, `account_too_new` (403, compte de moins de 24 h), `daily_send_limit`, `daily_receive_limit` (plafonds glissants sur 24 h, paramètre `transfer.limits`) |

`GET /character/history?limit=30` → `[{ id, kind, memo, amount: "-300", balanceAfter, at }]`

## Paiement réel (Bearer) — fournisseur paramétrable

- `GET /payments/provider` → `{ provider: "mock" | "fedapay" | … }`
- `POST /payments/checkout` `{ id: productId }` → `{ purchaseId, redirectUrl }` → rediriger le navigateur vers `redirectUrl`.
- `GET /payments/purchase/:id` → `{ id, status: PENDING|PAID|FAILED|CANCELLED, productId, amount, currency, paidAt }`
- Au retour sur l'app (`?purchase=<id>`), interroger le statut toutes les 3 s pendant 1 min max.
- **Dev uniquement (provider `mock`)** : `redirectUrl` = `<app>/?mockPay=<purchaseId>` ; le front affiche alors une page « Paiement simulé » avec un bouton qui appelle `POST /payments/mock/:id/complete`.

## Admin (rôle ADMIN + 2FA obligatoire)

`GET /admin/settings`, `PUT /admin/settings/:key { value }`, `GET /admin/audit`, `GET /admin/ledger/verify`, `GET /admin/stats`.
`POST /admin/users/:id/password` : voir le tableau ci-dessous.

| Méthode | Route | Corps / réponse |
|---|---|---|
| POST | `/admin/users/:id/password` | `{ confirm: "RESET" }` → `{ password }` : mot de passe temporaire généré par le serveur, renvoyé une seule fois. `{ confirm: "RESET", password }` (10–128) → `{ ok }` : mot de passe choisi par l'admin, même politique qu'à l'inscription. Dans les deux cas : toutes les sessions révoquées, audité (`admin.user_password_reset`), secret jamais journalisé · `cannot_target_self` (403), `account_required` (invité), `weak_password` (égal à l'e-mail, au téléphone ou au nom d'utilisateur), `password_length`, `not_found` |
| POST | `/admin/users/:id/reset-link` | → `{ sent }` : envoie au joueur un lien de réinitialisation par e-mail (il choisit son mot de passe). `sent: false` si le SMTP n'est pas configuré ou a échoué. Audité (`admin.user_reset_link_sent`) · `cannot_target_self`, `email_required` (invité / sans e-mail), `not_found` |

## Lieux, trajets et activités

- `GET /catalog` renvoie aussi `venues` (lieux de Lomé avec leurs `activities`), `homePosition` (position du logement par type) et `transport` (paramètres `transport.modes`).
- L'état du personnage (`GET /character`) contient `location` : identifiant du lieu où il se trouve, ou `"home"`.
- `POST /character/travel` `{ "to": "<lieu ou home>", "mode": "WALK" | "ZEM" | "WORO" | "BUS" }` (en-tête `Idempotency-Key` conseillé). Le serveur calcule la distance et le tarif (`economy/transport.ts`), débite via le grand livre (`TRANSPORT`), applique la fatigue et un éventuel incident, puis déplace le personnage. Erreurs : `unknown_venue`, `already_there`, `insufficient_funds`.
- `POST /character/activity` `{ "id": "<activité>" }` (en-tête `Idempotency-Key` conseillé). Il faut se trouver dans le lieu de l'activité (`not_at_venue`). Débit `ACTIVITY` si le prix est positif, puis effets sur les besoins.
- `POST /character/rest` et `POST /character/wash` exigent d'être chez soi (`not_at_home`).

## Panneaux publicitaires (partenaires)

- `GET /boards/offer` (public) : offre publicitaire, affichée sur la page « Annonces » du site — prix du panneau (`board.price`, `board.days`), prix d'une case selon le lieu (`plot.places` : `[{ zone, price }]`, `plot.price` = le moins cher, `plot.periodDays`), formules (`tiers`, réglage `partners.tiers`) et contact des annonceurs (`contact`, réglage `partners.contact`).
- `GET /boards` : campagnes validées et en cours (titre, couleurs, partenaire, lien https).
- `GET /boards/showcase` (public, 30/min) : vitrine du site public (page « Annonces ») — toutes les annonces validées et en ligne (panneaux, mer, zones) : titre, sous-titre, couleurs, emplacement (`where` : `board`, `sea` ou id de zone), annonceur, lien https, fin de diffusion (`endsAt`), présence d'une affiche (`/boards/:id/image`). Ni statistiques ni contact.
- `GET /boards/partners` (public, 30/min) : section « Nos partenaires » du site — vide tant que le réglage `partners.showcase.show` est faux ; sinon les partenaires actifs cochés « Afficher sur le site » dans /admin (`showOnSite`), formule en cours d'abord.
- `GET /boards/slots` : panneaux réservables (`count`, réglage `ad.boards`), numéros déjà pris en fixe (`taken`), annonces rotatives en cours (`rotating`) et plafond (`rotatingMax`, réglage `ad.rotation.max`), numéro à partir duquel les panneaux sont gardés pour la rotation (`rotationFrom`, réglage `ad.rotation.panels`) — plan de la page de réservation du site.
- `POST /boards/book` et `POST /boards/plots/book` acceptent `site: 'fr' | 'en'` : réservation faite depuis le site, retour après paiement sur `/annonces` ou `/en/ads` au lieu du jeu. `slot` = -1 : annonce **rotative** (produit `board_7d`, tarif de base, affichée 8 s à tour de rôle sur tous les panneaux sans annonce fixe ; refusée au-delà de `ad.rotation.max` : `rotation_full`). `slot` = n : annonce **fixe** sur le panneau n (produit `board_fixed_7d`, +50 %), panneau libre (`board_taken`, `unknown_board`) et hors des derniers `ad.rotation.panels` panneaux, gardés pour la rotation (`board_rotation_only`). Le serveur choisit le produit d'après `slot` ; le client n'envoie jamais de prix.
- `POST /contact` (public, 3 par 10 min et par IP, 40 par heure au total) : formulaire de contact du site `{ name, company?, whatsapp, email?, topic: board|plots|partner|game|other, message, locale }` → enregistré, puis e-mail à l'adresse `partners.contact.email` (« répondre à » = e-mail du visiteur). Erreurs : `invalid_whatsapp`, `contact_busy`.
- Admin : `GET /admin/contact?view=open|all` (messages + réponses, `unread`), `POST /admin/contact/:id/status { status: NEW|READ|DONE }`, `POST /admin/contact/:id/reply { channel: email|whatsapp, text }` → e-mail envoyé par le serveur (`no_email`, `mail_failed`) ou lien `wa.me` prêt à ouvrir (`url`).
- `POST /boards/:id/view` et `POST /boards/:id/click` : compteurs de statistiques.
- `POST /boards/book` `{ slot, advertiser, title, subtitle, bg, fg, url? }` : réservation en libre-service. Crée l'annonce (`AWAITING_PAYMENT`) et l'intention de paiement **réel** (produit `AD_BOARD`, prix fixé par le serveur) ; renvoie `redirectUrl`. Le webhook signé du fournisseur fait passer la campagne en `PENDING` ; l'équipe la valide (`APPROVED`) depuis le back-office, et la diffusion dure `days` jours à partir de la validation.
- `GET /boards/mine` : campagnes de l'annonceur connecté (statut, vues, clics).
- Back-office (`ADMIN` + 2FA) : `GET/POST /admin/partners`, `PATCH /admin/partners/:id`, `GET/POST /admin/campaigns`, `POST /admin/campaigns/:id/status`.

## Formules partenaires (Bronze, Argent, Or)

Contrat signé et facturé hors jeu ; l'équipe attribue la formule. Contenu dans le paramètre `partners.tiers`
(panneaux fixes `boards` et panneaux rotatifs `rotating`, comptés séparément, lieu de marque, événements par mois ; plus d'offres d'emploi, prix mensuel indicatif). Une formule échue ne s'affiche plus. Une campagne créée pour un partenaire est refusée au-delà du plafond de sa formule (`tier_boards_limit` pour un panneau fixe, `tier_rotating_limit` pour « tous panneaux », slot -1) ; les réservations payées en libre-service ne comptent pas. Un partenaire sans formule n'a pas de plafond.

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/partners/places` | Lieux de marque (Argent, Or) : nom, couleur, X/Z, site |
| GET | `/partners/offers` | Offres d'emploi et événements des partenaires sous formule |
| POST | `/partners/offers/:id/click` | Compte un clic sur le lien |
| PATCH | `/admin/partners/:id` | `tier`, `months`, `placeLabel`, `placeX`, `placeZ`, `placeColor`, `active` |
| GET | `/admin/jobs` | Toutes les offres d'emploi vues par l'équipe : employeurs publics par défaut (un par métier, salaire, état, salariés en poste) et offres des joueurs ; réglage `jobs.public` renvoyé avec | ; renvoie aussi `catalog` (fiches complètes des métiers, avec leur lieu de travail et leurs diplômes acceptés `reqs`), `domains` (domaines d'études disponibles) et `rules` (bornes de salaire des offres de joueurs) |
| POST | `/admin/jobs/catalog` | `{ id, level, nameFr, nameEn, payPerShift, energyCost, hungerCost, shiftGameHours, …, venueId? }` | Crée un métier du catalogue (`job_exists`) |
| PATCH | `/admin/jobs/catalog/:id` | champs à modifier : `reqs` (diplômes acceptés : liste d'options `{ min: BT|BTS|LICENCE|MASTER|DOCTORAT, domains? }`, **un seul diplôme listé suffit** — ex. licence en informatique OU licence en sécurité OU BTS en réseaux ; domaines absents = tous ; liste vide ou `null` = aucun diplôme exigé ; écrit dans `study.jobReq` (première option + `or`) ; `unknown_domain` si un domaine n'existe pas) ; niveau, noms, paie par service, coûts, durée, risque, famille, icône, descriptions, `enabled`, `venueId` (lieu de travail, `null` pour aucun) | Modifie un métier (`unknown_job`, `unknown_venue`) ; désactiver ne supprime pas les personnages qui l'exercent |
| PATCH | `/admin/jobs/offers/:id` | `{ roleFr?, roleEn?, grossMonthly? }` | Modifie l'offre d'un joueur encore ouverte (`salary_below_smig`, `salary_too_high`, `offer_not_open`) |
| DELETE | `/admin/jobs/offers/:id` | — | Retire une offre de joueur encore ouverte (`offer_not_open` si pourvue) ; écrit `admin.offer_deleted` au journal d'audit |
| GET/POST | `/admin/offers` | Lister / publier (événements seulement : `tier_events_limit`, `tier_required` ; un emploi est refusé avec `partner_jobs_not_allowed`) |
| POST | `/admin/offers/:id/active` | Activer / retirer une offre |

Les panneaux créés par l'équipe pour un partenaire sous formule respectent son plafond (`tier_boards_limit`).

## Espaces VIP, bâtiments de marque et devise d'affichage

Les emplacements sont dans le paramètre `partners.spots` ; chaque formule (`partners.tiers`) porte son prix mensuel et sa durée
(`monthlyPrice`, `defaultMonths`, `minMonths`, `maxMonths`) ; les services d'un bâtiment de marque (soins, repas, articles, carburant,
travail) sont dans `partners.services`. Les taux EUR/USD de l'affichage viennent de `fx.rates`.

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/partners/free-spots` (Bearer) | Emplacements libres : `tier` (BRONZE/SILVER/GOLD), `requested`, `price` indicatif `{ months, monthly, total }` en FCFA, EUR et USD (arrondis, information seulement) |
| POST | `/partners/spot-requests` (Bearer, vrai compte, 5/min) | Demande d'un emplacement `{ spotId, name, company?, whatsapp, email?, message }` (`spot_taken`, `request_pending`, `unknown_spot`, `invalid_whatsapp`) |
| GET | `/partners/places` | Lieux de marque : nom, couleur, X/Z, modèle, site, `logo` |
| GET | `/partners/:id/logo` (public) | Logo du partenaire (image) |
| GET | `/admin/spot-requests` | Demandes des joueurs, filtrables (dont « en attente ») |
| POST | `/admin/spot-requests/:id/approve` · `/reject` | Crée le partenaire et lui attribue l'emplacement (formule selon l'emplacement) ; refuse les autres demandes du même emplacement |
| PATCH | `/admin/partners/:id` | Nom, type, site, contact, formule, `months` (borné par la formule : `invalid_duration`), lieu, couleur, modèle |
| POST/DELETE | `/admin/partners/:id/logo` | Ajouter / retirer le logo (affiché sur l'enseigne, le totem, la fiche et l'intérieur) |
| POST | `/admin/campaigns/plot` | Annonce posée par l'équipe sur une zone (mer, est, lagunes) : approuvée tout de suite |
| PATCH | `/me/currency` (Bearer) | Devise d'affichage du joueur `{ currency: 'XOF' \| 'EUR' \| 'USD' }` ; `GET /me` la renvoie ; `currency` accepté aussi à l'inscription, en invité et à la fin de la connexion Google |

La devise ne change que l'affichage : soldes, prix et paiements restent en FCFA côté serveur.

## Commerce au port (import / export / voitures)

Marchandises et prix de base dans le paramètre `port.goods` (`swingBp` = variation quotidienne). Prix du jour
déterministes (`economy/trade.ts`), droits de douane à l'achat d'une importation ou d'une voiture, taxe à l'export
retenue à la vente au port ; douane et taxe vont au Trésor. Il faut se trouver au lieu d'achat (`buyAt`) ou de revente (`sellAt`).

| Méthode | Route | Corps | Rôle |
|---|---|---|---|
| GET | `/trade` | — | Marchandises, prix du jour, stock et prix de revient du joueur |
| POST | `/trade/buy` | `{ id, qty, remote? }` + `Idempotency-Key` | Acheter (`buy_at_<lieu>`, `stock_limit`). `remote: true` : depuis le téléphone, sans être au lieu d'achat, au prix `remoteBuy` (jamais inférieur à la revente sur place, plus l'écart `remoteSpreadBp`) |
| POST | `/trade/sell` | `{ id, qty, remote? }` + `Idempotency-Key` | Revendre (`sell_at_<lieu>`, `not_enough_stock`, `market_saturated`) ; renvoie le bénéfice |

Garde-fous contre l'enrichissement artificiel (réglages de `port.goods`) :
- **Achat à distance** : il coûte au moins le prix de revente du lieu prévu, plus `remoteSpreadBp` (8 %). Acheter à distance puis revendre sur place fait donc toujours perdre de l'argent ; la marge ne se gagne qu'en faisant le trajet.
- **Marge plafonnée** (`maxMarginBp`, 12 %) : le prix de revente ne dépasse jamais le coût de revient du jour (achat + douane pour un import) de plus de cette marge.
- **Profondeur du marché** (`dailyDepthBp`, 25 %) : au plus cette part du stock maximal d'une marchandise peut être vendue par joueur et par jour de jeu (`market_saturated` au-delà). `GET /trade` renvoie `soldToday` et `dailyMax`.
- **Surveillance** (`alertProfit`, 300 000 FCFA) : une vente dont le bénéfice atteint ce montant écrit `trade.big_profit` au journal d'audit.
- **Cadence** : 40 requêtes par minute et par adresse sur `/trade`.

## Parcelles en mer

Grille au large de la plage (paramètre `sea.plots` : colonnes, rangées, taille d'une case, côté maximal, durée).
Produit `AD_PLOT` au prix **par parcelle** : le serveur calcule le montant (prix × largeur × hauteur) et le fige sur l'achat ;
crédit uniquement par webhook signé, puis validation par l'équipe avant affichage (comme les panneaux).

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/boards/plots` | Grille, prix d'une case par lieu (`pricePerPlot` en mer, `price` de chaque zone : produit `plot_<espace>`), parcelles en ligne (affiche, lien) et cases réservées |
| POST | `/boards/plots/book` | `{ x, y, w, h, advertiser, title, subtitle, bg, fg, url? }` → intention de paiement (`plot_taken`, `plot_out_of_grid`) |

Les chevauchements sont vérifiés sous verrou transactionnel (`pg_advisory_xact_lock`) : deux réservations simultanées ne prennent pas les mêmes cases.

## Logement : loyer, achat, lotissement

Locataire : loyer mensuel (`rent.monthly`). Propriétaire (`homeOwned`) : plus de loyer, `POST /character/rent` renvoie `home_owned`. Retard (`rent.rules`) : chaque jour de retard majore le versement de `lateFeeBpPerDay` (1 %), de même pour les factures d'électricité et d'eau en retard ; chaque semaine, respect et moral baissent ; au-delà de `evictAfterMonths`, expulsion vers le logement inférieur (ou la rue, `homeless`), arriérés majorés moins la caution → `rentDebt`.

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/character/home/buy` | Acheter son logement actuel au prix `housing.price` |

## Foncier (terrains par quarts de lot)

Les zones en mer (`water: true` dans `GET /land` et le plan d'une zone ; `mer_lagon`, `mer_large`) suivent les mêmes règles mais à prix fixe très élevé ; elles sont distinctes des parcelles de publicité en mer ci-dessus. Le lotissement d'Adidogomé est la zone `lotissement` (prix du m² fixe, `fixedPerM2`) ; il remplace les anciennes routes `/estate/*` (supprimées, données reprises par la migration `estate_into_land`). Zones de terrain à vendre ; le prix du m² dépend de la position (centralité, bordure de route, littoral, coefficient de zone). Un lot fait 600 m² et se vend par quarts de 150 m² ; plafond de 150 000 m² (15 ha) par joueur. Montants en FCFA entiers (chaînes JSON pour les grands montants). Paramètres : clé `land` (voir `PARAMETRES.md`).

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/land` | Zones (prix du m² mini/maxi, quarts vendus), règles, démarches, exploitations, surface possédée |
| GET | `/land/zones/:zoneId` | Plan d'une zone : par cellule, prix du m², quarts libres et quarts à moi (masques de 4 bits), `owners` (occupation publique pour la carte : quarts, couleur, exploitation), `margin`, `sign` |
| GET | `/land/zones/:zoneId/cells/:cell` | Détail du prix d'une cellule (centralité, route, littoral, coefficient de zone) |
| POST | `/land/quote` | `{ zoneId, picks: [{ cell, quarters: [0..3] }] }` devis calculé par le serveur (total, frais, plafond) |
| POST | `/land/buy` | Même corps : achat (compte requis, clé `Idempotency-Key`). Prix → MARKET, frais de dossier → TREASURY ; quarts déjà vendus : `land_taken` |
| GET | `/land/mine` | Mes terrains : démarche en cours, exploitation, revenu disponible, valeur au prix du jour |
| POST | `/land/:id/step` | Engage la démarche suivante du titre foncier (bornage, avis favorable, titre) : frais payés au Trésor, résultat après le délai |
| POST | `/land/:id/use` | `{ id }` met un terrain titré en valeur (maison `house_*` ou activité `biz_*`) |
| POST | `/land/:id/collect` | Encaisse le revenu accumulé d'une activité (jours de jeu entiers, durée de vie limitée) |
| POST | `/land/:id/move-in` | Remise des clés d'une maison construite sur le terrain (propriétaire, plus de loyer) |
| POST | `/land/:id/list` | `{ ask }` met un terrain titré en vente (au plus `maxAskMultiple` fois sa valeur) |
| POST | `/land/:id/unlist` | Retire l'annonce |
| GET | `/land/market` | Terrains en vente par les joueurs |
| POST | `/land/:id/buy-listing` | Achat d'une annonce : prix au vendeur, droits d'enregistrement (`transferTaxBp`) au Trésor, titre muté |

## Cuisine à la maison (Bearer)
Les ingrédients, appareils et recettes sont dans le réglage `kitchen`. Le serveur décide de tout : le client n'envoie que des identifiants.
- `GET /kitchen` : catalogue (ingrédients et combustibles, appareils, recettes, règles), appareils possédés, garde-manger (quantité, jours de jeu avant péremption).
- `POST /kitchen/buy` `{itemId, qty}` : acheter dans un lieu qui vend l'article (`not_at_shop` sinon) ; en-tête `Idempotency-Key` recommandé. Un achat apporte `pack` unités ; un réfrigérateur allonge la durée de conservation.
- `POST /kitchen/buy-appliance` `{id}` : réfrigérateur ou réchaud (charbon, gaz, électrique), une seule fois chacun.
- `POST /kitchen/cook` `{recipeId, stoveId}` : à la maison seulement. Consomme les ingrédients et le combustible (ou la redevance d'électricité), le cuisinier mange une portion (effets du plat, bonus « fait maison », fatigue) et le reste devient des restes. Erreurs : `missing_ingredient`, `no_fuel`, `no_appliance`, `leftovers_full`.
- `POST /kitchen/eat-dish` `{foodId}` : manger une portion de restes (`no_dish` s'il n'y en a plus).
- `POST /kitchen/freeze-dish` `{foodId, qty}` : mettre des restes au congélateur (capacité du congélateur).
Les lots périmés sont jetés à la prochaine action.

## Habillement : garde-robe et boutiques de vêtements (Bearer)
Les vêtements sont dans le réglage `clothes.items` (emplacement `top`, `bottom`, `dress` ou `shoes`, coupe `m`, `f` ou `u`, coupe dessinée, tissu, prix public) ; les boutiques et leurs règles dans `clothes.rules`. Le client n'envoie que des identifiants d'articles. `GET /catalog` expose aussi `clothes` pour dessiner la tenue des autres joueurs.
- `GET /clothes` : catalogue, règles, coupe du personnage (`female`), vêtements possédés, tenue portée (`wear`), boutique de vêtements où l'on se trouve (`here`), sa propre boutique et celles des autres joueurs du lieu.
- `POST /clothes/buy` `{itemId}` : acheter au prix du catalogue dans une boutique de vêtements ouverte (`not_at_clothes_shop`, `venue_closed`) ; une pièce ne s'achète qu'une fois (`garment_already_owned`). `Idempotency-Key` recommandé.
- `POST /clothes/buy-from` `{shopId, itemId}` : acheter à la boutique d'un autre joueur, au prix qu'il a fixé (lu en base) ; taxe `taxBp` versée au Trésor par le vendeur ; dernière pièce disputée : un seul acheteur l'obtient (`not_enough_stock`).
- `POST /clothes/wear` `{top?, bottom?, dress?, shoes?}` : à la maison seulement (`dress_at_home`). Un haut et un bas, ou une robe seule ; chaussures facultatives ; chaque pièce possédée et de la bonne coupe (`outfit_incomplete`, `dress_with_separates`, `garment_not_owned`, `garment_wrong_gender`, `wrong_slot`). Sans aucune pièce : retour à la tenue d'origine. La tenue est gardée dans `look.wear` (conservée par `POST /character/look`).
- `POST /clothes/shop/rent` `{weeks}` : louer ou prolonger sa boutique dans la boutique de vêtements où l'on se trouve (loyer `weeklyRent` au Trésor, `maxWeeks` au plus).
- `POST /clothes/shop/stock` `{itemId, qty}` : acheter en gros (`wholesaleBp` du prix public) pour garnir sa boutique, sur place, boutique ouverte ; stock plafonné (`shop_stock_full`).
- `POST /clothes/shop/price` `{itemId, price}` : prix entre le prix de gros et `maxPriceBp` du prix public (`price_out_of_bounds`).
- `POST /clothes/shop/take` `{itemId}` : prendre une pièce de son stock pour sa propre garde-robe (sans remboursement).

## Études supérieures (Bearer)
Le joueur démarre avec le bac. Cursus : bac technique (1 an), licence (3 ans), master (2 ans), doctorat (1 an) dans un domaine ; le master demande la licence du même domaine, le doctorat le master. Réglage `study`.
- `GET /study` : domaines, séries de bac technique, cursus (années, prix, séances), conditions d'accès aux métiers (`jobReq`), diplômes du joueur et cursus en cours (avec la leçon du jour, sans la réponse).
- `POST /study/enroll` `{kind, domain|series}` : s'inscrire à l'Université (`go_to_universite` sinon) ; paie la première année. Erreurs : `already_studying`, `need_licence`, `need_master`, `already_have_diploma`.
- `POST /study/register` : payer l'inscription de l'année suivante (depuis le téléphone).
- `POST /study/attend` `{choice}` : suivre la séance du jour (une par jour de jeu) ; la réponse est corrigée par le serveur.
- `POST /study/exam` : examen de fin d'année ; réussi, année suivante ou diplôme ; raté, on redouble (inscription à repayer).
- `POST /study/quit` : abandonner le cursus.
Un métier à condition (`study.jobReq`) s'ouvre avec un diplôme au moins égal dans le bon domaine (`POST /character/job`, `job_locked` sinon), en plus du certificat d'un cours du soir.

## Cours du soir et conférences

Cours (paramètres `school.courses`, `school.class`) : inscription payée une fois, puis une séance par jour, sur place.
- `POST /school/sit` `{id}` : entrer en classe pendant le cours, au plus `school.class.lateMinutes` après le début (`class_too_late` sinon) ; refaire l'appel reprend sa place.
- `POST /school/attend` `{id, choice}` : question de fin de séance, seulement après l'heure de fin (`class_not_over`) et si l'on est entré en classe (`not_seated`).

Conférences publiques (paramètre `conference`) : une tous les `everyDays` jours de jeu à `startHour`, sujet tournant ; la ville du lieu reçoit l'annonce SSE `announce` (`kind: conference`, `when: soon|now`) 1 h avant puis au début.
- `GET /conference` : prix, horaires, retard toléré et 3 prochaines conférences (pour celle du jour : `inSession`, `seated`, `done`).
- `POST /conference/sit` (Idempotency-Key) : entrer et payer l'entrée, sur place, pendant le retard toléré ; refaire l'appel ne repaie pas.
- `POST /conference/finish` : après l'heure de fin, moral et respect (une fois par conférence).

## Investissements (simulation de jeu)

Paramètre `invest` : frais de courtage, actions fictives (cours déterministe par jour de jeu : dérive + volatilité),
saisons agricoles (`FARM`, paiement à la récolte) et secondes activités (`BUSINESS`, revenu quotidien). Le résultat
d'un placement (rendement, échec) est tiré par le serveur au lancement et reste caché jusqu'au bout.

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/invest` | Cours, mini-historique 14 jours, actions détenues, placements proposés et en cours |
| POST | `/invest/stocks/buy` · `/invest/stocks/sell` | `{ symbol, qty }` au cours du jour, frais compris |
| POST | `/invest/ventures` | `{ id }` lancer un placement |
| POST | `/invest/ventures/:id/collect` | Encaisser (récolte terminée, ou revenu accumulé) — verrou de ligne, jamais payé deux fois |

## Emploi entre joueurs (Bearer)

Un joueur patron (entreprise immatriculée) publie une offre : poste parmi ceux de son activité et salaire brut mensuel qu'il choisit, entre le SMIG et `company.playerJobs.maxGross`. Un autre joueur l'accepte et devient salarié. La paie (`POST /company/payroll`) verse le net sur le portefeuille du salarié joueur et prolonge son AMU d'un mois ; CNSS, AMU et IRPP vont au Trésor comme pour les salariés non joueurs. Un salarié joueur ne peut être licencié qu'une fois ses mois clos payés (`pay_before_fire`). Un joueur n'a qu'un emploi chez un joueur à la fois.

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/company/offers` | Offres ouvertes de mon entreprise, postes possibles, salaire minimum et maximum |
| POST | `/company/offers` | `{ roleIndex, grossMonthly }` publier une offre |
| POST | `/company/offers/close` | `{ id }` retirer une offre |
| POST | `/company/select` | `{ companyId }` choisir l'entreprise en cours parmi ses entreprises ouvertes |
| POST | `/company/sell` | `{ companyId }` vendre l'entreprise : le serveur la rachète (prix selon `company.portfolio`), à jour de paie et de déclaration |
| POST | `/company/close` | `{ companyId }` fermer l'entreprise (rien n'est versé) |
| GET | `/jobs/offers` | Offres ouvertes : emplois publics (un par métier) puis offres des autres joueurs |
| GET | `/jobs/mine` | `{ job }` mon emploi chez un joueur, ou `null` |
| POST | `/jobs/accept` | `{ id }` prendre un poste (l'offre d'un joueur se ferme, un seul preneur ; un id `job:<métier>` embauche chez un employeur public, même condition de qualification que le métier) |
| POST | `/jobs/salary` | Salaire d'un emploi public : les mois clos non versés, net versé par le Trésor au prorata des services du métier faits dans le mois (`jobs.public.minShifts` = salaire entier) |
| POST | `/jobs/quit` | Démissionner (les mois clos non payés sont perdus) |

## Marchés publics (Bearer, admin en `/admin/tenders`)

L'État publie un marché par secteur (mêmes identifiants que `company.activities`) : un vrai contenu
(`titleFr`/`titleEn`/`descriptionFr`/`descriptionEn`, pioché dans `economy/tenderContent.ts` pour la génération
automatique ou saisi par un admin), des places, un budget **PLAFOND** par place (`maxBudget` — pas un montant
fixe payé, une candidature proposant plus est refusée), un délai d'exécution max, un nombre de **séances de
travail nécessaires** (`requiredSessions`, fixé indépendamment du prix/délai proposés par les candidats — tiré
dans `market.tenders.sessionsRange` pour la génération automatique) et une date limite de candidature.

Le coût réel de réalisation du projet (`requiredSessions × company.activities[sector].cost`, calculé par
`tenderRealizationCost` dans `economy/tenders.ts`) est connu de TOUS les candidats avant même de candidater
(`GET /tenders` le renvoie) : ça évite le problème d'œuf-et-la-poule prix/durée/coût.

Une entreprise immatriculée du secteur candidate une fois, en proposant elle-même un **prix** (`proposedPrice`,
≤ `maxBudget`) ET un **délai** (`proposedHours`, ≥ `requiredSessions × shiftGameHours` du secteur — impossible
d'aller plus vite que d'enchaîner les séances —, ≤ `maxHours`). À la date limite, les `slots` meilleures
candidatures sont retenues par un score pondéré prix bas + délai court (`market.tenders.scoreWeightsBp`, 70 % prix
/ 30 % délai par défaut, départage déterministe par ancienneté puis id).

Une fois retenu (statut `SELECTED`), il faut RÉELLEMENT travailler : `POST /tenders/applications/:id/advance`
débite le coût d'une séance (`company.activities[sector].cost`, du joueur vers le portefeuille système `MARKET`,
kind `TENDER_WORK_COST`) et incrémente `sessionsCompleted`, rejouable seulement après `shiftGameHours` d'heures de
jeu depuis le dernier appel (ou depuis la sélection pour le premier) — comme une séance de travail d'entreprise.
Quand `sessionsCompleted` atteint `requiredSessions`, le MÊME appel déclenche aussi, dans la même transaction, le
paiement du **prix proposé par le candidat** (`proposedPrice`, jamais `maxBudget`) du Trésor vers le joueur (kind
`TENDER_PAYOUT`), et le statut passe à `PAID`. Solde insuffisant pour une séance → `insufficient_funds`, rien ne
bouge (aucun débit partiel) ; le prêt bancaire (`/loans`) reste disponible pour financer les frais.

`startedAt`/`endsAt` (sélection + délai proposé) restent affichés (« promis pour telle date ») mais ne déclenchent
plus aucun paiement. Un marché dont le gagnant n'avance jamais reste `SELECTED` indéfiniment (voir « Compromis »
dans le rapport d'implémentation — aucune clause d'abandon n'est implémentée pour l'instant).

Traitement périodique en mémoire (`TendersService`, même principe que `live.service.ts`) : clôture des
candidatures (sélection) et génération automatique d'un marché système selon la cadence réglée dans
`market.tenders` — plus de paiement par tick (il est déclenché par la fin du travail).

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/tenders` | Marchés ouverts du secteur de mon entreprise (immatriculée) : `maxBudget` (plafond), `requiredSessions`, `realizationCost` (coût réel), `minProposedHours`, candidatures déjà déposées |
| GET | `/tenders/mine` | Mes candidatures : `proposedPrice`, `proposedHours`, `sessionsCompleted`/`sessionsRequired`, `realizationCost`, statut (`PENDING`/`SELECTED`/`REJECTED`/`PAID`) |
| POST | `/tenders/:id/apply` | `{ proposedPrice, proposedHours }` (Idempotency-Key) — `wrong_sector`, `over_budget`, `under_min_hours`, `over_delay`, `tender_closed`, `already_applied` |
| POST | `/tenders/applications/:id/advance` | Séance de travail réelle sur une candidature `SELECTED` (Idempotency-Key) — débite le coût du secteur, paie `proposedPrice` si le travail se termine — `still_working` (cadence), `insufficient_funds`, `application_not_selected`, `unknown_application` |
| GET | `/admin/tenders` | Tous les marchés, avec `requiredSessions` (admin) |
| GET | `/admin/tenders/:id/applications` | Candidatures d'un marché (`proposedPrice`, `sessionsCompleted`/`sessionsRequired`), triées par score (admin) |
| POST | `/admin/tenders` | `{ sector, titleFr, titleEn, descriptionFr, descriptionEn, slots, maxBudget, maxHours, requiredSessions, applicationWindowGameHours }` création manuelle (Idempotency-Key, admin) |
| POST | `/admin/tenders/:id/cancel` | Annulation avant attribution : personne n'est payé (admin) |

## Prêt bancaire personnel (Bearer)

L'emprunteur est le personnage (pas son entreprise). Un seul prêt actif (`OPEN`/`LATE`) à la fois : toute nouvelle
demande est refusée tant que le précédent n'est pas entièrement remboursé. Octroi immédiat dans un plafond fixe
réglé dans `bank.loans` (`BANK` → joueur) : taux annuel simple et nombre de mensualités fixes également réglés.
Mensualité fixe = (capital + intérêts simples sur toute la durée) / nombre de mensualités, arrondie au FCFA
supérieur ; le dernier versement est le solde restant s'il est plus petit. Traitement périodique en mémoire
(`LoansService`, même principe que `TendersService`/`live.service.ts`) : à chaque échéance, prélèvement
automatique (joueur → `BANK`) ; si le solde est insuffisant, pas de blocage — retard enregistré, pénalité bornée
(`bank.loans.lateFeeBpPerDay`) appliquée, nouvelle tentative au prochain passage. Remboursement anticipé libre à
tout moment (montant au choix, y compris le solde restant en une fois) ; la pénalité éventuelle est perçue à part,
elle ne réduit jamais le capital restant dû.

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/loans/mine` | Mon prêt en cours (ou le dernier clos), et les réglages (`bank.loans`) pour simuler une demande |
| POST | `/loans/request` | `{ amount }` (Idempotency-Key) — octroi immédiat si `amount` ≤ plafond — `over_cap`, `loan_already_open` |
| POST | `/loans/repay` | `{ amount }` (Idempotency-Key) — remboursement anticipé libre — `no_open_loan`, `over_remaining` |

## Temps réel : présence et chat (Bearer)

Flux d'événements serveur (SSE), lu par `fetch` avec le Bearer. Le hub est en mémoire : avec plusieurs instances du back, il faudra diffuser par Redis pub/sub. nginx sert `/api/live/stream` sans mise en tampon.

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/live/stream` | Flux : `hello`, `presence` (joueurs de la ville et leur position, toutes les 2 s), `chat`, `chat_hidden`, `ping` |
| POST | `/live/pos` | `{ x, z, yaw, ride? }` position affichée aux autres (aucune règle de jeu n'en dépend) ; `ride` ∈ ZEM, MOTO, WORO, BUS, CAR pendant un trajet, absent à pied |
| GET | `/live/chat?room=city\|place` | Derniers messages du salon de la ville ou du lieu où l'on est |
| POST | `/live/chat` | `{ room, text }` ; refusé : vente contre argent réel, numéro, lien, mot interdit, trop rapide, silence de modération |
| GET | `/live/dm?with=<characterId>` | Conversation privée avec un joueur (derniers messages) |
| POST | `/live/dm` | `{ to, text }` ; mêmes règles que le chat ; événement SSE `dm` envoyé aux deux joueurs |
| GET | `/live/groups` | Mes groupes de discussion (nom, propriétaire, membres) |
| POST | `/live/groups` | `{ name, members: [characterId] }` : crée un groupe (le nom suit les règles du chat) ; limites `chat.groupsMax` / `chat.groupMembersMax` ; événement SSE `group_added` aux membres |
| GET | `/live/groups/:id/messages` | Historique du groupe (membres seulement) |
| POST | `/live/groups/:id/messages` | `{ text, replyTo? }` ; mêmes règles que le chat ; événement SSE `group` aux membres |
| POST | `/live/groups/:id/members` | `{ characterId }` : ajoute un membre (propriétaire seulement) |
| DELETE | `/live/groups/:id/members/:characterId` | Quitter le groupe (soi-même) ou en retirer un membre (propriétaire) ; événement SSE `group_removed` ; le dernier à partir supprime le groupe |

Après un envoi d'argent réussi (`POST /character/transfer`), le serveur ajoute dans leur conversation privée un message sans texte portant `money` (montant en FCFA) : un client ne peut pas en fabriquer.
| POST | `/live/report` | `{ targetId, messageId?, reason }` ; message masqué après `chat.autoHideReports` signalements distincts |
| GET | `/admin/reports` | (ADMIN) signalements en attente |
| POST | `/admin/reports/:id/resolve` | (ADMIN) `{ action: dismiss\|hide\|mute, muteHours? }`, audité |

## Tontine (Bearer, vrai compte)

Cotisations séquestrées dans le portefeuille système `TONTINE`. Chaque tour échu est réglé à la consultation : la caisse va au bénéficiaire, ou retourne aux cotisants si le bénéficiaire a manqué une cotisation ou a quitté le jeu. Un tour manqué coûte du respect et reste visible (`tontineDefaults`).

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/tontines` | Mes tontines et celles qui recrutent (avec les tours manqués des membres) |
| POST | `/tontines` | `{ name, contribution, periodDays, maxMembers }` créer et s'inscrire |
| POST | `/tontines/:id/join` · `/leave` · `/start` | Inscription, départ (l'organisateur annule), démarrage avec tirage au sort de l'ordre |
| POST | `/tontines/:id/pay` | Cotiser pour le tour en cours (montant fixé par la tontine) |
| POST | `/tontines/:id/collect` | Ramassage anticipé par le bénéficiaire quand tout le monde a cotisé |

## Marché entre joueurs (Bearer)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/market` | Mon étal (stock, prix, ventes, rang), prix de gros du jour, mon panier |
| GET | `/market/stalls` | Étals ouverts des autres joueurs dans le marché où l'on se trouve |
| POST | `/market/stall` | `{ weeks }` louer ou prolonger un étal sur place |
| POST | `/market/wholesale` | `{ goodId, qty }` acheter en gros au prix du jour (événements compris) |
| POST | `/market/price` | `{ goodId, price }` prix de vente dans les bornes de la marchandise |
| POST | `/market/withdraw` | `{ goodId, qty }` du stock vers le panier |
| POST | `/market/buy` | `{ stallId, goodId, qty }` acheter à l'étal d'un autre joueur, au prix lu en base ; taxe de marché au Trésor |
| POST | `/market/use` | `{ goodId }` utiliser une marchandise (effets sur les besoins) |

## Vie quotidienne : santé, famille, cérémonies, coupures (Bearer)

À chaque action, les jours de jeu écoulés sont traités (au plus `health.rules.maxCatchUpDays`) : maladie qui s'aggrave ou guérit, risque d'en attraper une, demande de la famille, aide de la famille en cas de coup dur, coupures au logement. L'état du jeu expose `illness`, `familyPending`, `outages`, `equipment` et `economy`.

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/health/consult` · `/health/treat` | À l'hôpital : diagnostic, puis traitement ; l'AMU rembourse sa part |
| GET | `/family` | Demandes de la famille |
| POST | `/family/:id/answer` | `{ pay }` envoyer l'argent ou refuser |
| GET | `/ceremonies` | Cérémonies à venir |
| POST | `/ceremonies` | `{ kind, venueId, inDays }` organiser (fête payée d'avance) |
| POST | `/ceremonies/:id/attend` | `{ gift }` y aller le jour dit, sur place, avec un don à l'hôte |
| POST | `/ceremonies/:id/cancel` | Annuler tant qu'aucun invité n'est venu |
| POST | `/home/equipment` | `{ kind: generator\|solar\|waterTank }` équipement contre les coupures |
| GET | `/economy/events` | Événements économiques de la semaine |

## Régions : voyages en car (Bearer)

Les lieux portent une ville (`city`). Le personnage aussi : on ne se déplace qu'entre lieux de sa ville ; le logement est à Lomé. Pendant le trajet en car, toute action renvoie `on_trip`.

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/character/intercity` | `{ to }` depuis la gare : tarif (événements compris) et durée fixés par `travel.intercity` ; `intercity_closed` tant que `enabled` vaut `false` (sauf retour vers Lomé) |

## Hôtel (Bearer)

Chambres par catégorie en nombre limité (100 au total par défaut), réservées à l'avance pour 1 à `hotel.maxNights` nuits. Un client présent à l'hôtel avec un séjour en cours peut dormir et se reposer sur place, et commander au service en chambre. Les salles se louent à la journée, une réservation par salle et par jour. Une fête organisée à l'hôtel réserve la salle des fêtes en même temps.

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/hotel` | Catégories, chambres libres ce soir, mon séjour, service en chambre, salles et jours déjà pris |
| POST | `/hotel/book` | `{ roomType, nights }` réserver ou prolonger (prix fixé par le réglage) |
| POST | `/hotel/checkout` | Libérer la chambre (sans remboursement) |
| POST | `/hotel/order` | `{ itemId }` service en chambre, sur place |
| POST | `/hotel/hall` | `{ hallId, inDays }` louer une salle |

Annonces : la publication d'une offre d'emploi, la création d'une tontine et l'organisation d'une cérémonie envoient un événement `announce` sur le flux `/live/stream` aux joueurs de la même ville, une fois l'opération validée.


## Santé : parcours de consultation (hôpital)

| Méthode | Route | Détail |
|---|---|---|
| GET | `/health/visit` | Dossier en cours : examen (constantes), analyses demandées, résultats, interprétation, ordonnance — ou `visit: null` |
| POST | `/health/consult` | Consultation (part du patient, AMU déduite) → `{ paid, visit }` avec constantes et analyses demandées · `not_at_hospital` |
| POST | `/health/analyses` | Fait toutes les analyses demandées (laboratoire payé) → résultats, interprétation et ordonnance ; la maladie est « diagnostiquée » · `consult_first`, `analyses_done` |
| POST | `/health/treat` | « Se traiter » : règle l'ordonnance, guérit, santé remontée · `consult_first`, `not_ill` |

Les contenus (analyses, résultats par maladie, interprétation, ordonnance) viennent du réglage `health.workup`.

## Véhicules (concession, carburant, entretien)

| Méthode | Route | Détail |
|---|---|---|
| GET | `/vehicles` | Catalogue (`models`), prix du litre, stations, plafond du garage et `mine` (carburant, kilométrage, usure, dégâts, valeur de revente) |
| POST | `/vehicles/buy` | `{ modelId }` : achat comptant, livré avec un demi-réservoir · `unknown_model`, `garage_full` |
| POST | `/vehicles/:id/refuel` | `{ liters }` : plein à une station-service (litres × prix du litre) · `not_at_station`, `tank_full` |
| POST | `/vehicles/:id/service` | Entretien (l'usure repart à zéro) · `service_not_needed` |
| POST | `/vehicles/:id/repair` | Réparation des dégâts (prix ∝ dégâts) · `no_damage` |
| POST | `/vehicles/:id/sell` | Revente à la valeur calculée par le serveur |
| POST | `/character/travel` | `{ to, mode: 'MOTO' \| 'CAR', vehicleId? }` : sans tarif ; consomme du carburant, de l'usure, risque de panne si l'entretien est dépassé · `no_moto`, `no_car`, `out_of_fuel`, `needs_repair` |


## Aménagement du logement et présence (ajouts)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/home/furniture` | Catalogue, meubles du logement, rangement, standing ; donne au premier appel les meubles d'origine (studio, chambre-salon) |
| POST | `/home/furniture` | `{ itemId, x, z, rot }` acheter et poser un meuble (prix du serveur) |
| PUT | `/home/furniture/:id` | `{ x, z, rot }` déplacer ou tourner un meuble posé |
| POST | `/home/furniture/:id/store` | ranger un meuble |
| POST | `/home/furniture/:id/place` | `{ x, z, rot }` reposer un meuble rangé |
| POST | `/home/furniture/:id/gift` | `{ to }` donner à un autre joueur (identifiant de personnage) |
| DELETE | `/home/furniture/:id` | revendre un meuble |
| GET | `/live/presence` | Présence par requête (quand le flux SSE est bloqué par l'hébergement) : joueurs en ligne, voisins positionnés, liste de la ville |

| POST | `/clothes/shop/close` | Fermer sa boutique de vêtements : stock invendu racheté (`closeBuybackBp`), loyer non consommé remboursé en partie (`closeRentRefundBp`) |
