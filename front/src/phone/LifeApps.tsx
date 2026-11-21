import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fcfa, localName } from '../lib/format';
import { distanceMeters, estimateFare } from '../lib/transport';
import { useGame, type AppId } from './ctx';

const HOME = 'home';

/** Messages : ce que te disent ton propriétaire, ton patron, tes professeurs… selon ta situation. */
export function MessagesApp() {
  const { t, i18n } = useTranslation();
  const { state, openApp } = useGame();
  const msgs: { from: string; icon: string; text: string; app?: AppId }[] = [];
  if (state.rent.overdue) msgs.push({ from: t('contacts.landlord'), icon: '🏠', text: t('messages.rentLate'), app: 'rent' });
  else if (!state.rent.owned && state.rent.paidUntilGameDay - state.gameTime.day <= 3) msgs.push({ from: t('contacts.landlord'), icon: '🏠', text: t('messages.rentSoon'), app: 'rent' });
  if (state.job && state.nextWorkInGameHours <= 0) msgs.push({ from: t('contacts.boss'), icon: '💼', text: t('messages.work', { job: localName(state.job, i18n.language) }), app: 'work' });
  if (!state.job) msgs.push({ from: t('contacts.friend'), icon: '🧑🏾', text: t('messages.noJob'), app: 'work' });
  if (state.needs.health < 40) msgs.push({ from: t('contacts.chu'), icon: '🏥', text: t('messages.health'), app: 'health' });
  if (state.needs.energy < 25) msgs.push({ from: t('contacts.mom'), icon: '👩🏾', text: t('messages.tired'), app: 'rest' });
  if (state.needs.hunger < 25) msgs.push({ from: t('contacts.mom'), icon: '👩🏾', text: t('messages.hungry'), app: 'eat' });
  if (state.company) msgs.push({ from: t('contacts.accountant'), icon: '🧮', text: t('messages.company', { name: state.company.name }), app: 'company' });
  msgs.push({ from: 'AGBE', icon: '🇹🇬', text: t('messages.welcome', { name: state.name }), app: 'guide' });
  return (
    <section>
      <ul className="list stacked">
        {msgs.map((m, i) => (
          <li key={i} className="item">
            <div className="item-main">
              <strong>
                {m.icon} {m.from}
              </strong>
              <small>{m.text}</small>
            </div>
            {m.app && <button className="btn small" onClick={() => openApp(m.app!)}>{t('messages.reply')}</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Contacts : les personnes utiles de ta vie à Lomé. */
export function ContactsApp() {
  const { t } = useTranslation();
  const { openApp, goTo } = useGame();
  const list: { key: string; icon: string; app?: AppId; venue?: string }[] = [
    { key: 'landlord', icon: '🏠', app: 'rent' },
    { key: 'boss', icon: '💼', app: 'work' },
    { key: 'teacher', icon: '🎓', app: 'study' },
    { key: 'builder', icon: '🏗️', app: 'estate' },
    { key: 'chu', icon: '🏥', venue: 'chu' },
    { key: 'momo', icon: '💳', app: 'wallet' },
    { key: 'zem', icon: '🛵', app: 'ride' },
    { key: 'accountant', icon: '🧮', app: 'company' },
    { key: 'mom', icon: '👩🏾', app: 'messages' },
  ];
  return (
    <section>
      <ul className="list stacked">
        {list.map((c) => (
          <li key={c.key} className="item">
            <div className="item-main">
              <strong>
                {c.icon} {t(`contacts.${c.key}`)}
              </strong>
              <small className="muted">{t(`contacts.about.${c.key}`)}</small>
            </div>
            <button className="btn small" onClick={() => (c.app ? openApp(c.app) : goTo(c.venue!))}>📞 {t('contacts.call')}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const GUIDE = ['start', 'win', 'controls', 'needs', 'respect', 'money', 'work', 'zem', 'study', 'school', 'move', 'map', 'health', 'worship', 'home', 'kitchen', 'clothes', 'vip', 'currency', 'land', 'sea', 'decor', 'weather', 'trade', 'notifs', 'traffic', 'bills', 'bank', 'company', 'industry', 'fuel', 'grow', 'guest', 'account', 'safety'];

/** Aide et guide : comment jouer. */
export function GuideApp() {
  const { t } = useTranslation();
  const { state } = useGame();
  const [open, setOpen] = useState<string | null>('start');
  // Objectifs de vie : le jeu n'a pas de fin, on « gagne » en accomplissant ces étapes (affichage seul)
  const goals: [string, boolean][] = [
    ['job', !!state.job],
    ['respect', state.needs.respect >= 50],
    ['bills', !state.rent.overdue && !state.bills.ELEC.overdue && !state.bills.WATER.overdue],
    ['million', BigInt(state.wallet.balance) >= 1_000_000n],
    ['company', !!state.company],
    ['owner', state.rent.owned],
  ];
  const done = goals.filter(([, ok]) => ok).length;
  return (
    <section>
      <div className="panel">
        <strong>🏆 {t('guide.goals.title', { done, total: goals.length })}</strong>
        <ul className="goals">
          {goals.map(([k, ok]) => (
            <li key={k} className={ok ? 'ok' : 'muted'}>
              {ok ? '✅' : '⬜'} {t(`guide.goals.${k}`)}
            </li>
          ))}
        </ul>
        {done === goals.length && <p className="ok">{t('guide.goals.allDone')}</p>}
      </div>
      {GUIDE.map((k) => (
        <div key={k} className="panel">
          <button className="guide-head" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}>
            {t(`guide.${k}.title`)} <span aria-hidden="true">{open === k ? '−' : '+'}</span>
          </button>
          {open === k && <p className="small-line">{t(`guide.${k}.text`)}</p>}
        </div>
      ))}
    </section>
  );
}

/** Course : lieux les plus proches avec le prix estimé du zém et du taxi ; « Commander » ouvre le trajet. */
export function RideApp() {
  const { t, i18n } = useTranslation();
  const { catalog, state, goTo } = useGame();
  const here = useMemo(() => {
    if (state.location === HOME) return state.homePos ?? catalog?.homePosition[state.housing] ?? { x: 0, z: 0 };
    return catalog?.venues.find((v) => v.id === state.location) ?? { x: 0, z: 0 };
  }, [catalog, state.location, state.homePos, state.housing]);
  if (!catalog) return <p className="muted">{t('app.loading')}</p>;
  // Seulement les lieux de la ville où l'on est : chaque ville a son propre plan, les coordonnées se chevauchent
  const city = state.city ?? 'lome';
  const rows = catalog.venues
    .filter((v) => v.id !== state.location && (v.city ?? 'lome') === city)
    .map((v) => ({ v, m: distanceMeters(here.x, here.z, v.x, v.z) }))
    .sort((a, b) => a.m - b.m);
  return (
    <section>
      <p className="muted small-line">{t('ride.intro')}</p>
      <ul className="ride-list">
        {rows.map(({ v, m }) => (
          <li key={v.id} className="ride-item">
            <strong>
              {v.emoji} {localName(v, i18n.language)}
            </strong>
            <span className="ride-meta">
              <span className="ride-pill dist">{(m / 1000).toLocaleString(i18n.language, { maximumFractionDigits: 1 })} km</span>
              <span className="ride-pill">🛵 {fcfa(estimateFare(m, catalog.transport.ZEM, state.economy?.transportBp))}</span>
              <span className="ride-pill">🚕 {fcfa(estimateFare(m, catalog.transport.WORO, state.economy?.transportBp))}</span>
            </span>
            <button className="btn primary small" onClick={() => goTo(v.id)}>{t('ride.order')}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- Awalé (jeu de semailles traditionnel) contre le téléphone ----------

type Board = number[]; // 12 cases : 0-5 joueur (gauche → droite), 6-11 téléphone

/** Sème depuis la case i (sens inverse des aiguilles), capture 2 ou 3 graines chez l'adversaire. Renvoie le plateau et les prises. */
function sow(b: Board, i: number, player: 0 | 1): { board: Board; taken: number } {
  const board = [...b];
  let seeds = board[i]!;
  board[i] = 0;
  let pos = i;
  while (seeds > 0) {
    pos = (pos + 1) % 12;
    if (pos === i) continue; // on saute la case de départ
    board[pos]!++;
    seeds--;
  }
  let taken = 0;
  const opp = (p: number) => (player === 0 ? p >= 6 : p < 6);
  while (opp(pos) && (board[pos] === 2 || board[pos] === 3)) {
    taken += board[pos]!;
    board[pos] = 0;
    pos = (pos + 11) % 12;
  }
  return { board, taken };
}

const movesOf = (b: Board, player: 0 | 1) => (player === 0 ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11]).filter((i) => b[i]! > 0);

export function GamesApp() {
  const { t } = useTranslation();
  const [board, setBoard] = useState<Board>(() => Array(12).fill(4));
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const [msg, setMsg] = useState<string>(t('games.yourTurn'));
  const over = score[0] > 24 || score[1] > 24 || movesOf(board, 0).length === 0;
  const play = (i: number) => {
    if (over || board[i] === 0) return;
    const me = sow(board, i, 0);
    let s: [number, number] = [score[0] + me.taken, score[1]];
    let b = me.board;
    // Le téléphone joue le coup qui prend le plus (à égalité, le premier)
    const ai = movesOf(b, 1);
    if (ai.length > 0 && s[0] <= 24) {
      const best = ai.map((j) => ({ j, r: sow(b, j, 1) })).sort((x, y) => y.r.taken - x.r.taken)[0]!;
      b = best.r.board;
      s = [s[0], s[1] + best.r.taken];
      setMsg(best.r.taken > 0 ? t('games.aiTook', { n: best.r.taken }) : t('games.yourTurn'));
    }
    setBoard(b);
    setScore(s);
  };
  const reset = () => {
    setBoard(Array(12).fill(4));
    setScore([0, 0]);
    setMsg(t('games.yourTurn'));
  };
  const result = score[0] > score[1] ? t('games.won') : score[0] < score[1] ? t('games.lost') : t('games.draw');
  return (
    <section>
      <div className="panel">
        <strong>🫘 {t('games.awale')}</strong>
        <small className="muted">{t('games.rules')}</small>
      </div>
      <div className="awale" role="group" aria-label={t('games.awale')}>
        <div className="awale-row">
          {[11, 10, 9, 8, 7, 6].map((i) => (
            <span key={i} className="pit ai">{board[i]}</span>
          ))}
        </div>
        <div className="awale-row">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <button key={i} className="pit" disabled={over || board[i] === 0} onClick={() => play(i)}>
              {board[i]}
            </button>
          ))}
        </div>
      </div>
      <p className="row-between">
        <b>{t('games.you', { n: score[0] })}</b>
        <b>{t('games.phone', { n: score[1] })}</b>
      </p>
      <p className="muted">{over ? result : msg}</p>
      <button className="btn" onClick={reset}>🔄 {t('games.restart')}</button>
    </section>
  );
}
