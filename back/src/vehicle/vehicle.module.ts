import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import type { OwnedVehicle } from '@prisma/client';
import { AuthUser, CurrentUser } from '../common/decorators';
import { sha256Hex } from '../common/crypto';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { CharacterService } from '../character/character.service';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { gameTimeAt } from '../economy/clock';
import { transportFactorBp } from '../economy/events';
import { breakdownRiskBp, condition, remoteLitrePrice, resaleValue, tankMl, type VehicleModel } from './vehicle';
import { brandVenueId } from '../partners/brand-venues.service';

const uuid = new ParseUUIDPipe({ version: '4' });
function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

class BuyDto {
  @Matches(/^[a-z0-9_]{2,32}$/)
  modelId: string;
}
class RefuelDto {
  /** Litres à ajouter (au plus la place restante dans le réservoir). */
  @IsInt()
  @Min(1)
  @Max(200)
  liters: number;

  /** Livraison de carburant là où l'on est (hors station) : plus cher, voir `vehicles.catalog.remoteFuel`. */
  @IsOptional()
  @IsBoolean()
  remote?: boolean;
}

/** Concession, carburant, entretien et revente des motos et voitures du joueur ; montants décidés par le serveur. */
@Injectable()
export class VehicleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
  ) {}

  /** Prix du litre avec les événements de la semaine (pénurie de carburant…). */
  private async fuelPrice(base: number): Promise<number> {
    const clock = await this.settings.clock();
    const day = gameTimeAt(clock, Date.now()).day;
    const factor = transportFactorBp(day, await this.settings.get('economy.events'));
    return Math.round((base * factor) / 10_000);
  }

  private view(v: OwnedVehicle, model: VehicleModel | undefined, cat: { rules: { minCondition: number; breakdownBpPerOverdue: number }; resale: { startBp: number; lossBpPerKm: number; floorBp: number } }) {
    const m = model ?? { id: v.modelId, kind: v.kind as 'MOTO' | 'CAR', price: v.boughtPrice, tankL: 1, mlPerKm: 1, serviceEveryKm: 1_000, serviceCost: 0, repairCost: 0 };
    const cond = condition(v, m);
    return {
      id: v.id,
      modelId: v.modelId,
      kind: v.kind,
      fuelMl: v.fuelMl,
      tankMl: tankMl(m),
      odometerKm: Math.floor(v.odometerM / 1000),
      sinceServiceKm: Math.floor(v.sinceServiceM / 1000),
      serviceEveryKm: m.serviceEveryKm,
      serviceDue: v.sinceServiceM >= m.serviceEveryKm * 1000,
      breakdownRiskBp: breakdownRiskBp(v.sinceServiceM, m, cat.rules),
      damage: v.damage,
      condition: cond,
      drivable: cond >= cat.rules.minCondition,
      resaleValue: resaleValue(v, cat.resale),
      boughtPrice: v.boughtPrice,
    };
  }

  async garage(accountId: string) {
    const c = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
    if (!c) throw new NotFoundException('no_character');
    const cat = await this.settings.get('vehicles.catalog');
    const rows = await this.prisma.ownedVehicle.findMany({ where: { characterId: c.id, soldAt: null }, orderBy: { createdAt: 'asc' } });
    return {
      models: cat.models,
      fuelPricePerL: await this.fuelPrice(cat.fuelPricePerL),
      // Livraison à distance : prix du litre majoré et frais fixes
      remoteFuel: { pricePerL: remoteLitrePrice(await this.fuelPrice(cat.fuelPricePerL), cat.remoteFuel.surchargeBp), fee: cat.remoteFuel.fee },
      stations: await this.stationIds(),
      maxVehicles: cat.maxVehicles,
      mine: rows.map((v) => this.view(v, cat.models.find((m) => m.id === v.modelId), cat)),
    };
  }

  private async mine(tx: Parameters<Parameters<CharacterService['act']>[1]>[0], characterId: string, id: string) {
    const v = await tx.ownedVehicle.findFirst({ where: { id, characterId, soldAt: null } });
    if (!v) throw new NotFoundException('unknown_vehicle');
    const cat = await this.settings.get('vehicles.catalog');
    const model = cat.models.find((m) => m.id === v.modelId);
    if (!model) throw new BadRequestException('unknown_model');
    return { v, model, cat };
  }

  /** Stations-service du réglage, plus les stations de partenaires (bâtiment de marque au modèle « station ») ouvertes. */
  private async stationIds(): Promise<string[]> {
    const base = (await this.settings.get('vehicles.catalog')).stations;
    const partners = await this.prisma.partner.findMany({ where: { placeModel: 'station', active: true, placeX: { not: null }, placeZ: { not: null } }, select: { id: true } });
    if (partners.length === 0) return base;
    const ids = partners.map((p) => brandVenueId(p.id));
    const open = await this.prisma.venue.findMany({ where: { id: { in: ids }, enabled: true }, select: { id: true } });
    return [...base, ...open.map((v) => v.id)];
  }

  private async atStation(locationId: string) {
    if (!(await this.stationIds()).includes(locationId)) throw new BadRequestException('not_at_station');
  }

  /** Acheter un véhicule neuf : payé au concessionnaire, livré avec un demi-réservoir. */
  buy(accountId: string, modelId: string, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const cat = await this.settings.get('vehicles.catalog');
      const model = cat.models.find((m) => m.id === modelId);
      if (!model) throw new NotFoundException('unknown_model');
      const key = idemKey ? `vehicle-buy:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`vehicle-buy|${modelId}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true, paid: model.price };
      if ((await tx.ownedVehicle.count({ where: { characterId: c.id, soldAt: null } })) >= cat.maxVehicles) throw new BadRequestException('garage_full');
      await this.ledger.post(tx, { kind: 'VEHICLE_PURCHASE', idempotencyKey: key, requestHash, memo: model.id, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(model.price) }] });
      const v = await tx.ownedVehicle.create({ data: { characterId: c.id, modelId: model.id, kind: model.kind, fuelMl: Math.floor(tankMl(model) / 2), boughtPrice: model.price } });
      return { replay: false, paid: model.price, vehicleId: v.id };
    });
  }

  /**
   * Faire le plein (ou une partie) : à la station-service au prix du litre, ou à distance (livraison là où l'on est, par exemple
   * en panne sèche) au prix majoré plus des frais de livraison. Prélevé sur le portefeuille ; montant décidé par le serveur.
   */
  refuel(accountId: string, vehicleId: string, liters: number, idemKey?: string, remote = false) {
    return this.chars.act(accountId, async (tx, c) => {
      if (!remote) await this.atStation(c.locationId);
      const { v, model, cat } = await this.mine(tx, c.id, vehicleId);
      const room = Math.floor((tankMl(model) - v.fuelMl) / 1000);
      if (room < 1) throw new BadRequestException('tank_full');
      const l = Math.min(liters, room);
      const perL = await this.fuelPrice(cat.fuelPricePerL);
      const price = remote ? l * remoteLitrePrice(perL, cat.remoteFuel.surchargeBp) + cat.remoteFuel.fee : l * perL;
      const key = idemKey ? `vehicle-fuel:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`vehicle-fuel|${vehicleId}|${liters}|${remote ? 'remote' : 'station'}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true, liters: l, paid: price, remote };
      if (price > 0) await this.ledger.post(tx, { kind: 'FUEL', idempotencyKey: key, requestHash, memo: `${model.id}:${l}L${remote ? ':remote' : ''}`, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(price) }] });
      await tx.ownedVehicle.update({ where: { id: v.id }, data: { fuelMl: v.fuelMl + l * 1000 } });
      return { replay: false, liters: l, paid: price, remote };
    });
  }

  /** Entretien (vidange, freins, filtres) : l'usure repart à zéro, le risque de panne aussi. */
  service(accountId: string, vehicleId: string, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      await this.atStation(c.locationId);
      const { v, model } = await this.mine(tx, c.id, vehicleId);
      if (v.sinceServiceM < 1_000) throw new BadRequestException('service_not_needed');
      const key = idemKey ? `vehicle-service:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`vehicle-service|${vehicleId}|${v.sinceServiceM}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true, paid: model.serviceCost };
      if (model.serviceCost > 0) await this.ledger.post(tx, { kind: 'VEHICLE_SERVICE', idempotencyKey: key, requestHash, memo: model.id, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(model.serviceCost) }] });
      await tx.ownedVehicle.update({ where: { id: v.id }, data: { sinceServiceM: 0 } });
      return { replay: false, paid: model.serviceCost };
    });
  }

  /** Réparation des dégâts (panne, accident) : prix proportionnel aux dégâts. */
  repair(accountId: string, vehicleId: string, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      await this.atStation(c.locationId);
      const { v, model } = await this.mine(tx, c.id, vehicleId);
      if (v.damage <= 0) throw new BadRequestException('no_damage');
      const price = Math.ceil((model.repairCost * v.damage) / 100);
      const key = idemKey ? `vehicle-repair:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`vehicle-repair|${vehicleId}|${v.damage}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true, paid: price };
      if (price > 0) await this.ledger.post(tx, { kind: 'VEHICLE_REPAIR', idempotencyKey: key, requestHash, memo: model.id, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(price) }] });
      await tx.ownedVehicle.update({ where: { id: v.id }, data: { damage: 0 } });
      return { replay: false, paid: price };
    });
  }

  /** Revendre le véhicule : valeur décidée par le serveur (kilométrage et dégâts), créditée au portefeuille. */
  sell(accountId: string, vehicleId: string, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const { v, cat } = await this.mine(tx, c.id, vehicleId);
      const value = resaleValue(v, cat.resale);
      const key = idemKey ? `vehicle-sell:${c.id}:${idemKey}` : `vehicle-sell:${v.id}`;
      const requestHash = sha256Hex(`vehicle-sell|${v.id}`);
      if (value > 0) await this.ledger.post(tx, { kind: 'VEHICLE_SALE', idempotencyKey: key, requestHash, memo: v.modelId, legs: [{ from: await this.ledger.systemWalletId(tx, 'MARKET'), to: c.walletId, amount: BigInt(value) }] });
      await tx.ownedVehicle.update({ where: { id: v.id }, data: { soldAt: new Date() } });
      return { received: value };
    });
  }
}

