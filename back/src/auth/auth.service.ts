import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Account } from '@prisma/client';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { ENV, Env } from '../config/env';
import { JWT_AUDIENCE, JWT_ISSUER } from '../common/guards';
import { decryptSecret, encryptSecret, generateBackupCodes, randomToken, sha256Hex } from '../common/crypto';
import { GoogleCompleteDto, LoginDto, RegisterDto, GuestDto, UpgradeDto, USERNAME } from './auth.dto';
import { authorizeUrl, checkIdToken, exchangeCode, pkcePair, randomState } from './google';
import { ageAt, MIN_AGE } from './age';
import { invalidateAccountState } from '../common/guards';
import { MailService } from '../mail/mail.service';
import { renderPasswordChangedMail, renderResetMail, type MailLocale } from '../mail/mail.templates';

// Paramètres Argon2id recommandés par l'OWASP.
const ARGON_OPTS: argon2.HashOptions & { raw?: false } = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };
const TERMS_VERSION = '2026-10';
const TOTP_STEP_SECONDS = 30;
// Lien de réinitialisation envoyé par e-mail : valable 1 h, à usage unique ; au plus un envoi par minute et par compte.
const RESET_TTL_MINUTES = 60;
const RESET_COOLDOWN_MS = 60_000;

// Verrouillage du mot de passe :
//  - par couple (compte, IP) : 5 échecs → 15 min de blocage pour CETTE IP seulement (un tiers ne bloque pas la victime) ;
//  - global par compte : 30 échecs → 15 min (freine les attaques distribuées sur de nombreuses IP).
const PAIR_MAX_FAILURES = 5;
const ACCOUNT_MAX_FAILURES = 30;
const LOCK_MS = 15 * 60_000;
// 2FA : compteur dédié, jamais remis à zéro par un mot de passe correct.
const MFA_MAX_FAILURES = 5;
// Durée maximale d'une session depuis la vraie authentification (la rotation ne la prolonge pas).
const SESSION_MAX_MS = { PLAYER: 30 * 86_400_000, ADMIN: 12 * 3_600_000 } as const;
// Tolérance de rotation : un jeton remplacé il y a moins de 30 s (deux onglets, réponse perdue sur réseau mobile)
// n'est pas traité comme un vol. Au-delà, ou si la session a été fermée autrement que par rotation : détection de vol.
const ROTATION_GRACE_MS = 30_000;

authenticator.options = { step: TOTP_STEP_SECONDS, window: 1 };

export interface ClientInfo {
  ip: string;
  userAgent: string;
}

export interface IssuedTokens {
  accessToken: string;
  accessExpiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export type LoginResult = { kind: 'tokens'; tokens: IssuedTokens } | { kind: 'mfa'; mfaToken: string };

/** Issue d'un retour de Google : session ouverte, suite à donner depuis la page (cookie provisoire), ou erreur à afficher. */
export type GoogleOutcome =
  | { kind: 'tokens'; tokens: IssuedTokens }
  | { kind: 'pending'; next: 'signup' | 'link' | 'mfa'; token: string }
  | { kind: 'error'; reason: 'google_disabled' | 'google_denied' | 'google_failed' | 'account_suspended' };

/** Ce que la page apprend d'un retour de Google en attente (jamais le jeton lui-même, sauf le défi 2FA, valable 5 min). */
export interface GooglePending {
  kind: 'signup' | 'link' | 'mfa';
  email?: string;
  name?: string;
  mfaToken?: string;
}

/** Compteur d'échecs (compte, IP) en mémoire, borné. En multi-instance : à déplacer dans Redis. */
class PairLimiter {
  private readonly map = new Map<string, { count: number; until: number; first: number }>();
  private static readonly MAX_KEYS = 100_000;

  isBlocked(key: string): boolean {
    const e = this.map.get(key);
    return !!e && e.until > Date.now();
  }

  fail(key: string): void {
    const now = Date.now();
    let e = this.map.get(key);
    if (!e || now - e.first > LOCK_MS) e = { count: 0, until: 0, first: now };
    e.count++;
    if (e.count >= PAIR_MAX_FAILURES) e.until = now + LOCK_MS;
    this.map.delete(key);
    this.map.set(key, e);
    if (this.map.size > PairLimiter.MAX_KEYS) this.map.delete(this.map.keys().next().value!);
  }

