import { CompanyService } from '../company/company.service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettingsService } from '../settings/settings.service';
import { CharacterService } from '../character/character.service';
import { StudyService } from './study.module';

// Études : inscription, séances, examen, diplôme, métier débloqué (base réelle TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Études (PostgreSQL)', () => {
  let prisma: PrismaService;
  let study: StudyService;
  let chars: CharacterService;
  let company: CompanyService;
  let settings: SettingsService;
  let account = '';
  let character = '';
  const at = (locationId: string) => prisma.character.update({ where: { id: character }, data: { locationId, energy: 90, hunger: 90 } });
  /** Nouvelle journée de jeu entre deux séances. */
  const nextDay = async () => {
    await prisma.study.updateMany({ where: { characterId: character }, data: { lastSessionDay: -1 } });
    await prisma.character.update({ where: { id: character }, data: { energy: 90, hunger: 90 } });
  };
  const answers = async (right: boolean) => {
    const s = await study.state(account);
    const lesson = s.study!.lesson!;
    void lesson;
    // la bonne réponse n'est pas exposée : on la lit dans les réglages
    const cfg = await settings.get('study');
    const dom = cfg.domains.find((x) => x.id === s.study!.domain)!;
    const idx = ((s.study!.year - 1) * cfg.cycles[s.study!.kind].sessionsPerYear + s.study!.sessionsDone) % dom.lessons.length;
    const good = dom.lessons[idx]!.answer;
    return right ? good : (good + 1) % dom.lessons[idx]!.choicesFr.length;
  };
  const doYear = async (right: boolean) => {
    const sessions = (await study.state(account)).study!.sessions;
    for (let i = 0; i < sessions; i++) {
      await nextDay();
      await study.attend(account, await answers(right));
    }
    return study.exam(account);
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = new PrismaService();
    await prisma.$connect();
    const ledger = new LedgerService(prisma);
    settings = new SettingsService(prisma);
    await prisma.gameSetting.deleteMany({ where: { key: 'study' } });
    chars = new CharacterService(prisma, ledger, settings);
    study = new StudyService(prisma, ledger, settings, chars);
    company = new CompanyService(prisma, ledger, settings, chars);
    for (const code of ['MARKET', 'TREASURY']) await prisma.wallet.upsert({ where: { systemCode: code }, create: { systemCode: code }, update: {} });
    const acc = await prisma.account.create({ data: { email: `etudes-${Date.now().toString(36)}@test.tg`, passwordHash: 'x', birthDate: new Date('1990-01-01') } });
    const c = await prisma.character.create({
      data: { accountId: acc.id, name: 'etudiant', profile: 'LOCAL', region: 'MARITIME', birthCondition: 'POOR', birthMode: 'FREE_CHOICE', housing: 'CHAMBRE_SALON', locationId: 'universite', wallet: { create: {} } },
      include: { wallet: true },
    });
    const market = await ledger.systemWalletId(prisma, 'MARKET');
    await prisma.$transaction((tx) => ledger.post(tx, { kind: 'TEST', legs: [{ from: market, to: c.wallet!.id, amount: 5_000_000n }] }));
    await prisma.job.upsert({ where: { id: 'developpeur' }, create: { id: 'developpeur', level: 'DIPLOME', nameFr: 'Développeur', nameEn: 'Developer', payPerShift: 14000, energyCost: 6, hungerCost: 8, shiftGameHours: 8 }, update: {} });
    account = acc.id;
    character = c.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('on ne s’inscrit qu’au bon endroit, et le master demande la licence', async () => {
    await at('home');
    await expect(study.enroll(account, { kind: 'LICENCE', domain: 'informatique' })).rejects.toThrow('go_to_universite');
    await at('universite');
    await expect(study.enroll(account, { kind: 'MASTER', domain: 'informatique' })).rejects.toThrow('need_licence');
    await expect(study.enroll(account, { kind: 'LICENCE', domain: 'inconnu' })).rejects.toThrow('unknown_domain');
  });

  it('le métier de développeur est fermé sans licence', async () => {
    await expect(chars.takeJob(account, 'developpeur')).rejects.toThrow('job_locked');
  });

  it('une licence se fait en trois années : inscription, séances, examen, diplôme', async () => {
    const before = (await prisma.wallet.findFirstOrThrow({ where: { characterId: character } })).balance;
    await study.enroll(account, { kind: 'LICENCE', domain: 'informatique' });
    const paid = before - (await prisma.wallet.findFirstOrThrow({ where: { characterId: character } })).balance;
    expect(paid).toBe(150_000n);
    await expect(study.enroll(account, { kind: 'LICENCE', domain: 'btp' })).rejects.toThrow('already_studying');
    // examen avant les séances : refusé
    await expect(study.exam(account)).rejects.toThrow('sessions_left');
    // une seule séance par jour de jeu
    await study.attend(account, await answers(true));
    await expect(study.attend(account, 0)).rejects.toThrow('already_attended_today');
    await nextDay();
    await study.attend(account, await answers(true));
    await nextDay();
    await study.attend(account, await answers(true));
    expect((await study.exam(account)).result).toMatchObject({ passed: true, graduated: false, year: 2 });
    // année 2 : il faut repayer l'inscription avant les séances
    await nextDay();
    await expect(study.attend(account, 0)).rejects.toThrow('fee_unpaid');
    await study.register(account);
    await expect(study.register(account)).rejects.toThrow('already_paid');
    for (let i = 0; i < 3; i++) {
      await nextDay();
      await study.attend(account, await answers(true));
    }
    expect((await study.exam(account)).result).toMatchObject({ passed: true, year: 3 });
    await study.register(account);
    const res = await doYear(true);
    expect(res.result).toMatchObject({ passed: true, graduated: true, kind: 'LICENCE', domain: 'informatique' });
    expect(await prisma.diploma.count({ where: { characterId: character, kind: 'LICENCE', domain: 'informatique' } })).toBe(1);
    expect(await prisma.study.count({ where: { characterId: character } })).toBe(0);
  });

  it('la licence ouvre le métier de développeur (salarié : embauche, puis métier actif)', async () => {
    await expect(chars.takeJob(account, 'developpeur')).rejects.toThrow('job_needs_contract');
    await company.acceptOffer(account, 'job:developpeur');
    expect((await prisma.character.findUniqueOrThrow({ where: { id: character } })).jobId).toBe('developpeur');
  });

  it('un examen raté fait redoubler l’année', async () => {
    await study.enroll(account, { kind: 'MASTER', domain: 'informatique' });
    const res = await doYear(false);
    expect(res.result).toMatchObject({ passed: false, graduated: false });
    const s = (await study.state(account)).study!;
    expect(s).toMatchObject({ year: 1, paid: false, sessionsDone: 0 });
    await study.quit(account);
    expect((await study.state(account)).study).toBeNull();
  });
});
