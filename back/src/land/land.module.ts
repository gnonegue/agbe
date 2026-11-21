import { BadRequestException, Body, ConflictException, Controller, Get, Headers, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { AccountRequired, AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService, type Tx } from '../ledger/ledger.service';
import { SettingsService, type SettingValue } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { IDEMPOTENCY_RE } from '../character/character.dto';
import { gameHoursBetween, realMsAfterGameHours } from '../economy/clock';
import { applyEffects } from '../economy/needs';
import { accruedYield, cellCenter, feeBp, landPrice, nextStep, pricePerM2At, quartersConnected, stepFee, QUARTERS_PER_LOT } from '../economy/land';
import { sha256Hex } from '../common/crypto';

type LandCfg = SettingValue<'land'>;
type Zone = LandCfg['zones'][number];

class PickDto {
  @IsInt()
  @Min(0)
  @Max(9_999)
  cell: number;

  /** Quarts de lot voulus dans la cellule (0..3) : un quart = 150 m², deux = 300 m², quatre = le lot entier. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(QUARTERS_PER_LOT)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(QUARTERS_PER_LOT - 1, { each: true })
  quarters: number[];
}
class BuyDto {
  @Matches(/^[a-z_]{2,20}$/)
  zoneId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PickDto)
  picks: PickDto[];
}
class AskDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000_000_000)
  ask: number;
}
class MergeDto {
  /** Terrains à réunir en une seule parcelle (2 à 8). */
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ids: string[];
}
class UseDto {
  @Matches(/^(house|biz)_[a-z_]{2,24}$/)
  id: string;
}

function idem(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_RE.test(key)) throw new BadRequestException('invalid_idempotency_key');
  return key;
}

const BIG_FULL = 0b1111;

/**
 * Foncier : terrains vendus par quarts de lot dans des zones de la carte, au prix du m² qui dépend de la position,
 * démarches du titre foncier (bornage, avis favorable, titre), exploitation (maison ou activité) et revente entre joueurs.
 * Le serveur décide de tout : le client n'envoie que des intentions (zone, cellules, quarts), jamais un prix.
 */