@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('vehicles')
export class VehicleController {
  constructor(private readonly svc: VehicleService) {}

  @Get()
  garage(@CurrentUser() u: AuthUser) {
    return this.svc.garage(u.accountId);
  }

  @HttpCode(200)
  @Post('buy')
  buy(@CurrentUser() u: AuthUser, @Body() dto: BuyDto, @Headers('idempotency-key') key?: string) {
    return this.svc.buy(u.accountId, dto.modelId, idem(key));
  }

  @HttpCode(200)
  @Post(':id/refuel')
  refuel(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: RefuelDto, @Headers('idempotency-key') key?: string) {
    return this.svc.refuel(u.accountId, id, dto.liters, idem(key), dto.remote === true);
  }

  @HttpCode(200)
  @Post(':id/service')
  service(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Headers('idempotency-key') key?: string) {
    return this.svc.service(u.accountId, id, idem(key));
  }

  @HttpCode(200)
  @Post(':id/repair')
  repair(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Headers('idempotency-key') key?: string) {
    return this.svc.repair(u.accountId, id, idem(key));
  }

  @HttpCode(200)
  @Post(':id/sell')
  sell(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Headers('idempotency-key') key?: string) {
    return this.svc.sell(u.accountId, id, idem(key));
  }
}

@Module({ controllers: [VehicleController], providers: [VehicleService, CharacterService] })
export class VehicleModule {}
