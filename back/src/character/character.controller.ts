import { BadRequestException, Body, Controller, DefaultValuePipe, Get, Headers, HttpCode, Module, ParseIntPipe, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser, AccountRequired } from '../common/decorators';
import { CharacterService } from './character.service';
import { LiveModule } from '../live/live.module';
import { QuitJobDto, BillDto, MoveDto, CodeDto, CreateCharacterDto, RestartDto, IDEMPOTENCY_RE, IntercityDto, LookDto, TransferDto, TravelDto, FreezerStockDto } from './character.dto';

function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('character')
export class CharacterController {
  constructor(private readonly svc: CharacterService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateCharacterDto) {
    return this.svc.create(u.accountId, dto);
  }

  /** Recommencer : le personnage est clos, son argent rendu au Trésor ; on recrée ensuite un personnage. */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(204)
  @Post('restart')
  async restart(@CurrentUser() u: AuthUser, @Body() _dto: RestartDto) {
    await this.svc.restart(u.accountId);
  }

  /** Conditions de départ encore choisissables (plafond par condition) : la création grise celles qui sont complètes. */
  @Get('conditions')
  conditions() {
    return this.svc.conditionAvailability();
  }

  @Get()
  state(@CurrentUser() u: AuthUser) {
    return this.svc.state(u.accountId);
  }

  /** Suggestions de destinataires pendant la saisie (nom d'utilisateur ou identifiant). */
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @AccountRequired()
  @Get('search')
  search(@CurrentUser() u: AuthUser, @Query('q') q: string) {
    return this.svc.searchRecipients(u.accountId, q);
  }

  /** Retrouve un joueur par son nom d'utilisateur (exact) pour lui envoyer de l'argent sans être à côté de lui. */
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @AccountRequired()
  @Get('lookup')
  lookup(@CurrentUser() u: AuthUser, @Query('username') username: string) {
    return this.svc.lookupRecipient(u.accountId, username);
  }

  @Get('history')
  history(@CurrentUser() u: AuthUser, @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number) {
    return this.svc.history(u.accountId, limit);
  }

  @HttpCode(200)
  @Post('eat')
  eat(@CurrentUser() u: AuthUser, @Body() dto: CodeDto, @Headers('idempotency-key') key?: string) {
    return this.svc.eat(u.accountId, dto.id, idem(key));
  }

  /** Congélateur du logement : l'acheter, le ravitailler en portions (remise en gros), manger une portion. */
  @HttpCode(200)
  @Post('freezer/buy')
  buyFreezer(@CurrentUser() u: AuthUser) {
    return this.svc.buyFreezer(u.accountId);
  }

  @HttpCode(200)
  @Post('freezer/stock')
  stockFreezer(@CurrentUser() u: AuthUser, @Body() dto: FreezerStockDto, @Headers('idempotency-key') key?: string) {
    return this.svc.stockFreezer(u.accountId, dto.id, dto.qty, idem(key));
  }

  @HttpCode(200)
  @Post('freezer/eat')
  eatFromFreezer(@CurrentUser() u: AuthUser, @Body() dto: CodeDto) {
    return this.svc.eatFromFreezer(u.accountId, dto.id);
  }

  @HttpCode(200)
  @Post('job')
  takeJob(@CurrentUser() u: AuthUser, @Body() dto: CodeDto) {
    return this.svc.takeJob(u.accountId, dto.id);
  }

