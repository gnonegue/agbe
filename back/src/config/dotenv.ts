import { existsSync } from 'node:fs';

// Charge `.env` s'il existe (développement). N'écrase jamais une variable déjà définie par l'environnement.
if (existsSync('.env')) process.loadEnvFile('.env');
