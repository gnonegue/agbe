import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@prisma/client';
import { ACCOUNT_REQUIRED, AuthedRequest, IS_PUBLIC, ROLES } from './decorators';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export const JWT_ISSUER = 'agbe-api';
export const JWT_AUDIENCE = 'agbe-client';

interface AccessClaims {
  sub: string;
  role: Role;
  mfa: boolean;
  ver: number;
  typ: 'access';
}

interface AccountState {
  tokenVersion: number;
  deletedAt: Date | null;
  suspendedAt: Date | null;
  role: Role;
  guest: boolean;
}

/**
 * Durée de vie de l'état d'un compte en mémoire : évite une requête SQL par appel (synchronisation toutes les 2 à 4 s,
 * en particulier). Une révocation (déconnexion globale, suspension) prend effet au plus tard après ce délai.
 */
const ACCOUNT_STATE_TTL_MS = 10_000;
const accountStates = new Map<string, { at: number; state: AccountState | null }>();

/** À appeler dès qu'un compte est révoqué, suspendu ou supprimé : la révocation reste immédiate malgré le cache. */
export function invalidateAccountState(accountId: string): void {
  accountStates.delete(accountId);
}

/** Garde globale : exige un jeton d'accès valide sauf sur les routes @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) throw new UnauthorizedException();
    const token = header.slice(7).trim();
    if (token.length === 0 || token.length > 2048) throw new UnauthorizedException();

    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      if (claims.typ !== 'access' || typeof claims.sub !== 'string' || !Number.isInteger(claims.ver)) throw new Error('bad token type');
    } catch {
      throw new UnauthorizedException();
    }
    // Révocation immédiate : le jeton doit porter la version courante du compte (déconnexion globale, vol détecté,
    // suppression, changement de mot de passe…). Le rôle est relu en base, jamais pris sur parole.
    const acc = await this.accountState(claims.sub);
    if (!acc || acc.deletedAt || acc.suspendedAt || acc.tokenVersion !== claims.ver) throw new UnauthorizedException();
    req.user = { accountId: claims.sub, role: acc.role, mfa: claims.mfa === true, guest: acc.guest };
    return true;
  }

  private async accountState(id: string): Promise<AccountState | null> {
    const now = Date.now();
    const hit = accountStates.get(id);
    if (hit && now - hit.at < ACCOUNT_STATE_TTL_MS) return hit.state;
    const state = await this.prisma.account.findUnique({ where: { id }, select: { tokenVersion: true, deletedAt: true, suspendedAt: true, role: true, guest: true } });
    // Un compte inconnu n'est pas mis en cache (un jeton forgé ne doit pas remplir la mémoire)
    if (state) {
      if (accountStates.size > 50_000) for (const [k, v] of accountStates) if (now - v.at >= ACCOUNT_STATE_TTL_MS) accountStates.delete(k);
      accountStates.set(id, { at: now, state });
    }
    return state;
  }
}

/** Vérifie les rôles. En production, un ADMIN doit en plus s'être authentifié avec la double authentification. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ENV) private readonly env: Env,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = req.user;
    // Partie sans compte : les zones réservées exigent un vrai compte
    if (user?.guest && this.reflector.getAllAndOverride<boolean>(ACCOUNT_REQUIRED, [ctx.getHandler(), ctx.getClass()])) throw new ForbiddenException('account_required');
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.length === 0) return true;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException();
    // Les routes /auth/totp/* n'ont pas de rôle requis (voir ci-dessus) : un admin sans 2FA peut toujours l'activer.
    if (user.role === 'ADMIN' && !user.mfa && this.env.NODE_ENV === 'production') throw new ForbiddenException('mfa_required');
    return true;
  }
}

/**
 * Limitation de débit par compte pour un joueur connecté, par adresse IP sinon (connexion, inscription, partie invitée…).
 * Au Togo, les opérateurs mobiles font sortir beaucoup d'abonnés par la même adresse IP publique : compter par IP les
 * actions d'un joueur connecté bloquerait ses voisins de réseau. Placée après l'authentification, qui remplit `req.user`.
 */
@Injectable()
export class AccountThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = (req as unknown as AuthedRequest).user;
    if (user?.accountId) return `acc:${user.accountId}`;
    return `ip:${String((req as { ip?: string }).ip ?? '')}`;
  }
}
