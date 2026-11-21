// Véhicules du jeu (voitures, taxis, bus, camions, motos, vélos) et leurs conducteurs, dessinés en code.
// Carrosseries lisses d'une seule pièce (profil latéral extrudé à bords arrondis), peinture brillante, vitres teintées.
// Les géométries sont partagées (créées une fois) : seuls les matériaux changent d'un véhicule à l'autre.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bakeGroup, buildPerson, ridePose, type Materials, type PersonLook, type RideSpec } from './kit';
import type { Model } from './assets';

/** `semi` : tracteur et remorque bâchée (15 m) ; `tanker` : citerne (13 m), pour les matières premières, le carburant, le ciment… */
export type CarKind = 'hatch' | 'sedan' | 'suv' | 'van' | 'bus' | 'truck' | 'semi' | 'tanker';

const cache = new Map<string, THREE.BufferGeometry>();
const shared = (key: string, make: () => THREE.BufferGeometry) => {
  let g = cache.get(key);
  if (!g) cache.set(key, (g = make()));
  return g;
};

/** Profil latéral (avant vers +u, haut vers +v) extrudé sur la largeur, bords arrondis, normales lissées. */
function extrude(shape: THREE.Shape, width: number, bevel: number, segments = 3): THREE.BufferGeometry {
  const depth = Math.max(0.01, width - 2 * bevel);
  const raw = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: segments, curveSegments: 10 });
  raw.deleteAttribute('uv');
  raw.deleteAttribute('normal');
  const geo = mergeVertices(raw, 1e-4);
  raw.dispose();
  geo.computeVertexNormals();
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
  return geo.translate(0, 0, -depth / 2).rotateY(-Math.PI / 2);
}

/** Dimensions par modèle : longueur, largeur, garde au sol, hauteur de ceinture, toit, empattement, rayon de roue. */
const SPEC: Record<CarKind, { len: number; w: number; floor: number; belt: number; roof: number; axle: number; wheel: number }> = {
  hatch: { len: 4.0, w: 1.78, floor: 0.32, belt: 1.02, roof: 1.55, axle: 1.3, wheel: 0.33 },
  sedan: { len: 4.5, w: 1.82, floor: 0.32, belt: 1.0, roof: 1.5, axle: 1.42, wheel: 0.34 },
  suv: { len: 4.6, w: 1.9, floor: 0.45, belt: 1.25, roof: 1.9, axle: 1.45, wheel: 0.4 },
  van: { len: 4.9, w: 1.9, floor: 0.4, belt: 1.15, roof: 2.15, axle: 1.6, wheel: 0.36 },
  bus: { len: 10, w: 2.2, floor: 0.45, belt: 1.55, roof: 3.0, axle: 3.3, wheel: 0.5 },
  truck: { len: 6, w: 2.1, floor: 0.5, belt: 1.45, roof: 2.6, axle: 2.0, wheel: 0.46 },
  semi: { len: 15, w: 2.45, floor: 0.5, belt: 1.5, roof: 3.9, axle: 2.0, wheel: 0.5 },
  tanker: { len: 13, w: 2.45, floor: 0.5, belt: 1.5, roof: 3.5, axle: 2.0, wheel: 0.5 },
};

/** Bas de caisse avec passages de roues (demi-cercles) et capot/coffre selon le modèle. */
function bodyShape(k: CarKind): THREE.Shape {
  const s = SPEC[k];
  const L = s.len / 2;
  const R = s.wheel + 0.06;
  const f = s.floor;
  const sh = new THREE.Shape();
  sh.moveTo(-L + 0.12, f);
  // Passage de roue arrière puis avant (arcs au-dessus des roues)
  for (const wz of [-s.axle, s.axle]) {
    sh.lineTo(wz - R, f);
    sh.absarc(wz, s.wheel, R, Math.PI, 0, true);
    sh.lineTo(wz + R, f);
  }
  sh.lineTo(L - 0.14, f);
  // Nez : pare-chocs arrondi, capot (sauf bus et fourgon, à face plate)
  const flat = k === 'bus' || k === 'van';
  sh.quadraticCurveTo(L, f, L, f + 0.18);
  if (flat) {
    sh.lineTo(L, s.belt);
  } else {
    sh.quadraticCurveTo(L + 0.03, s.belt - 0.3, L - 0.14, s.belt - 0.27);
    sh.quadraticCurveTo(L * 0.72, s.belt - 0.12, L * 0.42, s.belt - 0.02);
  }
  // Ceinture de caisse jusqu'à l'arrière (coffre de berline un peu plus haut)
  sh.lineTo(-L * (k === 'sedan' ? 0.62 : 0.8), s.belt + (k === 'sedan' ? 0.02 : 0));
  sh.quadraticCurveTo(-L - 0.02, s.belt, -L, s.belt - 0.2);
  sh.lineTo(-L, f + 0.18);
  sh.quadraticCurveTo(-L, f, -L + 0.12, f);
  return sh;
}

