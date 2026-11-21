import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getHistory, myAds, type MyAd } from '../api/endpoints';
import type { HistoryEntry } from '../api/types';
import { fcfa } from '../lib/format';
import { useGame, type AppId } from './ctx';
import { focusSection } from '../lib/focus';

/** Courbe du solde (dernières opérations), en SVG. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const W = 300;
  const H = 70;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 6 - ((v - min) / span) * (H - 12)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".45" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#sparkFill)" />
      <path d={line} fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Tableau de bord du joueur : argent, progression, besoins, échéances et publicités. */
export default function DashApp() {
  const { t, i18n } = useTranslation();
  const { state, openApp } = useGame();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [ads, setAds] = useState<MyAd[]>([]);
  useEffect(() => {
    void getHistory(60).then(setHistory, () => setHistory([]));
    void myAds().then(setAds, () => setAds([]));
  }, []);
  const week = Date.now() - 7 * 86_400_000;
  const recent = history.filter((h) => new Date(h.at).getTime() >= week);
  const income = recent.reduce((a, h) => a + Math.max(0, Number(h.amount)), 0);
  const spent = recent.reduce((a, h) => a + Math.max(0, -Number(h.amount)), 0);
  const curve = [...history].reverse().map((h) => Number(h.balanceAfter));
  const goals: [string, boolean][] = [
    ['job', !!state.job],
    ['respect', state.needs.respect >= 50],
    ['bills', !state.rent.overdue && !state.bills.ELEC.overdue && !state.bills.WATER.overdue],
    ['million', BigInt(state.wallet.balance) >= 1_000_000n],
    ['company', !!state.company],
    ['owner', state.rent.owned],
  ];
  const done = goals.filter(([, ok]) => ok).length;
  const pct = Math.round((done / goals.length) * 100);
  const dues: [string, string, boolean, AppId, string?][] = [
    ['🏠', state.rent.owned ? t('dash.owner') : state.rent.homeless ? t('rent.homelessTitle') : state.rent.overdue ? t('dash.rentLate', { count: state.rent.overdueMonths }) : t('dash.until', { day: state.rent.paidUntilGameDay }), state.rent.overdue || state.rent.homeless, 'rent'],
    ['⚡', state.bills.ELEC.overdue ? t('dash.billLate', { amount: fcfa(state.bills.ELEC.due ?? state.bills.ELEC.monthly) }) : t('dash.until', { day: state.bills.ELEC.paidUntilGameDay }), state.bills.ELEC.overdue, 'rent', 'bills'],
    ['💧', state.bills.WATER.overdue ? t('dash.billLate', { amount: fcfa(state.bills.WATER.due ?? state.bills.WATER.monthly) }) : t('dash.until', { day: state.bills.WATER.paidUntilGameDay }), state.bills.WATER.overdue, 'rent', 'bills'],
    ['🩺', state.amu.covered ? t('dash.amuOk', { day: state.amu.paidUntilGameDay }) : t('dash.amuNo'), !state.amu.covered, 'health'],
  ];
  return (
    <section className="dash-app">
      <div className="dash-hero">
        <small>{t('dash.balance')}</small>
        <strong>{fcfa(state.wallet.balance)}</strong>
        <Sparkline values={curve} />
        <div className="dash-flow">
          <span>▲ {fcfa(income)}</span>
          <span>▼ {fcfa(spent)}</span>
          <small>{t('dash.week')}</small>
        </div>
      </div>
      <div className="dash-row">
        <div className="dash-tile">
          <div className="ring" style={{ background: `conic-gradient(#22a861 ${pct * 3.6}deg, #e6ebf3 0)` }}><span>{done}/{goals.length}</span></div>
          <small>{t('dash.goals')}</small>
        </div>
        <div className="dash-tile">
          <div className="ring" style={{ background: `conic-gradient(#e5a100 ${state.needs.respect * 3.6}deg, #e6ebf3 0)` }}><span>{state.needs.respect}</span></div>
          <small>{t('dash.respect')}</small>
        </div>
        <div className="dash-tile">
          <div className="ring big-emoji"><span>{state.job ? '💼' : '🔎'}</span></div>
          <small>{state.job ? (i18n.language === 'en' ? state.job.nameEn : state.job.nameFr) : t('dash.noJob')}</small>
        </div>
      </div>
      <div className="panel">
        <strong>{t('dash.needs')}</strong>
        {(['hunger', 'energy', 'hygiene', 'health', 'morale'] as const).map((k) => (
          <div key={k} className="dash-need">
            <span>{t(`needs.${k}`)}</span>
            <div className="meter-track"><div className={`meter-fill ${state.needs[k] < 30 ? 't-red' : 't-green'}`} style={{ width: `${state.needs[k]}%` }} /></div>
            <b>{state.needs[k]}</b>
          </div>
        ))}
      </div>
      <div className="panel">
        <strong>{t('dash.dues')}</strong>
        {dues.map(([ico, text, bad, app, section]) => (
          <div key={ico} className="row-between dash-due">
            <p className={bad ? 'error' : 'ok'}>
              {ico} {text}
            </p>
            {bad && (
              <button className="btn small primary" onClick={() => (focusSection(section ?? null), openApp(app))}>
                {t('dash.settle')}
              </button>
            )}
          </div>
        ))}
      </div>
      {ads.length > 0 && (
        <div className="panel">
          <strong>{t('dash.myAds')}</strong>
          {ads.map((a) => (
            <div key={a.id} className="row-between">
              <span>{a.title}</span>
              <small className="muted">👁 {a.views} · 👆 {a.clicks}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
