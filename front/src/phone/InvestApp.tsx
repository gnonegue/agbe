import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collectVenture, getInvest, startVenture, type InvestOption, type StockInfo, type VentureInfo } from '../api/endpoints';
import { fcfa, localName } from '../lib/format';
import { useGame } from './ctx';
import StockMarket from './StockMarket';
import { subBack } from './subBack';

type Tab = 'stocks' | 'farm' | 'business' | 'mine';

/** Investir : bourse simulée, saisons agricoles et secondes activités (argent du jeu uniquement). */
export default function InvestApp() {
  const { t, i18n } = useTranslation();
  const { run, busy, state } = useGame();
  const [tab, setTab] = useState<Tab>('stocks');
  const [data, setData] = useState<{ feeBp: number; stocks: StockInfo[]; options: InvestOption[]; ventures: VentureInfo[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    const r = await run(getInvest);
    if (r) setData(r);
    else setFailed(true);
  }, [run]);
  useEffect(() => {
    void load();
  }, [load, state.gameTime.hour]);
  if (!data)
    return failed ? (
      <div className="panel">
        <p className="muted">{t('app.loadFailed')}</p>
        <button
          className="btn"
          onClick={() => {
            setFailed(false);
            void load();
          }}
        >
          {t('app.retry')}
        </button>
      </div>
    ) : (
      <p className="muted">{t('app.loading')}</p>
    );
  const balance = BigInt(state.wallet.balance);
  const en = i18n.language.startsWith('en');
  const optionName = (id: string) => {
    const o = data.options.find((x) => x.id === id);
    return o ? `${o.emoji} ${localName(o, i18n.language)}` : id;
  };
  const tabs: Tab[] = ['stocks', 'farm', 'business', 'mine'];

  return (
    <section>
      <p className="muted small-line">{t('invest.disclaimer')}</p>
      <div className="look-chips" role="tablist">
        {tabs.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'look-chip on' : 'look-chip'} onClick={() => (k === tab ? subBack() : setTab(k))}>
            {t(`invest.tabs.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'stocks' && <StockMarket stocks={data.stocks} feeBp={data.feeBp} balance={balance} reload={load} />}

      {(tab === 'farm' || tab === 'business') && (
        <ul className="list stacked">
          {data.options
            .filter((o) => o.kind === (tab === 'farm' ? 'FARM' : 'BUSINESS'))
            .map((o) => (
              <li key={o.id} className="item">
                <div className="item-main">
                  <strong>
                    {o.emoji} {localName(o, i18n.language)}
                  </strong>
                  <small>{en ? o.descEn : o.descFr}</small>
                  <small className="muted">{t('invest.terms', { cost: fcfa(o.cost), days: o.gameDays, risk: (o.riskBp / 100).toLocaleString(i18n.language) })}</small>
                </div>
                <button className="btn primary small" disabled={busy || balance < BigInt(o.cost)} onClick={() => void run(() => startVenture(o.id), () => t('invest.started', { name: localName(o, i18n.language) })).then(load)}>
                  {t('invest.invest', { cost: fcfa(o.cost) })}
                </button>
              </li>
            ))}
        </ul>
      )}

      {tab === 'mine' && (
        <ul className="list stacked">
          {data.ventures.length === 0 && <li className="muted">{t('invest.none')}</li>}
          {data.ventures.map((v) => (
            <li key={v.id} className={v.closed ? 'item muted' : 'item'}>
              <div className="item-main">
                <strong>{optionName(v.optionId)}</strong>
                <small>{t('invest.invested', { amount: fcfa(v.invested), got: fcfa(v.collected) })}</small>
                <span className="bar progress" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v.progress * 100)}>
                  <span className={`fill w${Math.round(v.progress * 20) * 5}`} />
                </span>
                <small className={v.failed ? 'bad' : 'muted'}>
                  {v.failed ? t(v.kind === 'FARM' ? 'invest.badHarvest' : 'invest.stopped') : v.done ? t('invest.done') : t('invest.daysLeft', { count: v.daysLeft })}
                </small>
              </div>
              {!v.closed && BigInt(v.available) > 0n && (
                <button className="btn primary small" disabled={busy} onClick={() => void run(() => collectVenture(v.id), (r) => t('invest.collected', { amount: fcfa(r.result.received) })).then(load)}>
                  {t('invest.collect', { amount: fcfa(v.available) })}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
