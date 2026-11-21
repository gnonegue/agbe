import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Joystick tactile pour marcher dans la rue (x = tourner, y = avancer). */
export default function Joystick({ onMove, minBottom = 0 }: { onMove: (x: number, y: number) => void; minBottom?: number }) {
  const { t } = useTranslation();
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const R = 44;

  const update = (e: React.PointerEvent) => {
    const r = base.current?.getBoundingClientRect();
    if (!r) return;
    let x = e.clientX - (r.left + r.width / 2);
    let y = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(x, y);
    if (d > R) {
      x = (x / d) * R;
      y = (y / d) * R;
    }
    setKnob({ x, y });
    onMove(x / R, -y / R);
  };
  const end = () => {
    setKnob({ x: 0, y: 0 });
    onMove(0, 0);
  };

  return (
    <div
      ref={base}
      className="joystick"
      style={{ '--joy-min': `${minBottom}px` } as React.CSSProperties}
      role="application"
      aria-label={t('street.joystick')}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => e.buttons && update(e)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <span className="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
