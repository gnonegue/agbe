import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/** Devise d'affichage choisie par le joueur : les montants restent en FCFA côté serveur, seule la présentation change. */
export const CURRENCIES = ['XOF', 'EUR', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const E164 = /^\+[1-9]\d{7,14}$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Inscription : e-mail ET téléphone obligatoires (l'e-mail sert d'identifiant principal). */
/** Nom d'utilisateur : 3 à 20 caractères, lettres minuscules, chiffres, « _ » ou « . ». */
export const USERNAME = /^[a-z0-9_.]{3,20}$/;

export class RegisterDto {
  @Transform(lowerTrim)
  @Matches(USERNAME, { message: 'invalid_username' })
  username: string;

  @Transform(lowerTrim)
  @IsEmail({}, { message: 'invalid_email' })
  @MaxLength(254)
  email: string;

  @Transform(trim)
  @Matches(E164, { message: 'invalid_phone' })
  phone: string;

  @IsString()
  @Length(10, 128, { message: 'password_length' })
  password: string;

  @Matches(ISO_DATE, { message: 'invalid_birth_date' })
  birthDate: string;

  @IsBoolean()
  @Equals(true, { message: 'terms_required' })
  acceptTerms: boolean;

  @IsIn(['fr', 'en'])
  locale: 'fr' | 'en';

  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: Currency;
}

export class LoginDto {
  @Transform(trim)
  @IsString()
  @Length(3, 254)
  identifier: string;

  @IsString()
  @Length(1, 128)
  password: string;
}

export class MfaDto {
  @IsString()
  @Length(10, 2048)
  mfaToken: string;

  // Code de l'appli d'authentification (6 chiffres) ou code de secours à usage unique (10 chiffres).
  @Matches(/^\d{6}$|^\d{10}$/)
  code: string;
}

export class TotpCodeDto {
  @Matches(/^\d{6}$/)
  code: string;
}

export class LocaleDto {
  @IsIn(['fr', 'en'])
  locale: 'fr' | 'en';
}

export class CurrencyDto {
  @IsIn(CURRENCIES)
  currency: Currency;
}

export class ChangePasswordDto {
  @IsString()
  @Length(1, 128)
  current: string;

  @IsString()
  @Length(10, 128, { message: 'password_length' })
  next: string;
}

export class PasswordConfirmDto {
  @IsString()
  @Length(1, 128)
  password: string;
}

/** Jouer sans compte : contrôle d'âge et acceptation des conditions, rien d'autre. */
export class GuestDto {
  @Matches(ISO_DATE, { message: 'invalid_birth_date' })
  birthDate: string;

  @IsBoolean()
  @Equals(true, { message: 'terms_required' })
  acceptTerms: boolean;

  @IsIn(['fr', 'en'])
  locale: 'fr' | 'en';

  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: Currency;
}

/** Un invité crée son compte : il garde son personnage et sa partie. */
export class UpgradeDto {
  @Transform(lowerTrim)
  @Matches(USERNAME, { message: 'invalid_username' })
  username: string;

  @Transform(lowerTrim)
  @IsEmail({}, { message: 'invalid_email' })
  @MaxLength(254)
  email: string;

  @Transform(trim)
  @Matches(E164, { message: 'invalid_phone' })
  phone: string;

  @IsString()
  @Length(10, 128, { message: 'password_length' })
  password: string;
}

/** Fin d'une inscription avec Google : ce que Google ne fournit pas (nom d'utilisateur, téléphone, âge, conditions). */
export class GoogleCompleteDto {
  @Transform(lowerTrim)
  @Matches(USERNAME, { message: 'invalid_username' })
  username: string;

  @Transform(trim)
  @Matches(E164, { message: 'invalid_phone' })
  phone: string;

  @Matches(ISO_DATE, { message: 'invalid_birth_date' })
  birthDate: string;

  @IsBoolean()
  @Equals(true, { message: 'terms_required' })
  acceptTerms: boolean;

  @IsIn(['fr', 'en'])
  locale: 'fr' | 'en';

  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: Currency;
}

/** Lier Google à un compte existant : le mot de passe du compte prouve qu'il est à soi. */
export class GoogleLinkDto {
  @IsString()
  @Length(1, 128)
  password: string;
}

/** Mot de passe oublié : l'adresse e-mail du compte. */
export class ForgotPasswordDto {
  @Transform(lowerTrim)
  @IsEmail({}, { message: 'invalid_email' })
  @MaxLength(254)
  email: string;
}

/** Nouveau mot de passe avec le jeton reçu par e-mail. */
export class ResetWithTokenDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{32,64}$/, { message: 'invalid_reset_token' })
  token: string;

  @IsString()
  @Length(10, 128, { message: 'password_length' })
  password: string;
}
