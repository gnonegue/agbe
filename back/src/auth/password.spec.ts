import { describe, expect, it, vi } from 'vitest';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';

describe('AuthService.resetPassword', () => {
  it('hashe le secret, révoque les sessions, et ne stocke pas le clair', async () => {
    const hashes: string[] = [];
    const prisma = {
      account: {
        update: vi.fn(async ({ data }: { data: { passwordHash?: string } }) => {
          if (data.passwordHash) hashes.push(data.passwordHash);
          return {};
        }),
      },
      session: { updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    const svc = new AuthService(prisma as never, {} as never, { log: vi.fn() } as never, {} as never, {} as never);
    const password = await svc.resetPassword('acc-1');
    expect(password.length).toBeGreaterThanOrEqual(10);
    expect(hashes).toHaveLength(1);
    expect(await argon2.verify(hashes[0], password)).toBe(true);
    expect(prisma.session.updateMany).toHaveBeenCalledWith({ where: { accountId: 'acc-1', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(JSON.stringify(prisma.account.update.mock.calls)).not.toContain(password);
  });
});
