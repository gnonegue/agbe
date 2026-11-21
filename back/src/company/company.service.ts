import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { LiveService } from '../live/live.service';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService, type Leg, type Tx } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { GAME_DAYS_PER_MONTH, gameHoursBetween, gameTimeAt, realMsAfterGameHours } from '../economy/clock';
import { autoSale, candidatesFor, cfeFee, companySalePrice, CNSS_EMPLOYEE_DELAY_DAYS, computeDeclaration, monthOf, type CompanyForm } from '../economy/company';
import { IndustryService } from '../industry/industry.module';
import { computePayroll, type PayrollRates } from '../economy/payroll';
import { attendanceBp, payModeOf, publicGross } from '../economy/public-jobs';
import { sha256Hex } from '../common/crypto';
import { AuditService } from '../common/audit.service';
import { activeCompanyId } from './active';
import type { Prisma } from '@prisma/client';

/** Champs modifiables d'un métier du catalogue par l'administration (le lieu de travail est un réglage à part : work.places). */
export interface AdminJobPatch {
  level?: string;
  nameFr?: string;
  nameEn?: string;
  payPerShift?: number;
  energyCost?: number;
  hungerCost?: number;
  hygieneCost?: number;
  shiftGameHours?: number;
  riskPercent?: number;
  category?: string;
  emoji?: string;
  descFr?: string;
  descEn?: string;
  enabled?: boolean;
  venueId?: string | null;
  /** Diplômes acceptés : une ou plusieurs options (niveau minimum + domaines, absent = tous) ; un seul suffit ; vide ou null = aucun diplôme exigé. */
  reqs?: { min: string; domains?: string[] }[] | null;
}

/** Postes proposés selon l'activité (index tiré par le générateur de candidats). */
export const ROLES: Record<string, [string, string][]> = {
  pagnes: [['Vendeuse', 'Sales assistant'], ['Magasinier', 'Stock keeper'], ['Comptable', 'Bookkeeper']],
  maquis: [['Serveuse', 'Waitress'], ['Cuisinière', 'Cook'], ['Plongeur', 'Dishwasher']],
  couture: [['Apprenti couturier', 'Apprentice tailor'], ['Brodeuse', 'Embroiderer'], ['Vendeuse', 'Sales assistant']],
  cyber: [['Gérant de salle', 'Floor manager'], ['Technicien', 'Technician'], ['Caissière', 'Cashier']],
  transport: [['Conducteur de zém', 'Moto-taxi rider'], ['Mécanicien', 'Mechanic'], ['Gestionnaire', 'Fleet manager']],
};

const pad = (n: number, w: number) => String(n).padStart(w, '0');