@Injectable()
export class LandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
  ) {}

  // ---------- calculs de base ----------

  private zoneOf(cfg: LandCfg, id: string): Zone {
    const z = cfg.zones.find((x) => x.id === id);
    if (!z) throw new NotFoundException('unknown_zone');
    return z;
  }

  /**
   * Rangées ouvertes à la vente : une zone à extension (`startRows`) s'agrandit au fil des achats, en gardant
   * `reserveRows` rangées libres d'avance. Les cellules sont numérotées par rangée : les rangées ouvertes en sont un préfixe,
   * et leur nombre ne décroît jamais (un achat ne s'annule pas).
   */
  private async openRows(db: Tx | PrismaService, z: Zone): Promise<number> {
    if (!z.startRows) return z.rows;
    const sold = await db.landQuarter.groupBy({ by: ['cell'], where: { zoneId: z.id } });
    return Math.min(z.rows, Math.max(z.startRows, Math.ceil(sold.length / z.cols) + (z.reserveRows ?? 2)));
  }

  /** Prix du m² d'une cellule : position de son centre sur la carte et coefficient de la zone. */
  private perM2(cfg: LandCfg, zone: Zone, cell: number) {
    // Lotissement viabilisé : prix du m² imposé, sans majoration de position
    if (zone.fixedPerM2) return { perM2: BigInt(zone.fixedPerM2), centralityBp: 0, roadBp: 0, seaBp: 0 };
    const c = cellCenter(zone, cell);
    return pricePerM2At(cfg.price, c.x, c.z, zone.tierBp);
  }

  /** Surface possédée par un joueur (m²), tous achats confondus. */
  private async ownedM2(tx: Tx | PrismaService, characterId: string, cfg: LandCfg): Promise<number> {
    const agg = await tx.landHolding.aggregate({ where: { characterId }, _sum: { quarters: true } });
    return (agg._sum.quarters ?? 0) * cfg.quarterM2;
  }

  /** Fin d'une démarche : l'état visé est atteint ; le titre foncier reçoit son numéro. */
  private async settle(tx: Tx | PrismaService, characterId: string): Promise<void> {
    const done = await tx.landHolding.findMany({ where: { characterId, stepTarget: { not: null }, stepReadyAt: { lte: new Date() } } });
    for (const h of done) {
      let titleNo: string | undefined;
      if (h.stepTarget === 'TITLED') {
        // Numéro à 8 chiffres ; la contrainte d'unicité écarte un doublon improbable
        for (let i = 0; i < 6 && !titleNo; i++) {
          const candidate = `TF-${100_000_000 + randomInt(900_000_000)}`.slice(0, 11);
          if (!(await tx.landHolding.findUnique({ where: { titleNo: candidate }, select: { id: true } }))) titleNo = candidate;
        }
      }
      await tx.landHolding.update({ where: { id: h.id }, data: { status: h.stepTarget!, stepTarget: null, stepReadyAt: null, ...(titleNo ? { titleNo } : {}) } });
    }
  }

  /** Verrou de la ligne (requête paramétrée) : deux actions simultanées sur le même terrain ne se croisent pas. */
  private async lockHolding(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "land_holding" WHERE "id" = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException('unknown_land');
    return tx.landHolding.findUniqueOrThrow({ where: { id }, include: { listing: true } });
  }

  private useCost(cfg: LandCfg, useId: string, m2: number): { use: LandCfg['uses'][number]; cost: bigint } {
    const use = cfg.uses.find((u) => u.id === useId);
    if (!use) throw new NotFoundException('unknown_use');
    if (m2 < use.minM2) throw new BadRequestException('land_too_small');
    return { use, cost: BigInt(use.cost) + BigInt(use.costPerM2) * BigInt(m2) };
  }

  // ---------- lecture ----------

  /** Zones à vendre : prix du m² (mini, maxi), quarts libres, et règles (plafond, frais, démarches, exploitations). */
  async catalog(accountId: string) {
    const cfg = await this.settings.get('land');
    const me = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
    const sold = await this.prisma.landQuarter.groupBy({ by: ['zoneId'], _count: { _all: true } });
    const soldBy = new Map(sold.map((s) => [s.zoneId, s._count._all]));
    return {
      lotM2: cfg.lotM2,
      quarterM2: cfg.quarterM2,
      maxM2: cfg.maxM2PerPlayer,
      ownedM2: me ? await this.ownedM2(this.prisma, me.id, cfg) : 0,
      maxPicks: cfg.maxPicksPerPurchase,
      purchaseFeeBp: cfg.purchaseFeeBp,
      transferTaxBp: cfg.transferTaxBp,
      steps: cfg.steps,
      uses: cfg.uses,
      zones: await Promise.all(cfg.zones.map(async (z) => {
        const rows = await this.openRows(this.prisma, z);
        const cells = z.cols * rows;
        let min = 0n;
        let max = 0n;
        for (let i = 0; i < cells; i++) {
          const p = this.perM2(cfg, z, i).perM2;
          if (i === 0 || p < min) min = p;
          if (p > max) max = p;
        }
        return {
          id: z.id,
          nameFr: z.nameFr,
          nameEn: z.nameEn,
          descFr: z.descFr,
          descEn: z.descEn,
          layout: { originX: z.originX, originZ: z.originZ, cols: z.cols, rows, cell: z.cell },
          planRows: z.rows,
          water: !!z.water,
          totalQuarters: cells * QUARTERS_PER_LOT,
          soldQuarters: soldBy.get(z.id) ?? 0,
          minPerM2: min.toString(),
          maxPerM2: max.toString(),
        };
      })),
    };
  }

  /** Plan d'une zone : par cellule, prix du m², quarts encore libres et quarts du joueur (masques de 4 bits). */
  async zone(accountId: string, zoneId: string) {
    const cfg = await this.settings.get('land');
    const z = this.zoneOf(cfg, zoneId);
    const me = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
    const rows = await this.prisma.landQuarter.findMany({ where: { zoneId }, select: { cell: true, q: true, holdingId: true, holding: { select: { characterId: true, useId: true, useReadyAt: true, movedIn: true } } } });
    const openRows = await this.openRows(this.prisma, z);
    const cells = z.cols * openRows;
    const free = new Array<number>(cells).fill(BIG_FULL);
    const mine = new Array<number>(cells).fill(0);
    // Occupation publique pour la carte : un enregistrement par achat (masque des quarts, couleur stable de l'occupant, exploitation) ;
    // jamais de nom ni d'identifiant de joueur
    const groups = new Map<string, number>();
    const owners = new Map<string, { cell: number; q: number; g: number; o: number; mine: boolean; home: boolean; use: string | null; style: string | null; ready: boolean }>();
    const now = Date.now();
    for (const r of rows) {
      if (r.cell >= cells) continue;
      free[r.cell]! &= ~(1 << r.q);
      const isMine = r.holding.characterId === me?.id;
      if (isMine) mine[r.cell]! |= 1 << r.q;
      const okey = `${r.holdingId}:${r.cell}`;
      if (!groups.has(r.holdingId)) groups.set(r.holdingId, groups.size);
      const o = owners.get(okey) ?? {
        cell: r.cell,
        q: 0,
        // Parcelle (numéro local à la zone) : les lots réunis partagent le même numéro et sont dessinés comme un seul terrain
        g: groups.get(r.holdingId)!,
        o: parseInt(r.holding.characterId.slice(0, 8), 16) % 8,
        mine: isMine,
        // Ma maison habitée est dessinée par la carte elle-même (position du logement) : la zone ne la redessine pas
        home: isMine && r.holding.movedIn,
        use: r.holding.useId,
        // Modèle de maison dessiné sur la carte
        style: (r.holding.useId && cfg.uses.find((u) => u.id === r.holding.useId)?.style) || null,
        ready: !!r.holding.useReadyAt && r.holding.useReadyAt.getTime() <= now,
      };
      o.q |= 1 << r.q;
      owners.set(okey, o);
    }
    const price = Array.from({ length: cells }, (_, i) => Number(this.perM2(cfg, z, i).perM2));
    return { zoneId, layout: { originX: z.originX, originZ: z.originZ, cols: z.cols, rows: openRows, cell: z.cell }, planRows: z.rows, margin: z.margin ?? 6, sign: z.sign ?? true, water: !!z.water, price, free, mine, owners: [...owners.values()] };
  }

  /** Explication du prix d'une cellule (centralité, route, littoral) pour l'écran d'achat. */
  async cellInfo(zoneId: string, cell: number) {
    const cfg = await this.settings.get('land');
    const z = this.zoneOf(cfg, zoneId);
    if (cell >= z.cols * (await this.openRows(this.prisma, z))) throw new NotFoundException('unknown_plot');
    const p = this.perM2(cfg, z, cell);
    const centre = cellCenter(z, cell);
    return { zoneId, cell, x: centre.x, z: centre.z, perM2: p.perM2.toString(), centralityBp: p.centralityBp, roadBp: p.roadBp, seaBp: p.seaBp, tierBp: z.tierBp, fixed: !!z.fixedPerM2 };
  }

  /** Devis d'un achat : le détail et le total que le serveur facturera. */
  async quote(accountId: string, zoneId: string, picks: { cell: number; quarters: number[] }[]) {
    const cfg = await this.settings.get('land');
    const z = this.zoneOf(cfg, zoneId);
    const me = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
    if (!me) throw new NotFoundException('no_character');
    return this.price(cfg, z, picks, await this.ownedM2(this.prisma, me.id, cfg), z.cols * (await this.openRows(this.prisma, z)));
  }

  private price(cfg: LandCfg, z: Zone, picks: { cell: number; quarters: number[] }[], owned: number, cells: number) {
    if (picks.length > cfg.maxPicksPerPurchase) throw new BadRequestException('too_many_picks');
    const seen = new Set<number>();
    let total = 0n;
    let quarters = 0;
    const items = picks.map((p) => {
      if (p.cell >= cells) throw new NotFoundException('unknown_plot');
      if (seen.has(p.cell)) throw new BadRequestException('duplicate_cell');
      seen.add(p.cell);
      const per = this.perM2(cfg, z, p.cell).perM2;
      const price = landPrice(per, p.quarters.length, cfg.quarterM2);
      total += price;
      quarters += p.quarters.length;
      return { cell: p.cell, quarters: p.quarters, m2: p.quarters.length * cfg.quarterM2, perM2: per.toString(), price: price.toString() };
    });
    const m2 = quarters * cfg.quarterM2;
    const fee = feeBp(total, cfg.purchaseFeeBp);
    return { items, m2, ownedM2: owned, maxM2: cfg.maxM2PerPlayer, overLimit: owned + m2 > cfg.maxM2PerPlayer, total: total.toString(), fee: fee.toString(), grand: (total + fee).toString() };
  }

  /** Mes terrains : démarche en cours, exploitation, mise en vente, valeur au prix actuel du m². */
  async mine(accountId: string) {
    const cfg = await this.settings.get('land');
    const me = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
    if (!me) throw new NotFoundException('no_character');
    await this.settle(this.prisma, me.id);
    const clock = await this.settings.clock();
    const now = Date.now();
    const rows = await this.prisma.landHolding.findMany({ where: { characterId: me.id }, include: { listing: true, quarterRows: { select: { cell: true } } }, orderBy: { createdAt: 'asc' } });
    return {
      ownedM2: rows.reduce((n, h) => n + h.quarters, 0) * cfg.quarterM2,
      maxM2: cfg.maxM2PerPlayer,
      holdings: rows.map((h) => {
        const z = cfg.zones.find((x) => x.id === h.zoneId);
        const m2 = h.quarters * cfg.quarterM2;
        const per = z ? this.perM2(cfg, z, h.cell).perM2 : 0n;
        const nxt = nextStep(h.status);
        const use = h.useId ? cfg.uses.find((u) => u.id === h.useId) : undefined;
        const ready = !!h.useReadyAt && h.useReadyAt.getTime() <= now;
        let due = 0n;
        if (use && use.kind === 'BUSINESS' && ready) {
          due = accruedYield(h.useCost, use.dailyYieldBp, gameHoursBetween(clock, h.useReadyAt!.getTime(), now) / 24, use.lifeGameDays) - h.useCollected;
          if (due < 0n) due = 0n;
        }
        return {
          id: h.id,
          zoneId: h.zoneId,
          cell: h.cell,
          /** Tous les lots de la parcelle (plusieurs après un regroupement). */
          cells: [...new Set(h.quarterRows.map((r) => r.cell))].sort((a, b) => a - b),
          quarters: h.quarters,
          m2,
          paid: h.paid.toString(),
          perM2: per.toString(),
          value: (per * BigInt(m2)).toString(),
          status: h.status,
          step: h.stepTarget ? { target: h.stepTarget, readyAt: h.stepReadyAt } : null,
          next: nxt ? { step: nxt, fee: stepFee(cfg.steps[nxt], m2).toString(), gameHours: cfg.steps[nxt].gameHours } : null,
          titleNo: h.titleNo,
          use: use ? { id: use.id, cost: h.useCost.toString(), readyAt: h.useReadyAt, ready, collectable: due.toString(), collected: h.useCollected.toString(), movedIn: h.movedIn } : null,
          ask: h.listing ? h.listing.ask.toString() : null,
        };
      }),
    };
  }

  /** Terrains titrés mis en vente par les joueurs. */
  async market(accountId: string) {
    const cfg = await this.settings.get('land');
    const me = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
    const rows = await this.prisma.landListing.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { holding: true } });
    const owners = await this.prisma.character.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.holding.characterId))] } }, select: { id: true, name: true } });
    const names = new Map(owners.map((o) => [o.id, o.name]));
    return {
      transferTaxBp: cfg.transferTaxBp,
      listings: rows.map((r) => {
        const h = r.holding;
        const m2 = h.quarters * cfg.quarterM2;
        const z = cfg.zones.find((x) => x.id === h.zoneId);
        const market = z ? this.perM2(cfg, z, h.cell).perM2 : 0n;
        const use = h.useId ? cfg.uses.find((u) => u.id === h.useId) : undefined;
        return {
          id: h.id,
          zoneId: h.zoneId,
          cell: h.cell,
          m2,
          titleNo: h.titleNo,
          seller: names.get(h.characterId) ?? '—',
          mine: h.characterId === me?.id,
          ask: r.ask.toString(),
          askPerM2: m2 > 0 ? (r.ask / BigInt(m2)).toString() : '0',
          marketPerM2: market.toString(),
          use: use ? { id: use.id, ready: !!h.useReadyAt && h.useReadyAt.getTime() <= Date.now() } : null,
        };
      }),
    };
  }

  // ---------- achat ----------

  buy(accountId: string, zoneId: string, picks: { cell: number; quarters: number[] }[], idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `landbuy:${c.id}:${idemKey}` : undefined;
      const norm = picks.map((p) => ({ cell: p.cell, quarters: [...p.quarters].sort((a, b) => a - b) }));
      const requestHash = sha256Hex(`landbuy|${zoneId}|${JSON.stringify(norm)}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { zoneId, replay: true };
      const cfg = await this.settings.get('land');
      const z = this.zoneOf(cfg, zoneId);
      const q = this.price(cfg, z, norm, await this.ownedM2(tx, c.id, cfg), z.cols * (await this.openRows(tx, z)));
      if (q.overLimit) throw new BadRequestException('land_limit');
      // Quarts déjà vendus : message clair ; la clé primaire (zone, cellule, quart) tranche les achats simultanés
      const taken = await tx.landQuarter.findFirst({ where: { zoneId, OR: norm.map((p) => ({ cell: p.cell, q: { in: p.quarters } })) }, select: { cell: true } });
      if (taken) throw new ConflictException('land_taken');
      const total = BigInt(q.total);
      const fee = BigInt(q.fee);
      const legs = [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: total }];
      if (fee > 0n) legs.push({ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'TREASURY'), amount: fee });
      await this.ledger.post(tx, { kind: 'LAND_BUY', idempotencyKey: key, requestHash, memo: `${zoneId}:${norm.length}`, legs });
      try {
        for (const it of q.items) {
          const h = await tx.landHolding.create({ data: { characterId: c.id, zoneId, cell: it.cell, quarters: it.quarters.length, paid: BigInt(it.price) } });
          await tx.landQuarter.createMany({ data: it.quarters.map((qq) => ({ zoneId, cell: it.cell, q: qq, holdingId: h.id })) });
        }
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('land_taken');
        throw e;
      }
      return { zoneId, m2: q.m2, paid: q.total, fee: q.fee, replay: false };
    });
  }

  // ---------- regroupement de lots ----------

  /**
   * Réunit plusieurs terrains voisins du même propriétaire en une seule parcelle (ex. deux lots collés pour atteindre les 1 200 m²
   * d'une cimenterie). Les terrains doivent être dans la même zone, se toucher (côté à côté), être au même stade de titre foncier,
   * sans démarche en cours, sans exploitation ni mise en vente. La parcelle garde le titre du premier ; la surface totale s'additionne.
   */
  merge(accountId: string, ids: string[]) {
    return this.chars.act(accountId, async (tx, c) => {
      const cfg = await this.settings.get('land');
      const sorted = [...ids].sort();
      for (const id of sorted) await this.lockHolding(tx, id);
      await this.settle(tx, c.id);
      const hs = await tx.landHolding.findMany({ where: { id: { in: sorted } }, include: { listing: true, quarterRows: { select: { cell: true, q: true } } } });
      if (hs.length !== sorted.length || hs.some((h) => h.characterId !== c.id)) throw new NotFoundException('unknown_land');
      if (new Set(hs.map((h) => h.zoneId)).size !== 1) throw new BadRequestException('merge_other_zone');
      if (new Set(hs.map((h) => h.status)).size !== 1) throw new BadRequestException('merge_status_differs');
      if (hs.some((h) => h.stepTarget)) throw new ConflictException('step_in_progress');
      if (hs.some((h) => h.listing)) throw new ConflictException('land_listed');
      if (hs.some((h) => h.useId)) throw new ConflictException('land_in_use');
      const zone = this.zoneOf(cfg, hs[0]!.zoneId);
      // Un seul terrain d'un tenant : tous les quarts réunis doivent se toucher par un côté (pas seulement les lots)
      if (!quartersConnected(zone.cols, hs.flatMap((h) => h.quarterRows))) throw new BadRequestException('merge_not_adjacent');
      const main = [...hs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]!;
      const others = hs.filter((h) => h.id !== main.id);
      await tx.landQuarter.updateMany({ where: { holdingId: { in: others.map((h) => h.id) } }, data: { holdingId: main.id } });
      await tx.landHolding.deleteMany({ where: { id: { in: others.map((h) => h.id) } } });
      const quarters = hs.reduce((n, h) => n + h.quarters, 0);
      const paid = hs.reduce((n, h) => n + h.paid, 0n);
      await tx.landHolding.update({ where: { id: main.id }, data: { quarters, paid } });
      return { id: main.id, m2: quarters * cfg.quarterM2, merged: hs.length };
    });
  }

  // ---------- démarches du titre foncier ----------

  /** Engage la démarche suivante (bornage, avis favorable, titre) : frais payés au début, résultat après le délai. */
  step(accountId: string, id: string, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `landstep:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`landstep|${id}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { id, replay: true };
      const h = await this.lockHolding(tx, id);
      if (h.characterId !== c.id) throw new NotFoundException('unknown_land');
      await this.settle(tx, c.id);
      const fresh = await tx.landHolding.findUniqueOrThrow({ where: { id } });
      if (fresh.stepTarget) throw new ConflictException('step_in_progress');
      if (h.listing) throw new ConflictException('land_listed');
      const nxt = nextStep(fresh.status);
      if (!nxt) throw new ConflictException('already_titled');
      const cfg = await this.settings.get('land');
      const m2 = fresh.quarters * cfg.quarterM2;
      const fee = stepFee(cfg.steps[nxt], m2);
      await this.ledger.post(tx, {
        kind: 'LAND_FEES',
        idempotencyKey: key,
        requestHash,
        memo: `${nxt}:${id}`,
        legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'TREASURY'), amount: fee }],
      });
      const readyAt = new Date(Math.ceil(realMsAfterGameHours(await this.settings.clock(), Date.now(), cfg.steps[nxt].gameHours)));
      await tx.landHolding.update({ where: { id }, data: { stepTarget: nxt, stepReadyAt: readyAt } });
      return { id, step: nxt, paid: fee.toString(), readyAt, replay: false };
    });
  }

  // ---------- exploitation ----------

  /** Met un terrain titré en valeur : maison à construire ou activité (le capital investi rapporte chaque jour de jeu). */
  startUse(accountId: string, id: string, useId: string, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `landuse:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`landuse|${id}|${useId}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { id, replay: true };
      const h = await this.lockHolding(tx, id);
      if (h.characterId !== c.id) throw new NotFoundException('unknown_land');
      await this.settle(tx, c.id);
      const fresh = await tx.landHolding.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== 'TITLED') throw new BadRequestException('no_title');
      if (fresh.useId) throw new ConflictException('land_in_use');
      if (h.listing) throw new ConflictException('land_listed');
      const cfg = await this.settings.get('land');
      const { use, cost } = this.useCost(cfg, useId, fresh.quarters * cfg.quarterM2);
      if (cost > 0n) {
        await this.ledger.post(tx, {
          kind: 'LAND_USE',
          idempotencyKey: key,
          requestHash,
          memo: `${useId}:${id}`,
          legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'MARKET'), amount: cost }],
        });
      }
      const readyAt = new Date(Math.ceil(realMsAfterGameHours(await this.settings.clock(), Date.now(), use.buildGameDays * 24)));
      await tx.landHolding.update({ where: { id }, data: { useId, useCost: cost, useReadyAt: readyAt, useCollected: 0n, movedIn: false } });
      return { id, use: useId, paid: cost.toString(), readyAt, replay: false };
    });
  }

  /** Encaisse le revenu accumulé d'une activité ; au bout de sa durée de vie, l'installation est à renouveler. */
  collect(accountId: string, id: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const h = await this.lockHolding(tx, id);
      if (h.characterId !== c.id) throw new NotFoundException('unknown_land');
      const cfg = await this.settings.get('land');
      const use = h.useId ? cfg.uses.find((u) => u.id === h.useId) : undefined;
      if (!use || use.kind !== 'BUSINESS' || !h.useReadyAt) throw new BadRequestException('no_business');
      if (h.useReadyAt.getTime() > Date.now()) throw new BadRequestException('site_not_ready');
      const days = gameHoursBetween(await this.settings.clock(), h.useReadyAt.getTime(), Date.now()) / 24;
      const due = accruedYield(h.useCost, use.dailyYieldBp, days, use.lifeGameDays);
      const amount = due > h.useCollected ? due - h.useCollected : 0n;
      if (amount > 0n) {
        await this.ledger.post(tx, {
          kind: 'LAND_YIELD',
          idempotencyKey: `landyield:${h.id}:${due.toString()}`,
          memo: use.id,
          legs: [{ from: await this.ledger.systemWalletId(tx, 'MARKET'), to: c.walletId, amount }],
        });
      }
      const worn = days >= use.lifeGameDays;
      await tx.landHolding.update({
        where: { id },
        data: worn ? { useId: null, useCost: 0n, useReadyAt: null, useCollected: 0n } : { useCollected: due > h.useCollected ? due : h.useCollected },
      });
      return { id, received: amount.toString(), worn };
    });
  }

  /** Remise des clés d'une maison construite sur son terrain : elle devient le logement du joueur (propriétaire, plus de loyer). */
  moveIn(accountId: string, id: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const h = await this.lockHolding(tx, id);
      if (h.characterId !== c.id) throw new NotFoundException('unknown_land');
      const cfg = await this.settings.get('land');
      const use = h.useId ? cfg.uses.find((u) => u.id === h.useId) : undefined;
      if (!use || use.kind !== 'HOUSE' || !use.model) throw new BadRequestException('no_house');
      if (!h.useReadyAt || h.useReadyAt.getTime() > Date.now()) throw new BadRequestException('house_not_ready');
      if (h.movedIn) throw new ConflictException('already_moved_in');
      const z = this.zoneOf(cfg, h.zoneId);
      const pos = cellCenter(z, h.cell);
      const n = applyEffects({ hunger: c.hunger, energy: c.energy, hygiene: c.hygiene, health: c.health, morale: c.morale, respect: c.respect }, { morale: 25, respect: 20 });
      await tx.character.update({ where: { id: c.id }, data: { ...n, housing: use.model, homeOwned: true, homeX: Math.round(pos.x), homeZ: Math.round(pos.z) } });
      // Un seul logement habité à la fois
      await tx.landHolding.updateMany({ where: { characterId: c.id, movedIn: true }, data: { movedIn: false } });
      await tx.landHolding.update({ where: { id }, data: { movedIn: true } });
      return { housing: use.model, x: pos.x, z: pos.z };
    });
  }

  // ---------- revente entre joueurs ----------

  /** Met un terrain titré en vente à un prix demandé (au plus `maxAskMultiple` fois sa valeur). */
  list(accountId: string, id: string, ask: number) {
    return this.chars.act(accountId, async (tx, c) => {
      const h = await this.lockHolding(tx, id);
      if (h.characterId !== c.id) throw new NotFoundException('unknown_land');
      await this.settle(tx, c.id);
      const fresh = await tx.landHolding.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== 'TITLED') throw new BadRequestException('no_title');
      if (fresh.movedIn) throw new ConflictException('home_not_sellable');
      if (h.listing) throw new ConflictException('land_listed');
      const cfg = await this.settings.get('land');
      const z = this.zoneOf(cfg, fresh.zoneId);
      const m2 = fresh.quarters * cfg.quarterM2;
      const value = this.perM2(cfg, z, fresh.cell).perM2 * BigInt(m2);
      const base = value > fresh.paid + fresh.useCost ? value : fresh.paid + fresh.useCost;
      if (BigInt(ask) > base * BigInt(cfg.maxAskMultiple)) throw new BadRequestException('ask_too_high');
      await tx.landListing.create({ data: { holdingId: id, ask: BigInt(ask) } });
      return { id, ask: String(ask) };
    });
  }

  unlist(accountId: string, id: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const h = await this.lockHolding(tx, id);
      if (h.characterId !== c.id) throw new NotFoundException('unknown_land');
      if (!h.listing) throw new NotFoundException('not_listed');
      await tx.landListing.delete({ where: { holdingId: id } });
      return { id };
    });
  }

  /** Achat d'un terrain mis en vente : prix au vendeur, droits d'enregistrement au Trésor, titre muté au nouvel propriétaire. */
  buyListing(accountId: string, id: string, idemKey?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idemKey ? `landsale:${c.id}:${idemKey}` : undefined;
      const requestHash = sha256Hex(`landsale|${id}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { id, replay: true };
      const h = await this.lockHolding(tx, id);
      if (!h.listing) throw new NotFoundException('not_listed');
      if (h.characterId === c.id) throw new BadRequestException('own_land');
      const cfg = await this.settings.get('land');
      if ((await this.ownedM2(tx, c.id, cfg)) + h.quarters * cfg.quarterM2 > cfg.maxM2PerPlayer) throw new BadRequestException('land_limit');
      const seller = await tx.character.findUnique({ where: { id: h.characterId }, select: { id: true, wallet: { select: { id: true } } } });
      if (!seller?.wallet) throw new NotFoundException('unknown_land');
      const ask = h.listing.ask;
      const tax = feeBp(ask, cfg.transferTaxBp);
      const legs = [{ from: c.walletId, to: seller.wallet.id, amount: ask }];
      if (tax > 0n) legs.push({ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'TREASURY'), amount: tax });
      await this.ledger.post(tx, { kind: 'LAND_SALE', idempotencyKey: key, requestHash, memo: `${id}`, legs });
      await tx.landListing.delete({ where: { holdingId: id } });
      // Mutation : le titre et l'exploitation suivent le terrain ; le nouveau propriétaire n'a pas encore emménagé
      await tx.landHolding.update({ where: { id }, data: { characterId: c.id, paid: ask, movedIn: false } });
      return { id, paid: ask.toString(), tax: tax.toString(), replay: false };
    });
  }
}

