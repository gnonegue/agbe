import { useId, type ReactElement } from 'react';

/**
 * Illustrations des sites de l'appli Industrie (dessins vectoriels, aucun fichier à télécharger) : une scène par type de site
 * (usine, zone franche, culture, élevage). Un site ajouté par l'admin sans dessin propre prend le dessin de sa catégorie.
 */
type Kind = 'FACTORY' | 'FREE_ZONE' | 'FARM' | 'LIVESTOCK';

const SKY: Record<Kind, [string, string]> = {
  FACTORY: ['#bfe3f5', '#eef8fc'],
  FREE_ZONE: ['#c7dcf2', '#f1f6fb'],
  FARM: ['#a9dcf0', '#f4fbe9'],
  LIVESTOCK: ['#b4e0ee', '#f6f9e6'],
};
const GROUND: Record<Kind, string> = { FACTORY: '#c9c3b5', FREE_ZONE: '#bfc4c9', FARM: '#8fc46a', LIVESTOCK: '#a8cf73' };

// ---------- éléments réutilisables ----------

const Smoke = ({ x, y }: { x: number; y: number }) => (
  <g fill="#ffffff" opacity={0.85}>
    <circle cx={x} cy={y} r={3.2} />
    <circle cx={x + 4} cy={y - 4} r={4} />
    <circle cx={x + 9} cy={y - 9} r={4.8} />
  </g>
);

const Chimney = ({ x, y, h, color = '#8a6f5a' }: { x: number; y: number; h: number; color?: string }) => (
  <g>
    <rect x={x} y={y - h} width={5} height={h} fill={color} />
    <rect x={x - 0.6} y={y - h} width={6.2} height={2} fill="#5c4a3c" />
    <rect x={x} y={y - h + 6} width={5} height={1.6} fill="#e5383b" />
    <Smoke x={x + 2.5} y={y - h - 4} />
  </g>
);

/** Bâtiment d'usine à toit en dents de scie. */
const Hall = ({ x, y, w, h, color, roof }: { x: number; y: number; w: number; h: number; color: string; roof: string }) => {
  const teeth = Math.max(2, Math.round(w / 14));
  const tw = w / teeth;
  const pts = Array.from({ length: teeth }, (_, i) => `${x + i * tw},${y - h} ${x + i * tw + tw},${y - h - 7} ${x + i * tw + tw},${y - h}`).join(' ');
  return (
    <g>
      <rect x={x} y={y - h} width={w} height={h} fill={color} />
      <polyline points={pts} fill={roof} stroke={roof} strokeWidth={0.8} />
      {Array.from({ length: Math.max(1, Math.floor(w / 12)) }, (_, i) => (
        <rect key={i} x={x + 4 + i * 12} y={y - h + 5} width={7} height={5} rx={1} fill="#dff3ff" stroke="#9fb8c8" strokeWidth={0.5} />
      ))}
      <rect x={x + w / 2 - 5} y={y - 11} width={10} height={11} fill="#6b7f8e" />
    </g>
  );
};

const Silo = ({ x, y, w, h, color }: { x: number; y: number; w: number; h: number; color: string }) => (
  <g>
    <rect x={x} y={y - h} width={w} height={h} fill={color} />
    <ellipse cx={x + w / 2} cy={y - h} rx={w / 2} ry={w / 5} fill="#ffffff" opacity={0.7} />
    <rect x={x + w * 0.15} y={y - h} width={w * 0.12} height={h} fill="#ffffff" opacity={0.25} />
  </g>
);

const Tank = ({ x, y, w, h, color }: { x: number; y: number; w: number; h: number; color: string }) => (
  <g>
    <rect x={x} y={y - h} width={w} height={h} rx={2} fill={color} />
    <ellipse cx={x + w / 2} cy={y - h} rx={w / 2} ry={2.6} fill="#f7f7f7" />
    <line x1={x} y1={y - h / 2} x2={x + w} y2={y - h / 2} stroke="#b9c0c6" strokeWidth={0.8} />
  </g>
);

const Tree = ({ x, y, s = 1, fruit }: { x: number; y: number; s?: number; fruit?: string }) => (
  <g>
    <rect x={x - 1.2 * s} y={y - 8 * s} width={2.4 * s} height={8 * s} fill="#7a5230" />
    <circle cx={x} cy={y - 12 * s} r={7 * s} fill="#3f9b4b" />
    <circle cx={x - 4 * s} cy={y - 9 * s} r={4.5 * s} fill="#4fb35a" />
    {fruit && [[-3, -13], [3, -11], [0, -8], [4, -15]].map(([dx, dy], i) => <circle key={i} cx={x + dx! * s} cy={y + dy! * s} r={1.5 * s} fill={fruit} />)}
  </g>
);

