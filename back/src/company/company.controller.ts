import { LiveModule } from '../live/live.module';
import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { CharacterService } from '../character/character.service';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { IndustryService } from '../industry/industry.module';
import { CompanyService } from './company.service';
import { WorkService } from '../work/work.service';

const CODE = /^[a-z0-9_]{2,32}$/;
export const COMPANY_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} '&.\-]{1,47}$/u;

class CreateCompanyDto {
  @IsIn(['EI', 'SARL', 'SA'])
  form: 'EI' | 'SARL' | 'SA';

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value))
  @Matches(COMPANY_NAME_RE, { message: 'invalid_company_name' })
  name: string;

  @IsString()
  @Matches(CODE)
  activityId: string;
}
class CompanyIdDto {
  @IsUUID('4')
  companyId: string;
}
class CandidateDto {
  @IsString()
  @Matches(/^\d{1,6}-\d$/)
  id: string;
}
class EmployeeDto {
  @IsUUID('4')
  id: string;
}
/** Offre à accepter : uuid d'une offre de joueur, ou « job:<métier> » pour un employeur public. */
class AcceptOfferDto {
  @IsString()
  @Matches(/^(job:[a-z0-9_]{2,32}|(plant:)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)
  id: string;
}
class OfferDto {
  @IsInt()
  @Min(0)
  @Max(9)
  roleIndex: number;

  @IsInt()
  @Min(1)
  @Max(100_000_000)
  grossMonthly: number;
}
class StartShiftDto {
  @IsIn(['job', 'company'])
  kind: 'job' | 'company';

  /** Moto d'une séance de zém : louée à Gozem, personnelle, ou confiée par un propriétaire. */
  @IsOptional()
  @IsIn(['GOZEM', 'OWN', 'OWNER'])
  bike?: 'GOZEM' | 'OWN' | 'OWNER';
}
class ZemContractDto {
  @IsIn(['sign', 'end'])
  action: 'sign' | 'end';
}
class ServeDto {
  @IsUUID('4')
  shift: string;

  @IsString()
  @Matches(/^m\d{1,2}$/)
  mission: string;

  @IsBoolean()
  accept: boolean;
}

function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('company')
export class CompanyController {
  constructor(private readonly svc: CompanyService) {}

    @HttpCode(200)
  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateCompanyDto, @Headers('idempotency-key') key?: string) {
    return this.svc.create(u.accountId, dto, idem(key));
  }

  @HttpCode(200)
  @Post('select')
  select(@CurrentUser() u: AuthUser, @Body() dto: CompanyIdDto) {
    return this.svc.select(u.accountId, dto.companyId);
  }

  @HttpCode(200)
  @Post('sell')
  sell(@CurrentUser() u: AuthUser, @Body() dto: CompanyIdDto) {
    return this.svc.sell(u.accountId, dto.companyId);
  }

  @HttpCode(200)
  @Post('close')
  close(@CurrentUser() u: AuthUser, @Body() dto: CompanyIdDto) {
    return this.svc.close(u.accountId, dto.companyId);
  }

  @HttpCode(200)
  @Post('documents')
  collect(@CurrentUser() u: AuthUser) {
    return this.svc.collect(u.accountId);
  }

  @HttpCode(200)
  @Post('cnss')
  cnss(@CurrentUser() u: AuthUser) {
    return this.svc.registerCnss(u.accountId);
  }

  @Get('candidates')
  candidates(@CurrentUser() u: AuthUser) {
    return this.svc.candidates(u.accountId);
  }

  @Get('employees')
  employees(@CurrentUser() u: AuthUser) {
    return this.svc.employees(u.accountId);
  }

  @HttpCode(200)
  @Post('hire')
  hire(@CurrentUser() u: AuthUser, @Body() dto: CandidateDto) {
    return this.svc.hire(u.accountId, dto.id);
  }

  @HttpCode(200)
  @Post('fire')
  fire(@CurrentUser() u: AuthUser, @Body() dto: EmployeeDto) {
    return this.svc.fire(u.accountId, dto.id);
  }

  @Get('offers')
  offers(@CurrentUser() u: AuthUser) {
    return this.svc.myOffers(u.accountId);
  }

  @HttpCode(200)
  @Post('offers')
  postOffer(@CurrentUser() u: AuthUser, @Body() dto: OfferDto) {
    return this.svc.postOffer(u.accountId, dto.roleIndex, dto.grossMonthly);
  }

  @HttpCode(200)
  @Post('offers/close')
  closeOffer(@CurrentUser() u: AuthUser, @Body() dto: EmployeeDto) {
    return this.svc.closeOffer(u.accountId, dto.id);
  }

  @HttpCode(200)
  @Post('payroll')
  payroll(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.svc.payroll(u.accountId, idem(key));
  }

  @HttpCode(200)
  @Post('declare')
  declare(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.svc.declare(u.accountId, idem(key));
  }
}

/** Emploi chez un autre joueur : tableau des offres, acceptation, démission. */
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('jobs')
export class PlayerJobsController {
  constructor(private readonly svc: CompanyService) {}

  @Get('offers')
  board(@CurrentUser() u: AuthUser) {
    return this.svc.board(u.accountId);
  }

  @Get('mine')
  async mine(@CurrentUser() u: AuthUser) {
    return { job: await this.svc.myJob(u.accountId) };
  }

  @HttpCode(200)
  @Post('accept')
  accept(@CurrentUser() u: AuthUser, @Body() dto: AcceptOfferDto) {
    return this.svc.acceptOffer(u.accountId, dto.id);
  }

