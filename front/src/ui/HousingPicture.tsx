import { useId } from 'react';
import type { Housing } from '../api/types';

/** Palmier dessiné en SVG (tronc courbe, cinq palmes). */
function Palm({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M0 0 C1 -8 -1 -16 1.5 -24" stroke="#8a6a45" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      {[-70, -35, 0, 35, 70].map((a) => (
        <path key={a} d="M1.5 -24 C6 -30 12 -29 15 -24 C9 -26 5 -25 1.5 -24Z" fill="#2f9e4f" transform={`rotate(${a} 1.5 -24)`} />
      ))}
      <circle cx="1.5" cy="-23.5" r="1.4" fill="#6b4a2a" />
    </g>
  );
}

function Cloud({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill="#fff" opacity="0.9">
      <ellipse cx="0" cy="0" rx="9" ry="3.6" />
      <ellipse cx="-4" cy="-2.6" rx="5" ry="3.4" />
      <ellipse cx="3.5" cy="-3.2" rx="6" ry="4" />
    </g>
  );
}

/**
 * Dessin du logement : une pièce (entrer-coucher), deux pièces (chambre-salon), villa à étage dans sa cour.
 * Décor commun (ciel, soleil, collines, pelouse, ombres) et détails propres à chaque type, sans image externe.
 */