const Palm = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <g>
    <path d={`M${x} ${y} Q${x + 2 * s} ${y - 12 * s} ${x + 1 * s} ${y - 22 * s}`} stroke="#8a5a2b" strokeWidth={2.2 * s} fill="none" />
    {[-60, -25, 15, 50, 85].map((a, i) => (
      <ellipse key={i} cx={x + 1 * s} cy={y - 22 * s} rx={9 * s} ry={2.2 * s} fill="#2f8f3a" transform={`rotate(${a} ${x + 1 * s} ${y - 22 * s}) translate(${6 * s} 0)`} />
    ))}
    <circle cx={x + 1 * s} cy={y - 20 * s} r={1.8 * s} fill="#e8892b" />
  </g>
);

const Hen = ({ x, y }: { x: number; y: number }) => (
  <g>
    <ellipse cx={x} cy={y - 3} rx={4} ry={3} fill="#ffffff" stroke="#d8d1c4" strokeWidth={0.5} />
    <circle cx={x + 3.5} cy={y - 6} r={2} fill="#ffffff" stroke="#d8d1c4" strokeWidth={0.5} />
    <path d={`M${x + 3} ${y - 8.6} l1 -1.4 l1 1.4z`} fill="#e5383b" />
    <path d={`M${x + 5.4} ${y - 6} l1.8 0.6 l-1.8 0.6z`} fill="#f2a516" />
    <line x1={x - 1} y1={y} x2={x - 1} y2={y + 1.6} stroke="#f2a516" strokeWidth={0.7} />
    <line x1={x + 1} y1={y} x2={x + 1} y2={y + 1.6} stroke="#f2a516" strokeWidth={0.7} />
  </g>
);

/** Quadrupède (bœuf, mouton, chèvre, porc) : corps, tête, pattes, détails par espèce. */
const Beast = ({ x, y, kind }: { x: number; y: number; kind: 'ox' | 'sheep' | 'goat' | 'pig' }) => {
  const c = { ox: '#8b5a3c', sheep: '#f4f1ea', goat: '#c9a27a', pig: '#f2a7b2' }[kind];
  const w = kind === 'ox' ? 14 : kind === 'pig' ? 11 : 10;
  const h = kind === 'ox' ? 7 : 6;
  return (
    <g>
      {[0.2, 0.8].map((f) => <rect key={f} x={x + w * f - 1} y={y - 3} width={2} height={3.5} fill="#4a3426" />)}
      <rect x={x} y={y - 3 - h} width={w} height={h} rx={kind === 'sheep' ? 3.5 : 2.5} fill={c} stroke={kind === 'sheep' ? '#d6d0c2' : 'none'} strokeWidth={0.5} />
      {kind === 'ox' && <ellipse cx={x + 6} cy={y - 6.5} rx={3} ry={2} fill="#ffffff" opacity={0.85} />}
      <rect x={x + w - 1} y={y - 5 - h} width={kind === 'pig' ? 5 : 4.5} height={kind === 'pig' ? 5 : 4.5} rx={1.6} fill={kind === 'sheep' ? '#3b3b3b' : c} />
      {kind === 'ox' && <path d={`M${x + w} ${y - 5 - h} q-1.5 -2.5 -3 -1.5 M${x + w + 3.5} ${y - 5 - h} q1.5 -2.5 3 -1.5`} stroke="#efe6d2" strokeWidth={1} fill="none" />}
      {kind === 'goat' && <path d={`M${x + w + 1} ${y - 5 - h} q0 -3 -2.5 -3.5`} stroke="#6b5a48" strokeWidth={0.9} fill="none" />}
      {kind === 'pig' && <ellipse cx={x + w + 4} cy={y - 2.5 - h} rx={1.4} ry={1.1} fill="#e07f90" />}
    </g>
  );
};

const Crate = ({ x, y, color }: { x: number; y: number; color: string }) => (
  <g>
    <rect x={x} y={y - 6} width={9} height={6} fill={color} stroke="#7a5a2b" strokeWidth={0.5} />
    <line x1={x} y1={y - 3} x2={x + 9} y2={y - 3} stroke="#7a5a2b" strokeWidth={0.5} />
  </g>
);

