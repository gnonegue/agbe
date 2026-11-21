import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { IsInt, IsNumber, IsUUID, Matches, Max, Min } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService, HOME } from '../character/character.service';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { insideRoom, overlaps, resalePrice, standingOf, type FurnitureDef } from '../economy/home';
import { sha256Hex } from '../common/crypto';
import { AuditService } from '../common/audit.service';
import { Optional } from '@nestjs/common';

class PlaceDto {
  @Matches(/^[a-z0-9_]{2,24}$/)
  itemId: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-60)
  @Max(60)
  x: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-60)
  @Max(60)
  z: number;

  @IsInt()
  @Min(0)
  @Max(3)
  rot: number;
}
class MoveDto {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-60)
  @Max(60)
  x: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-60)
  @Max(60)
  z: number;

  @IsInt()
  @Min(0)
  @Max(3)
  rot: number;
}

class GiftDto {
  @IsUUID('4')
  to: string;
}

/** Rangement : meubles qui ne sont posés dans aucun logement. */
const STORAGE = 'STORAGE';

function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

/**
 * Aménagement du logement : le joueur achète des meubles du catalogue (prix du serveur, grand livre), les pose, les déplace et les
 * revend. Le serveur vérifie les limites de la pièce, les chevauchements entre meubles posés et le nombre d'emplacements.
 */
