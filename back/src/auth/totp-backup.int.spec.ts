import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService, type ClientInfo } from './auth.service';

// Codes de secours 2FA : montrés une fois à l'activation, chacun à usage unique, pour le cas où le
// téléphone avec l'appli d'authentification est perdu (voir aussi npm run admin:reset-totp côté serveur).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Codes de secours 2FA (PostgreSQL)', () => {
  let prisma: PrismaService;
  let auth: AuthService;
  let accountId: string;
  const tag = Date.now().toString(36);
  const email = `totp-${tag}@test.tg`;
  const password = 'Correct-Horse-1!';
  const client: ClientInfo = { ip: '41.207.1.2', userAgent: 'vitest' };

  async function mfaToken(): Promise<string> {
    const r = await auth.login({ identifier: email, password } as never, client);
    if (r.kind !== 'mfa') throw new Error('expected mfa challenge');
    return r.mfaToken;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const env = {
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'x'.repeat(32),
      JWT_ACCESS_TTL_SECONDS: 900,
      TOTP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      REFRESH_TTL_DAYS: 30,
    };
    const audit = { log: async () => undefined };
    auth = new AuthService(prisma, new JwtService(), audit as never, env as never, {} as never);
    const acc = await prisma.account.create({ data: { email, passwordHash: await argon2.hash(password), birthDate: new Date('1995-01-01') } });
    accountId = acc.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('active la 2FA, reçoit 8 codes de secours, chacun utilisable une seule fois', async () => {
    const { secret } = await auth.totpSetup(accountId, password);
    const { backupCodes } = await auth.totpEnable(accountId, authenticator.generate(secret), client.ip);
    expect(backupCodes).toHaveLength(8);
    for (const c of backupCodes) expect(c).toMatch(/^\d{10}$/);

    await auth.verifyMfa(await mfaToken(), backupCodes[0]!, client);
    // Le même code ne fonctionne plus une seconde fois.
    await expect(auth.verifyMfa(await mfaToken(), backupCodes[0]!, client)).rejects.toThrow('invalid_mfa');
    // Les autres codes restent valables.
    await auth.verifyMfa(await mfaToken(), backupCodes[1]!, client);
  });

  it('régénérer remplace tous les anciens codes par des nouveaux', async () => {
    const before = (await prisma.account.findUniqueOrThrow({ where: { id: accountId } })).totpBackupCodes;
    const { backupCodes: fresh } = await auth.regenerateBackupCodes(accountId, password, client.ip);
    expect(fresh).toHaveLength(8);
    const after = (await prisma.account.findUniqueOrThrow({ where: { id: accountId } })).totpBackupCodes;
    expect(after.some((h) => before.includes(h))).toBe(false);
    await auth.verifyMfa(await mfaToken(), fresh[0]!, client);
  });

  it('refuse de régénérer avec le mauvais mot de passe', async () => {
    await expect(auth.regenerateBackupCodes(accountId, 'wrong-password', client.ip)).rejects.toThrow('invalid_password');
  });

  it('désactiver la 2FA : connexion directe ensuite, codes de secours effacés', async () => {
    await auth.totpDisable(accountId, password, client.ip);
    const acc = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(acc).toMatchObject({ totpEnabled: false, totpSecret: null, totpBackupCodes: [] });
    const r = await auth.login({ identifier: email, password } as never, client);
    expect(r.kind).toBe('tokens');
  });
});
