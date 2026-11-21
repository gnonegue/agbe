# Sécurité d'AGBE

Ce document décrit ce qui est réellement en place dans le code, ce qui reste à faire avant un lancement public, et comment signaler une faille. Chaque point ci-dessous correspond à du code existant (le fichier est indiqué entre parenthèses).

## Mesures en place

### Argent et anti-triche

- Le serveur décide de tout : le client envoie seulement des intentions (id de plat, de métier, de produit). Les prix et les soldes ne viennent jamais du client (`CLAUDE.md`, règle 1).
- Argent en entiers (BigInt, FCFA), taux en points de base ; aucun nombre flottant.
- Tout mouvement passe par `LedgerService.post` dans une transaction (`back/src/ledger/ledger.service.ts`) :
  - partie double, somme des lignes égale à 0, montant maximal par mouvement ;
  - débit conditionnel (`balance >= montant`) : un solde ne peut pas devenir négatif, même avec des requêtes simultanées ;
  - portefeuilles verrouillés dans l'ordre de leur identifiant (pas d'interblocage) ;
  - clé d'idempotence : une requête rejouée ne débite pas deux fois ; la même clé avec une requête différente est refusée (409 `idempotency_key_reused`).
- Base de données (migration `init`) : contraintes `CHECK` (solde joueur >= 0, prix > 0, besoins entre 0 et 100…), triggers qui rendent `ledger_entry` et `ledger_transaction` en ajout seul, et trigger qui impose l'équilibre de chaque transaction.
- Chaque action du personnage verrouille la ligne du joueur (`SELECT … FOR UPDATE`) avant de calculer : pas de double dépense par requêtes parallèles.
- Contrôle d'intégrité planifiable : `npm run ledger:verify` (chaque solde égale la somme de ses écritures, total global égal à 0) et route admin `GET /api/admin/ledger/verify`.
- Virements entre joueurs : frais, compte d'au moins 24 h, plafonds d'envoi et de réception sur 24 h (paramètre `transfer.limits`).
- Paiement réel : crédité uniquement sur notification signée du fournisseur, vérifiée sur le corps brut ; montant et devise relus dans notre base ; événement dédupliqué (contrainte unique) ; passage à `PAID` une seule fois ; crédit avec clé `purchase:<id>` ; quantité de pièces figée à la création de l'achat ; re-vérification serveur à serveur si le fournisseur la permet ; montant incohérent ou référence inconnue : rien n'est crédité et un événement d'audit est écrit (`back/src/payments/`).
- Le fournisseur factice est refusé en production et hors `localhost` (`back/src/config/env.ts`, `payments.module.ts`).

### Comptes et sessions

- Mots de passe hachés avec Argon2id (19 456 Ko, 2 passes), 10 à 128 caractères ; refus d'un mot de passe égal à l'identifiant.
- Pas d'énumération de comptes : un hachage factice est vérifié quand le compte n'existe pas (même temps de réponse, même erreur `invalid_credentials`).
- Anti force brute : 5 échecs par couple (compte, IP) bloquent 15 min cette IP seulement ; 30 échecs sur un compte le verrouillent 15 min ; la 2FA a son propre compteur (5 échecs, 15 min) jamais remis à zéro par un bon mot de passe.
- Double authentification TOTP : secret chiffré en base (AES-256-GCM), code à usage unique (anti-rejeu), ré-authentification par mot de passe pour la mettre en place. Obligatoire pour toute route administrateur (`RolesGuard`).
- Jeton d'accès JWT (HS256, 15 min, émetteur et audience vérifiés), gardé en mémoire côté front, jamais dans `localStorage`. Jeton de rafraîchissement : cookie `httpOnly`, `SameSite=Strict`, `Secure` et préfixe `__Host-` en production ; seul son hachage SHA-256 est stocké.
- Rotation des jetons de rafraîchissement avec détection de vol : un jeton déjà utilisé qui revient (hors tolérance de 30 s pour deux onglets) révoque toute la famille de sessions.
- Révocation immédiate des jetons d'accès (version de jeton relue en base à chaque requête) après déconnexion globale, changement de mot de passe, activation 2FA, suppression du compte ou vol détecté. Le rôle est relu en base, jamais pris dans le jeton.
- Durée maximale de session depuis la vraie connexion : 30 jours (12 h pour un administrateur).
- Création d'administrateur uniquement en ligne de commande sur le serveur (`npm run admin:promote`) ; aucune route HTTP ne le permet.
- Journal d'audit des actions sensibles (connexions, échecs, verrouillages, paiements, changements de paramètres).

