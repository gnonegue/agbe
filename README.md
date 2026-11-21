# AGBE — la vie au Togo

AGBE (« la vie » en éwé) est un jeu de simulation de vie, gratuit, jouable dans le navigateur (mobile d'abord). On crée un personnage togolais, on mange, on travaille, on paie son loyer et on gère son argent à Lomé. Le but est aussi d'apprendre en jouant : budget, salaire, cotisations sociales, impôts.

Les règles de conception sont dans les deux PDF du dossier `docs/` (document de conception et guide technique). Les consignes de travail permanentes (pour toi et pour Claude Code) sont dans `CLAUDE.md`.

## En bref / At a glance

**Français.** AGBE met le joueur dans la peau d'un Togolais à Lomé, capitale du Togo, en Afrique de l'Ouest. Il faut manger, payer son loyer, trouver du travail, puis, pour les plus ambitieux, **créer son entreprise comme dans la vraie vie** : passage au CFE, immatriculation RCCM et NIF, affiliation à la CNSS, déclarations à l'OTR. Derrière le jeu, un objectif : donner à toute une génération, depuis un simple téléphone, des repères concrets d'**éducation financière et d'entrepreneuriat** (budget, salaire, cotisations, impôts, épargne, tontine), dans son contexte et dans sa langue. Le projet est un prototype, gratuit pour les joueurs. Partenaires, écoles et financeurs intéressés : dtdev.tg@gmail.com.

**English.** AGBE puts players in the shoes of a young Togolese in Lomé, the capital of Togo, in West Africa. You eat, pay rent, find work and, if you're ambitious, **start a business the way it really works there**: registering with the business formalities centre (CFE), obtaining RCCM and tax numbers, joining social security (CNSS), filing with the tax office (OTR). The goal is simple: give a whole generation, from a basic phone, practical **financial literacy and entrepreneurship skills** (budgeting, wages, contributions, taxes, savings, rotating savings groups) in their own context and language. The project is a free-to-play prototype. Partners, schools and funders: dtdev.tg@gmail.com.

## Ce qui est livré (prototype)

- Comptes : inscription par e-mail, téléphone ou Google, jeu en invité, majorité vérifiée, double authentification (2FA, application TOTP), mot de passe oublié par e-mail, export et suppression des données.
- Création du personnage : profil (local, diaspora, étranger), région, condition de naissance (choix libre ou « laisser le destin décider »), apparence.
- Vie quotidienne : jauges (faim, énergie, hygiène, santé, moral, respect), logement et loyer, factures, cuisine à la maison, santé et hôpital, lieux de culte, famille.
- Travail et études : une trentaine de métiers, petits boulots et zém, université et diplômes.
- Argent et entreprise : grand livre en partie double (chaque mouvement d'argent enregistré, en ajout seul, avec contrôle d'intégrité), banques et épargne, bourse et placements, tontines, marché entre joueurs, commerce au port, création d'entreprise (CFE, RCCM / NIF, CNSS, OTR), salariés et paie, terrains et titre foncier.
- Multijoueur : présence et chat en temps réel (avec signalement), virements entre joueurs avec frais, ancienneté minimale et plafonds journaliers.
- Lomé en 3D (Three.js), déplacements (à pied, zém, taxi, bus Sotral, véhicule personnel), musique togolaise (appli Musique), visite guidée, interface en français et en anglais, application installable (PWA).
- Site public pré-rendu pour les moteurs de recherche, en français et en anglais : accueil (`/`, `/en`), « Comment jouer » (`/comment-jouer`, `/en/how-to-play`), conditions d'utilisation (`/conditions`, `/en/terms`), annonces en ligne dans le jeu (`/annonces`, `/en/ads`, avec réservation en ligne sur `/annonces/reserver`), contact (`/contact`, `/en/contact`).
- Publicités : panneaux et parcelles réservables par les annonceurs. Espaces VIP (Bronze, Argent, Or) demandés depuis le jeu et validés dans l'admin, bâtiments de marque fonctionnels (soins, repas, articles, carburant, travail) avec logo.
- Devise d'affichage au choix du joueur (FCFA, euro, dollar) : présentation seulement, les soldes restent en FCFA.
- Paiement paramétrable : un fournisseur factice (`mock`) pour le développement ; le contrat pour brancher un vrai fournisseur est prêt.
- Back-office administrateur (`/admin` : paramètres de jeu, journal d'audit, vérification du grand livre, statistiques) et initialisation d'une installation neuve (`/init`).

## Ce qui n'est PAS encore fait

- Fournisseur de paiement réel (FedaPay, CinetPay…) : voir `docs/PAIEMENT.md`.
- Vérification du téléphone par OTP SMS.
- Voyages vers les autres régions : prêts, mais fermés pour l'instant (réglage `travel.intercity`), les joueurs restent dans le Grand Lomé.
- Texte des conditions d'utilisation (`/conditions`) à faire relire ; droit applicable à confirmer dans `front/src/lib/legal.ts`.
- Première mise en ligne sur LWS : la procédure (`docs/DEPLOIEMENT-LWS.md`) n'a pas encore été déroulée sur l'hébergement.

La liste complète à traiter avant un lancement public est dans `SECURITY.md`.

## Démarrer en local

**Raccourci (une fois l'installation ci-dessous faite) :** depuis la racine du projet,

```bash
./dev.sh
```

Le script compile l'API, lance l'API (port 3000) et le jeu (port 5173), puis affiche « AGBE est prêt ». Ouvrir http://localhost:5173. **Ctrl+C** arrête les deux.

Depuis un autre terminal (ou si le terminal de `dev.sh` a été fermé) : `./stop.sh` arrête l'API et le jeu ; `./stop.sh --db` arrête aussi le conteneur `agbe_db`.

### Première installation

Prérequis : Node.js 22 (minimum 20), npm, PostgreSQL 16, openssl.

### 1. Base de données

```bash
sudo -u postgres psql -c "CREATE ROLE agbe LOGIN PASSWORD 'change-moi' CREATEDB;" \
                      -c "CREATE DATABASE agbe OWNER agbe;"
```

`CREATEDB` est nécessaire seulement pour `npm run db:migrate` (Prisma crée une base temporaire).

### 2. Configuration du back

```bash
cd back
cp .env.example .env
sed -i "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(openssl rand -base64 48)|" .env
sed -i "s|^TOTP_ENCRYPTION_KEY=.*|TOTP_ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
```

Ouvre ensuite `back/.env` et remplace `CHANGE_ME` dans `DATABASE_URL` par le mot de passe choisi à l'étape 1. Le fichier `.env` n'est jamais versionné ; ne le partage jamais. Garde `PAYMENT_PROVIDER=mock` et `ALLOW_MOCK_PAYMENTS=true` en local.

### 3. Installer, migrer, compiler, remplir

Toujours dans `back/` :

```bash
npm ci
npx prisma migrate deploy
npm run build
npm run db:seed
```

`npm run build` est obligatoire avant `db:seed` (le script tourne depuis `dist/`). Le seed crée les portefeuilles système, l'horloge du jeu, les métiers, les plats, les produits, les lieux et leurs activités ; il peut être relancé sans doublon. Il ne crée **aucune publicité** : panneaux et parcelles restent libres, à réserver par les annonceurs (« Votre publicité ici »). Sur une base existante, il retire les annonceurs fictifs des anciennes versions du seed, jamais une annonce payée ni un annonceur lié à un compte.

### 4. Lancer le back et le front

Deux terminaux.

```bash
# Terminal 1
cd back && npm run dev        # API sur http://127.0.0.1:3000

# Terminal 2
cd front && npm ci && npm run dev
```

Ouvre http://localhost:5173. Le front relaie `/api` vers le back (proxy Vite). Pour tester un achat, le fournisseur `mock` affiche une page « Paiement simulé ».

## Tests et contrôles

```bash
cd back
npm test                                        # tests unitaires (calculs d'économie, âge…)
TEST_DATABASE_URL="postgresql://agbe:MOT_DE_PASSE@localhost:5432/agbe_test?schema=public" npm run test:int
npm run ledger:verify                           # contrôle d'intégrité du grand livre (code 1 si anomalie)
npm run typecheck

cd ../front
npm run typecheck
npm run build
```

Pour `test:int`, utilise une base de test séparée, jamais la base de développement : crée-la (`CREATE DATABASE agbe_test OWNER agbe;`) et applique-y les migrations avec `DATABASE_URL=<url de test> npx prisma migrate deploy`. Sans `TEST_DATABASE_URL`, `npm test` ignore les tests d'intégration. Lance toujours les tests avant de valider une modification de `ledger`, `economy`, `character` ou `payments`, et garde `npm audit` à 0.

## Initialiser une nouvelle installation (page /init)

Sur un serveur neuf, une seule page fait tout : création des tables, données du jeu (lieux, métiers, prix, portefeuilles système) et premier compte administrateur.

1. Dans le fichier `.env` du serveur (`back/.env` sans Docker, `.env` à la racine avec Docker), renseigne toutes les variables puis ajoute un mot de passe d'initialisation d'au moins 16 caractères :

   ```bash
   INIT_SECRET=$(openssl rand -base64 24)   # à recopier dans le .env
   ```

2. Compile et démarre l'API (`npm run build` puis `npm start` dans `back/`, l'application Node.js de cPanel sur LWS, ou `docker compose up -d`), puis déploie le front.
3. Ouvre `https://ton-domaine/init` et remplis le formulaire :
   - le mot de passe d'initialisation (la valeur de `INIT_SECRET`) ;
   - le premier administrateur : nom d'utilisateur, e-mail, téléphone (+228…), mot de passe (10 caractères au moins), date de naissance (18 ans au moins).
4. Clique sur « Initialiser » (quelques secondes à quelques minutes). L'adresse e-mail n'a pas besoin d'être vérifiée : l'envoi d'e-mails (SMTP) peut être configuré plus tard.
5. Connecte-toi avec ce compte, active la double authentification dans Réglages > Sécurité (obligatoire pour `/admin`), puis ouvre `/admin`.
6. **Vide `INIT_SECRET`** dans le `.env` et redémarre l'API : la page est alors désactivée.

Sécurité : sans `INIT_SECRET`, la page n'existe pas ; le mot de passe est comparé à temps constant ; 5 essais par minute au plus ; protection anti-CSRF ; la page se verrouille définitivement dès qu'un administrateur existe ; chaque initialisation est journalisée. En cas d'échec, le détail est dans les journaux de l'API (jamais affiché dans la page).

Avec Docker, les migrations sont déjà appliquées par le service `migrate` (le rôle applicatif n'a pas le droit de créer des tables) : `/init` charge alors les données et crée l'administrateur.

Une installation neuve démarre avec la carte complète et sans aucune publicité. Les visiteurs arrivent sur le site public : présentation du jeu (captures, services publics, musique togolaise, inspirations), guide « Comment jouer », annonces en ligne dans le jeu, conditions d'utilisation et offre de partenariats publicitaires.

## Créer un administrateur

Pour promouvoir un autre compte plus tard :

1. Crée un compte normalement depuis le jeu (e-mail).
2. Sur la machine du serveur, depuis `back/` (après `npm run build`) :

   ```bash
   npm run admin:promote -- ton.email@exemple.com
   ```

   (En production Docker : voir `docs/DEPLOIEMENT.md`.) Cette commande révoque les sessions du compte : reconnecte-toi.
3. Dans le jeu : Réglages > Sécurité, active la double authentification. Elle est obligatoire pour toutes les routes `/api/admin/*`.
4. Reconnecte-toi avec le code à 6 chiffres. Une session administrateur dure au maximum 12 h.

Les paramètres modifiables et la manière de les changer sont dans `docs/PARAMETRES.md`.

## Arborescence

```
AGBE/
├── CLAUDE.md               consignes permanentes (règles non négociables, commandes)
├── README.md               ce fichier
├── SECURITY.md             sécurité, audits, reste à faire, signaler une faille
├── docker-compose.yml      déploiement sur un serveur avec Docker (db, migrate, back, front/nginx)
├── .env.example            variables du déploiement Docker (copier en .env)
├── infra/db-init.sh        crée le rôle PostgreSQL à moindre privilège (agbe_app)
├── docs/                   conception (PDF), API.md, DEPLOIEMENT-LWS.md, DEPLOIEMENT.md, PAIEMENT.md, PARAMETRES.md
├── back/                   API NestJS + Prisma + PostgreSQL
│   ├── prisma/             schema.prisma et migrations
│   └── src/
│       ├── auth/ account/  comptes, sessions, 2FA
│       ├── character/      personnage et actions de vie quotidienne
│       ├── ledger/         grand livre (tout l'argent passe ici)
│       ├── economy/        calculs purs : horloge, besoins, paie, destin
│       ├── payments/       contrat PaymentProvider et fournisseurs
│       ├── settings/       paramètres de jeu (schémas zod)
│       ├── admin/          routes d'administration
│       └── scripts/        seed, promote-admin, verify-ledger
└── front/                  React 19 + Three.js + i18next (Vite, PWA)
    ├── nginx/              configuration nginx du déploiement Docker (agbe.conf.template, snippets)
    ├── public/.htaccess    configuration Apache de l'hébergement mutualisé (LWS)
    ├── scripts/prerender.mjs  pages publiques pré-rendues au build (AGBE_SITE_URL : domaine du site)
    └── src/                api, game (3D), screens, phone (applis du téléphone), i18n, lib
```

## Autres documents

- `CLAUDE.md` : règles du projet et commandes courantes.
- `docs/API.md` : contrat de l'API.
- `docs/DEPLOIEMENT-LWS.md` : **mise en production retenue**, sur l'hébergement mutualisé LWS (cPanel : Node.js et PostgreSQL).
- `docs/DEPLOIEMENT.md` : mise en production sur un serveur avec Docker (VPS), certificat, sauvegardes.
- `docs/PAIEMENT.md` : brancher un vrai fournisseur de paiement.
- `docs/PARAMETRES.md` : paramètres de jeu modifiables.
- `SECURITY.md` : mesures de sécurité et reste à faire.
- `docs/AGBE - Document de conception.pdf`, `docs/AGBE - Guide technique.pdf`.

## Licence / License

**Français.** Code sous licence [PolyForm Noncommercial 1.0.0](LICENSE) : usage non commercial libre (étude, essais, enseignement, projets personnels) ; tout usage commercial demande l'accord de l'auteur. Les ressources tierces (Kenney, OpenStreetMap) gardent leurs licences, voir `docs/CREDITS.md`.

**English.** Code released under the [PolyForm Noncommercial License 1.0.0](LICENSE): free for noncommercial use (study, testing, teaching, personal projects); any commercial use requires the author's permission. Third-party assets (Kenney, OpenStreetMap) keep their own licenses, see `docs/CREDITS.md`.
