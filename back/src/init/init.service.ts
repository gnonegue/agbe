import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { join, resolve } from 'node:path';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { ENV, Env } from '../config/env';
import { ageAt, MIN_AGE } from '../auth/age';
import { InitDto } from './init.dto';

// Même réglage et même version des conditions que l'inscription (auth.service.ts)
const ARGON_OPTS: argon2.HashOptions & { raw?: false } = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };
const TERMS_VERSION = '2026-10';
/** Dossier du back (dist/init → back) : migrations Prisma et script de seed compilé. */
const ROOT = resolve(__dirname, '..', '..');

/**
 * Initialisation d'une nouvelle installation, depuis la page /init : migrations, seed, puis premier administrateur.
 * Protégée par INIT_SECRET (sans lui, la route n'existe pas) et verrouillée dès qu'un administrateur existe.
 */
@Injectable()
export class InitService {
  private readonly logger = new Logger('Init');
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Un administrateur existe déjà ; base vide ou tables absentes : pas encore initialisé. */
  async initialized(): Promise<boolean> {
    try {
      return (await this.prisma.account.count({ where: { role: 'ADMIN' } })) > 0;
    } catch {
      return false;
    }
  }

  async status(): Promise<{ enabled: boolean; initialized: boolean }> {
    return { enabled: this.env.INIT_SECRET !== '', initialized: await this.initialized() };
  }

  async run(dto: InitDto, ip: string): Promise<{ ok: true }> {
    if (!this.env.INIT_SECRET) throw new NotFoundException('not_found');
    // Comparaison à temps constant sur des empreintes de même longueur
    const ok = timingSafeEqual(createHash('sha256').update(dto.secret).digest(), createHash('sha256').update(this.env.INIT_SECRET).digest());
    if (!ok) {
      this.logger.warn(`bad init secret from ${ip}`);
      await this.audit.log('init.bad_secret', { ip });
      throw new ForbiddenException('init_bad_secret');
    }
    if (this.running) throw new ConflictException('init_running');
    if (await this.initialized()) throw new ConflictException('init_done');
    const age = ageAt(dto.birthDate);
    if (age === null) throw new BadRequestException('invalid_birth_date');
    if (age < MIN_AGE) throw new ForbiddenException('underage');
    const pw = dto.password.toLowerCase();
    if ([dto.email, dto.phone, dto.username].some((x) => x.toLowerCase() === pw)) throw new BadRequestException('weak_password');

    this.running = true;
    try {
      // Avec Docker, le service `migrate` a déjà créé les tables et le rôle applicatif n'a pas le droit d'en créer :
      // un échec n'est bloquant que si les tables manquent
      await this.step('migrate', [require.resolve('prisma/build/index.js'), 'migrate', 'deploy']).catch(async (e: unknown) => {
        const tables = await this.prisma.account.count().then(() => true, () => false);
        if (!tables) throw e;
        this.logger.warn('migrate deploy failed but the schema is already there: continuing');
      });
      await this.step('seed', [join(ROOT, 'dist', 'scripts', 'seed.js')]);
      // Revérifié après les migrations : la table existe maintenant, un administrateur a pu être créé entre-temps
      if (await this.initialized()) throw new ConflictException('init_done');
      const passwordHash = await argon2.hash(dto.password, ARGON_OPTS);
      const account = await this.prisma.account.create({
        data: {
          email: dto.email,
          phone: dto.phone,
          username: dto.username,
          passwordHash,
          role: 'ADMIN',
          birthDate: new Date(`${dto.birthDate}T00:00:00Z`),
          locale: dto.locale,
          consents: { create: [{ kind: 'terms', version: TERMS_VERSION }, { kind: 'privacy', version: TERMS_VERSION }] },
        },
      });
      await this.audit.log('init.done', { actorId: account.id, target: account.id, ip });
      this.logger.log(`installation initialised, first admin ${account.id}`);
      return { ok: true };
    } finally {
      this.running = false;
    }
  }

  /** Lance une étape (migrations ou seed) dans un processus Node séparé, sans shell. */
  private step(name: string, args: string[]): Promise<void> {
    return new Promise((done, fail) => {
      execFile(process.execPath, args, { cwd: ROOT, env: process.env, timeout: 300_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (!err) {
          this.logger.log(`${name} ok`);
          return done();
        }
        // Le détail (chemins, SQL) reste dans les journaux du serveur, jamais dans la réponse
        this.logger.error(`${name} failed: ${err.message}\n${stdout}\n${stderr}`);
        fail(new ServiceUnavailableException(`init_${name}_failed`));
      });
    });
  }
}