/** Habitacle vitré : pare-brise incliné, toit, lunette arrière (hayon, coffre ou face plate). */
function cabinShape(k: CarKind): THREE.Shape {
  const s = SPEC[k];
  const L = s.len / 2;
  const b = s.belt - 0.04;
  const sh = new THREE.Shape();
  if (k === 'bus' || k === 'van') {
    sh.moveTo(-L + 0.05, b);
    sh.lineTo(L - 0.02, b);
    sh.lineTo(L - 0.12, s.roof - 0.2);
    sh.lineTo(-L + 0.1, s.roof - 0.2);
    return sh;
  }
  if (k === 'truck') {
    // Cabine avancée ; la caisse de chargement est ajoutée à part
    sh.moveTo(L * 0.3, b);
    sh.lineTo(L - 0.12, b);
    sh.lineTo(L - 0.3, s.roof - 0.1);
    sh.lineTo(L * 0.32, s.roof - 0.1);
    return sh;
  }
  const front = k === 'sedan' ? L * 0.38 : L * 0.45;
  sh.moveTo(front, b);
  sh.quadraticCurveTo(front - 0.35, s.roof - 0.25, front - 0.75, s.roof - 0.04);
  const backTop = k === 'sedan' ? -L * 0.42 : -L * 0.82;
  sh.lineTo(backTop, s.roof - 0.04);
  if (k === 'sedan') sh.quadraticCurveTo(-L * 0.55, s.roof - 0.2, -L * 0.66, b);
  else sh.quadraticCurveTo(-L * 0.96, s.roof - 0.25, -L * 0.98, b);
  sh.lineTo(front, b);
  return sh;
}

/** Pneu, jante argentée à cinq branches et enjoliveur. */
function wheel(r: number): THREE.Group {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(shared(`tyre${r}`, () => new THREE.TorusGeometry(r * 0.78, r * 0.24, 10, 24)));
  const rim = new THREE.Mesh(shared(`rim${r}`, () => new THREE.CylinderGeometry(r * 0.6, r * 0.6, 0.2, 20).rotateZ(Math.PI / 2)));
  const cap = new THREE.Mesh(shared(`cap${r}`, () => new THREE.CylinderGeometry(r * 0.16, r * 0.16, 0.24, 12).rotateZ(Math.PI / 2)));
  tyre.rotation.y = Math.PI / 2;
  tyre.scale.set(1, 1, 0.9);
  g.add(tyre, rim, cap);
  // Jante alliage moderne : dix branches fines devant un disque de frein sombre
  const brake = new THREE.Mesh(shared(`brake${r}`, () => new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.1, 18).rotateZ(Math.PI / 2)));
  g.add(brake);
  for (let i = 0; i < 10; i++) {
    const sp = new THREE.Mesh(shared(`spoke${r}`, () => new THREE.BoxGeometry(0.2, r * 0.95, r * 0.065)));
    sp.rotation.x = (i * Math.PI * 2) / 10;
    g.add(sp);
  }
  g.userData.parts = { tyre, rim, cap, brake };
  return g;
}

export interface CarOpts {
  kind: CarKind;
  color: number;
  /** Bande ou toit d'une autre couleur (taxi, ambulance). */
  stripe?: number;
}

/**
 * Voiture, taxi, fourgon, bus ou camion : caisse lisse d'une pièce, habitacle vitré teinté, toit peint, vraies roues,
 * phares, feux, calandre, plaques, rétroviseurs. L'avant est vers +z ; le sol est à y = 0.
 */