  reset(key: string): void {
    this.map.delete(key);
  }
}

/** Doublon à l'inscription : nom d'utilisateur déjà pris, ou e-mail / téléphone déjà utilisé. */
function takenCode(e: unknown): string {
  const target = (e as { meta?: { target?: unknown } }).meta?.target;
  return String(target ?? '').includes('username') ? 'username_taken' : 'account_exists';
}

@Injectable()
export class AuthService {
  /** Hachage factice, vérifié quand le compte n'existe pas : même temps de réponse, pas d'énumération. */
  private dummyHash: Promise<string>;
  private readonly pairs = new PairLimiter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
    private readonly mail: MailService,
  ) {
    this.dummyHash = argon2.hash(randomToken(), ARGON_OPTS);
  }

  /** Disponibilité d'un nom d'utilisateur, vérifiée pendant la saisie (avant de soumettre tout le formulaire). */
  async usernameAvailable(usernameRaw: string): Promise<{ available: boolean }> {
    const username = String(usernameRaw ?? '').trim().toLowerCase();
    if (!USERNAME.test(username)) throw new BadRequestException('invalid_username');
    const account = await this.prisma.account.findUnique({ where: { username }, select: { id: true } });
    return { available: !account };
  }

  async register(dto: RegisterDto, client: ClientInfo): Promise<IssuedTokens> {
    if (!dto.email || !dto.phone) throw new BadRequestException('email_and_phone_required');
    const age = ageAt(dto.birthDate);
    if (age === null) throw new BadRequestException('invalid_birth_date');
    if (age < MIN_AGE) throw new ForbiddenException('underage');
    const pw = dto.password.toLowerCase();
    if (pw === dto.email.toLowerCase() || pw === dto.phone.toLowerCase() || pw === dto.username) {
      throw new BadRequestException('weak_password');
    }

    const passwordHash = await argon2.hash(dto.password, ARGON_OPTS);
    let account: Account;
    try {
      account = await this.prisma.account.create({
        data: {
          email: dto.email,
          phone: dto.phone,
          username: dto.username,
          passwordHash,
          birthDate: new Date(`${dto.birthDate}T00:00:00Z`),
          locale: dto.locale,
          currency: dto.currency ?? 'XOF',
          consents: { create: [{ kind: 'terms', version: TERMS_VERSION }, { kind: 'privacy', version: TERMS_VERSION }] },
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException(takenCode(e));
      throw e;
    }
    await this.audit.log('auth.register', { actorId: account.id, ip: client.ip });
    return this.issueSession(account, false, client);
  }

  /** Partie sans compte : compte invité sans identifiant ni mot de passe utilisable, session sur cet appareil. */
  async guest(dto: GuestDto, client: ClientInfo): Promise<IssuedTokens> {
    const age = ageAt(dto.birthDate);
    if (age === null) throw new BadRequestException('invalid_birth_date');
    if (age < MIN_AGE) throw new ForbiddenException('underage');
    const account = await this.prisma.account.create({
      data: {
        guest: true,
        passwordHash: await argon2.hash(randomToken(32), ARGON_OPTS),
        birthDate: new Date(`${dto.birthDate}T00:00:00Z`),
        locale: dto.locale,
        currency: dto.currency ?? 'XOF',
        consents: { create: [{ kind: 'terms', version: TERMS_VERSION }, { kind: 'privacy', version: TERMS_VERSION }] },
      },
    });
    await this.audit.log('auth.guest', { actorId: account.id, ip: client.ip });
    return this.issueSession(account, false, client);
  }

  /** Un invité crée son vrai compte (e-mail, téléphone, mot de passe) en gardant sa partie. */
  async upgrade(accountId: string, dto: UpgradeDto, client: ClientInfo): Promise<void> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || !account.guest) throw new BadRequestException('not_guest');
    const pw = dto.password.toLowerCase();
    if (pw === dto.email.toLowerCase() || pw === dto.phone.toLowerCase() || pw === dto.username) throw new BadRequestException('weak_password');
    try {
      await this.prisma.account.update({
        where: { id: accountId, guest: true },
        data: { guest: false, email: dto.email, phone: dto.phone, username: dto.username, passwordHash: await argon2.hash(dto.password, ARGON_OPTS) },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException(takenCode(e));
      throw e;
    }
    await this.audit.log('auth.upgrade', { actorId: accountId, ip: client.ip });
  }

  async login(dto: LoginDto, client: ClientInfo): Promise<LoginResult> {
    const id = dto.identifier.trim();
    // Connexion par e-mail, téléphone (+228…) ou nom d'utilisateur
    const where = id.includes('@') ? { email: id.toLowerCase() } : /^\+?\d/.test(id) ? { phone: id } : { username: id.toLowerCase() };
    const account = await this.prisma.account.findUnique({ where });
    const pairKey = `${account?.id ?? id}|${client.ip}`;

    const blocked = this.pairs.isBlocked(pairKey) || (account?.lockedUntil != null && account.lockedUntil > new Date());
    if (!account || account.deletedAt || blocked) {
      await argon2.verify(await this.dummyHash, dto.password).catch(() => false);
      if (account && blocked) await this.audit.log('auth.login_blocked', { actorId: account.id, ip: client.ip });
      else this.pairs.fail(pairKey);
      throw new UnauthorizedException('invalid_credentials');
    }

    const ok = await argon2.verify(account.passwordHash, dto.password).catch(() => false);
    if (!ok) {
      this.pairs.fail(pairKey);
      await this.registerPasswordFailure(account.id, client);
      throw new UnauthorizedException('invalid_credentials');
    }

    this.pairs.reset(pairKey);
    await this.prisma.account.update({ where: { id: account.id }, data: { failedLogins: 0, lockedUntil: null } });
    // Suspendu : annoncé seulement après un mot de passe correct (pas d'indice sur l'existence du compte)
    if (account.suspendedAt) throw new ForbiddenException('account_suspended');

    if (account.totpEnabled) {
      const mfaToken = await this.jwt.signAsync(
        { sub: account.id, typ: 'mfa' },
        { secret: this.env.JWT_ACCESS_SECRET, expiresIn: 300, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, algorithm: 'HS256' },
      );
      return { kind: 'mfa', mfaToken };
    }
    await this.audit.log('auth.login', { actorId: account.id, ip: client.ip });
    return { kind: 'tokens', tokens: await this.issueSession(account, false, client) };
  }

  async verifyMfa(mfaToken: string, code: string, client: ClientInfo): Promise<IssuedTokens> {
    let sub: string;
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string; typ: string }>(mfaToken, {
        secret: this.env.JWT_ACCESS_SECRET,
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      if (claims.typ !== 'mfa') throw new Error('bad type');
      sub = claims.sub;
    } catch {
      throw new UnauthorizedException('invalid_mfa');
    }
    const account = await this.prisma.account.findUnique({ where: { id: sub } });
    if (!account || account.deletedAt || !account.totpEnabled || !account.totpSecret) throw new UnauthorizedException('invalid_mfa');
    if (account.mfaLockedUntil && account.mfaLockedUntil > new Date()) throw new UnauthorizedException('invalid_mfa');

    // Code de l'appli d'authentification (6 chiffres), ou code de secours à usage unique (10 chiffres) si le
    // téléphone est perdu.
    const ok = code.length === 6 ? await this.consumeTotp(account, code) : await this.consumeBackupCode(account, code);
    if (!ok) {
      // Incrément atomique : des essais concurrents ne contournent pas la limite.
      const { mfaFailures } = await this.prisma.account.update({
        where: { id: account.id },
        data: { mfaFailures: { increment: 1 } },
        select: { mfaFailures: true },
      });
      if (mfaFailures >= MFA_MAX_FAILURES) {
        await this.prisma.account.update({ where: { id: account.id }, data: { mfaFailures: 0, mfaLockedUntil: new Date(Date.now() + LOCK_MS) } });
        await this.audit.log('auth.mfa_locked', { actorId: account.id, ip: client.ip });
      } else {
        await this.audit.log('auth.mfa_failed', { actorId: account.id, ip: client.ip });
      }
      throw new UnauthorizedException('invalid_mfa');
    }
    await this.prisma.account.update({ where: { id: account.id }, data: { mfaFailures: 0, mfaLockedUntil: null } });
    await this.audit.log('auth.login_mfa', { actorId: account.id, ip: client.ip });
    return this.issueSession(account, true, client);
  }

  /** Rotation du jeton de rafraîchissement, avec détection de réutilisation (vol de jeton). */
  async refresh(rawToken: string, client: ClientInfo): Promise<IssuedTokens> {
    if (!rawToken || rawToken.length > 128) throw new UnauthorizedException();
    const tokenHash = sha256Hex(rawToken);
    const session = await this.prisma.session.findUnique({ where: { tokenHash }, include: { account: true } });
    if (!session) throw new UnauthorizedException();

    if (session.revokedAt && (await this.withinRotationGrace(session))) {
      return this.issueSession(session.account, session.mfa, client, session.familyId, session.authAt);
    }
    if (session.revokedAt) {
      // Un jeton déjà utilisé revient : quelqu'un l'a volé. On coupe toute la famille ET les jetons d'accès en cours.
      await this.prisma.session.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.bumpTokenVersion(session.accountId);
      await this.audit.log('auth.refresh_reuse_detected', { actorId: session.accountId, ip: client.ip });
      throw new UnauthorizedException();
    }
    const maxAge = SESSION_MAX_MS[session.account.role];
    if (session.expiresAt < new Date() || session.account.deletedAt || session.account.suspendedAt || Date.now() - session.authAt.getTime() > maxAge) {
      throw new UnauthorizedException();
    }

    // Révocation ET désignation du successeur en une seule écriture atomique : une requête concurrente
    // voit immédiatement qu'il s'agit d'une rotation (et non d'un vol).
    const successorId = randomUUID();
    const claimed = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date(), replacedById: successorId },
    });
    if (claimed.count !== 1) {
      // Perdu la course face à une rotation concurrente (deux onglets) : tolérée dans la fenêtre de grâce.
      const now = await this.prisma.session.findUnique({ where: { id: session.id }, include: { account: true } });
      if (now?.revokedAt && (await this.withinRotationGrace(now))) {
        return this.issueSession(now.account, now.mfa, client, now.familyId, now.authAt);
      }
      throw new UnauthorizedException();
    }
    return this.issueSession(session.account, session.mfa, client, session.familyId, session.authAt, successorId);
  }

