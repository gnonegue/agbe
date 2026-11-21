import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from './character.service';

// Plafond de personnages par condition de départ : « riche » se ferme au-delà du plafond, même en choix libre ;
// le destin descend d'un cran. La base est partagée avec d'autres tests lancés en parallèle : on ne supprime aucun
// personnage, le plafond est réglé par rapport à l'effectif riche déjà présent.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Plafond par condition de départ (PostgreSQL)', () => {
  let prisma: PrismaService;
  let chars: CharacterService;
  let settings: SettingsService;
  let actor: string;
  const tag = Date.now().toString(36);
  let n = 0;
  const newAccount = async () => (await prisma.account.create({ data: { email: `quota-${tag}-${n++}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } })).id;
  const make = async (mode: 'FREE_CHOICE' | 'DESTINY', condition?: 'RICH' | 'MIDDLE' | 'POOR') =>
    chars.create(await newAccount(), { name: `Joueur${tag}${n}`, profile: 'LOCAL', region: 'MARITIME', mode, ...(condition ? { condition } : {}) } as never);
  const richNow = () => prisma.character.count({ where: { birthCondition: 'RICH' } });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    settings = new SettingsService(prisma);
    chars = new CharacterService(prisma, new LedgerService(prisma), settings);
    for (const code of ['TREASURY', 'PURCHASES', 'CARRY']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    actor = await newAccount();
    // Exactement deux places riches libres au-delà de l'effectif actuel, plafond proportionnel à 0 %
    const rich = await richNow();
    await settings.set('start.quota', { RICH: { maxShareBp: 0, minSlots: rich + 2 }, MIDDLE: { maxShareBp: 10_000, minSlots: 0 } }, actor);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('les places riches sont ouvertes, puis le choix se ferme', async () => {
    expect((await chars.conditionAvailability()).RICH).toBe(true);
    await make('FREE_CHOICE', 'RICH');
    await make('FREE_CHOICE', 'RICH');
    expect((await chars.conditionAvailability()).RICH).toBe(false);
    await expect(make('FREE_CHOICE', 'RICH')).rejects.toThrow('condition_full');
  });

  it('pauvre reste toujours possible, même quand riche est complet', async () => {
    const s = await make('FREE_CHOICE', 'POOR');
    expect(s.birthCondition).toBe('POOR');
  });

  it('le destin descend d\'un cran quand riche est complet', async () => {
    await settings.set('destiny.weights', { POOR: 0, MIDDLE: 0, RICH: 100 }, actor);
    const s = await make('DESTINY');
    expect(s.birthCondition).toBe('MIDDLE');
  });

  it('la place se rouvre quand le plafond le permet', async () => {
    await settings.set('start.quota', { RICH: { maxShareBp: 0, minSlots: (await richNow()) + 1 }, MIDDLE: { maxShareBp: 10_000, minSlots: 0 } }, actor);
    expect((await chars.conditionAvailability()).RICH).toBe(true);
    const s = await make('FREE_CHOICE', 'RICH');
    expect(s.birthCondition).toBe('RICH');
  });
});
