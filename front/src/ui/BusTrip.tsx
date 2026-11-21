import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/** Coordonnées (longitude, latitude) : contour du Togo (frontières Ghana, Burkina Faso, Bénin et côte). */
const TOGO: [number, number][] = [
  [-0.15, 11.14], [0.2, 11.0], [0.5, 10.99], [0.92, 10.99], [0.84, 10.78], [0.79, 10.45], [0.95, 10.27], [1.2, 10.15], [1.36, 10.0],
  [1.39, 9.72], [1.36, 9.5], [1.42, 9.3], [1.57, 9.12], [1.62, 8.95], [1.63, 8.5], [1.64, 8.0], [1.64, 7.5], [1.62, 7.0],
  [1.6, 6.7], [1.66, 6.5], [1.81, 6.28], [1.6, 6.22], [1.4, 6.17], [1.2, 6.1], [1.1, 6.2], [0.95, 6.35], [0.74, 6.58],
  [0.53, 6.85], [0.55, 7.15], [0.65, 7.4], [0.53, 7.6], [0.6, 8.0], [0.6, 8.4], [0.38, 8.75], [0.5, 9.0], [0.55, 9.4],
  [0.35, 9.6], [0.23, 9.9], [0.38, 10.3], [0.0, 10.6], [-0.08, 10.72],
];
/** Villes et bourgs traversés : Nationale 1 (Lomé → Dapaong) et Nationale 5 (Lomé → Kpalimé). */
const TOWNS: Record<string, [number, number]> = {
  lome: [1.222, 6.137], agoe: [1.2, 6.23], davie: [1.2, 6.37], tsevie: [1.213, 6.426], agbelouve: [1.17, 6.66],
  notse: [1.168, 6.95], agbonou: [1.13, 7.37], atakpame: [1.126, 7.527], anie: [1.2, 7.75], blitta: [1.06, 8.31],
  sotouboua: [0.985, 8.565], sokode: [1.133, 8.983], aledjo: [1.22, 9.24], bafilo: [1.268, 9.35], kara: [1.186, 9.551],
  kante: [1.05, 9.95], naboulgou: [0.82, 10.2], mango: [0.47, 10.36], dapaong: [0.207, 10.862],
  assahoun: [0.95, 6.46], agou: [0.74, 6.82], kpalime: [0.627, 6.9],
};
const N1 = ['lome', 'agoe', 'davie', 'tsevie', 'agbelouve', 'notse', 'agbonou', 'atakpame', 'anie', 'blitta', 'sotouboua', 'sokode', 'aledjo', 'bafilo', 'kara', 'kante', 'naboulgou', 'mango', 'dapaong'];
/** Itinéraire depuis Lomé vers chaque ville. */
const FROM_LOME: Record<string, string[]> = {
  lome: ['lome'],
  kpalime: ['lome', 'assahoun', 'agou', 'kpalime'],
  sokode: N1.slice(0, N1.indexOf('sokode') + 1),
  kara: N1.slice(0, N1.indexOf('kara') + 1),
  dapaong: N1,
};
const TOWN_NAMES: Record<string, string> = {
  agoe: 'Agoè', davie: 'Davié', tsevie: 'Tsévié', agbelouve: 'Agbélouvé', notse: 'Notsè', agbonou: 'Agbonou', atakpame: 'Atakpamé',
  anie: 'Anié', blitta: 'Blitta', sotouboua: 'Sotouboua', aledjo: 'Faille d’Alédjo', bafilo: 'Bafilo', kante: 'Kanté',
  naboulgou: 'Naboulgou', mango: 'Mango', assahoun: 'Assahoun', agou: 'Agou',
};

/** Itinéraire entre deux villes : remontée vers l'embranchement commun, puis descente vers l'arrivée. */
function itinerary(from: string, to: string): string[] {
  const a = FROM_LOME[from] ?? ['lome'];
  const b = FROM_LOME[to] ?? ['lome'];
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return [...a.slice(k - 1).reverse(), ...b.slice(k)];
}

