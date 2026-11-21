import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { idempotencyKey } from '../api/client';
import { getHistory, lookupRecipient, searchRecipients, transfer, type RecipientMatch } from '../api/endpoints';
import type { HistoryEntry } from '../api/types';
import { transferFee } from '../lib/fees';
import { fcfa, localName } from '../lib/format';
import { parseAmount, stripInvisible, USERNAME, UUID_V4 } from '../lib/validate';
import { useGame } from './ctx';
import AccountGate from '../ui/AccountGate';

interface Pending {
  to: string;
  /** Nom affiché dans la confirmation (joueur retrouvé par son nom d'utilisateur). */
  label?: string;
  amount: number;
  fee: number;
  memo: string;
  key: string;
}

export default function WalletApp() {
  const { t, i18n } = useTranslation();
  const { state, catalog, run, busy, toast } = useGame();
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [to, setTo] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [memo, setMemo] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  // Suggestions de destinataires pendant la saisie (nom d'utilisateur ou identifiant)
  const [matches, setMatches] = useState<RecipientMatch[]>([]);
  const [picked, setPicked] = useState<RecipientMatch | null>(null);
  const searchSeq = useRef(0);
  useEffect(() => {
    const q = to.trim().replace(/^@/, '');
    if (picked || q.length < 2) {
      setMatches([]);
      return;
    }
    const seq = ++searchSeq.current;
    const id = window.setTimeout(() => {
      searchRecipients(q).then((r) => seq === searchSeq.current && setMatches(r), () => seq === searchSeq.current && setMatches([]));
    }, 250);
    return () => window.clearTimeout(id);
  }, [to, picked]);
  const pick = (m: RecipientMatch) => {
    setPicked(m);
    setTo(`@${m.username}`);
    setMatches([]);
  };

  const loadHistory = useCallback(async () => {
    const h = await run(() => getHistory(30));
    if (h) setHistory(h);
  }, [run]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const amount = parseAmount(amountStr);
  const fee = amount && catalog ? transferFee(amount, catalog.transferFee) : null;

  async function copyId() {
    try {
      await navigator.clipboard.writeText(state.id);
      toast(t('wallet.copied'));
    } catch {
      /* presse-papiers indisponible : l'identifiant reste sélectionnable à l'écran */
    }
  }

  async function review(ev: FormEvent) {
    ev.preventDefault();
    setFormError(null);
    // Le destinataire se désigne par son nom d'utilisateur (@nom) ou son identifiant : pas besoin d'être à côté de lui.
    let dest = to.trim().toLowerCase().replace(/^@/, '');
    let label: string | undefined;
    if (picked && dest === picked.username) {
      dest = picked.characterId;
      label = `@${picked.username} (${picked.name})`;
    } else if (USERNAME.test(dest)) {
      const found = await run(() => lookupRecipient(dest));
      if (!found) return;
      dest = found.characterId;
      label = `@${found.username} (${found.name})`;
    } else if (!UUID_V4.test(dest)) return setFormError(t('wallet.invalidRecipient'));
    if (dest === state.id.toLowerCase()) return setFormError(t('errors.same_wallet'));
    if (!amount) return setFormError(t('wallet.invalidAmount'));
    const m = stripInvisible(memo).trim();
    if (m.length > 80) return setFormError(t('wallet.invalidMemo'));
    if (!catalog || fee === null) return;
    if (BigInt(state.wallet.balance) < BigInt(amount + fee)) return setFormError(t('errors.insufficient_funds'));
    // La clé d'idempotence est figée à la confirmation : un nouvel essai ne peut pas débiter deux fois.
    setPending({ to: dest, label, amount, fee, memo: m, key: idempotencyKey() });
  }

  async function send() {
    if (!pending) return;
    const r = await run(
      () => transfer(pending.to, pending.amount, pending.memo || undefined, pending.key),
      (res) => (res.result.replay ? null : t('wallet.sent', { amount: fcfa(res.result.amount), fee: fcfa(res.result.fee) })),
    );
    if (r) {
      setPending(null);
      setTo('');
      setPicked(null);
      setAmountStr('');
      setMemo('');
      void loadHistory();
    }
  }

  // Mémos système (plat, métier, produit) : identifiants traduits via le catalogue.
  // Les mémos de TRANSFERT sont saisis par un autre joueur : jamais résolus via le catalogue (pas d'usurpation
  // d'un libellé système), nettoyés des caractères bidi/invisibles et isolés dans <bdi>.
  const memoNode = (h: HistoryEntry) => {
    if (!h.memo) return null;
    if (h.kind === 'TRANSFER') {
      const clean = stripInvisible(h.memo).trim();
      if (!clean) return null;
      return (
        <small className="memo">
          {t('wallet.senderMessage')} <bdi>{clean}</bdi>
        </small>
      );
    }
    const known = catalog ? [...catalog.foods, ...catalog.jobs, ...catalog.products].find((x) => x.id === h.memo) : undefined;
    return <small className="memo">{known ? localName(known, i18n.language) : stripInvisible(h.memo)}</small>;
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(i18n.language === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  };

  return (
    <section>
      <h2>{t('wallet.title')}</h2>
      <div className="panel wallet-card">
        <span className="muted">{t('wallet.balance')}</span>
        <strong className="big-money">{fcfa(state.wallet.balance)}</strong>
        <span className="muted">{t('wallet.myId')}</span>
        <div className="copy-row">
          <code className="mono selectable">{state.id}</code>
          <button className="btn small" onClick={() => void copyId()}>{t('wallet.copy')}</button>
        </div>
      </div>

      <div className="panel">
        <h3>{t('wallet.transfer')}</h3>
        {pending ? (
          <div>
            <h4>{t('wallet.confirmTitle')}</h4>
            <p>
              {t('wallet.confirmText', {
                amount: fcfa(pending.amount),
                recipient: pending.label ?? `${pending.to.slice(0, 8)}…`,
                fee: fcfa(pending.fee),
                total: fcfa(pending.amount + pending.fee),
              })}
            </p>
            <button className="btn primary big" disabled={busy} onClick={() => void send()}>{t('wallet.send')}</button>
            <button className="btn ghost" disabled={busy} onClick={() => setPending(null)}>{t('app.cancel')}</button>
          </div>
        ) : (
          <form onSubmit={review} noValidate>
            <label className="field">
              <span>{t('wallet.recipient')}</span>
              <input value={to} onChange={(e) => { setTo(e.target.value); setPicked(null); }} maxLength={37} role="combobox" aria-expanded={matches.length > 0} aria-autocomplete="list" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder={t('wallet.recipientHint')} />
            </label>
            {matches.length > 0 && (
              <ul className="suggest" role="listbox" aria-label={t('wallet.suggestions')}>
                {matches.map((m) => (
                  <li key={m.characterId} role="option" aria-selected={false}>
                    <button type="button" onClick={() => pick(m)}>
                      <strong>@{m.username}</strong> <span className="muted">{m.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className="field">
              <span>{t('wallet.amount')}</span>
              <input inputMode="numeric" value={amountStr} onChange={(e) => setAmountStr(e.target.value.replace(/[^\d]/g, '').slice(0, 9))} />
            </label>
            <label className="field">
              <span>{t('wallet.memo')}</span>
              <input value={memo} onChange={(e) => setMemo(stripInvisible(e.target.value))} maxLength={80} />
            </label>
            {amount && fee !== null && (
              <p className="muted">
                {t('wallet.fee', { fee: fcfa(fee) })} · {t('wallet.total', { total: fcfa(amount + fee) })}
              </p>
            )}
            {formError && <p className="error" role="alert">{formError}</p>}
            <AccountGate><button className="btn primary big" disabled={busy}>{t('wallet.review')}</button></AccountGate>
          </form>
        )}
      </div>

      <div className="panel">
        <div className="row-between">
          <h3>{t('wallet.history')}</h3>
          <button className="btn small ghost" disabled={busy} onClick={() => void loadHistory()}>{t('wallet.refresh')}</button>
        </div>
        {history === null ? (
          <p className="muted">{t('app.loading')}</p>
        ) : history.length === 0 ? (
          <p className="muted">{t('wallet.historyEmpty')}</p>
        ) : (
          <ul className="history">
            {history.map((h) => {
              const neg = h.amount.startsWith('-');
              return (
                <li key={h.id}>
                  <div>
                    <strong>{t(`wallet.kinds.${h.kind}`, { defaultValue: t('wallet.kinds.OTHER') })}</strong>
                    {memoNode(h)}
                    <small className="muted">{fmtDate(h.at)}</small>
                  </div>
                  <div className="amounts">
                    <span className={neg ? 'down' : 'up'}>{neg ? '' : '+'}{fcfa(h.amount)}</span>
                    <small className="muted">{fcfa(h.balanceAfter)}</small>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