  /** Jeton remplacé par rotation il y a moins de 30 s, chaîne toujours vivante, session dans sa durée maximale. */
  private async withinRotationGrace(s: { revokedAt: Date | null; replacedById: string | null; authAt: Date; account: Account }): Promise<boolean> {
    if (!s.revokedAt || !s.replacedById || Date.now() - s.revokedAt.getTime() >= ROTATION_GRACE_MS) return false;
    if (s.account.deletedAt || s.account.suspendedAt || Date.now() - s.authAt.getTime() > SESSION_MAX_MS[s.account.role]) return false;
    const successor = await this.prisma.session.findUnique({ where: { id: s.replacedById }, select: { revokedAt: true, replacedById: true } });
    // Successeur en cours de création, encore actif, ou seulement tourné à son tour — jamais déconnecté ni révoqué pour vol.
    return !successor || successor.revokedAt === null || successor.replacedById !== null;
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken || rawToken.length > 128) return;
    await this.prisma.session.updateMany({ where: { tokenHash: sha256Hex(rawToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Révoque toutes les sessions ET invalide immédiatement tous les jetons d'accès émis. */
  async logoutAll(accountId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.bumpTokenVersion(accountId);
  }

  async bumpTokenVersion(accountId: string): Promise<void> {
    await this.prisma.account.update({ where: { id: accountId }, data: { tokenVersion: { increment: 1 } } });
    invalidateAccountState(accountId);
  }

  async changePassword(accountId: string, current: string, next: string, ip: string): Promise<void> {
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    if (!(await argon2.verify(account.passwordHash, current).catch(() => false))) throw new ForbiddenException('invalid_password');
    if (current === next) throw new BadRequestException('same_password');
    if (next.toLowerCase() === (account.email ?? account.phone ?? '').toLowerCase()) throw new BadRequestException('weak_password');
    await this.setPasswordHash(accountId, next);
    await this.audit.log('auth.password_changed', { actorId: accountId, ip });
  }

  /**
   * Nouveau mot de passe choisi par un administrateur (mot de passe oublié, compte récupéré). Même politique
   * qu'à l'inscription ; toutes les sessions du compte sont révoquées. Un invité n'a pas d'identifiants.
   */
  async adminSetPassword(accountId: string, next: string): Promise<void> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, deletedAt: null } });
    if (!account) throw new NotFoundException('not_found');
    if (account.guest) throw new BadRequestException('account_required');
    const pw = next.toLowerCase();
    if ([account.email, account.phone, account.username].some((x) => x && x.toLowerCase() === pw)) throw new BadRequestException('weak_password');
    await this.setPasswordHash(accountId, next);
  }

