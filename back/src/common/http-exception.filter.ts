import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';

/**
 * Ne jamais divulguer de détails internes (pile d'appels, SQL, chemins) au client.
 * Les erreurs inattendues sont journalisées côté serveur et renvoyées comme une 500 générique.
 */
/** Forme d'un code d'erreur (ce que l'appli sait traduire). */
const CODE_RE = /^[a-z0-9_]{2,64}$/;

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ThrottlerException) {
      res.status(HttpStatus.TOO_MANY_REQUESTS).json({ statusCode: 429, error: 'too_many_requests' });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      let message: unknown = exception.message;
      if (typeof body === 'object' && body !== null && 'message' in body) {
        message = (body as { message: unknown }).message;
      }
      // Le client ne reçoit que des codes (traduits par l'appli). Une phrase technique (refus de validation d'un DTO, route
      // inconnue…) devient un code générique explicite ; le détail reste dans le journal du serveur pour le diagnostic.
      const first = Array.isArray(message) ? message[0] : message;
      if (typeof first !== 'string' || !CODE_RE.test(first)) {
        const req = host.switchToHttp().getRequest<{ method?: string; originalUrl?: string }>();
        this.logger.warn(`${status} ${req?.method ?? ''} ${req?.originalUrl ?? ''} : ${JSON.stringify(message).slice(0, 300)}`);
        const code = status === 404 ? 'not_found' : status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 409 ? 'conflict' : 'invalid_input';
        res.status(status).json({ statusCode: status, error: code });
        return;
      }
      res.status(status).json({ statusCode: status, error: message });
      return;
    }

    // Erreurs du parseur HTTP (corps trop gros, JSON invalide…) : ce sont des erreurs client, pas des 500.
    const st = (exception as { status?: unknown; expose?: unknown } | null)?.status;
    if (typeof st === 'number' && st >= 400 && st < 500 && (exception as { expose?: unknown }).expose === true) {
      res.status(st).json({ statusCode: st, error: st === 413 ? 'payload_too_large' : 'bad_request' });
      return;
    }
    // JSON pathologiquement imbriqué : la validation dépasse la pile → requête invalide.
    if (exception instanceof RangeError && /call stack/i.test(exception.message)) {
      res.status(HttpStatus.BAD_REQUEST).json({ statusCode: 400, error: 'bad_request' });
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        res.status(HttpStatus.CONFLICT).json({ statusCode: 409, error: 'conflict' });
        return;
      }
      if (exception.code === 'P2025') {
        res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, error: 'not_found' });
        return;
      }
    }

    // Erreur inattendue : journalisée avec la route pour la retrouver (jamais renvoyée au client)
    const req = host.switchToHttp().getRequest<{ method?: string; originalUrl?: string }>();
    this.logger.error(`${req?.method ?? ''} ${req?.originalUrl ?? ''} : ${exception instanceof Error ? exception.stack ?? exception.message : String(exception)}`);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, error: 'internal_error' });
  }
}