@Controller('land')
export class LandController {
  constructor(private readonly svc: LandService) {}

  @Get()
  catalog(@CurrentUser() u: AuthUser) {
    return this.svc.catalog(u.accountId);
  }

  @Get('zones/:zoneId')
  zone(@CurrentUser() u: AuthUser, @Param('zoneId') zoneId: string) {
    if (!/^[a-z_]{2,20}$/.test(zoneId)) throw new BadRequestException('unknown_zone');
    return this.svc.zone(u.accountId, zoneId);
  }

  @Get('zones/:zoneId/cells/:cell')
  cell(@Param('zoneId') zoneId: string, @Param('cell') cell: string) {
    const n = Number(cell);
    if (!/^[a-z_]{2,20}$/.test(zoneId) || !Number.isInteger(n) || n < 0 || n > 9_999) throw new BadRequestException('unknown_plot');
    return this.svc.cellInfo(zoneId, n);
  }

  @HttpCode(200)
  @Post('quote')
  quote(@CurrentUser() u: AuthUser, @Body() dto: BuyDto) {
    return this.svc.quote(u.accountId, dto.zoneId, dto.picks);
  }

  @HttpCode(200)
  @AccountRequired()
  @Post('buy')
  buy(@CurrentUser() u: AuthUser, @Body() dto: BuyDto, @Headers('idempotency-key') key?: string) {
    return this.svc.buy(u.accountId, dto.zoneId, dto.picks, idem(key));
  }