// Projection équirectangulaire (1° de longitude ≈ 0,99 ° de latitude à 8° N), avec marge pour les pays voisins
const MAP_W = 340;
const MAP_H = 640;
const SCALE = 118;
const proj = ([lon, lat]: [number, number]): [number, number] => [40 + (lon + 0.35) * SCALE * 0.99, 14 + (11.25 - lat) * SCALE];

/** Petit générateur pseudo-aléatoire stable (même décor à chaque rendu). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const SKINS = ['#5a3825', '#6e4529', '#4a2c1c', '#7b5134', '#3d2416'];
const WRAPS = ['#e5383b', '#ffce00', '#2a9d8f', '#7b2cbf', '#f77f00', '#006a4e'];
const W = 720;

/** Montagne en dents de scie répétée deux fois (défilement sans couture). */
function ridge(seed: number, base: number, amp: number, step: number): string {
  const r = rng(seed);
  const ys: number[] = [];
  for (let x = 0; x <= W; x += step) ys.push(base - amp * (0.35 + 0.65 * r()));
  ys[ys.length - 1] = ys[0]!;
  let d = `M0 300`;
  for (let rep = 0; rep < 2; rep++) ys.forEach((y, i) => (d += ` L${rep * W + i * step} ${y.toFixed(1)}`));
  return d + ` L${2 * W} 300 Z`;
}

