import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '@prisma/client';

export interface AuthUser {
  accountId: string;
  role: Role;
  mfa: boolean;
  /** Partie sans compte (invité). */
  guest: boolean;
}

export type AuthedRequest = Request & { user?: AuthUser };

export const IS_PUBLIC = 'agbe:isPublic';
/** Route accessible sans authentification. Par défaut, TOUT est protégé. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ACCOUNT_REQUIRED = 'agbe:accountRequired';
/** Réservé aux vrais comptes : un invité reçoit « account_required » (paiements, banque, transferts…). */
export const AccountRequired = () => SetMetadata(ACCOUNT_REQUIRED, true);

export const ROLES = 'agbe:roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw new Error('CurrentUser used on a public route');
  return req.user;
});

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return (req.ip ?? '').slice(0, 64);
});
