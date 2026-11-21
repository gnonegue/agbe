# Déploiement sur l'hébergement mutualisé LWS (cPanel)

Le déploiement retenu est un hébergement **mutualisé LWS avec cPanel**, qui fournit Node.js (application cPanel) et PostgreSQL. Il n'y a ni Docker ni nginx : le site est servi par Apache (`front/public/.htaccess`) et l'API par l'application Node.js de cPanel. Le déploiement Docker (`docs/DEPLOIEMENT.md`) reste valable pour un VPS.

> **Ce qui a été testé, et ce qui ne l'a pas été.** Le `.htaccess` a été vérifié sur un Apache local : les pages publiques, les redirections, la protection des fichiers cachés, le cache et la compression. La partie cPanel (application Node.js, PostgreSQL de LWS) n'a pas pu être essayée : fais la première mise en ligne pas à pas et vérifie chaque étape (section 6).

## Ce qu'il faut avant de commencer

- L'offre cPanel LWS avec **Node.js** (menu « Setup Node.js App ») et **PostgreSQL** (menu « Bases de données PostgreSQL »), et l'accès **SSH**.
- Le nom de domaine relié à l'hébergement, avec le certificat SSL gratuit actif (HTTPS).
- Node.js 20 ou plus récent (22 conseillé) proposé par cPanel.
- Sur ton ordinateur : Node.js et le projet, pour construire le front.
- Un fournisseur de paiement réel n'est pas encore écrit (voir `docs/PAIEMENT.md`) : en production, l'API refuse le fournisseur `mock` et ne démarre pas tant qu'un vrai fournisseur n'est pas branché.

## 1. Base PostgreSQL

Dans cPanel, **Bases de données PostgreSQL** :

1. Crée la base (cPanel la préfixe par ton identifiant, par exemple `moncompte_agbe`).
2. Crée un utilisateur avec un mot de passe long, et donne-lui **tous les droits** sur la base (il crée les tables lors des migrations).
3. Note l'adresse de connexion :

```
DATABASE_URL=postgresql://UTILISATEUR:MOT_DE_PASSE@localhost:5432/BASE?schema=public
```

Si le mot de passe contient des caractères spéciaux (`@`, `:`, `/`, `#`…), encode-les dans l'URL (`@` → `%40`, etc.).

## 2. API (application Node.js de cPanel)

