import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { advanceTender, applyToTender, getMyTenderApplications, getOpenTenders, type MyTenderApplication, type OpenTender } from '../api/endpoints';
import { fcfa, localName } from '../lib/format';
import { useGame } from './ctx';
import { errorText } from '../i18n';

type SubTab = 'open' | 'mine';

/** Marché public : l'État publie un besoin par secteur avec un budget PLAFOND et un nombre de séances de
 * travail nécessaires (coût de réalisation connu AVANT de candidater). Les entreprises immatriculées
 * candidatent avec leur propre prix et leur propre délai ; les meilleures candidatures (prix bas + délai
 * court) sont retenues à la date limite. Une fois retenu, il faut RÉELLEMENT travailler (bouton « Avancer »,
 * comme une séance de travail d'entreprise) jusqu'à terminer le projet ; le prix proposé est alors payé. */
export default function TendersApp() {
  const { t, i18n } = useTranslation();
  const { state, catalog, run, apply, busy, openApp, clock } = useGame();
  const [sub, setSub] = useState<SubTab>('open');
  const [open, setOpen] = useState<OpenTender[] | null>(null);
  const [mine, setMine] = useState<MyTenderApplication[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { price: string; hours: string }>>({});
  const [advancing, setAdvancing] = useState<Record<string, boolean>>({});
  const [advanceError, setAdvanceError] = useState<Record<string, string | null>>({});
  const [, forceTick] = useState(0);

  const load = useCallback(async () => {
    const [o, m] = await Promise.all([run(getOpenTenders), run(getMyTenderApplications)]);
    if (o) setOpen(o.tenders);
    if (m) setMine(m);
  }, [run]);

  useEffect(() => {
    void load();
  }, [load]);

  // Rafraîchit l'affichage du compte à rebours (cadence) régulièrement, sans refaire d'appel réseau.
  useEffect(() => {
    const id = window.setInterval(() => forceTick((x) => x + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  if (!catalog) return <p className="muted">{t('app.loading')}</p>;
  const sectorName = (id: string) => {
    const a = catalog.company.activities.find((x) => x.id === id);
    return a ? localName(a, i18n.language) : id;
  };
  const co = state.company;
  const eligible = co?.status === 'REGISTERED';

  const draftOf = (id: string, maxBudget: string, minHours: number) => drafts[id] ?? { price: maxBudget, hours: String(minHours) };
  const setDraft = (id: string, maxBudget: string, minHours: number, patch: Partial<{ price: string; hours: string }>) =>
    setDrafts((d) => ({ ...d, [id]: { ...draftOf(id, maxBudget, minHours), ...d[id], ...patch } }));

  async function submit(tn: OpenTender) {
    const d = draftOf(tn.id, tn.maxBudget, tn.minProposedHours);
    const price = Number(d.price);
    const hours = Number(d.hours);
    if (!Number.isInteger(price) || price < 1 || price > Number(tn.maxBudget)) return;
    if (!Number.isInteger(hours) || hours < tn.minProposedHours || hours > tn.maxHours) return;
    const ok = await run(() => applyToTender(tn.id, price, hours), () => t('tenders.applied'));
    if (ok) void load();
  }

  async function advance(a: MyTenderApplication) {
    setAdvanceError((m) => ({ ...m, [a.id]: null }));
    setAdvancing((m) => ({ ...m, [a.id]: true }));
    try {
      const r = await advanceTender(a.id);
      apply(r.state);
      void load();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'other';
      setAdvanceError((m) => ({ ...m, [a.id]: code }));
    } finally {
      setAdvancing((m) => ({ ...m, [a.id]: false }));
    }
  }

  function deadlineText(iso: string): string {
    return new Date(iso).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  }

  /** Heures de jeu restantes avant de pouvoir avancer de nouveau (cadence = une séance de travail de secteur). */
  function hoursUntilReady(a: MyTenderApplication): number {
    const last = a.lastAdvancedAt ?? a.startedAt;
    if (!last || a.shiftGameHours <= 0) return 0;
    const msPerGameHour = clock.msPerMinute() * 60;
    const readyAtMs = new Date(last).getTime() + a.shiftGameHours * msPerGameHour;
    const remainingMs = readyAtMs - Date.now();
    return remainingMs <= 0 ? 0 : Math.ceil(remainingMs / msPerGameHour);
  }

  return (
    <section className="tenders">
      <p className="muted">{t('tenders.intro')}</p>
      <nav className="chat-tabs" role="tablist">
        <button role="tab" aria-selected={sub === 'open'} className={sub === 'open' ? 'chat-tab active' : 'chat-tab'} onClick={() => setSub('open')}>{t('tenders.tabs.open')}</button>
        <button role="tab" aria-selected={sub === 'mine'} className={sub === 'mine' ? 'chat-tab active' : 'chat-tab'} onClick={() => setSub('mine')}>
          {t('tenders.tabs.mine')}{mine && mine.length > 0 ? ` (${mine.length})` : ''}
        </button>
      </nav>

      {!co && <p className="notice">{t('tenders.noCompany')}</p>}
      {co && !eligible && <p className="notice">{t('tenders.notRegistered')}</p>}

      {sub === 'open' && (
        <>
          {eligible && open?.length === 0 && <p className="muted">{t('tenders.empty')}</p>}
          {open?.map((tn) => {
            const d = draftOf(tn.id, tn.maxBudget, tn.minProposedHours);
            const price = Number(d.price);
            const hours = Number(d.hours);
            const overBudget = Number.isFinite(price) && price > Number(tn.maxBudget);
            const overDelay = Number.isFinite(hours) && hours > tn.maxHours;
            const underMinHours = Number.isFinite(hours) && hours < tn.minProposedHours;
            return (
              <div className="panel tender-card" key={tn.id}>
                <h3>🏛️ {i18n.language === 'en' ? tn.titleEn : tn.titleFr}</h3>
                <p className="small-line muted">{(tn.sectors && tn.sectors.length > 1 ? tn.sectors : [tn.sector]).map(sectorName).join(' · ')}</p>
                <p className="muted">{i18n.language === 'en' ? tn.descriptionEn : tn.descriptionFr}</p>
                <dl className="docs">
                  <dt>{t('tenders.slots')}</dt>
                  <dd>{tn.slots}</dd>
                  <dt>{t('tenders.maxBudgetLabel')}</dt>
                  <dd>{fcfa(tn.maxBudget)}</dd>
                  <dt>{t('tenders.maxHoursLabel')}</dt>
                  <dd>{t('tenders.hoursValue', { n: tn.maxHours })}</dd>
                  <dt>{t('tenders.requiredSessionsLabel')}</dt>
                  <dd>{t('tenders.sessionsValue', { n: tn.requiredSessions })}</dd>
                  <dt>{t('tenders.deadline')}</dt>
                  <dd>{deadlineText(tn.applicationDeadlineAt)}</dd>
                </dl>
                <p className="notice">{t('tenders.realizationCostNotice', { cost: fcfa(tn.realizationCost), n: tn.requiredSessions })}</p>
                <p className="small-line muted">{t('tenders.applicants', { n: tn.applicants })}</p>
                {tn.alreadyApplied ? (
                  <p className="ok">{t('tenders.alreadyApplied')}</p>
                ) : eligible ? (
                  <form
                    noValidate
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      void submit(tn);
                    }}
                  >
                    <label className="field">
                      <span>{t('tenders.priceLabel')}</span>
                      <input inputMode="numeric" value={d.price} onChange={(e) => setDraft(tn.id, tn.maxBudget, tn.minProposedHours, { price: e.target.value.replace(/\D/g, '') })} />
                      <small className={overBudget ? 'down' : 'muted'}>{t('tenders.priceHint', { max: fcfa(tn.maxBudget) })}</small>
                    </label>
                    <label className="field">
                      <span>{t('tenders.hoursLabel')}</span>
                      <input inputMode="numeric" value={d.hours} onChange={(e) => setDraft(tn.id, tn.maxBudget, tn.minProposedHours, { hours: e.target.value.replace(/\D/g, '') })} />
                      <small className={overDelay || underMinHours ? 'down' : 'muted'}>{t('tenders.hoursHint', { min: tn.minProposedHours, max: tn.maxHours })}</small>
                    </label>
                    <button className="btn primary big" disabled={busy || !d.price || !d.hours || overBudget || overDelay || underMinHours}>
                      {t('tenders.submit')}
                    </button>
                  </form>
                ) : null}
              </div>
            );
          })}
        </>
      )}

      {sub === 'mine' && (
        <>
          {mine?.length === 0 && <p className="muted">{t('tenders.mineEmpty')}</p>}
          {mine?.map((a) => {
            const pct = a.sessionsRequired > 0 ? Math.max(0, Math.min(100, Math.round((a.sessionsCompleted / a.sessionsRequired) * 100))) : 0;
            const remainingHours = hoursUntilReady(a);
            const err = advanceError[a.id];
            return (
              <div className="panel tender-card" key={a.id}>
                <h3>🏛️ {i18n.language === 'en' ? a.titleEn : a.titleFr}</h3>
                <p className="small-line muted">{sectorName(a.sector)}</p>
                <p className="muted">{i18n.language === 'en' ? a.descriptionEn : a.descriptionFr}</p>
                <p className="small-line">{t('tenders.myPriceLabel')} : {fcfa(a.proposedPrice)} · {t('tenders.proposedHours')} : {t('tenders.hoursValue', { n: a.proposedHours })}</p>
                {a.status === 'PENDING' && <p className="notice">{t('tenders.pending')}</p>}
                {(a.status === 'SELECTED' || a.status === 'PAID') && (
                  <>
                    <p className="small-line muted">{t('tenders.sessionsProgress', { done: a.sessionsCompleted, total: a.sessionsRequired })}</p>
                    <span className="bar progress"><span style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--adm-accent, #0a7d4f)' }} /></span>
                  </>
                )}
                {a.status === 'SELECTED' && (
                  <>
                    <p className="small-line muted">{a.endsAt ? t('tenders.endsAt', { date: deadlineText(a.endsAt) }) : ''}</p>
                    <button
                      className="btn primary"
                      disabled={busy || advancing[a.id] || remainingHours > 0}
                      onClick={() => void advance(a)}
                    >
                      {t('tenders.advance')}
                    </button>
                    {remainingHours > 0 && <p className="small-line muted">{t('tenders.notReadyYet', { hours: remainingHours })}</p>}
                    {err === 'insufficient_funds' && (
                      <div className="notice down">
                        <p>{t('tenders.insufficientFunds')}</p>
                        <button type="button" className="btn" onClick={() => openApp('bank')}>{t('tenders.goToBank')}</button>
                      </div>
                    )}
                    {err && err !== 'insufficient_funds' && <p className="down">{errorText(err)}</p>}
                  </>
                )}
                {a.status === 'PAID' && a.paidAt && <p className="ok">{t('tenders.paidOn', { date: deadlineText(a.paidAt), amount: fcfa(a.proposedPrice) })}</p>}
                {a.status === 'REJECTED' && <p className="down">{t('tenders.rejectedNote')}</p>}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
