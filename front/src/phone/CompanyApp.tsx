import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  closeCompany, closeOffer, collectDocuments, createCompany, declareTaxes, fire, getCandidates, getEmployees, getMyOffers, hire, payPayroll, postOffer, registerCnss, selectCompany, sellCompany, startShift,
} from '../api/endpoints';
import type { Candidate, CompanyForm, Employee, MyOffers } from '../api/types';
import { fcfa, gameDuration, localName } from '../lib/format';
import { focusSection } from '../lib/focus';
import { useGame } from './ctx';
import { getClothes, type ClothesState } from '../api/endpoints';
import IndustryApp from './IndustryApp';

const FORMS: CompanyForm[] = ['EI', 'SARL', 'SA'];
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} '&.\-]{1,47}$/u;

/** Parcours réel de création et de gestion d'entreprise : CFE → RCCM/NIF → CNSS → salariés, paie → OTR. */
/**
 * Appli Entreprise : « Mon entreprise » (création, CFE, CNSS, OTR, salariés) et « Usines et sites » (usines, zones franches,
 * fermes et élevages, qui appartiennent aux entreprises du joueur).
 */
export default function CompanyApp({ initialTab = 'company' }: { initialTab?: 'company' | 'industry' }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'company' | 'industry'>(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  return (
    <>
      <div className="segmented">
        <button className={`seg ${tab === 'company' ? 'active' : ''}`} onClick={() => setTab('company')}>🏢 {t('company.tabCompany')}</button>
        <button className={`seg ${tab === 'industry' ? 'active' : ''}`} onClick={() => setTab('industry')}>🏭 {t('company.tabIndustry')}</button>
      </div>
      {tab === 'company' ? <CompanyMain onPlants={() => setTab('industry')} /> : <IndustryApp />}
    </>
  );
}

function CompanyMain({ onPlants }: { onPlants: () => void }) {
  const { t, i18n } = useTranslation();
  const { state, catalog, run, busy, goTo, closePhone, openApp } = useGame();
  const co = state.company;
  const [form, setForm] = useState<CompanyForm>('EI');
  const [name, setName] = useState('');
  const [activity, setActivity] = useState('pagnes');
  const [error, setError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [showReal, setShowReal] = useState(false);
  const [offers, setOffers] = useState<MyOffers | null>(null);
  const [roleIndex, setRoleIndex] = useState(0);
  const [gross, setGross] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [confirmExit, setConfirmExit] = useState<'sell' | 'close' | null>(null);
  /** Boutique de vêtements louée dans une boutique de mode : c'est aussi une entreprise du joueur. */
  const [clothes, setClothes] = useState<ClothesState | null>(null);
  useEffect(() => {
    void getClothes().then(setClothes).catch(() => setClothes(null));
  }, [state.wallet.balance]);
  const en = i18n.language === 'en';

  const loadStaff = useCallback(async () => {
    if (co?.status !== 'REGISTERED') return;
    const [e, c, o] = await Promise.all([run(getEmployees), run(getCandidates), run(getMyOffers)]);
    if (e) setEmployees(e);
    if (c) setCandidates(c);
    if (o) setOffers(o);
  }, [co?.status, co?.id, run]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  if (!catalog) return <p className="muted">{t('app.loading')}</p>;
  const cfg = catalog.company;
  const venueLabel = (id: string) => localName(catalog.venues.find((v) => v.id === id) ?? { nameFr: id, nameEn: id }, i18n.language);
  const fee = form === 'EI' ? cfg.cfe.feeEI : state.profile === 'FOREIGNER' ? cfg.cfe.feeSocietyNonEcowas : cfg.cfe.feeSociety;
  const capital = cfg.capitalMin[form];
  const balance = BigInt(state.wallet.balance);
  const at = (id: string) => state.location === id;
  const goBtn = (id: string) => (
    <button className="btn small" onClick={() => goTo(id)}>
      🗺️ {t('company.goTo', { place: t(`company.places.${id}`) })}
    </button>
  );

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    const n = name.trim().replace(/\s+/g, ' ');
    if (!NAME_RE.test(n)) return setError(t('company.nameInvalid'));
    const r = await run(() => createCompany(form, n, activity), (x) => t('company.filed', { fee: fcfa(x.result.fee) }));
    if (r) {
      setShowNew(false);
      setName('');
    }
  }

  const steps = [
    { k: 'form', done: !!co },
    { k: 'cfe', done: !!co },
    { k: 'docs', done: co?.status === 'REGISTERED' },
    { k: 'cnss', done: !!co?.cnssNumber },
    { k: 'otr', done: !!co && co.status === 'REGISTERED' && !co.declaration },
  ];

  const shop = clothes?.shop ?? null;
  const shopCard = shop && (
    <div className="panel company-card">
      <h3>🏪 {t('company.shopTitle')}</h3>
      <p className="muted">{t('company.shopKind')} · {venueLabel(shop.venueId)}</p>
      <dl className="docs">
        <dt>{t('company.shopStatus')}</dt>
        <dd>{shop.open ? t('clothes.shopOpenUntil', { day: shop.paidUntilDay }) : t('clothes.shopExpired')}</dd>
        <dt>{t('company.shopSales')}</dt>
        <dd className="mono">{fcfa(shop.sales)}</dd>
        <dt>{t('company.shopStock')}</dt>
        <dd>{shop.items.reduce((a, l) => a + l.qty, 0)}</dd>
      </dl>
      <div className="item-actions">
        <button className="btn small primary" onClick={() => (focusSection('clothes-mine'), openApp('clothes'))}>🏪 {t('company.shopManage')}</button>
      </div>
    </div>
  );

  return (
    <section className="company">
      {shopCard}
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.k} className={s.done ? 'done' : ''}>
            <span className="num">{s.done ? '✓' : i + 1}</span>
            <span>{t(`company.steps.${s.k}`)}</span>
          </li>
        ))}
      </ol>

      {co && co.companies.length > 0 && (
        <div className="panel">
          <h3>🏢 {t('company.myCompanies', { n: co.companies.length, max: co.maxCompanies })}</h3>
          <div className="chips" role="group">
            {co.companies.map((x) => (
              <button
                key={x.id}
                className={`chip-act ${x.id === co.id ? 'app' : ''}`}
                aria-pressed={x.id === co.id}
                disabled={busy || x.id === co.id}
                onClick={() => void run(() => selectCompany(x.id), () => t('company.selected', { name: x.name }))}
              >
                {x.name}
              </button>
            ))}
          </div>
          {co.companies.length < co.maxCompanies && !showNew && (
            <button className="btn small" onClick={() => setShowNew(true)}>➕ {t('company.openAnother')}</button>
          )}
        </div>
      )}

      {(!co || showNew) && (
        <div className="panel">
          {co && <button className="btn small ghost" onClick={() => setShowNew(false)}>✖ {t('company.cancelNew')}</button>}
          <h3>{t('company.createTitle')}</h3>
          <p className="muted">{t('company.createIntro')}</p>
          <button className="btn link" onClick={() => setShowReal((v) => !v)}>💡 {t('company.realLifeToggle')}</button>
          {showReal && <p className="notice">{t('company.realLife')}</p>}
          {!at('cfe') ? (
            <>
              <p className="warning">{t('company.mustBeAtCfe')}</p>
              {goBtn('cfe')}
            </>
          ) : (
            <form onSubmit={submit} noValidate>
              <fieldset className="choices">
                <legend>{t('company.form')}</legend>
                {FORMS.map((f) => (
                  <button type="button" key={f} className={form === f ? 'choice active' : 'choice'} aria-pressed={form === f} onClick={() => setForm(f)}>
                    <strong>{t(`company.forms.${f}`)}</strong>
                    <small>{t(`company.formHints.${f}`, { capital: fcfa(cfg.capitalMin[f]) })}</small>
                  </button>
                ))}
              </fieldset>
              <label className="field">
                <span>{t('company.name')}</span>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={48} />
              </label>
              <fieldset className="choices">
                <legend>{t('company.activity')}</legend>
                {cfg.activities.map((a) => (
                  <button type="button" key={a.id} className={activity === a.id ? 'choice active' : 'choice'} aria-pressed={activity === a.id} onClick={() => setActivity(a.id)}>
                    <strong>{localName(a, i18n.language)}</strong>
                    <small>{t('company.activityHint', { revenue: fcfa(a.revenue), cost: fcfa(a.cost), hours: a.shiftGameHours })}</small>
                  </button>
                ))}
              </fieldset>
              <p className="confirm">
                {t('company.fee', { fee: fcfa(fee) })}
                {capital > 0 && <> · {t('company.capital', { capital: fcfa(capital) })}</>}
                <small className="muted">{t('company.delay', { hours: cfg.cfe.delayGameHours })}</small>
              </p>
              {error && <p className="error" role="alert">{error}</p>}
              <button className="btn primary big" disabled={busy || balance < BigInt(fee + capital)}>
                {t('company.file', { fee: fcfa(fee) })}
              </button>
            </form>
          )}
        </div>
      )}

      {co && (
        <div className="panel company-card">
          <h3>{co.name}</h3>
          <p className="muted">
            {t(`company.forms.${co.form}`)} · {localName(cfg.activities.find((a) => a.id === co.activityId) ?? { nameFr: co.activityId, nameEn: co.activityId }, i18n.language)}
          </p>
          {co.status === 'PENDING_CFE' && (
            <>
              <p className="notice">{co.readyInGameHours > 0 ? t('company.processing', { time: gameDuration(co.readyInGameHours) }) : t('company.ready')}</p>
              {at('cfe') ? (
                <button className="btn primary big" disabled={busy || co.readyInGameHours > 0} onClick={() => void run(collectDocuments, (r) => t('company.collected', { rccm: r.result.rccm, nif: r.result.nif }))}>
                  📄 {t('company.collect')}
                </button>
              ) : (
                goBtn('cfe')
              )}
            </>
          )}
          {co.status === 'REGISTERED' && (
            // Usines, zones franches, fermes et élevages : ils appartiennent à une entreprise, et se gèrent dans l'appli Industrie
            <div className="item-actions">
              <button className="btn small" onClick={onPlants}>🏭 {t('company.plants')}</button>
            </div>
          )}
          {co.status === 'REGISTERED' && (
            <dl className="docs">
              <dt>RCCM</dt>
              <dd className="mono">{co.rccm}</dd>
              <dt>NIF</dt>
              <dd className="mono">{co.nif}</dd>
              <dt>CNSS</dt>
              <dd className="mono">{co.cnssNumber ?? t('company.notRegistered')}</dd>
            </dl>
          )}
        </div>
      )}

      {co && (
        <div className="panel">
          <h3>🔚 {t('company.exitTitle')}</h3>
          <p className="muted">{co.status === 'REGISTERED' ? t('company.exitText', { price: fcfa(co.salePrice) }) : t('company.exitTextPending')}</p>
          {confirmExit === null ? (
            <div className="item-actions">
              {co.status === 'REGISTERED' && BigInt(co.salePrice) > 0n && (
                <button className="btn small" disabled={busy} onClick={() => setConfirmExit('sell')}>💰 {t('company.sell')}</button>
              )}
              <button className="btn small ghost" disabled={busy} onClick={() => setConfirmExit('close')}>🔒 {t('company.close')}</button>
            </div>
          ) : (
            <>
              <p className="warning">{confirmExit === 'sell' ? t('company.sellConfirm', { name: co.name, price: fcfa(co.salePrice) }) : t('company.closeConfirm', { name: co.name })}</p>
              <div className="item-actions">
                <button
                  className="btn small danger"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => (confirmExit === 'sell' ? sellCompany(co.id) : closeCompany(co.id)),
                      (r) => (r.result.sold ? t('company.sold', { amount: fcfa(r.result.price) }) : t('company.closed')),
                    ).then(() => setConfirmExit(null))
                  }
                >
                  {t('company.confirm')}
                </button>
                <button className="btn small ghost" disabled={busy} onClick={() => setConfirmExit(null)}>{t('company.cancelNew')}</button>
              </div>
            </>
          )}
        </div>
      )}

      {co?.status === 'REGISTERED' && (
        <>
          <div className="panel">
            <h3>🛒 {t('company.workTitle')}</h3>
            <p className="muted">{t('company.workText')}</p>
            <button
              className="btn primary big"
              disabled={busy || !!state.shift || co.nextShiftInGameHours > 0}
              onClick={() => void run(() => startShift('company'), (r) => t('work.shiftStarted', { n: r.result.missions })).then((r) => r && closePhone())}
            >
              {co.nextShiftInGameHours > 0 ? t('work.nextIn', { time: gameDuration(co.nextShiftInGameHours) }) : t('company.openShop')}
            </button>
            <p className="small-line">{t('company.pendingRevenue', { amount: fcfa(co.pendingRevenue) })}</p>
          </div>

          {!co.cnssNumber && (
            <div className="panel">
              <h3>🏛️ {t('company.cnssTitle')}</h3>
              <p className="muted">{t('company.cnssText')}</p>
              {at('cnss') ? (
                <button className="btn primary big" disabled={busy} onClick={() => void run(registerCnss, () => t('company.cnssDone'))}>
                  {t('company.cnssRegister')}
                </button>
              ) : (
                goBtn('cnss')
              )}
            </div>
          )}

          <div className="panel">
            <h3>👥 {t('company.staffTitle', { n: employees?.length ?? 0, max: cfg.contributions.maxEmployees })}</h3>
            <p className="muted">{t('company.autoSaleHint')}</p>
            {employees?.length === 0 && <p className="muted">{t('company.noStaff')}</p>}
            <ul className="list">
              {employees?.map((e) => (
                <li key={e.id} className={e.late ? 'item danger-zone' : 'item'}>
                  <div className="item-main">
                    <strong>{e.name}{e.player && <span className="badge"> {t('company.player')}</span>}</strong>
                    <small>{en ? e.roleEn : e.roleFr} · {t('company.gross', { amount: fcfa(e.grossMonthly) })}</small>
                    <small>{t('company.netCost', { net: fcfa(e.net), cost: fcfa(e.employerCost) })}</small>
                    <small className={e.cnssNumber ? 'ok' : e.late ? 'down' : 'muted'}>
                      {e.cnssNumber ? `CNSS ${e.cnssNumber}` : e.late ? t('company.cnssLate') : t('company.cnssBefore', { day: e.cnssDeadlineDay })}
                    </small>
                  </div>
                  <button className="btn small ghost" disabled={busy} onClick={() => void run(() => fire(e.id), () => t('company.fired', { name: e.name })).then(loadStaff)}>
                    {t('company.fire')}
                  </button>
                </li>
              ))}
            </ul>
            {employees && employees.some((e) => e.unpaidMonths > 0 || e.late) && (
              <button className="btn primary big" disabled={busy} onClick={() => void run(payPayroll, (r) => t('company.paid', { paid: fcfa(r.result.paid), net: fcfa(r.result.net), social: fcfa(r.result.social) })).then(loadStaff)}>
                💸 {t('company.payNow')}
              </button>
            )}
            <h4>{t('company.candidates')}</h4>
            <ul className="list">
              {candidates?.map((c) => (
                <li key={c.id} className="item">
                  <div className="item-main">
                    <strong>{c.name}</strong>
                    <small>{en ? c.roleEn : c.roleFr} · {t('company.experience', { n: c.experienceYears })}</small>
                    <span className="price">{t('company.gross', { amount: fcfa(c.grossMonthly) })}</span>
                  </div>
                  <button className="btn small" disabled={busy || (employees?.length ?? 0) >= cfg.contributions.maxEmployees} onClick={() => void run(() => hire(c.id), (r) => t('company.hired', { name: c.name, day: r.result.cnssDeadlineDay })).then(loadStaff)}>
                    {t('company.hire')}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {offers && (
            <div className="panel">
              <h3>📢 {t('company.offersTitle')}</h3>
              <p className="muted">{t('company.offersText')}</p>
              {offers.offers.length === 0 && <p className="muted">{t('company.noOffers')}</p>}
              <ul className="list">
                {offers.offers.map((o) => (
                  <li key={o.id} className="item">
                    <div className="item-main">
                      <strong>{en ? o.roleEn : o.roleFr}</strong>
                      <small>{t('company.offerNet', { gross: fcfa(o.grossMonthly), net: fcfa(o.net) })}</small>
                    </div>
                    <button className="btn small ghost" disabled={busy} onClick={() => void run(() => closeOffer(o.id), () => t('company.offerClosed')).then(loadStaff)}>
                      {t('company.closeOffer')}
                    </button>
                  </li>
                ))}
              </ul>
              {offers.offers.length < offers.maxOpenOffers && (
                <form
                  noValidate
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    const g = Number(gross);
                    if (!Number.isInteger(g)) return;
                    void run(() => postOffer(roleIndex, g), () => t('company.published')).then(loadStaff);
                  }}
                >
                  <fieldset className="choices">
                    <legend>{t('company.role')}</legend>
                    {offers.roles.map((r, i) => (
                      <button type="button" key={r.fr} className={roleIndex === i ? 'choice active' : 'choice'} aria-pressed={roleIndex === i} onClick={() => setRoleIndex(i)}>
                        <strong>{en ? r.en : r.fr}</strong>
                      </button>
                    ))}
                  </fieldset>
                  <label className="field">
                    <span>{t('company.grossInput')}</span>
                    <input inputMode="numeric" value={gross} onChange={(e) => setGross(e.target.value.replace(/\D/g, ''))} placeholder={String(offers.minGross)} />
                    <small className="muted">{t('company.grossHint', { min: fcfa(offers.minGross), max: fcfa(offers.maxGross) })}</small>
                  </label>
                  <button className="btn primary" disabled={busy || !gross || Number(gross) < offers.minGross || Number(gross) > offers.maxGross}>
                    {t('company.publish')}
                  </button>
                </form>
              )}
            </div>
          )}

          <div className="panel">
            <h3>🧮 {t('company.otrTitle')}</h3>
            {co.declaration ? (
              <>
                <table className="payroll">
                  <tbody>
                    <tr><th>{t('company.decl.revenue')}</th><td>{fcfa(co.declaration.revenue)}</td></tr>
                    <tr><th>{t('company.decl.cnss')}</th><td>{fcfa(co.declaration.cnss)}</td></tr>
                    <tr><th>{t('company.decl.amu', { n: co.declaration.months })}</th><td>{fcfa(co.declaration.amu)}</td></tr>
                    <tr><th>{t('company.decl.otr')}</th><td>{fcfa(co.declaration.otr)}</td></tr>
                    {co.declaration.plantRevenue && BigInt(co.declaration.plantRevenue) > 0n && <tr><th className="muted">{t('company.decl.plants', { amount: fcfa(co.declaration.plantRevenue) })}</th><td /></tr>}
                    {co.declaration.overdueMonths > 0 && <tr><th className="down">{t('company.decl.penalty', { n: co.declaration.overdueMonths })}</th><td className="down">{fcfa(co.declaration.penalty)}</td></tr>}
                    <tr className="total"><th>{t('company.decl.total')}</th><td>{fcfa(co.declaration.total)}</td></tr>
                  </tbody>
                </table>
                {co.declaration.overdueMonths > 0 && <p className="warning">{t('company.lateWarning')}</p>}
                {at('otr') ? (
                  <button className="btn primary big" disabled={busy || balance < BigInt(co.declaration.total)} onClick={() => void run(declareTaxes, (r) => t('company.declared', { total: fcfa(r.result.total) }))}>
                    {t('company.declare', { total: fcfa(co.declaration.total) })}
                  </button>
                ) : (
                  goBtn('otr')
                )}
              </>
            ) : (
              <p className="ok">{t('company.upToDate')}</p>
            )}
            <p className="muted small-line">{t('company.ratesNote')}</p>
          </div>
        </>
      )}
    </section>
  );
}
