import { useId } from 'react';

/** Illustration d'une chambre d'hôtel selon sa catégorie (SVG dessiné, pas de photo) : plus de confort à chaque niveau. */
export default function RoomPicture({ kind }: { kind: string }) {
  const uid = useId().replace(/:/g, '');
  const id = (n: string) => `${n}${uid}`;
  const lvl = ({ standard: 0, superieure: 1, suite: 2, presidentielle: 3 } as Record<string, number>)[kind] ?? 0;
  const wall = ['#efe6d6', '#ebdcc2', '#e4d3b6', '#2f3a4f'][lvl]!;
  const wall2 = ['#e3d6bf', '#dfcdad', '#d6c19c', '#25304a'][lvl]!;
  const bed = ['#ffffff', '#fdf7ec', '#fbf1dd', '#f7ead0'][lvl]!;
  const throwColor = ['#2f6f9f', '#1f7a4d', '#8a3b52', '#c49a2c'][lvl]!;
  const wood = ['#6b4a33', '#5c3d29', '#4a2f1f', '#3b2616'][lvl]!;
  const floor = lvl >= 2 ? ['#7a5a40', '#6a4b34'] : ['#a58b6c', '#947a5c'];
  const light = lvl === 3;
  return (
    <svg className="room-pic" viewBox="0 0 320 180" role="img" aria-hidden="true">
      <defs>
        <linearGradient id={id('wall')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={wall} />
          <stop offset="1" stopColor={wall2} />
        </linearGradient>
        <linearGradient id={id('floor')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={floor[0]} />
          <stop offset="1" stopColor={floor[1]} />
        </linearGradient>
        <linearGradient id={id('sea')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7fd0f2" />
          <stop offset="0.55" stopColor="#d7f1fb" />
          <stop offset="0.56" stopColor="#3b9bd1" />
          <stop offset="1" stopColor="#1d6fa8" />
        </linearGradient>
        <radialGradient id={id('lamp')}>
          <stop offset="0" stopColor="#fff2b8" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff2b8" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="320" height="180" fill={`url(#${id('wall')})`} />
      <rect y="136" width="320" height="44" fill={`url(#${id('floor')})`} />
      <rect y="132" width="320" height="5" fill={wood} opacity="0.9" />
      {/* Baie vitrée sur la mer, rideaux */}
      <rect x="196" y="20" width={lvl >= 1 ? 112 : 84} height="86" rx="4" fill={`url(#${id('sea')})`} stroke="#fff" strokeWidth="5" />
      <circle cx={lvl >= 1 ? 282 : 258} cy="42" r="9" fill="#ffd166" />
      <path d="M200 92 Q220 86 240 92 T280 92" stroke="#fff" strokeWidth="1.2" fill="none" opacity="0.7" />
      {lvl >= 1 && <line x1="252" y1="20" x2="252" y2="106" stroke="#fff" strokeWidth="4" />}
      <rect x="186" y="16" width="16" height="94" rx="3" fill={lvl === 3 ? '#c49a2c' : '#d8c49a'} opacity="0.95" />
      <rect x={lvl >= 1 ? 302 : 274} y="16" width="16" height="94" rx="3" fill={lvl === 3 ? '#c49a2c' : '#d8c49a'} opacity="0.95" />
      {/* Tableau */}
      <rect x="132" y="28" width="44" height="30" rx="2" fill="#fff" stroke={wood} strokeWidth="2" />
      <path d="M136 52 L148 40 L156 48 L164 38 L172 52Z" fill="#7aa97a" />
      <circle cx="165" cy="36" r="3" fill="#ffd166" />
      {/* Lit : tête de lit, matelas, plaid, oreillers */}
      <rect x="20" y={lvl >= 2 ? 66 : 74} width={lvl >= 2 ? 160 : 132} height={lvl >= 2 ? 40 : 34} rx="7" fill={wood} />
      <rect x="26" y="102" width={lvl >= 2 ? 154 : 126} height="38" rx="9" fill={bed} stroke="#d8cdb8" />
      <rect x="26" y="118" width={lvl >= 2 ? 154 : 126} height="22" rx="7" fill={throwColor} />
      <rect x="26" y="118" width={lvl >= 2 ? 154 : 126} height="4" fill="#fff" opacity="0.25" />
      <rect x="34" y="92" width="40" height="17" rx="7" fill="#fff" stroke="#ddd" />
      <rect x="82" y="92" width="40" height="17" rx="7" fill="#fff" stroke="#ddd" />
      {lvl >= 2 && <rect x="130" y="92" width="40" height="17" rx="7" fill="#fff" stroke="#ddd" />}
      {/* Tables de chevet et lampes (halo lumineux) */}
      <circle cx="12" cy="104" r="22" fill={`url(#${id('lamp')})`} />
      <rect x="2" y="118" width="18" height="20" rx="2" fill={wood} />
      <path d="M5 108 L17 108 L14 96 L8 96Z" fill="#ffe8a3" />
      {lvl >= 1 && (
        <>
          <rect x={lvl >= 2 ? 184 : 158} y="118" width="18" height="20" rx="2" fill={wood} />
          <path d={`M${lvl >= 2 ? 187 : 161} 108 L${lvl >= 2 ? 199 : 173} 108 L${lvl >= 2 ? 196 : 170} 96 L${lvl >= 2 ? 190 : 164} 96Z`} fill="#ffe8a3" />
        </>
      )}
      {/* Tapis */}
      <ellipse cx="110" cy="160" rx="70" ry="9" fill={throwColor} opacity="0.55" />
      {lvl === 0 && <rect x="214" y="112" width="48" height="24" rx="3" fill={wood} />}
      {lvl >= 1 && (
        <>
          {/* Télé murale sur son meuble */}
          <rect x="216" y="112" width="76" height="24" rx="3" fill={wood} />
          <rect x="226" y="86" width="56" height="26" rx="2" fill="#15181f" />
          <rect x="229" y="89" width="50" height="20" fill="#2b5f86" />
        </>
      )}
      {lvl >= 2 && (
        <>
          {/* Coin salon : canapé et table basse */}
          <rect x="204" y="128" width="96" height="22" rx="9" fill="#4b5d73" />
          <rect x="204" y="116" width="96" height="16" rx="7" fill="#5c708a" />
          <rect x="232" y="156" width="42" height="9" rx="3" fill="#3b2a1d" />
        </>
      )}
      {lvl === 3 && (
        <>
          {/* Lustre doré et corbeille de fruits */}
          <path d="M150 0 L150 14" stroke="#c49a2c" strokeWidth="2" />
          <path d="M132 14 L168 14 L160 30 L140 30Z" fill="#c49a2c" />
          {[136, 146, 156, 164].map((x) => <circle key={x} cx={x} cy="33" r="2.2" fill="#fff2b8" />)}
          <circle cx="150" cy="30" r="30" fill={`url(#${id('lamp')})`} opacity="0.5" />
          <ellipse cx="236" cy="150" rx="12" ry="4" fill="#c49a2c" />
          <circle cx="231" cy="146" r="3.4" fill="#e5383b" />
          <circle cx="237" cy="145" r="3.4" fill="#ffd166" />
          <circle cx="242" cy="146" r="3.4" fill="#5fb26a" />
        </>
      )}
      {light && <rect x="0" y="0" width="320" height="180" fill="#ffd166" opacity="0.04" />}
    </svg>
  );
}
