import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { enroll, getConference, getCourses, type ConferenceInfo, type CourseInfo } from '../api/endpoints';
import { fcfa, hhmm, localName } from '../lib/format';
import { useGame } from './ctx';
import { matches } from '../lib/search';

/** Cours du soir/apprentissages et conférences publiques, dans un seul onglet ou séparés selon `section`. */
export default function SchoolApp({ section = 'both' }: { section?: 'courses' | 'conferences' | 'both' }) {
  const { t, i18n } = useTranslation();
  const { run, busy, state, goTo, openClass, openConference, catalog } = useGame();
  const [courses, setCourses] = useState<CourseInfo[] | null>(null);
  const [conf, setConf] = useState<ConferenceInfo | null>(null);
  const [q, setQ] = useState('');
  const load = useCallback(async () => {
    const c = await run(getCourses);
    if (c) setCourses(c);
    // Les conférences ne doivent jamais empêcher d'afficher les cours
    setConf(await getConference().catch(() => null));
  }, [run]);
  useEffect(() => {
    void load();
  }, [load, state.gameTime.hour]);
  if (!courses) return <p className="muted">{t('app.loading')}</p>;
  const jobName = (id: string) => {
    const j = catalog?.jobs.find((x) => x.id === id);
    return j ? localName(j, i18n.language) : id;
  };
  // Minute de jeu : le cours a-t-il commencé, et peut-on encore entrer (retard toléré) ?
  const m = state.gameTime.hour * 60 + state.gameTime.minute;
  const tooLate = (c: CourseInfo) => !c.seated && m >= c.startHour * 60 + c.lateMinutes;
  const place = (id: string) => localName(catalog?.venues.find((v) => v.id === id) ?? { nameFr: id, nameEn: id }, i18n.language);

  // Recherche : nom de la formation, professeur ou orateur, lieu, métiers débloqués, sujet de conférence
  const needle = q.trim();
  const match = (...parts: string[]) => matches(q, parts.join(' '));
  const talks = (conf?.upcoming ?? []).filter((k) => match(k.titleFr, k.titleEn, k.speaker, place(conf!.venueId), t('conference.title')));
  const shown = courses.filter((c) => match(c.nameFr, c.nameEn, c.teacher, place(c.venueId), ...c.unlocks.map(jobName)));
  const when = (day: number) => (conf && day === conf.day ? t('conference.today') : conf && day === conf.day + 1 ? t('conference.tomorrow') : t('conference.inDays', { n: day - (conf?.day ?? 0) }));

  const showConferences = section === 'both' || section === 'conferences';
  const showCourses = section === 'both' || section === 'courses';
  return (
    <section>
      <input className="catalog-search" type="search" placeholder={t('school.search')} aria-label={t('school.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      {needle && (!showConferences || talks.length === 0) && (!showCourses || shown.length === 0) && <p className="muted">{t('school.noResult', { q: q.trim() })}</p>}
      {showConferences && conf && talks.length > 0 && (
        <>
          <h3>🎤 {t('conference.title')}</h3>
          <p className="muted">{t('conference.intro', { place: place(conf.venueId), fee: fcfa(conf.fee), min: conf.lateMinutes })}</p>
          <ul className="list stacked">
            {talks.map((k) => {
              const here = state.location === conf.venueId;
              const late = !k.seated && m >= conf.startHour * 60 + conf.lateMinutes;
              return (
                <li key={k.day} className={k.day === conf.day ? 'item current' : 'item'}>
                  <div className="item-main">
                    <strong>{k.emoji} {i18n.language === 'en' ? k.titleEn : k.titleFr}</strong>
                    <small>{t('conference.by', { speaker: k.speaker })}</small>
                    <small>{when(k.day)} · {hhmm(conf.startHour, 0)}–{hhmm(conf.startHour + conf.hours, 0)} · {place(conf.venueId)}</small>
                  </div>
                  {k.done ? (
                    <span className="badge ok">✓ {t('conference.attended')}</span>
                  ) : k.seated && here ? (
                    <button className="btn primary small" onClick={() => openConference(conf, k)}>{t('conference.back')}</button>
                  ) : k.inSession && late ? (
                    <span className="muted">{t('conference.tooLate')}</span>
                  ) : k.inSession && here ? (
                    <button className="btn primary small" disabled={busy || BigInt(state.wallet.balance) < BigInt(conf.fee)} onClick={() => openConference(conf, k)}>{t('conference.enter', { fee: fcfa(conf.fee) })}</button>
                  ) : k.inSession || k.seated ? (
                    <button className="btn small" onClick={() => goTo(conf.venueId)}>🏃 {t('conference.goNow')}</button>
                  ) : k.day === conf.day ? (
                    <button className="btn small" onClick={() => goTo(conf.venueId)}>🗺️ {t('conference.goThere')}</button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {showCourses && shown.length > 0 && <h3>📚 {t('school.coursesTitle')}</h3>}
        </>
      )}
      {showCourses && shown.length > 0 && <p className="muted">{t('school.intro')}</p>}
      {showCourses && <ul className="list stacked">
        {shown.map((c) => (
          <li key={c.id} className={c.completed ? 'item current' : 'item'}>
            <div className="item-main">
              <strong>{c.emoji} {localName(c, i18n.language)}</strong>
              <small>{t('school.teacher', { name: c.teacher })} · {place(c.venueId)}</small>
              <small>{t('school.schedule', { from: hhmm(c.startHour, 0), to: hhmm(c.startHour + c.hours, 0), n: c.sessions })}</small>
              {c.unlocks.length > 0 && <small className="ok">🔓 {t('school.unlocks', { jobs: c.unlocks.map(jobName).join(', ') })}</small>}
              {c.enrolled && (
                <span className="bar progress" role="meter" aria-valuemin={0} aria-valuemax={c.sessions} aria-valuenow={c.sessionsDone}>
                  <span className={`fill w${Math.round((c.sessionsDone / c.sessions) * 20) * 5}`} />
                </span>
              )}
              {c.enrolled && <small>{c.completed ? t('school.certified', { ok: c.correctAnswers, n: c.sessions }) : t('school.progress', { done: c.sessionsDone, n: c.sessions })}</small>}
            </div>
            {!c.enrolled ? (
              state.location === c.venueId ? (
                <button className="btn primary small" disabled={busy || BigInt(state.wallet.balance) < BigInt(c.fee)} onClick={() => void run(() => enroll(c.id), () => t('school.enrolled', { course: localName(c, i18n.language) })).then(load)}>
                  {t('school.enroll', { fee: fcfa(c.fee) })}
                </button>
              ) : (
                <button className="btn small" onClick={() => goTo(c.venueId)}>🗺️ {t('school.goEnroll')}</button>
              )
            ) : c.completed ? (
              <span className="badge ok">🎓</span>
            ) : c.attendedToday ? (
              <span className="muted">{t('school.seeYouTomorrow')}</span>
            ) : c.seated && state.location === c.venueId ? (
              <button className="btn primary small" onClick={() => openClass(c)}>{c.inSession ? t('school.backToClass') : t('school.answerNow')}</button>
            ) : c.inSession && tooLate(c) ? (
              <span className="muted">{t('school.tooLate', { min: c.lateMinutes })}</span>
            ) : c.inSession && state.location === c.venueId ? (
              <button className="btn primary small" onClick={() => openClass(c)}>{t('school.attend')}</button>
            ) : c.inSession || c.seated ? (
              <button className="btn small" onClick={() => goTo(c.venueId)}>🏃 {t('school.goNow')}</button>
            ) : (
              <span className="muted">{t('school.nextAt', { time: hhmm(c.startHour, 0) })}</span>
            )}
          </li>
        ))}
      </ul>}
    </section>
  );
}
