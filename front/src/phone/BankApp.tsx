import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bankDeposit, bankWithdraw, closeTerm, getBank, myLoan, openTerm, repayLoan, requestLoan, type BankInfo, type BankView, type MyLoan } from '../api/endpoints';
import { fcfa, localName } from '../lib/format';
import { useGame } from './ctx';
import { SavingsApp } from './ToolApps';
import { consumeFocusSection } from '../lib/focus';

const pct = (bp: number, lang: string) => (bp / 100).toLocaleString(lang, { maximumFractionDigits: 2 });

type Tab = 'mobile' | 'agency' | 'loan';

/**
 * Banque : épargne mobile (sans agence, intérêt quotidien) et banques/microfinance (livret et DAT par établissement,
 * ouverture en agence). Deux produits distincts du jeu, réunis ici sous une seule appli à onglets.
 */
export default function BankApp() {
  const { t } = useTranslation();
  // Ouverte depuis la fiche d'une banque ou d'une agence : sur l'onglet de la démarche choisie
  const [tab, setTab] = useState<Tab>(() => {
    const f = consumeFocusSection();
    return f && f.startsWith('bank-') && ['mobile', 'agency', 'loan'].includes(f.slice(5)) ? (f.slice(5) as Tab) : 'mobile';
  });
  return (
    <section>
      <div className="chat-tabs" role="tablist">
        {(['mobile', 'agency', 'loan'] as Tab[]).map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'chat-tab active' : 'chat-tab'} onClick={() => setTab(x)}>
            {x === 'mobile' ? '📱' : x === 'agency' ? '🏦' : '💵'} {t(`bank.tabs.${x}`)}
          </button>
        ))}
      </div>
      {tab === 'mobile' ? <SavingsApp /> : tab === 'agency' ? <AgencyBank /> : <LoanTab />}
    </section>
  );
}