1. Envoie le dossier `back/` sur l'hébergement, **hors de `public_html`** (par exemple `~/agbe-back`), sans `node_modules`, `dist` ni `.env`.
2. Dans cPanel, **Setup Node.js App** → **Create Application** :
   - Node.js version : 22 (ou 20 minimum) ;
   - Application mode : Production ;
   - Application root : `agbe-back` ;
   - Application URL : ton domaine, chemin **`api`** (l'API répond sous `/api/…`) ;
   - Application startup file : `dist/main.js`.
3. Dans la même page, ajoute les **variables d'environnement** (modèle complet et commentaires : `back/.env.example`) :

| Variable | Valeur |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | l'adresse de l'étape 1 |
| `CORS_ORIGINS` | `https://ton-domaine` |
| `PUBLIC_APP_URL`, `PUBLIC_API_URL` | `https://ton-domaine` |
| `TRUST_PROXY_HOPS` | `1` (Apache est devant l'API) |
| `JWT_ACCESS_SECRET`, `TOTP_ENCRYPTION_KEY` | secrets longs et aléatoires (voir `back/.env.example`) |
| `PAYMENT_PROVIDER`, `PAYMENT_API_KEY`, `PAYMENT_WEBHOOK_SECRET` | le fournisseur de paiement réel |
| `SMTP_*`, `MAIL_FROM` | l'envoi des e-mails (mot de passe oublié) : une adresse e-mail LWS convient |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | facultatif (connexion avec Google) |
| `INIT_SECRET` | mot de passe d'initialisation, 16 caractères au moins (étape 4) |

`PORT` est inutile : cPanel attribue lui-même le port.

4. En SSH, installe, construis et applique les migrations. La commande d'activation de l'environnement est affichée en haut de la page de l'application dans cPanel ; elle ressemble à celle-ci :

```bash
source ~/nodevenv/agbe-back/22/bin/activate && cd ~/agbe-back
npm ci
npx prisma generate
npm run build
DATABASE_URL='…' npx prisma migrate deploy
```

5. Dans cPanel, clique sur **Restart** (redémarrer l'application).

## 3. Site (front)

Le front se construit sur ton ordinateur, avec le domaine du site. Le domaine est alors écrit dans les pages publiques (adresse canonique, langues, image d'aperçu) et le build génère `sitemap.xml` et `robots.txt` :

```bash
cd front
npm ci
AGBE_SITE_URL=https://ton-domaine npm run build
```

Le build doit afficher `domaine https://ton-domaine : sitemap.xml et robots.txt écrits`.

Envoie ensuite **tout le contenu de `front/dist/`** dans `public_html`, **y compris le fichier caché `.htaccess`** (affiche les fichiers cachés dans ton client FTP ou dans le gestionnaire de fichiers de cPanel).

Attention : cPanel a créé, pour l'application Node.js, un dossier `public_html/api` qui contient son propre `.htaccess`. **Ne le supprime pas et ne l'écrase pas** lors de l'envoi.

**Ordre d'envoi (important pour les mises à jour des joueurs)** :

1. d'abord le dossier `assets/` (et `models/`, `landing/` s'ils ont changé) ;
2. ensuite le reste, **sauf** `index.html`, `sw.js`, `workbox-*.js` et `version.json` ;
3. **en dernier** `index.html`, `sw.js`, `workbox-*.js`, puis `version.json`.

`version.json` annonce la nouvelle version aux téléphones, et `sw.js` leur fait télécharger toute la liste des fichiers. S'ils arrivent sur le serveur avant les nouveaux fichiers de `assets/`, l'installation échoue chez les joueurs. Le jeu sait s'en remettre, mais la mise à jour est retardée d'autant.

Les fichiers de `public_html/assets/` portent un nom unique à chaque build : ne supprime les anciens que quelques jours plus tard (le temps que les joueurs passent à la nouvelle version).

## 4. Données de départ et administrateur

Ouvre `https://ton-domaine/init` et saisis `INIT_SECRET` : la page charge les données du jeu et crée le premier administrateur. Elle se verrouille ensuite d'elle-même. Retire `INIT_SECRET` des variables de l'application, puis redémarre-la.

## 5. Pages légales

La page `/conditions` donne comme contact l'adresse e-mail du réglage `partners.contact` (modifiable dans `/admin`, onglet Pubs) : vérifie qu'elle est la bonne. Le droit applicable et la date de la version se règlent dans `front/src/lib/legal.ts` (puis reconstruis et renvoie le front).

## 6. Vérifications après la mise en ligne

1. `https://ton-domaine/api/health` répond.
2. Les pages publiques s'ouvrent avec leur contenu : `/`, `/en`, `/comment-jouer`, `/en/how-to-play`, `/conditions`, `/en/terms`, `/annonces`, `/en/ads`, `/contact`, `/en/contact`.
3. `/sitemap.xml` et `/robots.txt` contiennent ton domaine.
4. Inscription, connexion, partie invité, puis une action du jeu.
5. **Temps réel** : ouvre deux comptes sur deux appareils et vérifie que la présence et le chat se mettent à jour sans recharger la page (2 à 4 s de délai). Le jeu n'ouvre plus de connexion longue (`/api/live/stream`) : sur un hébergement mutualisé, chacune occupait un « processus d'entrée » (20 par défaut chez CloudLinux) pendant toute la partie, et au-delà d'une vingtaine de joueurs les requêtes étaient refusées. Il fait maintenant une requête courte `/api/live/sync` toutes les 2 à 4 s.
6. **Adresse IP et processus** : connecté en administrateur (2FA), ouvre `https://ton-domaine/api/admin/diag`.
   - `ipSeen` doit être **ton** adresse IP publique et non celle d'un serveur LWS. Si c'est une adresse du proxy, augmente `TRUST_PROXY_HOPS` de 1 (puis 2…) et redémarre l'API jusqu'à voir ta vraie adresse. Les limites anti-abus des pages publiques (connexion, partie invitée) en dépendent.
   - `pid` : recharge plusieurs fois. S'il change, l'hébergeur fait tourner plusieurs instances de l'API, ce que le temps réel ne supporte pas : demande au support LWS de limiter l'application à une instance.
   - `memoryMB.rss` : mémoire de l'API, à comparer à la limite de ton offre.
6. Test des en-têtes de sécurité : https://securityheaders.com et https://www.ssllabs.com/ssltest/.
7. Déclare le site et `https://ton-domaine/sitemap.xml` dans Google Search Console et Bing Webmaster Tools.

**Si `/api/health` répond « 404 »** alors que l'application tourne : cPanel transmet peut-être les adresses sans le préfixe `/api`. Vérifie dans les journaux de l'application (`~/agbe-back/stderr.log`) l'adresse reçue, et signale-le : il faudra rendre le préfixe de l'API réglable.

## 7. Différences avec le déploiement Docker

- **Limites anti-abus** : celles de nginx n'existent pas sur Apache. Les limites de l'API (par adresse IP et par route sensible) restent actives.
- **Sauvegardes** : programme une tâche cron cPanel quotidienne, par exemple :
  ```bash
  pg_dump "$DATABASE_URL" | gzip > ~/sauvegardes/agbe-$(date +\%F).sql.gz
  ```
  et garde aussi les sauvegardes LWS.
- **Contrôle du grand livre** : tâche cron quotidienne, dans l'environnement de l'application :
  ```bash
  source ~/nodevenv/agbe-back/22/bin/activate && cd ~/agbe-back && npm run ledger:verify
  ```
- **Promouvoir un administrateur** : en SSH, `npm run admin:promote -- adresse@e-mail` dans l'environnement de l'application.

## 8. Mises à jour

1. API : renvoie `back/` (sans `node_modules`, `dist`, `.env`), puis en SSH `npm ci && npx prisma generate && npm run build && npx prisma migrate deploy`, et **Restart** dans cPanel.
2. Front : `AGBE_SITE_URL=https://ton-domaine npm run build`, puis renvoie le contenu de `front/dist/` (avec `.htaccess`, sans toucher à `public_html/api`).
3. Le service worker installe la nouvelle version tout seul à la visite suivante des joueurs.