export function buildCar(mats: Materials, o: CarOpts): THREE.Group {
  if (o.kind === 'semi' || o.kind === 'tanker') return buildHeavy(mats, o);
  const k = o.kind;
  const s = SPEC[k];
  const g = new THREE.Group();
  const paint = mats.color(o.color, 0.28);
  g.userData.paint = paint;
  const glass = mats.color(0x1c2733, 0.08);
  const trim = mats.color(0x1d2125, 0.55);
  const chrome = mats.color(0xd5dbe1, 0.2);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  add(shared(`body${k}`, () => extrude(bodyShape(k), s.w, 0.12, 4)), paint, 0, 0, 0);
  add(shared(`cabin${k}`, () => extrude(cabinShape(k), s.w - 0.16, 0.09, 3)), glass, 0, 0, 0);
  // Toit peint (et montants) posé sur l'habitacle
  const L = s.len / 2;
  if (k === 'bus' || k === 'van') {
    // Bandeau de toit arrondi au-dessus des vitres
    add(shared(`roof${k}`, () => extrude(roundRect(-L + 0.02, s.roof - 0.3, L - 0.1, s.roof, 0.14), s.w, 0.12, 3)), paint, 0, 0, 0);
    const n = k === 'bus' ? 7 : 3;
    for (let i = 0; i <= n; i++) add(shared(`pillar${k}`, () => new THREE.BoxGeometry(s.w - 0.06, s.roof - s.belt - 0.2, 0.1)), paint, 0, (s.roof + s.belt) / 2 - 0.12, -L + 0.4 + (i * (s.len - 1.6)) / n);
    if (k === 'bus') add(shared('door', () => new THREE.BoxGeometry(0.04, s.roof - 0.6, 0.9)), mats.color(0x1c2733, 0.08), s.w / 2 + 0.01, (s.roof - 0.6) / 2 + 0.2, L - 1.1);
  } else if (k === 'truck') {
    add(shared('truckRoof', () => new THREE.BoxGeometry(s.w - 0.12, 0.14, L * 0.62)), paint, 0, s.roof - 0.05, L * 0.62);
    // Caisse de chargement
    add(shared('truckBox', () => extrude(roundRect(-L + 0.05, s.belt - 0.04, L * 0.26, s.roof + 0.25, 0.1), s.w + 0.06, 0.06, 2)), mats.color(0xe9edf0, 0.6), 0, 0, 0);
  } else {
    const front = (k === 'sedan' ? L * 0.38 : L * 0.45) - 0.75;
    const back = k === 'sedan' ? -L * 0.42 : -L * 0.82;
    add(shared(`roof${k}`, () => extrude(roundRect(back - 0.06, s.roof - 0.02, front + 0.04, s.roof + 0.05, 0.03), s.w - 0.1, 0.05, 2)), paint, 0, 0, 0);
    for (const x of [-1, 1]) add(shared(`bpillar${k}`, () => new THREE.BoxGeometry(0.05, s.roof - s.belt, 0.1)), paint, (x * (s.w - 0.15)) / 2, (s.roof + s.belt) / 2 - 0.02, k === 'sedan' ? -0.02 : -0.1);
    if (k === 'suv') for (const x of [-0.6, 0.6]) add(shared('rails', () => new THREE.BoxGeometry(0.05, 0.05, front - back - 0.2)), chrome, x, s.roof + 0.12, (front + back) / 2);
  }
  if (o.stripe !== undefined) add(shared(`stripe${k}`, () => new THREE.BoxGeometry(s.w + 0.02, 0.14, s.len - 0.6)), mats.color(o.stripe, 0.4), 0, s.belt - 0.28, 0);
  // Face avant : phares, calandre, plaque ; arrière : feux et plaque
  const front = L + 0.02;
  for (const x of [-1, 1]) {
    add(shared('headlight', () => new THREE.CapsuleGeometry(0.07, 0.2, 4, 8).rotateZ(Math.PI / 2)), mats.color(0xfdf6d8, 0.1), (x * s.w) / 2 - x * 0.33, k === 'bus' ? 0.75 : s.belt - 0.26, front - 0.03).scale.set(1, 0.8, 0.6);
    add(shared('taillight', () => new THREE.BoxGeometry(0.3, 0.12, 0.06)), mats.color(0xc8102e, 0.2), (x * s.w) / 2 - x * 0.28, k === 'bus' ? 0.85 : s.belt - 0.2, -L - 0.02);
    // Rétroviseurs
    add(shared('mirror', () => new THREE.CapsuleGeometry(0.05, 0.08, 3, 6).rotateZ(Math.PI / 2)), paint, x * (s.w / 2 + 0.09), s.belt + 0.08, k === 'bus' || k === 'van' || k === 'truck' ? L - 0.25 : L * 0.4);
  }
  add(shared(`grille${k}`, () => new THREE.BoxGeometry(Math.min(0.9, s.w * 0.45), 0.16, 0.04)), trim, 0, k === 'bus' ? 0.6 : s.belt - 0.38, front - 0.01);
  add(shared('plate', () => new THREE.BoxGeometry(0.5, 0.12, 0.02)), mats.color(0xf4f0d8), 0, s.floor + 0.12, front);
  add(shared('plate', () => new THREE.BoxGeometry(0.5, 0.12, 0.02)), mats.color(0xf4f0d8), 0, s.floor + 0.2, -L - 0.03);
  add(shared(`sill${k}`, () => new THREE.BoxGeometry(s.w + 0.01, 0.1, s.len - 1.6 - 2 * s.wheel)), trim, 0, s.floor + 0.05, 0);
  // Détails modernes : signature lumineuse à LED, toit panoramique, antenne requin, poignées affleurantes, jonc latéral chromé
  const led = mats.color(0xffffff, 0.05);
  const ledRed = mats.color(0xff2d3a, 0.1);
  const passenger = k === 'hatch' || k === 'sedan' || k === 'suv';
  if (passenger) {
    // Bandeau de feux de jour à LED et bandeau arrière continu
    add(shared('drl', () => new THREE.BoxGeometry(s.w * 0.62, 0.03, 0.03)), led, 0, s.belt - 0.14, front - 0.01);
    for (const x of [-1, 1]) add(shared('drlSide', () => new THREE.BoxGeometry(0.2, 0.022, 0.03)), led, (x * s.w) / 2 - x * 0.2, s.belt - 0.33, front - 0.02);
    add(shared('lightbar', () => new THREE.BoxGeometry(s.w * 0.84, 0.045, 0.035)), ledRed, 0, s.belt - 0.12, -L - 0.035);
    // Toit panoramique vitré, aileron de hayon et antenne requin
    const fr = (k === 'sedan' ? L * 0.38 : L * 0.45) - 0.75;
    const bk = k === 'sedan' ? -L * 0.42 : -L * 0.82;
    add(shared(`pano${k}`, () => new THREE.BoxGeometry(s.w - 0.62, 0.012, (fr - bk) * 0.5)), glass, 0, s.roof + 0.062, (fr + bk) / 2 + 0.05);
    add(shared('fin', () => new THREE.BoxGeometry(0.05, 0.06, 0.16)), trim, 0, s.roof + 0.08, bk + 0.18);
    add(shared('spoiler', () => new THREE.BoxGeometry(s.w - 0.5, 0.04, 0.14)), paint, 0, s.roof - 0.02, bk - 0.12);
    for (const x of [-1, 1]) {
      add(shared('beltline', () => new THREE.BoxGeometry(0.012, 0.025, s.len * 0.55)), chrome, (x * (s.w + 0.02)) / 2, s.belt - 0.18, 0);
      for (const dz of [0.55, -0.45]) add(shared('handle', () => new THREE.BoxGeometry(0.016, 0.03, 0.15)), chrome, (x * (s.w + 0.02)) / 2, s.belt - 0.1, dz);
    }
  }
  if (k === 'bus') {
    // Bus électrique : afficheur de destination lumineux, climatisation sur le toit, bandeau de feux à LED
    add(shared('dest', () => new THREE.BoxGeometry(s.w - 0.5, 0.2, 0.05)), mats.color(0xffa726, 0.1), 0, s.roof - 0.42, L + 0.01);
    for (const dz of [-1.6, 1.8]) add(shared('busAc', () => new THREE.BoxGeometry(1.2, 0.22, 1.5)), mats.color(0xeceff1, 0.5), 0, s.roof + 0.1, dz);
    add(shared('busBar', () => new THREE.BoxGeometry(s.w * 0.8, 0.06, 0.04)), ledRed, 0, s.belt - 0.35, -L - 0.03);
    add(shared('busDrl', () => new THREE.BoxGeometry(s.w * 0.7, 0.04, 0.04)), led, 0, 0.95, L + 0.02);
  }
  if (k === 'truck') {
    // Camion moderne : déflecteur aérodynamique sur la cabine, barre de feux de toit, jupes latérales
    add(shared('deflector', () => new THREE.BoxGeometry(s.w - 0.2, 0.34, 0.5)), paint, 0, s.roof + 0.2, L * 0.25);
    for (const x of [-0.6, -0.2, 0.2, 0.6]) add(shared('roofLed', () => new THREE.BoxGeometry(0.16, 0.06, 0.06)), mats.color(0xffd166, 0.1), x, s.roof + 0.1, L - 0.35);
    add(shared('truckDrl', () => new THREE.BoxGeometry(s.w * 0.6, 0.04, 0.04)), led, 0, s.belt - 0.3, L + 0.02);
    for (const x of [-1, 1]) add(shared('skirt', () => new THREE.BoxGeometry(0.04, 0.22, s.len * 0.5)), trim, (x * (s.w - 0.04)) / 2, s.floor + 0.1, -L * 0.2);
  }
  if (k === 'van') {
    add(shared('vanLed', () => new THREE.BoxGeometry(s.w * 0.62, 0.03, 0.03)), led, 0, s.belt - 0.14, front - 0.01);
    add(shared('vanBar', () => new THREE.BoxGeometry(s.w * 0.7, 0.045, 0.035)), ledRed, 0, s.belt - 0.12, -L - 0.035);
  }
  // Roues
  const tyreMat = mats.color(0x161616, 0.85);
  const rimMat = mats.color(0xc4ccd4, 0.3);
  const brakeMat = mats.color(0x2a2d31, 0.5);
  for (const z of k === 'bus' ? [s.axle, -s.axle] : [s.axle, -s.axle]) {
    for (const x of [-1, 1]) {
      const w = wheel(s.wheel);
      const p = w.userData.parts as { tyre: THREE.Mesh; rim: THREE.Mesh; cap: THREE.Mesh; brake: THREE.Mesh };
      for (const c of w.children) if (c instanceof THREE.Mesh) c.material = c === p.tyre ? tyreMat : c === p.cap ? chrome : c === p.brake ? brakeMat : rimMat;
      w.position.set(x * (s.w / 2 - 0.12), s.wheel, z);
      g.add(w);
    }
  }
  return g;
}

