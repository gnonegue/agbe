import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { closeClothesShop, buyClothes, buyClothesFrom, getClothes, priceClothesShop, rentClothesShop, stockClothesShop, takeFromClothesShop, wearClothes, type ClothesState } from '../api/endpoints';
import { defaultLook, isSavedLook, type GarmentDef, type SavedLook, type Wear } from '../game/kit';
import { LookPreview } from '../ui/LookEditor';
import { fcfa, localName } from '../lib/format';
import { useGame } from './ctx';
import { consumeFocusSection } from '../lib/focus';
import SearchSelect from '../ui/SearchSelect';

type Tab = 'wardrobe' | 'shop' | 'players' | 'mine';
const HOME = 'home';
const SLOT_ICON = { top: '👕', bottom: '👖', dress: '👗', shoes: '👟' } as const;
const TAB_ICON: Record<Tab, string> = { wardrobe: '🚪', shop: '🛍️', players: '🧑‍🤝‍🧑', mine: '🏪' };

/** Pastille de couleur (uni) ou de motif (wax, kente, batik) d'un vêtement. */
function Swatch({ g }: { g: GarmentDef }) {
  const bg = g.fabric === 'plain' ? `#${g.color.toString(16).padStart(6, '0')}` : g.fabric === 'kente' ? 'repeating-linear-gradient(90deg,#e8b10c 0 6px,#1e7b3a 6px 12px,#c8102e 12px 18px,#111 18px 24px)' : g.fabric === 'batik' ? 'radial-gradient(circle,#cfe0ff 2px,#24407a 3px)' : 'radial-gradient(circle,#ffce00 4px,#006a4e 5px)';
  return <span className="cl-swatch" style={{ background: bg }} aria-hidden="true" />;
}

/**
 * Habillement : garde-robe (composer sa tenue avant de sortir), boutique de vêtements (prix du catalogue),
 * boutiques des autres joueurs dans le même lieu, et sa propre boutique (loyer, stock acheté en gros, prix).
 */