@Injectable()
export class CompanyService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly chars: CharacterService,
    @Optional() private readonly live?: LiveService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly industry?: IndustryService,
  ) {}

  private async today(): Promise<number> {
    return gameTimeAt(await this.settings.clock(), Date.now()).day;
  }

  private async companyOf(tx: Tx, characterId: string) {
    const id = await activeCompanyId(tx, characterId);
    const co = id ? await tx.company.findUnique({ where: { id }, include: { employees: { where: { active: true } } } }) : null;
    if (!co) throw new NotFoundException('no_company');
    return co;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.autoSalesTick(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Ventes automatiques : chaque salarié actif d'une entreprise immatriculée vend à la place du patron, une séance après l'autre,
   * même quand il n'est pas connecté. Le bénéfice net est versé au patron (grand livre) et le chiffre d'affaires compte pour la déclaration.
   */
  async autoSalesTick(): Promise<number> {
    let credited = 0;
    try {
      const cfg = await this.settings.get('company.portfolio');
      const activities = await this.settings.get('company.activities');
      const clock = await this.settings.clock();
      // Les salariés des usines et sites de l'entreprise travaillent pour le site (son résultat), pas pour les ventes de l'entreprise
      const rows = await this.prisma.company.findMany({ where: { status: 'REGISTERED', employees: { some: { active: true, plantId: null } } }, select: { id: true } });
      for (const r of rows) {
        try {
          const now = Date.now();
          const paid = await this.prisma.$transaction(async (tx) => {
            const co = await tx.company.findUnique({ where: { id: r.id }, include: { employees: { where: { active: true, plantId: null }, select: { id: true, lastPaidMonth: true } } } });
            if (!co || co.status !== 'REGISTERED') return false;
            // Un salarié non payé depuis plus d'un mois cesse de travailler pour le patron (il revient une fois payé)
            const month = monthOf(await this.today());
            const working = co.employees.filter((e) => e.lastPaidMonth >= month - 2);
            if (working.length === 0) return false;
            const act = activities.find((a) => a.id === co.activityId);
            if (!act || act.shiftGameHours <= 0) return false;
            if (!co.lastAutoSaleAt) {
              await tx.company.update({ where: { id: co.id }, data: { lastAutoSaleAt: new Date(now) } });
              return false;
            }
            const elapsed = Math.floor(gameHoursBetween(clock, co.lastAutoSaleAt.getTime(), now) / act.shiftGameHours);
            if (elapsed < 1) return false;
            const shifts = Math.min(elapsed, cfg.maxCatchUpShifts);
            const sale = autoSale(act, working.length, shifts, cfg);
            // Absence prolongée : le surplus au-delà du plafond est perdu, le compteur repart de maintenant
            const next = elapsed > shifts ? now : Math.min(now, Math.ceil(realMsAfterGameHours(clock, co.lastAutoSaleAt.getTime(), shifts * act.shiftGameHours)));
            const wallet = await tx.wallet.findUnique({ where: { characterId: co.characterId }, select: { id: true } });
            if (!wallet) return false;
            if (sale.net > 0n) {
              await this.ledger.post(tx, {
                kind: 'SALES',
                idempotencyKey: `autosale:${co.id}:${next}`,
                memo: `${co.activityId}:auto x${shifts}`,
                legs: [{ from: await this.ledger.systemWalletId(tx, 'MARKET'), to: wallet.id, amount: sale.net }],
              });
            }
            await tx.company.update({ where: { id: co.id }, data: { lastAutoSaleAt: new Date(next), pendingRevenue: { increment: sale.gross } } });
            return sale.net > 0n;
          });
          if (paid) credited++;
        } catch (e) {
          new Logger('Company').warn(`Ventes automatiques ${r.id} : ${(e as Error).message}`);
        }
      }
    } catch (e) {
      new Logger('Company').warn(`Ventes automatiques : ${(e as Error).message}`);
    }
    return credited;
  }

  /** Choisir l'entreprise en cours parmi les siennes (interdit pendant une séance d'entreprise). */
  select(accountId: string, companyId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const co = await tx.company.findFirst({ where: { id: companyId, characterId: c.id, status: { not: 'CLOSED' } }, select: { id: true } });
      if (!co) throw new NotFoundException('no_company');
      if (await tx.workShift.findFirst({ where: { characterId: c.id, kind: 'company', closedAt: null, endsAt: { gt: new Date() } }, select: { id: true } })) throw new ConflictException('shift_open');
      await tx.character.update({ where: { id: c.id }, data: { activeCompanyId: co.id } });
      return { company: co.id };
    });
  }

  /**
   * Fermer ou vendre l'entreprise en cours. Il faut être à jour : paie des salariés réglée, déclaration faite, aucune séance ni
   * candidature à un appel d'offres en cours. Fermer ne rapporte rien ; vendre verse le prix de rachat fixé par le serveur
   * (bénéfice d'une séance × séances, plus par salarié), depuis le marché. Salariés remerciés, offres retirées.
   */
  private leave(accountId: string, companyId: string, sell: boolean) {
    return this.chars.act(accountId, async (tx, c) => {
      const co = await tx.company.findFirst({ where: { id: companyId, characterId: c.id, status: { not: 'CLOSED' } }, include: { employees: { where: { active: true } } } });
      if (!co) throw new NotFoundException('no_company');
      if (sell && co.status !== 'REGISTERED') throw new BadRequestException('company_not_registered');
      if (await tx.workShift.findFirst({ where: { characterId: c.id, kind: 'company', closedAt: null, endsAt: { gt: new Date() } }, select: { id: true } })) throw new ConflictException('shift_open');
      if (await tx.tenderApplication.findFirst({ where: { companyId: co.id, status: 'PENDING' }, select: { id: true } })) throw new ConflictException('tender_pending');
      // Une entreprise qui possède des usines ou sites ne se ferme ni ne se vend : revends d'abord ses sites (appli Industrie)
      if (await tx.industryPlant.count({ where: { companyId: co.id } })) throw new ConflictException('company_has_plants');
      const day = await this.today();
      if (co.status === 'REGISTERED') {
        if (co.employees.some((e) => e.lastPaidMonth < monthOf(day) - 1)) throw new BadRequestException('pay_payroll_first');
        const decl = computeDeclaration(
          { lastDeclaredMonth: co.lastDeclaredMonth, createdMonth: co.createdMonth, today: day, pendingRevenue: co.pendingRevenue, plantRevenue: co.pendingPlantRevenue },
          await this.settings.get('company.contributions'),
        );
        if (decl) throw new BadRequestException('declare_first');
      }
      let price = 0n;
      if (sell) {
        const act = (await this.settings.get('company.activities')).find((a) => a.id === co.activityId);
        if (!act) throw new BadRequestException('unknown_company_activity');
        price = companySalePrice(act, co.employees.length, await this.settings.get('company.portfolio'));
        if (price > 0n) {
          await this.ledger.post(tx, {
            kind: 'COMPANY_SALE',
            idempotencyKey: `company-sale:${co.id}`,
            memo: co.activityId,
            legs: [{ from: await this.ledger.systemWalletId(tx, 'MARKET'), to: c.walletId, amount: price }],
          });
        }
      }
      await tx.employee.updateMany({ where: { companyId: co.id, active: true }, data: { active: false } });
      await tx.jobOffer.updateMany({ where: { companyId: co.id, open: true }, data: { open: false } });
      await tx.company.update({ where: { id: co.id }, data: { status: 'CLOSED', closedAt: new Date() } });
      await this.audit?.log(sell ? 'company.sold' : 'company.closed', { actorId: accountId, target: co.id, meta: { price: price.toString() } }, tx);
      return { company: co.id, price: price.toString(), sold: sell };
    });
  }

  sell(accountId: string, companyId: string) {
    return this.leave(accountId, companyId, true);
  }

  close(accountId: string, companyId: string) {
    return this.leave(accountId, companyId, false);
  }

  /** Entreprise en cours d'un compte (lecture), avec ses salariés actifs ; null si aucune. */
  private async currentCompany(accountId: string) {
    const ch = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
    if (!ch) throw new NotFoundException('no_character');
    const id = await activeCompanyId(this.prisma, ch.id);
    const company = id ? await this.prisma.company.findUnique({ where: { id }, include: { employees: { where: { active: true }, orderBy: { createdAt: 'asc' } } } }) : null;
    return { ch, company };
  }

  /** Étape 1-2 : dossier au CFE (forme, nom, activité), frais réels, délai de traitement en heures de jeu. */
  create(accountId: string, input: { form: CompanyForm; name: string; activityId: string }, idem?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const key = idem ? `cfe:${c.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`cfe|${input.form}|${input.name}|${input.activityId}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true };
      if (c.locationId !== 'cfe') throw new BadRequestException('not_at_cfe');
      const portfolio = await this.settings.get('company.portfolio');
      if ((await tx.company.count({ where: { characterId: c.id, status: { not: 'CLOSED' } } })) >= portfolio.maxCompanies) throw new ConflictException('too_many_companies');
      const activities = await this.settings.get('company.activities');
      if (!activities.some((a) => a.id === input.activityId)) throw new BadRequestException('unknown_company_activity');
      // Capital social : SARL et SA exigent un capital minimum disponible (déposé à la banque dans la vraie vie)
      const capitalMin = (await this.settings.get('company.capitalMin'))[input.form];
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: c.walletId }, select: { balance: true } });
      if (wallet.balance < BigInt(capitalMin)) throw new BadRequestException('capital_insufficient');
      const cfe = await this.settings.get('company.cfe');
      const fee = cfeFee(input.form, c.profile === 'FOREIGNER', cfe);
      await this.ledger.post(tx, {
        kind: 'CFE_FEE',
        idempotencyKey: key,
        requestHash,
        memo: input.form,
        legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'TREASURY'), amount: fee }],
      });
      const clock = await this.settings.clock();
      const now = Date.now();
      const created = await tx.company.create({
        data: {
          characterId: c.id,
          name: input.name,
          activityId: input.activityId,
          form: input.form,
          readyAt: new Date(Math.ceil(realMsAfterGameHours(clock, now, cfe.delayGameHours))),
          createdMonth: monthOf(gameTimeAt(clock, now).day),
        },
      });
      // La nouvelle entreprise devient celle en cours
      await tx.character.update({ where: { id: c.id }, data: { activeCompanyId: created.id } });
      return { fee: fee.toString(), replay: false };
    });
  }

  /** Étape 3 : retrait des documents au CFE une fois le délai écoulé (RCCM, NIF, carte d'opérateur). */
  collect(accountId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      if (c.locationId !== 'cfe') throw new BadRequestException('not_at_cfe');
      const co = await this.companyOf(tx, c.id);
      if (co.status !== 'PENDING_CFE') throw new BadRequestException('documents_already_collected');
      if (co.readyAt.getTime() > Date.now()) throw new BadRequestException('cfe_not_ready');
      const day = await this.today();
      const rccm = `TG-LOM-${pad(day, 4)}-${co.form === 'EI' ? 'A' : 'B'}-${pad(randomInt(100_000), 5)}`;
      const nif = `1${pad(randomInt(1_000_000_000), 9)}`;
      await tx.company.update({ where: { id: co.id }, data: { status: 'REGISTERED', rccm, nif } });
      return { rccm, nif };
    });
  }

  /** Étape 4 : immatriculation à la CNSS de l'entreprise et de chaque salarié non encore immatriculé. */
  registerCnss(accountId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      if (c.locationId !== 'cnss') throw new BadRequestException('not_at_cnss');
      const co = await this.companyOf(tx, c.id);
      if (co.status !== 'REGISTERED') throw new BadRequestException('company_not_registered');
      const num = () => `${pad(randomInt(100_000_000), 8)}`;
      let count = 0;
      if (!co.cnssNumber) await tx.company.update({ where: { id: co.id }, data: { cnssNumber: `E${num()}` } });
      for (const e of co.employees) {
        if (!e.cnssNumber) {
          await tx.employee.update({ where: { id: e.id }, data: { cnssNumber: `S${num()}` } });
          count++;
        }
      }
      return { employeesRegistered: count };
    });
  }

  async candidates(accountId: string) {
    const { company } = await this.currentCompany(accountId);
    if (!company) throw new NotFoundException('no_company');
    const smig = (await this.settings.get('payroll.rates')).smig;
    const roles = ROLES[company.activityId] ?? ROLES.pagnes!;
    return candidatesFor(company.id, await this.today(), smig, roles.length).map((k) => ({
      ...k,
      roleFr: roles[k.roleIndex]![0],
      roleEn: roles[k.roleIndex]![1],
    }));
  }

  /** Embauche d'un candidat du jour (liste recalculée côté serveur : le salaire ne vient jamais du client). */
  hire(accountId: string, candidateId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const co = await this.companyOf(tx, c.id);
      if (co.status !== 'REGISTERED') throw new BadRequestException('company_not_registered');
      const cfg = await this.settings.get('company.contributions');
      // Plafond de salariés de l'entreprise (ceux de ses usines et sites comptent dans la capacité du site, pas ici)
      if (co.employees.filter((e) => !e.plantId).length >= cfg.maxEmployees) throw new BadRequestException('too_many_employees');
      const day = await this.today();
      const smig = (await this.settings.get('payroll.rates')).smig;
      const roles = ROLES[co.activityId] ?? ROLES.pagnes!;
      const k = candidatesFor(co.id, day, smig, roles.length).find((x) => x.id === candidateId);
      if (!k) throw new NotFoundException('unknown_candidate');
      if (co.employees.some((e) => e.name === k.name && e.hiredDay === day)) throw new ConflictException('already_hired');
      const e = await tx.employee.create({
        data: { companyId: co.id, name: k.name, roleFr: roles[k.roleIndex]![0], roleEn: roles[k.roleIndex]![1], grossMonthly: k.grossMonthly, hiredDay: day, hiredMonth: monthOf(day), lastPaidMonth: monthOf(day) - 1 },
      });
      return { employee: e.id, cnssDeadlineDay: day + CNSS_EMPLOYEE_DELAY_DAYS };
    });
  }

  fire(accountId: string, employeeId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const co = await this.companyOf(tx, c.id);
      const e = co.employees.find((x) => x.id === employeeId);
      if (!e) throw new NotFoundException('unknown_employee');
      // Salarié joueur : les mois clos doivent être payés avant le licenciement
      if (e.characterId && e.lastPaidMonth < monthOf(await this.today()) - 1) throw new BadRequestException('pay_before_fire');
      await tx.employee.update({ where: { id: e.id }, data: { active: false } });
      return { employee: e.id };
    });
  }

  /**
   * Paie des mois clos : salaire net versé au salarié, CNSS (17,5 % + 4 %), AMU (5 % + 5 %) et IRPP reversés.
   * Amende si un salarié n'est pas immatriculé à la CNSS au-delà de 8 jours.
   */
  payroll(accountId: string, idem?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const co = await this.companyOf(tx, c.id);
      const key = idem ? `payroll:${co.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`payroll|${co.id}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true, paid: '0', months: 0 };
      const day = await this.today();
      const closed = monthOf(day) - 1;
      const rates = await this.settings.get('payroll.rates');
      const cfg = await this.settings.get('company.contributions');
      const [treasury, outside] = await Promise.all([this.ledger.systemWalletId(tx, 'TREASURY'), this.ledger.systemWalletId(tx, 'MARKET')]);
      let net = 0n;
      let social = 0n;
      let months = 0;
      // Net des salariés joueurs : versé sur leur portefeuille (une jambe par salarié), AMU prolongée
      const toPlayers = new Map<string, bigint>();
      for (const e of co.employees) {
        const from = e.lastPaidMonth + 1;
        if (from > closed) continue;
        const p = computePayroll(BigInt(e.grossMonthly), rates);
        const n = BigInt(closed - from + 1);
        const wallet = e.characterId ? await tx.wallet.findUnique({ where: { characterId: e.characterId }, select: { id: true } }) : null;
        if (wallet) {
          toPlayers.set(wallet.id, (toPlayers.get(wallet.id) ?? 0n) + p.net * n);
          const emp = await tx.character.findUniqueOrThrow({ where: { id: e.characterId! }, select: { amuPaidUntilGameDay: true } });
          await tx.character.update({ where: { id: e.characterId! }, data: { amuPaidUntilGameDay: Math.max(emp.amuPaidUntilGameDay, day) + GAME_DAYS_PER_MONTH } });
        } else {
          net += p.net * n;
        }
        social += (p.cnssEmployee + p.amuEmployee + p.irpp + p.cnssEmployer + p.amuEmployer) * n;
        months += Number(n);
        await tx.employee.update({ where: { id: e.id }, data: { lastPaidMonth: closed } });
      }
      const unregistered = co.employees.filter((e) => !e.cnssNumber && day > e.hiredDay + CNSS_EMPLOYEE_DELAY_DAYS).length;
      const fine = BigInt(cfg.unregisteredFine) * BigInt(unregistered);
      if (months === 0 && fine === 0n) throw new BadRequestException('nothing_to_pay');
      const legs: Leg[] = [];
      if (net > 0n) legs.push({ from: c.walletId, to: outside, amount: net });
      for (const [to, amount] of toPlayers) if (amount > 0n) legs.push({ from: c.walletId, to, amount });
      for (const amount of toPlayers.values()) net += amount;
      if (social + fine > 0n) legs.push({ from: c.walletId, to: treasury, amount: social + fine });
      await this.ledger.post(tx, { kind: 'PAYROLL', idempotencyKey: key, requestHash, memo: co.id, legs });
      return { replay: false, months, net: net.toString(), social: social.toString(), fine: fine.toString(), paid: (net + social + fine).toString() };
    });
  }

  /** Étape 5 : déclaration et paiement à l'OTR des mois clos (CNSS TNS, AMU, impôt), avec pénalités de retard. */
  declare(accountId: string, idem?: string) {
    return this.chars.act(accountId, async (tx, c) => {
      if (c.locationId !== 'otr') throw new BadRequestException('not_at_otr');
      const co = await this.companyOf(tx, c.id);
      if (co.status !== 'REGISTERED') throw new BadRequestException('company_not_registered');
      const key = idem ? `declare:${co.id}:${idem}` : undefined;
      const requestHash = sha256Hex(`declare|${co.id}`);
      if (key && (await this.ledger.findReplay(tx, key, requestHash))) return { replay: true, total: '0' };
      const d = computeDeclaration(
        { lastDeclaredMonth: co.lastDeclaredMonth, createdMonth: co.createdMonth, today: await this.today(), pendingRevenue: co.pendingRevenue, plantRevenue: co.pendingPlantRevenue },
        await this.settings.get('company.contributions'),
      );
      if (!d) throw new BadRequestException('nothing_to_declare');
      if (d.total > 0n) {
        await this.ledger.post(tx, {
          kind: 'TAX',
          idempotencyKey: key,
          requestHash,
          memo: `${co.id}:${d.fromMonth}-${d.toMonth}`,
          legs: [{ from: c.walletId, to: await this.ledger.systemWalletId(tx, 'TREASURY'), amount: d.total }],
        });
      }
      await tx.company.update({ where: { id: co.id }, data: { lastDeclaredMonth: d.toMonth, pendingRevenue: 0n, pendingPlantRevenue: 0n } });
      // TNS : la déclaration inclut l'AMU forfaitaire, le dirigeant est couvert un mois de plus
      const day = await this.today();
      await tx.character.update({ where: { id: c.id }, data: { amuPaidUntilGameDay: Math.max(c.amuPaidUntilGameDay, day) + GAME_DAYS_PER_MONTH } });
      return { replay: false, ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])) };
    });
  }

  async employees(accountId: string) {
    const { company } = await this.currentCompany(accountId);
    if (!company) throw new NotFoundException('no_company');
    const rates = await this.settings.get('payroll.rates');
    const day = await this.today();
    return company.employees.map((e) => {
      const p = computePayroll(BigInt(e.grossMonthly), rates);
      return {
        id: e.id,
        name: e.name,
        roleFr: e.roleFr,
        roleEn: e.roleEn,
        grossMonthly: e.grossMonthly,
        net: p.net.toString(),
        employerCost: p.employerCost.toString(),
        cnssNumber: e.cnssNumber,
        cnssDeadlineDay: e.hiredDay + CNSS_EMPLOYEE_DELAY_DAYS,
        late: !e.cnssNumber && day > e.hiredDay + CNSS_EMPLOYEE_DELAY_DAYS,
        unpaidMonths: Math.max(0, monthOf(day) - 1 - e.lastPaidMonth),
        player: e.characterId !== null,
      };
    });
  }

  // ───────────── Emploi entre joueurs ─────────────

  /** Offres ouvertes de l'entreprise du joueur. */
  async myOffers(accountId: string) {
    const { company } = await this.currentCompany(accountId);
    if (!company) throw new NotFoundException('no_company');
    const rates = await this.settings.get('payroll.rates');
    const cfg = await this.settings.get('company.playerJobs');
    const offers = await this.prisma.jobOffer.findMany({ where: { companyId: company.id, open: true }, orderBy: { createdAt: 'asc' } });
    return {
      offers: offers.map((o) => ({ id: o.id, roleFr: o.roleFr, roleEn: o.roleEn, grossMonthly: o.grossMonthly, net: computePayroll(BigInt(o.grossMonthly), rates).net.toString() })),
      roles: (ROLES[company.activityId] ?? ROLES.pagnes!).map(([fr, en]) => ({ fr, en })),
      minGross: rates.smig,
      maxGross: cfg.maxGross,
      maxOpenOffers: cfg.maxOpenOffers,
    };
  }

  /** Publication d'une offre : poste parmi ceux de l'activité, salaire brut fixé par le patron (SMIG minimum, plafond réglable). */
  async postOffer(accountId: string, roleIndex: number, grossMonthly: number) {
    let announce: (() => void) | null = null;
    const r = await this.chars.act(accountId, async (tx, c) => {
      const co = await this.companyOf(tx, c.id);
      if (co.status !== 'REGISTERED') throw new BadRequestException('company_not_registered');
      const roles = ROLES[co.activityId] ?? ROLES.pagnes!;
      const role = roles[roleIndex];
      if (!role) throw new BadRequestException('unknown_role');
      const smig = (await this.settings.get('payroll.rates')).smig;
      const cfg = await this.settings.get('company.playerJobs');
      if (grossMonthly < smig) throw new BadRequestException('salary_below_smig');
      if (grossMonthly > cfg.maxGross) throw new BadRequestException('salary_too_high');
      if ((await tx.jobOffer.count({ where: { companyId: co.id, open: true } })) >= cfg.maxOpenOffers) throw new BadRequestException('too_many_offers');
      const o = await tx.jobOffer.create({ data: { companyId: co.id, roleFr: role[0], roleEn: role[1], grossMonthly } });
      announce = () => this.live?.announce(c.city, 'job', { company: co.name, roleFr: role[0], roleEn: role[1], gross: grossMonthly });
      return { offer: o.id };
    });
    // Annonce aux joueurs de la ville, une fois la transaction validée
    (announce as (() => void) | null)?.();
    return r;
  }

  closeOffer(accountId: string, offerId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const co = await this.companyOf(tx, c.id);
      const r = await tx.jobOffer.updateMany({ where: { id: offerId, companyId: co.id, open: true }, data: { open: false } });
      if (r.count !== 1) throw new NotFoundException('unknown_offer');
      return { offer: offerId };
    });
  }

  /** Tableau des offres des autres joueurs (entreprises immatriculées). */
  async board(accountId: string) {
    const ch = await this.prisma.character.findUnique({ where: { accountId }, select: { id: true } });
    if (!ch) throw new NotFoundException('no_character');
    const rates = await this.settings.get('payroll.rates');
    const offers = await this.prisma.jobOffer.findMany({
      where: { open: true, company: { status: 'REGISTERED', characterId: { not: ch.id } } },
      include: { company: { select: { name: true, activityId: true, character: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const fromPlayers = offers.map((o) => ({
      id: o.id,
      company: o.company!.name,
      activityId: o.company!.activityId,
      boss: o.company!.character.name,
      roleFr: o.roleFr,
      roleEn: o.roleEn,
      grossMonthly: o.grossMonthly,
      net: computePayroll(BigInt(o.grossMonthly), rates).net.toString(),
    }));
    // Postes ouverts dans les sites industriels des autres joueurs (usines, zones franches, fermes, élevages)
    const fromPlants = this.industry ? (await this.industry.openOffers(ch.id)).map((o) => ({ ...o, net: computePayroll(BigInt(o.grossMonthly), rates).net.toString() })) : [];
    return [...(await this.publicOffers(rates)), ...fromPlayers, ...fromPlants];
  }

  /**
   * Vue de l'équipe sur toutes les offres d'emploi : celles des employeurs publics (une par métier, présentes par défaut)
   * et celles des joueurs, avec leur salaire, leur état et le nombre de salariés en poste.
   */
  async adminOffers() {
    const rates = await this.settings.get('payroll.rates');
    const cfg = await this.settings.get('jobs.public');
    const places = await this.settings.get('work.places');
    const jobs = await this.prisma.job.findMany({ select: { id: true, level: true, nameFr: true, nameEn: true, payPerShift: true, enabled: true } });
    const live = jobs.filter((j) => j.enabled);
    const venues = new Map((await this.prisma.venue.findMany({ select: { id: true, nameFr: true, nameEn: true } })).map((v) => [v.id, v]));
    const staff = await this.prisma.employee.groupBy({ by: ['publicJobId'], where: { active: true, publicJobId: { not: null } }, _count: { _all: true } });
    const employed = new Map(staff.map((x) => [x.publicJobId!, x._count._all]));
    const taskPaid = await this.settings.get('jobs.taskPaid');
    const publicRows = jobs
      .filter((j) => j.level in cfg.bands && payModeOf(j.id, cfg.enabled, taskPaid) === 'MONTHLY')
      .map((j) => {
        const gross = publicGross(j, live.length ? live : jobs, cfg.bands[j.level as keyof typeof cfg.bands]);
        return { id: `job:${j.id}`, kind: 'PUBLIC' as const, roleFr: j.nameFr, roleEn: j.nameEn, level: j.level, venueId: places[j.id] ?? null, venueFr: venues.get(places[j.id] ?? '')?.nameFr ?? null, venueEn: venues.get(places[j.id] ?? '')?.nameEn ?? null, company: '', boss: '', gross, net: computePayroll(BigInt(gross), rates).net.toString(), open: cfg.enabled && j.enabled, employed: employed.get(j.id) ?? 0, createdAt: null as Date | null };
      })
      .sort((a, b) => a.gross - b.gross);
    const offers = await this.prisma.jobOffer.findMany({
      include: { company: { select: { name: true, status: true, character: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const playerRows = offers.map((o) => ({ id: o.id, kind: 'PLAYER' as const, roleFr: o.roleFr, roleEn: o.roleEn, level: null as string | null, venueId: null as string | null, venueFr: null as string | null, venueEn: null as string | null, company: o.company.name, boss: o.company.character.name, gross: o.grossMonthly, net: computePayroll(BigInt(o.grossMonthly), rates).net.toString(), open: o.open, employed: o.open ? 0 : 1, createdAt: o.createdAt }));
    const full = await this.prisma.job.findMany({ orderBy: [{ level: 'asc' }, { nameFr: 'asc' }] });
    const study = await this.settings.get('study');
    const catalog = full.map((j) => ({ ...j, venueId: places[j.id] ?? null, reqs: (() => { const r = study.jobReq[j.id]; return r ? [{ min: r.min, ...(r.domains ? { domains: r.domains } : {}) }, ...(r.or ?? [])] : []; })() }));
    const domains = study.domains.map((d) => ({ id: d.id, emoji: d.emoji, nameFr: d.nameFr, nameEn: d.nameEn }));
    const rules = { minGross: rates.smig, maxGross: (await this.settings.get('company.playerJobs')).maxGross };
    return { config: cfg, offers: [...publicRows, ...playerRows], catalog, domains, rules };
  }

  /** Modification d'un métier du catalogue (employeur public) : fiche, paie par service, coûts, lieu de travail, activation. */
  async adminUpdateJob(actorId: string, id: string, patch: AdminJobPatch) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('unknown_job');
    const { venueId, reqs, ...fields } = patch;
    const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    if (venueId !== undefined) await this.setJobPlace(actorId, id, venueId);
    if (reqs !== undefined) await this.setJobReq(actorId, id, reqs);
    if (Object.keys(data).length > 0) await this.prisma.job.update({ where: { id }, data });
    await this.audit?.log('admin.job_updated', { actorId, target: id, meta: { ...data, ...(venueId !== undefined ? { venueId } : {}), ...(reqs !== undefined ? { reqs } : {}) } as Prisma.InputJsonValue });
    return { id };
  }

  /** Nouveau métier du catalogue (identifiant libre, unique). */
  async adminCreateJob(actorId: string, dto: AdminJobPatch & { id: string; level: string; nameFr: string; nameEn: string; payPerShift: number; energyCost: number; hungerCost: number; shiftGameHours: number }) {
    if (await this.prisma.job.findUnique({ where: { id: dto.id } })) throw new ConflictException('job_exists');
    const { venueId, reqs, ...fields } = dto;
    const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as unknown as Prisma.JobCreateInput;
    if (reqs?.length) await this.checkJobReq(reqs);
    await this.prisma.job.create({ data });
    if (venueId) await this.setJobPlace(actorId, dto.id, venueId);
    if (reqs?.length) await this.setJobReq(actorId, dto.id, reqs);
    await this.audit?.log('admin.job_created', { actorId, target: dto.id, meta: { ...data, ...(venueId ? { venueId } : {}) } as unknown as Prisma.InputJsonValue });
    return { id: dto.id };
  }

  private async checkJobReq(reqs: { min: string; domains?: string[] }[]) {
    const known = new Set((await this.settings.get('study')).domains.map((d) => d.id));
    if (reqs.some((r) => r.domains?.some((d) => !known.has(d)))) throw new BadRequestException('unknown_domain');
  }

  /**
   * Diplômes acceptés pour un métier (réglage study.jobReq) : une ou plusieurs options (niveau minimum + domaines), un seul
   * diplôme suffit ; une liste vide retire la condition. Les doublons exacts sont ignorés.
   */
  private async setJobReq(actorId: string, jobId: string, reqs: { min: string; domains?: string[] }[] | null) {
    const list = (reqs ?? []).filter((r) => r.min !== 'BAC').map((r) => ({ min: r.min as 'BT', ...(r.domains && r.domains.length > 0 ? { domains: [...new Set(r.domains)] } : {}) }));
    const seen = new Set<string>();
    const unique = list.filter((r) => { const k = `${r.min}|${(r.domains ?? []).slice().sort().join(',')}`; if (seen.has(k)) return false; seen.add(k); return true; });
    if (unique.length > 0) await this.checkJobReq(unique);
    const study = await this.settings.get('study');
    const jobReq = { ...study.jobReq };
    if (unique.length === 0) delete jobReq[jobId];
    else {
      const [first, ...rest] = unique;
      jobReq[jobId] = { ...first!, ...(rest.length > 0 ? { or: rest } : {}) };
    }
    await this.settings.set('study', { ...study, jobReq }, actorId);
  }

  private async setJobPlace(actorId: string, jobId: string, venueId: string | null) {
    if (venueId && !(await this.prisma.venue.findUnique({ where: { id: venueId }, select: { id: true } }))) throw new BadRequestException('unknown_venue');
    const places = { ...(await this.settings.get('work.places')) };
    if (venueId) places[jobId] = venueId;
    else delete places[jobId];
    await this.settings.set('work.places', places, actorId);
  }

  /** Modification d'une offre publiée par un joueur (encore ouverte) : intitulé et salaire brut, dans les bornes du jeu. */
  async adminUpdateOffer(actorId: string, id: string, patch: { roleFr?: string; roleEn?: string; grossMonthly?: number }) {
    const offer = await this.prisma.jobOffer.findUnique({ where: { id } });
    if (!offer) throw new NotFoundException('unknown_offer');
    if (!offer.open) throw new ConflictException('offer_not_open');
    if (patch.grossMonthly !== undefined) {
      const smig = (await this.settings.get('payroll.rates')).smig;
      const cfg = await this.settings.get('company.playerJobs');
      if (patch.grossMonthly < smig) throw new BadRequestException('salary_below_smig');
      if (patch.grossMonthly > cfg.maxGross) throw new BadRequestException('salary_too_high');
    }
    const data = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    await this.prisma.jobOffer.update({ where: { id }, data });
    await this.audit?.log('admin.offer_updated', { actorId, target: id, meta: data as Prisma.InputJsonValue });
    return { id };
  }

  /** Retrait d'une offre de joueur encore ouverte (modération) ; une offre déjà pourvue ne se retire pas. */
  async adminDeleteOffer(actorId: string, id: string) {
    const offer = await this.prisma.jobOffer.findUnique({ where: { id } });
    if (!offer) throw new NotFoundException('unknown_offer');
    if (!offer.open) throw new ConflictException('offer_not_open');
    await this.prisma.jobOffer.delete({ where: { id } });
    await this.audit?.log('admin.offer_deleted', { actorId, target: id, meta: { roleFr: offer.roleFr, grossMonthly: offer.grossMonthly } as Prisma.InputJsonValue });
    return { id };
  }

  /**
   * Emplois salariés des employeurs publics : un par métier du catalogue, présents dès l'installation (aucune donnée à semer).
   * Salaire par niveau (sans diplôme : du SMIG à 80 000 F), versé chaque mois clos selon les services faits.
   */
  private async publicOffers(rates: PayrollRates) {
    const cfg = await this.settings.get('jobs.public');
    if (!cfg.enabled) return [];
    const jobs = await this.prisma.job.findMany({ where: { enabled: true }, select: { id: true, level: true, nameFr: true, nameEn: true, payPerShift: true } });
    const places = await this.settings.get('work.places');
    const taskPaid = await this.settings.get('jobs.taskPaid');
    return jobs
      .filter((j) => j.level in cfg.bands && payModeOf(j.id, cfg.enabled, taskPaid) === 'MONTHLY')
      .map((j) => {
        const gross = publicGross(j, jobs, cfg.bands[j.level as keyof typeof cfg.bands]);
        return {
          id: `job:${j.id}`,
          company: '',
          activityId: '',
          boss: '',
          roleFr: j.nameFr,
          roleEn: j.nameEn,
          grossMonthly: gross,
          net: computePayroll(BigInt(gross), rates).net.toString(),
          publicJobId: j.id,
          level: j.level,
          venueId: places[j.id] ?? null,
          minShifts: cfg.minShifts,
        };
      })
      .sort((a, b) => a.grossMonthly - b.grossMonthly);
  }

  /** Acceptation d'une offre : le joueur devient salarié (un seul emploi chez un joueur à la fois). */
  acceptOffer(accountId: string, offerId: string) {
    if (offerId.startsWith('job:')) return this.acceptPublic(accountId, offerId.slice(4));
    if (offerId.startsWith('plant:')) {
      const industry = this.industry;
      if (!industry) throw new NotFoundException('unknown_offer');
      return this.chars.act(accountId, (tx, c) => industry.hire(tx, c, offerId.slice(6)));
    }
    return this.chars.act(accountId, async (tx, c) => {
      const offer = await tx.jobOffer.findUnique({ where: { id: offerId }, include: { company: { include: { employees: { where: { active: true } } } } } });
      if (!offer || !offer.open || !offer.company || offer.company.status !== 'REGISTERED') throw new NotFoundException('unknown_offer');
      if (offer.company.characterId === c.id) throw new BadRequestException('own_company');
      // Anti multi-comptes : le salaire est un flux d'argent entre comptes, soumis à la même ancienneté que les virements
      const minAge = (await this.settings.get('transfer.limits')).minAccountAgeHours * 3_600_000;
      const accounts = await tx.account.findMany({ where: { character: { id: { in: [c.id, offer.company.characterId] } } }, select: { createdAt: true, guest: true } });
      if (accounts.some((a) => a.guest)) throw new ForbiddenException('account_required');
      if (accounts.some((a) => Date.now() - a.createdAt.getTime() < minAge)) throw new ForbiddenException('job_account_too_new');
      if (await tx.employee.findFirst({ where: { characterId: c.id, active: true } })) throw new ConflictException('already_employed');
      const cfg = await this.settings.get('company.contributions');
      if (offer.company.employees.filter((e) => !e.plantId).length >= cfg.maxEmployees) throw new BadRequestException('too_many_employees');
      // Fermeture atomique : deux joueurs ne peuvent pas prendre la même offre
      const closed = await tx.jobOffer.updateMany({ where: { id: offer.id, open: true }, data: { open: false } });
      if (closed.count !== 1) throw new ConflictException('offer_taken');
      const day = await this.today();
      const e = await tx.employee.create({
        data: { companyId: offer.companyId, characterId: c.id, name: c.name, roleFr: offer.roleFr, roleEn: offer.roleEn, grossMonthly: offer.grossMonthly, hiredDay: day, hiredMonth: monthOf(day), lastPaidMonth: monthOf(day) - 1 },
      });
      return { employee: e.id, company: offer.company.name };
    });
  }

  /** Embauche chez un employeur public : même condition que le métier du catalogue (certificat ou diplôme), un seul emploi salarié. */
  private acceptPublic(accountId: string, jobId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const cfg = await this.settings.get('jobs.public');
      const job = cfg.enabled ? await tx.job.findUnique({ where: { id: jobId } }) : null;
      const band = job ? cfg.bands[job.level as keyof typeof cfg.bands] : undefined;
      if (!job || !job.enabled || !band || payModeOf(job.id, cfg.enabled, await this.settings.get('jobs.taskPaid')) !== 'MONTHLY') throw new NotFoundException('unknown_offer');
      const account = await tx.account.findFirst({ where: { character: { id: c.id } }, select: { guest: true } });
      if (account?.guest) throw new ForbiddenException('account_required');
      if (await tx.employee.findFirst({ where: { characterId: c.id, active: true } })) throw new ConflictException('already_employed');
      if (!(await this.chars.qualifiedFor(tx, c.id, job))) throw new BadRequestException('job_locked');
      const all = await tx.job.findMany({ where: { enabled: true }, select: { id: true, level: true, payPerShift: true } });
      const gross = publicGross(job, all, band);
      const day = await this.today();
      // Embauché : le métier devient actif tout de suite (dans la limite de métiers que le joueur peut occuper)
      const held = new Set([...c.jobIds, ...(c.jobId ? [c.jobId] : [])]);
      if (!held.has(job.id) && held.size >= (await this.settings.get('work.maxJobs'))) throw new BadRequestException('too_many_jobs');
      held.add(job.id);
      // Le mois d'embauche est incomplet : le premier salaire est celui du premier mois entier
      const e = await tx.employee.create({
        data: { publicJobId: job.id, characterId: c.id, name: c.name, roleFr: job.nameFr, roleEn: job.nameEn, grossMonthly: gross, hiredDay: day, hiredMonth: monthOf(day), lastPaidMonth: monthOf(day) },
      });
      await tx.character.update({ where: { id: c.id }, data: { jobId: job.id, jobIds: [...held] } });
      return { employee: e.id, company: job.nameFr, role: job.nameFr, roleEn: job.nameEn };
    });
  }

  /**
   * Salaire d'un emploi public : pour chaque mois clos, le net du mois est versé par le Trésor au prorata des services du métier
   * terminés pendant ce mois (jobs.public.minShifts services = salaire entier). Les mois non réclamés restent dus.
   */
  claimSalary(accountId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const e = await tx.employee.findFirst({ where: { characterId: c.id, active: true } });
      if (!e) throw new NotFoundException('not_employed');
      if (!e.publicJobId) throw new BadRequestException('not_public_job');
      const cfg = await this.settings.get('jobs.public');
      const rates = await this.settings.get('payroll.rates');
      const clock = await this.settings.clock();
      const day = await this.today();
      const closed = monthOf(day) - 1;
      const from = Math.max(e.lastPaidMonth + 1, closed - 11); // au plus douze mois rattrapés
      if (from > closed) throw new BadRequestException('nothing_to_pay');
      const p = computePayroll(BigInt(e.grossMonthly), rates);
      const monthMs = GAME_DAYS_PER_MONTH * clock.secondsPerGameDay * 1000;
      let total = 0n;
      let paidMonths = 0;
      for (let m = from; m <= closed; m++) {
        const done = await tx.workShift.count({
          where: { characterId: c.id, kind: 'job', sourceId: e.publicJobId, closedAt: { not: null }, startedAt: { gte: new Date(clock.epochRealMs + m * monthMs), lt: new Date(clock.epochRealMs + (m + 1) * monthMs) } },
        });
        const bp = attendanceBp(done, cfg.minShifts);
        if (bp > 0) paidMonths++;
        total += (p.net * BigInt(bp)) / 10_000n;
      }
      await tx.employee.update({ where: { id: e.id }, data: { lastPaidMonth: closed } });
      if (total > 0n) {
        await this.ledger.post(tx, {
          kind: 'PAYROLL',
          idempotencyKey: `salary:${e.id}:${closed}`,
          requestHash: sha256Hex(`salary|${e.id}|${closed}`),
          memo: e.id,
          legs: [{ from: await this.ledger.systemWalletId(tx, 'TREASURY'), to: c.walletId, amount: total }],
        });
        // L'AMU est retenue sur le salaire (part salariale dans le net) : la couverture est prolongée d'un mois par mois payé, sans rien à régler soi-même
        await tx.character.update({ where: { id: c.id }, data: { amuPaidUntilGameDay: Math.max(c.amuPaidUntilGameDay, day) + GAME_DAYS_PER_MONTH * Math.max(1, paidMonths) } });
      }
      return { months: closed - from + 1, paidMonths, net: total.toString() };
    });
  }

  /** Emploi actuel du joueur chez un autre joueur. */
  async myJob(accountId: string) {
    const ch = await this.prisma.character.findUnique({ where: { accountId } });
    if (!ch) throw new NotFoundException('no_character');
    const e = await this.prisma.employee.findFirst({
      where: { characterId: ch.id, active: true },
      include: { company: { select: { name: true, character: { select: { name: true } } } }, plant: { select: { catalogId: true, unit: true, character: { select: { name: true } } } } },
    });
    if (!e) return null;
    const rates = await this.settings.get('payroll.rates');
    const day = await this.today();
    const pub = e.publicJobId ? await this.settings.get('jobs.public') : null;
    return {
      id: e.id,
      company: e.company?.name ?? (e.plant ? await this.plantName(e.plant.catalogId, e.plant.unit) : ''),
      boss: e.company?.character.name ?? e.plant?.character.name ?? '',
      plantId: e.plantId,
      publicJobId: e.publicJobId,
      venueId: e.publicJobId ? ((await this.settings.get('work.places'))[e.publicJobId] ?? null) : null,
      minShifts: pub?.minShifts ?? null,
      roleFr: e.roleFr,
      roleEn: e.roleEn,
      grossMonthly: e.grossMonthly,
      net: computePayroll(BigInt(e.grossMonthly), rates).net.toString(),
      cnssNumber: e.cnssNumber,
      unpaidMonths: Math.max(0, monthOf(day) - 1 - e.lastPaidMonth),
    };
  }

  /** Nom d'un site industriel (catalogue `industry`) pour l'affichage de l'emploi. */
  private async plantName(catalogId: string, unit: number): Promise<string> {
    const d = (await this.settings.get('industry')).plants.find((x) => x.id === catalogId);
    return d ? `${d.emoji} ${d.nameFr}${d.units > 1 ? ` #${unit + 1}` : ''}` : catalogId;
  }

  /** Démission : choix du salarié, qui renonce aux mois clos non encore payés. */
  quit(accountId: string) {
    return this.chars.act(accountId, async (tx, c) => {
      const e = await tx.employee.findFirst({ where: { characterId: c.id, active: true } });
      if (!e) throw new NotFoundException('not_employed');
      await tx.employee.update({ where: { id: e.id }, data: { active: false } });
      // Emploi salarié public : le métier quitté ne reste pas occupé (il libère sa place et on peut postuler ailleurs)
      if (e.publicJobId) {
        const held = new Set([...c.jobIds, ...(c.jobId ? [c.jobId] : [])]);
        held.delete(e.publicJobId);
        const active = c.jobId === e.publicJobId ? ([...held][0] ?? null) : c.jobId;
        await tx.character.update({ where: { id: c.id }, data: { jobId: active, jobIds: [...held] } });
      }
      return { employee: e.id };
    });
  }
}
