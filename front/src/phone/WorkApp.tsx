import { useCallback, useEffect, useMemo, useState } from 'react';
import { consumeFocusSection } from '../lib/focus';
import { useTranslation } from 'react-i18next';
import { acceptOffer, claimSalary, getCourses, getJobBoard, getStudy, type StudyState, getPlayerJob, quitJob, resignPlayerJob, startShift, zemContract, takeJob, type CourseInfo } from '../api/endpoints';
import type { BoardOffer, Job, PlayerJob } from '../api/types';
import { fcfa, gameDuration, localName } from '../lib/format';
import { ZemBikePicker } from '../ui/ZemBikeSheet';
import { meetsReq, reqOptions } from '../lib/study';
import { useGame } from './ctx';
import { matches } from '../lib/search';

/** Heures de jeu restantes, décomptées en local depuis la dernière mise à jour de l'état. */
export function useCountdown(hours: number, secondsPerGameDay: number): number {
  const [left, setLeft] = useState(hours);
  useEffect(() => {
    const start = performance.now();
    setLeft(hours);
    if (hours <= 0) return;
    const id = window.setInterval(() => {
      const elapsedGameH = ((performance.now() - start) / 1000) * (24 / secondsPerGameDay);
      setLeft(Math.max(0, hours - elapsedGameH));
    }, 1000);
    return () => window.clearInterval(id);
  }, [hours, secondsPerGameDay]);
  return left;
}

type JobStatus = 'active' | 'held' | 'available' | 'locked';
const LEVEL_WEIGHT: Record<string, number> = { DEBROUILLE: 0, QUALIFIE: 1, DIPLOME: 2, ENTREPRENEUR: 2 };

/** Difficulté affichée (1 à 3) : niveau requis, effort physique du service et risque d'incident. */
function difficulty(j: Job): number {
  const effort = j.energyCost + j.hungerCost + j.hygieneCost;
  const score = (LEVEL_WEIGHT[j.level] ?? 1) + (effort >= 50 ? 1 : 0) + (j.riskPercent >= 5 ? 1 : 0);
  return Math.min(3, Math.max(1, score));
}

const workHours = (h: [number, number] | undefined): string => (!h || (h[0] === 0 && h[1] === 24) ? '24 h/24' : `${h[0]} h – ${h[1] % 24} h`);

type Tab = 'mine' | 'offers';
const TAB_ICON: Record<Tab, string> = { mine: '💼', offers: '🔎' };

