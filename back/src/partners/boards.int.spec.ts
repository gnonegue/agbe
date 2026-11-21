import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BillboardsController } from './partners.module';

// Réservation d'un panneau en libre-service : rotatif (tarif de base) ou fixe (majoré), plafond de rotation, panneaux gardés (base réelle TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Panneaux : rotatif ou fixe (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ctl: BillboardsController;
  let account: string;
  const checkouts: string[] = [];
  const base = { advertiser: 'Test Pub', title: 'Titre', subtitle: '', bg: '#0a7d4f', fg: '#ffffff' };
  const u = () => ({ accountId: account }) as never;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const settings = new SettingsService(prisma);
    const payments = { checkout: async (_a: string, productId: string) => (checkouts.push(productId), { purchaseId: 'p', redirectUrl: 'https://x.tg' }) } as never;
    const audit = { log: async () => undefined } as never;
    ctl = new BillboardsController(prisma, payments, audit, settings);
    await prisma.campaign.deleteMany({});
    // Base sans seed : le produit rotatif est créé ici (le fixe vient de la migration)
    await prisma.product.upsert({ where: { id: 'board_7d' }, create: { id: 'board_7d', kind: 'AD_BOARD', nameFr: 'Rotatif', nameEn: 'Rotating', priceAmount: 3500 }, update: { priceAmount: 3500 } });
    await prisma.gameSetting.upsert({ where: { key: 'ad.boards' }, create: { key: 'ad.boards', value: { count: 6 } }, update: { value: { count: 6 } } });
    // 6 panneaux, les 2 derniers gardés pour la rotation, 2 annonces rotatives au plus en même temps
    await prisma.gameSetting.upsert({ where: { key: 'ad.rotation' }, create: { key: 'ad.rotation', value: { max: 2, panels: 2 } }, update: { value: { max: 2, panels: 2 } } });
    const tag = Date.now().toString(36);
    account = (await prisma.account.create({ data: { email: `boards-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } })).id;
  });

  afterAll(async () => {
    await prisma?.campaign.deleteMany({});
    await prisma?.gameSetting.deleteMany({ where: { key: { in: ['ad.boards', 'ad.rotation'] } } });
    await prisma?.$disconnect();
  });

  it('le fixe, créé par la migration, vaut 5 250 : le rotatif (3 500) majoré de 50 %', async () => {
    const rot = await prisma.product.findUniqueOrThrow({ where: { id: 'board_7d' } });
    const fix = await prisma.product.findUniqueOrThrow({ where: { id: 'board_fixed_7d' } });
    expect(fix.priceAmount).toBe(Math.round(3500 * 1.5));
    expect(rot.priceAmount).toBe(3500);
    expect(fix.priceAmount).toBe(5250);
  });

  it('rotatif : produit de base, slot -1 ; fixe : produit majoré, panneau précis', async () => {
    await ctl.book(u(), { ...base, slot: -1 }, '127.0.0.1');
    await ctl.book(u(), { ...base, slot: 1 }, '127.0.0.1');
    expect(checkouts).toEqual(['board_7d', 'board_fixed_7d']);
    expect(await prisma.campaign.count({ where: { slot: -1 } })).toBe(1);
    expect(await prisma.campaign.count({ where: { slot: 1 } })).toBe(1);
  });

  it('fixe : un panneau déjà pris est refusé', async () => {
    await expect(ctl.book(u(), { ...base, slot: 1 }, '127.0.0.1')).rejects.toThrow('board_taken');
  });

  it('fixe : les derniers panneaux sont gardés pour la rotation', async () => {
    await expect(ctl.book(u(), { ...base, slot: 4 }, '127.0.0.1')).rejects.toThrow('board_rotation_only');
    await expect(ctl.book(u(), { ...base, slot: 5 }, '127.0.0.1')).rejects.toThrow('board_rotation_only');
    await expect(ctl.book(u(), { ...base, slot: 6 }, '127.0.0.1')).rejects.toThrow('unknown_board');
  });

  it('rotatif : plafond atteint, plus de place en rotation', async () => {
    await ctl.book(u(), { ...base, slot: -1 }, '127.0.0.1');
    await expect(ctl.book(u(), { ...base, slot: -1 }, '127.0.0.1')).rejects.toThrow('rotation_full');
    const s = await ctl.slots();
    expect(s).toMatchObject({ count: 6, rotating: 2, rotatingMax: 2, rotationFrom: 4, taken: [1] });
  });
});