/** Voyage en car vers une autre ville : intérieur du car, vue sur la Nationale 1 qui défile, et carte du Togo. */
export default function BusTrip({ from, to, ratio, left }: { from: string; to: string; ratio: number; left: number }) {
  const { t } = useTranslation();
  const route = useMemo(() => itinerary(from, to), [from, to]);
  const pts = route.map((c) => proj(TOWNS[c] ?? TOWNS.lome!));
  const lens = pts.map((p, i) => (i === 0 ? 0 : Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1])));
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  // Position du car sur la carte, partie déjà parcourue et dernier bourg traversé
  let along = Math.min(1, Math.max(0, ratio)) * total;
  let bus = pts[0]!;
  let passedIdx = 0;
  const done: [number, number][] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    if (along <= lens[i]!) {
      const k = along / (lens[i]! || 1);
      bus = [pts[i - 1]![0] + (pts[i]![0] - pts[i - 1]![0]) * k, pts[i - 1]![1] + (pts[i]![1] - pts[i - 1]![1]) * k];
      done.push(bus);
      break;
    }
    along -= lens[i]!;
    passedIdx = i;
    bus = pts[i]!;
    done.push(bus);
  }
  const name = (c: string) => TOWN_NAMES[c] ?? t(`cities.${c}`);
  const passed = route[passedIdx]!;
  const next = route[Math.min(route.length - 1, passedIdx + 1)]!;
  // Paysage selon la latitude : côte (palmiers), plateaux et monts (Atakora), savane du nord (baobabs)
  const lat = 11.25 - (bus[1] - 14) / SCALE;
  const zone: Zone = lat < 7.1 ? 'south' : lat < 10.05 ? 'hills' : 'savanna';
  const scene = useMemo(() => makeScene(zone, from.length * 31 + to.length * 7), [zone, from, to]);
  const pal = PALETTE[zone];

  return (
    <div className="bus-trip">
      <div className="bus-trip-left">
      <svg className="bus-window" viewBox="0 0 720 300" role="img" aria-label={t('bustrip.alt', { city: t(`cities.${to}`) })}>
        <defs>
          <linearGradient id="bt-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5fa8d3" />
            <stop offset=".65" stopColor="#bfdcea" />
            <stop offset="1" stopColor={pal.haze} />
          </linearGradient>
          <radialGradient id="bt-sun" cx=".82" cy=".18" r=".35">
            <stop offset="0" stopColor="#fff7d6" stopOpacity=".95" />
            <stop offset="1" stopColor="#fff7d6" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="bt-far" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={pal.far} />
            <stop offset="1" stopColor={pal.haze} />
          </linearGradient>
          <linearGradient id="bt-mid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={pal.mid} />
            <stop offset="1" stopColor={pal.midLow} />
          </linearGradient>
          <linearGradient id="bt-ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={pal.ground} />
            <stop offset="1" stopColor={pal.groundLow} />
          </linearGradient>
          <linearGradient id="bt-asphalt" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4a4a4a" />
            <stop offset="1" stopColor="#2f2f2f" />
          </linearGradient>
          <linearGradient id="bt-glare" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".18" />
            <stop offset=".4" stopColor="#fff" stopOpacity="0" />
            <stop offset=".7" stopColor="#fff" stopOpacity=".06" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="720" height="300" fill="url(#bt-sky)" />
        <rect width="720" height="300" fill="url(#bt-sun)" />
        <g className="bt-scroll bt-clouds">
          {[0, 1].map((rep) => scene.clouds.map((c, i) => (
            <g key={`${rep}-${i}`} opacity=".9" fill="#fff">
              <ellipse cx={rep * W + c.x} cy={c.y} rx={c.w} ry={c.w * 0.28} />
              <ellipse cx={rep * W + c.x - c.w * 0.4} cy={c.y + 3} rx={c.w * 0.5} ry={c.w * 0.22} />
              <ellipse cx={rep * W + c.x + c.w * 0.3} cy={c.y - 5} rx={c.w * 0.45} ry={c.w * 0.25} />
            </g>
          )))}
        </g>
        <g className="bt-scroll bt-slow"><path d={scene.far} fill="url(#bt-far)" /></g>
        <g className="bt-scroll bt-mid"><path d={scene.mid} fill="url(#bt-mid)" /></g>
        <rect y="128" width="720" height="172" fill="url(#bt-ground)" />
        <g className="bt-scroll bt-mid2">
          {[0, 1].map((rep) => scene.bush.map((b, i) => <ellipse key={`${rep}-${i}`} cx={rep * W + b.x} cy={b.y} rx={b.r * 1.6} ry={b.r} fill={pal.bush} opacity=".85" />))}
        </g>
        {/* Arbres et rares cases de l'autre côté de la route */}
        <g className="bt-scroll bt-fast" transform="translate(0 20)">
          {[0, 1].map((rep) => scene.near.map((n, i) => <Roadside key={`${rep}-${i}`} x={rep * W + n.x} kind={n.kind} s={n.s} pal={pal} />))}
        </g>
        {/* Nationale 1 à deux voies, accotements de latérite rouge */}
        <rect y="168" width="720" height="5" fill="#b5532f" />
        <rect y="173" width="720" height="56" fill="url(#bt-asphalt)" />
        <rect y="229" width="720" height="7" fill="#a84a2a" />
        <g className="bt-scroll bt-road">
          {Array.from({ length: 24 }, (_, i) => <rect key={i} x={i * 60} y="200" width="30" height="2.5" fill="#e9e9e9" />)}
        </g>
        {/* Circulation d'en face (camions, citernes, cars, taxis, motos) : elle passe derrière notre car */}
        {scene.traffic.map((v, i) => (
          <g key={i} className="bt-veh bt-far" style={{ animationDuration: `${v.dur}s`, animationDelay: `${v.delay}s` }}>
            <Vehicle kind={v.kind} color={v.color} far />
          </g>
        ))}
        {/* Notre car, de profil : passagers aux fenêtres, le joueur repéré */}
        <g className="bt-cabin" transform="translate(110 0)">
          <ellipse cx="250" cy="226" rx="260" ry="6" fill="#000" opacity=".3" />
          <rect x="6" y="112" width="200" height="8" rx="2" fill="#5b4330" />
          {[20, 70, 120, 160].map((bx, i) => <rect key={bx} x={bx} y={98 - (i % 2) * 4} width={36} height={16 + (i % 2) * 4} rx="3" fill={['#c0392b', '#2a9d8f', '#f1c40f', '#7b2cbf'][i]} />)}
          <path d="M0 214 V132 Q0 118 14 118 H468 Q492 118 498 142 L506 186 V214Z" fill="#f4f1ea" />
          <rect x="0" y="182" width="506" height="9" fill="#006a4e" />
          <rect x="0" y="191" width="506" height="5" fill="#ffce00" />
          <rect x="0" y="196" width="506" height="3" fill="#d21034" />
          {scene.seats.map((p, i) => {
            const wx = 18 + i * 64;
            return (
              <g key={i}>
                <rect x={wx} y="128" width="56" height="44" rx="4" fill="#24384a" />
                {!p.empty && (
                  <g className={p.me ? 'bt-me' : undefined}>
                    <path d={`M${wx + 10} 172 Q${wx + 12} 156 ${wx + 28} 155 Q${wx + 44} 156 ${wx + 46} 172Z`} fill={p.me ? '#006a4e' : p.shirt} />
                    <ellipse cx={wx + 28} cy="146" rx="8.5" ry="10" fill={p.skin} />
                    {p.wrap ? <path d={`M${wx + 19} 146 Q${wx + 18} 132 ${wx + 28} 132 Q${wx + 39} 132 ${wx + 37} 146 Q${wx + 28} 140 ${wx + 19} 146Z`} fill={p.wrap} /> : <path d={`M${wx + 19.5} 143 Q${wx + 20} 134 ${wx + 28} 135 Q${wx + 36} 134 ${wx + 36.5} 143 Q${wx + 28} 139 ${wx + 19.5} 143Z`} fill="#141414" />}
                  </g>
                )}
                <rect x={wx} y="128" width="56" height="44" rx="4" fill="url(#bt-glare)" />
                <rect x={wx + 2} y="166" width="52" height="6" fill="#8a1c1c" />
              </g>
            );
          })}
          {/* Pare-brise, porte, phares */}
          <path d="M466 128 H476 Q488 128 492 144 L498 172 H466Z" fill="#24384a" />
          <rect x="452" y="128" width="10" height="80" rx="2" fill="#d8d3c6" stroke="#b9b3a3" />
          <rect x="496" y="196" width="10" height="8" rx="2" fill="#fff3b0" />
          <rect x="0" y="198" width="6" height="8" fill="#d21034" />
          {[70, 110, 420].map((cx) => (
            <g key={cx} transform={`translate(${cx} 214)`}>
              <circle r="17" fill="#1a1a1a" />
              <g className="bt-wheel"><circle r="9" fill="#9a9a9a" /><path d="M-9 0 H9 M0 -9 V9" stroke="#555" strokeWidth="2.5" /></g>
            </g>
          ))}
          <g transform={`translate(${18 + 2 * 64 + 28} 88)`}>
            <rect x="-30" y="-14" width="60" height="22" rx="11" fill="#ffce00" />
            <path d="M-6 8 L0 18 L6 8Z" fill="#ffce00" />
            <text y="2" textAnchor="middle" className="bt-you">{t('bustrip.you')}</text>
          </g>
        </g>
        {/* Herbes du premier plan */}
        <g className="bt-scroll bt-front">
          {[0, 1].map((rep) => scene.bush.map((b, i) => (
            <g key={`${rep}-${i}`} transform={`translate(${rep * W + b.x * 1.3} 262)`} stroke={pal.grass} strokeWidth="2.5" strokeLinecap="round" fill="none">
              {[-8, -3, 2, 7].map((gx) => <path key={gx} d={`M${gx} 0 q${gx * 0.3} -10 ${gx * 0.9} -${16 + Math.abs(gx)}`} />)}
            </g>
          )))}
        </g>
      </svg>

      <div className="bus-trip-text">
          <h2>{t('intercity.onTheRoad', { city: t(`cities.${to}`) })}</h2>
          <p>{t('bustrip.passed', { town: name(passed) })}</p>
          {next !== passed && <p className="muted">{t('bustrip.next', { town: name(next) })}</p>}
          <p className="muted">{t(`bustrip.zone.${zone}`)}</p>
          <div className="trip-track"><div className="trip-fill" style={{ width: `${Math.round(ratio * 100)}%` }} /></div>
          <p className="muted">{t('intercity.arrivesIn', { min: Math.floor(left / 60), sec: String(left % 60).padStart(2, '0') })}</p>
        </div>
      </div>
        <svg className="bus-map" viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label={t('bustrip.map')}>
          <rect width={MAP_W} height={MAP_H} fill="#ece4d0" />
          <rect y={proj([0, 6.2])[1]} width={MAP_W} height={MAP_H} fill="#9fcbe0" />
          <text x={MAP_W / 2} y={MAP_H - 6} textAnchor="middle" className="bm-sea">{t('bustrip.gulf')}</text>
          <text x="10" y={proj([0, 8.2])[1]} className="bm-country">GHANA</text>
          <text x={MAP_W - 6} y={proj([0, 8.6])[1]} textAnchor="end" className="bm-country">{t('bustrip.benin')}</text>
          <text x={MAP_W / 2} y="12" textAnchor="middle" className="bm-country">BURKINA FASO</text>
          <polygon points={TOGO.map((q) => proj(q).join(',')).join(' ')} fill="#cfe2b0" stroke="#5f7d47" strokeWidth="1.5" strokeLinejoin="round" />
          {/* Monts du Togo (chaîne de l'Atakora), de Kpalimé à Kanté */}
          <polyline points={[[0.62, 6.95], [0.75, 7.4], [0.85, 8.0], [1.0, 8.6], [1.2, 9.3], [1.15, 9.8]].map((q) => proj(q as [number, number]).join(',')).join(' ')} fill="none" stroke="#b49a6a" strokeWidth="16" strokeLinecap="round" opacity=".35" />
          {/* Tout le réseau parcouru par les cars, puis le trajet : fait en plein, reste en pointillés */}
          {Object.values(FROM_LOME).map((r, i) => (
            <polyline key={i} points={r.map((c) => proj(TOWNS[c]!).join(',')).join(' ')} fill="none" stroke="#fff" strokeWidth="4" strokeLinejoin="round" />
          ))}
          <polyline points={pts.map((q) => q.join(',')).join(' ')} fill="none" stroke="#c0392b" strokeWidth="3" strokeDasharray="6 4" strokeLinejoin="round" />
          <polyline points={done.map((q) => q.join(',')).join(' ')} fill="none" stroke="#c0392b" strokeWidth="4.5" strokeLinejoin="round" strokeLinecap="round" />
          {(() => {
            const [sx, sy] = proj([1.3, 7.95]);
            return (
              <g transform={`translate(${sx} ${sy})`}>
                <rect x="-11" y="-8" width="22" height="16" rx="3" fill="#c0392b" stroke="#fff" strokeWidth="1.5" />
                <text y="4" textAnchor="middle" className="bm-shield">N1</text>
              </g>
            );
          })()}
          {Object.keys(TOWNS).map((c) => {
            const [x, y] = proj(TOWNS[c]!);
            const i = route.indexOf(c);
            const end = c === route[0] || c === route[route.length - 1];
            const isCity = ['lome', 'kpalime', 'sokode', 'kara', 'dapaong', 'atakpame'].includes(c);
            if (i < 0 && !isCity) return null;
            const reached = i >= 0 && i <= passedIdx;
            return (
              <g key={c}>
                <circle cx={x} cy={y} r={end ? 6 : isCity ? 4.5 : 3} fill={reached ? '#c0392b' : '#fff'} stroke="#14213d" strokeWidth="1.5" />
                <text x={x + (x > MAP_W - 90 ? -9 : 9)} y={y + 4} textAnchor={x > MAP_W - 90 ? 'end' : 'start'} className={end ? 'bm-town bm-end' : 'bm-town'}>{name(c)}</text>
              </g>
            );
          })}
          <g transform={`translate(${bus[0]} ${bus[1]})`}>
            <circle r="15" className="bm-pulse" />
            <circle r="12" fill="#14213d" stroke="#ffce00" strokeWidth="2.5" />
            <text y="5" textAnchor="middle" fontSize="13">🚌</text>
          </g>
        </svg>
    </div>
  );
}

