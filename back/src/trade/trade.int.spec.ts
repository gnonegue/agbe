import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { TradeService } from './trade.module';

// Commerce au port sur une vraie base (TEST_DATABASE_URL) : douane, stock, revente, argent conservé.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('TradeService (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let trade: TradeService;
  let accountId: string;
  let walletId: string;
  let characterId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    const settings = new SettingsService(prisma);
    trade = new TradeService(prisma, ledger, settings, new CharacterService(prisma, ledger, settings));
    // Base de test : lieux toujours ouverts, pour ne pas dépendre de l'heure de jeu
    await prisma.gameSetting.upsert({ where: { key: 'venues.hours' }, create: { key: 'venues.hours', value: {} }, update: { value: {} } });
    for (const code of ['MARKET', 'TREASURY']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    const tag = Date.now().toString(36);
    const acc = await prisma.account.create({ data: { email: `trader-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'Trader', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', locationId: 'port', wallet: { create: {} } },
      include: { wallet: true },
    });
    accountId = acc.id;
    walletId = c.wallet!.id;
    characterId = c.id;
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: walletId, amount: 500_000n }] }));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const bal = async () => (await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).balance;

  it('achat au port : prix du jour + droits de douane, stock créé', async () => {
    const before = await bal();
    const list = await trade.list(accountId);
    const rice = list.goods.find((g) => g.id === 'riz_sac')!;
    const r = await trade.buy(accountId, 'riz_sac', 2);
    const goods = BigInt(rice.buyToday * 2);
    const duty = (goods * 1000n + 9_999n) / 10_000n;
    expect(BigInt(r.result.paid)).toBe(goods + duty);
    expect(before - (await bal())).toBe(goods + duty);
    const h = await prisma.holding.findUniqueOrThrow({ where: { characterId_goodId: { characterId, goodId: 'riz_sac' } } });
    expect(h.qty).toBe(2);
  });

  it('refuse la vente hors du bon lieu, puis vend au marché', async () => {
    await expect(trade.sell(accountId, 'riz_sac', 1)).rejects.toThrow('sell_at_marche_assigame');
    await prisma.character.update({ where: { id: characterId }, data: { locationId: 'marche_assigame' } });
    const before = await bal();
    const r = await trade.sell(accountId, 'riz_sac', 2);
    expect((await bal()) - before).toBe(BigInt(r.result.received));
    expect(await prisma.holding.findUnique({ where: { characterId_goodId: { characterId, goodId: 'riz_sac' } } })).toBeNull();
  });

  it('refuse de vendre plus que le stock et de dépasser la limite', async () => {
    await expect(trade.sell(accountId, 'riz_sac', 1)).rejects.toThrow('not_enough_stock');
    await prisma.character.update({ where: { id: characterId }, data: { locationId: 'port' } });
    await expect(trade.buy(accountId, 'voiture_occasion', 2)).rejects.toThrow('stock_limit');
  });

  it('refuse d’acheter quand le lieu est fermé', async () => {
    // [24, 0] : plage vide, le port est toujours fermé. Nouveau SettingsService pour ne pas lire le cache.
    await prisma.gameSetting.update({ where: { key: 'venues.hours' }, data: { value: { port: [24, 0] } } });
    const s2 = new SettingsService(prisma);
    const closed = new TradeService(prisma, ledger, s2, new CharacterService(prisma, ledger, s2));
    await expect(closed.buy(accountId, 'riz_sac', 1)).rejects.toThrow('venue_closed');
    await prisma.gameSetting.update({ where: { key: 'venues.hours' }, data: { value: {} } });
  });

  it('à distance : achat sans être sur place, revente au cours de rachat sans taxe à l’export, jamais de gain immédiat', async () => {
    await prisma.character.update({ where: { id: characterId }, data: { locationId: 'port' } });
    const k = (await trade.list(accountId)).goods.find((g) => g.id === 'karite')!;
    expect(k.remote).toBe(true);
    expect(k.remoteSell).toBeLessThan(k.buyToday);
    // Le karité s'achète au marché d'Assigamé : refusé au port sur place, accepté à distance
    await expect(trade.buy(accountId, 'karite', 3)).rejects.toThrow('buy_at_marche_assigame');
    const start = await bal();
    const b = await trade.buy(accountId, 'karite', 3, undefined, true);
    expect(BigInt(b.result.paid)).toBe(BigInt(k.remoteBuy * 3));
    expect(k.remoteBuy).toBeGreaterThan(k.buyToday); // un peu plus cher que le prix d'achat du port
    expect(k.remoteBuy).toBeLessThan(k.sellToday); // la revente sur place reste bénéficiaire
    const s = await trade.sell(accountId, 'karite', 3, undefined, true);
    expect(BigInt(s.result.received)).toBe(BigInt(k.remoteSell * 3));
    expect(BigInt(s.result.tax ?? '0')).toBe(0n);
    expect(await bal()).toBeLessThan(start);
    // Les voitures restent à acheter sur place
    await expect(trade.buy(accountId, 'voiture_occasion', 1, undefined, true)).rejects.toThrow('remote_not_allowed');
  });

  it('faille fermée : acheter à distance puis revendre sur place fait toujours perdre de l\'argent', async () => {
    await prisma.character.update({ where: { id: characterId }, data: { locationId: 'marche_assigame' } });
    const list = (await trade.list(accountId)).goods;
    for (const id of ['riz_sac', 'poisson_carton']) {
      const g = list.find((x) => x.id === id)!;
      // Acheter à distance puis revendre à distance : perte (écart dans les deux sens), le trajet de revente reste nécessaire
      const before = await bal();
      await trade.buy(accountId, id, 2, undefined, true);
      await trade.sell(accountId, id, 2, undefined, true);
      expect(await bal()).toBeLessThan(before);
      expect(g.sellToday).toBeGreaterThan(g.remoteBuy);
    }
  });

  it('la revente d\'un trajet est plafonnée à la marge maximale (12 % sur le coût de revient)', async () => {
    const cfg = await new SettingsService(prisma).get('port.goods');
    const list = (await trade.list(accountId)).goods;
    for (const g of list) {
      const landed = g.buyToday * (1 + (g.kind === 'IMPORT' || g.kind === 'CAR' ? g.taxBp : 0) / 10_000);
      expect(g.sellToday).toBeLessThanOrEqual(Math.floor((landed * (1 + cfg.maxMarginBp / 10_000)) / 25) * 25 + 25);
    }
  });

  it('profondeur du marché : au-delà de la quantité écoulable par jour, la vente est refusée', async () => {
    await prisma.character.update({ where: { id: characterId }, data: { locationId: 'marche_assigame' } });
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: walletId, amount: 5_000_000n }] }));
    const g = (await trade.list(accountId)).goods.find((x) => x.id === 'riz_sac')!;
    expect(g.dailyMax).toBeLessThan(g.maxQty);
    const today = g.soldToday;
    const room = g.dailyMax - today;
    await trade.buy(accountId, 'riz_sac', Math.min(g.maxQty, room + 1), undefined, true);
    await expect(trade.sell(accountId, 'riz_sac', room + 1)).rejects.toThrow('market_saturated');
    await trade.sell(accountId, 'riz_sac', Math.max(1, room));
  });

  it('le grand livre reste équilibré', async () => {
    const v = await ledger.verify();
    expect(v.globalSum).toBe('0');
  });
});