export default function WorkApp() {
  const { t, i18n } = useTranslation();
  const { catalog, state, run, busy, openApp, closePhone } = useGame();
  const left = useCountdown(state.nextWorkInGameHours, state.secondsPerGameDay || 3600);
  const [pickBike, setPickBike] = useState(false);
  const [board, setBoard] = useState<BoardOffer[] | null>(null);
  const [playerJob, setPlayerJob] = useState<PlayerJob | null>(null);
  const [courses, setCourses] = useState<CourseInfo[] | null>(null);
  const [study, setStudy] = useState<StudyState | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'locked'>('all');
  const [tab, setTab] = useState<Tab>(() => (consumeFocusSection() === 'work-offers' ? 'offers' : 'mine'));
  const [allBoard, setAllBoard] = useState(false);
  const en = i18n.language === 'en';
  const loadPlayerJobs = useCallback(async () => {
    const [b, m, c, sd] = await Promise.all([run(getJobBoard), run(getPlayerJob), run(getCourses), run(getStudy)]);
    if (sd) setStudy(sd);
    if (b) setBoard(b);
    if (m) setPlayerJob(m.job);
    if (c) setCourses(c);
  }, [run]);
  useEffect(() => {
    void loadPlayerJobs();
  }, [loadPlayerJobs]);
  const jobs = useMemo(() => {
    const currentId = state.job?.id;
    const heldIds = new Set(state.jobs.map((x) => x.id));
    return (catalog?.jobs ?? []).map((j) => {
      const needsDiploma = j.level !== 'DEBROUILLE';
      const course = courses?.find((c) => c.unlocks.includes(j.id));
      const req = study?.jobReq[j.id];
      const byDiploma = !!req && meetsReq(req, study?.diplomas ?? []);
      const status: JobStatus = currentId === j.id ? 'active' : heldIds.has(j.id) ? 'held' : needsDiploma && !course?.completed && !byDiploma ? 'locked' : 'available';
      return { j, needsDiploma, course, status, req, byDiploma };
    });
  }, [catalog, courses, study, state.job?.id, state.jobs]);
  const categories = useMemo(() => [...new Set(jobs.map(({ j }) => j.category))], [jobs]);
  const shown = jobs.filter(({ j, status }) => {
    if (category && j.category !== category) return false;
    if (statusFilter === 'available' && status === 'locked') return false;
    if (statusFilter === 'locked' && status !== 'locked') return false;
    return matches(query, j.nameFr, j.nameEn, j.descFr, j.descEn);
  });
  if (!catalog) return <p className="muted">{t('app.loading')}</p>;
  const job = state.job;
  /** Métier salarié actif sans embauche en cours : il faut d'abord postuler. */
  const needsContract = job?.payMode === 'MONTHLY' && playerJob?.publicJobId !== job.id;
  const credentials = courses?.filter((c) => c.completed) ?? [];
  const venueName = (id?: string | null) => (id ? localName(catalog.venues.find((v) => v.id === id) ?? { nameFr: id, nameEn: id }, i18n.language) : t('work.publicEmployer'));

  return (
    <section>
      <h2>{t('work.title')}</h2>
      <div className="chat-tabs" role="tablist">
        {(['mine', 'offers'] as Tab[]).map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'chat-tab active' : 'chat-tab'} onClick={() => setTab(x)}>
            {TAB_ICON[x]} {t(`work.tabs.${x}`)}
          </button>
        ))}
      </div>
      {tab === 'mine' && (
        <>
      <div className="panel">
        <h3>🎓 {t('work.credentialsTitle')}</h3>
        {credentials.length === 0 && !(study?.diplomas.length) ? (
          <p className="muted">{t('work.credentialsEmpty')}</p>
        ) : (
          <ul className="list compact">
            {study && (
              <li className="item current">
                <span>🎓 {t('study.bac')}</span>
                <span className="badge ok">{t('work.credentialEarned')}</span>
              </li>
            )}
            {study?.diplomas.map((d) => {
              const dom = study.domains.find((x) => x.id === d.domain);
              return (
                <li key={`${d.kind}-${d.domain}`} className="item current">
                  <span>🎓 {t(`study.kind.${d.kind}`)} · {d.series ? `${d.series.toUpperCase()} · ` : ''}{dom ? `${dom.emoji} ${localName(dom, i18n.language)}` : d.domain}</span>
                  <span className="badge ok">{t('work.credentialEarned')}</span>
                </li>
              );
            })}
            {credentials.map((c) => (
              <li key={c.id} className="item current">
                <span>{c.emoji} {localName(c, i18n.language)}</span>
                <span className="badge ok">{t('work.credentialEarned')}</span>
              </li>
            ))}
          </ul>
        )}
        <button className="btn small ghost" onClick={() => openApp('study')}>{t('work.openTraining')}</button>
      </div>
      {state.jobs.length > 0 && (
        <div className="panel">
          <h3>💼 {t('work.myJobs', { n: state.jobs.length, max: state.maxJobs })}</h3>
          <ul className="list compact">
            {state.jobs.map((x) => (
              <li key={x.id} className={`item ${x.id === job?.id ? 'current' : ''}`}>
                <span>{x.emoji} {localName(x, i18n.language)} · {x.payMode === 'MONTHLY' ? t('work.payMode.MONTHLY') : fcfa(x.payPerShift)}{x.nextInGameHours > 0 ? ` · ${gameDuration(x.nextInGameHours)}` : ` · ${t('work.ready')}`}</span>
                <span className="item-actions">
                  {x.id !== job?.id && <button className="btn small" disabled={busy} onClick={() => void run(() => takeJob(x.id), () => t('work.chosen', { job: localName(x, i18n.language) }))}>{t('work.switchTo')}</button>}
                  <button className="btn small ghost" disabled={busy} onClick={() => void run(() => quitJob(x.id), () => (x.payMode === 'MONTHLY' ? t('work.resigned') : t('work.quitDone'))).then(loadPlayerJobs)}>{x.payMode === 'MONTHLY' ? t('work.resign') : t('work.quit')}</button>
                </span>
              </li>
            ))}
          </ul>
          <small className="muted">{t('work.multiHint', { max: state.maxJobs })}</small>
        </div>
      )}
      {job ? (
        <div className="panel">
          <p className="muted">{t('work.current')}</p>
          <h3>{localName(job, i18n.language)}</h3>
          <p>
            <span className={`chip pay-mode ${job.payMode === 'MONTHLY' ? 'monthly' : 'task'}`}>{job.payMode === 'MONTHLY' ? '📅' : '💰'} {t(`work.payMode.${job.payMode}`)}</span>{' '}
            {job.payMode === 'MONTHLY' ? t('work.monthlyHint') : t('work.pay', { amount: fcfa(job.payPerShift) })} · {t('work.shift', { hours: job.shiftGameHours })}
          </p>
          {needsContract && <p className="warning">{t('work.needsContract')} <button type="button" className="btn small" onClick={() => setTab('offers')}>{t('work.apply')}</button></p>}
          <p className={left > 0 ? 'muted' : 'ok'}>{left > 0 ? t('work.nextIn', { time: gameDuration(left) }) : t('work.ready')}</p>
          {pickBike && state.zemBike ? (
            <ZemBikePicker
              state={state}
              busy={busy}
              onStart={(bike) => void run(() => startShift('job', bike), (r) => t('work.shiftStarted', { n: r.result.missions })).then((r) => {
                if (!r) return;
                // Séance lancée : on referme le choix de moto et le téléphone, pour pouvoir choisir la destination de la mission sur la carte
                setPickBike(false);
                closePhone();
              })}
              onContract={(action) => void run(() => zemContract(action), () => (action === 'sign' ? t('work.zemBike.contractOn', { amount: fcfa(state.zemBike!.ownerFee) }) : null))}
            />
          ) : (
            <button
              className="btn primary big"
              disabled={busy || left > 0 || !!state.shift || needsContract}
              onClick={() => (job.id === 'zem_driver' && state.zemBike ? setPickBike(true) : void run(() => startShift('job'), (r) => t('work.shiftStarted', { n: r.result.missions })).then((r) => r && closePhone()))}
            >
              {t('work.workNow')}
            </button>
          )}
          {/* Changer de métier à tout moment : démissionner d'un emploi salarié ou quitter un métier à la tâche */}
          <button className="btn ghost small" disabled={busy} onClick={() => void run(() => quitJob(job.id), () => (job.payMode === 'MONTHLY' ? t('work.resigned') : t('work.quitDone'))).then(loadPlayerJobs)}>
            {job.payMode === 'MONTHLY' ? `🚪 ${t('work.resign')}` : `🚪 ${t('work.quit')}`}
          </button>
        </div>
      ) : (
        <p className="muted">{t('work.none')}</p>
      )}
      {playerJob ? (
        <div className="panel">
          <h3>🤝 {t('work.playerJobTitle')}</h3>
          {playerJob.publicJobId ? (
            <>
              <p>{t('work.publicJobAt', { role: en ? playerJob.roleEn : playerJob.roleFr, place: venueName(playerJob.venueId) })}</p>
              <p className="muted">{t('work.playerJobPay', { gross: fcfa(playerJob.grossMonthly), net: fcfa(playerJob.net) })}</p>
              <p className="muted">{t('work.salaryRule', { n: playerJob.minShifts ?? 0 })}</p>
              {playerJob.unpaidMonths > 0 && (
                <button className="btn primary" disabled={busy} onClick={() => void run(claimSalary, (r) => (r.result.paidMonths > 0 ? t('work.salaryPaid', { amount: fcfa(Number(r.result.net)) }) : t('work.salaryNone'))).then(loadPlayerJobs)}>
                  {t('work.claimSalary', { n: playerJob.unpaidMonths })}
                </button>
              )}
            </>
          ) : (
            <>
              <p>{t('work.playerJobAt', { role: en ? playerJob.roleEn : playerJob.roleFr, company: playerJob.company, boss: playerJob.boss })}</p>
              <p className="muted">{t('work.playerJobPay', { gross: fcfa(playerJob.grossMonthly), net: fcfa(playerJob.net) })}</p>
              {playerJob.unpaidMonths > 0 && <p className="warning">{t('work.playerJobUnpaid', { n: playerJob.unpaidMonths })}</p>}
            </>
          )}
          <button className="btn ghost" disabled={busy} onClick={() => void run(resignPlayerJob, () => t('work.resigned')).then(loadPlayerJobs)}>
            {t('work.resign')}
          </button>
        </div>
      ) : (
        board && (
          <div className="panel">
            <h3>🤝 {t('work.boardTitle')}</h3>
            {board.length === 0 && <p className="muted">{t('work.boardEmpty')}</p>}
            <ul className="list">
              {(allBoard ? board : board.slice(0, 8)).map((o) => {
                const locked = !!o.publicJobId && jobs.find((x) => x.j.id === o.publicJobId)?.status === 'locked';
                return (
                  <li key={o.id} className={`item ${locked ? 'locked' : ''}`}>
                    <div className="item-main">
                      <strong>{en ? o.roleEn : o.roleFr}</strong>
                      <small>{o.publicJobId ? t('work.boardPublic', { place: venueName(o.venueId), level: t(`work.levels.${o.level}`, { defaultValue: o.level ?? '' }) }) : t('work.boardBy', { company: o.company, boss: o.boss })}</small>
                      <span className="price">{t('work.boardPay', { gross: fcfa(o.grossMonthly), net: fcfa(o.net) })}</span>
                      {o.publicJobId && <small className={locked ? 'warning' : 'muted'}>{locked ? t('work.lockedHint') : t('work.salaryRule', { n: o.minShifts ?? 0 })}</small>}
                    </div>
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() => (locked ? openApp('study') : void run(() => acceptOffer(o.id), (r) => (o.publicJobId ? t('work.hiredPublic', { role: en ? (r.result.roleEn ?? '') : (r.result.role ?? '') }) : t('work.hiredBy', { company: r.result.company }))).then(loadPlayerJobs))}
                    >
                      {locked ? t('work.getQualified') : t('work.apply')}
                    </button>
                  </li>
                );
              })}
            </ul>
            {board.length > 8 && (
              <button className="btn small ghost" onClick={() => setAllBoard(!allBoard)}>
                {allBoard ? t('work.boardLess') : t('work.boardMore', { n: board.length - 8 })}
              </button>
            )}
          </div>
        )
      )}
        </>
      )}
      {tab === 'offers' && (
        <>
      {playerJob && (
        <div className="notice">
          <p>{t('work.employedNotice', { role: en ? playerJob.roleEn : playerJob.roleFr })}</p>
          <button className="btn small" disabled={busy} onClick={() => void run(resignPlayerJob, () => t('work.resigned')).then(loadPlayerJobs)}>🚪 {t('work.resign')}</button>
        </div>
      )}
      <input className="catalog-search" type="search" placeholder={t('work.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="chips" role="group">
        <button className={`chip-act ${category === null ? 'app' : ''}`} onClick={() => setCategory(null)}>{t('work.categoryAll')}</button>
        {categories.map((c) => (
          <button key={c} className={`chip-act ${category === c ? 'app' : ''}`} onClick={() => setCategory(category === c ? null : c)}>
            {t(`work.categories.${c}`, { defaultValue: c })}
          </button>
        ))}
      </div>
      <div className="segmented job-status-filter">
        {(['all', 'available', 'locked'] as const).map((f) => (
          <button key={f} className={`seg ${statusFilter === f ? 'active' : ''}`} onClick={() => setStatusFilter(f)}>{t(`work.statusFilter.${f}`)}</button>
        ))}
      </div>
      {state.jobs.length >= state.maxJobs && <p className="notice">{t('work.replaceNote', { max: state.maxJobs })}</p>}
      {shown.length === 0 && <p className="muted">{t('work.noMatch')}</p>}
      <ul className="list stacked">
        {shown.map(({ j, needsDiploma, course, status, req, byDiploma }) => {
          const locked = status === 'locked';
          const level = difficulty(j);
          return (
            <li key={j.id} className={`item job-card ${locked ? 'locked' : ''} ${status === 'active' ? 'current' : ''}`}>
              <div className="item-main">
                <div className="job-head">
                  <span className="job-emoji" aria-hidden>{j.emoji}</span>
                  <strong>{localName(j, i18n.language)}</strong>
                  <span className={`badge ${status === 'active' ? 'ok' : ''}`}>{t(`work.status.${status}`)}</span>
                </div>
                <div className="job-tags">
                  <span className="chip">{t(`work.categories.${j.category}`, { defaultValue: j.category })}</span>
                  <span className="chip">{t(`work.levels.${j.level}`, { defaultValue: j.level })}</span>
                  <span className={`chip pay-mode ${j.payMode === 'MONTHLY' ? 'monthly' : 'task'}`}>{j.payMode === 'MONTHLY' ? '📅' : '💰'} {t(`work.payMode.${j.payMode}`)}</span>
                  <span className="chip" title={t('work.difficulty', { level: t(`work.difficultyLevels.${level}`) })}>
                    {'●'.repeat(level)}{'○'.repeat(3 - level)} {t(`work.difficultyLevels.${level}`)}
                  </span>
                </div>
                {(en ? j.descEn : j.descFr) && <small>{en ? j.descEn : j.descFr}</small>}
                {j.payMode === 'MONTHLY' ? (
                  <>
                    <span className="price">{(() => { const o = board?.find((x) => x.publicJobId === j.id); return o ? t('work.boardPay', { gross: fcfa(o.grossMonthly), net: fcfa(o.net) }) : t('work.payMode.MONTHLY'); })()}</span>
                    <small>{t('work.monthlyHint')}</small>
                  </>
                ) : (
                  <>
                    <span className="price">{t('work.pay', { amount: fcfa(j.payPerShift) })}</span>
                    <small>{t('work.taskHint')}</small>
                  </>
                )}
                <small>{t('work.shift', { hours: j.shiftGameHours })}{j.riskPercent > 0 ? ` · ${t('work.risk', { percent: j.riskPercent })}` : ''}</small>
                {catalog.workPlaces[j.id] && (
                  <small>
                    📍 {t('work.workplace', { place: localName(catalog.venues.find((v) => v.id === catalog.workPlaces[j.id]) ?? { nameFr: catalog.workPlaces[j.id]!, nameEn: catalog.workPlaces[j.id]! }, i18n.language) })}
                    {' · '}🕒 {catalog.workAnyHour.includes(j.id) ? t('work.anyHour') : t('work.hoursAt', { time: workHours(catalog.hours[catalog.workPlaces[j.id]!]) })}
                  </small>
                )}
                <small>{t('work.costs', { energy: j.energyCost, hunger: j.hungerCost, hygiene: j.hygieneCost })}</small>
                <small className={locked ? 'warning' : needsDiploma ? 'ok' : 'muted'}>
                  🎓 {!needsDiploma
                    ? t('work.noQualification')
                    : req
                      ? reqOptions(req).length > 1
                        ? t(byDiploma ? 'work.degreeMatchedAny' : 'work.degreeRequiredAny', {
                            options: reqOptions(req).map((o) => `${t(`study.kind.${o.min}`)} (${(o.domains ?? []).map((d) => study?.domains.find((x) => x.id === d)).filter(Boolean).map((d) => localName(d!, i18n.language)).join(', ') || t('study.anyDomain')})`).join(` ${t('work.or')} `),
                          })
                        : t(byDiploma ? 'work.degreeMatched' : 'work.degreeRequired', { degree: t(`study.kind.${req.min}`), domain: (req.domains ?? []).map((d) => study?.domains.find((x) => x.id === d)).filter(Boolean).map((d) => localName(d!, i18n.language)).join(' / ') || t('study.anyDomain') })
                      : course
                      ? t(locked ? 'work.credentialRequired' : 'work.credentialMatched', { credential: localName(course, i18n.language) })
                      : t('work.lockedHint')}
                </small>
              </div>
              {status !== 'active' && (
                <button
                  className="btn"
                  disabled={busy || (needsDiploma && !courses)}
                  onClick={() =>
                    locked
                      ? openApp('study')
                      : j.payMode === 'MONTHLY' && playerJob?.publicJobId !== j.id
                        ? void run(() => acceptOffer(`job:${j.id}`), () => t('work.hiredPublic', { role: localName(j, i18n.language) })).then(loadPlayerJobs)
                        : void run(() => takeJob(j.id), () => t('work.chosen', { job: localName(j, i18n.language) }))
                  }
                >
                  {locked ? t('work.getQualified') : j.payMode === 'MONTHLY' && playerJob?.publicJobId !== j.id ? t('work.apply') : status === 'held' ? t('work.switchTo') : state.jobs.length >= state.maxJobs ? t('work.limitReached') : t('work.apply')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
        </>
      )}
    </section>
  );
}
