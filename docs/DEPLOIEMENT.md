# Déploiement en production (un serveur Linux avec Docker)

> **Attention : cette procédure n'a pas pu être testée.** Ni Docker ni nginx n'étaient installés sur la machine de développement. La configuration (`docker-compose.yml`, `front/nginx/`, les Dockerfile) a été écrite et relue, mais jamais exécutée. Fais la première mise en ligne pas à pas, lis les journaux à chaque étape (`docker compose logs`) et corrige ce qui bloque avant de continuer.

## Deux blocages connus avant de commencer

1. **Aucun fournisseur de paiement réel n'est encore écrit.** En production, le fournisseur `mock` est refusé et tout autre nom fait échouer le démarrage de l'API (`Unknown PAYMENT_PROVIDER`). Tant que `docs/PAIEMENT.md` n'est pas appliqué, le conteneur `back` ne démarre pas en production. Tu peux quand même valider le reste (nginx, certificat, base) en implémentant d'abord un fournisseur minimal.
2. ~~La commande de migration~~ — **corrigé** : `prisma` est désormais une dépendance de production de `back/package.json`, il reste donc présent dans l'image après `npm prune --omit=dev`. Vérifier tout de même `docker compose logs migrate` au premier lancement.

## Prérequis

- Un serveur Linux (Debian ou Ubuntu récent) avec accès `root` ou `sudo`.
- Docker en mode « rootful » (installation standard, pas le mode sans root) et le plugin `docker compose`. Vérifie : `docker compose version`.
- `certbot` sur l'hôte : `sudo apt install certbot`.
- Un nom de domaine avec un enregistrement DNS **A** qui pointe vers l'IP du serveur.
- **Pas d'enregistrement AAAA** (IPv6), sauf si tu as activé IPv6 sur le réseau Docker. Sinon, nginx verrait l'IP de la passerelle Docker à la place de celle du joueur, et les limites par IP seraient fausses.
- Ports 80 et 443 ouverts sur le pare-feu du serveur et du fournisseur d'hébergement.
- Un e-mail de contact sécurité (voir `SECURITY.md`).

## 1. Récupérer le projet

```bash
sudo mkdir -p /opt/agbe && sudo chown "$USER" /opt/agbe
# copie le projet dans /opt/agbe (git clone, rsync…)
cd /opt/agbe
```

Dans la suite, remplace `/opt/agbe` par ton chemin réel.

## 2. Fichier `.env` (racine du projet)

```bash
cd /opt/agbe
cp .env.example .env
chmod 600 .env
```

Génère les secrets et colle-les dans `.env` :

```bash
openssl rand -base64 48   # POSTGRES_PASSWORD, APP_DB_PASSWORD, JWT_ACCESS_SECRET (une valeur différente chacun)
openssl rand -base64 32   # TOTP_ENCRYPTION_KEY
```

Pour les mots de passe de base de données, préfère des valeurs sans caractères `/`, `+`, `=`, `@` ou `:` (ils sont insérés dans une URL). Par exemple : `openssl rand -hex 32`.