@Injectable()
export class HomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /**
   * Meubles d'origine du logement : donnés une seule fois au joueur (à la première ouverture), puis ils lui appartiennent ; leur
   * valeur de revente est une part réduite du catalogue (réglage starterValueBp).
   */
  private async seedStarters(characterId: string, housing: string): Promise<boolean> {
    const cfg = await this.settings.get('home.furniture');
    const starters = cfg.starters[housing];
    if (!starters || starters.length === 0) return false;
    return this.prisma.$transaction(async (tx) => {
      const ch = await tx.character.findUniqueOrThrow({ where: { id: characterId }, select: { homeSeeded: true } });
      const done = ch.homeSeeded.split(',').filter(Boolean);
      if (done.includes(housing)) return true;
      // Marque d'abord (conditionnelle) : deux ouvertures simultanées ne donnent pas deux fois les meubles
      const claimed = await tx.character.updateMany({ where: { id: characterId, homeSeeded: ch.homeSeeded }, data: { homeSeeded: [...done, housing].join(',') } });
      if (claimed.count !== 1) return true;
      const rows = starters.flatMap((st) => {
        const def = cfg.items.find((i) => i.id === st.itemId);
        return def ? [{ characterId, housing, itemId: st.itemId, x: st.x, z: st.z, rot: st.rot, paid: Math.floor((def.price * cfg.starterValueBp) / 10_000) }] : [];
      });
      await tx.homeItem.createMany({ data: rows });
      return true;
    });
  }

  /** Catalogue, emplacements et meubles du logement actuel, avec le standing. */
  async view(accountId: string) {
    const ch = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true, housing: true } });
    if (!ch) throw new NotFoundException('no_character');
    const cfg = await this.settings.get('home.furniture');
    // Les meubles d'origine (studio, chambre-salon) deviennent ceux du joueur : `custom` dit à la 3D de ne plus les dessiner elle-même
    const custom = await this.seedStarters(ch.id, ch.housing);
    const all = await this.prisma.homeItem.findMany({ where: { characterId: ch.id, housing: { in: [ch.housing, STORAGE] } }, orderBy: { createdAt: 'asc' } });
    const items = all.filter((i) => i.housing === ch.housing);
    const storage = all.filter((i) => i.housing === STORAGE);
    const comfort = items.reduce((a, i) => a + (cfg.items.find((d) => d.id === i.itemId)?.comfort ?? 0), 0);
    return {
      housing: ch.housing,
      slots: cfg.slots[ch.housing] ?? 0,
      room: cfg.rooms[ch.housing] ?? null,
      resaleBp: cfg.resaleBp,
      custom,
      storageMax: cfg.storageMax,
      comfort,
      standing: standingOf(comfort, cfg.standing),
      thresholds: cfg.standing,
      catalog: cfg.items,
      items: items.map((i) => ({ id: i.id, itemId: i.itemId, x: i.x, z: i.z, rot: i.rot, paid: i.paid })),
      storage: storage.map((i) => ({ id: i.id, itemId: i.itemId, paid: i.paid })),
    };
  }

  private def(cfg: { items: FurnitureDef[] }, itemId: string): FurnitureDef {
    const d = cfg.items.find((x) => x.id === itemId);
    if (!d) throw new NotFoundException('unknown_item');
    return d;
  }

  /** Acheter et poser un meuble (chez soi uniquement). */
  place(accountId: string, dto: PlaceDto, key?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      if (c.locationId !== HOME) throw new BadRequestException('not_at_home');
      const cfg = await this.settings.get('home.furniture');
      const room = cfg.rooms[c.housing];
      const slots = cfg.slots[c.housing];
      if (!room || slots === undefined) throw new BadRequestException('no_home_room');
      const def = this.def(cfg, dto.itemId);
      const full = cfg.items.find((x) => x.id === dto.itemId)!;
      const idemKey = key ? `furn:${c.id}:${key}` : undefined;
      const requestHash = sha256Hex(`furn-buy|${dto.itemId}|${dto.x}|${dto.z}|${dto.rot}`);
      if (idemKey && (await this.ledger.findReplay(tx, idemKey, requestHash))) return { id: null, replay: true };
      const mine = await tx.homeItem.findMany({ where: { characterId: c.id, housing: c.housing } });
      if (mine.length >= slots) throw new BadRequestException('no_free_slot');
      if (full.fixed && dto.rot !== 0) throw new BadRequestException('fixed_rotation');
      if (!insideRoom(def, dto, room)) throw new BadRequestException('out_of_room');
      const cand = { def, p: { itemId: dto.itemId, x: dto.x, z: dto.z, rot: dto.rot } };
      for (const m of mine) {
        const md = cfg.items.find((x) => x.id === m.itemId);
        if (md && overlaps(cand, { def: md, p: { itemId: m.itemId, x: m.x, z: m.z, rot: m.rot } })) throw new BadRequestException('furniture_overlap');
      }
      await this.ledger.post(tx, { kind: 'FURNITURE_BUY', idempotencyKey: idemKey, requestHash, memo: dto.itemId, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: BigInt(full.price) }] });
      const row = await tx.homeItem.create({ data: { characterId: c.id, housing: c.housing, itemId: dto.itemId, x: dto.x, z: dto.z, rot: dto.rot, paid: full.price } });
      return { id: row.id, paid: String(full.price), replay: false };
    });
  }

  /** Déplacer ou tourner un meuble déjà posé. */
  move(accountId: string, id: string, dto: MoveDto) {
    return this.chars.act(accountId, async (tx, c) => {
      if (c.locationId !== HOME) throw new BadRequestException('not_at_home');
      const cfg = await this.settings.get('home.furniture');
      const room = cfg.rooms[c.housing];
      const item = await tx.homeItem.findFirst({ where: { id, characterId: c.id, housing: c.housing } });
      if (!item || !room) throw new NotFoundException('unknown_furniture');
      const def = this.def(cfg, item.itemId);
      if (cfg.items.find((x) => x.id === item.itemId)?.fixed && dto.rot !== 0) throw new BadRequestException('fixed_rotation');
      if (!insideRoom(def, dto, room)) throw new BadRequestException('out_of_room');
      const cand = { def, p: { itemId: item.itemId, x: dto.x, z: dto.z, rot: dto.rot } };
      for (const m of await tx.homeItem.findMany({ where: { characterId: c.id, housing: c.housing, id: { not: id } } })) {
        const md = cfg.items.find((x) => x.id === m.itemId);
        if (md && overlaps(cand, { def: md, p: { itemId: m.itemId, x: m.x, z: m.z, rot: m.rot } })) throw new BadRequestException('furniture_overlap');
      }
      await tx.homeItem.update({ where: { id }, data: { x: dto.x, z: dto.z, rot: dto.rot } });
      return { id };
    });
  }

  /** Ranger un meuble posé : il quitte la pièce et va au rangement (on peut le reposer, le donner ou le revendre). */
  store(accountId: string, id: string) {
    return this.chars.act(accountId, async (tx, c) => {
      if (c.locationId !== HOME) throw new BadRequestException('not_at_home');
      const cfg = await this.settings.get('home.furniture');
      if ((await tx.homeItem.count({ where: { characterId: c.id, housing: STORAGE } })) >= cfg.storageMax) throw new BadRequestException('storage_full');
      const r = await tx.homeItem.updateMany({ where: { id, characterId: c.id, housing: c.housing }, data: { housing: STORAGE, x: 0, z: 0, rot: 0 } });
      if (r.count !== 1) throw new NotFoundException('unknown_furniture');
      return { id };
    });
  }

  /** Reposer un meuble rangé dans le logement (aucun achat : il est déjà à soi). */
  placeStored(accountId: string, id: string, dto: MoveDto) {
    return this.chars.act(accountId, async (tx, c) => {
      if (c.locationId !== HOME) throw new BadRequestException('not_at_home');
      const cfg = await this.settings.get('home.furniture');
      const room = cfg.rooms[c.housing];
      const slots = cfg.slots[c.housing];
      if (!room || slots === undefined) throw new BadRequestException('no_home_room');
      const item = await tx.homeItem.findFirst({ where: { id, characterId: c.id, housing: STORAGE } });
      if (!item) throw new NotFoundException('unknown_furniture');
      const def = this.def(cfg, item.itemId);
      if (cfg.items.find((x) => x.id === item.itemId)?.fixed && dto.rot !== 0) throw new BadRequestException('fixed_rotation');
      const mine = await tx.homeItem.findMany({ where: { characterId: c.id, housing: c.housing } });
      if (mine.length >= slots) throw new BadRequestException('no_free_slot');
      if (!insideRoom(def, dto, room)) throw new BadRequestException('out_of_room');
      const cand = { def, p: { itemId: item.itemId, x: dto.x, z: dto.z, rot: dto.rot } };
      for (const m of mine) {
        const md = cfg.items.find((x) => x.id === m.itemId);
        if (md && overlaps(cand, { def: md, p: { itemId: m.itemId, x: m.x, z: m.z, rot: m.rot } })) throw new BadRequestException('furniture_overlap');
      }
      await tx.homeItem.update({ where: { id }, data: { housing: c.housing, x: dto.x, z: dto.z, rot: dto.rot } });
      return { id };
    });
  }

  /**
   * Donner un meuble à un autre joueur : il arrive dans son rangement. Valeur de revente réduite (giftValueBp) pour que le don ne
   * serve pas à transférer de l'argent sans frais ni limites.
   */
  gift(accountId: string, id: string, toCharacterId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      if (c.locationId !== HOME) throw new BadRequestException('not_at_home');
      if (toCharacterId === c.id) throw new BadRequestException('gift_self');
      const cfg = await this.settings.get('home.furniture');
      const to = await tx.character.findFirst({ where: { id: toCharacterId, account: { deletedAt: null, suspendedAt: null } }, select: { id: true } });
      if (!to) throw new NotFoundException('unknown_recipient');
      if ((await tx.homeItem.count({ where: { characterId: to.id, housing: STORAGE } })) >= cfg.storageMax) throw new BadRequestException('recipient_storage_full');
      const item = await tx.homeItem.findFirst({ where: { id, characterId: c.id, housing: { in: [c.housing, STORAGE] } } });
      if (!item) throw new NotFoundException('unknown_furniture');
      const paid = Math.floor((item.paid * cfg.giftValueBp) / 10_000);
      const r = await tx.homeItem.updateMany({ where: { id, characterId: c.id }, data: { characterId: to.id, housing: STORAGE, x: 0, z: 0, rot: 0, paid } });
      if (r.count !== 1) throw new NotFoundException('unknown_furniture');
      await this.audit?.log('home.furniture_gift', { actorId: accountId, target: to.id, meta: { item: item.itemId } }, tx);
      return { id, to: to.id };
    });
  }

  /** Revendre un meuble : une part du prix payé revient au joueur (réglage resaleBp), versée une seule fois. */
  sell(accountId: string, id: string) {
    return this.chars.act(accountId, async (tx, c) => {
      if (c.locationId !== HOME) throw new BadRequestException('not_at_home');
      const cfg = await this.settings.get('home.furniture');
      const item = await tx.homeItem.findFirst({ where: { id, characterId: c.id, housing: { in: [c.housing, STORAGE] } } });
      if (!item) throw new NotFoundException('unknown_furniture');
      // Suppression d'abord : si deux ventes arrivent ensemble, une seule trouve la ligne et paie
      const gone = await tx.homeItem.deleteMany({ where: { id } });
      if (gone.count !== 1) throw new NotFoundException('unknown_furniture');
      const back = resalePrice(item.paid, cfg.resaleBp);
      if (back > 0) {
        await this.ledger.post(tx, { kind: 'FURNITURE_SELL', idempotencyKey: `furn-sell:${id}`, memo: item.itemId, legs: [{ from: await this.ledger.systemWalletId(tx, 'MARKET'), to: c.walletId, amount: BigInt(back) }] });
      }
      return { id, received: String(back) };
    });
  }
}

@Controller('home')
export class HomeController {
  constructor(private readonly svc: HomeService) {}

  @Get('furniture')
  view(@CurrentUser() u: AuthUser) {
    return this.svc.view(u.accountId);
  }

  @HttpCode(200)
  @Post('furniture')
  place(@CurrentUser() u: AuthUser, @Body() dto: PlaceDto, @Headers('idempotency-key') key?: string) {
    return this.svc.place(u.accountId, dto, idem(key));
  }

  @HttpCode(200)
  @Put('furniture/:id')
  move(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: MoveDto) {
    return this.svc.move(u.accountId, id, dto);
  }

  @HttpCode(200)
  @Post('furniture/:id/store')
  store(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.svc.store(u.accountId, id);
  }

  @HttpCode(200)
  @Post('furniture/:id/place')
  placeStored(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: MoveDto) {
    return this.svc.placeStored(u.accountId, id, dto);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('furniture/:id/gift')
  gift(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: GiftDto) {
    return this.svc.gift(u.accountId, id, dto.to);
  }

  @Delete('furniture/:id')
  sell(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.svc.sell(u.accountId, id);
  }
}

@Module({ controllers: [HomeController], providers: [HomeService, CharacterService] })
export class HomeModule {}