  @Get('mine')
  mine(@CurrentUser() u: AuthUser) {
    return this.svc.mine(u.accountId);
  }

  @Get('market')
  market(@CurrentUser() u: AuthUser) {
    return this.svc.market(u.accountId);
  }

  @HttpCode(200)
  @Post('merge')
  merge(@CurrentUser() u: AuthUser, @Body() dto: MergeDto) {
    return this.svc.merge(u.accountId, dto.ids);
  }

  @HttpCode(200)
  @Post(':id/step')
  step(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Headers('idempotency-key') key?: string) {
    return this.svc.step(u.accountId, id, idem(key));
  }

  @HttpCode(200)
  @Post(':id/use')
  use(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: UseDto, @Headers('idempotency-key') key?: string) {
    return this.svc.startUse(u.accountId, id, dto.id, idem(key));
  }

  @HttpCode(200)
  @Post(':id/collect')
  collect(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.svc.collect(u.accountId, id);
  }

  @HttpCode(200)
  @Post(':id/move-in')
  moveIn(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.svc.moveIn(u.accountId, id);
  }

  @HttpCode(200)
  @AccountRequired()
  @Post(':id/list')
  list(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: AskDto) {
    return this.svc.list(u.accountId, id, dto.ask);
  }

  @HttpCode(200)
  @Post(':id/unlist')
  unlist(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.svc.unlist(u.accountId, id);
  }

  @HttpCode(200)
  @AccountRequired()
  @Post(':id/buy-listing')
  buyListing(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Headers('idempotency-key') key?: string) {
    return this.svc.buyListing(u.accountId, id, idem(key));
  }
}

@Module({ controllers: [LandController], providers: [LandService, CharacterService] })
export class LandModule {}
