import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { checkout, myAds, uploadPlotImage, type MyAd } from '../api/endpoints';
import { ApiError } from '../api/client';
import { prepareAdImage } from '../lib/image';
import { fcfa, localName } from '../lib/format';
import { safeRedirectUrl } from '../lib/urlParams';
import { useGame } from './ctx';
import AccountGate from '../ui/AccountGate';

/** Repère visuel par type de produit de la boutique (argent réel), comme les catégories de métiers ou d'habits. */
const SHOP_ICON: Record<string, string> = { COINS: '🪙', PREMIUM: '⭐' };

export default function ShopApp() {
  const { t, i18n } = useTranslation();
  const { catalog, run, busy, toast } = useGame();
  const [redirecting, setRedirecting] = useState(false);
  const [ads, setAds] = useState<MyAd[]>([]);
  useEffect(() => {
    void myAds().then(setAds, () => setAds([]));
  }, []);
  if (!catalog) return <p className="muted">{t('app.loading')}</p>;

  async function buy(id: string) {
    const r = await run(() => checkout(id));
    if (!r) return;
    const url = safeRedirectUrl(r.redirectUrl);
    if (!url) {
      toast(t('shop.badRedirect'), 'error');
      return;
    }
    setRedirecting(true);
    window.location.assign(url);
  }

  return (
    <section>
      <h2>{t('shop.title')}</h2>
      <p className="muted">{t('shop.intro')}</p>
      {redirecting && <p className="notice">{t('shop.redirecting')}</p>}
      <div className="shop-cards">
        {catalog.products.map((p) => (
          <div key={p.id} className={`panel shop-card ${p.kind === 'PREMIUM' ? 'premium' : ''}`}>
            <span className="shop-ic" aria-hidden="true">{SHOP_ICON[p.kind] ?? '🛒'}</span>
            <div className="shop-card-body">
              <strong>{localName(p, i18n.language)}</strong>
              <small>{p.kind === 'COINS' ? t('shop.coins', { amount: fcfa(p.coinsGranted) }) : t('shop.premium')}</small>
              <span className="price">{t('shop.price', { amount: fcfa(p.priceAmount) })}</span>
            </div>
            <AccountGate big={false}>
              <button className="btn primary" disabled={busy || redirecting} onClick={() => void buy(p.id)}>
                {t('shop.buy')}
              </button>
            </AccountGate>
          </div>
        ))}
      </div>
      <h3>📣 {t('book.mine')}</h3>
      {ads.length === 0 ? (
        <p className="muted">{t('book.none')}</p>
      ) : (
        <ul className="list">
          {ads.map((a) => (
            <li key={a.id} className="item">
              <div className="item-main">
                <strong>{a.title}</strong>
                <small>{a.partner} · {a.slot === -1 ? t('admin.allBoards') : a.slot <= -2 ? t('admin.seaPlot') : `#${a.slot}`}</small>
                <small>{t('book.stats', { views: a.views, clicks: a.clicks })}</small>
              </div>
              <span className={`status s-${a.status}`}>{t(`admin.status.${a.status}`)}</span>
              {a.status === 'PENDING' && (
                // Image ajoutée ou changée tant que l'équipe n'a pas validé l'annonce
                <label className="btn ghost small file-btn">
                  🖼️ {a.hasImage ? t('book.changeImage') : t('book.addImage')}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      void run(async () => {
                        let blob: Blob;
                        try {
                          blob = await prepareAdImage(file);
                        } catch (err) {
                          throw new ApiError(400, (err as Error).message === 'image_too_large' ? 'image_too_large' : 'invalid_image');
                        }
                        await uploadPlotImage(a.id, blob);
                        return true;
                      }, () => t('book.imageSent')).then((ok) => ok && void myAds().then(setAds, () => undefined));
                    }}
                  />
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