type Zone = 'south' | 'hills' | 'savanna';
type Pal = { haze: string; far: string; mid: string; midLow: string; ground: string; groundLow: string; bush: string; leaf: string; grass: string };
const PALETTE: Record<Zone, Pal> = {
  south: { haze: '#dfe9e4', far: '#a7bcb6', mid: '#6f9a5c', midLow: '#5d8a49', ground: '#7fa94e', groundLow: '#5e8c3a', bush: '#3f7a36', leaf: '#2f6b3a', grass: '#6c9c40' },
  hills: { haze: '#d6e0e3', far: '#7e93a6', mid: '#4f7a4a', midLow: '#3f6a3b', ground: '#7a9d4a', groundLow: '#5c7e35', bush: '#35632f', leaf: '#2a5a2f', grass: '#7a9a3c' },
  savanna: { haze: '#efe2c6', far: '#b8a68a', mid: '#a59a5e', midLow: '#8c8248', ground: '#c9b46a', groundLow: '#a8914c', bush: '#7b7a3a', leaf: '#5f6e2c', grass: '#d1b86a' },
};

/** Relief, nuages, végétation et circulation de la N1, selon la région traversée. */
function makeScene(zone: Zone, seed: number) {
  const r = rng(seed + zone.length * 101);
  const tall = zone === 'hills' ? 1 : zone === 'south' ? 0.35 : 0.25;
  const far = ridge(seed + 11, 112, 75 * tall + 12, zone === 'hills' ? 36 : 60);
  const mid = ridge(seed + 23, 132, 40 * tall + 8, 28);
  const clouds = Array.from({ length: 5 }, (_, i) => ({ x: i * 150 + r() * 60, y: 30 + r() * 30, w: 30 + r() * 30 }));
  const bush = Array.from({ length: 14 }, (_, i) => ({ x: i * 52 + r() * 30, y: 132 + r() * 8, r: 5 + r() * 6 }));
  const kinds: string[] = zone === 'south' ? ['palm', 'palm', 'tree', 'grass', 'teak', 'hut'] : zone === 'hills' ? ['tree', 'teak', 'grass', 'rock', 'tree', 'palm'] : ['baobab', 'grass', 'nere', 'grass', 'hut', 'rock'];
  // Très peu d'habitations : une case de temps en temps
  const near = Array.from({ length: 14 }, (_, i) => {
    let kind = kinds[Math.floor(r() * kinds.length)]!;
    if (kind === 'hut' && r() < 0.6) kind = 'grass';
    return { x: i * 52 + r() * 24, kind, s: 0.75 + r() * 0.55 };
  });
  const traffic = [
    { kind: 'truck', lane: 'far', dur: 7.5, delay: 0, color: '#c0392b' },
    { kind: 'taxi', lane: 'far', dur: 4.6, delay: 2.4, color: '#f1c40f' },
    { kind: 'bus', lane: 'far', dur: 6.2, delay: 4.2, color: '#1f7a8c' },
    { kind: 'tanker', lane: 'far', dur: 9, delay: 11, color: '#d9d9d9' },
    { kind: 'car', lane: 'far', dur: 4.2, delay: 6.3, color: '#f2f2f2' },
    { kind: 'truck', lane: 'far', dur: 8, delay: 8.5, color: '#2e86ab' },
    { kind: 'moto', lane: 'far', dur: 5, delay: 13.5, color: '#222' },
  ];
  const seats = Array.from({ length: 7 }, (_, i) => ({
    skin: SKINS[Math.floor(r() * SKINS.length)]!,
    wrap: r() < 0.45 ? WRAPS[Math.floor(r() * WRAPS.length)]! : null,
    shirt: WRAPS[Math.floor(r() * WRAPS.length)]!,
    me: i === 2,
    empty: i !== 2 && r() < 0.15,
  }));
  return { far, mid, clouds, bush, near, traffic, seats };
}

