import { HOME_ACT_EVENT, type HomeAct } from '../game/Interior';
import { useTranslation } from 'react-i18next';
import { buyFreezer, eat, eatFromFreezer, stockFreezer } from '../api/endpoints';
import type { Food } from '../api/types';
import { fcfa, localName, signed } from '../lib/format';
import { useGame } from './ctx';

const EFFECTS: (keyof Pick<Food, 'hunger' | 'energy' | 'morale' | 'health'>)[] = ['hunger', 'energy', 'morale', 'health'];

export default function EatApp() {
  const { t, i18n } = useTranslation();
  const { catalog, run, busy, state, openApp } = useGame();
  if (!catalog) return <p className="muted">{t('app.loading')}</p>;
  const balance = BigInt(state.wallet.balance);
  return (
    <section>
      <h2>{t('eat.title')}</h2>
      <button className="btn" onClick={() => openApp('kitchen')}>🍳 {t('kitchen.fromEat')}</button>
      <ul className="list">
        {catalog.foods.map((f) => (
          <li key={f.id} className="item">
            <div className="item-main">
              <strong>{localName(f, i18n.language)}</strong>
              <span className="price">{fcfa(f.price)}</span>
              <span className="effects">
                {EFFECTS.filter((k) => f[k] !== 0).map((k) => (
                  <span key={k} className={f[k] > 0 ? 'chip up' : 'chip down'}>
                    {t('eat.effect', { label: t(`needs.${k}`), value: signed(f[k]) })}
                  </span>
                ))}
              </span>
            </div>
            <button
              className="btn primary"
              disabled={busy || balance < BigInt(f.price)}
              onClick={() => void run(() => eat(f.id), () => t('eat.done', { food: localName(f, i18n.language), price: fcfa(f.price) })).then((r) => r && window.dispatchEvent(new CustomEvent<HomeAct>(HOME_ACT_EVENT, { detail: 'eat' })))}
            >
              {t('eat.buy')}
            </button>
          </li>
        ))}
      </ul>
      <h3>🧊 {t('freezer.title')}</h3>
      {!state.freezer.owned ? (
        <div className="panel">
          <p className="muted">{t('freezer.desc')}</p>
          <button className="btn primary" disabled={busy || balance < BigInt(state.freezer.price)} onClick={() => void run(buyFreezer, () => t('freezer.bought'))}>
            {t('freezer.buy', { price: fcfa(state.freezer.price) })}
          </button>
        </div>
      ) : (
        <div className="panel">
          <p className="small-line">
            {t('freezer.capacity', { used: state.freezer.used, max: state.freezer.capacity })} · {t('freezer.discount', { pct: state.freezer.discountBp / 100 })}
          </p>
          <ul className="list">
            {catalog.foods.map((f) => {
              const qty = state.freezer.items.find((i) => i.foodId === f.id)?.qty ?? 0;
              const room = state.freezer.capacity - state.freezer.used;
              const n = Math.min(4, room);
              const unit = Math.floor((f.price * (10_000 - state.freezer.discountBp)) / 10_000);
              return (
                <li key={f.id} className="item">
                  <div className="item-main">
                    <strong>{localName(f, i18n.language)}</strong>
                    <span className="price">{fcfa(unit)}</span>
                    <small className="muted">×{qty}</small>
                  </div>
                  <button className="btn" disabled={busy || n < 1 || balance < BigInt(unit * n)} onClick={() => void run(() => stockFreezer(f.id, n), () => t('freezer.stocked', { food: localName(f, i18n.language), n, price: fcfa(unit * n) }))}>
                    {t('freezer.stock', { n, price: fcfa(unit * n) })}
                  </button>
                  <button className="btn primary" disabled={busy || qty < 1} onClick={() => void run(() => eatFromFreezer(f.id), () => t('freezer.eaten', { food: localName(f, i18n.language) })).then((r) => r && window.dispatchEvent(new CustomEvent<HomeAct>(HOME_ACT_EVENT, { detail: 'eat' })))}>
                    {t('freezer.eat', { qty })}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