const Container = ({ x, y, color }: { x: number; y: number; color: string }) => (
  <g>
    <rect x={x} y={y - 8} width={20} height={8} fill={color} />
    {[3, 7, 11, 15].map((d) => <line key={d} x1={x + d} y1={y - 8} x2={x + d} y2={y} stroke="#000000" strokeOpacity={0.18} strokeWidth={0.8} />)}
  </g>
);

const Truck = ({ x, y, color }: { x: number; y: number; color: string }) => (
  <g>
    <rect x={x} y={y - 9} width={18} height={7} fill={color} />
    <rect x={x + 18} y={y - 7.5} width={6} height={5.5} rx={1} fill="#e5383b" />
    <rect x={x + 19.5} y={y - 6.8} width={3} height={2.2} fill="#dff3ff" />
    <circle cx={x + 4} cy={y - 1.5} r={2} fill="#2b2b2b" />
    <circle cx={x + 20} cy={y - 1.5} r={2} fill="#2b2b2b" />
  </g>
);

// ---------- scènes ----------

const G = 78; // ligne du sol

const SCENES: Record<string, () => ReactElement> = {
  savonnerie: () => (
    <>
      <Hall x={34} y={G} w={64} h={26} color="#f3e9d2" roof="#5aa9c9" />
      <Chimney x={102} y={G} h={40} />
      <g fill="#bfe7ff" stroke="#7cc4e6" strokeWidth={0.6} opacity={0.95}>
        <circle cx={20} cy={34} r={5} />
        <circle cx={28} cy={24} r={3.4} />
        <circle cx={14} cy={22} r={2.6} />
        <circle cx={128} cy={30} r={4} />
        <circle cx={138} cy={22} r={2.8} />
      </g>
      {[112, 122, 132].map((x, i) => <rect key={x} x={x} y={G - 7} width={8} height={5} rx={1.5} fill={['#7fd1b9', '#f7c8d4', '#fff1a8'][i]} stroke="#9aa" strokeWidth={0.4} />)}
    </>
  ),
  huilerie: () => (
    <>
      <Palm x={16} y={G} s={1.1} />
      <Palm x={142} y={G} s={0.9} />
      <Hall x={40} y={G} w={46} h={22} color="#f6dfb7" roof="#c0602d" />
      <Tank x={92} y={G} w={14} h={24} color="#e8892b" />
      <Tank x={109} y={G} w={14} h={18} color="#f2a516" />
      <Chimney x={70} y={G - 22} h={14} />
    </>
  ),
  eau_minerale: () => (
    <>
      <Hall x={30} y={G} w={60} h={24} color="#e8f4fb" roof="#2f8fd1" />
      <Tank x={96} y={G} w={18} h={30} color="#9fd3f2" />
      <path d="M105 18 q-5 8 0 11 q5 -3 0 -11z" fill="#2f8fd1" />
      {[118, 126, 134, 142].map((x) => (
        <g key={x}>
          <rect x={x} y={G - 14} width={5} height={14} rx={1.8} fill="#cdeeff" stroke="#6fb6e0" strokeWidth={0.6} />
          <rect x={x + 1.5} y={G - 16.5} width={2} height={2.6} fill="#2f8fd1" />
        </g>
      ))}
    </>
  ),
  minoterie: () => (
    <>
      <Silo x={26} y={G} w={14} h={40} color="#e4d6b4" />
      <Silo x={42} y={G} w={14} h={40} color="#d8c9a3" />
      <Hall x={62} y={G} w={50} h={24} color="#f1ead8" roof="#a87b3b" />
      {[118, 124, 130, 136, 142, 148].map((x, i) => (
        <g key={x} stroke="#d2a640" strokeWidth={1.1}>
          <line x1={x} y1={G} x2={x + (i % 2 ? 1 : -1)} y2={G - 14} />
          <ellipse cx={x + (i % 2 ? 1 : -1)} cy={G - 16} rx={1.4} ry={3} fill="#e8c35a" stroke="none" />
        </g>
      ))}
    </>
  ),
  brasserie: () => (
    <>
      <Hall x={20} y={G} w={58} h={24} color="#f3e3cc" roof="#8a3b2b" />
      {[84, 100, 116].map((x) => <Tank key={x} x={x} y={G} w={13} h={32} color="#d6dadf" />)}
      <Chimney x={60} y={G - 24} h={12} />
      <g transform="translate(136 50)">
        <rect x={0} y={0} width={14} height={18} rx={2} fill="#f2b33a" />
        <rect x={0} y={-4} width={14} height={5} rx={2} fill="#ffffff" />
        <path d="M14 4 q6 0 6 6 q0 6 -6 6" stroke="#f2b33a" strokeWidth={2.4} fill="none" />
      </g>
    </>
  ),
  cimenterie_ind: () => (
    <>
      <Silo x={20} y={G} w={16} h={46} color="#d9dde1" />
      <Silo x={38} y={G} w={16} h={38} color="#cfd4d9" />
      <rect x={58} y={G - 30} width={50} height={8} rx={4} fill="#a9b0b7" transform={`rotate(-8 83 ${G - 26})`} />
      <Hall x={60} y={G} w={44} h={18} color="#e2e4e7" roof="#7d8791" />
      <Chimney x={110} y={G} h={44} color="#9aa3ad" />
      <g fill="#8d97a3">
        <rect x={124} y={G - 6} width={10} height={6} rx={1.5} />
        <rect x={135} y={G - 6} width={10} height={6} rx={1.5} />
        <rect x={129} y={G - 12} width={10} height={6} rx={1.5} />
      </g>
    </>
  ),
  raffinerie: () => (
    <>
      <Tank x={14} y={G} w={22} h={18} color="#f1f1f1" />
      <Tank x={38} y={G} w={22} h={14} color="#e6e6e6" />
      {[70, 80].map((x) => <rect key={x} x={x} y={G - 46} width={6} height={46} fill="#9aa3ad" />)}
      <g stroke="#7d8791" strokeWidth={1}>
        {[0, 1, 2, 3].map((i) => <line key={i} x1={68} y1={G - 10 - i * 10} x2={88} y2={G - 10 - i * 10} />)}
      </g>
      <rect x={96} y={G - 56} width={3.5} height={56} fill="#7d8791" />
      <path d="M97.7 6 q-5 7 0 12 q5 -5 0 -12z" fill="#ff7a1a" />
      <path d="M97.7 10 q-2.5 4 0 6.5 q2.5 -2.5 0 -6.5z" fill="#ffd166" />
      <rect x={104} y={G - 6} width={46} height={2.5} fill="#7d8791" />
      <Tank x={110} y={G} w={18} h={22} color="#f6f6f6" />
      <Tank x={130} y={G} w={18} h={16} color="#ececec" />
    </>
  ),
  free_zone: () => (
    <>
      <rect x={8} y={G - 30} width={144} height={2} fill="#7d8791" />
      {[10, 50, 90].map((x, i) => <Hall key={x} x={x} y={G} w={36} h={20} color={['#e8ecf1', '#f1ece2', '#e9f1ea'][i]!} roof={['#3d6fb6', '#c0602d', '#3f9b4b'][i]!} />)}
      <rect x={130} y={G - 50} width={3} height={50} fill="#5c6b78" />
      <rect x={130} y={G - 50} width={22} height={3} fill="#f2a516" />
      <line x1={148} y1={G - 47} x2={148} y2={G - 30} stroke="#2b2b2b" strokeWidth={0.6} />
      <Container x={132} y={G} color="#e5383b" />
      <Container x={132} y={G - 8} color="#1f6feb" />
      <Truck x={100} y={G + 9} color="#3f9b4b" />
    </>
  ),
  plantation_fruits: () => (
    <>
      {[16, 40, 64].map((x) => <Tree key={x} x={x} y={G - 2} s={1.15} fruit="#f2a516" />)}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <g key={i} transform={`translate(${88 + i * 11} ${G - 2})`}>
          {[-40, -15, 15, 40].map((a) => <ellipse key={a} cx={0} cy={-5} rx={1.2} ry={5} fill="#3f9b4b" transform={`rotate(${a} 0 0)`} />)}
          <ellipse cx={0} cy={-9} rx={2.6} ry={3.4} fill="#e8b23a" />
          <path d="M-1.5 -12.5 l1.5 -3 l1.5 3z" fill="#3f9b4b" />
        </g>
      ))}
      <Crate x={66} y={G + 10} color="#e8b23a" />
      <Crate x={76} y={G + 10} color="#f2a516" />
    </>
  ),
  ferme_cereales: () => (
    <>
      {/* Champ doré en perspective, sillons, épis au premier plan et rangs de maïs au fond */}
      <polygon points={`0,${G + 16} 92,${G + 16} 80,${G - 6} 0,${G - 6}`} fill="#e8c35a" />
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={i} x1={0} y1={G - 2 + i * 4} x2={88 - (4 - i) * 2.2} y2={G - 2 + i * 4} stroke="#d2a640" strokeWidth={0.9} />
      ))}
      {Array.from({ length: 12 }, (_, c) => (
        <g key={c} transform={`translate(${4 + c * 7} ${G + 14})`}>
          <line x1={0} y1={0} x2={0} y2={-11} stroke="#b8892c" strokeWidth={0.9} />
          {[0, 1, 2, 3].map((k) => (
            <g key={k}>
              <ellipse cx={-1.3} cy={-10 + k * 2} rx={1.3} ry={0.7} fill="#c99a2e" transform={`rotate(-30 -1.3 ${-10 + k * 2})`} />
              <ellipse cx={1.3} cy={-10 + k * 2} rx={1.3} ry={0.7} fill="#c99a2e" transform={`rotate(30 1.3 ${-10 + k * 2})`} />
            </g>
          ))}
        </g>
      ))}
      {Array.from({ length: 8 }, (_, c) => (
        <g key={c} transform={`translate(${6 + c * 9.5} ${G - 5})`}>
          <line x1={0} y1={0} x2={0} y2={-12} stroke="#3f9b4b" strokeWidth={1.1} />
          <path d="M0 -4 q-5 -2 -6 -6 M0 -7 q5 -2 6 -6" stroke="#4fb35a" strokeWidth={1.1} fill="none" />
          <ellipse cx={1.6} cy={-8} rx={1.1} ry={2.4} fill="#f2c94c" />
        </g>
      ))}
      <Silo x={96} y={G} w={13} h={34} color="#e4d6b4" />
      <rect x={112} y={G - 22} width={28} height={22} fill="#c0392b" />
      <polygon points={`110,${G - 22} 126,${G - 34} 142,${G - 22}`} fill="#8e2a20" />
      <rect x={121} y={G - 12} width={10} height={12} fill="#f3e3cc" />
      <g transform={`translate(70 ${G + 9})`}>
        <rect x={0} y={-8} width={14} height={6} rx={1} fill="#3f9b4b" />
        <rect x={10} y={-13} width={6} height={6} fill="#3f9b4b" />
        <circle cx={3} cy={-1.5} r={3} fill="#2b2b2b" />
        <circle cx={13} cy={-1} r={2} fill="#2b2b2b" />
      </g>
    </>
  ),
  maraichage_pro: () => (
    <>
      {[0, 1, 2, 3].map((r) => (
        <g key={r}>
          <rect x={8} y={G - 30 + r * 9} width={96} height={5} rx={2} fill="#7a5230" />
          {Array.from({ length: 11 }, (_, c) => (
            <g key={c}>
              <circle cx={13 + c * 8.5} cy={G - 31 + r * 9} r={2.6} fill={['#3f9b4b', '#4fb35a', '#2f8f3a', '#5cbf63'][r]} />
              {r === 0 && c % 2 === 0 && <circle cx={14 + c * 8.5} cy={G - 30 + r * 9} r={1.3} fill="#e5383b" />}
              {r === 2 && c % 3 === 0 && <circle cx={14 + c * 8.5} cy={G - 30 + r * 9} r={1.1} fill="#f2a516" />}
            </g>
          ))}
        </g>
      ))}
      <path d="M112 78 v-28 q14 -16 28 0 v28z" fill="#dff3ff" stroke="#9fb8c8" strokeWidth={0.8} opacity={0.9} />
      <Crate x={142} y={G} color="#e5383b" />
      <Crate x={142} y={G - 6} color="#f2a516" />
    </>
  ),
  elevage_volailles: () => (
    <>
      <rect x={14} y={G - 24} width={56} height={24} fill="#f3e3cc" />
      <polygon points={`10,${G - 24} 42,${G - 38} 74,${G - 24}`} fill="#c0602d" />
      {[22, 34, 46, 58].map((x) => <rect key={x} x={x} y={G - 18} width={6} height={4} fill="#5c4a3c" />)}
      {[[86, G + 2], [100, G - 2], [114, G + 3], [128, G - 1], [142, G + 2], [94, G + 10], [122, G + 10]].map(([x, y], i) => <Hen key={i} x={x!} y={y!} />)}
      <g fill="#fff8e6" stroke="#e0d2b0" strokeWidth={0.5}>
        <ellipse cx={20} cy={G + 8} rx={2} ry={2.6} />
        <ellipse cx={25} cy={G + 8} rx={2} ry={2.6} />
        <ellipse cx={30} cy={G + 8} rx={2} ry={2.6} />
      </g>
    </>
  ),
  ranch_bovins: () => (
    <>
      <g stroke="#8a5a2b" strokeWidth={1.2}>
        <line x1={4} y1={G - 10} x2={156} y2={G - 10} />
        <line x1={4} y1={G - 5} x2={156} y2={G - 5} />
        {[4, 30, 56, 82, 108, 134, 156].map((x) => <line key={x} x1={x} y1={G - 13} x2={x} y2={G} />)}
      </g>
      <Tree x={140} y={G - 14} s={1.2} />
      <Beast x={14} y={G + 8} kind="ox" />
      <Beast x={40} y={G + 10} kind="ox" />
      <Beast x={68} y={G + 7} kind="sheep" />
      <Beast x={86} y={G + 11} kind="sheep" />
      <Beast x={106} y={G + 8} kind="goat" />
      <Beast x={124} y={G + 11} kind="goat" />
    </>
  ),
  porcherie: () => (
    <>
      <rect x={18} y={G - 22} width={64} height={22} fill="#e9e2d6" />
      <polygon points={`14,${G - 22} 50,${G - 34} 86,${G - 22}`} fill="#7d8791" />
      {[26, 42, 58].map((x) => <rect key={x} x={x} y={G - 16} width={10} height={6} fill="#c9d6df" />)}
      <ellipse cx={120} cy={G + 4} rx={30} ry={6} fill="#9b7650" opacity={0.6} />
      <Beast x={96} y={G + 6} kind="pig" />
      <Beast x={116} y={G + 9} kind="pig" />
      <Beast x={134} y={G + 5} kind="pig" />
    </>
  ),
  pisciculture: () => (
    <>
      <rect x={0} y={G - 6} width={160} height={30} fill="#5fb3d9" />
      <g stroke="#ffffff" strokeOpacity={0.6} strokeWidth={0.8} fill="none">
        <path d="M10 82 q5 -2 10 0 t10 0" />
        <path d="M60 88 q5 -2 10 0 t10 0" />
        <path d="M120 84 q5 -2 10 0 t10 0" />
      </g>
      {[20, 64, 108].map((x) => (
        <g key={x}>
          <ellipse cx={x + 14} cy={G + 2} rx={16} ry={5} fill="none" stroke="#f2a516" strokeWidth={2} />
          <ellipse cx={x + 14} cy={G + 2} rx={13} ry={3.5} fill="#3f8fb8" opacity={0.6} />
        </g>
      ))}
      {[[34, G + 12], [80, G + 14], [126, G + 11]].map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <ellipse cx={0} cy={0} rx={5} ry={2.4} fill="#c9d6df" />
          <path d="M4.5 0 l3 -2.2 v4.4z" fill="#c9d6df" />
          <circle cx={-3} cy={-0.5} r={0.6} fill="#2b2b2b" />
        </g>
      ))}
      <rect x={130} y={G - 26} width={22} height={20} fill="#f3e3cc" />
      <polygon points={`127,${G - 26} 141,${G - 36} 155,${G - 26}`} fill="#3d6fb6" />
      <Palm x={14} y={G - 6} s={0.8} />
    </>
  ),
};

/** Dessin d'une catégorie, pour un site sans scène propre. */
const BY_KIND: Record<Kind, string> = { FACTORY: 'savonnerie', FREE_ZONE: 'free_zone', FARM: 'plantation_fruits', LIVESTOCK: 'ranch_bovins' };

export function plantScene(id: string, kind: Kind): string {
  if (id in SCENES) return id;
  if (id.startsWith('zone_franche')) return 'free_zone';
  return BY_KIND[kind] ?? 'savonnerie';
}

export default function PlantArt({ id, kind, label }: { id: string; kind: Kind; label: string }) {
  const uid = useId().replace(/:/g, '');
  const k: Kind = kind in SKY ? kind : 'FACTORY';
  const Scene = SCENES[plantScene(id, k)]!;
  const [top, bottom] = SKY[k];
  return (
    <svg className="plant-art" viewBox="0 6 160 90" role="img" aria-label={label}>
      <defs>
        <linearGradient id={`sky${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
      </defs>
      <rect width={160} height={100} fill={`url(#sky${uid})`} />
      <circle cx={140} cy={14} r={7} fill="#ffd166" opacity={0.9} />
      <rect y={G} width={160} height={100 - G} fill={GROUND[k]} />
      <Scene />
    </svg>
  );
}
