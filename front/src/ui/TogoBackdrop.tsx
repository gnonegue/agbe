// Fond de l'écran d'accueil : le Togo debout (nord en haut, côte et Lomé en bas), entièrement visible,
// contour tracé aux couleurs du drapeau en dégradé animé, Lomé qui pulse sur la côte.
// Contour simplifié d'après les frontières (lon/lat → 180 unités par degré), purement décoratif.
const TOGO =
  'M27,18 L99,27 L153,36 L220,36 L194,90 L198,135 L243,171 L299,216 L302,279 L310,342 L346,387 L342,486 L349,648 L347,756 L333,761 L342,828 L378,886 L346,896 L306,909 L270,918 L248,900 L216,877 L185,828 L162,801 L149,765 L166,711 L171,680 L148,648 L153,594 L166,540 L144,495 L122,441 L130,387 L144,324 L113,306 L95,288 L108,243 L119,180 L94,135 L40,90 L54,54 Z';

export default function TogoBackdrop() {
  return (
    <div className="togo-bg" aria-hidden="true">
      <span className="togo-blob b1" />
      <span className="togo-blob b2" />
      <span className="togo-blob b3" />
      <svg className="togo-map" viewBox="-40 -40 458 998" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="togoStroke" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#006a4e">
              <animate attributeName="stop-color" values="#006a4e;#ffce00;#d21034;#006a4e" dur="12s" repeatCount="indefinite" />
            </stop>
            <stop offset=".5" stopColor="#ffce00">
              <animate attributeName="stop-color" values="#ffce00;#d21034;#006a4e;#ffce00" dur="12s" repeatCount="indefinite" />
            </stop>
            <stop offset="1" stopColor="#d21034">
              <animate attributeName="stop-color" values="#d21034;#006a4e;#ffce00;#d21034" dur="12s" repeatCount="indefinite" />
            </stop>
          </linearGradient>
          <linearGradient id="togoFill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#006a4e" stopOpacity=".10" />
            <stop offset=".55" stopColor="#ffce00" stopOpacity=".08" />
            <stop offset="1" stopColor="#d21034" stopOpacity=".10" />
          </linearGradient>
          <filter id="togoGlow" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        {/* Bandes du drapeau en filigrane dans le pays */}
        <clipPath id="togoClip"><path d={TOGO} /></clipPath>
        <g clipPath="url(#togoClip)" className="togo-stripes">
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x="-40" y={-40 + i * 200} width="458" height="200" fill={i % 2 ? '#ffce00' : '#006a4e'} opacity=".07" />
          ))}
        </g>
        <path d={TOGO} fill="url(#togoFill)" />
        <path d={TOGO} className="togo-glow" stroke="url(#togoStroke)" filter="url(#togoGlow)" />
        <path d={TOGO} className="togo-line" stroke="url(#togoStroke)" pathLength={1} />
        {/* Lomé, sur la côte */}
        <g className="togo-lome" transform="translate(274 913)">
          <circle r="22" className="pulse" />
          <circle r="7" fill="#d21034" stroke="#fff" strokeWidth="3" />
          <text x="-16" y="6" textAnchor="end" className="togo-lome-label">Lomé</text>
        </g>
      </svg>
    </div>
  );
}