| Variable | Rôle |
|---|---|
| `AGBE_DOMAIN` | Ton nom de domaine, sans `https://` (ex. `agbe.tg`). Sert à nginx et au chemin du certificat. |
| `AGBE_SECURITY_CONTACT` | Adresse e-mail publiée dans `/.well-known/security.txt`. |
| `PUBLIC_APP_URL` | URL publique du site, en `https://` (ex. `https://agbe.tg`). Sert aussi de seule origine CORS autorisée. |
| `POSTGRES_PASSWORD` | Mot de passe du propriétaire de la base (rôle `agbe`), utilisé seulement pour les migrations. |
| `APP_DB_PASSWORD` | Mot de passe du rôle `agbe_app` utilisé par l'API (droits limités). |
| `JWT_ACCESS_SECRET` | Secret de signature des jetons de connexion (au moins 32 caractères). Le changer déconnecte tout le monde. |
| `TOTP_ENCRYPTION_KEY` | Clé de chiffrement des secrets 2FA (32 octets en base64). **Ne jamais la perdre ni la changer** : toutes les 2FA deviendraient inutilisables. |
| `PAYMENT_PROVIDER` | Nom du fournisseur de paiement réel (obligatoire, ex. `fedapay`). `mock` est interdit. |
| `PAYMENT_API_KEY` | Clé API du fournisseur. |
| `PAYMENT_WEBHOOK_SECRET` | Secret de signature des notifications du fournisseur. |
| `SMTP_HOST` | Serveur SMTP pour les e-mails (mot de passe oublié). Vide = aucun e-mail envoyé. |
| `SMTP_PORT` | `587` (STARTTLS, défaut) ou `465` (TLS direct, avec `SMTP_SECURE=true`). |
| `SMTP_SECURE` | `true` pour le port 465, `false` pour 587. |
| `SMTP_USER` / `SMTP_PASSWORD` | Identifiants SMTP (ensemble). Pour Gmail/Google Workspace : un « mot de passe d'application ». |
| `MAIL_FROM` | Expéditeur, ex. `AGBE <no-reply@agbe.tg>` (obligatoire dès que `SMTP_HOST` est renseigné). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Connexion avec Google (facultative, les deux ensemble). Console Google Cloud → API et services → Identifiants → « ID client OAuth » de type **Application Web**, avec l'URI de redirection autorisé `https://<ton-domaine>/api/auth/google/callback` (en développement : `http://localhost:5173/api/auth/google/callback`). Sans ces variables, le bouton « Continuer avec Google » n'apparaît pas. Aucune modification des en-têtes nginx n'est nécessaire : la connexion passe par une redirection, aucun script Google n'est chargé. |

Important : `POSTGRES_PASSWORD` et `APP_DB_PASSWORD` ne servent qu'à la **première** création de la base (le script `infra/db-init.sh` ne s'exécute qu'une fois, quand le volume est vide). Les changer plus tard dans `.env` ne change pas les mots de passe déjà dans PostgreSQL. Garde une copie des secrets dans un gestionnaire de mots de passe, hors du serveur.

## 3. Premier certificat (AVANT le premier `up`)

nginx a besoin du certificat pour démarrer. Le port 80 doit être libre (rien ne tourne encore) :

```bash
set -a; . ./.env; set +a
sudo mkdir -p /var/www/certbot
sudo certbot certonly --standalone -d "$AGBE_DOMAIN"
ls /etc/letsencrypt/live/"$AGBE_DOMAIN"/    # doit contenir fullchain.pem et privkey.pem
```

Ce certificat est monté en lecture seule dans le conteneur nginx. Le dossier `/var/www/certbot` sert aux défis du renouvellement (étape 6).

## 4. Démarrer

```bash
cd /opt/agbe
docker compose up -d --build
docker compose ps
docker compose logs -f
```

L'ordre est automatique : `db` (avec contrôle de santé) → `migrate` (s'arrête quand c'est fini) → `back` → `front`. Le service `migrate` doit se terminer avec le code 0 (`docker compose ps -a`).

Si `front` redémarre en boucle, regarde `docker compose logs front` : cause probable, certificat absent ou système de fichiers en lecture seule qui gêne nginx (le compose le durcit, « à valider au premier démarrage »).

## 5. Données de départ (seed)

À faire une fois, après la première migration :

```bash
docker compose run --rm back node dist/scripts/seed.js
```

