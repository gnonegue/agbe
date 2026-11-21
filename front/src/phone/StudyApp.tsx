import { useCallback, useEffect, useState } from 'react';
import { reqOptions } from '../lib/study';
import { useTranslation } from 'react-i18next';
import { getStudy, studyAttend, studyEnroll, studyExam, studyQuit, studyRegister, type StudyKind, type StudyState } from '../api/endpoints';
import { fcfa, localName } from '../lib/format';
import { matches } from '../lib/search';
import { useGame } from './ctx';
import SchoolApp from './SchoolApp';
import { consumeFocusSection } from '../lib/focus';

const HIGHER_KINDS: StudyKind[] = ['LICENCE', 'MASTER', 'DOCTORAT'];
const PRO_KINDS: StudyKind[] = ['BT', 'BTS'];
type Tab = 'higher' | 'pro' | 'courses' | 'conferences';
const TAB_ICON: Record<Tab, string> = { higher: '🎓', pro: '🛠️', courses: '📚', conferences: '🎤' };

/** Éducation : enseignement supérieur, formations professionnelles, cours du soir et conférences, réunis sous une seule appli à onglets. */
export default function EducationApp() {
  const { t } = useTranslation();
  // Ouverte depuis la fiche de l'Université : sur l'onglet de la démarche choisie
  const [tab, setTab] = useState<Tab>(() => {
    const f = consumeFocusSection();
    return f && f.startsWith('study-') && ['higher', 'pro', 'courses', 'conferences'].includes(f.slice(6)) ? (f.slice(6) as Tab) : 'higher';
  });
  return (
    <section>
      <div className="chat-tabs wrap4" role="tablist">
        {(['higher', 'pro', 'courses', 'conferences'] as Tab[]).map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'chat-tab active' : 'chat-tab'} onClick={() => setTab(x)}>
            {TAB_ICON[x]} {t(`study.tabs.${x}`)}
          </button>
        ))}
      </div>
      {tab === 'higher' && <HigherEdTab kinds={HIGHER_KINDS} />}
      {tab === 'pro' && <HigherEdTab kinds={PRO_KINDS} />}
      {tab === 'courses' && <SchoolApp section="courses" />}
      {tab === 'conferences' && <SchoolApp section="conferences" />}
    </section>
  );
}