/** Véhicule de profil, ombre portée ; `far` : voie d'en face (plus petit, tourné vers la gauche). */
function Vehicle({ kind, color, far }: { kind: string; color: string; far: boolean }) {
  const s = far ? 0.8 : 0.95;
  const y = far ? 192 : 222;
  const glass = '#2b3e50';
  const body =
    kind === 'truck' ? (
      <>
        <rect x="0" y="-36" width="72" height="30" rx="2" fill={color} />
        <rect x="0" y="-36" width="72" height="4" fill="#000" opacity=".15" />
        {[12, 24, 36, 48, 60].map((bx) => <rect key={bx} x={bx} y="-34" width="1.5" height="26" fill="#000" opacity=".15" />)}
        <path d="M74 -6 V-28 Q74 -32 78 -32 H88 L96 -20 V-6Z" fill="#e8e3d6" />
        <path d="M80 -29 H87 L93 -20 H80Z" fill={glass} />
        <rect x="0" y="-8" width="96" height="4" fill="#333" />
      </>
    ) : kind === 'tanker' ? (
      <>
        <rect x="2" y="-30" width="70" height="22" rx="11" fill={color} />
        <rect x="2" y="-21" width="70" height="3" fill="#c0392b" />
        <path d="M74 -6 V-28 Q74 -32 78 -32 H88 L96 -20 V-6Z" fill="#c0392b" />
        <path d="M80 -29 H87 L93 -20 H80Z" fill={glass} />
        <rect x="0" y="-8" width="96" height="4" fill="#333" />
      </>
    ) : kind === 'bus' ? (
      <>
        <rect x="0" y="-32" width="96" height="27" rx="5" fill={color} />
        <rect x="0" y="-14" width="96" height="4" fill="#ffce00" />
        {[6, 22, 38, 54, 70].map((wx) => <rect key={wx} x={wx} y="-28" width="13" height="10" rx="1.5" fill={glass} />)}
        <path d="M86 -28 H93 Q95 -28 95 -24 V-18 H86Z" fill={glass} />
        <rect x="2" y="-36" width="60" height="4" rx="1" fill="#6b4a2b" />
      </>
    ) : kind === 'moto' ? (
      <>
        <path d="M6 -10 H30 L26 -15 H12Z" fill={color} />
        <rect x="15" y="-27" width="9" height="13" rx="3" fill="#e5383b" />
        <circle cx="20" cy="-31" r="5" fill="#f1c40f" />
        <path d="M23 -24 L30 -16" stroke="#5a3825" strokeWidth="3" />
      </>
    ) : (
      <>
        <path d="M0 -8 V-15 Q0 -18 4 -19 L14 -20 L22 -28 H42 L52 -20 Q60 -19 60 -14 V-8Z" fill={color} />
        <path d="M24 -26 H32 V-20 H17Z M34 -26 H41 L48 -20 H34Z" fill={glass} />
        {kind === 'taxi' && <rect x="2" y="-14" width="56" height="2.5" fill="#2e7d32" />}
      </>
    );
  const wheels = kind === 'moto' ? [8, 28] : kind === 'car' || kind === 'taxi' ? [13, 47] : [14, 30, 82];
  return (
    <g transform={`translate(0 ${y}) scale(${far ? -s : s} ${s})`}>
      <ellipse cx={kind === 'moto' ? 18 : kind === 'car' || kind === 'taxi' ? 30 : 48} cy="0" rx={kind === 'moto' ? 18 : kind === 'car' || kind === 'taxi' ? 32 : 50} ry="3" fill="#000" opacity=".25" />
      {body}
      {wheels.map((wx) => (
        <g key={wx}>
          <circle cx={wx} cy="-2" r={kind === 'moto' ? 5 : 6} fill="#151515" />
          <circle cx={wx} cy="-2" r={kind === 'moto' ? 2 : 2.6} fill="#9a9a9a" />
        </g>
      ))}
    </g>
  );
}

