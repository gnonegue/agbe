import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deposit, getSavings, withdraw } from '../api/endpoints';
import { fcfa } from '../lib/format';
import { useGame } from './ctx';

/** Épargne : compte rémunéré chaque jour de jeu (argent du jeu), dépôts et retraits. */
export function SavingsApp() {
  const { t, i18n } = useTranslation();
  const { run, busy, state } = useGame();
  const [acc, setAcc] = useState<{ balance: string; dailyBp: number; maxBalance: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [amount, setAmount] = useState(10_000);
  const load = useCallback(async () => {
    const r = await run(getSavings, (x) => (BigInt(x.result.interest) > 0n ? t('savings.interest', { amount: fcfa(x.result.interest) }) : null));
    if (r) setAcc(r.result);
    else setFailed(true);
  }, [run, t]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!acc)
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
  const yearly = ((acc.dailyBp * 360) / 100).toLocaleString(i18n.language);
  // Tout est calculé en entiers (FCFA) : intérêt du jour, projection sur 30 jours de jeu, places restantes sous le plafond
  const bal = BigInt(acc.balance);
  const wallet = BigInt(state.wallet.balance);
  const ceiling = BigInt(acc.maxBalance);
  const bp = BigInt(acc.dailyBp);
  const perDay = (bal * bp) / 10_000n;
  let projected = bal;
  for (let i = 0; i < 30; i++) projected += (projected * bp) / 10_000n;
  const room = ceiling > bal ? ceiling - bal : 0n;
  const maxDeposit = wallet < room ? wallet : room;
  const fill = ceiling > 0n ? Number((bal * 100n) / ceiling) : 0;
  const amt = BigInt(amount);
  const tooMuchDeposit = amt > room;
  const lackWallet = amt > wallet;
  const lackSavings = amt > bal;
  const quick = [5_000, 10_000, 50_000, 100_000];
  return (
    <section className="sv">
      <div className="sv-hero">
        <small>{t('savings.balance')}</small>
        <strong>{fcfa(acc.balance)}</strong>
        <div className="sv-rate">
          <span>📈 {t('savings.perDay', { amount: fcfa(perDay) })}</span>
          <span>{t('savings.rate', { daily: (acc.dailyBp / 100).toLocaleString(i18n.language), yearly })}</span>
        </div>
        <div className="sv-gauge" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, fill)} aria-label={t('savings.ceilingLabel')}>
          <span className={`sv-fill fill w${Math.round(Math.min(100, fill) / 5) * 5}`} />
        </div>
        <small>{t('savings.ceilingLeft', { room: fcfa(room), max: fcfa(ceiling) })}</small>
      </div>
      <div className="sv-stats">
        <div>
          <small>{t('savings.available')}</small>
          <b>{fcfa(wallet)}</b>
        </div>
        <div>
          <small>{t('savings.in30')}</small>
          <b>{fcfa(projected)}</b>
        </div>
      </div>
      <div className="panel sv-form">
        <span className="sv-label">{t('savings.amount')}</span>
        <div className="sv-amount">
          <button type="button" className="sv-step" aria-label="−" disabled={amount <= 1000} onClick={() => setAmount((a) => Math.max(1, a - 1000))}>−</button>
          <label className="sv-input">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={amount.toLocaleString(i18n.language)}
              onChange={(e) => setAmount(Math.max(1, Number(e.target.value.replace(/\D/g, '').slice(0, 15)) || 1))}
              onFocus={(e) => e.currentTarget.select()}
              aria-label={t('savings.amount')}
            />
            <span aria-hidden="true">FCFA</span>
          </label>
          <button type="button" className="sv-step" aria-label="+" onClick={() => setAmount((a) => a + 1000)}>+</button>
        </div>
        <div className="sv-chips" role="group" aria-label={t('savings.quick')}>
          {quick.map((q) => (
            <button key={q} type="button" className={amount === q ? 'sv-chip on' : 'sv-chip'} onClick={() => setAmount(q)}>{fcfa(q)}</button>
          ))}
          <button type="button" className="sv-chip" disabled={maxDeposit <= 0n} onClick={() => setAmount(Number(maxDeposit))}>{t('savings.max')}</button>
          <button type="button" className="sv-chip" disabled={bal <= 0n} onClick={() => setAmount(Number(bal))}>{t('savings.all')}</button>
        </div>
        {tooMuchDeposit && <small className="sv-warn">{t('savings.tooMuch', { room: fcfa(room) })}</small>}
        <div className="sv-actions">
          <button className="btn primary" disabled={busy || lackWallet || tooMuchDeposit} onClick={() => void run(() => deposit(amount), () => t('savings.deposited', { amount: fcfa(amount) })).then(load)}>
            ⬇️ {t('savings.deposit')}
            <small>{lackWallet ? t('savings.notEnoughWallet') : t('savings.after', { amount: fcfa(bal + amt) })}</small>
          </button>
          <button className="btn" disabled={busy || lackSavings} onClick={() => void run(() => withdraw(amount), () => t('savings.withdrawn', { amount: fcfa(amount) })).then(load)}>
            ⬆️ {t('savings.withdraw')}
            <small>{lackSavings ? t('savings.notEnoughSavings') : t('savings.after', { amount: fcfa(bal - amt) })}</small>
          </button>
        </div>
      </div>
      <p className="muted small-line">{t('savings.note', { max: fcfa(acc.maxBalance) })}</p>
    </section>
  );
}

