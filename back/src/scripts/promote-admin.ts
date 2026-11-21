import '../config/dotenv';
import { PrismaClient } from '@prisma/client';

// Usage : npm run admin:promote -- email@exemple.com
// Seul un accès au serveur permet de créer un administrateur (aucune route HTTP ne le permet).
// L'administrateur devra activer la double authentification avant d'accéder au back-office.

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('usage: npm run admin:promote -- <email>');
  const a = await prisma.account.update({ where: { email }, data: { role: 'ADMIN' } });
  await prisma.session.updateMany({ where: { accountId: a.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await prisma.auditLog.create({ data: { action: 'admin.promoted_cli', target: a.id } });
  // eslint-disable-next-line no-console
  console.log(`account ${a.id} is now ADMIN (TOTP ${a.totpEnabled ? 'enabled' : 'NOT enabled yet — required for admin routes'})`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