La commande est cohérente avec l'image : `dist/` est copié dans l'image du back et le script lit `DATABASE_URL` du service `back`, donc il se connecte avec le rôle `agbe_app`, qui a les droits `INSERT`, `UPDATE` et `DELETE` sur les tables concernées (portefeuilles système, `game_setting`, métiers, plats, produits, lieux et activités ; le seed retire aussi les annonceurs fictifs des anciennes versions ; seules les tables du grand livre, des événements de paiement et de l'audit sont protégées). Le seed peut être relancé sans doublon. Il affiche `seed ok: …`. Il ne crée aucune publicité : les panneaux et parcelles sont vendus aux annonceurs.

## 6. Renouvellement du certificat

Le premier certificat a été obtenu en mode `standalone` (port 80). Le renouvellement doit passer par le dossier partagé avec nginx (`webroot`). Bascule la méthode une fois :

```bash
sudo certbot reconfigure --cert-name "$AGBE_DOMAIN" --authenticator webroot --webroot-path /var/www/certbot
```

(`certbot reconfigure` demande certbot 2.3 ou plus récent ; sinon, modifie `authenticator` et `webroot_path` dans `/etc/letsencrypt/renewal/<domaine>.conf`.) Vérifie ensuite :

```bash
sudo certbot renew --dry-run --webroot -w /var/www/certbot \
  --deploy-hook "docker compose -f /opt/agbe/docker-compose.yml exec -T front nginx -s reload"
```

Planifie le renouvellement (certbot l'installe souvent déjà : `systemctl list-timers | grep certbot`). Sinon, avec cron (`sudo crontab -e`) :

```cron
17 3 * * * certbot renew --webroot -w /var/www/certbot --deploy-hook "docker compose -f /opt/agbe/docker-compose.yml exec -T front nginx -s reload" >> /var/log/certbot-agbe.log 2>&1
```

Le hook recharge nginx sans coupure pour qu'il lise le nouveau certificat.

## 7. Sauvegarde quotidienne de PostgreSQL

Crée `/opt/agbe/backup.sh` :

```bash
#!/bin/sh
set -eu
DIR=/var/backups/agbe
mkdir -p "$DIR"
cd /opt/agbe
docker compose exec -T db pg_dump -U agbe -d agbe -Fc > "$DIR/agbe-$(date +%F).dump"
find "$DIR" -name 'agbe-*.dump' -mtime +14 -delete
```

```bash
sudo chmod 700 /opt/agbe/backup.sh
sudo crontab -e
# ajouter :  30 2 * * * /opt/agbe/backup.sh
```

Copie aussi les sauvegardes sur une autre machine (une sauvegarde sur le même disque ne protège pas d'une panne du serveur).

**Teste la restauration** (une sauvegarde jamais testée n'est pas une sauvegarde), dans une base à part :

```bash
cd /opt/agbe
docker compose exec -T db createdb -U agbe agbe_restore_test
docker compose exec -T db pg_restore -U agbe -d agbe_restore_test --no-owner < /var/backups/agbe/agbe-AAAA-MM-JJ.dump
docker compose exec -T db psql -U agbe -d agbe_restore_test -c "SELECT count(*) FROM ledger_entry;"
docker compose exec -T db dropdb -U agbe agbe_restore_test
```

## 8. Contrôle d'intégrité du grand livre

À planifier chaque nuit. Le script affiche un JSON et sort avec le code 1 si un solde ne correspond pas à ses écritures :

```bash
cd /opt/agbe && docker compose exec -T back node dist/scripts/verify-ledger.js
```

Exemple cron (envoie un message en cas d'échec avec ton outil d'alerte, ici une simple ligne de journal) :

```cron
45 2 * * * cd /opt/agbe && docker compose exec -T back node dist/scripts/verify-ledger.js >> /var/log/agbe-ledger.log 2>&1 || echo "LEDGER KO $(date)" >> /var/log/agbe-ledger.log
```

Si le résultat est `"ok": false`, ne corrige pas à la main : coupe les paiements, sauvegarde la base et cherche l'origine dans le journal d'audit.

## 9. Vérifications après la mise en ligne

```bash
# Syntaxe de la configuration nginx générée
docker compose exec front nginx -t

# Redirection HTTP -> HTTPS
curl -sI http://$AGBE_DOMAIN/ | head -5

# En-têtes de sécurité de la page et de l'API
curl -sI https://$AGBE_DOMAIN/ | grep -i -E "strict-transport|content-security|x-frame|x-content-type|referrer|permissions|cross-origin"
curl -sI https://$AGBE_DOMAIN/api/health
curl -s  https://$AGBE_DOMAIN/api/health            # {"status":"ok"}
curl -s  https://$AGBE_DOMAIN/.well-known/security.txt

# L'IPv6 : doit échouer proprement si tu n'as pas d'AAAA
curl -6 -sI https://$AGBE_DOMAIN/ | head -1
```

Contrôle aussi que l'API et la base ne sont pas joignables de l'extérieur : `curl -m 5 http://IP_DU_SERVEUR:3000` et un scan du port 5432 doivent échouer.

Tests en ligne (à viser : A ou A+) :

- SSL Labs : https://www.ssllabs.com/ssltest/
- Security Headers : https://securityheaders.com/
- Mozilla Observatory : https://observatory.mozilla.org/

Vérifie dans les journaux que les IP vues par l'API sont celles des joueurs et non `172.x.x.x` (sinon, revois la remarque IPv6 des prérequis) : `docker compose logs back` ou le champ `ip` du journal d'audit.

Ne soumets pas le domaine à la liste HSTS preload tant que tous les sous-domaines ne sont pas en HTTPS.

## 10. Promouvoir un administrateur

Crée d'abord un compte depuis le site, puis :

```bash
docker compose run --rm back node dist/scripts/promote-admin.js ton.email@exemple.com
```

Connecte-toi, active la 2FA dans Réglages > Sécurité (obligatoire pour les routes admin), reconnecte-toi avec le code. Voir `docs/PARAMETRES.md` pour modifier les paramètres.

## 11. Mises à jour

Code et dépendances :

```bash
cd /opt/agbe
# récupérer la nouvelle version du code, puis :
(cd back && npm audit)      # doit rester à 0
(cd front && npm audit)
docker compose build --pull
docker compose up -d
docker compose logs --tail 50 migrate back
```

Les migrations s'appliquent automatiquement à chaque `up` (service `migrate`). **Sauvegarde avant** (`/opt/agbe/backup.sh`).

Images de base (`postgres:16-alpine`, `node:22-bookworm-slim`, `nginx:1.28-alpine`) : `docker compose build --pull` les met à jour ; fais-le au moins chaque mois et à chaque alerte de sécurité. Pense à renouveler la date `Expires` de `security.txt` (dans `front/nginx/agbe.conf.template`) avant son échéance.

Si une migration ajoute une table, vérifie les droits de `agbe_app` : les droits par défaut donnent `UPDATE`/`DELETE` sur toute nouvelle table ; si elle doit être en ajout seul (comme le grand livre), ajoute un `REVOKE` dans la migration.

## Dépannage rapide

| Symptôme | Piste |
|---|---|
| `POSTGRES_PASSWORD manquant` au `up` | `.env` absent ou non rempli, ou commande lancée hors de la racine du projet. |
| `back` s'arrête : `Invalid environment configuration` | Une variable manque ou est invalide ; le message donne le nom (pas la valeur). |
| `back` s'arrête : `Unknown PAYMENT_PROVIDER` | Pas de fournisseur implémenté (voir blocage n°1). |
| `migrate` échoue | Voir blocage n°2 et `docker compose logs migrate`. |
| `front` : `host not found in upstream "back"` | Le service `back` n'a pas démarré ; regarde ses journaux. |
| Mots de passe de base refusés après changement de `.env` | Le script d'init ne rejoue pas ; change le mot de passe dans PostgreSQL (`ALTER ROLE`). |

## E-mails (mot de passe oublié)

L'API envoie deux messages : le **lien de réinitialisation** (valable 1 h, à usage unique) et la **confirmation de changement**. Sans `SMTP_HOST`, rien ne part et le lien est introuvable : renseigne le SMTP avant l'ouverture.

1. Choisis un fournisseur et crée un compte d'envoi (Brevo, Mailjet, Amazon SES, Zoho, OVH, Google Workspace…).
2. Valide ton domaine chez lui et ajoute les enregistrements **SPF** et **DKIM** (sinon les mails finissent en indésirables), idéalement **DMARC**.
3. Renseigne dans `.env` : `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`.
4. `docker compose up -d back` puis `docker compose logs back | grep Mail` : on doit voir `SMTP prêt (…)`. Un message d'erreur indique l'hôte, le port ou les identifiants fautifs.
5. Test : page de connexion → « Mot de passe oublié ? », ou fiche d'un joueur dans l'admin → « Envoyer un lien par e-mail » (l'admin est averti si l'envoi échoue).
