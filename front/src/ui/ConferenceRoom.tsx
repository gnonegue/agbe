import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { conferenceFinish, conferenceSit, type ConferenceInfo, type ConferenceTalk } from '../api/endpoints';
import type { PersonLook } from '../game/kit';
import { fcfa } from '../lib/format';
import { useGame } from '../phone/ctx';
import LectureHall from './LectureHall';

/**
 * Conférence publique : on paie l'entrée en entrant (le serveur vérifie lieu, heure et retard), on écoute l'orateur
 * jusqu'à la fin, puis on applaudit et l'on gagne moral et respect. On peut sortir et revenir : la place est gardée.
 */
export default function ConferenceRoom({ info, talk, look, onClose }: { info: ConferenceInfo; talk: ConferenceTalk; look: PersonLook; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { run, busy } = useGame();
  const en = i18n.language === 'en';
  const [seated, setSeated] = useState(talk.seated);
  const title = en ? talk.titleEn : talk.titleFr;
  const text = en ? talk.textEn : talk.textFr;

  useEffect(() => {
    if (seated) return;
    void run(conferenceSit, (r) => (r.result.fee > 0 ? t('conference.paid', { fee: fcfa(r.result.fee) }) : null)).then((r) => (r ? setSeated(true) : onClose()));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = () => void run(conferenceFinish, (r) => t('conference.thanks', { respect: r.result.respect, morale: r.result.morale })).then((r) => r && onClose());

  return (
    <LectureHall
      look={look}
      heading={title}
      sub={t('conference.by', { speaker: talk.speaker })}
      boardTitle={`${t('conference.board')} — ${title}`}
      emoji={talk.emoji}
      speaker={talk.speaker}
      text={text}
      start={info.startHour * 60}
      end={(info.startHour + info.hours) * 60}
      active={seated}
      openLine={t('conference.open', { title })}
      closeLine={t('conference.close', { text })}
      onLeave={onClose}
      after={
        <>
          <p>👏 {t('conference.over')}</p>
          <button className="btn primary big go" disabled={busy} onClick={finish}>{t('conference.applaud')}</button>
        </>
      }
    />
  );
}
