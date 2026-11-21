import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from './character.service';

// Envoi d'argent entre joueurs : aucune proximité n'est exigée (autre lieu, autre ville), le destinataire se retrouve par @nom.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Transfert d’argent à distance (PostgreSQL)', () => {
  let prisma: PrismaService;
  let chars: CharacterService;
  let sender: { accountId: string; walletId: string; characterId: string };
  let friend: { accountId: string; walletId: string; characterId: string; username: string };

  const make = async (tag: string, locationId: string, city: string) => {
    const username = `u${tag}`.slice(0, 20);
    const acc = await prisma.account.create({ data: { email: `${username}@test.tg`, username, passwordHash: 'x', birthDate: new Date('1990-01-01'), createdAt: new Date(Date.now() - 30 * 86_400_000) } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: `Perso ${tag}`, profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'CHAMBRE_SALON', locationId, city, wallet: { create: {} } },
      include: { wallet: true },
    });
    return { accountId: acc.id, walletId: c.wallet!.id, characterId: c.id, username };
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const ledger = new LedgerService(prisma);
    chars = new CharacterService(prisma, ledger, new SettingsService(prisma));
    for (const code of ['TREASURY', 'MARKET', 'FEES']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    const tag = Date.now().toString(36);
    sender = await make(`a${tag}`, 'home', 'lome');
    friend = await make(`b${tag}`, 'gare_kara', 'kara');
    const treasury = await ledger.systemWalletId(prisma, 'TREASURY');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: treasury, to: sender.walletId, amount: 20_000n }] }));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('retrouve un joueur par son @nom (sans révéler autre chose)', async () => {
    const r = await chars.lookupRecipient(sender.accountId, `@${friend.username.toUpperCase()}`);
    expect(r).toEqual({ characterId: friend.characterId, name: expect.any(String), username: friend.username });
    await expect(chars.lookupRecipient(sender.accountId, 'inconnu_xyz')).rejects.toThrow('recipient_not_found');
    await expect(chars.lookupRecipient(sender.accountId, '!!')).rejects.toThrow('invalid_username');
    await expect(chars.lookupRecipient(friend.accountId, friend.username)).rejects.toThrow('same_wallet');
  });

  it('suggère des joueurs pendant la saisie (préfixe du @nom ou identifiant exact), jamais soi-même', async () => {
    const byPrefix = await chars.searchRecipients(sender.accountId, `@${friend.username.slice(0, 4)}`);
    expect(byPrefix.map((x) => x.username)).toContain(friend.username);
    expect(byPrefix.every((x) => x.characterId !== sender.characterId)).toBe(true);
    expect(await chars.searchRecipients(sender.accountId, friend.characterId)).toEqual([{ characterId: friend.characterId, name: expect.any(String), username: friend.username }]);
    expect(await chars.searchRecipients(sender.accountId, 'a')).toEqual([]);
    expect(await chars.searchRecipients(friend.accountId, friend.characterId)).toEqual([]);
  });

  it('envoie l’argent à un joueur dans une autre ville, sans être près de lui', async () => {
    const res = await chars.transfer(sender.accountId, friend.characterId, 5_000, 'merci', 'k-' + Date.now());
    expect(res.result.amount).toBe(5_000);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { id: friend.walletId } })).balance).toBe(5_000n);
  });
});
