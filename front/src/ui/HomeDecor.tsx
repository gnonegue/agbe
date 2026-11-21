import { useEffect, useMemo, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { giftFurniture, lookupRecipient, moveFurniture, placeFurniture, placeStoredFurniture, sellFurniture, storeFurniture, type FurnitureDef, type HomeFurnitureView } from '../api/endpoints';
import { errorText } from '../i18n';
import { ApiError } from '../api/client';
import type { FurnitureItem, InteriorHandle } from '../game/InteriorScene';
import { fcfa, localName } from '../lib/format';
import { useGame } from '../phone/ctx';
import { fold } from '../lib/search';

type Pending = { id: string; x: number; z: number; rot: number };

/** Meubles du joueur prêts à être posés dans la pièce (jointure avec le catalogue). */
export function furnitureItems(view: HomeFurnitureView | null, pending: Pending | null): FurnitureItem[] {
  if (!view) return [];
  const out: FurnitureItem[] = [];
  for (const i of view.items) {
    const def = view.catalog.find((c) => c.id === i.itemId);
    if (!def) continue;
    const p = pending && pending.id === i.id ? pending : i;
    out.push({ id: i.id, model: def.model, x: p.x, z: p.z, rot: p.rot, w: def.w, d: def.d, flat: def.flat });
  }
  return out;
}

/**
 * Aménager son logement : boutique de meubles (prix du serveur), puis réglage d'un meuble avec des flèches
 * (déplacer d'un pas de 0,5 m dans le sens de l'écran, tourner), validation, revente.
 */
export default function HomeDecor({ view, reload, room, selected, setSelected, pending, setPending, onClose }: {
  view: HomeFurnitureView | null;
  reload: () => Promise<void>;
  room: RefObject<InteriorHandle | null>;
  selected: string | null;
  setSelected: (id: string | null) => void;
  pending: Pending | null;
  setPending: (p: Pending | null) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { run, busy, state } = useGame();
  const [tab, setTab] = useState<'shop' | 'mine' | 'storage'>('shop');
  // Recherche par nom (sans accents ni majuscules), commune aux trois onglets
  const [query, setQuery] = useState('');
  /** Don en cours : meuble concerné, pseudo saisi et joueur trouvé. */
  const [gift, setGift] = useState<{ id: string; user: string; target: { id: string; name: string } | null } | null>(null);
  const [giftErr, setGiftErr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const balance = BigInt(state.wallet.balance);
  const def = (id: string): FurnitureDef | undefined => view?.catalog.find((c) => c.id === id);
  const q = fold(query.trim());
  const hit = (d: FurnitureDef | undefined, fallback = ''): boolean => !q || fold(d ? `${localName(d, i18n.language)} ${d.id}` : fallback).includes(q);
  const cur = useMemo(() => view?.items.find((i) => i.id === selected) ?? null, [view, selected]);
  const curDef = cur ? def(cur.itemId) : undefined;
  const at = cur && pending && pending.id === cur.id ? pending : cur;
  const ok = !!(at && curDef && room.current?.canPlace({ x: at.x, z: at.z, rot: at.rot, w: curDef.w, d: curDef.d, flat: curDef.flat }, cur!.id));
  const changed = !!(cur && pending && (pending.x !== cur.x || pending.z !== cur.z || pending.rot !== cur.rot));

  useEffect(() => {
    if (selected) setTab('mine');
  }, [selected]);
  // Échap ferme la feuille
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!view) return null;
  const free = view.slots - view.items.length;
  const price = (paid: number) => Math.floor((paid * view.resaleBp) / 10_000);
  const standingIcon = view.standing === 'LUXURIOUS' ? '👑' : view.standing === 'COMFORTABLE' ? '🛋️' : '🏠';
  const next = view.standing === 'MODEST' ? view.thresholds.comfortable : view.standing === 'COMFORTABLE' ? view.thresholds.luxurious : null;

  const buy = async (d: FurnitureDef) => {
    setError(null);
    const spot = room.current?.findFreeSpot({ w: d.w, d: d.d, flat: d.flat });
    if (!spot) return setError(t('decor.noSpace'));
    const r = await run(() => placeFurniture(d.id, spot.x, spot.z, spot.rot), () => t('decor.bought', { name: localName(d, i18n.language) }));
    if (r?.result.id) {
      await reload();
      setSelected(r.result.id);
      setPending(null);
    }
  };
  const nudge = (dir: 'up' | 'down' | 'left' | 'right') => {
    if (!cur || !at) return;
    const { dx, dz } = room.current?.screenStep(dir) ?? { dx: 0, dz: 0 };
    setPending({ id: cur.id, x: Math.round((at.x + dx) * 100) / 100, z: Math.round((at.z + dz) * 100) / 100, rot: at.rot });
  };
  const rotate = () => {
    if (cur && at && !curDef?.fixed) setPending({ id: cur.id, x: at.x, z: at.z, rot: (at.rot + 1) % 4 });
  };
  const validate = async () => {
    if (!cur || !at) return;
    setError(null);
    const r = await run(() => moveFurniture(cur.id, at.x, at.z, at.rot));
    if (r) {
      setPending(null);
      await reload();
    }
  };
  const sellById = async (id: string) => {
    const r = await run(() => sellFurniture(id), (x) => t('decor.sold', { amount: fcfa(x.result.received) }));
    if (r) {
      if (selected === id) setSelected(null);
      setPending(null);
      await reload();
    }
  };
  const store = async (id: string) => {
    const r = await run(() => storeFurniture(id), () => t('decor.stored'));
    if (r) {
      if (selected === id) setSelected(null);
      setPending(null);
      await reload();
    }
  };
  const placeFromStorage = async (id: string, d: FurnitureDef) => {
    setError(null);
    const spot = room.current?.findFreeSpot({ w: d.w, d: d.d, flat: d.flat });
    if (!spot) return setError(t('decor.noSpace'));
    const r = await run(() => placeStoredFurniture(id, spot.x, spot.z, spot.rot), () => t('decor.placed'));
    if (r) {
      await reload();
      setSelected(id);
      setPending(null);
    }
  };
  const findFriend = async () => {
    if (!gift) return;
    setGiftErr(null);
    const un = gift.user.trim().replace(/^@/, '');
    if (!un) return;
    try {
      const r = await lookupRecipient(un);
      setGift({ ...gift, target: { id: r.characterId, name: r.name } });
    } catch (e) {
      setGiftErr(errorText(e instanceof ApiError ? e.code : 'unknown'));
    }
  };
  const doGift = async () => {
    if (!gift?.target) return;
    const r = await run(() => giftFurniture(gift.id, gift.target!.id), () => t('decor.gifted', { name: gift.target!.name }));
    if (r) {
      if (selected === gift.id) setSelected(null);
      setGift(null);
      setPending(null);
      await reload();
    }
  };
  const sell = () => (cur ? sellById(cur.id) : Promise.resolve());

  return (
    <aside className="decor-sheet" role="dialog" aria-label={t('decor.title')}>
      <header className="decor-head">
        <div className="decor-title">
          <strong>{standingIcon} {t('decor.title')}</strong>
          <small>{t(`decor.standing.${view.standing}`)} · {t('decor.comfort', { n: view.comfort })}{next ? ` / ${next}` : ''} · {t('decor.slots', { used: view.items.length, max: view.slots })}</small>
        </div>
        <button type="button" className="btn small ghost" onClick={onClose} aria-label={t('app.close')}>✕</button>
      </header>
      <div className="chat-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'shop'} className={tab === 'shop' ? 'chat-tab active' : 'chat-tab'} onClick={() => setTab('shop')}>🛒 {t('decor.shop')}</button>
        <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'chat-tab active' : 'chat-tab'} onClick={() => setTab('mine')}>🛋️ {t('decor.mine', { n: view.items.length })}</button>
        <button role="tab" aria-selected={tab === 'storage'} className={tab === 'storage' ? 'chat-tab active' : 'chat-tab'} onClick={() => setTab('storage')}>📦 {t('decor.storage', { n: view.storage.length })}</button>
      </div>
      <input type="search" className="catalog-search decor-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('decor.search')} aria-label={t('decor.search')} autoComplete="off" />
      <div className="decor-body">
      {error && <p className="error" role="alert">{error}</p>}
      {tab === 'shop' && (
        <ul className="decor-list">
          {view.catalog.filter((d) => hit(d)).map((d) => (
            <li key={d.id} className="decor-row">
              <span className="decor-ico" aria-hidden="true">{d.emoji}</span>
              <span className="decor-name"><strong>{localName(d, i18n.language)}</strong><small>{d.w} × {d.d} m · {t('decor.comfort', { n: d.comfort })}</small></span>
              <button type="button" className="btn small primary" disabled={busy || free <= 0 || balance < BigInt(d.price)} onClick={() => void buy(d)}>{fcfa(d.price)}</button>
            </li>
          ))}
          {q && !view.catalog.some((d) => hit(d)) && <li className="muted">{t('decor.noMatch')}</li>}
          {free <= 0 && <li className="muted">{t('decor.full')}</li>}
        </ul>
      )}
      {tab === 'mine' && (
        <>
          {view.items.length === 0 && <p className="muted">{t('decor.empty')}</p>}
          <ul className="decor-list">
            {view.items.map((i) => {
              const d = def(i.itemId);
              if (q && !hit(d, i.itemId)) return null;
              const on = selected === i.id;
              return (
                <li key={i.id}>
                  <button type="button" className={`decor-row decor-pick${on ? ' on' : ''}`} aria-pressed={on} onClick={() => (setSelected(on ? null : i.id), setPending(null))}>
                    <span className="decor-ico" aria-hidden="true">{d?.emoji ?? '📦'}</span>
                    <span className="decor-name"><strong>{d ? localName(d, i18n.language) : i.itemId}</strong><small>{d ? `${d.w} × ${d.d} m · ${t('decor.comfort', { n: d.comfort })}` : ''}</small></span>
                    <span className="decor-resale">{fcfa(price(i.paid))}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {cur && curDef && (
            <div className="decor-edit">
              <div className="decor-pad" role="group" aria-label={t('decor.move')}>
                <button type="button" className="pad-up" onClick={() => nudge('up')} aria-label={t('decor.up')}>▲</button>
                <button type="button" className="pad-left" onClick={() => nudge('left')} aria-label={t('decor.left')}>◀</button>
                <button type="button" className="pad-rot" onClick={rotate} disabled={!!curDef.fixed} aria-label={t('decor.rotate')}>⟳</button>
                <button type="button" className="pad-right" onClick={() => nudge('right')} aria-label={t('decor.right')}>▶</button>
                <button type="button" className="pad-down" onClick={() => nudge('down')} aria-label={t('decor.down')}>▼</button>
              </div>
              <div className="decor-actions">
                <p className={ok ? 'ok' : 'warning'}>{ok ? t('decor.placeOk') : t('decor.placeBlocked')}</p>
                <button type="button" className="btn primary small" disabled={busy || !changed || !ok} onClick={() => void validate()}>✔ {t('decor.validate')}</button>
                {changed && <button type="button" className="btn ghost small" onClick={() => setPending(null)}>↩ {t('decor.cancel')}</button>}
                <div className="decor-more">
                  <button type="button" className="btn ghost small" disabled={busy} onClick={() => void store(cur.id)}>📦 {t('decor.store')}</button>
                  <button type="button" className="btn ghost small" disabled={busy} onClick={() => (setGift({ id: cur.id, user: '', target: null }), setGiftErr(null))}>🎁 {t('decor.give')}</button>
                  <button type="button" className="btn ghost small" disabled={busy} onClick={() => void sell()}>💰 {t('decor.sell', { amount: fcfa(price(cur.paid)) })}</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {tab === 'storage' && (
        <>
          {view.storage.length === 0 && <p className="muted">{t('decor.storageEmpty')}</p>}
          <ul className="decor-list">
            {view.storage.map((i) => {
              const d = def(i.itemId);
              if (!d || !hit(d)) return null;
              return (
                <li key={i.id} className="decor-row">
                  <span className="decor-ico" aria-hidden="true">{d.emoji}</span>
                  <span className="decor-name"><strong>{localName(d, i18n.language)}</strong><small>{d.w} × {d.d} m · {t('decor.sell', { amount: fcfa(price(i.paid)) })}</small></span>
                  <span className="decor-btns">
                    <button type="button" className="btn small primary" disabled={busy || free <= 0} onClick={() => void placeFromStorage(i.id, d)}>{t('decor.place')}</button>
                    <button type="button" className="btn small ghost" disabled={busy} onClick={() => (setGift({ id: i.id, user: '', target: null }), setGiftErr(null))} aria-label={t('decor.give')}>🎁</button>
                    <button type="button" className="btn small ghost" disabled={busy} onClick={() => void sellById(i.id)} aria-label={t('decor.sellShort')}>💰</button>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {gift && (
        <div className="decor-gift" role="dialog" aria-label={t('decor.give')}>
          <strong>🎁 {t('decor.giveTitle')}</strong>
          {!gift.target ? (
            <div className="dm-start">
              <input value={gift.user} onChange={(e) => (setGift({ ...gift, user: e.target.value }), setGiftErr(null))} placeholder={t('decor.giveUser')} aria-label={t('decor.giveUser')} maxLength={20} onKeyDown={(e) => e.key === 'Enter' && void findFriend()} />
              <button type="button" className="btn small" disabled={busy || !gift.user.trim()} onClick={() => void findFriend()}>{t('decor.giveFind')}</button>
            </div>
          ) : (
            <p>{t('decor.giveConfirm', { name: gift.target.name })}</p>
          )}
          {giftErr && <small className="error">{giftErr}</small>}
          <div className="row">
            <button type="button" className="btn ghost small" onClick={() => setGift(null)}>{t('decor.cancel')}</button>
            {gift.target && <button type="button" className="btn primary small" disabled={busy} onClick={() => void doGift()}>🎁 {t('decor.giveGo')}</button>}
          </div>
        </div>
      )}
      </div>
    </aside>
  );
}
