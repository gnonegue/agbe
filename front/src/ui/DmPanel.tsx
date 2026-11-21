import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, idempotencyKey } from '../api/client';
import { transfer } from '../api/endpoints';
import { fcfa } from '../lib/format';
import { transferFee } from '../lib/fees';
import { live, useLive, type DmMsg } from '../lib/live';
import { useGame } from '../phone/ctx';
import { hideMsg, loadHiddenMsgs } from '../lib/prefs';
import MsgActions from './MsgActions';

/** Conversation privée avec un joueur croisé, et envoi d'argent (montant et frais décidés par le serveur). */
export default function DmPanel({ peer, onClose, startMoney = false }: { peer: { id: string; name: string }; onClose: () => void; /** Ouvre directement le formulaire d'envoi d'argent. */ startMoney?: boolean }) {
  const { t, i18n } = useTranslation();
  const { run, busy, catalog, state } = useGame();
  const lv = useLive();
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<DmMsg | null>(null);
  const [money, setMoney] = useState(startMoney);
  const [amountStr, setAmountStr] = useState('');
  const [pending, setPending] = useState<{ amount: number; fee: number; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [hidden, setHidden] = useState<string[]>(() => loadHiddenMsgs(state.id));
  const [sel, setSel] = useState<string | null>(null);
  const messages = (lv.dms[peer.id] ?? []).filter((m) => !hidden.includes(m.id));
  // Nombre de messages non lus à l'ouverture : un repère « Nouveaux messages » les précède
  const unreadAtOpen = useRef(lv.dmUnread[peer.id] ?? 0);
  const firstNew = unreadAtOpen.current > 0 ? messages.length - unreadAtOpen.current : -1;

  useEffect(() => {
    let off = false;
    void api<{ messages: DmMsg[] }>(`/live/dm?with=${encodeURIComponent(peer.id)}`, { auth: true })
      .then((r) => !off && live.seedDm(peer.id, r.messages))
      .catch(() => undefined);
    const unwatch = live.watchDm(peer.id);
    return () => {
      off = true;
      unwatch();
    };
  }, [peer.id]);
  useEffect(() => {
    live.markDmRead(peer.id);
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, peer.id]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    const r = await run(() => live.post<DmMsg>('/live/dm', { to: peer.id, text: v, replyTo: replyTo?.id }));
    if (r) {
      live.sent(r, peer.id);
      setText('');
      setReplyTo(null);
    }
  };

  const amount = Number(amountStr);
  const valid = Number.isInteger(amount) && amount > 0;
  const fee = valid && catalog ? transferFee(amount, catalog.transferFee) : null;
  const prepare = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!valid || fee === null) return setError(t('errors.invalid_amount'));
    if (BigInt(state.wallet.balance) < BigInt(amount + fee)) return setError(t('errors.insufficient_funds'));
    // Clé d'idempotence figée à la confirmation : un nouvel essai ne débite pas deux fois
    setPending({ amount, fee, key: idempotencyKey() });
  };
  const confirm = async () => {
    if (!pending) return;
    const r = await run(
      () => transfer(peer.id, pending.amount, undefined, pending.key),
      (res) => (res.result.replay ? null : t('wallet.sent', { amount: fcfa(res.result.amount), fee: fcfa(res.result.fee) })),
    );
    if (r) {
      setPending(null);
      setAmountStr('');
      setMoney(false);
    }
  };

  return (
    <div className="sheet-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dm-panel" role="dialog" aria-modal="true" aria-label={t('dm.title', { name: peer.name })}>
        <header className="dm-head">
          <span className="dm-avatar" aria-hidden="true">{peer.name.slice(0, 1).toUpperCase()}</span>
          <h2>{peer.name}</h2>
          <button className="btn small dm-head-money" onClick={() => setMoney(true)} aria-label={t('dm.sendMoney', { name: peer.name })} title={t('dm.sendMoney', { name: peer.name })}>💸</button>
          <button className="btn ghost small" onClick={onClose} aria-label={t('app.close')}>✕</button>
        </header>
        <ul className="dm-list" ref={listRef}>
          {messages.length === 0 && <li className="muted dm-empty">{t('dm.empty', { name: peer.name })}</li>}
          {messages.map((m, idx) => (
            m.money ? (
              <li key={m.id} id={`dm-${m.id}`} className="dm-money-note">
                <span aria-hidden="true">💸</span>
                <span>{t(m.from.id === peer.id ? 'dm.moneyIn' : 'dm.moneyOut', { name: peer.name, amount: fcfa(m.money) })}</span>
                <time>{new Date(m.at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}</time>
              </li>
            ) : (
            <Fragment key={m.id}>
            {idx === firstNew && firstNew >= 0 && <li className="chat-newline" aria-label={t('chat.newMessages')}><span>{t('chat.newMessages')}</span></li>}
            <li id={`dm-${m.id}`} className={`${m.from.id === peer.id ? 'dm-msg theirs' : 'dm-msg mine'}${sel === m.id ? ' sel' : ''}`} onClick={() => setSel((c) => (c === m.id ? null : m.id))}>
              {m.replyTo && (
                <button type="button" className="chat-quote" onClick={(e) => e.stopPropagation()} onClickCapture={() => document.getElementById(`dm-${m.replyTo!.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>
                  <b>{m.replyTo.name}</b>
                  <span>{m.replyTo.text}</span>
                </button>
              )}
              <span>{m.text}</span>
              <time>{new Date(m.at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}</time>
              {sel === m.id && <MsgActions text={m.text} onReply={() => setReplyTo(m)} onHide={() => setHidden(hideMsg(state.id, m.id))} onDone={() => setSel(null)} />}
            </li>
            </Fragment>
            )
          ))}
        </ul>
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
        {!money ? (
          <button className="btn ghost dm-money-btn" onClick={() => setMoney(true)}>💸 {t('dm.sendMoney', { name: peer.name })}</button>
        ) : pending ? (
          <div className="dm-money">
            <p>{t('dm.confirmMoney', { amount: fcfa(pending.amount), name: peer.name, fee: fcfa(pending.fee), total: fcfa(pending.amount + pending.fee) })}</p>
            <div className="row">
              <button className="btn ghost" onClick={() => setPending(null)}>{t('app.cancel')}</button>
              <button className="btn primary" disabled={busy} onClick={() => void confirm()}>{t('dm.confirm')}</button>
            </div>
          </div>
        ) : (
          <form className="dm-money" onSubmit={prepare}>
            <input inputMode="numeric" value={amountStr} onChange={(e) => setAmountStr(e.target.value.replace(/\D/g, ''))} placeholder={t('dm.amount')} aria-label={t('dm.amount')} />
            {fee !== null && <small className="muted">{t('dm.fee', { fee: fcfa(fee) })}</small>}
            {error && <small className="error">{error}</small>}
            <div className="row">
              <button type="button" className="btn ghost" onClick={() => setMoney(false)}>{t('app.cancel')}</button>
              <button className="btn primary" disabled={!valid}>{t('dm.next')}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
