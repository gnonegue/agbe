import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { attend, sitClass, type CourseInfo } from '../api/endpoints';
import type { LectureProp } from '../game/Lecture';
import type { PersonLook } from '../game/kit';
import { localName } from '../lib/format';
import { speak } from '../lib/voice';
import { useGame } from '../phone/ctx';
import LectureHall from './LectureHall';

/** Objet de démonstration selon la formation (purement visuel). */
const PROPS: Record<string, LectureProp> = { mecanique: 'moto', permis: 'moto', couture: 'sewing', coiffure: 'barber' };

/**
 * Séance de cours : on entre en classe et on suit le cours jusqu'à l'heure de fin (en heures de jeu), dans une salle
 * pleine ; la question n'est posée qu'à la fin, et c'est le serveur qui la corrige. On peut sortir de la salle et
 * revenir avant la fin : la place est gardée.
 */
export default function ClassRoom({ course, look, onClose }: { course: CourseInfo; look: PersonLook; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { run, busy } = useGame();
  const en = i18n.language === 'en';
  const l = course.lesson;
  const [seated, setSeated] = useState(course.seated);
  const [result, setResult] = useState<{ correct: boolean; answer: number; completed: boolean } | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const name = localName(course, i18n.language);
  const session = t('school.session', { n: course.sessionsDone + 1, total: course.sessions });

  // Entrer en classe (le serveur vérifie le lieu, l'heure et le retard)
  useEffect(() => {
    if (seated) return;
    void run(() => sitClass(course.id)).then((r) => (r ? setSeated(true) : onClose()));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!l) return null;
  const text = en ? l.textEn : l.textFr;
  const choices = en ? l.choicesEn : l.choicesFr;
  const question = en ? l.qEn : l.qFr;

  const answer = async (i: number) => {
    setChosen(i);
    const r = await run(() => attend(course.id, i));
    if (!r) return;
    setResult(r.result);
    speak(r.result.correct ? t('school.right') : t('school.wrong', { answer: choices[r.result.answer] }), i18n.language);
  };

  return (
    <LectureHall
      look={look}
      heading={name}
      sub={`${t('school.teacher', { name: course.teacher })} · ${session}`}
      boardTitle={`${session} — ${name}`}
      emoji={course.emoji}
      speaker={course.teacher}
      text={text}
      start={course.startHour * 60}
      end={(course.startHour + course.hours) * 60}
      prop={PROPS[course.id] ?? null}
      active={seated}
      openLine={t('school.class.open')}
      closeLine={t('school.class.recap', { text })}
      onLeave={onClose}
      after={
        <>
          <Question text={question} lang={i18n.language} />
          <div className="answers">
            {choices.map((c, i) => (
              <button key={i} className={`answer ${result ? (i === result.answer ? 'right' : i === chosen ? 'wrong' : '') : ''}`} disabled={busy || !!result} onClick={() => void answer(i)}>
                {c}
              </button>
            ))}
          </div>
          {result && (
            <>
              <p className={result.correct ? 'ok' : 'warning'}>{result.correct ? t('school.right') : t('school.wrong', { answer: choices[result.answer] })}</p>
              {result.completed && <p className="notice">🎓 {t('school.diploma')}</p>}
              <button className="btn primary big go" onClick={onClose}>{t('school.endClass')}</button>
            </>
          )}
        </>
      }
    />
  );
}

/** Question de fin de séance, lue à voix haute quand elle apparaît. */
function Question({ text, lang }: { text: string; lang: string }) {
  useEffect(() => speak(text, lang), [text, lang]);
  return <p className="question">❓ {text}</p>;
}
