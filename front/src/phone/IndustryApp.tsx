import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getIndustry, getIndustryMarket, industryAttach, industryBuild, industryEquip, industryService, industryBuy, industryClearStock, industryCloseOffer, industryDeclare, industryFire, industryPayroll, industryPostOffer, industryBuyListing, industryBuyback, industryCollect, industryList, industryStaff, industryStake, industryUnlist,
  type IndustryKind, type IndustryListing, type IndustryMine, type IndustrySite, type IndustryView,
} from '../api/endpoints';
import PlantArt from './PlantArt';
import SearchSelect from '../ui/SearchSelect';
import { fcfa, gameDuration, localName } from '../lib/format';
import AccountGate from '../ui/AccountGate';
import QtyInput from '../ui/QtyInput';
import { useGame } from './ctx';

type Tab = 'sites' | 'mine' | 'market';
const KINDS: IndustryKind[] = ['FACTORY', 'FREE_ZONE', 'FARM', 'LIVESTOCK'];
const pct = (bp: number) => `${(bp / 100).toLocaleString(undefined, { maximumFractionDigits: 1 })} %`;

/** Industrie : usines et zones franches à acheter, personnel, grands investisseurs au capital, revente entre joueurs. */
export default function IndustryApp() {
  const { t, i18n } = useTranslation();
  const { run, busy, state, goTo, openApp } = useGame();
  const [tab, setTab] = useState<Tab>('sites');
  const [view, setView] = useState<IndustryView | null>(null);
  const [market, setMarket] = useState<IndustryListing[]>([]);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState<IndustryKind | 'ALL'>('ALL');
  const [query, setQuery] = useState('');
  // Entreprise au nom de laquelle on achète (un site appartient à une entreprise immatriculée)
  const [companyId, setCompanyId] = useState('');
  const load = useCallback(async () => {
    const [v, m] = await Promise.all([run(getIndustry), run(getIndustryMarket)]);
    if (v) setView(v);
    else setFailed(true);
    if (m) setMarket(m.listings);
  }, [run]);
  useEffect(() => {
    void load();
  }, [load, state.gameTime.hour]);
  // Entreprise choisie par défaut : la première immatriculée
  useEffect(() => {
    const regs = (view?.companies ?? []).filter((co) => co.status === 'REGISTERED');
    if (regs.length > 0 && !regs.some((co) => co.id === companyId)) setCompanyId(regs[0]!.id);
  }, [view, companyId]);
  const after = () => load();
  if (!view)
    return failed ? (
      <div className="panel">
        <p className="muted">{t('app.loadFailed')}</p>
        <button className="btn" onClick={() => (setFailed(false), void load())}>{t('app.retry')}</button>
      </div>
    ) : (
      <p className="muted">{t('app.loading')}</p>
    );
  const siteOf = (id: string) => view.sites.find((s) => s.id === id)!;
  return (
    <AccountGate>
      <div className="app-pad">
        <details className="ind-intro">
          <summary>{t('industry.introShort')}</summary>
          <p className="muted">{t('industry.intro')}</p>
        </details>
        <div className="segmented" role="tablist">
          {(['sites', 'mine', 'market'] as Tab[]).map((x) => (
            <button key={x} role="tab" aria-selected={tab === x} className={`seg ${tab === x ? 'active' : ''}`} onClick={() => setTab(x)}>
              {t(`industry.tab${x === 'sites' ? 'Sites' : x === 'mine' ? 'Mine' : 'Market'}`)}
              {x === 'mine' && view.mine.length > 0 ? ` (${view.mine.length})` : ''}
            </button>
          ))}
        </div>
        {(() => {
          const regs = (view.companies ?? []).filter((co) => co.status === 'REGISTERED');
          const chosen = regs.find((co) => co.id === companyId) ?? regs[0];
          return regs.length === 0 ? (
            <div className="ind-return wip">
              <p>🏢 {t('industry.needCompany')}</p>
              <button className="btn" onClick={() => openApp('company')}>{t('industry.openCompany')}</button>
            </div>
          ) : (
            <label className="ind-field">
              <span>🏢 {t('industry.buyingFor')}</span>
              <SearchSelect value={chosen?.id ?? ''} options={regs.map((co) => ({ value: co.id, label: co.name }))} onChange={setCompanyId} placeholder={t('industry.buyingFor')} searchLabel={t('industry.searchCompany')} empty={t('industry.noMatch')} />
            </label>
          );
        })()}
        {tab === 'sites' && (
          <>
            <div className="ind-kinds" role="group" aria-label={t('industry.kindFilter')}>
              {(['ALL', ...KINDS] as const).map((k) => (
                <button key={k} type="button" className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {t(`industry.kind.${k}`)}
                </button>
              ))}
            </div>
            <input className="ind-search" type="text" enterKeyHint="search" value={query} placeholder={t('industry.searchPh')} aria-label={t('industry.searchPh')} onChange={(e) => setQuery(e.target.value)} />
            {view.sites.filter((s) => (kind === 'ALL' || s.kind === kind) && matchSite(s, query)).length === 0 && <p className="muted">{t('industry.noMatch')}</p>}
            {view.sites.filter((s) => (kind === 'ALL' || s.kind === kind) && matchSite(s, query)).map((s) => <SiteCard key={s.id} s={s} busy={busy} run={run} lang={i18n.language} onChanged={after} companyId={companyId} />)}
          </>
        )}
        {tab === 'mine' && view.mine.length > 0 && (() => {
          // Impôt OTR de tous les sites : se déclare et se paie à l'OTR, comme pour une entreprise
          const due = view.mine.reduce((n, m) => n + BigInt(m.taxDue ?? '0'), 0n);
          const late = view.mine.some((m) => m.taxOverdue);
          return (
            <div className={`ind-return ${late ? 'wip' : ''}`}>
              <p>🏛️ {t('industry.taxInfo', { pct: pct(view.otrBp ?? 0), due: fcfa(due) })}</p>
              {late && <p>⚠️ {t('industry.taxLate')}</p>}
              {state.location === 'otr' ? (
                <button className="btn primary" disabled={busy || due <= 0n} onClick={() => void run(industryDeclare, (r) => t('industry.declared', { tax: fcfa(r.result.tax), penalty: fcfa(r.result.penalty) })).then(after)}>
                  {t('industry.declare')}
                </button>
              ) : (
                <button className="btn" onClick={() => goTo('otr')}>📍 {t('industry.goOtr')}</button>
              )}
            </div>
          );
        })()}
        {tab === 'mine' && view.mine.some((m) => (m.players ?? []).some((p) => p.unpaidMonths > 0)) && (
          <div className="ind-return wip">
            <p>👷 {t('industry.payrollDue', { n: view.mine.reduce((n, m) => n + (m.players ?? []).filter((p) => p.unpaidMonths > 0).length, 0) })}</p>
            <button className="btn primary" disabled={busy} onClick={() => void run(industryPayroll, (r) => t('industry.payrollDone', { net: fcfa(r.result.net), social: fcfa(r.result.social) })).then(after)}>
              {t('industry.payrollBtn')}
            </button>
          </div>
        )}
        {tab === 'mine' && (view.mine.length === 0 ? <p className="muted">{t('industry.noneMine')}</p> : view.mine.map((m) => <MineCard key={m.id} m={m} site={siteOf(m.catalogId)} taxBp={view.transferTaxBp} busy={busy} run={run} lang={i18n.language} onChanged={after} secondsPerGameDay={state.secondsPerGameDay} roles={view.jobRoles ?? []} smig={view.smig ?? 0} companies={(view.companies ?? []).filter((co) => co.status === 'REGISTERED')} />))}
        {tab === 'market' && (
          <>
            <small className="muted">{t('industry.soldTax', { pct: pct(view.transferTaxBp) })}</small>
            {market.length === 0 && <p className="muted">{t('industry.noListings')}</p>}
            {market.map((l) => (
              <div key={l.id} className="card">
                <div className="row-between">
                  <strong>{l.emoji} {localName(l, i18n.language)}</strong>
                  <b>{fcfa(l.ask)}</b>
                </div>
                <small className="muted">{t('industry.staff', { n: l.staff, max: l.maxStaff })}{l.investorBp > 0 ? ` · 🤝 ${pct(l.investorBp)}` : ''}</small>
                <button className="btn primary" disabled={busy || !companyId} onClick={() => void run(() => industryBuyListing(l.id, companyId), () => t('industry.bought2')).then(after)}>{t('industry.buyListing', { ask: fcfa(l.ask) })}</button>
              </div>
            ))}
          </>
        )}
      </div>
    </AccountGate>
  );
}

