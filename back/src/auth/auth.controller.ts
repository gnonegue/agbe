import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, HttpCode, Inject, Injectable, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService, ClientInfo, IssuedTokens } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, GoogleCompleteDto, GoogleLinkDto, LoginDto, ResetWithTokenDto, MfaDto, PasswordConfirmDto, RegisterDto, TotpCodeDto, GuestDto, UpgradeDto } from './auth.dto';
import { AuthUser, ClientIp, CurrentUser, Public } from '../common/decorators';
import { ENV, Env, isAllowedOrigin } from '../config/env';

export const CSRF_HEADER = 'x-agbe-csrf';

/** Cookies provisoires de la connexion Google : état de la demande (aller chez Google) et suite à donner (retour). */
export function googleCookieName(env: Env, kind: 'state' | 'pending'): string {
  return `${env.NODE_ENV === 'production' ? '__Host-' : ''}agbe_g${kind === 'state' ? 's' : 'p'}`;
}

export function refreshCookieName(env: Env): string {
  // Le préfixe __Host- impose Secure, Path=/ et l'absence de Domain : le cookie ne peut pas être injecté par un sous-domaine.
  return env.NODE_ENV === 'production' ? '__Host-agbe_rt' : 'agbe_rt';
}

/**
 * Protection CSRF des routes qui lisent le cookie de rafraîchissement :
 * cookie SameSite=Strict + en-tête personnalisé obligatoire (force un pré-vol CORS) + Origin dans la liste autorisée.
 */
