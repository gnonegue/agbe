import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setTourDone, tourDone, TOUR_EVENT } from '../lib/tour';

interface Step {
  key: string;
  /** Élément mis en avant ; sans cible (ou cible absente / invisible), l'étape est centrée. */
  target?: string;
}

const STEPS: Step[] = [
  { key: 'welcome' },
  { key: 'topbar', target: '.topbar' },
  { key: 'needs', target: '.needs' },
  { key: 'task', target: '.hud-left .task' },
  { key: 'home', target: '.bottom-nav .nav-btn:nth-child(1)' },
  { key: 'map', target: '.bottom-nav .nav-btn:nth-child(2)' },
  { key: 'phone', target: '.bottom-nav .nav-btn:nth-child(3)' },
  { key: 'joystick', target: '.joystick' },
  { key: 'photo', target: '.shot-btn' },
  { key: 'end' },
];

function visibleRect(sel?: string): DOMRect | null {
  if (!sel) return null;
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}

/**
 * Visite guidée : première partie sur l'appareil, puis à la demande depuis les Réglages.
 * Elle n'apparaît que quand le jeu est à l'écran (`ready` : pas d'éditeur d'apparence, de téléphone ni de cours
 * par-dessus), et ne garde que les étapes dont l'élément est visible à ce moment-là (le joystick et la photo
 * n'existent que dans la rue) : on ne présente jamais une partie cachée.
 */
export default function Tour({ ready }: { ready: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => !tourDone());
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const shown = open && ready && steps !== null;

  // Étapes retenues une fois le jeu affiché (le HUD et la scène prennent un instant à se monter)
  useEffect(() => {
    if (!open || !ready) return setSteps(null);
    const id = window.setTimeout(() => setSteps(STEPS.filter((s) => !s.target || visibleRect(s.target))), 800);
    return () => window.clearTimeout(id);
  }, [open, ready]);

  useEffect(() => {
    const again = () => (setI(0), setOpen(true));
    window.addEventListener(TOUR_EVENT, again);
    return () => window.removeEventListener(TOUR_EVENT, again);
  }, []);

  const measure = useCallback(() => setRect(visibleRect(steps?.[i]?.target)), [i, steps]);
  useLayoutEffect(() => {
    if (!shown) return;
    measure();
    window.addEventListener('resize', measure);
    const id = window.setInterval(measure, 500); // le HUD bouge (jauges repliées, alertes…)
    return () => (window.removeEventListener('resize', measure), window.clearInterval(id));
  }, [shown, measure]);

  const close = useCallback(() => (setTourDone(true), setOpen(false)), []);
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, close]);

  if (!shown) return null;
  const step = steps[i] ?? steps[0]!;
  const last = i >= steps.length - 1;
  const pad = 6;
  const below = rect ? rect.top < window.innerHeight / 2 : false;
  const cardPos = rect
    ? below
      ? { top: Math.min(rect.bottom + pad + 10, window.innerHeight - 190) }
      : { bottom: Math.max(window.innerHeight - rect.top + pad + 10, 10) }
    : { top: '50%', transform: 'translateY(-50%)' };

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={t('tour.title')}>
      {rect ? (
        <div
          className="tour-spot"
          style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
        />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-card" style={cardPos}>
        <strong>{t(`tour.${step.key}.title`)}</strong>
        <p>{t(`tour.${step.key}.text`)}</p>
        <div className="tour-foot">
          <small className="muted">{i + 1}/{steps.length}</small>
          {!last && <button className="btn ghost small" onClick={close}>{t('tour.skip')}</button>}
          {i > 0 && <button className="btn small" onClick={() => setI(i - 1)}>{t('tour.prev')}</button>}
          <button className="btn primary small" onClick={() => (last ? close() : setI(i + 1))}>
            {last ? t('tour.done') : t('tour.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