/** Décor du bord de la N1 : palmiers, tecks, baobabs, nérés, herbes hautes, rochers, rares cases en banco. */
function Roadside({ x, kind, s, pal }: { x: number; kind: string; s: number; pal: Pal }) {
  const t = `translate(${x} 142) scale(${s})`;
  switch (kind) {
    case 'hut':
      return (
        <g transform={t}>
          <rect x="-13" y="-20" width="26" height="20" fill="#a0522d" />
          <rect x="-4" y="-12" width="8" height="12" fill="#3b2314" />
          <path d="M-19 -18 L0 -38 L19 -18Z" fill="#c8a85a" />
          <path d="M-19 -18 L0 -38 L19 -18" fill="none" stroke="#9c7f3c" strokeWidth="1.5" />
        </g>
      );
    case 'palm':
      return (
        <g transform={t}>
          <path d="M-1 0 Q-4 -24 1 -52 L4 -52 Q0 -24 3 0Z" fill="#7a5230" />
          {[-150, -115, -70, -30, 10, 45].map((a) => (
            <path key={a} d={`M2 -52 q${16 * Math.cos((a * Math.PI) / 180)} ${-6 + 10 * Math.sin((a * Math.PI) / 180)} ${30 * Math.cos((a * Math.PI) / 180)} ${12 + 14 * Math.sin((a * Math.PI) / 180)}`} stroke={pal.leaf} strokeWidth="4.5" fill="none" strokeLinecap="round" />
          ))}
        </g>
      );
    case 'baobab':
      return (
        <g transform={t}>
          <path d="M-9 0 Q-7 -24 -10 -40 H10 Q7 -24 9 0Z" fill="#8b7765" />
          <path d="M-10 -40 L-24 -54 M-4 -40 L-8 -60 M4 -40 L10 -62 M10 -40 L24 -52" stroke="#8b7765" strokeWidth="4" strokeLinecap="round" />
          {[[-24, -56], [-8, -63], [10, -65], [24, -54]].map(([cx, cy]) => <ellipse key={cx} cx={cx} cy={cy} rx="9" ry="5" fill={pal.leaf} />)}
        </g>
      );
    case 'nere':
      return (
        <g transform={t}>
          <rect x="-2.5" y="-24" width="5" height="24" fill="#5b4330" />
          <ellipse cx="0" cy="-32" rx="26" ry="12" fill={pal.leaf} />
        </g>
      );
    case 'teak':
      return (
        <g transform={t}>
          <rect x="-2" y="-40" width="4" height="40" fill="#6b5640" />
          <ellipse cx="0" cy="-44" rx="10" ry="16" fill={pal.leaf} />
          <ellipse cx="-4" cy="-30" rx="8" ry="10" fill={pal.bush} />
        </g>
      );
    case 'rock':
      return (
        <g transform={t}>
          <path d="M-18 0 Q-16 -14 -2 -16 Q14 -14 18 0Z" fill="#8f8a7e" />
          <path d="M-6 -15 Q4 -12 8 -4" stroke="#a9a497" strokeWidth="2" fill="none" />
        </g>
      );
    case 'grass':
      return (
        <g transform={t} stroke={pal.grass} strokeWidth="2" strokeLinecap="round">
          {[-10, -6, -2, 2, 6, 10].map((gx) => <path key={gx} d={`M${gx} 0 q${gx * 0.3} -12 ${gx * 0.8} -${18 + Math.abs(gx)}`} fill="none" />)}
        </g>
      );
    default:
      return (
        <g transform={t}>
          <path d="M-2.5 0 Q-1 -16 -3 -28 H3 Q1 -16 2.5 0Z" fill="#5b4330" />
          <circle cx="0" cy="-38" r="16" fill={pal.leaf} />
          <circle cx="-9" cy="-30" r="10" fill={pal.bush} />
          <circle cx="9" cy="-32" r="10" fill={pal.leaf} />
        </g>
      );
  }
}