type RunFn = ReturnType<typeof useGame>['run'];

/** Recherche sans accents ni majuscules : nom (FR/EN), quartier, description. */
const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function matchSite(s: IndustrySite, q: string): boolean {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold([s.nameFr, s.nameEn, s.districtFr, s.districtEn, s.descFr, s.descEn].join(' '));
  return words.every((w) => hay.includes(w));
}

function SiteCard({ s, busy, run, lang, onChanged, companyId }: { s: IndustrySite; busy: boolean; run: RunFn; lang: string; onChanged: () => Promise<void>; companyId: string }) {
  const { t } = useTranslation();
  const name = localName(s, lang);
  return (
    <div className="card ind-card">
      <PlantArt id={s.id} kind={s.kind} label={name} />
      <div className="row-between">
        <strong>{s.emoji} {name}</strong>
        <b>{fcfa(s.price)}</b>
      </div>
      <small className="muted">{t(`industry.kind.${s.kind}`)} · {lang.startsWith('fr') ? s.districtFr : s.districtEn}</small>
      <p>{lang.startsWith('fr') ? s.descFr : s.descEn}</p>
      <small className="muted">{t('industry.staffCost', { max: s.maxStaff, gross: fcfa(s.grossWagePerDay ?? s.wagePerStaff), cost: fcfa(s.staffCostPerDay ?? s.wagePerStaff) })}</small>
      <br />
      <small className="muted">{t('industry.fullNet', { net: fcfa(s.fullNetPerDay) })}</small>
      {s.fullReturnBp !== undefined && (
        <p className="ind-return">📈 {t('industry.returnFull', { pct: pct(s.fullReturnBp), net: fcfa(s.fullNetPerDay) })}</p>
      )}
      {s.startupGameDays ? <small className="muted">⏳ {t('industry.startup', { days: s.startupGameDays })}</small> : null}
      {/* Deux façons de s'installer : racheter un site existant (vite en service) ou créer le sien (moins cher, construction plus longue) */}
      {s.buildPrice && (
        <div className="ind-return">
          <p>🏗️ {t('industry.buildInfo', { price: fcfa(s.buildPrice), days: s.buildDays ?? 0, built: s.built ?? 0 })}</p>
          <button className="btn primary" disabled={busy || !companyId} onClick={() => void run(() => industryBuild(companyId, s.id), () => t('industry.builtDone')).then(onChanged)}>
            {t('industry.build', { price: fcfa(s.buildPrice) })}
          </button>
        </div>
      )}
      {(() => {
        // Racheter un site existant : un seul bouton pour le premier site libre, et le nombre de sites encore disponibles
        const free = s.units.filter((u) => u.status === 'FREE');
        const mine = s.units.filter((u) => u.status === 'MINE').length;
        return (
          <div className="ind-buy">
            <small className="muted">
              {t('industry.buyExisting')} {t('industry.freeCount', { n: free.length, total: s.units.length })}{mine > 0 ? ` · ${t('industry.mineCount', { n: mine })}` : ''}
            </small>
            {free[0] ? (
              <button className="btn" disabled={busy || !companyId} onClick={() => void run(() => industryBuy(companyId, s.id, free[0]!.unit), () => t('industry.bought')).then(onChanged)}>
                {t('industry.buyOne', { n: free[0].unit + 1, price: fcfa(free[0].price) })}
              </button>
            ) : (
              <small className="muted">{t('industry.soldOut')}</small>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function MineCard({ m, site, taxBp, busy, run, lang, onChanged, secondsPerGameDay, roles, smig, companies }: { companies: { id: string; name: string }[]; m: IndustryMine; site: IndustrySite; taxBp: number; busy: boolean; run: RunFn; lang: string; onChanged: () => Promise<void>; secondsPerGameDay: number; roles: { id: string; nameFr: string; nameEn: string; maxGross: number }[]; smig: number }) {
  const { t } = useTranslation();
  const [staff, setStaff] = useState(m.staff);
  const [share, setShare] = useState<Record<string, number>>({});
  const [ask, setAsk] = useState(() => Number(site.price));
  const [roleId, setRoleId] = useState(() => roles[0]?.id ?? '');
  const [attachTo, setAttachTo] = useState(() => companies[0]?.id ?? '');
  const [gross, setGross] = useState(() => Math.max(smig, 60_000));
  const role = roles.find((r) => r.id === roleId);
  const fr = lang.startsWith('fr');
  useEffect(() => setStaff(m.staff), [m.staff]);
  return (
    <div className="card ind-card">
      <PlantArt id={site.id} kind={site.kind} label={localName(site, lang)} />
      <div className="row-between">
        <strong>{site.emoji} {localName(site, lang)}{site.units.length > 1 ? ` #${m.unit + 1}` : ''}</strong>
        <b>{fcfa(m.pending)}</b>
      </div>
      {m.companyId ? (
        <small className="muted">🏢 {t('industry.ownedBy', { name: m.companyName ?? '' })}</small>
      ) : (
        <div className="ind-return wip">
          <p>🏢 {t('industry.attachHint')}</p>
          {companies.length > 0 && (
            <div className="row-between">
              <SearchSelect value={attachTo} options={companies.map((co) => ({ value: co.id, label: co.name }))} onChange={setAttachTo} placeholder={t('industry.buyingFor')} searchLabel={t('industry.searchCompany')} empty={t('industry.noMatch')} />
              <button className="btn primary" disabled={busy || !attachTo} onClick={() => void run(() => industryAttach(m.id, attachTo), () => t('industry.attached')).then(onChanged)}>{t('industry.attach')}</button>
            </div>
          )}
        </div>
      )}
      <small className="muted">{t('industry.staff', { n: m.staff, max: m.maxStaff })} · {t('industry.net', { net: fcfa(m.netPerDay) })}</small>
      {m.readyAt ? (
        <p className="ind-return wip">⏳ {t('industry.starting', { time: gameDuration(remainingGameHours(m.readyAt, secondsPerGameDay)) })}</p>
      ) : m.staff > 0 ? (
        <p className="ind-return">📈 {t('industry.returnNow', { pct: pct(m.returnBp ?? 0), net: fcfa(m.netPerDay) })}</p>
      ) : (
        <p className="muted">{t('industry.noStaffNoReturn')}</p>
      )}
      {m.revenuePerDay && m.staff > 0 && (
        <small className="muted">{t('industry.money', { revenue: fcfa(m.revenuePerDay), wages: fcfa(m.wagesPerDay ?? '0'), net: fcfa(m.netPerDay) })}</small>
      )}
      <div className="row-between">
        <QtyInput value={staff} onChange={setStaff} min={0} max={m.maxStaff} label={t('industry.staffSet')} />
        <button className="btn" disabled={busy || staff === m.staff} onClick={() => void run(() => industryStaff(m.id, staff), () => t('industry.staffDone')).then(onChanged)}>{t('industry.staffSet')}</button>
      </div>
      {/* Aléas du jour : bonne ou mauvaise journée, ou incident propre au type de site */}
      {!m.readyAt && m.todayBp !== undefined && (
        <small className={m.todayBp === 0 || m.todayBp < 9_000 ? 'warn' : 'muted'}>
          {m.todayBp === 0 ? `⚠️ ${t(`industry.incident.${site.kind}`)}` : t(m.todayBp >= 10_000 ? 'industry.dayGood' : 'industry.dayBad', { pct: Math.abs(Math.round((m.todayBp - 10_000) / 100)) })}
          {m.fixedCostPerDay ? ` · ${t('industry.fixedCosts', { amount: fcfa(m.fixedCostPerDay) })}` : ''}
          {m.utilityBp ? ` · ${t('industry.utilities', { pct: pct(m.utilityBp) })}` : ''}
        </small>
      )}
      {/* Surproduction : invendus en stock, à brader tout de suite ou à garder pour une meilleure saison */}
      {!m.readyAt && m.demandBp !== undefined && (
        <small className={m.demandBp < 9_000 ? 'warn' : 'muted'}>
          {m.demandBp < 10_000 ? t('industry.demandLow', { pct: Math.round((10_000 - m.demandBp) / 100) }) : t('industry.demandHigh', { pct: Math.round((m.demandBp - 10_000) / 100) })}
        </small>
      )}
      {BigInt(m.stockValue ?? '0') > 0n && (
        <div className="ind-return wip">
          <p>📦 {t('industry.stock', { value: fcfa(m.stockValue ?? '0'), spoil: pct(m.spoilBp ?? 0) })}</p>
          <div className="row-actions">
            {[1_000, 2_000, 3_000, 4_000].map((d) => (
              <button key={d} className="btn small" disabled={busy} onClick={() => void run(() => industryClearStock(m.id, d), (r) => t('industry.cleared', { sold: fcfa(r.result.sold), got: fcfa(r.result.proceeds) })).then(onChanged)}>
                {t('industry.clearAt', { pct: d / 100 })}
              </button>
            ))}
          </div>
          <small className="muted">{t('industry.keepHint')}</small>
        </div>
      )}
      {BigInt(m.pending) < 0n ? (
        <button className="btn danger" disabled={busy} onClick={() => void run(() => industryCollect(m.id), (r) => t('industry.lossesCovered', { amount: fcfa(-BigInt(r.result.received)) })).then(onChanged)}>
          📉 {t('industry.losses', { amount: fcfa(-BigInt(m.pending)) })} · {t('industry.coverLosses')}
        </button>
      ) : (
        <button className="btn primary" disabled={busy || BigInt(m.pending) === 0n} onClick={() => void run(() => industryCollect(m.id), (r) => t('industry.collected', { amount: fcfa(r.result.received) })).then(onChanged)}>
          {t('industry.pending', { amount: fcfa(m.pending) })} · {t('industry.collect')}
        </button>
      )}

      {m.equipment && (
        // Équipements : forage (eau) et solaire (électricité), avec entretien régulier et pannes possibles
        <div className="ind-jobs">
          <h4>{t('industry.equipTitle')} · {t('industry.shares', { water: pct(m.equipment.waterBp), power: pct(m.equipment.powerBp) })}</h4>
          {(['borehole', 'solar'] as const).map((k) => {
            const eq = m.equipment!;
            const has = eq[k];
            const broken = k === 'borehole' ? eq.boreholeBroken : eq.solarBroken;
            const eff = k === 'borehole' ? eq.boreholeEffBp : eq.solarEffBp;
            const due = k === 'borehole' ? eq.boreholeDueIn : eq.solarDueIn;
            return (
              <div key={k} className="ind-return">
                <p><strong>{t(`industry.${k}`)}</strong></p>
                <small className="muted">{t(`industry.${k}Info`)}</small>
                {has && <small className={broken || eff < 10_000 ? 'warn' : 'muted'}>{broken ? `⚠️ ${t('industry.eqBroken')}` : eff < 10_000 ? `⚠️ ${t('industry.eqLate', { pct: pct(eff) })}` : t('industry.eqOk', { days: Math.max(0, due) })}</small>}
                {!has ? (
                  <button className="btn" disabled={busy} onClick={() => void run(() => industryEquip(m.id, k), () => t('industry.equipped')).then(onChanged)}>
                    {t('industry.install', { price: fcfa(k === 'borehole' ? eq.boreholePrice : eq.solarPrice) })}
                  </button>
                ) : (
                  <button className={`btn ${broken ? 'danger' : ''}`} disabled={busy} onClick={() => void run(() => industryService(m.id, k), (r) => t('industry.serviced', { price: fcfa(r.result.paid ?? '0') })).then(onChanged)}>
                    {broken ? t('industry.repair', { price: fcfa(k === 'borehole' ? eq.boreholeRepair : eq.solarRepair) }) : t('industry.service', { price: fcfa(k === 'borehole' ? eq.boreholeService : eq.solarService) })}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Joueurs salariés du site, offres d'emploi ouvertes et publication d'un poste */}
      <div className="ind-jobs">
        <h4>{t('industry.playersTitle', { n: (m.players ?? []).length })}</h4>
        {(m.players ?? []).map((p) => (
          <div key={p.id} className="row-between">
            <span>👷 {p.name} · {fr ? p.roleFr : p.roleEn} · {fcfa(p.grossMonthly)}{p.unpaidMonths > 0 ? ` · ⚠️ ${t('industry.unpaid', { n: p.unpaidMonths })}` : ''}</span>
            <button className="btn ghost small" disabled={busy} onClick={() => void run(() => industryFire(p.id), () => t('industry.fired', { name: p.name })).then(onChanged)}>{t('industry.fire')}</button>
          </div>
        ))}
        {(m.offers2 ?? []).map((o) => (
          <div key={o.id} className="row-between">
            <span>📢 {fr ? o.roleFr : o.roleEn} · {fcfa(o.grossMonthly)} {t('industry.perMonth')}</span>
            <button className="btn ghost small" disabled={busy} onClick={() => void run(() => industryCloseOffer(o.id), () => t('industry.offerClosed')).then(onChanged)}>{t('industry.closeOffer')}</button>
          </div>
        ))}
        {roles.length > 0 && (
          <div className="row-between">
            <SearchSelect value={roleId} options={roles.map((r) => ({ value: r.id, label: fr ? r.nameFr : r.nameEn, hint: `≤ ${fcfa(r.maxGross)}` }))} onChange={setRoleId} placeholder={t('industry.role')} searchLabel={t('industry.role')} empty={t('industry.noMatch')} />
            <input type="number" min={smig} max={role?.maxGross} value={gross} aria-label={t('industry.grossMonthly')} onChange={(e) => setGross(Math.max(0, Number(e.target.value) || 0))} />
            <button className="btn" disabled={busy || !role} onClick={() => void run(() => industryPostOffer(m.id, roleId, gross), () => t('industry.offerPosted')).then(onChanged)}>📢 {t('industry.postOffer')}</button>
          </div>
        )}
        {role && <small className="muted">{t('industry.salaryRange', { min: fcfa(smig), max: fcfa(role.maxGross) })}</small>}
      </div>

      {m.investor ? (
        <>
          <p>{m.investor.emoji} {t('industry.investorHere', { name: localName(m.investor, lang), pct: pct(m.investor.shareBp) })}</p>
          <button className="btn" disabled={busy || !!m.ask} onClick={() => void run(() => industryBuyback(m.id), (r) => t('industry.buybackDone', { price: fcfa(r.result.paid) })).then(onChanged)}>{t('industry.buybackBtn', { price: fcfa(m.investor.buyback) })}</button>
        </>
      ) : (
        m.offers.length > 0 && !m.ask && (
          <>
            <h4>{t('industry.investors')}</h4>
            {m.offers.map((o) => {
              const bp = share[o.id] ?? Math.min(o.maxShareBp, 2_000);
              const amount = (BigInt(o.valuation) * BigInt(bp)) / 10_000n;
              return (
                <div key={o.id} className="ld-use">
                  <strong>{o.emoji} {localName(o, lang)}</strong>
                  <small className="muted">{lang.startsWith('fr') ? o.bioFr : o.bioEn}</small>
                  <small className="muted">{t('industry.stakeInfo', { value: fcfa(o.valuation), max: pct(o.maxShareBp) })}</small>
                  <input type="range" min={500} max={o.maxShareBp} step={100} value={bp} aria-label={t('industry.investors')} onChange={(e) => setShare({ ...share, [o.id]: Number(e.target.value) })} />
                  <button className="btn" disabled={busy} onClick={() => void run(() => industryStake(m.id, o.id, bp), (r) => t('industry.stakeDone', { name: localName(o, lang), amount: fcfa(r.result.received) })).then(onChanged)}>{t('industry.stakeBtn', { pct: pct(bp), amount: fcfa(amount) })}</button>
                </div>
              );
            })}
          </>
        )
      )}

      {m.ask ? (
        <>
          <p>{t('industry.listing', { ask: fcfa(m.ask) })}</p>
          <button className="btn" disabled={busy} onClick={() => void run(() => industryUnlist(m.id), () => t('industry.unlisted')).then(onChanged)}>{t('industry.unlist')}</button>
        </>
      ) : (
        <div className="row-between">
          <input type="number" min={1} value={ask} aria-label={t('industry.ask')} onChange={(e) => setAsk(Math.max(1, Number(e.target.value) || 1))} />
          <button className="btn" disabled={busy} onClick={() => void run(() => industryList(m.id, ask), () => t('industry.listed2')).then(onChanged)}>🏷️ {t('industry.list')}</button>
        </div>
      )}
      <small className="muted">{t('industry.soldTax', { pct: pct(taxBp) })}</small>
    </div>
  );
}

/** Heures de jeu restantes jusqu'à une date réelle. */
function remainingGameHours(iso: string, secondsPerGameDay: number): number {
  const ms = new Date(iso).getTime() - Date.now();
  return ms <= 0 ? 0 : (ms / 1000) * (24 / (secondsPerGameDay || 3600));
}
