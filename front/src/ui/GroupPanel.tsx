import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import { lookupRecipient } from '../api/endpoints';
import { errorText } from '../i18n';
import { live, useLive, type ChatMsg, type GroupInfo } from '../lib/live';
import { useGame } from '../phone/ctx';
import { hideMsg, loadHiddenMsgs } from '../lib/prefs';
import MsgActions from './MsgActions';

const REASONS = ['scam', 'real_money', 'insult', 'harassment', 'spam', 'other'] as const;

/**
 * Groupe de discussion : messages en direct, liste des membres (écrire ou envoyer de l'argent à l'un d'eux),
 * ajout et retrait par le propriétaire, départ du groupe, signalement d'un message.
 */
export default function GroupPanel({ group, onClose, onPeer }: { group: GroupInfo; onClose: () => void; onPeer: (peer: { id: string; name: string }, money: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const { run, busy, state } = useGame();
  const lv = useLive();
  const room = `group:${group.id}`;
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMsg | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [reporting, setReporting] = useState<ChatMsg | null>(null);
  const [hidden, setHidden] = useState<string[]>(() => loadHiddenMsgs(state.id));
  const [sel, setSel] = useState<string | null>(null);
  const messages: ChatMsg[] = (lv.chat[room] ?? []).filter((m) => !hidden.includes(m.id));
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [newUser, setNewUser] = useState('');
  const [newUserErr, setNewUserErr] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const mine = group.ownerId === state.id;

  useEffect(() => {
    let off = false;
    void api<{ room: string; group: GroupInfo; messages: ChatMsg[] }>(`/live/groups/${group.id}/messages`, { auth: true })
      .then((r) => {
        if (off) return;
        live.seed(r.room, r.messages);
        live.upsertGroup(r.group);
      })
      .catch(() => undefined);
    const unwatch = live.watchRoom(room);
    return () => {
      off = true;
      unwatch();
    };
  }, [group.id, room]);
  useEffect(() => {
    live.markGroupRead(group.id);
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, group.id]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    const r = await run(() => live.post<ChatMsg>(`/live/groups/${group.id}/messages`, { text: v, replyTo: replyTo?.id }));
    if (r) {
      live.sent(r);
      setText('');
      setReplyTo(null);
    }
  };

  const addMember = async (e: FormEvent) => {
    e.preventDefault();
    setNewUserErr(null);
    const un = newUser.trim().replace(/^@/, '');
    if (!un) return;
    try {
      const who = await lookupRecipient(un);
      const r = await run(() => api<GroupInfo>(`/live/groups/${group.id}/members`, { method: 'POST', body: { characterId: who.characterId }, auth: true }), () => t('groups.added', { name: who.name }));
      if (r) {
        live.upsertGroup(r);
        setNewUser('');
      }
    } catch (err) {
      setNewUserErr(errorText(err instanceof ApiError ? err.code : 'unknown'));
    }
  };

  const remove = (memberId: string, leaving: boolean) =>
    run(
      () => api<{ ok: boolean }>(`/live/groups/${group.id}/members/${memberId}`, { method: 'DELETE', auth: true }),
      () => t(leaving ? 'groups.left' : 'groups.removed'),
    ).then((r) => {
      if (!r) return;
      if (leaving) {
        live.removeGroup(group.id);
        onClose();
      }
    });

  const time = (at: string) => new Date(at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dm-panel group-panel" role="dialog" aria-modal="true" aria-label={t('groups.title', { name: group.name })}>
        <header className="dm-head">
          <span className="dm-avatar group-avatar" aria-hidden="true">👥</span>
          <button type="button" className="group-title" onClick={() => setShowMembers((v) => !v)} aria-expanded={showMembers}>
            <h2>{group.name}</h2>
            <small>{t('groups.members', { n: group.members.length })} {showMembers ? '▴' : '▾'}</small>
          </button>
          <button className="btn ghost small" onClick={onClose} aria-label={t('app.close')}>✕</button>
        </header>

        {showMembers && (
          <div className="group-members">
            <ul>
              {group.members.map((m) => (
                <li key={m.id}>
                  <span className="group-member-name">
                    {m.name}
                    {m.id === group.ownerId && <em title={t('groups.owner')}> 👑</em>}
                    {m.id === state.id && <small className="muted"> · {t('chat.me')}</small>}
                  </span>
                  {m.id !== state.id && (
                    <>
                      <button type="button" className="btn small" onClick={() => onPeer({ id: m.id, name: m.name }, false)} aria-label={t('chat.writeTo', { name: m.name })} title={t('chat.writeTo', { name: m.name })}>💬</button>
                      <button type="button" className="btn small" onClick={() => onPeer({ id: m.id, name: m.name }, true)} aria-label={t('dm.sendMoney', { name: m.name })} title={t('dm.sendMoney', { name: m.name })}>💸</button>
                      {mine && (
                        <button type="button" className="btn ghost small" disabled={busy} onClick={() => void remove(m.id, false)} aria-label={t('groups.remove', { name: m.name })} title={t('groups.remove', { name: m.name })}>✕</button>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
            {mine && (
              <form className="dm-start" onSubmit={(e) => void addMember(e)}>
                <input value={newUser} onChange={(e) => (setNewUser(e.target.value), setNewUserErr(null))} placeholder={t('groups.addPlaceholder')} aria-label={t('groups.addPlaceholder')} maxLength={20} />
                <button className="btn small" disabled={busy || !newUser.trim()}>{t('groups.add')}</button>
              </form>
            )}
            {newUserErr && <small className="error">{newUserErr}</small>}
            {confirmLeave ? (
              <div className="row group-leave">
                <span>{t('groups.leaveConfirm')}</span>
                <button type="button" className="btn ghost small" onClick={() => setConfirmLeave(false)}>{t('app.cancel')}</button>
                <button type="button" className="btn small danger" disabled={busy} onClick={() => void remove(state.id, true)}>{t('groups.leave')}</button>
              </div>
            ) : (
              <button type="button" className="btn ghost small group-leave-btn" onClick={() => setConfirmLeave(true)}>🚪 {t('groups.leave')}</button>
            )}
          </div>
        )}

        <ul className="dm-list" ref={listRef}>
          {messages.length === 0 && <li className="muted dm-empty">{t('groups.empty')}</li>}
          {messages.map((m) => {
            const own = m.from.id === state.id;
            return (
              <li key={m.id} id={`dm-${m.id}`} className={`${own ? 'dm-msg mine' : 'dm-msg theirs'}${sel === m.id ? ' sel' : ''}`} onClick={() => setSel((c) => (c === m.id ? null : m.id))}>
                {!own && <b className="group-sender">{m.from.name}</b>}
                {m.replyTo && (
                  <button type="button" className="chat-quote" onClick={(e) => e.stopPropagation()} onClickCapture={() => document.getElementById(`dm-${m.replyTo!.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>
                    <b>{m.replyTo.name}</b>
                    <span>{m.replyTo.text}</span>
                  </button>
                )}
                <span>{m.text}</span>
                <time>{time(m.at)}</time>
                {sel === m.id && <MsgActions text={m.text} onReply={() => setReplyTo(m)} onHide={() => setHidden(hideMsg(state.id, m.id))} onReport={own ? undefined : () => setReporting(m)} onDone={() => setSel(null)} />}
              </li>
            );
          })}
        </ul>

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
        {replyTo && (
          <div className="chat-replybar" role="status">
            <span className="chat-replybar-text"><b>{t('chat.replyingTo', { name: replyTo.from.name })}</b><small>{replyTo.text}</small></span>
            <button type="button" className="chat-replybar-x" onClick={() => setReplyTo(null)} aria-label={t('chat.cancelReply')}>✕</button>
          </div>
        )}
        <form className="dm-form" onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={280} placeholder={t('dm.placeholder')} aria-label={t('dm.placeholder')} />
          <button className="btn primary" disabled={busy || !text.trim()}>{t('dm.send')}</button>
        </form>
      </div>
    </div>
  );
}
