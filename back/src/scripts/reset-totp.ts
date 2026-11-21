import '../config/dotenv';
import { PrismaClient } from '@prisma/client';

// Usage : npm run admin:reset-totp -- email@exemple.com
// Récupération en cas de téléphone perdu/cassé (l'application d'authentification n'a pas de codes de secours) :
// seul un accès au serveur permet de désactiver la double authentification d'un compte, jamais une route HTTP.
// Le compte redevient accessible au mot de passe seul ; en production, un ADMIN devra la réactiver avant de
// retrouver l'accès au back-office (voir RolesGuard). Les sessions actives sont révoquées par précaution.

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('usage: npm run admin:reset-totp -- <email>');
  const a = await prisma.account.update({ where: { email }, data: { totpEnabled: false, totpSecret: null, totpLastStep: null } });
  await prisma.session.updateMany({ where: { accountId: a.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await prisma.auditLog.create({ data: { action: 'admin.totp_reset_cli', target: a.id } });
  // eslint-disable-next-line no-console
  console.log(`account ${a.id}: TOTP reset, all sessions revoked`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
