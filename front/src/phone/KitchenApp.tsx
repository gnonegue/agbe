import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buyAppliance, buyGrocery, buyRecipeItems, cookRecipe, eatDish, freezeDish, getKitchen, type KitchenAppliance, type KitchenState } from '../api/endpoints';
import { COOK_EVENT, HOME_ACT_EVENT, type CookDetail, type HomeAct } from '../game/Interior';
import { fcfa, localName } from '../lib/format';
import { consumeFocusSection } from '../lib/focus';
import { useGame } from './ctx';

type Tab = 'cook' | 'pantry' | 'shop';
const HOME = 'home';

/** Cuisine à la maison : cuisiner une recette, voir le garde-manger et les restes, faire les courses et s'équiper. */
export default function KitchenApp() {
  const { t, i18n } = useTranslation();
  const { catalog, state, run, busy, goTo, closePhone } = useGame();
  const [k, setK] = useState<KitchenState | null>(null);
  // Ouverte depuis un marché (bouton « Appareils de cuisine ») : on arrive directement sur la boutique
  const [tab, setTab] = useState<Tab>(() => (consumeFocusSection() === 'kitchen-shop' ? 'shop' : 'cook'));
  const [stove, setStove] = useState<string | null>(null);

  const load = useCallback(() => {
    void getKitchen().then(setK).catch(() => setK(null));
  }, []);
  useEffect(load, [load, state.wallet.balance, state.location]);

  if (!catalog || !k) return <p className="muted">{t('app.loading')}</p>;
  const lang = i18n.language;
  const balance = BigInt(state.wallet.balance);
  const atHome = state.location === HOME;
  const stock = (id: string) => k.pantry.find((p) => p.itemId === id)?.qty ?? 0;
  const itemOf = (id: string) => k.items.find((i) => i.id === id);
  const foodOf = (id: string) => catalog.foods.find((f) => f.id === id);
  const venueName = (id: string) => {
    const v = catalog.venues.find((x) => x.id === id);
    return v ? localName(v, lang) : id;
  };
  const stoves = k.appliances.filter((a) => a.kind === 'STOVE' && k.owned.includes(a.id));
  const stoveId = stove && stoves.some((s) => s.id === stove) ? stove : stoves[0]?.id ?? null;
  const fridge = k.appliances.some((a) => a.kind === 'FRIDGE' && k.owned.includes(a.id));
  const after = async <T,>(fn: () => Promise<T>, ok: (r: T) => string | null) => {
    const r = await run(fn, ok);
    load();
    return r;
  };
  const fuelLeft = (a: KitchenAppliance) => (a.fuel === 'ELECTRIC' ? Infinity : stock(a.fuelItem ?? ''));
  /** Conservation restante (jours de jeu) : `dish` pour un reste de plat (« à manger aujourd'hui »), sinon un ingrédient. */
  const left = (days: number | null, dish = false) =>
    days === null ? t('kitchen.noExpiry') : days < 1 ? t(dish ? 'kitchen.expiresToday' : 'kitchen.spoilsToday') : t('kitchen.expiresIn', { count: Math.floor(days) });
  /** Conservation d'un achat neuf : allongée par le réfrigérateur, comme le calcule le serveur. */
  const shelfOf = (days: number) => (days > 0 ? (fridge ? (days * k.rules.fridgeShelfBp) / 10_000 : days) : null);

  const cook = async (recipeId: string, foodId: string) => {
    const st = stoves.find((s) => s.id === stoveId);
    if (!st) return;
    const r = await after(() => cookRecipe(recipeId, st.id), () => t('kitchen.cooked', { food: localName(foodOf(foodId) ?? { nameFr: foodId, nameEn: foodId }, lang) }));
    if (r) {
      closePhone();
      window.dispatchEvent(new CustomEvent<CookDetail>(COOK_EVENT, { detail: { fuel: st.fuel ?? 'GAS', foodId } }));
    }
  };

  return (
    <section className="kt">
      <div className="chat-tabs" role="tablist">
        {(['cook', 'pantry', 'shop'] as Tab[]).map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'chat-tab active' : 'chat-tab'} onClick={() => setTab(x)}>
            {x === 'cook' ? '🍳' : x === 'pantry' ? '🧺' : '🛒'} {t(`kitchen.tabs.${x}`)}
          </button>
        ))}
      </div>

      {tab === 'cook' && (
        <>
          {!atHome && <p className="muted small-line">{t('kitchen.needHome')}</p>}
          {stoves.length === 0 ? (
            <div className="panel">
              <p className="muted">{t('kitchen.noStove')}</p>
              <button className="btn primary" onClick={() => setTab('shop')}>🛒 {t('kitchen.goShop')}</button>
            </div>
          ) : (
            <div className="segmented" role="group" aria-label={t('kitchen.stove')}>
              {stoves.map((s) => (
                <button key={s.id} className={s.id === stoveId ? 'seg active' : 'seg'} onClick={() => setStove(s.id)}>
                  {s.emoji} {localName(s, lang)}
                  {s.fuel !== 'ELECTRIC' && <small> · ×{fuelLeft(s)}</small>}
                </button>
              ))}
            </div>
          )}
          <ul className="list stacked">
            {k.recipes.map((r) => {
              const food = foodOf(r.foodId);
              if (!food) return null;
              const miss = r.items.filter((i) => stock(i.id) < i.qty);
              // Prix affiché des lots manquants (indicatif : le serveur recalcule et prélève)
              const bundle = miss.reduce((n, i) => {
                const it = itemOf(i.id);
                return it ? n + Math.ceil((i.qty - stock(i.id)) / it.pack) * it.price : n;
              }, 0);
              const st = stoves.find((s) => s.id === stoveId);
              const noFuel = !!st && st.fuel !== 'ELECTRIC' && fuelLeft(st) < 1;
              // Réchaud électrique : la cuisson passe au compteur (facture d'électricité du mois), rien à payer sur le moment
              const power = false;
              return (
                <li key={r.id} className="item kt-recipe">
                  <div className="item-main">
                    <strong>🍲 {localName(food, lang)}</strong>
                    <small className="muted">{t('kitchen.portions', { n: r.portions, price: fcfa(food.price) })}</small>
                    <span className="kt-ings">
                      {r.items.map((i) => {
                        const it = itemOf(i.id);
                        const ok = stock(i.id) >= i.qty;
                        return (
                          <span key={i.id} className={ok ? 'chip up' : 'chip down'}>
                            {ok ? '✓' : '✗'} {it?.emoji} {it ? localName(it, lang) : i.id} ×{i.qty}
                          </span>
                        );
                      })}
                    </span>
                  </div>
                  {miss.length > 0 && (
                    <button className="btn" disabled={busy || balance < BigInt(bundle)} onClick={() => void after(() => buyRecipeItems(r.id), () => t('kitchen.boughtRecipe', { price: fcfa(bundle) }))}>
                      🛒 {t('kitchen.buyMissing', { price: fcfa(bundle) })}
                    </button>
                  )}
                  <button className="btn primary" disabled={busy || !atHome || !st || miss.length > 0 || noFuel || power} onClick={() => void cook(r.id, r.foodId)}>
                    {miss.length > 0 ? t('kitchen.missing', { n: miss.length }) : noFuel ? t('kitchen.noFuel') : t('kitchen.cook')}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {tab === 'pantry' && (
        <>
          <p className="small-line">{fridge ? `🧊 ${t('kitchen.fridgeOn', { x: k.rules.fridgeShelfBp / 10_000 })}` : t('kitchen.fridgeOff')}</p>
          {k.pantry.length === 0 && <p className="muted">{t('kitchen.pantryEmpty')}</p>}
          <ul className="list stacked">
            {k.pantry
              .filter((p) => p.itemId.startsWith('dish_'))
              .map((p) => {
                const foodId = p.itemId.slice(5);
                const food = foodOf(foodId);
                return (
                  <li key={p.itemId} className="item">
                    <div className="item-main">
                      <strong>🍲 {food ? localName(food, lang) : foodId} ×{p.qty}</strong>
                      <small className="muted">{t('kitchen.leftover')} · {left(p.daysLeft, true)}</small>
                    </div>
                    <button className="btn primary" disabled={busy || !atHome} onClick={() => void after(() => eatDish(foodId), () => t('kitchen.ate')).then((r) => r && window.dispatchEvent(new CustomEvent<HomeAct>(HOME_ACT_EVENT, { detail: 'eat' })))}>
                      {t('kitchen.eat')}
                    </button>
                    {state.freezer.owned && (
                      <button className="btn" disabled={busy || !atHome} onClick={() => void after(() => freezeDish(foodId, p.qty), () => t('kitchen.frozen'))}>
                        🧊 {t('kitchen.freeze')}
                      </button>
                    )}
                  </li>
                );
              })}
            {k.pantry
              .filter((p) => !p.itemId.startsWith('dish_'))
              .map((p) => {
                const it = itemOf(p.itemId);
                return (
                  <li key={p.itemId} className="item">
                    <div className="item-main">
                      <strong>{it?.emoji} {it ? localName(it, lang) : p.itemId} ×{p.qty}</strong>
                      <small className="muted">{left(p.daysLeft)}</small>
                    </div>
                  </li>
                );
              })}
          </ul>
        </>
      )}

      {tab === 'shop' && (
        <>
          <p className="muted small-line">{t('kitchen.shopHint')}</p>
          <h3>{t('kitchen.equipment')}</h3>
          <ul className="list stacked">
            {k.appliances.map((a) => {
              const here = a.venues.includes(state.location);
              const owned = k.owned.includes(a.id);
              return (
                <li key={a.id} className="item">
                  <div className="item-main">
                    <strong>{a.emoji} {localName(a, lang)}</strong>
                    <small className="muted">{i18n.language === 'en' ? a.descEn : a.descFr}</small>
                    <span className="price">{fcfa(a.price)}</span>
                    {!here && !owned && <small className="muted">{t('kitchen.soldAt', { places: a.venues.map(venueName).join(', ') })}</small>}
                  </div>
                  {owned ? (
                    <span className="chip up">✓ {t('kitchen.owned')}</span>
                  ) : here ? (
                    <button className="btn primary" disabled={busy || balance < BigInt(a.price)} onClick={() => void after(() => buyAppliance(a.id), () => t('kitchen.bought', { name: localName(a, lang) }))}>
                      {t('kitchen.buy')}
                    </button>
                  ) : (
                    <button className="btn" onClick={() => a.venues[0] && goTo(a.venues[0])}>📍 {t('kitchen.goThere')}</button>
                  )}
                </li>
              );
            })}
          </ul>
          <h3>{t('kitchen.groceries')}</h3>
          <ul className="list stacked">
            {k.items.map((i) => {
              const here = i.venues.includes(state.location);
              return (
                <li key={i.id} className="item">
                  <div className="item-main">
                    <strong>{i.emoji} {localName(i, lang)}</strong>
                    <span className="price">{fcfa(i.price)}{i.pack > 1 ? ` · ×${i.pack}` : ''}</span>
                    <small className="muted">{here ? left(shelfOf(i.shelfDays)) : t('kitchen.soldAt', { places: i.venues.map(venueName).join(', ') })} · {t('kitchen.have', { n: stock(i.id) })}</small>
                  </div>
                  {here ? (
                    <button className="btn primary" disabled={busy || balance < BigInt(i.price)} onClick={() => void after(() => buyGrocery(i.id, 1), () => t('kitchen.bought', { name: localName(i, lang) }))}>
                      {t('kitchen.buy')}
                    </button>
                  ) : (
                    <button className="btn" onClick={() => i.venues[0] && goTo(i.venues[0])}>📍 {t('kitchen.goThere')}</button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