export default function ClothesApp() {
  const { t, i18n } = useTranslation();
  const { catalog, state, run, busy, goTo } = useGame();
  const [c, setC] = useState<ClothesState | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [sel, setSel] = useState<Wear | null>(null);
  const [mode, setMode] = useState<'separates' | 'dress'>('separates');
  const [confirmClose, setConfirmClose] = useState(false);
  const [weeks, setWeeks] = useState(1);
  const [prices, setPrices] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    void getClothes().then(setC).catch(() => setC(null));
  }, []);
  useEffect(load, [load, state.wallet.balance, state.location]);
  // Onglet d'ouverture : la boutique quand on y est, sinon la garde-robe
  useEffect(() => {
    if (c && tab === null) setTab(consumeFocusSection() === 'clothes-mine' ? 'mine' : c.here ? 'shop' : 'wardrobe');
  }, [c, tab]);
  // Sélection de départ : la tenue portée
  useEffect(() => {
    if (c && sel === null) {
      setSel(c.wear ?? {});
      setMode(c.wear?.dress ? 'dress' : 'separates');
    }
  }, [c, sel]);

  const base: SavedLook = useMemo(() => (isSavedLook(state.look) ? state.look : defaultLook(state.id)), [state.look, state.id]);
  if (!catalog || !c || !tab || !sel) return <p className="muted">{t('app.loading')}</p>;
  const lang = i18n.language;
  const balance = BigInt(state.wallet.balance);
  const atHome = state.location === HOME;
  const item = (id: string | undefined) => c.items.find((g) => g.id === id);
  const fitsMe = (g: GarmentDef) => g.gender === 'u' || g.gender === (c.female ? 'f' : 'm');
  const owned = c.items.filter((g) => c.owned.includes(g.id));
  const venueName = (id: string) => {
    const v = catalog.venues.find((x) => x.id === id);
    return v ? localName(v, lang) : id;
  };
  // Boutiques de la ville où se trouve le joueur seulement (chaque ville a les siennes).
  const myShops = c.rules.venues.filter((id) => catalog.venues.find((v) => v.id === id)?.city === (state.city ?? 'lome'));
  const after = async <T,>(fn: () => Promise<T>, ok: (r: T) => string | null) => {
    const r = await run(fn, ok);
    load();
    return r;
  };
  const priceRange = (g: GarmentDef) => {
    const wholesale = Math.max(1, Math.floor((g.price * c.rules.wholesaleBp) / 10_000));
    return { wholesale, max: Math.max(wholesale, Math.floor((g.price * c.rules.maxPriceBp) / 10_000)) };
  };

  // Tenue en cours de composition : un haut et un bas, ou une robe ; chaussures facultatives
  const pick: Wear = mode === 'dress' ? { dress: sel.dress, shoes: sel.shoes } : { top: sel.top, bottom: sel.bottom, shoes: sel.shoes };
  const complete = mode === 'dress' ? !!pick.dress : !!pick.top && !!pick.bottom;
  const preview: SavedLook = { ...base, wear: complete ? pick : undefined };
  const same = JSON.stringify(c.wear ?? {}) === JSON.stringify(Object.fromEntries(Object.entries(pick).filter(([, v]) => v)));
  const slotList = (slot: GarmentDef['slot']) => owned.filter((g) => g.slot === slot && fitsMe(g));
  const choose = (slot: keyof Wear, id: string) => setSel({ ...sel, [slot]: sel[slot] === id ? undefined : id });

  const tabs: Tab[] = ['wardrobe', 'shop', 'players', 'mine'];
  return (
    <section className="cl">
      <div className="cl-tabs" role="tablist" aria-label={t('phone.apps.clothes')}>
        {tabs.map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'cl-tab active' : 'cl-tab'} onClick={() => setTab(x)}>
            <span className="cl-tab-ic" aria-hidden="true">{TAB_ICON[x]}</span>
            <span className="cl-tab-lb">{t(`clothes.tabs.${x}`)}</span>
          </button>
        ))}
      </div>

      {tab === 'wardrobe' && (
        <>
          <div className="cl-preview">
            <span className="cl-badge">{complete && !same ? t('clothes.previewNew') : c.wear ? t('clothes.previewWorn') : t('clothes.previewOriginal')}</span>
            <LookPreview look={preview} close />
          </div>
          {!atHome && <p className="cl-note">🏠 {t('clothes.dressAtHome')}</p>}
          {owned.length === 0 ? (
            <div className="cl-empty">
              <span className="cl-empty-ic" aria-hidden="true">👗</span>
              <h4>{t('clothes.emptyTitle')}</h4>
              <p>{t('clothes.emptyWardrobe')}</p>
              <button className="btn primary" onClick={() => setTab('shop')}>🛍️ {t('clothes.goShopping')}</button>
            </div>
          ) : (
            <>
              <div className="segmented" role="group" aria-label={t('clothes.composition')}>
                <button className={mode === 'separates' ? 'seg active' : 'seg'} onClick={() => setMode('separates')}>👕 + 👖 {t('clothes.separates')}</button>
                {c.female && <button className={mode === 'dress' ? 'seg active' : 'seg'} onClick={() => setMode('dress')}>👗 {t('clothes.dressMode')}</button>}
              </div>
              {(mode === 'dress' ? (['dress', 'shoes'] as const) : (['top', 'bottom', 'shoes'] as const)).map((slot) => (
                <div key={slot} className="cl-slot">
                  <h4>{SLOT_ICON[slot]} {t(`clothes.slots.${slot}`)}</h4>
                  {slotList(slot).length === 0 ? (
                    <p className="muted small-line">{t('clothes.noneOwned')}</p>
                  ) : (
                    <div className="cl-picks">
                      {slotList(slot).map((g) => (
                        <button key={g.id} className={sel[slot] === g.id ? 'cl-pick active' : 'cl-pick'} aria-pressed={sel[slot] === g.id} onClick={() => choose(slot, g.id)}>
                          <Swatch g={g} /> {localName(g, lang)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {!complete && <p className="muted small-line">{mode === 'dress' ? t('clothes.needDress') : t('clothes.needTopBottom')}</p>}
              <div className="row-actions">
                <button className="btn primary" disabled={busy || !atHome || !complete || same} onClick={() => void after(() => wearClothes(pick), () => t('clothes.dressed'))}>
                  ✅ {t('clothes.wearThis')}
                </button>
                {c.wear && (
                  <button className="btn" disabled={busy || !atHome} onClick={() => void after(() => wearClothes({}), () => t('clothes.undressed')).then(() => setSel({}))}>
                    ↩️ {t('clothes.originalOutfit')}
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}

      {tab === 'shop' && (
        <>
          {!c.here && (
            <div className="panel">
              <p className="muted">{t('clothes.notInShop')}</p>
              <div className="cl-picks">
                {myShops.map((v) => (
                  <button key={v} className="btn" onClick={() => goTo(v)}>📍 {venueName(v)}</button>
                ))}
              </div>
            </div>
          )}
          <p className="muted small-line">{c.female ? t('clothes.forWomen') : t('clothes.forMen')}</p>
          <ul className="list stacked">
            {c.items.filter(fitsMe).map((g) => {
              const has = c.owned.includes(g.id);
              return (
                <li key={g.id} className="item">
                  <div className="item-main">
                    <strong><Swatch g={g} /> {g.emoji} {localName(g, lang)}</strong>
                    <small className="muted">{t(`clothes.slots.${g.slot}`)}</small>
                    <span className="price">{fcfa(g.price)}</span>
                  </div>
                  {has ? (
                    <span className="chip up">✓ {t('clothes.owned')}</span>
                  ) : (
                    <button className="btn primary" disabled={busy || !c.here || balance < BigInt(g.price)} onClick={() => void after(() => buyClothes(g.id), () => t('clothes.bought', { name: localName(g, lang) }))}>
                      {t('clothes.buy')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {tab === 'players' && (
        <>
          {!c.here ? (
            <p className="muted">{t('clothes.notInShop')}</p>
          ) : c.shops.length === 0 ? (
            <p className="muted">{t('clothes.noPlayerShops')}</p>
          ) : (
            c.shops.map((s) => (
              <div key={s.id} className="panel">
                <h4>🏪 {t('clothes.shopOf', { name: s.seller })}</h4>
                <ul className="list stacked">
                  {s.items.map((l) => {
                    const g = item(l.itemId);
                    if (!g) return null;
                    const has = c.owned.includes(g.id);
                    return (
                      <li key={l.itemId} className="item">
                        <div className="item-main">
                          <strong><Swatch g={g} /> {g.emoji} {localName(g, lang)}</strong>
                          <small className="muted">{t('clothes.inStock', { n: l.qty })}{!fitsMe(g) ? ` · ${t('clothes.otherCut')}` : ''}</small>
                          <span className="price">{fcfa(l.price)}</span>
                        </div>
                        {has ? (
                          <span className="chip up">✓ {t('clothes.owned')}</span>
                        ) : (
                          <button className="btn primary" disabled={busy || balance < BigInt(l.price)} onClick={() => void after(() => buyClothesFrom(s.id, g.id), () => t('clothes.bought', { name: localName(g, lang) }))}>
                            {t('clothes.buy')}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </>
      )}

      {tab === 'mine' && (
        <>
          <p className="muted small-line">{t('clothes.shopHint', { rent: fcfa(c.rules.weeklyRent), tax: c.rules.taxBp / 100 })}</p>
          {c.shop ? (
            <div className="panel">
              <h4>🏪 {venueName(c.shop.venueId)}</h4>
              <p className="small-line">
                {c.shop.open ? t('clothes.shopOpenUntil', { day: c.shop.paidUntilDay }) : t('clothes.shopExpired')} · {t('clothes.sales', { amount: fcfa(c.shop.sales) })}
              </p>
              {c.shop.open && <p className="muted small-line">🛍️ {t('clothes.npcInfo', { n: c.rules.npcVisitsPerDay ?? 0 })}</p>}
              {!confirmClose ? (
                <button className="btn ghost small" disabled={busy} onClick={() => setConfirmClose(true)}>🔒 {t('clothes.closeShop')}</button>
              ) : (
                <div className="decor-gift">
                  <p>{t('clothes.closeConfirm', { buyback: fcfa(c.shop.closeQuote.buyback), refund: fcfa(c.shop.closeQuote.refund) })}</p>
                  <div className="row">
                    <button className="btn ghost small" onClick={() => setConfirmClose(false)}>{t('app.cancel')}</button>
                    <button className="btn primary small" disabled={busy} onClick={() => void after(() => closeClothesShop(), (r) => t('clothes.closed', { amount: fcfa(BigInt(r.result.buyback) + BigInt(r.result.refund)) })).then(() => setConfirmClose(false))}>{t('clothes.closeGo')}</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="muted">{t('clothes.noShop')}</p>
          )}
          {c.here && (!c.shop || !c.shop.open || c.shop.venueId === c.here) ? (
            <div className="row-actions">
              <SearchSelect
                value={String(weeks)}
                options={Array.from({ length: c.rules.maxWeeks }, (_, i) => i + 1).map((w) => ({ value: String(w), label: t('clothes.weeksN', { count: w }) }))}
                onChange={(v) => setWeeks(Number(v))}
                placeholder={t('clothes.weeks')}
                searchLabel={t('app.search')}
                empty={t('app.noResult')}
              />
              <button className="btn primary" disabled={busy || balance < BigInt(c.rules.weeklyRent * weeks)} onClick={() => void after(() => rentClothesShop(weeks), () => t('clothes.rented'))}>
                {c.shop?.open ? t('clothes.extend') : t('clothes.rent')} · {fcfa(c.rules.weeklyRent * weeks)}
              </button>
            </div>
          ) : (
            !c.here && <p className="muted small-line">{t('clothes.rentInShop')}</p>
          )}
          {c.shop && (
            <>
              <h4>{t('clothes.myStock')}</h4>
              {c.shop.items.length === 0 && <p className="muted small-line">{t('clothes.stockEmpty')}</p>}
              <ul className="list stacked">
                {c.shop.items.map((l) => {
                  const g = item(l.itemId);
                  if (!g) return null;
                  const r = priceRange(g);
                  const draft = prices[g.id] ?? String(l.price);
                  const n = Number(draft);
                  const valid = Number.isInteger(n) && n >= r.wholesale && n <= r.max;
                  return (
                    <li key={l.itemId} className="item">
                      <div className="item-main">
                        <strong><Swatch g={g} /> {g.emoji} {localName(g, lang)}</strong>
                        <small className="muted">{t('clothes.inStock', { n: l.qty })} · {t('clothes.priceRange', { min: fcfa(r.wholesale), max: fcfa(r.max) })}</small>
                        <span className="row-actions">
                          <input className="cl-price" inputMode="numeric" value={draft} aria-label={t('clothes.price')} onChange={(e) => setPrices({ ...prices, [g.id]: e.target.value.replace(/\D/g, '') })} />
                          <button className="btn" disabled={busy || !valid || n === l.price} onClick={() => void after(() => priceClothesShop(g.id, n), () => t('clothes.priceSet'))}>{t('clothes.setPrice')}</button>
                          {!c.owned.includes(g.id) && l.qty > 0 && <button className="btn ghost" disabled={busy} onClick={() => void after(() => takeFromClothesShop(g.id), () => t('clothes.taken'))}>🧥 {t('clothes.takeOne')}</button>}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {c.shop.open && c.here === c.shop.venueId && (
                <>
                  <h4>{t('clothes.restock')}</h4>
                  <ul className="list stacked">
                    {c.items.map((g) => {
                      const r = priceRange(g);
                      return (
                        <li key={g.id} className="item">
                          <div className="item-main">
                            <strong><Swatch g={g} /> {g.emoji} {localName(g, lang)}</strong>
                            <small className="muted">{t('clothes.wholesale', { price: fcfa(r.wholesale), retail: fcfa(g.price) })}</small>
                          </div>
                          <button className="btn" disabled={busy || balance < BigInt(r.wholesale * 5)} onClick={() => void after(() => stockClothesShop(g.id, 5), () => t('clothes.stocked', { n: 5 }))}>+5</button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
