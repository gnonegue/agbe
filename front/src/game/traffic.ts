/**
 * Circulation ambiante : modèle de conduite IDM (Intelligent Driver Model) et index des files.
 * Logique pure (sans Three.js) : chaque véhicule accélère et freine progressivement selon la distance
 * libre devant lui (véhicule de tête, ligne de feu, carrefour occupé, piéton).
 */

export interface Mover {
  axis: 'x' | 'z';
  /** Décalage de la voie (coordonnée perpendiculaire à l'axe). */
  lane: number;
  /** Position le long de l'axe (centre du véhicule). */
  pos: number;
  dir: 1 | -1;
  /** Vitesse désirée (m/s). */
  speed: number;
  /** Vitesse actuelle (m/s). */
  v: number;
  /** Longueur du véhicule (m). */
  len: number;
  /** Distance libre jusqu'au véhicule de tête (pare-chocs à pare-chocs), Infinity si aucun. */
  gap: number;
  /** Vitesse du véhicule de tête. */
  leadV: number;
  /** Temps passé immobilisé sans raison valable (s). */
  stuck: number;
  /** Heure (s) du dernier demi-tour dû à un obstacle, et temps (s) passé bloqué depuis : évitent de basculer sans fin d'une voie à l'autre. */
  turnAt?: number;
  blockT?: number;
  /** Décalage latéral (m) vers le bord droit de la chaussée : le véhicule se range pour laisser passer l'ambulance. */
  yieldOff?: number;
}

/** Paramètres de conduite : accélération confortable, freinage confortable, distance d'arrêt, temps de suivi. */
export const IDM = { a: 2.4, b: 3.2, s0: 1.4, T: 0.9 } as const;
/** Freinage maximal (urgence) : jamais au-delà, pas d'arrêt instantané. */
export const MAX_BRAKE = 9;

/** Accélération IDM pour une vitesse v, une vitesse désirée v0, une distance libre gap et un écart de vitesse dv = v - vTête. */
export function idmAccel(v: number, v0: number, gap: number, dv: number): number {
  const sStar = IDM.s0 + Math.max(0, v * IDM.T + (v * dv) / (2 * Math.sqrt(IDM.a * IDM.b)));
  const free = 1 - (v / Math.max(0.1, v0)) ** 4;
  const inter = gap === Infinity ? 0 : gap > 0.05 ? (sStar / gap) ** 2 : 1e3;
  return Math.max(-MAX_BRAKE, IDM.a * (free - inter));
}

/** Distance nécessaire pour s'arrêter en freinant confortablement depuis la vitesse v. */
export const brakingDistance = (v: number) => (v * v) / (2 * IDM.b);

/**
 * Index des files : véhicules regroupés par (axe, sens, route), triés dans le sens de la marche.
 * Les tableaux sont réutilisés d'une image à l'autre (aucune allocation en régime établi) et
 * presque triés, d'où un tri par insertion quasi linéaire.
 */
export class LaneIndex<T extends Mover> {
  private readonly files = new Map<number, T[]>();

  constructor(private readonly roadOf: (m: T) => number) {}

  update(fleet: readonly T[]): void {
    for (const f of this.files.values()) f.length = 0;
    for (const m of fleet) {
      const k = (m.axis === 'x' ? 0 : 1) + (m.dir > 0 ? 2 : 0) + Math.round(this.roadOf(m)) * 4;
      let f = this.files.get(k);
      if (!f) this.files.set(k, (f = []));
      f.push(m);
    }
    for (const f of this.files.values()) {
      // Tri par position dans le sens de la marche (du plus en arrière au plus en avant)
      for (let i = 1; i < f.length; i++) {
        const m = f[i]!;
        const key = m.pos * m.dir;
        let j = i - 1;
        while (j >= 0 && f[j]!.pos * f[j]!.dir > key) {
          f[j + 1] = f[j]!;
          j--;
        }
        f[j + 1] = m;
      }
      for (let i = 0; i < f.length; i++) {
        const m = f[i]!;
        const lead = f[i + 1];
        if (lead) {
          m.gap = (lead.pos - m.pos) * m.dir - (lead.len + m.len) / 2;
          m.leadV = lead.v;
        } else {
          m.gap = Infinity;
          m.leadV = m.speed;
        }
      }
    }
  }
}

/**
 * Un pas de conduite : vitesse mise à jour par IDM vers l'obstacle le plus proche (distance `stopGap`,
 * vitesse `stopV`), puis avance. Renvoie la nouvelle position (le véhicule ne recule jamais et ne
 * mord jamais sur l'obstacle).
 */
export function drive(m: Mover, stopGap: number, stopV: number, dt: number): number {
  const acc = idmAccel(m.v, m.speed, stopGap, m.v - stopV);
  m.v = Math.min(m.speed * 1.05, Math.max(0, m.v + acc * dt));
  let step = m.v * dt;
  // Garde-fou : ne jamais entrer dans la marge d'arrêt de l'obstacle
  if (stopGap !== Infinity && step > stopGap - 0.3) {
    step = Math.max(0, stopGap - 0.3);
    if (step === 0) m.v = 0;
  }
  return m.pos + step * m.dir;
}
