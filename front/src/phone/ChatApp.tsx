import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import { live, useLive, type ChatMsg, type DmMsg, type GroupInfo } from '../lib/live';
import { useGame } from './ctx';
import { announceApp, announceText } from '../lib/announce';
import { errorText } from '../i18n';
import { fcfa, localName } from '../lib/format';
import { matches } from '../lib/search';
import { hideMsg, loadHiddenMsgs, loadPinnedDms, togglePinnedDm } from '../lib/prefs';
import { lookupRecipient } from '../api/endpoints';
import DmPanel from '../ui/DmPanel';
import GroupPanel from '../ui/GroupPanel';
import MsgActions from '../ui/MsgActions';

type Room = 'city' | 'place' | 'dm' | 'groups';
const REASONS = ['scam', 'real_money', 'insult', 'harassment', 'spam', 'other'] as const;
const MAX_LEN = 280;
const GROUP_GAP_MS = 5 * 60_000; // au-delà, un nouveau bloc de messages recommence avec le nom

/** Couleur d'avatar stable pour un même joueur (classe a0…a7). */
const tone = (id: string) => 'a' + ([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 8);
const initial = (name: string) => name.slice(0, 1).toUpperCase();
const dayKey = (at: number | string) => new Date(at).toDateString();
/** Emojis proposés par le bouton 😊 (insérés à la fin du message). */
const EMOJIS = ['😂', '😅', '😍', '🙏🏾', '👍🏾', '👋🏾', '🤝🏾', '🔥', '💯', '😎', '🤔', '😢', '😡', '🎉', '❤️', '💸', '🏍️', '🍲', '⚽',
  // Drapeaux d'Afrique de l'Ouest (Togo d'abord)
  '🇹🇬', '🇧🇯', '🇬🇭', '🇳🇬', '🇨🇮', '🇧🇫', '🇳🇪', '🇲🇱', '🇸🇳', '🇬🇳', '🇬🇼', '🇸🇱', '🇱🇷', '🇬🇲', '🇨🇻', '🇲🇷'];
/** Pseudo affiché d'un auteur : @pseudo s'il en a un, sinon son nom. */
const handle = (f: { name: string; username?: string | null }) => (f.username ? `@${f.username}` : f.name);
/** Découpe un texte pour mettre en valeur les @mentions (et celles qui me visent). */
function withMentions(text: string, mine: string | null | undefined) {
  const parts = text.split(/(@[\p{L}\p{N}_.-]{2,32})/u);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <b key={i} className={mine && p.slice(1).toLowerCase() === mine.toLowerCase() ? 'mention me' : 'mention'}>{p}</b>
    ) : (
      p
    ),
  );
}
/** Au plus un signal « écrit… » toutes les 2,5 s pendant la frappe. */
const TYPING_EVERY_MS = 2500;