/**
 * Poids lourd articulé : tracteur à cabine avancée (peinte, teintée par instance) attelé à une remorque bâchée (`semi`)
 * ou à une citerne cylindrique (`tanker`). Essieux : un directeur et un tandem moteur à l'avant, trois essieux de remorque.
 * L'avant est vers +z ; le sol est à y = 0.
 */
function buildHeavy(mats: Materials, o: CarOpts): THREE.Group {
  const k = o.kind;
  const s = SPEC[k];
  const g = new THREE.Group();
  const paint = mats.color(o.color, 0.3);
  g.userData.paint = paint;
  const L = s.len / 2;
  const glass = mats.color(0x1c2733, 0.08);
  const trim = mats.color(0x1d2125, 0.55);
  const chrome = mats.color(0xd5dbe1, 0.2);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number) => shared(`hv${w}-${h}-${d}`, () => new THREE.BoxGeometry(w, h, d));
  // Châssis
  add(box(1.3, 0.32, s.len - 0.3), trim, 0, 0.62, 0);
  // Tracteur : cabine avancée, pare-brise, déflecteur de toit, calandre, phares
  const cabZ = L - 1.55;
  add(box(2.35, 2.4, 2.3), paint, 0, 1.95, cabZ);
  add(box(2.2, 1.05, 0.05), glass, 0, 2.55, cabZ + 1.16);
  for (const x of [-1, 1]) add(box(0.05, 0.85, 1.2), glass, x * 1.19, 2.55, cabZ + 0.3);
  add(box(2.3, 0.7, 1.5), paint, 0, 3.4, cabZ - 0.35); // déflecteur
  add(box(1.5, 0.5, 0.05), trim, 0, 1.1, cabZ + 1.17); // calandre
  add(box(2.4, 0.22, 0.3), chrome, 0, 0.72, L - 0.15); // pare-chocs
  for (const x of [-1, 1]) add(box(0.4, 0.2, 0.06), mats.color(0xfdf6d8, 0.1), x * 0.92, 1.0, cabZ + 1.17);
  for (const x of [-1, 1]) add(box(0.06, 0.26, 0.1), mats.color(0xc8102e, 0.2), x * 0.55, 0.78, -L - 0.02);
  for (const x of [-0.7, -0.35, 0, 0.35, 0.7]) add(box(0.14, 0.07, 0.06), mats.color(0xffd166, 0.1), x, 3.28, cabZ + 1.1);
  // Sellette et remorque
  const trailerFront = L - 3.9;
  const trailerLen = trailerFront + L - 0.2;
  const trailerMid = (trailerFront - L + 0.2) / 2;
  add(shared('fifth', () => new THREE.CylinderGeometry(0.6, 0.6, 0.2, 14)), trim, 0, 0.9, trailerFront - 0.5);
  if (k === 'semi') {
    // Remorque bâchée : caisse blanche, bandeau de couleur, arceaux
    add(box(2.45, 2.75, trailerLen), mats.color(0xeceff1, 0.6), 0, 2.45, trailerMid);
    add(shared(`band${trailerLen}`, () => new THREE.BoxGeometry(2.49, 0.5, trailerLen * 0.9)), paint, 0, 2.2, trailerMid);
    for (let i = 0; i <= 6; i++) add(box(2.5, 0.06, 0.08), trim, 0, 3.8, trailerMid - trailerLen / 2 + 0.2 + (i * (trailerLen - 0.4)) / 6);
    add(box(2.3, 0.45, 0.06), trim, 0, 1.0, -L - 0.05); // barre anti-encastrement
  } else {
    // Citerne : cylindre argenté couché, deux fonds bombés, bande de couleur, passerelle et échelle
    const R = 1.12;
    const len = trailerLen - 0.4;
    add(shared(`tank${len}`, () => new THREE.CylinderGeometry(R, R, len, 22).rotateX(Math.PI / 2)), mats.color(0xc4ccd4, 0.25), 0, 2.15, trailerMid);
    for (const sgn of [-1, 1]) add(shared('tankCap', () => new THREE.SphereGeometry(R, 18, 10)), mats.color(0xc4ccd4, 0.25), 0, 2.15, trailerMid + (sgn * len) / 2).scale.set(1, 1, 0.35);
    add(shared(`tband${len}`, () => new THREE.CylinderGeometry(R + 0.02, R + 0.02, len * 0.18, 22).rotateX(Math.PI / 2)), paint, 0, 2.15, trailerMid);
    add(box(0.5, 0.06, len * 0.8), trim, 0, 2.15 + R + 0.04, trailerMid);
    for (const dz of [-0.35, 0, 0.35]) add(shared('manhole', () => new THREE.CylinderGeometry(0.28, 0.28, 0.12, 12)), chrome, 0, 2.15 + R + 0.1, trailerMid + dz * len * 0.6);
    add(box(0.05, 1.3, 0.5), trim, 1.1, 1.6, -L + 1.0);
    add(box(2.0, 0.18, 0.3), trim, 0, 0.95, -L - 0.05);
  }
  // Roues : directeur, tandem moteur, trois essieux de remorque
  const tyreMat = mats.color(0x161616, 0.85);
  const rimMat = mats.color(0xc4ccd4, 0.3);
  const brakeMat = mats.color(0x2a2d31, 0.5);
  const axles = [cabZ + 0.6, L - 5.6, L - 6.9, -L + 1.3, -L + 2.6, -L + 3.9];
  for (const z of axles) {
    for (const x of [-1, 1]) {
      const w = wheel(s.wheel);
      const p = w.userData.parts as { tyre: THREE.Mesh; rim: THREE.Mesh; cap: THREE.Mesh; brake: THREE.Mesh };
      for (const c of w.children) if (c instanceof THREE.Mesh) c.material = c === p.tyre ? tyreMat : c === p.cap ? chrome : c === p.brake ? brakeMat : rimMat;
      w.position.set(x * (s.w / 2 - 0.2), s.wheel, z);
      g.add(w);
    }
  }
  return g;
}

