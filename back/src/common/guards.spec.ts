import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './guards';
import { ACCOUNT_REQUIRED, ROLES, type AuthUser } from './decorators';

// Mode invité : les zones « compte requis » refusent les invités, sans gêner les vrais comptes.
const ctx = (user: AuthUser, required: boolean, roles?: string[]): ExecutionContext => {
  const handler = () => undefined;
  if (required) Reflect.defineMetadata(ACCOUNT_REQUIRED, true, handler);
  if (roles) Reflect.defineMetadata(ROLES, roles, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
};

describe('RolesGuard et invités', () => {
  const guard = new RolesGuard(new Reflector(), { NODE_ENV: 'production' } as never);
  const player: AuthUser = { accountId: 'a', role: 'PLAYER', mfa: false, guest: false };
  const guest: AuthUser = { ...player, guest: true };

  it('refuse un invité sur une route réservée aux comptes', () => {
    expect(() => guard.canActivate(ctx(guest, true))).toThrow('account_required');
  });
  it('laisse passer un invité ailleurs, et un vrai compte partout', () => {
    expect(guard.canActivate(ctx(guest, false))).toBe(true);
    expect(guard.canActivate(ctx(player, true))).toBe(true);
  });
});

// Un ADMIN ne peut pas atteindre une route @Roles('ADMIN') en production sans s'être authentifié en 2FA.
describe('RolesGuard et la double authentification admin', () => {
  const admin: AuthUser = { accountId: 'a', role: 'ADMIN', mfa: false, guest: false };
  const adminMfa: AuthUser = { ...admin, mfa: true };

  it("refuse un admin sans 2FA sur une route @Roles('ADMIN') en production", () => {
    const guard = new RolesGuard(new Reflector(), { NODE_ENV: 'production' } as never);
    expect(() => guard.canActivate(ctx(admin, false, ['ADMIN']))).toThrow('mfa_required');
  });
  it('laisse passer un admin dont la session a vérifié la 2FA', () => {
    const guard = new RolesGuard(new Reflector(), { NODE_ENV: 'production' } as never);
    expect(guard.canActivate(ctx(adminMfa, false, ['ADMIN']))).toBe(true);
  });
  it("une route sans rôle requis (ex. /auth/totp/setup) reste accessible sans 2FA", () => {
    const guard = new RolesGuard(new Reflector(), { NODE_ENV: 'production' } as never);
    expect(guard.canActivate(ctx(admin, false))).toBe(true);
  });
  it('hors production, la 2FA admin ne bloque pas', () => {
    const guard = new RolesGuard(new Reflector(), { NODE_ENV: 'development' } as never);
    expect(guard.canActivate(ctx(admin, false, ['ADMIN']))).toBe(true);
  });
});
