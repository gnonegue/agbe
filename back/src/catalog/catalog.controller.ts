import { Controller, Get, Module, ParseIntPipe, Query, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { payModeOf } from '../economy/public-jobs';
import { SettingsService } from '../settings/settings.service';
import { Public } from '../common/decorators';
import { computePayroll } from '../economy/payroll';
import { gameTimeAt } from '../economy/clock';

@Controller()
export class CatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Public()
  @Get('catalog')
  async catalog() {
    const [pub, taskPaid] = await Promise.all([this.settings.get('jobs.public'), this.settings.get('jobs.taskPaid')]);
    const [jobs, foods, products, venues] = await Promise.all([
      this.prisma.job.findMany({ where: { enabled: true }, orderBy: { payPerShift: 'asc' } }),
      this.prisma.foodItem.findMany({ where: { enabled: true }, orderBy: { price: 'asc' } }),
      this.prisma.product.findMany({ where: { active: true }, orderBy: { priceAmount: 'asc' } }),
      this.prisma.venue.findMany({
        where: { enabled: true },
        orderBy: { id: 'asc' },
        include: { activities: { where: { enabled: true }, orderBy: [{ sort: 'asc' }, { price: 'asc' }] } },
      }),
    ]);
    return {
      jobs: jobs.map(({ enabled: _e, ...j }) => ({ ...j, payMode: payModeOf(j.id, pub.enabled, taskPaid) })),
      foods: foods.map(({ enabled: _e, ...f }) => f),
      // Les panneaux se réservent depuis l'affiche elle-même : on ne les liste pas dans la boutique
      products: products.filter((p) => p.kind !== 'AD_BOARD' && p.kind !== 'AD_PLOT').map(({ active: _a, ...p }) => p),
      // Panneau rotatif (tarif de base) et panneau fixe (majoré) : le client n'envoie que son choix, jamais un prix
      board: products.filter((p) => p.id === 'board_7d').map(({ active: _a, ...p }) => p)[0] ?? null,
      boardFixed: products.filter((p) => p.id === 'board_fixed_7d').map(({ active: _a, ...p }) => p)[0] ?? null,
      rent: await this.settings.get('rent.monthly'),
      wash: await this.settings.get('action.wash'),
      transferFee: await this.settings.get('transfer.fee'),
      venues: venues.map(({ enabled: _e, activities, ...v }) => ({
        ...v,
        activities: activities.map(({ enabled: _a, venueId: _v, sort: _s, ...a }) => a),
      })),
      homePosition: await this.settings.get('home.position'),
      hours: await this.settings.get('venues.hours'),
      // Fiche de poste : lieu de travail de chaque métier et métiers sans horaire d'ouverture
      workAnyHour: await this.settings.get('work.anyHour'),
      fx: await this.settings.get('fx.rates'),
      transport: await this.settings.get('transport.modes'),
      company: {
        cfe: await this.settings.get('company.cfe'),
        capitalMin: await this.settings.get('company.capitalMin'),
        contributions: await this.settings.get('company.contributions'),
        activities: await this.settings.get('company.activities'),
      },
      workPlaces: await this.settings.get('work.places'),
      tontine: await this.settings.get('tontine'),
      intercity: await this.settings.get('travel.intercity'),
      health: { illnesses: (await this.settings.get('health.illnesses')).map(({ id, nameFr, nameEn, treatment }) => ({ id, nameFr, nameEn, treatment })), consultPrice: (await this.settings.get('health.rules')).consultPrice },
      family: { answerDays: (await this.settings.get('family.rules')).answerDays },
      ceremony: await this.settings.get('ceremony.rules'),
      hotel: await this.settings.get('hotel'),
      outages: await (async () => {
        const o = await this.settings.get('utilities.outages');
        return { generatorPrice: o.generatorPrice, solarPrice: o.solarPrice, tankPrice: o.tankPrice };
      })(),
      market: { goods: await this.settings.get('market.goods'), rules: await this.settings.get('market.rules') },
      // Vêtements : nécessaires pour dessiner la tenue des autres joueurs
      clothes: await this.settings.get('clothes.items'),
    };
  }

  @Public()
  @Get('clock')
  async clock() {
    const cfg = await this.settings.clock();
    return { now: Date.now(), secondsPerGameDay: cfg.secondsPerGameDay, gameTime: gameTimeAt(cfg, Date.now()) };
  }

  /** Simulateur de paie pédagogique : brut → retenues CNSS/AMU, IRPP, net, coût employeur. */
  @Public()
  @Get('economy/payroll')
  async payroll(@Query('gross', ParseIntPipe) gross: number) {
    if (gross < 0 || gross > 100_000_000) throw new BadRequestException('invalid_gross');
    const r = computePayroll(BigInt(gross), await this.settings.get('payroll.rates'));
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]));
  }
}

@Module({ controllers: [CatalogController] })
export class CatalogModule {}