/** Rectangle aux coins arrondis dans le plan du profil (u avant, v haut). */
function roundRect(u0: number, v0: number, u1: number, v1: number, r: number): THREE.Shape {
  const sh = new THREE.Shape();
  sh.moveTo(u0 + r, v0);
  sh.lineTo(u1 - r, v0);
  sh.quadraticCurveTo(u1, v0, u1, v0 + r);
  sh.lineTo(u1, v1 - r);
  sh.quadraticCurveTo(u1, v1, u1 - r, v1);
  sh.lineTo(u0 + r, v1);
  sh.quadraticCurveTo(u0, v1, u0, v1 - r);
  sh.lineTo(u0, v0 + r);
  sh.quadraticCurveTo(u0, v0, u0 + r, v0);
  return sh;
}

/** Ancien appel (couleur, longueur) : choisit le modèle le plus proche. */
export function carKindFor(len: number): CarKind {
  return len >= 8 ? 'bus' : len >= 5.5 ? 'truck' : len >= 4.4 ? 'sedan' : 'hatch';
}

/**
 * Moto utilitaire courante à Lomé (type 125 cm³) : roues à jantes à branches, garde-boue, fourche, réservoir galbé,
 * caches latéraux, moteur et pot chromé, longue selle, porte-bagages, phare rond, guidon et rétroviseurs. Avant vers +z.
 */