  // ───────────── Mot de passe oublié (lien envoyé par e-mail) ─────────────

  /**
   * Demande depuis la page de connexion. Répond toujours pareil (compte inconnu, invité, e-mail déjà envoyé il y a
   * moins d'une minute) et n'attend pas l'envoi : ni message ni délai ne révèlent si une adresse a un compte.
   */
  async requestPasswordReset(emailRaw: string, ip: string): Promise<void> {
    const email = emailRaw.trim().toLowerCase();
    const account = await this.prisma.account.findFirst({ where: { email, deletedAt: null, guest: false } });
    if (!account) return;
    void this.issueResetLink(account, { byAdmin: false, ip }).catch(() => undefined);
  }

  /** Envoi d'un lien à la demande d'un administrateur : dit si le message est bien parti (SMTP configuré et joignable). */
  async sendResetLink(accountId: string, adminId: string, ip: string): Promise<boolean> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, deletedAt: null } });
    if (!account) throw new NotFoundException('not_found');
    if (account.guest || !account.email) throw new BadRequestException('email_required');
    const sent = await this.issueResetLink(account, { byAdmin: true, ip });
    await this.audit.log('admin.user_reset_link_sent', { actorId: adminId, target: accountId, meta: { sent }, ip });
    return sent;
  }

  private async issueResetLink(account: Account, opts: { byAdmin: boolean; ip: string }): Promise<boolean> {
    if (!account.email) return false;
    const now = new Date();
    if (!opts.byAdmin) {
      const recent = await this.prisma.passwordReset.findFirst({ where: { accountId: account.id, createdAt: { gt: new Date(now.getTime() - RESET_COOLDOWN_MS) } } });
      if (recent) return false;
    }
    const token = randomToken(32);
    // Un seul lien valable à la fois : les précédents sont invalidés.
    await this.prisma.passwordReset.updateMany({ where: { accountId: account.id, usedAt: null }, data: { usedAt: now } });
    await this.prisma.passwordReset.create({
      data: { accountId: account.id, tokenHash: sha256Hex(token), expiresAt: new Date(now.getTime() + RESET_TTL_MINUTES * 60_000), byAdmin: opts.byAdmin, ip: opts.ip.slice(0, 64) },
    });
    const link = `${this.mailBase()}/?reset=${token}`;
    const mail = renderResetMail({ locale: this.mailLocale(account), name: account.username, link, minutes: RESET_TTL_MINUTES, byAdmin: opts.byAdmin });
    if (!opts.byAdmin) await this.audit.log('auth.reset_requested', { actorId: account.id, ip: opts.ip });
    return this.mail.send({ to: account.email, ...mail });
  }

  /** Base des liens envoyés par e-mail : MAIL_LINK_URL (tunnel de test), sinon PUBLIC_APP_URL ; jamais l'en-tête Host de la requête. */
  private mailBase(): string {
    return (this.env.MAIL_LINK_URL || this.env.PUBLIC_APP_URL).replace(/\/$/, '');
  }

  /** Nouveau mot de passe choisi avec le lien reçu par e-mail : jeton consommé, sessions fermées, blocages levés. */
  async resetPasswordWithToken(token: string, next: string, ip: string): Promise<void> {
    const row = await this.prisma.passwordReset.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { account: true } });
    const account = row?.account;
    if (!row || !account || row.usedAt || row.expiresAt <= new Date() || account.deletedAt || account.guest) throw new BadRequestException('invalid_reset_token');
    const pw = next.toLowerCase();
    if ([account.email, account.phone, account.username].some((x) => x && x.toLowerCase() === pw)) throw new BadRequestException('weak_password');
    // Consommation atomique : deux clics simultanés ne passent pas tous les deux.
    const used = await this.prisma.passwordReset.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) throw new BadRequestException('invalid_reset_token');
    await this.prisma.passwordReset.updateMany({ where: { accountId: account.id, usedAt: null }, data: { usedAt: new Date() } });
    await this.setPasswordHash(account.id, next);
    await this.prisma.account.update({ where: { id: account.id }, data: { failedLogins: 0, lockedUntil: null } });
    await this.audit.log('auth.password_reset', { actorId: account.id, ip, meta: { byAdmin: row.byAdmin } });
    if (account.email) {
      const mail = renderPasswordChangedMail({ locale: this.mailLocale(account), name: account.username, loginUrl: this.mailBase() });
      void this.mail.send({ to: account.email, ...mail });
    }
  }

  // ───────────── Connexion avec Google ─────────────

  get googleEnabled(): boolean {
    return !!this.env.GOOGLE_CLIENT_ID && !!this.env.GOOGLE_CLIENT_SECRET;
  }

  /** Adresse de retour déclarée dans la console Google : même origine que l'application (le proxy relaie /api). */
  private googleRedirectUri(): string {
    return `${this.env.PUBLIC_APP_URL.replace(/\/$/, '')}/api/auth/google/callback`;
  }

  private signShort(payload: Record<string, unknown>, seconds: number): Promise<string> {
    return this.jwt.signAsync(payload, { secret: this.env.JWT_ACCESS_SECRET, expiresIn: seconds, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, algorithm: 'HS256' });
  }

  private async readShort<T extends { typ: string }>(token: string | undefined, typ: string): Promise<T> {
    if (!token || token.length > 2048) throw new UnauthorizedException('google_failed');
    try {
      const claims = await this.jwt.verifyAsync<T>(token, { secret: this.env.JWT_ACCESS_SECRET, algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
      if (claims.typ !== typ) throw new Error('bad type');
      return claims;
    } catch {
      throw new UnauthorizedException('google_failed');
    }
  }

  /** Départ : adresse de la page de choix de compte Google et cookie d'état (état, nonce et secret PKCE, 10 min). */
  async googleStart(locale: 'fr' | 'en'): Promise<{ url: string; stateToken: string }> {
    const { verifier, challenge } = pkcePair();
    const state = randomState();
    const nonce = randomState();
    const stateToken = await this.signShort({ typ: 'g_state', state, nonce, verifier }, 600);
    return { url: authorizeUrl({ clientId: this.env.GOOGLE_CLIENT_ID, redirectUri: this.googleRedirectUri(), state, nonce, challenge, locale }), stateToken };
  }

  /** Retour de Google : compte déjà lié = session ; adresse connue = lier avec le mot de passe ; sinon = finir l'inscription. */
  async googleCallback(q: { code?: string; state?: string; error?: string }, stateToken: string | undefined, client: ClientInfo): Promise<GoogleOutcome> {
    if (!this.googleEnabled) return { kind: 'error', reason: 'google_disabled' };
    if (q.error || !q.code || !q.state || q.code.length > 2048 || q.state.length > 128) return { kind: 'error', reason: 'google_denied' };
    let profile;
    try {
      const st = await this.readShort<{ typ: string; state: string; nonce: string; verifier: string }>(stateToken, 'g_state');
      const a = Buffer.from(st.state);
      const b = Buffer.from(q.state);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('state');
      const idToken = await exchangeCode({
        clientId: this.env.GOOGLE_CLIENT_ID,
        clientSecret: this.env.GOOGLE_CLIENT_SECRET,
        redirectUri: this.googleRedirectUri(),
        code: q.code,
        verifier: st.verifier,
      });
      profile = checkIdToken(idToken, { clientId: this.env.GOOGLE_CLIENT_ID, nonce: st.nonce });
    } catch {
      return { kind: 'error', reason: 'google_failed' };
    }

    const linked = await this.prisma.account.findFirst({ where: { googleSub: profile.sub, deletedAt: null } });
    if (linked) {
      if (linked.suspendedAt) return { kind: 'error', reason: 'account_suspended' };
      if (linked.totpEnabled) {
        const mfaToken = await this.signShort({ sub: linked.id, typ: 'mfa' }, 300);
        return { kind: 'pending', next: 'mfa', token: await this.signShort({ typ: 'g_pending', kind: 'mfa', mfaToken }, 300) };
      }
      await this.audit.log('auth.login_google', { actorId: linked.id, ip: client.ip });
      return { kind: 'tokens', tokens: await this.issueSession(linked, false, client) };
    }
    const sameEmail = await this.prisma.account.findFirst({ where: { email: profile.email, deletedAt: null } });
    if (sameEmail) {
      if (sameEmail.googleSub) return { kind: 'error', reason: 'google_failed' };
      return { kind: 'pending', next: 'link', token: await this.signShort({ typ: 'g_pending', kind: 'link', sub: profile.sub, email: profile.email, name: profile.name }, 900) };
    }
    return { kind: 'pending', next: 'signup', token: await this.signShort({ typ: 'g_pending', kind: 'signup', sub: profile.sub, email: profile.email, name: profile.name }, 900) };
  }

  /** Ce que la page doit demander à la personne après son retour de Google. */
  async googlePending(token: string | undefined): Promise<GooglePending> {
    const p = await this.readShort<{ typ: string; kind: GooglePending['kind']; email?: string; name?: string; mfaToken?: string }>(token, 'g_pending');
    return p.kind === 'mfa' ? { kind: 'mfa', mfaToken: p.mfaToken } : { kind: p.kind, email: p.email, name: p.name };
  }

  /** Nouvelle inscription : l'adresse vient de Google (déjà vérifiée), la personne complète le reste. Pas de mot de passe : Google suffit. */
  async googleComplete(token: string | undefined, dto: GoogleCompleteDto, client: ClientInfo): Promise<IssuedTokens> {
    const p = await this.readShort<{ typ: string; kind: string; sub: string; email: string }>(token, 'g_pending');
    if (p.kind !== 'signup') throw new UnauthorizedException('google_failed');
    const age = ageAt(dto.birthDate);
    if (age === null) throw new BadRequestException('invalid_birth_date');
    if (age < MIN_AGE) throw new ForbiddenException('underage');
    let account: Account;
    try {
      account = await this.prisma.account.create({
        data: {
          email: p.email,
          googleSub: p.sub,
          phone: dto.phone,
          username: dto.username,
          passwordHash: await argon2.hash(randomToken(32), ARGON_OPTS),
          birthDate: new Date(`${dto.birthDate}T00:00:00Z`),
          locale: dto.locale,
          currency: dto.currency ?? 'XOF',
          consents: { create: [{ kind: 'terms', version: TERMS_VERSION }, { kind: 'privacy', version: TERMS_VERSION }] },
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException(takenCode(e));
      throw e;
    }
    await this.audit.log('auth.register_google', { actorId: account.id, ip: client.ip });
    return this.issueSession(account, false, client);
  }

  /** Lier Google à un compte existant (même adresse) : le mot de passe est vérifié comme à la connexion, blocages compris. */
  async googleLink(token: string | undefined, password: string, client: ClientInfo): Promise<LoginResult> {
    const p = await this.readShort<{ typ: string; kind: string; sub: string; email: string }>(token, 'g_pending');
    if (p.kind !== 'link') throw new UnauthorizedException('google_failed');
    const result = await this.login({ identifier: p.email, password }, client);
    const linked = await this.prisma.account.updateMany({ where: { email: p.email, googleSub: null, deletedAt: null }, data: { googleSub: p.sub } });
    if (linked.count === 1) await this.audit.log('auth.google_linked', { ip: client.ip });
    return result;
  }

  private mailLocale(account: Account): MailLocale {
    return account.locale === 'en' ? 'en' : 'fr';
  }

  /** Mot de passe temporaire (16 car. aléatoires) : hashé, sessions coupées, secret renvoyé une fois à l'appelant. */
  async resetPassword(accountId: string): Promise<string> {
    const password = randomToken(12);
    await this.setPasswordHash(accountId, password);
    return password;
  }

  private async setPasswordHash(accountId: string, password: string): Promise<void> {
    await this.prisma.account.update({ where: { id: accountId }, data: { passwordHash: await argon2.hash(password, ARGON_OPTS) } });
    await this.logoutAll(accountId);
  }

  // ───────────── Double authentification (TOTP) ─────────────

  async totpSetup(accountId: string, password: string): Promise<{ otpauthUrl: string; secret: string }> {
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    // Ré-authentification : un jeton d'accès volé ne suffit pas à poser une 2FA contrôlée par l'attaquant.
    if (!(await argon2.verify(account.passwordHash, password).catch(() => false))) throw new ForbiddenException('invalid_password');
    if (account.totpEnabled) throw new ConflictException('totp_already_enabled');
    const secret = authenticator.generateSecret(20);
    await this.prisma.account.update({
      where: { id: accountId },
      data: { totpSecret: encryptSecret(secret, this.env.TOTP_ENCRYPTION_KEY), totpLastStep: null },
    });
    const label = account.email ?? account.phone ?? 'player';
    return { otpauthUrl: authenticator.keyuri(label, 'AGBE', secret), secret };
  }

  async totpEnable(accountId: string, code: string, ip: string): Promise<{ backupCodes: string[] }> {
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    if (account.totpEnabled || !account.totpSecret) throw new BadRequestException('totp_not_pending');
    if (!(await this.consumeTotp(account, code))) throw new BadRequestException('invalid_code');
    // Codes de secours à usage unique, montrés une seule fois : si le téléphone est perdu, ils remplacent le code.
    const backupCodes = generateBackupCodes();
    await this.prisma.account.update({ where: { id: accountId }, data: { totpEnabled: true, totpBackupCodes: backupCodes.map(sha256Hex) } });
    // Toutes les sessions et jetons existants sont révoqués : il faudra se reconnecter avec le code.
    await this.logoutAll(accountId);
    await this.audit.log('auth.totp_enabled', { actorId: accountId, ip });
    return { backupCodes };
  }

  /** Nouveaux codes de secours (les anciens cessent de fonctionner) : ré-authentification par mot de passe. */
  async regenerateBackupCodes(accountId: string, password: string, ip: string): Promise<{ backupCodes: string[] }> {
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    if (!(await argon2.verify(account.passwordHash, password).catch(() => false))) throw new ForbiddenException('invalid_password');
    if (!account.totpEnabled) throw new BadRequestException('totp_not_enabled');
    const backupCodes = generateBackupCodes();
    await this.prisma.account.update({ where: { id: accountId }, data: { totpBackupCodes: backupCodes.map(sha256Hex) } });
    await this.audit.log('auth.totp_backup_regenerated', { actorId: accountId, ip });
    return { backupCodes };
  }

  /** Désactivation volontaire de la 2FA (choix du joueur) : ré-authentification par mot de passe, sessions révoquées. */
  async totpDisable(accountId: string, password: string, ip: string): Promise<void> {
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    if (!(await argon2.verify(account.passwordHash, password).catch(() => false))) throw new ForbiddenException('invalid_password');
    if (!account.totpEnabled) throw new BadRequestException('totp_not_enabled');
    await this.prisma.account.update({ where: { id: accountId }, data: { totpEnabled: false, totpSecret: null, totpLastStep: null, totpBackupCodes: [] } });
    // Pour un ADMIN, les routes @Roles('ADMIN') redeviennent bloquées en production tant qu'elle n'est pas réactivée.
    await this.logoutAll(accountId);
    await this.audit.log('auth.totp_disabled', { actorId: accountId, ip });
  }

  private async consumeBackupCode(account: Account, code: string): Promise<boolean> {
    const hash = sha256Hex(code);
    if (!account.totpBackupCodes.includes(hash)) return false;
    const remaining = account.totpBackupCodes.filter((h) => h !== hash);
    // Condition sur la présence du hachage : une tentative concurrente sur le même code ne le consomme pas deux fois.
    const res = await this.prisma.account.updateMany({ where: { id: account.id, totpBackupCodes: { has: hash } }, data: { totpBackupCodes: { set: remaining } } });
    return res.count === 1;
  }

  private async consumeTotp(account: Account, code: string): Promise<boolean> {
    if (!account.totpSecret) return false;
    let secret: string;
    try {
      secret = decryptSecret(account.totpSecret, this.env.TOTP_ENCRYPTION_KEY);
    } catch {
      return false;
    }
    const delta = authenticator.checkDelta(code, secret);
    if (delta === null) return false;
    const step = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) + delta;
    // Anti-rejeu atomique : on n'accepte que si ce pas de temps est strictement plus récent que le dernier utilisé.
    const res = await this.prisma.account.updateMany({
      where: { id: account.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    return res.count === 1;
  }

  /** Incrément atomique du compteur global d'échecs ; verrou du compte au-delà du seuil (attaque distribuée). */
  private async registerPasswordFailure(accountId: string, client: ClientInfo): Promise<void> {
    const { failedLogins } = await this.prisma.account.update({
      where: { id: accountId },
      data: { failedLogins: { increment: 1 } },
      select: { failedLogins: true },
    });
    if (failedLogins >= ACCOUNT_MAX_FAILURES) {
      await this.prisma.account.update({ where: { id: accountId }, data: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } });
      await this.audit.log('auth.account_locked', { actorId: accountId, ip: client.ip });
    } else {
      await this.audit.log('auth.login_failed', { actorId: accountId, ip: client.ip });
    }
  }

  private async issueSession(
    account: Account,
    mfa: boolean,
    client: ClientInfo,
    familyId: string = randomUUID(),
    authAt: Date = new Date(),
    sessionId?: string,
  ): Promise<IssuedTokens & { sessionId: string }> {
    const refreshToken = randomToken(32);
    const hardLimit = authAt.getTime() + SESSION_MAX_MS[account.role];
    const refreshExpiresAt = new Date(Math.min(Date.now() + this.env.REFRESH_TTL_DAYS * 86_400_000, hardLimit));
    const session = await this.prisma.session.create({
      data: {
        id: sessionId,
        accountId: account.id,
        tokenHash: sha256Hex(refreshToken),
        familyId,
        mfa,
        authAt,
        expiresAt: refreshExpiresAt,
        ip: client.ip.slice(0, 64),
        userAgent: client.userAgent.slice(0, 256),
      },
    });
    // Relu en base : version de jeton et rôle à jour.
    const fresh = await this.prisma.account.findUniqueOrThrow({ where: { id: account.id }, select: { role: true, tokenVersion: true } });
    const accessToken = await this.jwt.signAsync(
      { sub: account.id, role: fresh.role, mfa, ver: fresh.tokenVersion, typ: 'access' },
      {
        secret: this.env.JWT_ACCESS_SECRET,
        expiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithm: 'HS256',
        jwtid: randomUUID(),
      },
    );
    return { accessToken, accessExpiresIn: this.env.JWT_ACCESS_TTL_SECONDS, refreshToken, refreshExpiresAt, sessionId: session.id };
  }

  async verifyPassword(accountId: string, password: string): Promise<boolean> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return false;
    return argon2.verify(account.passwordHash, password).catch(() => false);
  }
}