  /** Urgence : appeler le SAMU (santé basse) → transfert à l'hôpital Dogta-Lafiè, puis facture. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('samu')
  samu(@CurrentUser() u: AuthUser) {
    return this.svc.callSamu(u.accountId);
  }

  @HttpCode(200)
  @Post('samu/pay')
  paySamu(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.svc.payMedicalBill(u.accountId, idem(key));
  }

  @HttpCode(200)
  @Post('job/quit')
  quitJob(@CurrentUser() u: AuthUser, @Body() dto: QuitJobDto) {
    return this.svc.quitJob(u.accountId, dto.id);
  }

  @HttpCode(200)
  @Post('work')
  work(@CurrentUser() u: AuthUser) {
    return this.svc.work(u.accountId);
  }

  @HttpCode(200)
  @Post('rest')
  rest(@CurrentUser() u: AuthUser) {
    return this.svc.rest(u.accountId);
  }

  @HttpCode(200)
  @Post('amu')
  amu(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.svc.payAmu(u.accountId, idem(key));
  }

  @HttpCode(200)
  @Post('sleep')
  sleep(@CurrentUser() u: AuthUser) {
    return this.svc.sleep(u.accountId);
  }

  @HttpCode(200)
  @Post('wake')
  wake(@CurrentUser() u: AuthUser) {
    return this.svc.wake(u.accountId);
  }

  @HttpCode(200)
  @Post('music')
  music(@CurrentUser() u: AuthUser) {
    return this.svc.listenMusic(u.accountId);
  }

  @HttpCode(200)
  @Post('tv')
  tv(@CurrentUser() u: AuthUser) {
    return this.svc.leisure(u.accountId, 'tv');
  }

  @HttpCode(200)
  @Post('read')
  read(@CurrentUser() u: AuthUser) {
    return this.svc.leisure(u.accountId, 'read');
  }

  @HttpCode(200)
  @Post('wash')
  wash(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.svc.wash(u.accountId, idem(key));
  }

  @HttpCode(200)
  @Post('rent')
  rent(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.svc.payRent(u.accountId, idem(key));
  }

  @HttpCode(200)
  @Post('rent/debt')
  rentDebt(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.svc.payRentDebt(u.accountId, idem(key));
  }

  @HttpCode(200)
  @Post('move')
  move(@CurrentUser() u: AuthUser, @Body() dto: MoveDto, @Headers('idempotency-key') key?: string) {
    return this.svc.moveHousing(u.accountId, dto.housing, idem(key));
  }

  @HttpCode(200)
  @Post('bills')
  payBill(@CurrentUser() u: AuthUser, @Body() dto: BillDto, @Headers('idempotency-key') key?: string) {
    return this.svc.payBill(u.accountId, dto.bill, idem(key));
  }

  @HttpCode(200)
  @Post('travel')
  travel(@CurrentUser() u: AuthUser, @Body() dto: TravelDto, @Headers('idempotency-key') key?: string) {
    return this.svc.travel(u.accountId, dto.to, dto.mode, idem(key), dto.vehicleId);
  }

  @HttpCode(200)
  @Post('intercity')
  intercity(@CurrentUser() u: AuthUser, @Body() dto: IntercityDto, @Headers('idempotency-key') key?: string) {
    return this.svc.intercity(u.accountId, dto.to, idem(key));
  }

  @HttpCode(200)
  @Post('home/buy')
  buyHome(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.svc.buyHome(u.accountId, idem(key));
  }

  @HttpCode(200)
  @Post('look')
  look(@CurrentUser() u: AuthUser, @Body() dto: LookDto) {
    // Copie explicite des seuls champs validés
    return this.svc.setLook(u.accountId, { female: dto.female, hair: dto.hair, outfit: dto.outfit, fabric: dto.fabric, skin: dto.skin, hairColor: dto.hairColor, color: dto.color });
  }

  @HttpCode(200)
  @Post('activity')
  activity(@CurrentUser() u: AuthUser, @Body() dto: CodeDto, @Headers('idempotency-key') key?: string) {
    return this.svc.activity(u.accountId, dto.id, idem(key));
  }

  @AccountRequired()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('transfer')
  transfer(@CurrentUser() u: AuthUser, @Body() dto: TransferDto, @Headers('idempotency-key') key?: string) {
    return this.svc.transfer(u.accountId, dto.toCharacterId, dto.amount, dto.memo, idem(key));
  }
}

@Module({ imports: [LiveModule], controllers: [CharacterController], providers: [CharacterService] })
export class CharacterModule {}