/** Livret par banque et dépôts à terme ; versements, retraits et clôtures depuis le téléphone, ouverture en agence. */
function AgencyBank() {
  const { t, i18n } = useTranslation();
  const { run, busy, state, goTo, catalog } = useGame();
  const [v, setV] = useState<BankView | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [amount, setAmount] = useState(100_000);
  const [months, setMonths] = useState(12);
  const load = useCallback(async () => {
    const r = await run(getBank, (x) => (BigInt(x.result.interest) > 0n ? t('bank.interestPaid', { amount: fcfa(x.result.interest) }) : null));
    if (r) setV(r.result);
    else setFailed(true);
  }, [run, t]);
  useEffect(() => {
    void load();
  }, [load, state.gameTime.day]);
  if (!v)
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
  const lang = i18n.language;
  const wallet = BigInt(state.wallet.balance);
  const agencies = (b: BankInfo) => (catalog?.venues ?? []).filter((x) => x.id.startsWith(`bank_${b.id}_`));
  const atAgency = (b: BankInfo) => state.location.startsWith(`bank_${b.id}_`);
  const totalSaved = v.savings.reduce((a, s) => a + BigInt(s.balance), 0n) + v.terms.reduce((a, d) => a + BigInt(d.principal), 0n);

  return (
    <>
      <div className="panel weather-now">
        <span className="weather-sky" aria-hidden="true">🏦</span>
        <strong>{fcfa(totalSaved.toString())}</strong>
        <small>{t('bank.total')}</small>
      </div>
      <p className="muted small-line">{t('bank.disclaimer')}</p>
      {v.banks.map((b) => {
        const sav = v.savings.find((s) => s.bankId === b.id);
        const terms = v.terms.filter((d) => d.bankId === b.id);
        const here = atAgency(b);
        const term = b.terms.find((x) => x.months === months) ?? b.terms[0]!;
        const expanded = open === b.id;
        return (
          <div key={b.id} className={`panel bank-card ${b.kind === 'MFI' ? 'mfi' : ''} ${expanded ? 'open' : ''}`}>
            <button className="bank-head" onClick={() => setOpen(expanded ? null : b.id)} aria-expanded={expanded}>
              <span className="bank-logo" aria-hidden="true">{b.name.replace(/-Togo|Togo|Banque/g, '').trim().slice(0, 2).toUpperCase()}</span>
              <span className="bank-title">
                <strong>{b.name}</strong>
                <small>{t(b.kind === 'MFI' ? 'bank.mfi' : 'bank.bank')}</small>
              </span>
              <span className="bank-best">
                <small>{t('bank.upToLabel')}</small>
                <b>{pct(Math.max(...b.terms.map((x) => x.yearBp)), lang)} %</b>
              </span>
              <span className="bank-chev" aria-hidden="true">{expanded ? '▴' : '▾'}</span>
            </button>
            <div className="rate-grid">
              <div className="rate-tile sav">
                <small>{t('bank.savingsLabel')}</small>
                <b>{pct(b.savingsYearBp, lang)} %</b>
              </div>
              {b.terms.map((x) => (
                <div key={x.months} className="rate-tile">
                  <small>{t('bank.termMonths', { months: x.months })}</small>
                  <b>{pct(x.yearBp, lang)} %</b>
                </div>
              ))}
            </div>
            {sav && <p>{t('bank.savingsBalance', { amount: fcfa(sav.balance) })}</p>}
            {terms.map((d) => (
              <div key={d.id} className="item">
                <div className="item-main">
                  <strong>{t('bank.termLine', { amount: fcfa(d.principal), months: d.months, rate: pct(d.yearBp, lang) })}</strong>
                  <small className="muted">{d.matured ? t('bank.matured', { interest: fcfa(d.interest) }) : t('bank.until', { day: d.endDay, interest: fcfa(d.interest) })}</small>
                </div>
                <button
                  className={d.matured ? 'btn primary' : 'btn ghost small'}
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => closeTerm(d.id),
                      (x) => (x.result.early ? t('bank.broken', { amount: fcfa(x.result.principal) }) : t('bank.paid', { amount: fcfa((BigInt(x.result.principal) + BigInt(x.result.interest)).toString()) })),
                    ).then(load)
                  }
                >
                  {d.matured ? t('bank.collect') : t('bank.break')}
                </button>
              </div>
            ))}
            {expanded && (
              <div className="bank-ops">
                <label className="field">
                  <span>{t('savings.amount')}</span>
                  <input type="number" min={1} step={5000} value={amount} onChange={(e) => setAmount(Math.max(1, Math.floor(Number(e.target.value))))} />
                </label>
                {!sav && !here ? (
                  <p className="muted small-line">{t('bank.openAtAgency', { min: fcfa(b.minSavings) })}</p>
                ) : (
                  <div className="row-between">
                    <button className="btn primary" disabled={busy || wallet < BigInt(amount)} onClick={() => void run(() => bankDeposit(b.id, amount), () => t('bank.deposited', { amount: fcfa(amount) })).then(load)}>
                      ⬇️ {sav ? t('savings.deposit') : t('bank.openSavings')}
                    </button>
                    {sav && (
                      <button className="btn" disabled={busy || BigInt(sav.balance) < BigInt(amount)} onClick={() => void run(() => bankWithdraw(b.id, amount), () => t('bank.withdrawn', { amount: fcfa(amount) })).then(load)}>
                        ⬆️ {t('savings.withdraw')}
                      </button>
                    )}
                  </div>
                )}
                <div className="field">
                  <span id={`dur-${b.id}`}>{t('bank.duration')}</span>
                  <div className="term-picker" role="radiogroup" aria-labelledby={`dur-${b.id}`}>
                    {b.terms.map((x) => (
                      <button
                        key={x.months}
                        type="button"
                        role="radio"
                        aria-checked={term.months === x.months}
                        className={term.months === x.months ? 'term-opt on' : 'term-opt'}
                        onClick={() => setMonths(x.months)}
                      >
                        <b>{t('bank.termMonths', { months: x.months })}</b>
                        <span>{pct(x.yearBp, lang)} %</span>
                      </button>
                    ))}
                  </div>
                </div>
                <small className="muted">{t('bank.quote', { interest: fcfa(Math.floor((amount * term.yearBp * term.months * 30) / (10_000 * 360))), months: term.months })}</small>
                {here ? (
                  <button className="btn primary big" disabled={busy || wallet < BigInt(amount) || amount < b.minTerm} onClick={() => void run(() => openTerm(b.id, term.months, amount), () => t('bank.termOpened', { months: term.months })).then(load)}>
                    🔒 {t('bank.openTerm', { min: fcfa(b.minTerm) })}
                  </button>
                ) : (
                  <div className="chips">
                    {agencies(b).map((a) => (
                      <button key={a.id} className="chip-act" onClick={() => goTo(a.id)}>
                        📍 {localName(a, lang)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * Prêt bancaire personnel : octroi immédiat dans un plafond fixe, mensualités fixes prélevées automatiquement,
 * remboursement anticipé libre à tout moment. Un seul prêt actif (OPEN/LATE) par personnage.
 */
function LoanTab() {
  const { t, i18n } = useTranslation();
  const { run, busy, state } = useGame();
  const [v, setV] = useState<MyLoan | null>(null);
  const [failed, setFailed] = useState(false);
  const [amount, setAmount] = useState(100_000);
  const [repayAmount, setRepayAmount] = useState(10_000);
  const load = useCallback(async () => {
    try {
      const r = await myLoan();
      setV(r);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, state.gameTime.day]);
  if (!v)
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
  const lang = i18n.language;
  const wallet = BigInt(state.wallet.balance);
  const cfg = v.settings;
  const loan = v.loan && v.loan.status !== 'CLOSED' ? v.loan : null;
  // Estimation côté client, pour affichage avant confirmation seulement : le serveur calcule et impose le montant réel.
  const estTotal = amount + Math.floor((amount * cfg.rateBp * cfg.termDays) / (10_000 * 360));
  const estInstallment = Math.ceil(estTotal / cfg.installmentsCount);
  const remaining = loan ? BigInt(loan.remaining) : 0n;

  return (
    <>
      {loan ? (
        <>
          <div className="panel weather-now">
            <span className="weather-sky" aria-hidden="true">💵</span>
            <strong>{fcfa(loan.remaining)}</strong>
            <small>{t('loans.remaining')}</small>
          </div>
          <div className="panel">
            <p>{t('loans.installmentLine', { amount: fcfa(loan.installmentAmount) })}</p>
            <p className="muted small-line">{t('loans.nextDue', { day: loan.nextDueGameDay })}</p>
            {loan.status === 'LATE' && <p className="warning">{t('loans.late', { penalty: fcfa(loan.totalPenaltyPaid) })}</p>}
            <label className="field">
              <span>{t('loans.repayAmount')}</span>
              <input
                type="number"
                min={1}
                max={Number(loan.remaining)}
                step={1000}
                value={repayAmount}
                onChange={(e) => setRepayAmount(Math.max(1, Math.floor(Number(e.target.value))))}
              />
            </label>
            {BigInt(repayAmount) > remaining && <p className="muted small-line">{t('errors.over_remaining')}</p>}
            <button
              className="btn primary big"
              disabled={busy || repayAmount <= 0 || BigInt(repayAmount) > remaining || wallet < BigInt(repayAmount)}
              onClick={() =>
                void run(() => repayLoan(repayAmount), (x) => (x.result.closed ? t('loans.closed') : t('loans.repaid', { amount: fcfa(repayAmount) }))).then(load)
              }
            >
              💳 {BigInt(repayAmount) >= remaining ? t('loans.repayAll') : t('loans.repay')}
            </button>
          </div>
        </>
      ) : (
        <div className="panel">
          <p className="muted small-line">{t('loans.cap', { amount: fcfa(cfg.capAmount) })}</p>
          <label className="field">
            <span>{t('loans.amount')}</span>
            <input type="number" min={1} max={cfg.capAmount} step={5_000} value={amount} onChange={(e) => setAmount(Math.max(1, Math.floor(Number(e.target.value))))} />
          </label>
          <small className="muted">{t('loans.quote', { installment: fcfa(estInstallment), n: cfg.installmentsCount, period: cfg.periodDays })}</small>
          <button
            className="btn primary big"
            disabled={busy || amount <= 0 || amount > cfg.capAmount}
            onClick={() => void run(() => requestLoan(amount), () => t('loans.granted', { amount: fcfa(amount) })).then(load)}
          >
            🏦 {t('loans.request')}
          </button>
        </div>
      )}
      <p className="muted small-line">{t('loans.disclaimer', { rate: pct(cfg.rateBp, lang) })}</p>
    </>
  );
}