### Injections et validation

- Chaque entrée a un DTO `class-validator` avec `whitelist` et `forbidNonWhitelisted` : un champ inconnu est refusé ; les valeurs reçues ne sont jamais renvoyées dans les erreurs (`back/src/main.ts`).
- SQL uniquement par Prisma ou `$queryRaw` en gabarit balisé (paramétré). Aucun `$queryRawUnsafe` (règle 4).
- Routes protégées par défaut (garde globale) ; `@Public()` explicite sur les rares routes ouvertes.
- Paramètres de jeu : chaque clé a un schéma `zod` strict, une valeur invalide est refusée ; une valeur corrompue en base retombe sur la valeur par défaut.
- Erreurs : codes courts traduits côté front, filtre qui évite de laisser fuiter des détails internes.
- Routage sensible à la casse : un chemin contenant une majuscule est refusé (404), pour qu'on ne contourne pas les règles nginx écrites en minuscules.
- CSRF sur les routes qui lisent le cookie : en-tête obligatoire `X-AGBE-CSRF: 1` + `SameSite=Strict` + vérification de l'en-tête `Origin` contre `CORS_ORIGINS`.
- Front : pas de `innerHTML` ni de `eval` dans `front/src`. La redirection vers la page de paiement n'est acceptée que vers une origine `https` de la liste blanche `front/src/lib/paymentOrigins.ts` (`safeRedirectUrl`).

### En-têtes et transport

- Configuration nginx de production (`front/nginx/agbe.conf.template`) : HTTP redirigé vers HTTPS, hôte inconnu refusé (444 en HTTP, poignée de main TLS refusée en HTTPS), TLS 1.2 et 1.3 seulement, suites AEAD à confidentialité persistante, tickets de session désactivés, `server_tokens off`.
- En-têtes (`front/nginx/snippets/`) : HSTS (2 ans, `includeSubDomains`, `preload`), CSP stricte sans script ni style inline, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP, CORP, COEP. L'API reçoit une CSP fermée (`default-src 'none'`) et `Cache-Control: no-store`.
- Limites de débit nginx par IP (zones `auth`, `session`, `api`), limite de connexions, corps de requête limité à 64 Ko, délais courts. Côté API : limite globale de 120 requêtes par minute et par IP, plus des limites strictes sur les routes sensibles (`@Throttle`).
- Les seuils nginx sont larges volontairement : au Togo, beaucoup d'abonnés mobiles partagent une IP. La vraie protection contre la force brute est faite par compte dans l'API.
- CORS limité aux origines configurées ; en production, toutes les URL publiques doivent être en `https` sinon le serveur refuse de démarrer.
- `security.txt` servi sur `/.well-known/security.txt`.
- PWA : le service worker ne met jamais l'API en cache ni en repli.

### Base de données