/** Drapeau de chaque devise du convertisseur (XOF : franc CFA d'Afrique de l'Ouest). */
const FX_FLAGS: Record<string, string> = { XOF: '🇹🇬', EUR: '🇪🇺', USD: '🇺🇸', NGN: '🇳🇬', GHS: '🇬🇭', GBP: '🇬🇧', CNY: '🇨🇳', XAF: '🇨🇲' };

/** Convertisseur de devises (taux du jeu : parité fixe pour l'euro, autres indicatifs). */
export function FxApp() {
  const { t, i18n } = useTranslation();
  const { catalog } = useGame();
  const rates = catalog?.fx ?? {};
  const codes = Object.keys(rates);
  const [cur, setCur] = useState(codes[0] ?? 'EUR');
  const [amount, setAmount] = useState(1);
  const [toFcfa, setToFcfa] = useState(true);
  const rate = rates[cur] ?? 1;
  const result = toFcfa ? amount * rate : amount / rate;
  const from = toFcfa ? cur : 'XOF';
  const to = toFcfa ? 'XOF' : cur;
  const name = (c: string) => t(`fx.names.${c}`, { defaultValue: c === 'XOF' ? 'Franc CFA' : c });
  const code = (c: string) => (c === 'XOF' ? 'FCFA' : c);
  const quick = toFcfa ? [1, 10, 100, 1000] : [1000, 5000, 10_000, 100_000];
  return (
    <section className="fx">
      <div className="fx-curs" role="radiogroup" aria-label={t('fx.currency')}>
        {codes.map((c) => (
          <button key={c} role="radio" aria-checked={c === cur} className={c === cur ? 'fx-cur on' : 'fx-cur'} onClick={() => setCur(c)}>
            <span aria-hidden="true">{FX_FLAGS[c] ?? '💱'}</span> {c}
          </button>
        ))}
      </div>
      <div className="fx-card">
        <div className="fx-head">
          <span className="fx-flag" aria-hidden="true">{FX_FLAGS[from] ?? '💱'}</span>
          <span><b>{code(from)}</b><small>{name(from)}</small></span>
          <em>{t('fx.from')}</em>
        </div>
        <input className="fx-amount" type="number" inputMode="decimal" min={0} step="any" value={amount} aria-label={t('fx.amount', { cur: code(from) })} onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))} />
        <div className="fx-quick">
          {quick.map((q) => (
            <button key={q} className={q === amount ? 'on' : ''} onClick={() => setAmount(q)}>{q.toLocaleString(i18n.language)}</button>
          ))}
        </div>
      </div>
      <button className="fx-swap" onClick={() => setToFcfa((x) => !x)} aria-label={t('fx.swap')} title={t('fx.swap')}>⇅</button>
      <div className="fx-card fx-out">
        <div className="fx-head">
          <span className="fx-flag" aria-hidden="true">{FX_FLAGS[to] ?? '💱'}</span>
          <span><b>{code(to)}</b><small>{name(to)}</small></span>
          <em>{t('fx.to')}</em>
        </div>
        <output className="fx-result">{result.toLocaleString(i18n.language, { maximumFractionDigits: toFcfa ? 0 : 2 })}</output>
      </div>
      <p className="fx-rate">💱 {t('fx.rate', { cur, rate: rate.toLocaleString(i18n.language) })}</p>
    </section>
  );
}

/** Bloc-notes conservé sur l'appareil. */
export function NotesApp() {
  const { t } = useTranslation();
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem('agbe.notes') ?? '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('agbe.notes', text);
    } catch {
      /* stockage indisponible : la note reste le temps de la session */
    }
  }, [text]);
  return (
    <section>
      <textarea className="notes" value={text} onChange={(e) => setText(e.target.value.slice(0, 5000))} placeholder={t('notes.placeholder')} rows={16} />
      <small className="muted">{t('notes.saved')}</small>
    </section>
  );
}
