import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SeaGrid, SeaPlot } from '../api/endpoints';

/** Taille d'une case : grande sur les petits espaces (lacs), réduite sur la mer pour que le plan reste lisible. */
const MIN_PX = 14;
const MAX_PX = 56;
const MAX_H = 300;
export interface PlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Choix de cases sur le plan d'un espace (mer, lac, zone est) : un clic place le coin, deux compteurs règlent la taille. */
export default function PlotPicker({ grid, plots, value, onChange }: { grid: SeaGrid; plots: SeaPlot[]; value: PlotRect; onChange: (v: PlotRect) => void }) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(320);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const on = () => setAvail(el.clientWidth || 320);
    on();
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const CELL_PX = Math.max(MIN_PX, Math.min(MAX_PX, Math.floor((avail - 2) / grid.cols), Math.floor(MAX_H / grid.rows)));
  const w = Math.max(1, Math.min(value.w, grid.maxSide, grid.cols - value.x));
  const h = Math.max(1, Math.min(value.h, grid.maxSide, grid.rows - value.y));
  const clash = plots.some((p) => value.x < p.x + p.w && p.x < value.x + w && value.y < p.y + p.h && p.y < value.y + h);
  const maxW = Math.min(grid.maxSide, grid.cols - value.x);
  const maxH = Math.min(grid.maxSide, grid.rows - value.y);
  const set = (v: Partial<PlotRect>) => onChange({ x: value.x, y: value.y, w, h, ...v });
  return (
    <div className="plot-picker" ref={box}>
      <div className="sea-map" role="group" aria-label={t('plots.map')}>
        <div
          className="sea-map-grid"
          style={{ width: grid.cols * CELL_PX, height: grid.rows * CELL_PX, backgroundSize: `${CELL_PX}px ${CELL_PX}px` }}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            set({ x: Math.min(grid.cols - 1, Math.max(0, Math.floor((e.clientX - r.left) / CELL_PX))), y: Math.min(grid.rows - 1, Math.max(0, Math.floor((e.clientY - r.top) / CELL_PX))) });
          }}
        >
          {plots.map((p) => (
            <span key={p.id} className="sea-map-plot" style={{ left: p.x * CELL_PX, top: p.y * CELL_PX, width: p.w * CELL_PX, height: p.h * CELL_PX }} />
          ))}
          <span className={`sea-map-pick${clash ? ' bad' : ''}`} style={{ left: value.x * CELL_PX, top: value.y * CELL_PX, width: w * CELL_PX, height: h * CELL_PX }} />
        </div>
      </div>
      <div className="row-between">
        {([['width', w, maxW, (n: number) => set({ w: n })], ['height', h, maxH, (n: number) => set({ h: n })]] as const).map(([k, v, max, change]) => (
          <div key={k} className="stepper">
            <button type="button" className="btn ghost small" onClick={() => change(Math.max(1, v - 1))} disabled={v <= 1} aria-label={t('plots.less')}>−</button>
            <div><strong>{v}</strong><small>{t(`plots.${k}`)}</small></div>
            <button type="button" className="btn ghost small" onClick={() => change(Math.min(max, v + 1))} disabled={v >= max} aria-label={t('plots.more')}>+</button>
          </div>
        ))}
      </div>
      {clash && <small className="error">{t('errors.plot_taken')}</small>}
    </div>
  );
}
