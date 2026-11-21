import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { LandService } from './land.module';

// Foncier : achat par quarts, démarches du titre, exploitation, revente (base réelle TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Foncier (PostgreSQL)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let land: LandService;
  let settings: SettingsService;
  // Clés d'idempotence propres à chaque lancement : le test reste rejouable sur la même base
  const run = Date.now().toString(36).padStart(10, '0');
  // Zone libre à prix selon la position ; le lotissement (prix fixe) a son propre test
  const ZONE = 'agoe_nord';
  const P: { account: string; character: string; wallet: string }[] = [];
  /** Montant reçu par un portefeuille dans une transaction précise (le solde du Trésor bouge aussi avec les autres tests). */
  const received = async (where: { idempotencyKey?: string; memo?: string }, wallet: string) => {
    const tx = await prisma.ledgerTransaction.findFirstOrThrow({ where, include: { entries: true } });
    return tx.entries.filter((e) => e.walletId === wallet).reduce((n, e) => n + e.amount, 0n);
  };
  const balance = async (wallet: string) => (await prisma.wallet.findUniqueOrThrow({ where: { id: wallet } })).balance;

  async function player(tag: string, funds: bigint) {
    const acc = await prisma.account.create({ data: { email: `${tag}-${Date.now().toString(36)}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: tag, profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', locationId: 'home', wallet: { create: {} } },
      include: { wallet: true },
    });
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: c.wallet!.id, amount: funds }] }));
    P.push({ account: acc.id, character: c.id, wallet: c.wallet!.id });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new LedgerService(prisma);
    settings = new SettingsService(prisma);
    const chars = new CharacterService(prisma, ledger, settings);
    land = new LandService(prisma, ledger, settings, chars);
    // Base de test seulement : les terrains des lancements précédents sont libérés pour que le test reste rejouable
    await prisma.landHolding.deleteMany({});
    await prisma.gameSetting.deleteMany({ where: { key: 'land' } });
    for (const code of ['MARKET', 'TREASURY']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    await player('vendeur', 50_000_000n);
    await player('acheteur', 50_000_000n);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('le prix du m² dépend de la position et le devis donne le total que le serveur facture', async () => {
    const cat = await land.catalog(P[0]!.account);
    expect(cat.zones.length).toBeGreaterThan(0);
    const z = cat.zones.find((x) => x.id === ZONE)!;
    expect(BigInt(z.maxPerM2) >= BigInt(z.minPerM2)).toBe(true);
    const plan = await land.zone(P[0]!.account, z.id);
    expect(plan.price.length).toBe(z.layout.cols * z.layout.rows);
    expect(Math.max(...plan.price)).toBeGreaterThan(Math.min(...plan.price));
    const q = await land.quote(P[0]!.account, z.id, [{ cell: 0, quarters: [0, 1] }]);
    expect(q.m2).toBe(300);
    expect(BigInt(q.total)).toBe(BigInt(plan.price[0]!) * 300n);
    expect(BigInt(q.grand)).toBe(BigInt(q.total) + BigInt(q.fee));
  });

  it('une zone à extension n\'ouvre qu\'une partie de ses rangées : le reste se débloque au fil des achats', async () => {
    const cat = await land.catalog(P[0]!.account);
    const z = cat.zones.find((x) => x.id === ZONE)!;
    expect(z.planRows).toBeGreaterThan(z.layout.rows);
    const plan = await land.zone(P[0]!.account, ZONE);
    expect(plan.planRows).toBe(z.planRows);
    expect(plan.layout.rows).toBe(z.layout.rows);
    // une cellule de la part fermée n'est ni visible ni vendable
    const closed = z.layout.cols * z.planRows - 1;
    await expect(land.quote(P[0]!.account, ZONE, [{ cell: closed, quarters: [0] }])).rejects.toThrow('unknown_plot');
    await expect(land.cellInfo(ZONE, closed)).rejects.toThrow('unknown_plot');
  });

  it('le lotissement est une zone du foncier au prix fixe, sans majoration de position', async () => {
    const plan = await land.zone(P[0]!.account, 'lotissement');
    expect(plan.price.length).toBe(plan.layout.cols * plan.layout.rows);
    expect(new Set(plan.price).size).toBe(1);
    expect(plan.margin).toBe(1);
    expect(plan.sign).toBe(false);
    const q = await land.quote(P[0]!.account, 'lotissement', [{ cell: 0, quarters: [0, 1, 2, 3] }]);
    expect(BigInt(q.total)).toBe(BigInt(plan.price[0]!) * 600n);
    expect((await land.cellInfo('lotissement', 0)).fixed).toBe(true);
  });

  it('achat d’un demi-lot : argent débité (prix + frais), quarts attribués, double vente refusée', async () => {
    const zoneId = ZONE;
    const treasury = await ledger.systemWalletId(prisma, 'TREASURY');
    const before = await balance(P[0]!.wallet);
    const r = await land.buy(P[0]!.account, zoneId, [{ cell: 3, quarters: [0, 1] }], `buy-${run}-aaaa`);
    const paid = BigInt((r.result as { paid: string }).paid);
    const fee = BigInt((r.result as { fee: string }).fee);
    expect(before - (await balance(P[0]!.wallet))).toBe(paid + fee);
    expect(await received({ idempotencyKey: `landbuy:${P[0]!.character}:buy-${run}-aaaa` }, treasury)).toBe(fee);
    // Rejeu avec la même clé : aucun second débit
    await land.buy(P[0]!.account, zoneId, [{ cell: 3, quarters: [0, 1] }], `buy-${run}-aaaa`);
    expect(before - (await balance(P[0]!.wallet))).toBe(paid + fee);
    // Mêmes quarts pour un autre joueur : refusé ; quarts restants : acceptés
    await expect(land.buy(P[1]!.account, zoneId, [{ cell: 3, quarters: [1, 2] }])).rejects.toThrow('land_taken');
    await land.buy(P[1]!.account, zoneId, [{ cell: 3, quarters: [2, 3] }]);
    const plan = await land.zone(P[0]!.account, zoneId);
    expect(plan.free[3]).toBe(0);
    expect(plan.mine[3]).toBe(0b0011);
    // Occupation publique pour la carte : quarts et couleur, jamais d'identifiant ni de nom de joueur
    const occ = plan.owners.filter((o) => o.cell === 3);
    expect(occ.map((o) => o.q).sort((a, b) => a - b)).toEqual([0b0011, 0b1100]);
    expect(JSON.stringify(plan.owners)).not.toContain(P[0]!.character);
  });

  it('plafond de 15 hectares par joueur', async () => {
    const zoneId = ZONE;
    const cfg = await settings.get('land');
    const full = Array.from({ length: cfg.maxPicksPerPurchase }, (_, i) => ({ cell: 10 + i, quarters: [0, 1, 2, 3] }));
    // 2 lots = 1 200 m² : sous le plafond de 150 000 m²
    const q = await land.quote(P[0]!.account, zoneId, full.slice(0, 2));
    expect(q.overLimit).toBe(false);
    // Plafond abaissé à un lot (600 m²) : le joueur en possède déjà 300, un lot entier de plus est refusé
    await settings.set('land', { ...cfg, maxM2PerPlayer: 600 }, P[0]!.account);
    try {
      await expect(land.buy(P[0]!.account, zoneId, [{ cell: 30, quarters: [0, 1, 2, 3] }])).rejects.toThrow('land_limit');
    } finally {
      // Retour aux valeurs par défaut, même si l'assertion échoue
      await prisma.gameSetting.deleteMany({ where: { key: 'land' } });
      await settings.set('land', cfg, P[0]!.account);
      await prisma.gameSetting.deleteMany({ where: { key: 'land' } });
    }
  });

  it('titre foncier : bornage, avis favorable, titre ; puis exploitation, revente et mutation', async () => {
    const zoneId = ZONE;
    await land.buy(P[0]!.account, zoneId, [{ cell: 40, quarters: [0, 1, 2, 3] }]);
    const holdings = (await land.mine(P[0]!.account)).holdings;
    const h = holdings.find((x) => x.cell === 40)!;
    expect(h.status).toBe('BOUGHT');
    expect(h.next?.step).toBe('SURVEYED');
    // Pas de revente ni d'exploitation sans titre
    await expect(land.list(P[0]!.account, h.id, 1_000_000)).rejects.toThrow('no_title');
    await expect(land.startUse(P[0]!.account, h.id, 'biz_garden')).rejects.toThrow('no_title');
    const treasury = await ledger.systemWalletId(prisma, 'TREASURY');
    for (const expected of ['SURVEYED', 'OPINION', 'TITLED']) {
      const r = await land.step(P[0]!.account, h.id);
      expect((r.result as { step: string }).step).toBe(expected);
      expect(await received({ memo: `${expected}:${h.id}` }, treasury)).toBe(BigInt((r.result as { paid: string }).paid));
      await expect(land.step(P[0]!.account, h.id)).rejects.toThrow('step_in_progress');
      // Délai écoulé : la démarche aboutit
      await prisma.landHolding.update({ where: { id: h.id }, data: { stepReadyAt: new Date(Date.now() - 1000) } });
      const now = (await land.mine(P[0]!.account)).holdings.find((x) => x.id === h.id)!;
      expect(now.status).toBe(expected);
    }
    const titled = (await land.mine(P[0]!.account)).holdings.find((x) => x.id === h.id)!;
    expect(titled.titleNo).toMatch(/^TF-\d{8}$/);
    await expect(land.step(P[0]!.account, h.id)).rejects.toThrow('already_titled');

    // Activité : investissement, chantier, revenu encaissé une seule fois
    await land.startUse(P[0]!.account, h.id, 'biz_garden');
    await expect(land.collect(P[0]!.account, h.id)).rejects.toThrow('site_not_ready');
    await prisma.landHolding.update({ where: { id: h.id }, data: { useReadyAt: new Date(Date.now() - 3 * 3_600_000) } });
    const b0 = await balance(P[0]!.wallet);
    const c1 = await land.collect(P[0]!.account, h.id);
    expect(BigInt((c1.result as { received: string }).received)).toBeGreaterThan(0n);
    expect((await balance(P[0]!.wallet)) - b0).toBe(BigInt((c1.result as { received: string }).received));
    const c2 = await land.collect(P[0]!.account, h.id);
    expect((c2.result as { received: string }).received).toBe('0');

    // Revente : le prix au vendeur, les droits d'enregistrement au Trésor, le titre change de main
    await land.list(P[0]!.account, h.id, 9_000_000);
    await expect(land.buyListing(P[0]!.account, h.id)).rejects.toThrow('own_land');
    const sellerBefore = await balance(P[0]!.wallet);
    const buyerBefore = await balance(P[1]!.wallet);
    const sale = await land.buyListing(P[1]!.account, h.id, `sale-${run}-bbbb`);
    const tax = BigInt((sale.result as { tax: string }).tax);
    expect((await balance(P[0]!.wallet)) - sellerBefore).toBe(9_000_000n);
    expect(buyerBefore - (await balance(P[1]!.wallet))).toBe(9_000_000n + tax);
    expect(await received({ idempotencyKey: `landsale:${P[1]!.character}:sale-${run}-bbbb` }, treasury)).toBe(tax);
    const owner = await prisma.landHolding.findUniqueOrThrow({ where: { id: h.id } });
    expect(owner.characterId).toBe(P[1]!.character);
    expect(owner.titleNo).toBe(titled.titleNo);
    await expect(land.buyListing(P[1]!.account, h.id)).rejects.toThrow();
  });

  it('maison sur son terrain : emménagement, propriétaire sans loyer', async () => {
    const zoneId = ZONE;
    await land.buy(P[1]!.account, zoneId, [{ cell: 60, quarters: [0, 1, 2, 3] }]);
    const h = (await land.mine(P[1]!.account)).holdings.find((x) => x.cell === 60)!;
    await prisma.landHolding.update({ where: { id: h.id }, data: { status: 'TITLED', titleNo: 'TF-12345678' } });
    await land.startUse(P[1]!.account, h.id, 'house_small');
    await expect(land.moveIn(P[1]!.account, h.id)).rejects.toThrow('house_not_ready');
    await prisma.landHolding.update({ where: { id: h.id }, data: { useReadyAt: new Date(Date.now() - 1000) } });
    await land.moveIn(P[1]!.account, h.id);
    const c = await prisma.character.findUniqueOrThrow({ where: { id: P[1]!.character } });
    expect(c.homeOwned).toBe(true);
    expect(c.housing).toBe('ENTRER_COUCHER');
    // Un logement habité ne se met pas en vente
    await expect(land.list(P[1]!.account, h.id, 1_000_000)).rejects.toThrow('home_not_sellable');
  });
  it('regroupement de lots voisins : 2 lots collés ouvrent la cimenterie (1 200 m²), lots éloignés refusés', async () => {
    const A = P[1]!.account;
    await land.buy(A, ZONE, [{ cell: 64, quarters: [0, 1, 2, 3] }, { cell: 65, quarters: [0, 1, 2, 3] }, { cell: 68, quarters: [0, 1, 2, 3] }]);
    const mine = (await land.mine(A)).holdings;
    const [h64, h65, h68] = [64, 65, 68].map((n) => mine.find((x) => x.cell === n)!);
    await expect(land.merge(A, [h64!.id, h68!.id])).rejects.toThrow('merge_not_adjacent');
    const r = (await land.merge(A, [h64!.id, h65!.id])).result;
    expect(r.m2).toBe(1200);
    const after = (await land.mine(A)).holdings;
    expect(after.some((x) => x.id === h65!.id)).toBe(false);
    await prisma.landHolding.update({ where: { id: r.id }, data: { status: 'TITLED', titleNo: 'TF-87654321' } });
    await expect(land.startUse(A, h68!.id, 'biz_cement')).rejects.toThrow();
    await land.startUse(A, r.id, 'biz_cement');
    // Sur la carte, les deux lots réunis forment une seule parcelle (même numéro)
    const plan = await land.zone(A, ZONE);
    const parts = plan.owners.filter((o) => o.cell === 64 || o.cell === 65);
    expect(parts.length).toBe(2);
    expect(parts[0]!.g).toBe(parts[1]!.g);
  });

  it('regroupement refusé si un lot d’un autre joueur est entre les deux, ou si seuls des quarts éloignés se font face', async () => {
    const A = P[1]!.account;
    // Lots 52 et 54 à moi, lot 53 entre les deux acheté par quelqu'un d'autre
    await land.buy(A, ZONE, [{ cell: 52, quarters: [0, 1, 2, 3] }, { cell: 54, quarters: [0, 1, 2, 3] }]);
    await land.buy(P[0]!.account, ZONE, [{ cell: 53, quarters: [0, 1, 2, 3] }]);
    const mine = (await land.mine(A)).holdings;
    expect(mine.find((h) => h.cells.includes(64))!.cells).toEqual([64, 65]);
    const h52 = mine.find((h) => h.cell === 52)!;
    const h54 = mine.find((h) => h.cell === 54)!;
    await expect(land.merge(A, [h52.id, h54.id])).rejects.toThrow('merge_not_adjacent');
    // Lots voisins 50 et 51, mais quart gauche du 50 et quart droit du 51 : ils ne se touchent pas
    await land.buy(A, ZONE, [{ cell: 50, quarters: [0] }, { cell: 51, quarters: [1] }]);
    const all = (await land.mine(A)).holdings;
    const a = all.find((h) => h.cell === 50)!;
    const b = all.find((h) => h.cell === 51)!;
    await expect(land.merge(A, [a.id, b.id])).rejects.toThrow('merge_not_adjacent');
  });
});