export function buildMoto(mats: Materials, color: number): THREE.Group {
  const g = new THREE.Group();
  const add = (key: string, make: () => THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(shared(key, make), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  const paint = mats.color(color, 0.3);
  const chrome = mats.color(0xc9d1db, 0.25);
  const black = mats.color(0x161616, 0.85);
  const dark = mats.color(0x2b2f33, 0.6);
  for (const dz of [-0.66, 0.66]) {
    add('m.tyre', () => new THREE.TorusGeometry(0.3, 0.068, 10, 26).rotateY(Math.PI / 2), black, 0, 0.37, dz);
    add('m.rim', () => new THREE.TorusGeometry(0.225, 0.016, 6, 22).rotateY(Math.PI / 2), chrome, 0, 0.37, dz);
    add('m.hub', () => new THREE.CylinderGeometry(0.05, 0.05, 0.14, 10).rotateZ(Math.PI / 2), chrome, 0, 0.37, dz);
    for (let k = 0; k < 6; k++) add('m.spoke', () => new THREE.CylinderGeometry(0.006, 0.006, 0.44, 4), chrome, 0, 0.37, dz).rotation.x = (k * Math.PI) / 6;
    const fender = add('m.fender', () => new THREE.TorusGeometry(0.36, 0.05, 6, 16, Math.PI * 0.55), dz > 0 ? paint : dark, 0, 0.37, dz);
    fender.rotation.set(0, Math.PI / 2, dz > 0 ? 0.2 : 0.75);
    fender.scale.set(1, 1, 2);
  }
  add('m.frame', () => new THREE.CylinderGeometry(0.04, 0.04, 0.95, 8), dark, 0, 0.62, 0.02).rotation.x = Math.PI / 2 - 0.18;
  const engine = add('m.engine', () => new THREE.CapsuleGeometry(0.16, 0.16, 4, 10).rotateX(Math.PI / 2), mats.color(0x8a9096, 0.5), 0, 0.46, -0.02);
  engine.scale.set(0.8, 1, 1);
  add('m.pipe', () => new THREE.CapsuleGeometry(0.05, 0.62, 4, 8).rotateX(Math.PI / 2 - 0.12), chrome, 0.17, 0.42, -0.3);
  const tank = add('m.tank', () => new THREE.CapsuleGeometry(0.19, 0.3, 6, 14).rotateX(Math.PI / 2 + 0.12), paint, 0, 0.82, 0.2);
  tank.scale.set(0.95, 0.75, 1);
  for (const dx of [-0.13, 0.13]) add('m.cover', () => new THREE.BoxGeometry(0.04, 0.22, 0.32), paint, dx, 0.66, -0.12);
  const seat = add('m.seat', () => new THREE.CapsuleGeometry(0.15, 0.62, 6, 12).rotateX(Math.PI / 2), mats.color(0x1a1a1a, 0.7), 0, 0.9, -0.3);
  seat.scale.set(1.12, 0.42, 1);
  // Cale-pieds du conducteur (devant) et du passager (derrière)
  for (const dx of [-0.2, 0.2]) {
    add('m.peg', () => new THREE.BoxGeometry(0.1, 0.025, 0.06), black, dx, 0.295, -0.08);
    add('m.pegArm', () => new THREE.CylinderGeometry(0.014, 0.014, 0.18, 6).rotateZ(Math.PI / 2), dark, dx * 0.5, 0.31, -0.08);
    add('m.peg', () => new THREE.BoxGeometry(0.1, 0.025, 0.06), black, dx, 0.335, -0.46);
    add('m.pegArm', () => new THREE.CylinderGeometry(0.014, 0.014, 0.18, 6).rotateZ(Math.PI / 2), dark, dx * 0.5, 0.35, -0.46);
  }
  add('m.rack', () => new THREE.BoxGeometry(0.36, 0.035, 0.42), chrome, 0, 0.85, -0.82);
  add('m.tail', () => new THREE.BoxGeometry(0.16, 0.06, 0.04), mats.color(0xd21034, 0.3), 0, 0.84, -1.04);
  for (const dx of [-0.1, 0.1]) add('m.fork', () => new THREE.CylinderGeometry(0.028, 0.028, 0.72, 8), chrome, dx, 0.7, 0.55).rotation.x = -0.36;
  add('m.lamp', () => new THREE.CylinderGeometry(0.11, 0.12, 0.1, 18).rotateX(Math.PI / 2), paint, 0, 0.98, 0.72);
  add('m.lens', () => new THREE.CircleGeometry(0.095, 18), mats.color(0xfff4c2, 0.15), 0, 0.98, 0.776);
  // Équipement récent : phare et feux de jour à LED, tableau de bord numérique, disques de frein, bandeau de feu arrière
  add('m.led', () => new THREE.BoxGeometry(0.22, 0.05, 0.03), mats.color(0xffffff, 0.05), 0, 0.93, 0.775);
  add('m.drl', () => new THREE.BoxGeometry(0.2, 0.014, 0.03), mats.color(0x9fe8ff, 0.05), 0, 1.05, 0.775);
  add('m.dashBody', () => new THREE.BoxGeometry(0.18, 0.08, 0.1), black, 0, 1.15, 0.46);
  add('m.dashScreen', () => new THREE.BoxGeometry(0.15, 0.005, 0.07), mats.color(0x4cc9f0, 0.1), 0, 1.196, 0.46);
  for (const dz of [-0.66, 0.66]) add('m.disc', () => new THREE.CylinderGeometry(0.15, 0.15, 0.012, 16).rotateZ(Math.PI / 2), chrome, 0.045, 0.37, dz);
  add('m.ledTail', () => new THREE.BoxGeometry(0.26, 0.03, 0.03), mats.color(0xff2d3a, 0.1), 0, 0.8, -1.045);
  add('m.bar', () => new THREE.CylinderGeometry(0.022, 0.022, 0.7, 8).rotateZ(Math.PI / 2), dark, 0, 1.08, 0.5);
  for (const dx of [-0.31, 0.31]) {
    add('m.grip', () => new THREE.CylinderGeometry(0.032, 0.032, 0.11, 8).rotateZ(Math.PI / 2), black, dx, 1.08, 0.5);
    add('m.stem', () => new THREE.CylinderGeometry(0.01, 0.01, 0.3, 5), chrome, dx * 0.85, 1.22, 0.52).rotation.z = dx < 0 ? 0.35 : -0.35;
    add('m.mirror', () => new THREE.SphereGeometry(0.055, 10, 6), dark, dx * 1.05, 1.36, 0.53).scale.set(1, 0.7, 0.3);
  }
  return g;
}

/** Vélo : cadre en diamant, roues fines à rayons, selle, guidon relevé, porte-bagages. Avant vers +z. */
export function buildBike(mats: Materials, color: number): THREE.Group {
  const g = new THREE.Group();
  const add = (key: string, make: () => THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(shared(key, make), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  const frame = mats.color(color, 0.35);
  const chrome = mats.color(0xc9d1db, 0.25);
  const black = mats.color(0x161616, 0.85);
  for (const dz of [-0.52, 0.52]) {
    add('b.tyre', () => new THREE.TorusGeometry(0.33, 0.025, 6, 28).rotateY(Math.PI / 2), black, 0, 0.35, dz);
    add('b.rim', () => new THREE.TorusGeometry(0.31, 0.008, 4, 24).rotateY(Math.PI / 2), chrome, 0, 0.35, dz);
    for (let k = 0; k < 8; k++) add('b.spoke', () => new THREE.CylinderGeometry(0.003, 0.003, 0.62, 3), chrome, 0, 0.35, dz).rotation.x = (k * Math.PI) / 8;
  }
  const tube = (len: number) => () => new THREE.CylinderGeometry(0.02, 0.02, len, 6);
  add('b.down', tube(0.66), frame, 0, 0.55, 0.22).rotation.x = 0.9;
  add('b.top', tube(0.58), frame, 0, 0.82, 0.12).rotation.x = Math.PI / 2 - 0.05;
  add('b.seatTube', tube(0.56), frame, 0, 0.62, -0.12).rotation.x = -0.3;
  add('b.chain', tube(0.54), frame, 0, 0.36, -0.26).rotation.x = Math.PI / 2;
  add('b.stay', tube(0.6), frame, 0, 0.58, -0.36).rotation.x = -0.95;
  add('b.fork', tube(0.62), chrome, 0, 0.62, 0.48).rotation.x = -0.3;
  add('b.saddle', () => new THREE.CapsuleGeometry(0.06, 0.14, 4, 8).rotateX(Math.PI / 2), mats.color(0x1a1a1a, 0.7), 0, 0.92, -0.2).scale.set(1.2, 0.5, 1);
  add('b.bar', () => new THREE.CylinderGeometry(0.016, 0.016, 0.56, 6).rotateZ(Math.PI / 2), chrome, 0, 1.0, 0.42);
  add('b.rack', () => new THREE.BoxGeometry(0.24, 0.02, 0.36), chrome, 0, 0.72, -0.5);
  add('b.crank', () => new THREE.CylinderGeometry(0.09, 0.09, 0.03, 12).rotateZ(Math.PI / 2), chrome, 0.06, 0.36, 0);
  // Équipement récent : phare et feu arrière à LED, disques de frein, batterie compacte sur le tube diagonal
  add('b.led', () => new THREE.BoxGeometry(0.09, 0.05, 0.04), mats.color(0xffffff, 0.05), 0, 0.98, 0.5);
  add('b.tail', () => new THREE.BoxGeometry(0.06, 0.04, 0.03), mats.color(0xff2d3a, 0.1), 0, 0.72, -0.7);
  for (const dz of [-0.52, 0.52]) add('b.disc', () => new THREE.CylinderGeometry(0.07, 0.07, 0.006, 12).rotateZ(Math.PI / 2), chrome, 0.03, 0.35, dz);
  add('b.battery', () => new THREE.BoxGeometry(0.06, 0.09, 0.3), mats.color(0x23272d, 0.5), 0, 0.58, 0.2).rotation.x = 0.9;
  return g;
}

/** Points d'appui du conducteur d'une moto (repère de la moto) : hanche sur la selle, pieds sur les cale-pieds, mains aux poignées. */
export function motoRideSpec(seat: { seatY: number; seatZ: number; lean: number }): RideSpec {
  return {
    hip: { y: seat.seatY + 0.1, z: seat.seatZ },
    lean: seat.lean,
    feet: [new THREE.Vector3(-0.2, 0.31, -0.08), new THREE.Vector3(0.2, 0.31, -0.08)],
    hands: [new THREE.Vector3(-0.31, 1.08, 0.5), new THREE.Vector3(0.31, 1.08, 0.5)],
  };
}

/** Passager assis derrière le conducteur : pieds sur les repose-pieds arrière, mains posées sur les côtés du conducteur. */
export function motoPillionSpec(): RideSpec {
  return {
    hip: { y: 1.02, z: -0.58 },
    lean: 0.1,
    feet: [new THREE.Vector3(-0.2, 0.35, -0.46), new THREE.Vector3(0.2, 0.35, -0.46)],
    hands: [new THREE.Vector3(-0.2, 1.12, -0.3), new THREE.Vector3(0.2, 1.12, -0.3)],
  };
}

/** Cycliste : pieds sur les pédales (un pied en bas, l'autre en haut), mains sur le guidon. */
export function bikeRideSpec(seat: { seatY: number; seatZ: number; lean: number }): RideSpec {
  return {
    hip: { y: seat.seatY + 0.1, z: seat.seatZ },
    lean: seat.lean,
    feet: [new THREE.Vector3(-0.12, 0.27, 0.02), new THREE.Vector3(0.12, 0.45, -0.04)],
    hands: [new THREE.Vector3(-0.27, 1.0, 0.42), new THREE.Vector3(0.27, 1.0, 0.42)],
  };
}

/** Conducteur assis sur un deux-roues : vrai personnage en pose de conduite, casque facultatif. */
export function buildRider(mats: Materials, look: PersonLook, o: { helmet?: number; seatY: number; seatZ: number; lean: number; bike?: boolean }): THREE.Group {
  const holder = new THREE.Group();
  const p = buildPerson(mats, o.helmet !== undefined && (look.hairStyle === 'cap' || look.hairStyle === 'gele' || look.hairStyle === 'afro') ? { ...look, hairStyle: 'lowcut' } : look);
  // L'ombre de contact au sol n'a pas de sens sur une selle
  p.children.filter((c) => c instanceof THREE.Mesh && (c.material as THREE.Material).transparent).forEach((c) => p.remove(c));
  if (o.helmet !== undefined) {
    const helmet = new THREE.Mesh(shared('helmet', () => new THREE.SphereGeometry(0.175, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)), mats.color(o.helmet, 0.25));
    helmet.position.set(0, 1.8, -0.02);
    helmet.rotation.x = -0.25;
    p.add(helmet);
  }
  holder.add(p);
  ridePose(p, o.bike ? bikeRideSpec(o) : motoRideSpec(o));
  return holder;
}

/**
 * Véhicule dessiné en code converti en modèle instanciable (même format que les modèles chargés) : une partie
 * « peinture » teintée par instance, une partie fixe (vitres, pneus, chromes, feux). `scale` compense l'échelle
 * appliquée par la circulation.
 */
export function vehicleModel(g: THREE.Group, scale = 1): Model {
  const paint = g.userData.paint as THREE.Material | undefined;
  const baked = bakeGroup(g, (m) => m === paint);
  const fix = new THREE.Matrix4().makeScale(scale, scale, scale);
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3()).multiplyScalar(scale);
  return {
    parts: baked.map((b) => ({ geometry: b.geometry, material: b.materials, matrix: fix.clone(), tint: b.materials.includes(paint!) })),
    size,
    offset: new THREE.Vector3(0, 0, 0),
  };
}