  @HttpCode(200)
  @Post('quit')
  quit(@CurrentUser() u: AuthUser) {
    return this.svc.quit(u.accountId);
  }

  /** Salaire d'un emploi public : les mois clos non encore versés, au prorata des services faits. */
  @HttpCode(200)
  @Post('salary')
  salary(@CurrentUser() u: AuthUser) {
    return this.svc.claimSalary(u.accountId);
  }
}

/** Offres d'emploi vues par l'équipe : employeurs publics (par défaut) et joueurs. */
const LEVELS = ['DEBROUILLE', 'QUALIFIE', 'DIPLOME', 'ENTREPRENEUR'] as const;
class AdminJobReqDto {
  @IsIn(['BAC', 'BT', 'BTS', 'LICENCE', 'MASTER', 'DOCTORAT']) min: string;
  /** Domaines acceptés (absent ou vide : tous). */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @Matches(/^[a-z_]{2,24}$/, { each: true }) domains?: string[];
}
class AdminJobPatchDto {
  @IsOptional() @IsIn(LEVELS) level?: (typeof LEVELS)[number];
  @IsOptional() @IsString() @Length(2, 64) nameFr?: string;
  @IsOptional() @IsString() @Length(2, 64) nameEn?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) payPerShift?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) energyCost?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) hungerCost?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) hygieneCost?: number;
  @IsOptional() @IsInt() @Min(1) @Max(48) shiftGameHours?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) riskPercent?: number;
  @IsOptional() @IsString() @Matches(/^[a-z0-9_]{2,24}$/) category?: string;
  @IsOptional() @IsString() @Length(1, 8) emoji?: string;
  @IsOptional() @IsString() @Length(0, 280) descFr?: string;
  @IsOptional() @IsString() @Length(0, 280) descEn?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  /** Lieu de travail (null : aucun lieu imposé). */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Matches(CODE) venueId?: string | null;
  /** Diplômes acceptés, un seul suffit (liste vide ou null : aucun exigé). */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => AdminJobReqDto) reqs?: AdminJobReqDto[] | null;
}
class AdminJobCreateDto extends AdminJobPatchDto {
  @IsString() @Matches(CODE) id: string;
  @IsIn(LEVELS) declare level: (typeof LEVELS)[number];
  @IsString() @Length(2, 64) declare nameFr: string;
  @IsString() @Length(2, 64) declare nameEn: string;
  @IsInt() @Min(0) @Max(10_000_000) declare payPerShift: number;
  @IsInt() @Min(0) @Max(100) declare energyCost: number;
  @IsInt() @Min(0) @Max(100) declare hungerCost: number;
  @IsInt() @Min(1) @Max(48) declare shiftGameHours: number;
}
class AdminOfferPatchDto {
  @IsOptional() @IsString() @Length(2, 48) roleFr?: string;
  @IsOptional() @IsString() @Length(2, 48) roleEn?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) grossMonthly?: number;
}

@Roles('ADMIN')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/jobs')
export class AdminJobsController {
  constructor(private readonly svc: CompanyService) {}

  @Get()
  list() {
    return this.svc.adminOffers();
  }

  /** Nouveau métier du catalogue. */
  @Post('catalog')
  createJob(@CurrentUser() u: AuthUser, @Body() dto: AdminJobCreateDto) {
    return this.svc.adminCreateJob(u.accountId, dto);
  }

  /** Modifie un métier du catalogue (paie, coûts, lieu, activation…). */
  @Patch('catalog/:id')
  updateJob(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: AdminJobPatchDto) {
    if (!CODE.test(id)) throw new BadRequestException('unknown_job');
    return this.svc.adminUpdateJob(u.accountId, id, dto);
  }

  /** Modifie une offre publiée par un joueur (intitulé, salaire), tant qu'elle est ouverte. */
  @Patch('offers/:id')
  updateOffer(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: AdminOfferPatchDto) {
    return this.svc.adminUpdateOffer(u.accountId, id, dto);
  }

  /** Retire une offre de joueur encore ouverte. */
  @Delete('offers/:id')
  removeOffer(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.svc.adminDeleteOffer(u.accountId, id);
  }
}

@Throttle({ default: { limit: 90, ttl: 60_000 } })
@Controller('work')
export class WorkController {
  constructor(private readonly svc: WorkService) {}

  @HttpCode(200)
  @Post('start')
  start(@CurrentUser() u: AuthUser, @Body() dto: StartShiftDto) {
    return this.svc.start(u.accountId, dto.kind, dto.bike);
  }

  @HttpCode(200)
  @Post('zem-contract')
  zemContract(@CurrentUser() u: AuthUser, @Body() dto: ZemContractDto) {
    return this.svc.zemContract(u.accountId, dto.action);
  }

  @HttpCode(200)
  @Post('serve')
  serve(@CurrentUser() u: AuthUser, @Body() dto: ServeDto) {
    return this.svc.serve(u.accountId, dto.shift, dto.mission, dto.accept);
  }

  @HttpCode(200)
  @Post('stop')
  stop(@CurrentUser() u: AuthUser) {
    return this.svc.stop(u.accountId);
  }
}

@Module({ imports: [LiveModule], controllers: [CompanyController, PlayerJobsController, AdminJobsController, WorkController], providers: [CompanyService, WorkService, CharacterService, IndustryService] })
export class CompanyModule {}