/** Chat entre joueurs : salon de la ville et salon du lieu où l'on se trouve, avec signalement. */
export default function ChatApp() {
  const { t, i18n } = useTranslation();
  const { state, run, busy, catalog, openApp, me, toast } = useGame();
  const lv = useLive();
  const [room, setRoom] = useState<Room>('city');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [reporting, setReporting] = useState<ChatMsg | null>(null);
  /** Message auquel on répond, et liste des joueurs en ligne. */
  const [replyTo, setReplyTo] = useState<ChatMsg | null>(null);
  const [showOnline, setShowOnline] = useState(false);
  const [onlineQ, setOnlineQ] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Envoi en cours (propre au chat : le reste du jeu reste utilisable) et palette d'emojis ouverte. */
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const lastTyping = useRef(0);
  /** « @… » en cours de frappe à la fin du message : pseudos proposés (serveur + derniers à avoir parlé). */
  const mentionQ = /(?:^|\s)@([\p{L}\p{N}_.-]{0,20})$/u.exec(text)?.[1] ?? null;
  const [found, setFound] = useState<{ id: string; name: string; username: string; online?: boolean }[]>([]);
  useEffect(() => {
    if (mentionQ === null) return setFound([]);
    const id = window.setTimeout(() => {
      api<{ id: string; name: string; username: string; online: boolean }[]>(`/live/users?q=${encodeURIComponent(mentionQ)}`, { auth: true }).then(
        (r) => setFound(Array.isArray(r) ? r : []),
        () => undefined,
      );
    }, 180);
    return () => window.clearTimeout(id);
  }, [mentionQ]);
  const [peer, setPeer] = useState<{ id: string; name: string } | null>(null);
  /** Le panneau privé s'ouvre directement sur l'envoi d'argent (bouton 💸). */
  const [peerMoney, setPeerMoney] = useState(false);
  const openPeer = (p: { id: string; name: string }, money = false) => (setPeerMoney(money), setPeer(p));
  const closePeer = () => (setPeer(null), setPeerMoney(false));
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [groupUser, setGroupUser] = useState('');
  const [groupErr, setGroupErr] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string[]>(() => loadPinnedDms(state.id));
  /** Message touché (barre d'actions), messages masqués pour moi, recherche et filtre de la liste privée. */
  const [sel, setSel] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>(() => loadHiddenMsgs(state.id));
  const [dmQuery, setDmQuery] = useState('');
  const [dmFilter, setDmFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [newUser, setNewUser] = useState('');
  const [newUserErr, setNewUserErr] = useState<string | null>(null);
  const startDm = async (ev: FormEvent) => {
    ev.preventDefault();
    setNewUserErr(null);
    const un = newUser.trim().replace(/^@/, '');
    if (!un) return;
    try {
      const r = await lookupRecipient(un);
      setPeer({ id: r.characterId, name: r.name });
      setNewUser('');
    } catch (e) {
      setNewUserErr(errorText(e instanceof ApiError ? e.code : 'unknown'));
    }
  };

  // Mes groupes : chargés une fois, puis tenus à jour par le flux temps réel
  useEffect(() => {
    void run(() => api<GroupInfo[]>('/live/groups', { auth: true })).then((r) => r && live.setGroups(r));
  }, [run]);

  useEffect(() => {
    if (room === 'dm' || room === 'groups') return;
    let off = false;
    void run(() => api<{ room: string; messages: ChatMsg[]; typing?: { id: string; name: string; username: string | null }[] }>(`/live/chat?room=${room}`, { auth: true })).then((r) => {
      if (!r || off) return;
      live.seed(r.room, r.messages);
      live.setTyping(r.room, r.typing);
      setRoomId(r.room);
    });
    // Flux continu coupé (hébergement) : cette conversation reste actualisée par requêtes régulières
    const unwatch = live.watchRoom(room);
    return () => {
      off = true;
      unwatch();
    };
  }, [room, state.location, run]);

  const messages = (roomId && room !== 'groups' ? (lv.chat[roomId] ?? []) : []).filter((m) => !hidden.includes(m.id));
  useEffect(() => {
    live.markRead();
    // Défile la liste elle-même (pas la page) : le dernier message reste visible au-dessus de la zone de saisie
    const log = end.current?.parentElement;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages.length]);

  /** Envoie le message tapé, ou une réponse rapide (`preset`). N'utilise pas l'état « occupé » global : rien d'autre ne se grise. */
  async function send(ev?: FormEvent, preset?: string) {
    ev?.preventDefault();
    const v = (preset ?? text).trim();
    if (!v || sending || room === 'dm' || room === 'groups') return;
    setSending(true);
    try {
      const r = await live.post<ChatMsg>('/live/chat', { room, text: v, replyTo: replyTo?.id });
      live.sent(r);
      if (preset === undefined) setText('');
      setReplyTo(null);
      setEmojiOpen(false);
    } catch (e) {
      toast(errorText(e instanceof ApiError ? e.code : 'unknown'), 'error');
    } finally {
      setSending(false);
    }
  }
  /** Signale aux autres que j'écris (au plus toutes les 2,5 s ; un échec est sans importance). */
  const pingTyping = () => {
    if (!me.username || (room !== 'city' && room !== 'place')) return;
    const now = Date.now();
    if (now - lastTyping.current < TYPING_EVERY_MS) return;
    lastTyping.current = now;
    void api('/live/typing', { method: 'POST', body: { room }, auth: true }).catch(() => undefined);
  };
  /** Remplace le « @… » en cours par le pseudo choisi. */
  const pickMention = (username: string) => {
    setText((c) => c.replace(/@[\p{L}\p{N}_.-]{0,20}$/u, `@${username} `));
    setFound([]);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };
  /** Ajoute un morceau (mention, emoji) à la fin du message et redonne la main au champ. */
  const insert = (piece: string) => {
    setText((c) => (c && !c.endsWith(' ') ? `${c} ` : c) + piece);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const dayLabel = (at: number | string) => {
    const d = new Date(at);
    const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
    if (days === 0) return t('chat.today');
    if (days === 1) return t('chat.yesterday');
    return d.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' });
  };
  const unreadTotal = Object.values(lv.dmUnread).reduce((a, b) => a + b, 0);
  const groupUnreadTotal = Object.values(lv.groupUnread).reduce((a, b) => a + b, 0);
  const openGroup = lv.groups?.find((g) => g.id === openGroupId) ?? null;

  /** Personnes que l'on peut proposer pour un groupe : joueurs en ligne et contacts d'une conversation privée. */
  const suggestions = (() => {
    const m = new Map<string, string>();
    for (const p of lv.players) if (p.id !== state.id) m.set(p.id, p.name);
    for (const [id, msgs] of Object.entries(lv.dms)) {
      const last = msgs[msgs.length - 1];
      if (last && id !== state.id) m.set(id, (last.from.id === id ? last.from.name : last.to?.name) ?? m.get(id) ?? '?');
    }
    for (const [id, name] of Object.entries(picked)) m.set(id, name);
    return [...m];
  })();
  const togglePick = (id: string, name: string) =>
    setPicked((c) => {
      const n = { ...c };
      if (n[id]) delete n[id];
      else n[id] = name;
      return n;
    });
  const addByUsername = async (ev: FormEvent) => {
    ev.preventDefault();
    setGroupErr(null);
    const un = groupUser.trim().replace(/^@/, '');
    if (!un) return;
    try {
      const r = await lookupRecipient(un);
      setPicked((c) => ({ ...c, [r.characterId]: r.name }));
      setGroupUser('');
    } catch (e) {
      setGroupErr(errorText(e instanceof ApiError ? e.code : 'unknown'));
    }
  };
  const createGroup = async (ev: FormEvent) => {
    ev.preventDefault();
    const r = await run(() => api<GroupInfo>('/live/groups', { method: 'POST', body: { name: groupName.trim(), members: Object.keys(picked) }, auth: true }), () => t('groups.created'));
    if (r) {
      live.upsertGroup(r);
      setGroupName('');
      setPicked({});
      setCreating(false);
      setOpenGroupId(r.id);
    }
  };
  const place = catalog?.venues.find((v) => v.id === state.location);
  const placeName = place ? (i18n.language === 'en' ? place.nameEn : place.nameFr) : t('chat.home');

  // Page « Qui est en ligne » : écran à part, avec retour vers le chat
  if (showOnline && (lv.connected || lv.polling || lv.online > 0)) {
    // Liste complète des joueurs en ligne si le serveur la donne (mode de secours), sinon les joueurs vus sur la carte
    const source = lv.roster.length > 0 ? lv.roster : lv.players;
    const others = source.filter((p) => p.id !== state.id && matches(onlineQ, p.name));
    return (
      <section className="chat chat-page">
        <header className="chat-page-head">
          <button type="button" className="btn small ghost chat-page-back" onClick={() => setShowOnline(false)} aria-label={t('app.back')}>←</button>
          <div className="chat-page-title">
            <h3>👥 {t('chat.whoOnline')}</h3>
            <span className="chat-page-count">{t('chat.online', { n: lv.online })}</span>
          </div>
        </header>
        <input className="chat-page-search" type="search" value={onlineQ} onChange={(e) => setOnlineQ(e.target.value)} placeholder={t('chat.searchPlayer')} aria-label={t('chat.searchPlayer')} autoComplete="off" />
        {others.length === 0 ? (
          <p className="chat-empty"><span aria-hidden="true">👋</span>{t('chat.noOneElse')}</p>
        ) : (
          <ul className="chat-online-list">
            {others.map((p) => {
              const v = catalog?.venues.find((x) => x.id === p.place);
              return (
                <li key={p.id}>
                  <span className={`avatar ${tone(p.id)}`} aria-hidden="true">{initial(p.name)}<i className="presence" /></span>
                  <span className="chat-online-name"><strong>{p.name}</strong><small>{v ? localName(v, i18n.language) : t('chat.home')}</small></span>
                  <button type="button" className="btn small" onClick={() => openPeer({ id: p.id, name: p.name })} aria-label={t('chat.writeTo', { name: p.name })}>💬</button>
                  <button type="button" className="btn small" onClick={() => openPeer({ id: p.id, name: p.name }, true)} aria-label={t('dm.sendMoney', { name: p.name })} title={t('dm.sendMoney', { name: p.name })}>💸</button>
                </li>
              );
            })}
          </ul>
        )}
        {peer && <DmPanel peer={peer} startMoney={peerMoney} onClose={closePeer} />}
      </section>
    );
  }

  return (
    <section className="chat">
      <div className={lv.connected ? 'chat-status on' : lv.polling ? 'chat-status on slow' : 'chat-status'} role="status">
        <span className="dot" aria-hidden="true" />
        <span className="chat-status-text">{lv.connected || lv.online > 0 ? t('chat.online', { n: lv.online }) : lv.polling ? t('chat.polling') : t('chat.offline')}</span>
        {lv.connected || lv.polling || lv.online > 0 ? (
          <button type="button" className="chat-online-btn" onClick={() => setShowOnline(true)}>
            👥 {t('chat.whoOnline')}
          </button>
        ) : (
          <button type="button" className="chat-online-btn" onClick={() => live.retry()}>↻ {t('chat.retry')}</button>
        )}
      </div>
      <div className="chat-tabs wrap4" role="tablist">
        <button role="tab" aria-selected={room === 'city'} className={room === 'city' ? 'chat-tab active' : 'chat-tab'} onClick={() => setRoom('city')}>🏙️ {t('chat.city')}</button>
        <button role="tab" aria-selected={room === 'place'} className={room === 'place' ? 'chat-tab active' : 'chat-tab'} onClick={() => setRoom('place')}>📍 <span className="ellipsis">{placeName}</span></button>
        <button role="tab" aria-selected={room === 'dm'} className={room === 'dm' ? 'chat-tab active' : 'chat-tab'} onClick={() => setRoom('dm')}>
          💬 {t('chat.private')}
          {unreadTotal > 0 && <span className="badge-unread">{unreadTotal}</span>}
        </button>
        <button role="tab" aria-selected={room === 'groups'} className={room === 'groups' ? 'chat-tab active' : 'chat-tab'} onClick={() => setRoom('groups')}>
          👥 {t('groups.tab')}
          {groupUnreadTotal > 0 && <span className="badge-unread">{groupUnreadTotal}</span>}
        </button>
      </div>
      {room === 'groups' && (
        <div className="groups-tab">
          {!creating ? (
            <button type="button" className="btn primary big" onClick={() => setCreating(true)}>➕ {t('groups.new')}</button>
          ) : (
            <form className="panel group-create" onSubmit={(e) => void createGroup(e)}>
              <label className="field">
                <span>{t('groups.name')}</span>
                <input value={groupName} onChange={(e) => setGroupName(e.target.value)} maxLength={40} placeholder={t('groups.namePlaceholder')} />
              </label>
              <span className="field-label">{t('groups.pickMembers')}</span>
              {suggestions.length === 0 && <small className="muted">{t('groups.noSuggestions')}</small>}
              <div className="chips group-picks">
                {suggestions.map(([id, name]) => (
                  <button key={id} type="button" className={picked[id] ? 'chip-act on' : 'chip-act'} aria-pressed={!!picked[id]} onClick={() => togglePick(id, name)}>
                    {picked[id] ? '✓ ' : ''}{name}
                  </button>
                ))}
              </div>
              <div className="dm-start">
                <input value={groupUser} onChange={(e) => (setGroupUser(e.target.value), setGroupErr(null))} placeholder={t('groups.addPlaceholder')} aria-label={t('groups.addPlaceholder')} maxLength={20} onKeyDown={(e) => e.key === 'Enter' && void addByUsername(e)} />
                <button type="button" className="btn small" disabled={busy || !groupUser.trim()} onClick={(e) => void addByUsername(e)}>{t('groups.add')}</button>
              </div>
              {groupErr && <small className="error">{groupErr}</small>}
              <div className="row group-create-actions">
                <button type="button" className="btn ghost" onClick={() => setCreating(false)}>{t('app.cancel')}</button>
                <button className="btn primary" disabled={busy || !groupName.trim()}>{t('groups.create', { n: Object.keys(picked).length + 1 })}</button>
              </div>
            </form>
          )}
          <ul className="dm-people">
            {lv.groups === null && <li className="muted chat-empty">{t('app.loading')}</li>}
            {lv.groups?.length === 0 && !creating && <li className="chat-empty"><span aria-hidden="true">👥</span>{t('groups.none')}</li>}
            {lv.groups?.map((g) => {
              const last = (lv.chat[`group:${g.id}`] ?? []).at(-1);
              const unread = lv.groupUnread[g.id] ?? 0;
              return (
                <li key={g.id} className="dm-li">
                  <button className={unread > 0 ? 'dm-row unread' : 'dm-row'} onClick={() => setOpenGroupId(g.id)}>
                    <span className="avatar a0" aria-hidden="true">👥</span>
                    <span className="dm-row-text">
                      <strong>{g.name}</strong>
                      <small>{last ? `${last.from.id === state.id ? `${t('chat.me')} : ` : `${last.from.name} : `}${last.text}` : t('groups.members', { n: g.members.length })}</small>
                    </span>
                    {last && <time>{new Date(last.at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}</time>}
                    {unread > 0 && <span className="badge-unread">{unread}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {room === 'dm' && (
        <>
          <form className="dm-start" onSubmit={(e) => void startDm(e)}>
            <input value={newUser} onChange={(e) => (setNewUser(e.target.value), setNewUserErr(null))} placeholder={t('chat.dmStartPlaceholder')} aria-label={t('chat.dmStartPlaceholder')} maxLength={20} />
            <button className="btn small" disabled={busy || !newUser.trim()}>{t('chat.dmStart')}</button>
          </form>
          {newUserErr && <small className="error">{newUserErr}</small>}
          <input className="chat-page-search" type="search" value={dmQuery} onChange={(e) => setDmQuery(e.target.value)} placeholder={t('chat.searchChats')} aria-label={t('chat.searchChats')} autoComplete="off" />
          <div className="chips" role="group">
            {(['all', 'unread', 'read'] as const).map((f) => (
              <button key={f} type="button" className={`chip-act ${dmFilter === f ? 'app' : ''}`} aria-pressed={dmFilter === f} onClick={() => setDmFilter(f)}>
                {t(`chat.filter${f === 'all' ? 'All' : f === 'unread' ? 'Unread' : 'Read'}`)}
              </button>
            ))}
          </div>
          <ul className="dm-people">
            {(() => {
              // Joueurs en ligne + personnes avec qui une conversation est ouverte : aucune distance requise
              const people = new Map<string, { name: string; online: boolean; last?: DmMsg }>();
              for (const p of lv.players) if (p.id !== state.id) people.set(p.id, { name: p.name, online: true });
              for (const [id, msgs] of Object.entries(lv.dms)) {
                const m = msgs[msgs.length - 1];
                if (!m) continue;
                const known = people.get(id);
                people.set(id, { name: known?.name ?? ((m.from.id === id ? m.from.name : m.to?.name) ?? '?'), online: known?.online ?? false, last: m });
              }
              if (people.size === 0) return <li className="chat-empty"><span aria-hidden="true">💬</span>{t('chat.privateEmpty')}</li>;
              // Épinglés d'abord, puis non lus, puis conversation la plus récente, puis joueurs en ligne
              const rank = (id: string, v: { last?: DmMsg }) => (pinned.includes(id) ? 1e30 : 0) + (lv.dmUnread[id] ?? 0) * 1e15 + (v.last ? new Date(v.last.at).getTime() : 0);
              const shown = [...people].filter(([id, v]) => matches(dmQuery, v.name) && (dmFilter === 'all' || (dmFilter === 'unread' ? (lv.dmUnread[id] ?? 0) > 0 : (lv.dmUnread[id] ?? 0) === 0)));
              if (shown.length === 0) return <li className="chat-empty"><span aria-hidden="true">🔍</span>{t('chat.noMatch')}</li>;
              return shown
                .sort((a, b) => rank(b[0], b[1]) - rank(a[0], a[1]))
                .map(([id, v]) => {
                  const unread = lv.dmUnread[id] ?? 0;
                  const isPinned = pinned.includes(id);
                  return (
                    <li key={id} className="dm-li">
                      <button className={unread > 0 ? 'dm-row unread' : 'dm-row'} onClick={() => openPeer({ id, name: v.name })}>
                        <span className={`avatar ${tone(id)}`} aria-hidden="true">
                          {initial(v.name)}
                          {v.online && <i className="presence" />}
                        </span>
                        <span className="dm-row-text">
                          <strong>{v.name}</strong>
                          <small>{v.last ? `${v.last.from.id === state.id ? `${t('chat.me')} : ` : ''}${v.last.money ? `💸 ${fcfa(v.last.money)}` : v.last.text}` : t('chat.sayHi')}</small>
                        </span>
                        {v.last && <time>{new Date(v.last.at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}</time>}
                        {unread > 0 && <span className="badge-unread">{unread}</span>}
                      </button>
                      <button type="button" className={isPinned ? 'dm-pin on' : 'dm-pin'} aria-pressed={isPinned} aria-label={t(isPinned ? 'chat.unpin' : 'chat.pin')} title={t(isPinned ? 'chat.unpin' : 'chat.pin')} onClick={() => setPinned(togglePinnedDm(state.id, id))}>
                        {isPinned ? '★' : '☆'}
                      </button>
                    </li>
                  );
                });
            })()}
          </ul>
        </>
      )}
      {openGroup && <GroupPanel group={openGroup} onClose={() => setOpenGroupId(null)} onPeer={openPeer} />}
      {peer && <DmPanel peer={peer} startMoney={peerMoney} onClose={closePeer} />}
      {room === 'city' && lv.announces.length > 0 && (
        <div className="announces">
          {lv.announces.slice(0, 5).map((a) => (
            <button key={a.at + a.kind} className="announce" onClick={() => openApp(announceApp(a))}>
              📣 {announceText(a, t, i18n.language, (id) => { const v = catalog?.venues.find((x) => x.id === id); return v ? localName(v, i18n.language) : id; })}
            </button>
          ))}
        </div>
      )}
      {room !== 'dm' && room !== 'groups' && <div className="chat-log" aria-live="polite">
        {messages.length === 0 && <p className="chat-empty"><span aria-hidden="true">👋</span>{t('chat.empty')}</p>}
        {messages.map((m, i) => {
          const mine = m.from.id === state.id;
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const newDay = !prev || dayKey(prev.at) !== dayKey(m.at);
          // Messages du même joueur rapprochés dans le temps : un seul nom, un seul avatar, une seule heure
          const sameAsPrev = !!prev && !newDay && prev.from.id === m.from.id && +new Date(m.at) - +new Date(prev.at) < GROUP_GAP_MS;
          const sameAsNext = !!next && dayKey(next.at) === dayKey(m.at) && next.from.id === m.from.id && +new Date(next.at) - +new Date(m.at) < GROUP_GAP_MS;
          return (
            <Fragment key={m.id}>
              {newDay && <div className="chat-day"><span>{dayLabel(m.at)}</span></div>}
              <div id={`msg-${m.id}`} className={`chat-row${mine ? ' mine' : ''}${sameAsPrev ? ' cont' : ''}`}>
                {!mine && (sameAsNext ? <span className="avatar-gap" /> : <span className={`avatar sm ${tone(m.from.id)}`} aria-hidden="true">{initial(m.from.name)}</span>)}
                <div className="chat-bubble-wrap">
                  {!mine && !sameAsPrev && (
                    <span className="chat-name-line">
                      <button type="button" className={`chat-name ${tone(m.from.id)}`} onClick={() => insert(m.from.username ? `@${m.from.username} ` : `${m.from.name} `)} title={t('chat.mention', { name: handle(m.from) })}>
                        {handle(m.from)}
                      </button>
                      {m.from.username && <small>· {m.from.name}</small>}
                    </span>
                  )}
                  <div className={sel === m.id ? 'chat-bubble sel' : 'chat-bubble'} onClick={() => setSel((c) => (c === m.id ? null : m.id))}>
                    {m.replyTo && (
                      <button
                        type="button"
                        className="chat-quote"
                        onClick={(e) => {
                          e.stopPropagation();
                          const el = document.getElementById(`msg-${m.replyTo!.id}`);
                          el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                          el?.classList.add('flash');
                          window.setTimeout(() => el?.classList.remove('flash'), 1400);
                        }}
                      >
                        <b>{m.replyTo.name}</b>
                        <span>{m.replyTo.text}</span>
                      </button>
                    )}
                    <p>{withMentions(m.text, me.username)}</p>
                    {!sameAsNext && <time>{new Date(m.at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}</time>}
                  </div>
                  {sel === m.id && <MsgActions text={m.text} onReply={() => setReplyTo(m)} onHide={() => setHidden(hideMsg(state.id, m.id))} onReport={mine ? undefined : () => setReporting(m)} onDone={() => setSel(null)} />}
                </div>
              </div>
            </Fragment>
          );
        })}
        <div ref={end} />
      </div>}
      {reporting && (
        <div className="panel">
          <strong>{t('chat.reportTitle', { name: reporting.from.name })}</strong>
          <p className="muted">« {reporting.text} »</p>
          <div className="choices">
            {REASONS.map((r) => (
              <button
                key={r}
                className="choice"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => api<{ hidden: boolean }>('/live/report', { method: 'POST', body: { targetId: reporting.from.id, messageId: reporting.id, reason: r }, auth: true }),
                    () => t('chat.reported'),
                  ).then(() => setReporting(null))
                }
              >
                {t(`chat.reasons.${r}`)}
              </button>
            ))}
          </div>
          <button className="btn ghost small" onClick={() => setReporting(null)}>{t('app.cancel')}</button>
        </div>
      )}
      {room !== 'dm' && room !== 'groups' && replyTo && (
        <div className="chat-replybar" role="status">
          <span className="chat-replybar-text"><b>{t('chat.replyingTo', { name: replyTo.from.name })}</b><small>{replyTo.text}</small></span>
          <button type="button" className="chat-replybar-x" onClick={() => setReplyTo(null)} aria-label={t('chat.cancelReply')}>✕</button>
        </div>
      )}
      {room !== 'dm' && room !== 'groups' && (() => {
        const who = roomId ? (lv.typing[roomId] ?? []) : [];
        if (who.length === 0) return null;
        const label = who.length === 1 ? t('chat.typingOne', { name: handle(who[0]!) }) : who.length === 2 ? t('chat.typingTwo', { a: handle(who[0]!), b: handle(who[1]!) }) : t('chat.typingMany', { n: who.length });
        return (
          <div className="chat-typing" role="status">
            <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
            <span>{label}</span>
          </div>
        );
      })()}
      {room !== 'dm' && room !== 'groups' && (
        <div
          className="chat-quick"
          role="group"
          aria-label={t('chat.quickTitle')}
          // Molette verticale de la souris → défilement horizontal ; glisser avec la souris fait défiler aussi
          onWheel={(e) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
          }}
          onPointerDown={(e) => {
            if (e.pointerType !== 'mouse') return;
            const el = e.currentTarget;
            const x0 = e.clientX;
            const s0 = el.scrollLeft;
            let moved = false;
            const move = (ev: PointerEvent) => {
              if (Math.abs(ev.clientX - x0) > 4) moved = true;
              el.scrollLeft = s0 - (ev.clientX - x0);
            };
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
              // Un glissé ne doit pas envoyer la réponse sous le curseur
              if (moved) el.addEventListener('click', (ev) => (ev.stopPropagation(), ev.preventDefault()), { capture: true, once: true });
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
        >
          {(t('chat.quick', { returnObjects: true }) as string[]).map((q) => (
            <button key={q} type="button" className="chat-quick-btn" disabled={sending} onClick={() => void send(undefined, q)}>{q}</button>
          ))}
        </div>
      )}
      {room !== 'dm' && room !== 'groups' && mentionQ !== null && (() => {
        // Derniers à avoir parlé ici (correspondant au début tapé), puis résultats du serveur, sans doublon
        const lq = mentionQ.toLowerCase();
        const list = new Map<string, { id: string; name: string; username: string; online?: boolean }>();
        for (let i = messages.length - 1; i >= 0 && list.size < 4; i--) {
          const f = messages[i]!.from;
          if (f.id !== state.id && f.username && f.username.toLowerCase().startsWith(lq) && !list.has(f.id)) list.set(f.id, { id: f.id, name: f.name, username: f.username });
        }
        for (const u of found) if (!list.has(u.id)) list.set(u.id, u);
        const items = [...list.values()].slice(0, 8);
        if (items.length === 0) return null;
        return (
          <ul className="chat-suggest" role="listbox" aria-label={t('chat.suggest')}>
            {items.map((u) => (
              <li key={u.id}>
                <button type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => pickMention(u.username)}>
                  <span className={`avatar xs ${tone(u.id)}`} aria-hidden="true">{initial(u.name)}{u.online && <i className="presence" />}</span>
                  <strong>@{u.username}</strong>
                  <small>{u.name}</small>
                </button>
              </li>
            ))}
          </ul>
        );
      })()}
      {room !== 'dm' && room !== 'groups' && emojiOpen && (
        <div className="chat-emojis" role="group" aria-label={t('chat.emoji')}>
          {EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => insert(e)}>{e}</button>
          ))}
        </div>
      )}
      {room !== 'dm' && room !== 'groups' && <form className="chat-form" onSubmit={send}>
        <button type="button" className={emojiOpen ? 'chat-emoji-btn on' : 'chat-emoji-btn'} aria-pressed={emojiOpen} aria-label={t('chat.emoji')} title={t('chat.emoji')} onClick={() => setEmojiOpen((v) => !v)}>😊</button>
        <div className="chat-input">
          <input ref={inputRef} value={text} onChange={(e) => (setText(e.target.value), e.target.value.trim() && pingTyping())} maxLength={MAX_LEN} placeholder={t('chat.placeholder')} aria-label={t('chat.placeholder')} enterKeyHint="send" autoComplete="off" />
          {text.length >= MAX_LEN - 40 && <small className="chat-count">{MAX_LEN - text.length}</small>}
        </div>
        <button className="chat-send" disabled={sending || !text.trim()} aria-label={t('chat.send')} title={t('chat.send')}>➤</button>
      </form>}
      <details className="chat-rules">
        <summary>{t('chat.rulesTitle')}</summary>
        <p>{t('chat.rules')}</p>
      </details>
    </section>
  );
}