@Injectable()
export class CookieCsrfGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.headers[CSRF_HEADER] !== '1') throw new ForbiddenException('csrf');
    const origin = req.headers.origin;
    if (origin !== undefined && !isAllowedOrigin(this.env.CORS_ORIGINS, origin)) throw new ForbiddenException('csrf');
    return true;
  }
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private client(req: Request, ip: string): ClientInfo {
    return { ip, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 256) };
  }

  private cookieOptions(expires?: Date): CookieOptions {
    return {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      expires,
    };
  }

  private respond(res: Response, t: IssuedTokens) {
    res.cookie(refreshCookieName(this.env), t.refreshToken, this.cookieOptions(t.refreshExpiresAt));
    return { accessToken: t.accessToken, expiresIn: t.accessExpiresIn };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(CookieCsrfGuard)
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request, @ClientIp() ip: string, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.register(dto, this.client(req, ip)));
  }

  /** Disponibilité d'un nom d'utilisateur pendant la saisie à l'inscription. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('username-available')
  usernameAvailable(@Query('username') username: string) {
    return this.auth.usernameAvailable(username);
  }

  /**
   * Jouer sans compte : limité (création d'invités freinée par adresse IP). Plafond assez haut pour les opérateurs
   * mobiles, où beaucoup de joueurs partagent la même adresse IP publique.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @UseGuards(CookieCsrfGuard)
  @Post('guest')
  async guest(@Body() dto: GuestDto, @Req() req: Request, @ClientIp() ip: string, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.guest(dto, this.client(req, ip)));
  }

  /** Un invité crée son compte et garde sa partie. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(204)
  @Post('upgrade')
  async upgrade(@CurrentUser() u: AuthUser, @Body() dto: UpgradeDto, @Req() req: Request, @ClientIp() ip: string) {
    await this.auth.upgrade(u.accountId, dto, this.client(req, ip));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(CookieCsrfGuard)
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @ClientIp() ip: string, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(dto, this.client(req, ip));
    if (r.kind === 'mfa') return { mfaRequired: true, mfaToken: r.mfaToken };
    return this.respond(res, r.tokens);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(CookieCsrfGuard)
  @HttpCode(200)
  @Post('mfa')
  async mfa(@Body() dto: MfaDto, @Req() req: Request, @ClientIp() ip: string, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.verifyMfa(dto.mfaToken, dto.code, this.client(req, ip)));
  }

  /** Mot de passe oublié : toujours 204, que l'adresse ait un compte ou non. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @UseGuards(CookieCsrfGuard)
  @HttpCode(204)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto, @ClientIp() ip: string): Promise<void> {
    await this.auth.requestPasswordReset(dto.email, ip);
  }

  /** Nouveau mot de passe avec le lien reçu par e-mail ; toutes les sessions sont fermées. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @UseGuards(CookieCsrfGuard)
  @HttpCode(204)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetWithTokenDto, @ClientIp() ip: string, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.resetPasswordWithToken(dto.token, dto.password, ip);
    res.clearCookie(refreshCookieName(this.env), this.cookieOptions());
  }

  // ───────────── Connexion avec Google ─────────────

  /** Moyens de connexion proposés par ce serveur (le bouton Google n'apparaît que s'il est configuré). */
  @Public()
  @Get('providers')
  providers() {
    return { google: this.auth.googleEnabled };
  }

  private appUrl(): string {
    return this.env.PUBLIC_APP_URL.replace(/\/$/, '');
  }

  private googleCookie(maxAgeMs: number, sameSite: 'lax' | 'strict'): CookieOptions {
    return { httpOnly: true, secure: this.env.NODE_ENV === 'production', sameSite, path: '/', maxAge: maxAgeMs };
  }

  /** Redirige vers la page de choix de compte Google. Le cookie d'état est « lax » : il doit revenir avec la redirection de Google. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('google/start')
  async googleStart(@Query('lang') lang: string | undefined, @Res() res: Response): Promise<void> {
    if (!this.auth.googleEnabled) return res.redirect(302, `${this.appUrl()}/?google=error&reason=google_disabled`);
    const { url, stateToken } = await this.auth.googleStart(lang === 'en' ? 'en' : 'fr');
    res.cookie(googleCookieName(this.env, 'state'), stateToken, this.googleCookie(600_000, 'lax'));
    res.redirect(302, url);
  }

  /** Retour de Google : ouvre la session, ou dépose la suite à donner dans un cookie provisoire, puis renvoie vers l'application. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @ClientIp() ip: string,
    @Res() res: Response,
  ): Promise<void> {
    const cookies = req.cookies as Record<string, string | undefined>;
    const out = await this.auth.googleCallback({ code, state, error }, cookies[googleCookieName(this.env, 'state')], this.client(req, ip));
    res.clearCookie(googleCookieName(this.env, 'state'), this.googleCookie(0, 'lax'));
    if (out.kind === 'tokens') {
      res.cookie(refreshCookieName(this.env), out.tokens.refreshToken, this.cookieOptions(out.tokens.refreshExpiresAt));
      return res.redirect(302, `${this.appUrl()}/?google=ok`);
    }
    if (out.kind === 'pending') {
      res.cookie(googleCookieName(this.env, 'pending'), out.token, this.googleCookie(900_000, 'strict'));
      return res.redirect(302, `${this.appUrl()}/?google=${out.next}`);
    }
    res.redirect(302, `${this.appUrl()}/?google=error&reason=${out.reason}`);
  }

  private pendingToken(req: Request): string | undefined {
    return (req.cookies as Record<string, string | undefined>)[googleCookieName(this.env, 'pending')];
  }

  /** Après le retour de Google : que faut-il demander à la personne (compléter son profil, confirmer son mot de passe, code 2FA) ? */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(CookieCsrfGuard)
  @HttpCode(200)
  @Post('google/pending')
  googlePending(@Req() req: Request) {
    return this.auth.googlePending(this.pendingToken(req));
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(CookieCsrfGuard)
  @HttpCode(200)
  @Post('google/complete')
  async googleComplete(@Body() dto: GoogleCompleteDto, @Req() req: Request, @ClientIp() ip: string, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.googleComplete(this.pendingToken(req), dto, this.client(req, ip));
    res.clearCookie(googleCookieName(this.env, 'pending'), this.googleCookie(0, 'strict'));
    return this.respond(res, tokens);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(CookieCsrfGuard)
  @HttpCode(200)
  @Post('google/link')
  async googleLink(@Body() dto: GoogleLinkDto, @Req() req: Request, @ClientIp() ip: string, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.googleLink(this.pendingToken(req), dto.password, this.client(req, ip));
    res.clearCookie(googleCookieName(this.env, 'pending'), this.googleCookie(0, 'strict'));
    if (r.kind === 'mfa') return { mfaRequired: true, mfaToken: r.mfaToken };
    return this.respond(res, r.tokens);
  }

  /** Défi 2FA d'un compte Google : le jeton provisoire est consommé, le code se vérifie par la route /auth/mfa habituelle. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(CookieCsrfGuard)
  @HttpCode(204)
  @Post('google/done')
  googleDone(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(googleCookieName(this.env, 'pending'), this.googleCookie(0, 'strict'));
  }

  @Public()
  // Plusieurs onglets/appareils derrière la même IP (Wi-Fi, proxy de dev) : marge suffisante
  @Throttle({ default: { limit: 150, ttl: 60_000 } })
  @UseGuards(CookieCsrfGuard)
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @ClientIp() ip: string, @Res({ passthrough: true }) res: Response) {
    const raw = (req.cookies as Record<string, string | undefined>)[refreshCookieName(this.env)] ?? '';
    try {
      return this.respond(res, await this.auth.refresh(raw, this.client(req, ip)));
    } catch (e) {
      res.clearCookie(refreshCookieName(this.env), this.cookieOptions());
      throw e;
    }
  }

  @Public()
  @UseGuards(CookieCsrfGuard)
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout((req.cookies as Record<string, string | undefined>)[refreshCookieName(this.env)]);
    res.clearCookie(refreshCookieName(this.env), this.cookieOptions());
  }

  @HttpCode(204)
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logoutAll(user.accountId);
    res.clearCookie(refreshCookieName(this.env), this.cookieOptions());
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('totp/setup')
  totpSetup(@CurrentUser() user: AuthUser, @Body() dto: PasswordConfirmDto) {
    return this.auth.totpSetup(user.accountId, dto.password);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(204)
  @Post('password')
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @ClientIp() ip: string, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.changePassword(user.accountId, dto.current, dto.next, ip);
    res.clearCookie(refreshCookieName(this.env), this.cookieOptions());
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('totp/enable')
  async totpEnable(@CurrentUser() user: AuthUser, @Body() dto: TotpCodeDto, @ClientIp() ip: string) {
    return this.auth.totpEnable(user.accountId, dto.code, ip);
  }

  // Nouveaux codes de secours à usage unique (téléphone perdu) : les anciens cessent aussitôt de fonctionner.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('totp/backup-codes')
  async regenerateBackupCodes(@CurrentUser() user: AuthUser, @Body() dto: PasswordConfirmDto, @ClientIp() ip: string) {
    return this.auth.regenerateBackupCodes(user.accountId, dto.password, ip);
  }

  // Choix du joueur : désactiver la 2FA (un ADMIN en production devra la réactiver avant de retrouver l'accès admin).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(204)
  @Post('totp/disable')
  async totpDisable(@CurrentUser() user: AuthUser, @Body() dto: PasswordConfirmDto, @ClientIp() ip: string, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.totpDisable(user.accountId, dto.password, ip);
    res.clearCookie(refreshCookieName(this.env), this.cookieOptions());
  }
}
