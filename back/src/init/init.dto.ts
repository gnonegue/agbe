import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, Length, Matches, MaxLength } from 'class-validator';
import { E164, ISO_DATE, USERNAME } from '../auth/auth.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/** Initialisation : mot de passe d'initialisation (INIT_SECRET) et identité du premier administrateur. */
export class InitDto {
  @IsString()
  @Length(1, 256)
  secret: string;

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

  @IsIn(['fr', 'en'])
  locale: 'fr' | 'en';
}
