import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { LiveService } from '../live/live.service';
import { randomInt } from 'node:crypto';
import type { Tontine } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService, type Leg, type Tx } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { gameTimeAt } from '../economy/clock';
import { deadlineOf, drawTurns, roundAt, settleRound } from '../economy/tontine';
import { sha256Hex } from '../common/crypto';

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Tontine entre joueurs. L'argent cotisé est séquestré dans le portefeuille système TONTINE ;
 * chaque tour échu est réglé (au bénéficiaire, ou remboursé aux cotisants) de façon paresseuse à la consultation.
 */
@Injectable()
export class TontineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
    @Optional() private readonly live?: LiveService,
  ) {}

  private async today(): Promise<number> {
    return gameTimeAt(await this.settings.clock(), Date.now()).day;
  }

  /** Verrou de ligne sur la tontine (requête paramétrée) : un seul règlement ou paiement à la fois. */
  private async lock(tx: Tx, id: string): Promise<Tontine> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "tontine" WHERE "id" = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException('unknown_tontine');
    return tx.tontine.findUniqueOrThrow({ where: { id } });
  }

  /** Règle tous les tours échus (ou le tour en cours si `early` et que tout le monde a cotisé). */
  private async settle(tx: Tx, t: Tontine, today: number, early = false): Promise<Tontine> {
    if (t.status !== 'ACTIVE' || t.startDay === null) return t;
    const members = await tx.tontineMember.findMany({ where: { tontineId: t.id } });
    const n = members.length;
    const cfg = await this.settings.get('tontine');
    let next = t.nextPayout;
    const escrow = await this.ledger.systemWalletId(tx, 'TONTINE');
    const treasury = await this.ledger.systemWalletId(tx, 'TREASURY');
    while (next < n) {
      const due = deadlineOf(t.startDay, t.periodDays, next) <= today;
      const paid = await tx.tontineContribution.findMany({ where: { tontineId: t.id, round: next } });
      const everyone = paid.length === n;
      if (!due && !(early && everyone)) break;
      const missedBefore = new Map(members.map((m) => [m.id, m.missed]));
      const s = settleRound({
        members: members.map((m) => ({ id: m.id, turn: m.turn ?? -1, missedBefore: missedBefore.get(m.id) ?? 0, present: m.characterId !== null })),
        paid: paid.map((p) => ({ memberId: p.memberId, amount: p.amount })),
        round: next,
      });
      // Défaillants : tour manqué, réputation entachée (respect et moral)
      for (const id of s.missing) {
        const m = members.find((x) => x.id === id)!;
        m.missed += 1;
        await tx.tontineMember.update({ where: { id }, data: { missed: { increment: 1 } } });
        if (m.characterId) {
          const c = await tx.character.findUnique({ where: { id: m.characterId }, select: { respect: true, morale: true } });
          if (c) await tx.character.update({ where: { id: m.characterId }, data: { tontineDefaults: { increment: 1 }, respect: clamp(c.respect - cfg.missRespect), morale: clamp(c.morale - cfg.missMorale) } });
        }
      }
      const walletOf = async (memberId: string) => {
        const m = members.find((x) => x.id === memberId);
        const w = m?.characterId ? await tx.wallet.findUnique({ where: { characterId: m.characterId }, select: { id: true } }) : null;
        return w?.id ?? treasury; // joueur parti : sa part revient au Trésor, comme le reste de son patrimoine
      };
      let beneficiaryId: string | null = null;
      let refunded = false;
      const pay = s.payout;
      if (pay.kind === 'beneficiary') {
        const m = members.find((x) => x.id === pay.to)!;
        beneficiaryId = m.characterId;
        await this.ledger.post(tx, { kind: 'TONTINE_PAYOUT', idempotencyKey: `tontine:${t.id}:${next}`, memo: `${t.id}:${next}`, legs: [{ from: escrow, to: await walletOf(m.id), amount: pay.amount }] });
      } else if (pay.kind === 'refund') {
        refunded = true;
        const legs: Leg[] = [];
        for (const r of pay.to) legs.push({ from: escrow, to: await walletOf(r.member), amount: r.amount });
        await this.ledger.post(tx, { kind: 'TONTINE_REFUND', idempotencyKey: `tontine:${t.id}:${next}`, memo: `${t.id}:${next}`, legs });
      }
      await tx.tontinePayout.create({ data: { tontineId: t.id, round: next, beneficiaryId, amount: s.pot, refunded } });
      next += 1;
      early = false; // un seul tour versé en avance à la fois
    }
    if (next !== t.nextPayout) {
      return tx.tontine.update({ where: { id: t.id }, data: { nextPayout: next, status: next >= n ? 'FINISHED' : 'ACTIVE' } });
    }
    return t;
  }

  /** Règle les tontines actives du joueur (appelé à la consultation). */
  private async settleMine(characterId: string) {
    const today = await this.today();
    const ids = await this.prisma.tontineMember.findMany({ where: { characterId, tontine: { status: 'ACTIVE' } }, select: { tontineId: true } });
    for (const { tontineId } of ids) {
      await this.prisma.$transaction(async (tx) => this.settle(tx, await this.lock(tx, tontineId), today));
    }
  }

  private view(t: Tontine & { members: { id: string; characterId: string | null; name: string; turn: number | null; missed: number }[]; contributions: { memberId: string; round: number }[]; payouts: { round: number; amount: bigint; refunded: boolean; beneficiaryId: string | null }[] }, me: string, today: number) {
    const n = t.members.length;
    const round = t.startDay === null ? null : Math.min(roundAt(t.startDay, t.periodDays, today), n);
    const mine = t.members.find((m) => m.characterId === me);
    const cur = t.nextPayout;
    return {
      id: t.id,
      name: t.name,
      owner: t.ownerId === me,
      contribution: t.contribution.toString(),
      periodDays: t.periodDays,
      maxMembers: t.maxMembers,
      status: t.status,
      member: !!mine,
      pot: (t.contribution * BigInt(n)).toString(),
      round,
      payoutRound: cur,
      deadlineDay: t.startDay === null || cur >= n ? null : deadlineOf(t.startDay, t.periodDays, cur),
      paidThisRound: mine ? t.contributions.some((c) => c.memberId === mine.id && c.round === cur) : false,
      myTurn: mine?.turn ?? null,
      members: t.members
        .slice()
        .sort((a, b) => (a.turn ?? 99) - (b.turn ?? 99))
        .map((m) => ({ id: m.id, name: m.name, me: m.characterId === me, left: m.characterId === null, turn: m.turn, missed: m.missed, paid: t.contributions.some((c) => c.memberId === m.id && c.round === cur) })),
      payouts: t.payouts.map((p) => ({ round: p.round, amount: p.amount.toString(), refunded: p.refunded, toMe: p.beneficiaryId === me })),
    };
  }

  async list(accountId: string) {
    const c = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true, tontineDefaults: true } });
    if (!c) throw new NotFoundException('no_character');
    await this.settleMine(c.id);
    const today = await this.today();
    const include = { members: { select: { id: true, characterId: true, name: true, turn: true, missed: true } }, contributions: { select: { memberId: true, round: true } }, payouts: { orderBy: { round: 'asc' as const } } };
    const mine = await this.prisma.tontine.findMany({ where: { members: { some: { characterId: c.id } }, status: { in: ['FORMING', 'ACTIVE'] } }, include, orderBy: { createdAt: 'desc' } });
    const open = await this.prisma.tontine.findMany({
      where: { status: 'FORMING', members: { none: { characterId: c.id } } },
      include: { ...include, members: { include: { character: { select: { tontineDefaults: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return {
      myDefaults: c.tontineDefaults,
      mine: mine.map((t) => this.view(t, c.id, today)),
      open: open
        .filter((t) => t.members.length < t.maxMembers)
        .map((t) => ({
          ...this.view(t, c.id, today),
          // Réputation : tours manqués par les membres déjà inscrits (le risque du membre qui part avec la caisse)
          membersDefaults: t.members.reduce((s, m) => s + (m.character?.tontineDefaults ?? 0), 0),
        })),
    };
  }

  async create(accountId: string, input: { name: string; contribution: number; periodDays: number; maxMembers: number }) {
    let announce: (() => void) | null = null;
    const r = await this.chars.act(accountId, async (tx, c) => {
      const cfg = await this.settings.get('tontine');
      await this.checkEligible(tx, c.id, accountId, cfg);
      if (input.contribution < cfg.minContribution || input.contribution > cfg.maxContribution) throw new BadRequestException('tontine_bad_contribution');
      if (!cfg.periods.includes(input.periodDays)) throw new BadRequestException('tontine_bad_period');
      if (input.maxMembers < cfg.minMembers || input.maxMembers > cfg.maxMembers) throw new BadRequestException('tontine_bad_size');
      const t = await tx.tontine.create({
        data: { name: input.name, ownerId: c.id, contribution: BigInt(input.contribution), periodDays: input.periodDays, maxMembers: input.maxMembers, members: { create: { characterId: c.id, name: c.name } } },
      });
      announce = () => this.live?.announce(c.city, 'tontine', { name: t.name, amount: input.contribution, days: input.periodDays, max: input.maxMembers });
      return { tontine: t.id };
    });
    (announce as (() => void) | null)?.();
    return r;
  }

  private async checkEligible(tx: Tx, characterId: string, accountId: string, cfg: { maxActive: number; maxDefaultsToJoin: number; minAccountAgeHours: number }) {
    const acc = await tx.account.findUniqueOrThrow({ where: { id: accountId }, select: { createdAt: true, guest: true } });
    if (acc.guest) throw new ForbiddenException('account_required');
    if (Date.now() - acc.createdAt.getTime() < cfg.minAccountAgeHours * 3_600_000) throw new ForbiddenException('tontine_account_too_new');
    const ch = await tx.character.findUniqueOrThrow({ where: { id: characterId }, select: { tontineDefaults: true } });
    if (ch.tontineDefaults > cfg.maxDefaultsToJoin) throw new ForbiddenException('tontine_bad_payer');
    const active = await tx.tontineMember.count({ where: { characterId, tontine: { status: { in: ['FORMING', 'ACTIVE'] } } } });
    if (active >= cfg.maxActive) throw new BadRequestException('tontine_too_many');
  }

  join(accountId: string, id: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const t = await this.lock(tx, id);
      if (t.status !== 'FORMING') throw new BadRequestException('tontine_not_open');
      await this.checkEligible(tx, c.id, accountId, await this.settings.get('tontine'));
      const n = await tx.tontineMember.count({ where: { tontineId: id } });
      if (n >= t.maxMembers) throw new BadRequestException('tontine_full');
      if (await tx.tontineMember.findFirst({ where: { tontineId: id, characterId: c.id } })) throw new ConflictException('tontine_already_member');
      await tx.tontineMember.create({ data: { tontineId: id, characterId: c.id, name: c.name } });
      return { tontine: id };
    });
  }

  /** Quitter avant le démarrage ; si c'est l'organisateur, la tontine est annulée (aucun argent n'est encore engagé). */
  leave(accountId: string, id: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const t = await this.lock(tx, id);
      if (t.status !== 'FORMING') throw new BadRequestException('tontine_started');
      const m = await tx.tontineMember.findFirst({ where: { tontineId: id, characterId: c.id } });
      if (!m) throw new NotFoundException('tontine_not_member');
      if (t.ownerId === c.id) await tx.tontine.update({ where: { id }, data: { status: 'CANCELLED' } });
      else await tx.tontineMember.delete({ where: { id: m.id } });
      return { tontine: id, cancelled: t.ownerId === c.id };
    });
  }

  /** Démarrage par l'organisateur : ordre de ramassage tiré au sort, tour 0 à partir d'aujourd'hui. */
  start(accountId: string, id: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const t = await this.lock(tx, id);
      if (t.ownerId !== c.id) throw new ForbiddenException('tontine_not_owner');
      if (t.status !== 'FORMING') throw new BadRequestException('tontine_started');
      const members = await tx.tontineMember.findMany({ where: { tontineId: id }, orderBy: { joinedAt: 'asc' } });
      if (members.length < (await this.settings.get('tontine')).minMembers) throw new BadRequestException('tontine_not_enough');
      const order = drawTurns(members, (n) => randomInt(n));
      for (let i = 0; i < order.length; i++) await tx.tontineMember.update({ where: { id: order[i]!.id }, data: { turn: i } });
      await tx.tontine.update({ where: { id }, data: { status: 'ACTIVE', startDay: await this.today() } });
      return { tontine: id, members: order.length };
    });
  }

  /** Cotisation du tour en cours (montant fixé par la tontine, jamais par le client). */
  pay(accountId: string, id: string, idem?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const today = await this.today();
      const t = await this.settle(tx, await this.lock(tx, id), today);
      if (t.status !== 'ACTIVE') throw new BadRequestException('tontine_not_active');
      const m = await tx.tontineMember.findFirst({ where: { tontineId: id, characterId: c.id } });
      if (!m) throw new NotFoundException('tontine_not_member');
      const round = t.nextPayout;
      if (await tx.tontineContribution.findUnique({ where: { memberId_round: { memberId: m.id, round } } })) throw new ConflictException('tontine_already_paid');
      const key = idem ? `tontine-pay:${m.id}:${idem}` : `tontine-pay:${m.id}:${round}`;
      const requestHash = sha256Hex(`tontine-pay|${id}|${round}`);
      if (await this.ledger.findReplay(tx, key, requestHash)) return { replay: true, round, paid: '0' };
      await this.ledger.post(tx, { kind: 'TONTINE_PAY', idempotencyKey: key, requestHash, memo: `${id}:${round}`, legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'TONTINE'), amount: t.contribution }] });
      await tx.tontineContribution.create({ data: { tontineId: id, memberId: m.id, round, amount: t.contribution } });
      return { replay: false, round, paid: t.contribution.toString() };
    });
  }

  /** Ramassage anticipé : le bénéficiaire du tour encaisse dès que tous les membres ont cotisé. */
  collect(accountId: string, id: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const t = await this.lock(tx, id);
      if (t.status !== 'ACTIVE') throw new BadRequestException('tontine_not_active');
      const m = await tx.tontineMember.findFirst({ where: { tontineId: id, characterId: c.id } });
      if (!m || m.turn !== t.nextPayout) throw new ForbiddenException('tontine_not_your_turn');
      const n = await tx.tontineMember.count({ where: { tontineId: id } });
      const paid = await tx.tontineContribution.count({ where: { tontineId: id, round: t.nextPayout } });
      if (paid < n) throw new BadRequestException('tontine_waiting_members');
      const after = await this.settle(tx, t, await this.today(), true);
      const p = await tx.tontinePayout.findUniqueOrThrow({ where: { tontineId_round: { tontineId: id, round: t.nextPayout } } });
      return { round: t.nextPayout, amount: p.refunded ? '0' : p.amount.toString(), refunded: p.refunded, finished: after.status === 'FINISHED' };
    });
  }
}