/** Un groupe de niveaux (supérieur ou professionnel) : diplômes obtenus, cursus en cours et inscription à un nouveau cursus. */
function HigherEdTab({ kinds }: { kinds: StudyKind[] }) {
  const { t, i18n } = useTranslation();
  const { state, run, busy, goTo, catalog } = useGame();
  const [s, setS] = useState<StudyState | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [level, setLevel] = useState<StudyKind>(kinds[0]!);
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<{ correct: boolean; answer: number } | null>(null);
  const [confirmQuit, setConfirmQuit] = useState(false);

  const load = useCallback(() => {
    void getStudy().then(setS).catch(() => setS(null));
  }, []);
  useEffect(load, [load, state.wallet.balance, state.location]);
  if (!s) return <p className="muted">{t('app.loading')}</p>;
  const lang = i18n.language;
  const balance = BigInt(state.wallet.balance);
  const domainName = (id: string) => {
    const d = s.domains.find((x) => x.id === id);
    return d ? `${d.emoji} ${localName(d, lang)}` : id;
  };
  const after = async <T,>(fn: () => Promise<T>, ok: (r: T) => string | null) => {
    const r = await run(fn, ok);
    setAnswer(null);
    load();
    return r;
  };
  const atVenue = state.location === s.venueId;
  const has = (kind: string, domain: string) => s.diplomas.some((d) => d.kind === kind && d.domain === domain);
  // Le cursus en cours n'est montré ici que s'il appartient à ce groupe de niveaux (supérieur ou professionnel).
  const cur = s.study && kinds.includes(s.study.kind) ? s.study : null;
  const cycle = s.cycles[level];

  // Métiers ouverts par un diplôme de ce niveau dans ce domaine (condition minimale exactement à ce niveau)
  const jobName = (id: string) => {
    const j = catalog?.jobs.find((x) => x.id === id);
    return j ? localName(j, lang) : id;
  };
  const opens = (k: StudyKind, domain: string) =>
    Object.entries(s.jobReq)
      .filter(([, r]) => reqOptions(r).some((o) => o.min === k && (!o.domains || o.domains.includes(domain))))
      .map(([id]) => jobName(id));
  // Choix du niveau affiché : bacs techniques (une série par domaine) ou domaines ; recherche sur le nom, la série et les métiers
  const options = (level === 'BT'
    ? s.bt.map((b) => ({ key: `BT:${b.series}`, value: b.series, emoji: s.domains.find((d) => d.id === b.domain)?.emoji ?? '📘', name: localName(b, lang), sub: localName(s.domains.find((d) => d.id === b.domain) ?? { nameFr: b.domain, nameEn: b.domain }, lang), jobs: opens('BT', b.domain), done: has('BT', b.domain), locked: false }))
    : s.domains.map((d) => ({
        key: `${level}:${d.id}`,
        value: d.id,
        emoji: d.emoji,
        name: localName(d, lang),
        sub: '',
        jobs: opens(level, d.id),
        done: has(level, d.id),
        locked: (level === 'MASTER' && !has('LICENCE', d.id)) || (level === 'DOCTORAT' && !has('MASTER', d.id)),
      }))
  ).filter((o) => matches(query, o.name, o.sub, ...o.jobs));

  return (
    <section className="st">
      <div className="panel">
        <strong>🎓 {t('study.diplomas')}</strong>
        <ul className="goals">
          <li className="ok">✅ {t('study.bac')}</li>
          {s.diplomas.map((d) => (
            <li key={`${d.kind}-${d.domain}`} className="ok">
              ✅ {t(`study.kind.${d.kind}`)} · {d.series ? `${d.series.toUpperCase()} · ` : ''}{domainName(d.domain)}
            </li>
          ))}
        </ul>
      </div>

      {cur ? (
        <div className="panel">
          <strong>📚 {t('study.current', { kind: t(`study.kind.${cur.kind}`), domain: domainName(cur.domain) })}</strong>
          <p className="small-line">{t('study.yearOf', { year: cur.year, years: cur.years })} · {t('study.sessionsOf', { done: cur.sessionsDone, n: cur.sessions })}</p>
          <div className="ld-gauge" role="meter" aria-valuemin={0} aria-valuemax={cur.sessions} aria-valuenow={cur.sessionsDone}>
            <span className={`fill w${Math.round(((cur.sessionsDone / cur.sessions) * 100) / 5) * 5}`} />
          </div>
          {!cur.paid && (
            <button className="btn primary" disabled={busy || balance < BigInt(cur.fee)} onClick={() => void after(studyRegister, () => t('study.registered', { fee: fcfa(cur.fee) }))}>
              {t('study.register', { fee: fcfa(cur.fee), year: cur.year })}
            </button>
          )}
          {cur.paid && cur.lesson && (
            <div className="st-lesson">
              <p>{lang === 'en' ? cur.lesson.textEn : cur.lesson.textFr}</p>
              <strong>{lang === 'en' ? cur.lesson.qEn : cur.lesson.qFr}</strong>
              <div className="quiz-choices">
                {(lang === 'en' ? cur.lesson.choicesEn : cur.lesson.choicesFr).map((c, i) => (
                  <button
                    key={c}
                    className={answer ? (i === answer.answer ? 'quiz-choice active' : 'quiz-choice') : 'quiz-choice'}
                    disabled={busy || !!answer}
                    onClick={() => void run(() => studyAttend(i), (r) => (r.result.correct ? t('study.right') : t('study.wrong'))).then((r) => { if (r) setAnswer({ correct: r.result.correct, answer: r.result.answer }); load(); })}
                  >
                    {c}
                  </button>
                ))}
              </div>
              {answer && <p className={answer.correct ? 'ok' : 'muted'}>{answer.correct ? t('study.right') : t('study.wrong')}</p>}
            </div>
          )}
          {cur.paid && !cur.lesson && cur.sessionsDone < cur.sessions && <p className="muted small-line">{t('study.comeBack')}</p>}
          {cur.paid && cur.sessionsDone >= cur.sessions && (
            <button className="btn primary" disabled={busy} onClick={() => void after(studyExam, (r) => (r.result.graduated ? t('study.graduated', { kind: t(`study.kind.${r.result.kind}`), domain: domainName(r.result.domain ?? '') }) : r.result.passed ? t('study.passed', { year: r.result.year }) : t('study.failed')))}>
              📝 {t('study.exam')}
            </button>
          )}
          {confirmQuit ? (
            <div className="confirm">
              <p>{t('study.giveUpConfirm')}</p>
              <button className="btn danger" disabled={busy} onClick={() => void after(studyQuit, () => t('study.quit')).then(() => setConfirmQuit(false))}>{t('app.confirm')}</button>
              <button className="btn ghost" onClick={() => setConfirmQuit(false)}>{t('app.cancel')}</button>
            </div>
          ) : (
            <button className="btn ghost small" disabled={busy} onClick={() => setConfirmQuit(true)}>{t('study.giveUp')}</button>
          )}
          <small className="muted">{t('study.giveUpHint')}</small>
        </div>
      ) : (
        <>
          <p className="muted small-line">{t('study.intro')}</p>
          {!atVenue && (
            <button className="btn primary" onClick={() => goTo(s.venueId)}>📍 {t('study.goEnroll')}</button>
          )}
          <div className="study-tabs" role="tablist" aria-label={t('study.levels')}>
            {kinds.map((k) => (
              <button key={k} role="tab" aria-selected={level === k} className={level === k ? 'study-tab active' : 'study-tab'} onClick={() => (setLevel(k), setPicked(null))}>
                {t(`study.short.${k}`)}
              </button>
            ))}
          </div>
          <div className="study-level">
            <strong>{t(`study.kind.${level}`)}</strong>
            <div className="study-facts">
              <span className="chip">⏱ {t('study.years', { count: cycle.years })}</span>
              <span className="chip">💰 {t('study.perYear', { fee: fcfa(cycle.fee) })}</span>
              <span className="chip">📝 {t('study.sessionsYear', { count: cycle.sessionsPerYear })}</span>
            </div>
          </div>
          <input className="catalog-search" type="search" placeholder={t('study.search')} aria-label={t('study.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          {options.length === 0 && <p className="muted">{t('school.noResult', { q: query.trim() })}</p>}
          <ul className="study-list">
            {options.map((o) => {
              const active = picked === o.key;
              return (
                <li key={o.key} className={`study-row${active ? ' active' : ''}${o.done ? ' done' : ''}${o.locked ? ' locked' : ''}`}>
                  <button className="study-pick" disabled={o.done || o.locked} aria-expanded={active} onClick={() => setPicked(active ? null : o.key)}>
                    <span className="study-ico" aria-hidden="true">{o.emoji}</span>
                    <span className="study-body">
                      <strong>{o.name}</strong>
                      {o.sub && <small>{o.sub}</small>}
                      {o.jobs.length > 0 && <small className="study-jobs">💼 {t('study.opens', { jobs: o.jobs.join(', ') })}</small>}
                    </span>
                    <span className={`study-state${o.done ? ' ok' : ''}`}>{o.done ? `✓ ${t('study.obtained')}` : o.locked ? `🔒 ${t(`study.need.${level}`)}` : active ? '▾' : '›'}</span>
                  </button>
                  {active && (
                    <button
                      className="btn primary study-go"
                      disabled={busy || !atVenue || balance < BigInt(cycle.fee)}
                      onClick={() => {
                        void after(() => (level === 'BT' ? studyEnroll('BT', undefined, o.value) : studyEnroll(level, o.value)), () => t('study.enrolled'));
                        setPicked(null);
                      }}
                    >
                      {atVenue ? t('study.enroll', { fee: fcfa(cycle.fee) }) : t('study.atVenue')}
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