- Deux rôles : le propriétaire (`agbe`) sert uniquement aux migrations ; l'API se connecte avec `agbe_app` (sans superutilisateur, ni création de base ou de rôle), créé par `infra/db-init.sh`.
- La migration `audit_fixes` retire à `agbe_app` les droits `UPDATE`, `DELETE`, `TRUNCATE` sur le grand livre, les événements de paiement et le journal d'audit (sauf mise à jour de la colonne `ip` de l'audit, pour l'anonymisation), et tous les droits sur `_prisma_migrations`.
- PostgreSQL n'est joignable que depuis le réseau interne Docker (aucun port publié).
- Secrets de l'API uniquement par variables d'environnement ; la configuration est validée au démarrage (secret JWT d'au moins 32 caractères, clé 2FA de 32 octets) et les erreurs n'affichent que les noms de variables.

### Conteneurs

- Seul nginx est exposé (ports 80 et 443). L'API et la base sont sur un réseau interne.
- API : utilisateur non-root (`node`), système de fichiers en lecture seule, `cap_drop: ALL`, `no-new-privileges`, `tini` comme processus d'init, vérification de santé.
- nginx : système de fichiers en lecture seule, capacités réduites au minimum, `no-new-privileges`. Seul le certificat du domaine est monté, pas les autres clés Let's Encrypt.
- Les migrations tournent dans un conteneur éphémère distinct, avec le rôle propriétaire.

### Données personnelles

- Séparation entre les données de compte (`account`) et les données de jeu (`character`).
- Consentements (conditions et confidentialité) enregistrés avec leur version ; âge minimum vérifié à l'inscription.
- Réponses `/api/me` : e-mail et téléphone masqués.
- Export des données personnelles (`GET /api/me/export`) et suppression du compte (`DELETE /api/me`, mot de passe demandé) : e-mail, téléphone, date de naissance, sessions et consentements sont effacés, l'IP du journal d'audit est anonymisée ; le grand livre et les achats sont conservés pour la comptabilité mais ne sont plus rattachables à une personne.
- Les mots de passe, secrets 2FA et jetons ne sont jamais écrits dans les journaux ni dans l'audit.

## Audits

Deux audits indépendants ont été réalisés sur le prototype :

- back : 3 failles hautes et 7 moyennes ;
- front : 2 failles hautes et 4 moyennes.

Toutes ont été corrigées. Ces audits portent sur le code actuel ; tout nouveau code d'argent (fournisseur de paiement, marché, tontines) doit être audité de la même façon avant d'ouvrir au public.

## Reste à faire avant le lancement public

- [ ] Vérification du téléphone par OTP SMS : choisir un fournisseur SMS et le rendre paramétrable comme le paiement (aujourd'hui, un numéro est accepté sans preuve de possession).
- [ ] Implémenter le fournisseur de paiement réel et le faire auditer à part (`docs/PAIEMENT.md`).
- [x] Réconciliation des paiements tardifs : un événement `PAID` signé reçu après un `FAILED` ou une annulation est crédité une seule fois (audit `payment.late_paid`). Un `FAILED` reçu après un `PAID` ne change rien.
- [ ] Produit `PREMIUM` : il peut être acheté mais n'accorde encore rien (seuls les produits `COINS` créditent des pièces).
- [ ] Limiteur de débit partagé (Redis) en cas de plusieurs instances : le compteur compte/IP est en mémoire du processus, et le limiteur global de requêtes aussi.
- [ ] Codes de secours 2FA et procédure de désactivation de la 2FA (perte du téléphone).
- [ ] Vérification des mots de passe contre les fuites connues.
- [ ] Test de charge.
- [ ] Tests réels : SSL Labs, securityheaders.com, Mozilla Observatory (nginx et Docker n'ont pas pu être testés sur la machine de développement).
- [ ] Validation de la grille fiscale et sociale (CNSS, AMU, IRPP, SMIG) par un expert-comptable. La grille IRPP est vide par défaut.
- [ ] HSTS `preload` : ne soumettre le domaine à la liste de préchargement qu'après avoir vérifié que tous les sous-domaines sont en HTTPS.
- [ ] Renouveler la date `Expires` de `security.txt` (écrite en dur dans `front/nginx/agbe.conf.template`, actuellement 2027-10-18).

## Signaler une faille

Écris à l'adresse indiquée dans `https://<ton-domaine>/.well-known/security.txt`. Cette adresse vient de la variable `AGBE_SECURITY_CONTACT` du fichier `.env` de déploiement.

Merci de nous laisser un délai raisonnable pour corriger avant toute publication, de ne pas accéder aux données d'autres joueurs au-delà de ce qui est nécessaire pour démontrer le problème, et de ne pas perturber le service. Décris les étapes pour reproduire la faille. Nous répondons en français ou en anglais.
