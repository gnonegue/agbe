# AGBE — consignes permanentes

Jeu de simulation de vie au Togo (navigateur, mobile d'abord). Documents de référence : `docs/` (conception, guide technique, modèle économique, `API.md`).

## Structure
- `back/` — API NestJS 11 + Prisma 6 + PostgreSQL 16. Logique d'argent : `src/ledger`, calculs purs : `src/economy`.
- `front/` — React 19 + Three.js + i18next, PWA (Vite). Production retenue : mutualisé LWS cPanel (`docs/DEPLOIEMENT-LWS.md`, Apache `front/public/.htaccess`, build avec `AGBE_SITE_URL`). Variante Docker : nginx `front/nginx/agbe.conf.template` (domaine via `AGBE_DOMAIN`).
- `docker-compose.yml` — déploiement (db + back + front/nginx).

## Règles non négociables
1. **Le serveur décide de tout ce qui touche à l'argent.** Le client n'envoie que des intentions (id de plat, de métier, de produit), jamais un prix ni un solde.
2. **Argent en entiers** (BigInt / FCFA), taux en points de base. Jamais de `number` flottant pour l'argent.
3. **Tout mouvement passe par `LedgerService.post`** dans une transaction Prisma. Jamais d'`update` direct sur `wallet.balance`.
4. **SQL** : uniquement Prisma ou `$queryRaw` en gabarit balisé. `$queryRawUnsafe` / `$executeRawUnsafe` interdits.
5. **Validation** : chaque entrée a un DTO class-validator (whitelist + forbidNonWhitelisted). Routes protégées par défaut ; `@Public()` explicite.
6. **Paiement réel** : crédité uniquement via webhook signé vérifié du fournisseur (`src/payments`). Nouveau fournisseur = un fichier dans `providers/` + enregistrement dans `payments.module.ts`.
7. **Bilingue** : aucun texte en dur côté front ; toute clé existe dans `fr.json` ET `en.json`. Les erreurs API sont des codes traduits côté front.
8. **Paramètres de jeu** (prix, taux CNSS/AMU, SMIG, horloge…) : dans `game_setting` via `SettingsService`, avec schéma zod. Pas de constante métier en dur.
9. Secrets uniquement par variables d'environnement. Jamais de secret dans le code ni dans le front.

## Commandes
- Back : `npm run dev` · `npm run build` · `npm test` · `TEST_DATABASE_URL=… npm run test:int` · `npm run db:migrate` · `npm run db:seed` · `npm run ledger:verify` · `npm run admin:promote -- email` · `npm run admin:reset-totp -- email` (téléphone perdu : désactive la 2FA du compte, sessions révoquées)
- Front : `npm run dev` (proxy /api → :3000) · `npm run build` · `npm run typecheck`
- Toujours lancer les tests d'argent avant de valider une modification de `ledger`, `economy`, `character` ou `payments`. `npm audit` doit rester à 0.
