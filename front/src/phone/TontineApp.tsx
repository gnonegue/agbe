import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { collectTontine, createTontine, getTontines, joinTontine, leaveTontine, payTontine, startTontine } from '../api/endpoints';
import type { TontineList, TontineView } from '../api/types';
import { fcfa } from '../lib/format';
import { useGame } from './ctx';

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} '&.\-]{1,39}$/u;

/** Tontine : épargne collective entre joueurs, ramassage tournant, réputation des mauvais payeurs. */
export default function TontineApp() {
  const { t } = useTranslation();
  const { state, catalog, run, busy } = useGame();
  const [data, setData] = useState<TontineList | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('10000');
  const [period, setPeriod] = useState(7);
  const [size, setSize] = useState(5);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await run(getTontines);
    if (r) setData(r);
  }, [run]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!catalog || !data) return <p className="muted">{t('app.loading')}</p>;
  const cfg = catalog.tontine;
  const balance = BigInt(state.wallet.balance);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    const n = name.trim().replace(/\s+/g, ' ');
    const a = Number(amount);
    if (!NAME_RE.test(n)) return setError(t('tontine.nameInvalid'));
    if (!Number.isInteger(a) || a < cfg.minContribution || a > cfg.maxContribution) return setError(t('tontine.amountRange', { min: fcfa(cfg.minContribution), max: fcfa(cfg.maxContribution) }));
    const ok = await run(() => createTontine(n, a, period, size), () => t('tontine.created'));
    if (ok) {
      setCreating(false);
      setName('');
      void load();
    }
  }

  const act = (fn: () => Promise<unknown>, msg: (r: never) => string) => void run(fn as () => Promise<never>, msg).then(load);

  function card(v: TontineView) {
    const n = v.members.length;
    const turnOf = (r: number) => v.members.find((m) => m.turn === r);
    const beneficiary = v.status === 'ACTIVE' ? turnOf(v.payoutRound) : undefined;
    const paidCount = v.members.filter((m) => m.paid).length;
    return (
      <div className="panel" key={v.id}>
        <h3>🤝 {v.name}</h3>
        <p className="muted">
          {t('tontine.terms', { amount: fcfa(v.contribution), days: v.periodDays })} · {t('tontine.potIs', { amount: fcfa(v.pot) })}
        </p>
        {v.status === 'FORMING' && <p className="notice">{t('tontine.forming', { n, max: v.maxMembers, min: cfg.minMembers })}</p>}
        {v.status === 'ACTIVE' && beneficiary && (
          <p className="notice">
            {t('tontine.roundInfo', { round: v.payoutRound + 1, total: n, name: beneficiary.me ? t('tontine.you') : beneficiary.name, day: v.deadlineDay, paid: paidCount })}
          </p>
        )}
        {v.membersDefaults !== undefined && v.membersDefaults > 0 && <p className="warning">{t('tontine.riskWarning', { n: v.membersDefaults })}</p>}
        <ul className="list">
          {v.members.map((m) => (
            <li key={m.id} className={m.missed > 0 ? 'item danger-zone' : 'item'}>
              <div className="item-main">
                <strong>
                  {m.turn !== null ? `${m.turn + 1}. ` : ''}
                  {m.me ? t('tontine.you') : m.name}
                  {m.left && <small className="muted"> · {t('tontine.left')}</small>}
                </strong>
                <small>
                  {v.status === 'ACTIVE' ? (m.paid ? `✓ ${t('tontine.paid')}` : t('tontine.notPaid')) : ''}
                  {m.missed > 0 && ` · ${t('tontine.missed', { n: m.missed })}`}
                </small>
              </div>
            </li>
          ))}
        </ul>
        {v.payouts.length > 0 && (
          <p className="small-line muted">
            {v.payouts.map((p) => (p.refunded ? t('tontine.payoutRefund', { round: p.round + 1 }) : t('tontine.payoutDone', { round: p.round + 1, amount: fcfa(p.amount) }) + (p.toMe ? ` (${t('tontine.you')})` : ''))).join(' · ')}
          </p>
        )}
        <div className="row-actions">
          {!v.member && v.status === 'FORMING' && (
            <button className="btn primary" disabled={busy} onClick={() => act(() => joinTontine(v.id), () => t('tontine.joined', { name: v.name }))}>{t('tontine.join')}</button>
          )}
          {v.member && v.status === 'FORMING' && v.owner && (
            <button className="btn primary" disabled={busy || n < cfg.minMembers} onClick={() => act(() => startTontine(v.id), () => t('tontine.started'))}>{t('tontine.start')}</button>
          )}
          {v.member && v.status === 'FORMING' && (
            <button className="btn ghost" disabled={busy} onClick={() => act(() => leaveTontine(v.id), () => (v.owner ? t('tontine.cancelled') : t('tontine.leftDone')))}>{v.owner ? t('tontine.cancel') : t('tontine.leave')}</button>
          )}
          {v.member && v.status === 'ACTIVE' && !v.paidThisRound && (
            <button className="btn primary" disabled={busy || balance < BigInt(v.contribution)} onClick={() => act(() => payTontine(v.id), () => t('tontine.paidDone', { amount: fcfa(v.contribution) }))}>{t('tontine.pay', { amount: fcfa(v.contribution) })}</button>
          )}
          {v.member && v.status === 'ACTIVE' && v.myTurn === v.payoutRound && (
            <button className="btn" disabled={busy || paidCount < n} onClick={() => act(() => collectTontine(v.id), (r: { result: { amount: string } }) => t('tontine.collected', { amount: fcfa(r.result.amount) }))}>
              💰 {paidCount < n ? t('tontine.waitAll', { n: n - paidCount }) : t('tontine.collect')}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <section>
      <p className="muted">{t('tontine.intro')}</p>
      {data.myDefaults > 0 && <p className="warning">{t('tontine.myDefaults', { n: data.myDefaults })}</p>}
      {data.mine.length === 0 && <p className="muted">{t('tontine.noneMine')}</p>}
      {data.mine.map(card)}

      {creating ? (
        <form className="panel" onSubmit={submit} noValidate>
          <h3>{t('tontine.createTitle')}</h3>
          <label className="field">
            <span>{t('tontine.name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </label>
          <label className="field">
            <span>{t('tontine.amount')}</span>
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
            <small className="muted">{t('tontine.amountRange', { min: fcfa(cfg.minContribution), max: fcfa(cfg.maxContribution) })}</small>
          </label>
          <fieldset className="segmented">
            <legend>{t('tontine.period')}</legend>
            {cfg.periods.map((p) => (
              <button type="button" key={p} className={period === p ? 'seg active' : 'seg'} aria-pressed={period === p} onClick={() => setPeriod(p)}>{t('tontine.every', { days: p })}</button>
            ))}
          </fieldset>
          <label className="field">
            <span>{t('tontine.size', { n: size })}</span>
            <input type="range" min={cfg.minMembers} max={cfg.maxMembers} value={size} onChange={(e) => setSize(Number(e.target.value))} />
          </label>
          <p className="confirm">{t('tontine.preview', { pot: fcfa(Number(amount || 0) * size), days: period * size })}</p>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn primary big" disabled={busy}>{t('tontine.create')}</button>
          <button type="button" className="btn ghost" onClick={() => setCreating(false)}>{t('app.cancel')}</button>
        </form>
      ) : (
        <button className="btn big" onClick={() => setCreating(true)}>➕ {t('tontine.createTitle')}</button>
      )}

      <h3>{t('tontine.openTitle')}</h3>
      {data.open.length === 0 && <p className="muted">{t('tontine.noneOpen')}</p>}
      {data.open.map(card)}
      <p className="muted small-line">{t('tontine.rules', { penalty: cfg.missRespect })}</p>
    </section>
  );
}
