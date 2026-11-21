import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const CITIES = ['lome', 'kpalime', 'atakpame', 'sokode', 'kara', 'dapaong'] as const;

/** Barre de la carte : ville, noms des lieux, et menu « Plus » (recentrer, panneaux, liste des lieux). */
export default function MapBar(props: {
  names: boolean;
  onNames: (on: boolean) => void;
  boards: boolean;
  onBoards: (on: boolean) => void;
  onRecenter: () => void;
  onPlaces: () => void;
  onRotate: (rad: number) => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<'city' | 'more' | null>(null);
  return (
    <div className="map-bar" role="toolbar" aria-label={t('mapbar.label')}>
      <button className="map-bar-btn dark" aria-expanded={menu === 'city'} onClick={() => setMenu(menu === 'city' ? null : 'city')}>
        📍 {t('mapbar.cities.lome')} ▾
      </button>
      <button className={props.names ? 'map-bar-btn on' : 'map-bar-btn'} aria-pressed={props.names} onClick={() => props.onNames(!props.names)}>
        🏷️ {t('mapbar.names')}
      </button>
      <span className="map-rot" role="group" aria-label={t('mapbar.rotate')}>
        <button className="map-bar-btn rot" onClick={() => props.onRotate(-Math.PI / 8)} aria-label={t('mapbar.rotateLeft')} title={t('mapbar.rotateLeft')}>⟲</button>
        <button className="map-bar-btn rot" onClick={() => props.onRotate(0)} aria-label={t('mapbar.north')} title={t('mapbar.north')}>🧭</button>
        <button className="map-bar-btn rot" onClick={() => props.onRotate(Math.PI / 8)} aria-label={t('mapbar.rotateRight')} title={t('mapbar.rotateRight')}>⟳</button>
      </span>
      <button className="map-bar-btn" aria-expanded={menu === 'more'} onClick={() => setMenu(menu === 'more' ? null : 'more')}>
        ▦ {t('mapbar.more')}
      </button>
      {menu === 'city' && (
        <ul className="map-menu">
          {CITIES.map((c) => (
            <li key={c}>
              <button disabled={c !== 'lome'} onClick={() => setMenu(null)}>
                {t(`mapbar.cities.${c}`)} {c !== 'lome' && <small>· {t('mapbar.soon')}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {menu === 'more' && (
        <ul className="map-menu right">
          <li>
            <button onClick={() => { props.onRecenter(); setMenu(null); }}>🎯 {t('mapbar.recenter')}</button>
          </li>
          <li>
            <button onClick={() => props.onBoards(!props.boards)}>📢 {props.boards ? t('mapbar.hideBoards') : t('mapbar.showBoards')}</button>
          </li>
          <li>
            <button onClick={() => { props.onPlaces(); setMenu(null); }}>📍 {t('mapbar.places')}</button>
          </li>
        </ul>
      )}
    </div>
  );
}
