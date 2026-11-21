import { Global, Inject, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createTransport, type Transporter } from 'nodemailer';
import { ENV, Env } from '../config/env';
import { LOGO_CID } from './mail.templates';

// Logo de l'en-tête : joint au message (image intégrée), donc visible même sans accès à notre site ni images distantes.
const LOGO_PATH = join(__dirname, 'assets', 'logo.png');

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** « Répondre à » : la réponse depuis la messagerie part vers cette adresse (formulaire de contact). */
  replyTo?: string;
}

/** Adresse masquée pour les journaux (« j***@gmail.com ») : on ne conserve pas d'e-mails en clair dans les logs. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Envoi d'e-mails par SMTP (nodemailer). Sans SMTP_HOST : rien ne part ; en développement le message est affiché dans
 * la console du serveur (lien compris) pour tester sans fournisseur ; en production un avertissement est journalisé.
 * `send` ne lève jamais d'exception : l'appelant répond pareil que le mail soit parti ou non (pas d'énumération de comptes).
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly log = new Logger('Mail');
  private readonly transport: Transporter | null;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.transport = env.SMTP_HOST
      ? createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE === 'true',
          requireTLS: env.SMTP_SECURE !== 'true' && env.NODE_ENV === 'production',
          auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        })
      : null;
  }

  get enabled(): boolean {
    return this.transport !== null;
  }

  async onModuleInit(): Promise<void> {
    if (!this.transport) {
      this.log.warn(this.env.NODE_ENV === 'production' ? 'SMTP_HOST non renseigné : aucun e-mail ne sera envoyé (réinitialisation de mot de passe impossible).' : 'SMTP_HOST non renseigné : les e-mails sont affichés dans cette console.');
      return;
    }
    try {
      await this.transport.verify();
      this.log.log(`SMTP prêt (${this.env.SMTP_HOST}:${this.env.SMTP_PORT})`);
    } catch (e) {
      this.log.error(`SMTP injoignable : ${(e as Error).message}`);
    }
  }

  async send(mail: OutgoingMail): Promise<boolean> {
    if (!this.transport) {
      if (this.env.NODE_ENV !== 'production') this.log.log(`\n── E-mail (non envoyé : SMTP absent) ──\nÀ : ${mail.to}\nObjet : ${mail.subject}\n\n${mail.text}\n────────────────────────────────────`);
      return false;
    }
    try {
      await this.transport.sendMail({
        from: this.env.MAIL_FROM,
        to: mail.to,
        replyTo: mail.replyTo,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        attachments: existsSync(LOGO_PATH) ? [{ filename: 'agbe.png', path: LOGO_PATH, cid: LOGO_CID, contentDisposition: 'inline' }] : [],
      });
      this.log.log(`E-mail envoyé à ${maskEmail(mail.to)} : ${mail.subject}`);
      return true;
    } catch (e) {
      this.log.error(`Échec d'envoi à ${maskEmail(mail.to)} : ${(e as Error).message}`);
      return false;
    }
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
