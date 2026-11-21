import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AdminController } from './admin.module';
import type { AuthUser } from '../common/decorators';

const admin: AuthUser = { accountId: '11111111-1111-4111-8111-111111111111', role: 'ADMIN', mfa: true, guest: false };
const dto = { confirm: 'RESET' };

function make(acc: { guest: boolean } | null, reset = vi.fn(async () => 'tmp-password-xx')) {
  const audit = { log: vi.fn(async () => undefined) };
  const prisma = { account: { findFirst: vi.fn(async () => acc) } };
  const auth = { resetPassword: reset };
  const ctl = new AdminController({} as never, audit as never, prisma as never, {} as never, auth as never);
  return { ctl, audit, auth };
}

describe('Admin reset mot de passe', () => {
  it('refuse soi-même, un invité et un compte absent', async () => {
    const self = make({ guest: false });
    await expect(self.ctl.resetPassword(admin, admin.accountId, dto, '1.1.1.1')).rejects.toThrow(ForbiddenException);
    const guest = make({ guest: true });
    await expect(guest.ctl.resetPassword(admin, '22222222-2222-4222-8222-222222222222', dto, '1.1.1.1')).rejects.toThrow(BadRequestException);
    const missing = make(null);
    await expect(missing.ctl.resetPassword(admin, '22222222-2222-4222-8222-222222222222', dto, '1.1.1.1')).rejects.toThrow(NotFoundException);
  });

  it('renvoie le secret une fois et journalise sans le mot de passe', async () => {
    const { ctl, audit, auth } = make({ guest: false });
    const id = '22222222-2222-4222-8222-222222222222';
    await expect(ctl.resetPassword(admin, id, dto, '9.9.9.9')).resolves.toEqual({ password: 'tmp-password-xx' });
    expect(auth.resetPassword).toHaveBeenCalledWith(id);
    expect(audit.log).toHaveBeenCalledWith('admin.user_password_reset', { actorId: admin.accountId, target: id, ip: '9.9.9.9' });
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('tmp-password-xx');
  });
});
