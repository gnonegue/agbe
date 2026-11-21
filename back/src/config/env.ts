import { z } from 'zod';

// Configuration validée au démarrage : si un secret manque ou est trop faible, le serveur refuse de démarrer.

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded');

const schema = z
  .object({
    // Aucune valeur par défaut permissive : l'environnement et le fournisseur de paiement doivent être explicites.
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().min(1),
    CORS_ORIGINS: z
      .string()
      .min(1)
      .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
    TOTP_ENCRYPTION_KEY: base64Key32,
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    PAYMENT_PROVIDER: z.string().regex(/^[a-z0-9_-]{2,32}$/),
    ALLOW_MOCK_PAYMENTS: z.enum(['true', 'false']).default('false'),
    PUBLIC_APP_URL: z.string().url(),
    PUBLIC_API_URL: z.string().url(),
    /**
     * Adresse mise dans les liens des e-mails (réinitialisation du mot de passe…), si elle diffère de PUBLIC_APP_URL :
     * par exemple un tunnel HTTPS de test alors que PUBLIC_APP_URL reste en localhost (paiement factice). Vide = PUBLIC_APP_URL.
     */
    MAIL_LINK_URL: z.union([z.literal(''), z.string().url()]).optional().default(''),
    PAYMENT_API_KEY: z.string().optional().default(''),
    PAYMENT_WEBHOOK_SECRET: z.string().optional().default(''),
    // E-mails (réinitialisation de mot de passe) : sans SMTP_HOST, rien n'est envoyé (en développement, le message est
    // affiché dans la console du serveur).
    SMTP_HOST: z.string().optional().default(''),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    /** true = TLS direct (port 465) ; false = STARTTLS (port 587, mis en œuvre dès que le serveur le propose). */
    SMTP_SECURE: z.enum(['true', 'false']).default('false'),
    SMTP_USER: z.string().optional().default(''),
    SMTP_PASSWORD: z.string().optional().default(''),
    /** Expéditeur, ex. « AGBE <no-reply@agbe.tg> » : doit appartenir à un domaine autorisé par le fournisseur SMTP. */
    MAIL_FROM: z.string().optional().default(''),
    /** Connexion avec Google (facultative) : identifiants OAuth de type « application Web ». Sans eux, le bouton n'apparaît pas. */
    GOOGLE_CLIENT_ID: z.string().optional().default(''),
    GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
    /** Mot de passe de la page /init (initialisation de la base et premier administrateur). Vide : page désactivée. */
    INIT_SECRET: z.string().optional().default(''),
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === 'mock') {
      const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
      if (env.ALLOW_MOCK_PAYMENTS !== 'true' || !local.test(env.PUBLIC_APP_URL)) {
        ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'mock requires ALLOW_MOCK_PAYMENTS=true and a localhost PUBLIC_APP_URL' });
      }
    }
    if (env.SMTP_HOST && !env.MAIL_FROM) {
      ctx.addIssue({ code: 'custom', path: ['MAIL_FROM'], message: 'MAIL_FROM is required when SMTP_HOST is set' });
    }
    if (!env.GOOGLE_CLIENT_ID !== !env.GOOGLE_CLIENT_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['GOOGLE_CLIENT_SECRET'], message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET go together' });
    }
    if (env.INIT_SECRET && env.INIT_SECRET.length < 16) {
      ctx.addIssue({ code: 'custom', path: ['INIT_SECRET'], message: 'INIT_SECRET must be >= 16 chars (or empty to disable /init)' });
    }
    if (!env.SMTP_USER !== !env.SMTP_PASSWORD) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_PASSWORD'], message: 'SMTP_USER and SMTP_PASSWORD go together' });
    }
    if (env.NODE_ENV === 'production') {
      if (env.PAYMENT_PROVIDER === 'mock') {
        ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'mock provider is forbidden in production' });
      }
      for (const o of env.CORS_ORIGINS) {
        if (o.includes('*')) {
          ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: `wildcard origin is forbidden in production: ${o}` });
        } else if (!o.startsWith('https://')) {
          ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: `origin must be https in production: ${o}` });
        }
      }
      if (!env.PUBLIC_APP_URL.startsWith('https://') || !env.PUBLIC_API_URL.startsWith('https://') || (env.MAIL_LINK_URL && !env.MAIL_LINK_URL.startsWith('https://'))) {
        ctx.addIssue({ code: 'custom', path: ['PUBLIC_APP_URL'], message: 'public URLs must be https in production' });
      }
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // On n'affiche que les noms de variables fautives, jamais leurs valeurs.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const ENV = Symbol('ENV');

/**
 * Origine autorisée (CORS et anti-CSRF) : égalité stricte, ou motif `https://*.exemple.com` (un seul sous-domaine,
 * réservé au développement : refusé en production). Sert aux tunnels de test dont l'adresse change à chaque lancement.
 */
export function isAllowedOrigin(allowed: string[], origin: string): boolean {
  return allowed.some((o) => {
    if (o === origin) return true;
    const star = o.indexOf('*.');
    if (star === -1) return false;
    const [prefix, suffix] = [o.slice(0, star), o.slice(star + 1)];
    return origin.startsWith(prefix) && origin.endsWith(suffix) && /^[a-z0-9-]+$/.test(origin.slice(prefix.length, origin.length - suffix.length));
  });
}
