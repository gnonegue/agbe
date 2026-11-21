import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

export const NAME_RE = /^[\p{L}][\p{L} '\-]{1,23}$/u;

export class CreateCharacterDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value))
  @Matches(NAME_RE, { message: 'invalid_name' })
  name: string;

  @IsIn(['LOCAL', 'DIASPORA', 'FOREIGNER'])
  profile: 'LOCAL' | 'DIASPORA' | 'FOREIGNER';

  @IsIn(['MARITIME', 'PLATEAUX', 'CENTRALE', 'KARA', 'SAVANES'])
  region: 'MARITIME' | 'PLATEAUX' | 'CENTRALE' | 'KARA' | 'SAVANES';

  @IsIn(['FREE_CHOICE', 'DESTINY'])
  mode: 'FREE_CHOICE' | 'DESTINY';

  @IsOptional()
  @IsIn(['RICH', 'MIDDLE', 'POOR'])
  condition?: 'RICH' | 'MIDDLE' | 'POOR';
}

const CODE = /^[a-z0-9_]{2,32}$/;

export class CodeDto {
  @IsString()
  @Matches(CODE)
  id: string;
}

/** Ravitaillement du congélateur : un plat et un nombre de portions. */
export class FreezerStockDto {
  @IsString()
  @Matches(CODE)
  id: string;

  @IsInt()
  @Min(1)
  @Max(50)
  qty: number;
}

/** Métier à quitter ; sans identifiant, le métier actif. */
export class QuitJobDto {
  @IsOptional()
  @IsString()
  @Matches(CODE)
  id?: string;
}

export class TransferDto {
  @IsUUID('4')
  toCharacterId: string;

  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amount: number;

  @IsOptional()
  @IsString()
  @Length(0, 80)
  memo?: string;
}

/** Clé d'idempotence fournie par le client (en-tête Idempotency-Key) pour éviter les doubles débits. */
export const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{16,64}$/;

export class BillDto {
  @IsIn(['ELEC', 'WATER', 'WIFI'])
  bill: 'ELEC' | 'WATER' | 'WIFI';
}

export class MoveDto {
  @IsIn(['ENTRER_COUCHER', 'CHAMBRE_SALON', 'VILLA'])
  housing: 'ENTRER_COUCHER' | 'CHAMBRE_SALON' | 'VILLA';
}

export class TravelDto {
  @IsString()
  @Matches(CODE)
  to: string;

  @IsIn(['WALK', 'ZEM', 'WORO', 'BUS', 'CAR', 'MOTO'])
  mode: 'WALK' | 'ZEM' | 'WORO' | 'BUS' | 'CAR' | 'MOTO';

  /** Véhicule personnel à utiliser (moto ou voiture) ; par défaut le premier en état de rouler avec assez de carburant. */
  @IsOptional()
  @IsUUID('4')
  vehicleId?: string;
}

export class IntercityDto {
  @Matches(/^[a-z]{2,16}$/)
  to: string;
}

export const HAIR_STYLES = ['short', 'lowcut', 'afro', 'braids', 'bun', 'locs', 'gele', 'cap'] as const;
export const OUTFITS = ['casual', 'office', 'boubou', 'work'] as const;
export const FABRICS = ['plain', 'wax', 'kente', 'batik'] as const;

/** Apparence du personnage : uniquement des choix dans des listes fermées (aucun texte libre). */
export class LookDto {
  @IsBoolean()
  female: boolean;

  @IsIn(HAIR_STYLES)
  hair: (typeof HAIR_STYLES)[number];

  @IsIn(OUTFITS)
  outfit: (typeof OUTFITS)[number];

  @IsIn(FABRICS)
  fabric: (typeof FABRICS)[number];

  @IsInt()
  @Min(0)
  @Max(11)
  skin: number;

  @IsInt()
  @Min(0)
  @Max(6)
  hairColor: number;

  /** Couleur principale (tissu uni) ou motif (wax). */
  @IsInt()
  @Min(0)
  @Max(7)
  color: number;
}

/** Recommencer sa vie : confirmation explicite exigée. */
export class RestartDto {
  @Equals('RESTART')
  confirm!: string;
}
