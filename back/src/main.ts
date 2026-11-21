import './config/dotenv';
import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { isAllowedOrigin, loadEnv } from './config/env';
import { CSRF_HEADER } from './auth/auth.controller';

async function bootstrap(): Promise<void> {
  const env = loadEnv(); // échoue immédiatement si la configuration est invalide

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // nécessaire pour vérifier la signature des webhooks de paiement
    bodyParser: true,
    logger: env.NODE_ENV === 'production' ? ['log', 'warn', 'error'] : ['log', 'warn', 'error', 'debug'],
  });

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS); // IP réelle derrière nginx, sans faire confiance à n'importe quel en-tête
  app.useBodyParser('json', { limit: '64kb' });
  app.useBodyParser('urlencoded', { limit: '16kb', extended: false });
  // Images d'annonces uniquement (route dédiée) : octets bruts, 400 Ko maximum, format revérifié ensuite
  app.useBodyParser('raw', { type: ['image/png', 'image/jpeg', 'image/webp'], limit: '400kb' });

  // L'API ne sert que du JSON : politique de sécurité la plus stricte possible.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
      },
      strictTransportSecurity: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      frameguard: { action: 'deny' },
    }),
  );
  app.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    next();
  });
  app.use(cookieParser());
  // Routage sensible à la casse : /api/AUTH/login ne doit pas contourner les règles nginx écrites en minuscules.
  app.use((req: { path: string }, res: { status(n: number): { json(b: unknown): void } }, next: () => void) => {
    if (/[A-Z]/.test(req.path)) {
      res.status(404).json({ statusCode: 404, error: 'not_found' });
      return;
    }
    next();
  });

  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || isAllowedOrigin(env.CORS_ORIGINS, origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', CSRF_HEADER],
    maxAge: 600,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // supprime les champs inconnus
      forbidNonWhitelisted: true, // … et refuse la requête s'il y en a
      forbidUnknownValues: true,
      transform: true,
      stopAtFirstError: true,
      disableErrorMessages: false,
      validationError: { target: false, value: false }, // ne jamais renvoyer la valeur reçue
    }),
  );
  app.enableShutdownHooks();

  await app.listen(env.PORT, env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
  new Logger('AGBE').log(`API prête sur le port ${env.PORT} (${env.NODE_ENV}, paiement: ${env.PAYMENT_PROVIDER})`);
}

bootstrap().catch((e: unknown) => {
  // eslint-disable-next-line no-console
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
