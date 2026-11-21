import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { firstValueFrom, filter, take, timeout } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../common/audit.service';
import { LiveService } from './live.service';

// Chat, signalements et modération (base réelle TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Temps réel : chat et modération (PostgreSQL)', () => {
  let prisma: PrismaService;
  let live: LiveService;
  const p: { account: string; character: string }[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const settings = new SettingsService(prisma);
    await prisma.gameSetting.upsert({
      where: { key: 'chat' },
      create: { key: 'chat', value: { maxLength: 280, minIntervalSeconds: 0, historySize: 50, autoHideReports: 2, minAccountAgeHours: 0, blockedWords: [], presenceMax: 40 } },
      update: { value: { maxLength: 280, minIntervalSeconds: 0, historySize: 50, autoHideReports: 2, minAccountAgeHours: 0, blockedWords: [], presenceMax: 40 } },
    });
    live = new LiveService(prisma, settings, new AuditService(prisma));
    const tag = Date.now().toString(36);
    const place = `pl_${tag}`.slice(0, 32);
    for (const n of ['A', 'B', 'C']) {
      const acc = await prisma.account.create({ data: { email: `live-${n}-${tag}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
      const c = await prisma.character.create({ data: { accountId: acc.id, name: `Joueur ${n}`, profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'ENTRER_COUCHER', locationId: place, wallet: { create: {} } } });
      p.push({ account: acc.id, character: c.id });
    }
  });

  afterAll(async () => {
    await prisma?.gameSetting.deleteMany({ where: { key: { in: ['chat'] } } });
    live?.onModuleDestroy();
    await prisma?.$disconnect();
  });

  it('diffuse un message du lieu aux joueurs présents et le garde en historique', async () => {
    const b = await live.connect(p[1]!.account);
    const got = firstValueFrom(b.out.pipe(filter((e) => e.type === 'chat'), take(1), timeout(3000)));
    const m = await live.post(p[0]!.account, 'place', '  Akwaba à tous  ');
    expect(m.text).toBe('Akwaba à tous');
    expect(((await got).data as { id: string }).id).toBe(m.id);
    b.close();
    const h = await live.history(p[2]!.account, 'place');
    expect(h.messages.map((x) => x.id)).toContain(m.id);
  });

  it('synchronisation par requêtes : file par onglet, accusé de réception, message sans doublon au réessai', async () => {
    const tab = 'ongletTest01';
    // Premier tour : « hello » en tête de file
    const s1 = await live.sync(p[1]!.account, tab, 0);
    expect(s1.events[0]!.type).toBe('hello');
    // A écrit deux fois avec le même identifiant client (réessai après coupure) : un seul message publié
    const cid = '6b0f7a52-8c1e-4a4e-9d55-2f3c1a7b9e10';
    const m1 = (await live.post(p[0]!.account, 'place', 'Bonsoir', undefined, cid)) as { id: string };
    const m2 = (await live.post(p[0]!.account, 'place', 'Bonsoir', undefined, cid)) as { id: string };
    expect(m2.id).toBe(m1.id);
    await new Promise((r) => setTimeout(r, 650));
    // B relève sa file : le message y est une seule fois ; sans accusé, il serait renvoyé
    const s2 = await live.sync(p[1]!.account, tab, s1.seq);
    const chats = s2.events.filter((e) => e.type === 'chat');
    expect(chats.map((e) => (e.data as { id: string }).id)).toEqual([m1.id]);
    await new Promise((r) => setTimeout(r, 650));
    const s3 = await live.sync(p[1]!.account, tab, s2.seq);
    expect(s3.events.filter((e) => e.type === 'chat')).toHaveLength(0);
    // Accusé venu d'une ancienne file (serveur redémarré) : l'onglet est prévenu qu'il repart de zéro
    await new Promise((r) => setTimeout(r, 650));
    expect((await live.sync(p[1]!.account, tab, s3.seq + 50)).reset).toBe(true);
    expect(live.stats().syncTabs).toBeGreaterThanOrEqual(1);
  });

  it('synchronisation : les identifiants d’onglet inventés à la chaîne sont bornés par compte', async () => {
    let refused = 0;
    for (let i = 0; i < 12; i++) await live.sync(p[2]!.account, `ongletBorne${String(i).padStart(2, '0')}`, 0).catch(() => refused++);
    expect(refused).toBe(2);
  });

  it('présence par requête (sans flux continu) : en ligne, liste des joueurs et voisins positionnés', async () => {
    // A et B interrogent la présence sans ouvrir de flux ; B envoie sa position
    await live.presenceSnapshot(p[0]!.account);
    await live.setPosition(p[1]!.account, 10, 20, 0);
    await live.presenceSnapshot(p[1]!.account);
    await live.setPosition(p[0]!.account, 12, 22, 0);
    const a = await live.presenceSnapshot(p[0]!.account);
    expect(a.online).toBeGreaterThanOrEqual(2);
    expect(a.roster.map((r) => r.id)).toContain(p[1]!.character);
    expect(a.players.map((r) => r.id)).toContain(p[1]!.character);
    expect(a.roster.map((r) => r.id)).not.toContain(p[0]!.character);
    expect(live.onlineAccountIds().has(p[1]!.account)).toBe(true);
  });

  it('refuse la vente contre de l’argent réel', async () => {
    await expect(live.post(p[0]!.account, 'city', '100 millions contre 5000 par momo')).rejects.toThrow('chat_real_money');
  });

  it('masque un message après deux signalements, puis l’admin réduit au silence', async () => {
    const m = await live.post(p[0]!.account, 'place', 'message douteux');
    await expect(live.report(p[0]!.account, { targetId: p[0]!.character, reason: 'spam' })).rejects.toThrow('report_self');
    expect((await live.report(p[1]!.account, { targetId: p[0]!.character, messageId: m.id, reason: 'scam' })).hidden).toBe(false);
    // Un double signalement du même joueur ne compte pas deux fois
    expect((await live.report(p[1]!.account, { targetId: p[0]!.character, messageId: m.id, reason: 'scam' })).hidden).toBe(false);
    expect((await live.report(p[2]!.account, { targetId: p[0]!.character, messageId: m.id, reason: 'scam' })).hidden).toBe(true);
    expect((await live.history(p[1]!.account, 'place')).messages.map((x) => x.id)).not.toContain(m.id);

    const open = (await live.openReports()).filter((r) => r.message?.id === m.id);
    expect(open).toHaveLength(2);
    await live.resolve(p[2]!.account, open[0]!.id, 'mute', 2);
    expect((await live.openReports()).some((r) => r.message?.id === m.id)).toBe(false);
    await expect(live.post(p[0]!.account, 'city', 'je reviens')).rejects.toThrow('chat_muted');
  });

  it('présence : un joueur voit la position des autres dans la ville, et leur véhicule', async () => {
    const a = await live.connect(p[1]!.account);
    await live.setPosition(p[2]!.account, 10, -20, 0, 'BUS');
    const c = await live.connect(p[2]!.account);
    const ev = await firstValueFrom(a.out.pipe(filter((e) => e.type === 'presence'), take(1), timeout(5000)));
    const players = (JSON.parse(ev.data as string) as { players: { id: string; x: number; ride: string | null }[] }).players;
    expect(players.find((x) => x.id === p[2]!.character)?.x).toBe(10);
    expect(players.find((x) => x.id === p[2]!.character)?.ride).toBe('BUS');
    a.close();
    c.close();
  });

  it('groupes : création, messages en direct, réservé aux membres, ajout par le propriétaire, départ', async () => {
    const [, b, c] = p;
    const cs = await live.connect(c!.account);
    const added = firstValueFrom(cs.out.pipe(filter((e) => e.type === 'group_added'), take(1), timeout(3000)));
    const g = await live.createGroup(b!.account, '  Les amis de Lomé  ', [c!.character, b!.character]);
    expect(g.name).toBe('Les amis de Lomé');
    expect(g.ownerId).toBe(b!.character);
    expect(g.members.map((m) => m.id).sort()).toEqual([b!.character, c!.character].sort());
    expect(((await added).data as { id: string }).id).toBe(g.id);

    const got = firstValueFrom(cs.out.pipe(filter((e) => e.type === 'group'), take(1), timeout(3000)));
    const m = await live.groupPost(b!.account, g.id, 'Bonsoir le groupe');
    expect(((await got).data as { id: string }).id).toBe(m.id);
    expect((await live.groupHistory(c!.account, g.id)).messages.map((x) => x.text)).toEqual(['Bonsoir le groupe']);
    // Un groupe n'est pas un salon public : l'historique ne se lit pas en dehors
    expect((await live.history(c!.account, 'place')).messages.some((x) => x.id === m.id)).toBe(false);

    // Réservé aux membres ; ajout réservé au propriétaire
    const outsider = p[0]!;
    await expect(live.groupHistory(outsider.account, g.id)).rejects.toThrow('not_group_member');
    await expect(live.groupPost(outsider.account, g.id, 'salut')).rejects.toThrow('not_group_member');
    await expect(live.addGroupMember(c!.account, g.id, outsider.character)).rejects.toThrow('not_group_owner');
    await expect(live.createGroup(b!.account, 'Mots   ', [])).resolves.toBeTruthy();
    await expect(live.createGroup(b!.account, '   ', [])).rejects.toThrow('group_name_invalid');
    await expect(live.createGroup(b!.account, 'Vends moi du vrai argent reel', [])).rejects.toThrow();
    await expect(live.createGroup(b!.account, 'X', ['00000000-0000-4000-8000-000000000000'])).rejects.toThrow('unknown_player');
    await live.addGroupMember(b!.account, g.id, outsider.character);
    await expect(live.addGroupMember(b!.account, g.id, outsider.character)).rejects.toThrow('already_member');
    expect((await live.myGroups(outsider.account)).map((x) => x.id)).toContain(g.id);

    // Retirer quelqu'un : propriétaire seulement ; quitter : toujours possible, le plus ancien membre hérite
    await expect(live.removeGroupMember(c!.account, g.id, outsider.character)).rejects.toThrow('not_group_owner');
    await live.removeGroupMember(b!.account, g.id, outsider.character);
    await expect(live.groupHistory(outsider.account, g.id)).rejects.toThrow('not_group_member');
    await live.removeGroupMember(b!.account, g.id, b!.character);
    expect((await live.groupHistory(c!.account, g.id)).group.ownerId).toBe(c!.character);
    // Le dernier à partir supprime le groupe et ses messages
    await live.removeGroupMember(c!.account, g.id, c!.character);
    await expect(live.groupHistory(c!.account, g.id)).rejects.toThrow();
    expect(await prisma.chatMessage.count({ where: { room: `group:${g.id}` } })).toBe(0);
    cs.close();
  });

  it('argent : la trace d\'un envoi apparaît dans la conversation privée, posée par le serveur', async () => {
    const [, b, c] = p;
    const got = firstValueFrom((await live.connect(c!.account)).out.pipe(filter((e) => e.type === 'dm'), take(1), timeout(3000)));
    await live.moneyTrace(b!.character, c!.character, 5_000);
    expect(((await got).data as { money: string }).money).toBe('5000');
    const h = await live.dmHistory(c!.account, b!.character);
    expect(h.messages.at(-1)).toMatchObject({ text: '', money: '5000', from: { id: b!.character } });
    // Un message ordinaire n'a jamais de montant
    const plain = await live.dmPost(b!.account, c!.character, '5000 FCFA envoyés');
    expect(plain.money).toBeNull();
  });
});
