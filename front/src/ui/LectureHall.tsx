import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Lecture, type LecturePhase, type LectureProp } from '../game/Lecture';
import type { PersonLook } from '../game/kit';
import { hhmm } from '../lib/format';
import { speak } from '../lib/voice';
import { useGame } from '../phone/ctx';

/** Répliques de l'orateur entre deux points (clés i18n `school.class.talk.N`). */
const TALKS = 4;

type Segment = { phase: Exclude<LecturePhase, 'question'>; text: string; say: string };

export interface LectureHallProps {
  look: PersonLook;
  /** Titre de la carte, et ligne sous le titre. */
  heading: string;
  sub: string;
  /** Titre écrit en haut du tableau et sur les diapositives. */
  boardTitle: string;
  emoji: string;
  speaker: string;
  /** Texte du cours ou de la conférence, découpé en points. */
  text: string;
  /** Début et fin (minutes de la journée de jeu). */
  start: number;
  end: number;
  prop?: LectureProp;
  /** Assis dans la salle (place confirmée par le serveur) : la voix ne parle qu'à partir de là. */
  active: boolean;
  /** Première et dernière réplique de l'orateur ({{text}} : le texte entier, pour le récapitulatif). */
  openLine: string;
  closeLine: string;
  onLeave: () => void;
  /** Contenu de la carte une fois l'heure de fin passée (question, applaudissements…). */
  after: ReactNode;
}

/**
 * Salle 3D (cours ou conférence) suivie en temps de jeu : pour chaque point, l'orateur l'écrit au tableau, le projette,
 * puis l'explique ; la carte du bas montre ce qu'il dit et le temps restant. Après l'heure de fin, `after` s'affiche.
 */
export default function LectureHall(p: LectureHallProps) {
  const { t, i18n } = useTranslation();
  const { clock, quality } = useGame();
  const [minute, setMinute] = useState(() => clock.minuteOfDay());
  const el = useRef<HTMLDivElement>(null);
  const lecture = useRef<Lecture | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setMinute(clock.minuteOfDay()), 400);
    return () => window.clearInterval(id);
  }, [clock]);

  const segments = useMemo<Segment[]>(() => {
    const points = p.text.split(/(?<=[.:;!?])\s+/).filter((s) => s.trim().length > 0);
    const out: Segment[] = [{ phase: 'explain', text: p.openLine, say: p.openLine }];
    points.forEach((pt, i) => {
      const talk = t(`school.class.talk.${i % TALKS}`);
      out.push({ phase: 'board', text: pt, say: pt });
      out.push({ phase: 'slides', text: pt, say: t('school.class.look', { text: pt }) });
      out.push({ phase: 'explain', text: talk, say: talk });
    });
    out.push({ phase: 'explain', text: p.closeLine, say: p.closeLine });
    return out;
  }, [p.text, p.openLine, p.closeLine, t]);

  const ratio = Math.min(1, Math.max(0, (minute - p.start) / Math.max(1, p.end - p.start)));
  const idx = Math.min(segments.length - 1, Math.floor(ratio * segments.length));
  const local = ratio * segments.length - idx;
  const seg = segments[idx]!;
  // Une minute de jeu de marge, comme le serveur
  const over = minute >= p.end - 0.5;

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let lec: Lecture | null = null;
    try {
      lec = new Lecture(node, quality, p.look, { teacherFemale: /^(mme|maman|mlle)\b/i.test(p.speaker), teacherSeed: p.speaker.length * 97 + p.boardTitle.length, prop: p.prop ?? null });
      lec.getMinute = () => clock.minuteOfDay();
    } catch {
      lec = null;
    }
    lecture.current = lec;
    return () => {
      lec?.dispose();
      lecture.current = null;
    };
  }, [quality, p.look, clock, p.speaker, p.boardTitle, p.prop]);

  // Tableau, écran et orateur suivent le déroulé
  useEffect(() => {
    const lec = lecture.current;
    if (!lec) return;
    lec.setPhase(over ? 'question' : seg.phase);
    const lastBoard = [...segments.slice(0, idx + 1)].reverse().find((s) => s.phase === 'board');
    lec.setBoard(p.boardTitle, lastBoard?.text ?? '', seg.phase === 'board' && !over ? local * 1.6 : 1);
    lec.setSlide(p.boardTitle, p.emoji, seg.phase === 'slides' && !over ? seg.text : null);
  }, [seg, idx, local, over, segments, p.boardTitle, p.emoji]);

  // L'orateur parle à chaque nouveau moment
  useEffect(() => {
    if (p.active && !over) speak(seg.say, i18n.language);
  }, [idx, p.active, over]); // eslint-disable-line react-hooks/exhaustive-deps

  const leftMs = Math.max(0, (p.end - minute) * clock.msPerMinute());
  const left = t('school.class.left', { m: Math.floor(leftMs / 60000), s: String(Math.floor((leftMs % 60000) / 1000)).padStart(2, '0') });
  const endH = Math.floor(p.end / 60);

  return (
    <div className="class-overlay" role="dialog" aria-modal="true" aria-label={p.heading}>
      <div ref={el} className="scene" />
      <div className="class-card">
        <header className="class-head">
          <div>
            <strong>{p.emoji} {p.heading}</strong>
            <small>{p.sub}</small>
          </div>
          {!over && (
            <button className="btn ghost small" onClick={p.onLeave} title={t('school.class.leaveHint')}>{t('school.class.leave')}</button>
          )}
        </header>
        {!over ? (
          <>
            <small className="muted">{t(`school.class.doing.${seg.phase}`, { name: p.speaker })}</small>
            <blockquote className="teacher-says">{seg.phase === 'board' ? seg.text.slice(0, Math.round(seg.text.length * Math.min(1, local * 1.6))) : seg.text}</blockquote>
            <div className="trip-track"><div className="trip-fill" style={{ width: `${ratio * 100}%` }} /></div>
            <small>{t('school.class.endsAt', { time: hhmm(endH, p.end % 60), left })}</small>
          </>
        ) : (
          p.after
        )}
      </div>
    </div>
  );
}