export default function HousingPicture({ housing }: { housing: Housing }) {
  const uid = useId().replace(/:/g, '');
  const id = (n: string) => `${n}${uid}`;
  return (
    <svg className="housing-pic" viewBox="0 0 160 100" role="img" aria-hidden="true">
      <defs>
        <linearGradient id={id('sky')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6ec3ee" />
          <stop offset="0.7" stopColor="#c9ecfb" />
          <stop offset="1" stopColor="#fff3d6" />
        </linearGradient>
        <linearGradient id={id('grass')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fcf6a" />
          <stop offset="1" stopColor="#5faa49" />
        </linearGradient>
        <linearGradient id={id('earth')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9b784" />
          <stop offset="1" stopColor="#b98f5a" />
        </linearGradient>
        <linearGradient id={id('glass')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a9dcf5" />
          <stop offset="1" stopColor="#4f86a8" />
        </linearGradient>
        <linearGradient id={id('wallShade')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="1" stopColor="#000" stopOpacity="0.1" />
        </linearGradient>
        <radialGradient id={id('sun')}>
          <stop offset="0" stopColor="#fff7c2" />
          <stop offset="0.45" stopColor="#ffe27a" />
          <stop offset="1" stopColor="#ffe27a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('roof')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c0623a" />
          <stop offset="1" stopColor="#8f3f22" />
        </linearGradient>
        <linearGradient id={id('tole')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b9c1c9" />
          <stop offset="1" stopColor="#8a949f" />
        </linearGradient>
      </defs>

      {/* Ciel, soleil, nuages, collines lointaines */}
      <rect width="160" height="100" fill={`url(#${id('sky')})`} />
      <circle cx="136" cy="18" r="16" fill={`url(#${id('sun')})`} />
      <circle cx="136" cy="18" r="6" fill="#ffd84d" />
      <Cloud x={30} y={16} />
      <Cloud x={92} y={11} s={0.75} />
      <path d="M0 70 C25 56 45 62 70 66 C95 52 125 58 160 64 L160 80 L0 80Z" fill="#9fd29a" opacity="0.75" />
      <path d="M0 74 C30 66 60 72 90 70 C115 68 140 72 160 70 L160 82 L0 82Z" fill="#7fbf74" />

      {/* Sol */}
      {housing === 'ENTRER_COUCHER' ? <rect y="78" width="160" height="22" fill={`url(#${id('earth')})`} /> : <rect y="78" width="160" height="22" fill={`url(#${id('grass')})`} />}

      {housing === 'ENTRER_COUCHER' && (
        <g>
          <Palm x={20} y={80} s={0.9} />
          <ellipse cx="82" cy="80.5" rx="38" ry="3.5" fill="#000" opacity="0.18" />
          {/* Mur en parpaings enduits */}
          <rect x="56" y="46" width="52" height="34" fill="#e4d8c0" />
          <rect x="56" y="46" width="52" height="34" fill={`url(#${id('wallShade')})`} />
          <rect x="54" y="76" width="56" height="4" fill="#9b8f7e" />
          {[52, 58, 64, 70].map((y) => <line key={y} x1="56" x2="108" y1={y} y2={y} stroke="#b9ad96" strokeWidth="0.3" opacity="0.7" />)}
          {/* Toit de tôle à une pente, avec ondulations */}
          <polygon points="50,48 112,48 108,36 54,40" fill={`url(#${id('tole')})`} />
          {[60, 66, 72, 78, 84, 90, 96, 102].map((x) => <line key={x} x1={x} y1="48" x2={x - 1} y2="38.5" stroke="#6f7882" strokeWidth="0.4" opacity="0.6" />)}
          <rect x="50" y="48" width="62" height="1.6" fill="#6f7882" />
          {/* Porte bleue et fenêtre grillagée */}
          <rect x="72" y="58" width="14" height="22" rx="1" fill="#1f6feb" />
          <rect x="72" y="58" width="14" height="22" rx="1" fill="#000" opacity="0.12" />
          <circle cx="83" cy="69" r="0.9" fill="#ffd84d" />
          <rect x="92" y="56" width="11" height="11" rx="1" fill={`url(#${id('glass')})`} stroke="#5b6b7f" strokeWidth="1" />
          {[95.7, 99.4].map((x) => <line key={x} x1={x} x2={x} y1="56" y2="67" stroke="#5b6b7f" strokeWidth="0.6" />)}
          <rect x="60" y="55" width="8" height="9" rx="0.8" fill={`url(#${id('glass')})`} stroke="#5b6b7f" strokeWidth="0.8" />
          {/* Seau, bidon, petit arbuste */}
          <path d="M112 80 L113 73 L119 73 L120 80Z" fill="#2f6fd0" />
          <rect x="114" y="70" width="4" height="3" fill="#e5383b" />
          <ellipse cx="46" cy="79" rx="5" ry="3" fill="#3a9a4f" />
          <path d="M72 80 Q78 84 90 82 L96 90" stroke="#d3b78a" strokeWidth="3" fill="none" opacity="0.8" />
        </g>
      )}

      {housing === 'CHAMBRE_SALON' && (
        <g>
          <Palm x={14} y={81} s={1} />
          <Palm x={148} y={81} s={0.85} />
          <ellipse cx="80" cy="81" rx="58" ry="4" fill="#000" opacity="0.2" />
          {/* Corps de la maison de cour */}
          <rect x="30" y="44" width="100" height="36" fill="#f3d9a4" />
          <rect x="30" y="44" width="100" height="36" fill={`url(#${id('wallShade')})`} />
          <rect x="28" y="76" width="104" height="4.5" fill="#b08a5a" />
          <line x1="80" y1="44" x2="80" y2="76" stroke="#caa86d" strokeWidth="0.8" strokeDasharray="2.5 2" />
          {/* Toit à deux pans en tôle */}
          <polygon points="22,46 80,27 138,46" fill={`url(#${id('tole')})`} />
          {[34, 44, 54, 64, 74, 86, 96, 106, 116, 126].map((x) => <line key={x} x1={x} y1="46" x2={80 + (x - 80) * 0.42} y2="31" stroke="#6f7882" strokeWidth="0.4" opacity="0.55" />)}
          <polygon points="22,46 80,27 80,29.5 25,47.6" fill="#fff" opacity="0.25" />
          <rect x="22" y="46" width="116" height="2" fill="#6f7882" />
          {/* Véranda : poteaux et auvent */}
          <rect x="26" y="49" width="108" height="3" fill="#8a949f" opacity="0.9" />
          {[30, 56, 104, 130].map((x) => <rect key={x} x={x} y="51" width="2.4" height="29" fill="#7a828c" />)}
          {/* Deux portes, deux fenêtres à volets */}
          {[44, 98].map((x) => (
            <g key={x}>
              <rect x={x} y="57" width="12" height="23" rx="1" fill="#2a9d8f" />
              <rect x={x} y="57" width="12" height="23" rx="1" fill="#000" opacity="0.1" />
              <rect x={x + 2} y="60" width="8" height="7" fill="#1f7a6f" opacity="0.6" />
              <circle cx={x + 10} cy="69" r="0.8" fill="#ffd84d" />
            </g>
          ))}
          {[62, 116].map((x) => (
            <g key={x}>
              <rect x={x - 3} y="55" width="3" height="10" fill="#2a9d8f" />
              <rect x={x + 11} y="55" width="3" height="10" fill="#2a9d8f" />
              <rect x={x} y="55" width="11" height="10" rx="0.8" fill={`url(#${id('glass')})`} stroke="#fff" strokeWidth="0.8" />
              <line x1={x + 5.5} y1="55" x2={x + 5.5} y2="65" stroke="#fff" strokeWidth="0.5" />
            </g>
          ))}
          {/* Pots de fleurs, fût d'eau, clôture basse */}
          {[38, 72, 92, 124].map((x, i) => (
            <g key={x}>
              <rect x={x} y="76" width="5" height="4" fill="#c96a3b" />
              <circle cx={x + 2.5} cy="74.6" r="2.6" fill={['#e5383b', '#ffd84d', '#ff7aa8', '#e5383b'][i]} />
              <circle cx={x + 1} cy="76" r="1.6" fill="#3a9a4f" />
            </g>
          ))}
          <rect x="139" y="64" width="7" height="12" rx="1.5" fill="#1f6feb" />
          <rect x="139" y="62" width="7" height="3" rx="1.2" fill="#6aa8ff" />
          <path d="M0 88 L160 88" stroke="#d3b78a" strokeWidth="1.4" opacity="0.8" />
          <path d="M70 80 Q74 86 66 92 L60 100 L100 100 L88 92 Q84 86 90 80Z" fill="#e3cfa0" opacity="0.8" />
        </g>
      )}

      {housing === 'VILLA' && (
        <g>
          <Palm x={12} y={84} s={1.2} />
          <Palm x={150} y={84} s={1.1} />
          {/* Mur de clôture et portail */}
          <rect x="0" y="82" width="160" height="6" fill="#efe9dc" />
          <rect x="0" y="82" width="160" height="1.2" fill="#fff" />
          <rect x="62" y="78" width="36" height="10" fill="#2b2f36" />
          {Array.from({ length: 9 }, (_, i) => <line key={i} x1={65 + i * 3.7} x2={65 + i * 3.7} y1="79" y2="87.5" stroke="#8a8f99" strokeWidth="0.6" />)}
          {/* Garage avec voiture */}
          <rect x="106" y="56" width="42" height="26" fill="#f4f1ea" />
          <rect x="104" y="53" width="46" height="4" fill="#cfd3d9" />
          <rect x="112" y="64" width="30" height="18" rx="1" fill="#3a3f4a" />
          <path d="M115 78 L117 71 Q121 67 127 67 Q133 67 136 71 L139 78Z" fill="#d62839" />
          <circle cx="119" cy="78" r="2.2" fill="#1b1d22" />
          <circle cx="135" cy="78" r="2.2" fill="#1b1d22" />
          <rect x="121" y="69" width="12" height="4" fill={`url(#${id('glass')})`} />
          <ellipse cx="82" cy="82" rx="68" ry="3.2" fill="#000" opacity="0.18" />
          {/* Corps principal à étage */}
          <rect x="22" y="30" width="80" height="52" fill="#fbf8f2" />
          <rect x="22" y="30" width="80" height="52" fill={`url(#${id('wallShade')})`} />
          <rect x="22" y="56" width="80" height="2.4" fill="#dcd6c8" />
          <rect x="20" y="78" width="84" height="4" fill="#c9bfa8" />
          <rect x="22" y="30" width="22" height="26" fill="#b9a284" />
          {[34, 38, 42, 46, 50, 54].map((y) => <line key={y} x1="22" x2="44" y1={y} y2={y} stroke="#9c8665" strokeWidth="0.35" opacity="0.7" />)}
          {/* Toit de tuiles à quatre pans */}
          <polygon points="16,32 38,14 86,14 108,32" fill={`url(#${id('roof')})`} />
          {[19, 24, 29].map((y) => <line key={y} x1={16 + (32 - y) * 0.9} y1={y} x2={108 - (32 - y) * 0.9} y2={y} stroke="#7a3318" strokeWidth="0.4" opacity="0.7" />)}
          <polygon points="16,32 108,32 108,34.4 16,34.4" fill="#7a3318" />
          {/* Étage : grandes baies éclairées */}
          {[48, 66, 84].map((x) => (
            <g key={x}>
              <rect x={x} y="36" width="13" height="15" rx="0.8" fill={`url(#${id('glass')})`} stroke="#2b2f36" strokeWidth="1" />
              <line x1={x + 6.5} y1="36" x2={x + 6.5} y2="51" stroke="#2b2f36" strokeWidth="0.6" />
              <rect x={x + 1} y="37" width="4" height="13" fill="#fff" opacity="0.18" />
            </g>
          ))}
          {/* Balcon à garde-corps vitré, rez-de-chaussée */}
          <rect x="40" y="54" width="64" height="2.6" fill="#d0d4da" />
          <rect x="41" y="49" width="62" height="5" fill="#9ad0ee" opacity="0.55" />
          <rect x="41" y="48.6" width="62" height="0.9" fill="#fff" />
          {[28, 50].map((x) => (
            <rect key={x} x={x} y="62" width="15" height="14" rx="0.8" fill={`url(#${id('glass')})`} stroke="#2b2f36" strokeWidth="1" />
          ))}
          <rect x="72" y="62" width="13" height="20" rx="1" fill="#6b3e1f" />
          <rect x="72" y="62" width="13" height="20" rx="1" fill="#000" opacity="0.1" />
          <circle cx="82" cy="73" r="0.9" fill="#ffd84d" />
          {[68, 90].map((x) => <rect key={x} x={x} y="56" width="2.2" height="24" fill="#fff" />)}
          {/* Piscine devant la maison et petite pelouse */}
          <rect x="6" y="90" width="48" height="8" rx="3" fill="#35b6e6" />
          <rect x="6" y="90" width="48" height="8" rx="3" fill="none" stroke="#f1ece2" strokeWidth="1.4" />
          <path d="M10 93 Q18 91 26 93 T42 93" stroke="#bdf0ff" strokeWidth="0.8" fill="none" />
          <path d="M104 90 L148 90 L154 100 L98 100Z" fill="#d8d1c2" opacity="0.9" />
          <circle cx="62" cy="92" r="3" fill="#3a9a4f" />
          <circle cx="68" cy="94" r="2.4" fill="#e5383b" />
        </g>
      )}
    </svg>
  );
}
