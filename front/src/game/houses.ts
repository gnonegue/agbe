// Modèles de maison construits sur un terrain (réglage « land.uses », champ `style`), dessinés en code.
// Repère local en mètres : sol à y = 0, façade (porte) vers +z, centre de l'emprise à l'origine.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Materials } from './kit';
import type { Model, ModelPart } from './assets';

export const HOUSE_STYLES = ['hut', 'block', 'studio', 'veranda', 'twobed', 'bungalow', 'villa_low', 'duplex', 'villa', 'villa_pool', 'immeuble'] as const;
export type HouseStyle = (typeof HOUSE_STYLES)[number];

/** Style d'une maison d'après son identifiant de construction (repli pour les anciens modèles sans style). */
export function styleOfUse(useId: string, style?: string): HouseStyle {
  if (style && (HOUSE_STYLES as readonly string[]).includes(style)) return style as HouseStyle;
  return useId === 'house_villa' ? 'villa' : useId === 'house_medium' ? 'veranda' : 'block';
}

const geos = new Map<string, THREE.BufferGeometry>();
const shared = (key: string, make: () => THREE.BufferGeometry) => {
  let g = geos.get(key);
  if (!g) geos.set(key, (g = make()));
  return g;
};
const BOX = () => shared('box', () => new THREE.BoxGeometry(1, 1, 1));

/** Toit à deux pans (prisme) de largeur w (x), profondeur d (z) et hauteur h, faîtage le long de x. */
const gable = () =>
  shared('gable', () => {
    const sh = new THREE.Shape();
    sh.moveTo(-0.5, 0);
    sh.lineTo(0.5, 0);
    sh.lineTo(0, 1);
    sh.lineTo(-0.5, 0);
    return new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5).rotateY(Math.PI / 2);
  });

/**
 * Maison du style demandé, avec son emprise (largeur x, profondeur z). Couleurs et volumes typiques de Lomé :
 * case en terre, maisons en parpaings et tôle, villas enduites en blanc ou ocre, tuiles rouges, toits-terrasses.
 */
export function buildHouse(mats: Materials, style: HouseStyle): { group: THREE.Group; w: number; d: number } {
  const g = new THREE.Group();
  const box = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, rough = 0.9) => {
    const m = new THREE.Mesh(BOX(), mats.color(color, rough));
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const cyl = (rt: number, rb: number, h: number, color: number, x: number, y: number, z: number, seg = 12) => {
    const m = new THREE.Mesh(shared(`cyl${rt}_${rb}_${seg}`, () => new THREE.CylinderGeometry(rt, rb, 1, seg)), mats.color(color));
    m.scale.y = h;
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const roof2 = (w: number, h: number, d: number, color: number, y: number, z = 0) => {
    const m = new THREE.Mesh(gable(), mats.color(color, 0.7));
    m.scale.set(w, h, d);
    m.position.set(0, y, z);
    g.add(m);
    return m;
  };
  const hip = (w: number, h: number, d: number, color: number, y: number, z = 0) => {
    const m = new THREE.Mesh(shared('hip', () => new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4)), mats.color(color, 0.7));
    m.scale.set(w, h, d);
    m.position.set(0, y + h / 2, z);
    g.add(m);
    return m;
  };
  const win = (w: number, h: number, x: number, y: number, z: number, frame = 0xffffff, side = false) => {
    box(side ? 0.06 : w + 0.12, h + 0.12, side ? w + 0.12 : 0.06, frame, x, y, z);
    // Vitre éclairée la nuit (matériau partagé, intensité réglée par le monde)
    const pane = new THREE.Mesh(BOX(), mats.windowLit());
    pane.scale.set(side ? 0.08 : w, h, side ? w : 0.08);
    pane.position.set(x, y, z);
    g.add(pane);
  };
  const door = (x: number, z: number, color = 0x6b3e1f, w = 0.95, h = 2.1) => box(w, h, 0.08, color, x, h / 2, z);
  const columns = (xs: number[], z: number, h: number, color = 0xffffff, y0 = 0) => xs.forEach((x) => cyl(0.13, 0.15, h, color, x, y0 + h / 2, z));
  const palm = (x: number, z: number) => {
    cyl(0.12, 0.18, 4.2, 0x8a6a45, x, 2.1, z, 7);
    for (let i = 0; i < 6; i++) {
      const leaf = box(0.35, 0.06, 1.9, 0x3f8f3a, x + Math.sin((i * Math.PI) / 3) * 0.8, 4.15, z + Math.cos((i * Math.PI) / 3) * 0.8);
      leaf.rotation.set(0.35, (i * Math.PI) / 3, 0);
    }
  };
  // Détails modernes communs : panneaux solaires, jardinières, haies, luminaires extérieurs (allumés la nuit), bardage bois
  const solar = (x: number, y: number, z: number, pw = 1.7, pd = 1) => {
    box(pw, 0.05, pd, 0x1b2a4a, x, y, z, 0.35).rotation.x = -0.25;
    box(pw + 0.1, 0.04, 0.05, 0xc9ced6, x, y - 0.12, z + pd / 2 + 0.02);
  };
  const planter = (x: number, z: number, pw = 0.8) => {
    box(pw, 0.5, 0.5, 0x3a3d44, x, 0.25, z);
    box(pw - 0.15, 0.4, 0.38, 0x2e8b57, x, 0.68, z);
    box(pw - 0.35, 0.3, 0.3, 0x3fb26b, x, 1.0, z);
  };
  const hedge = (hw: number, x: number, z: number) => box(hw, 0.5, 0.45, 0x2e8b57, x, 0.25, z);
  const sconce = (x: number, y: number, z: number) => {
    box(0.16, 0.34, 0.1, 0x2b2f36, x, y, z);
    const glow = new THREE.Mesh(BOX(), mats.windowLit());
    glow.scale.set(0.1, 0.2, 0.06);
    glow.position.set(x, y, z + 0.06);
    g.add(glow);
  };
  const bollard = (x: number, z: number) => {
    cyl(0.06, 0.07, 0.5, 0x2b2f36, x, 0.25, z, 8);
    const glow = new THREE.Mesh(BOX(), mats.windowLit());
    glow.scale.set(0.12, 0.1, 0.12);
    glow.position.set(x, 0.55, z);
    g.add(glow);
  };
  const cladding = (cw: number, ch: number, x: number, y: number, z: number) => {
    box(cw, ch, 0.06, 0x8a5a33, x, y, z);
    for (let i = 0; i < 4; i++) box(cw * 0.18, ch, 0.02, 0x6f4526, x - cw * 0.36 + i * cw * 0.24, y, z + 0.035);
  };
  let w = 6;
  let d = 5;
  switch (style) {
    case 'hut': {
      // Case ronde en terre, soubassement sombre, grand toit conique de paille, porte basse
      cyl(2.2, 2.3, 2.3, 0xb5733f, 0, 1.15, 0, 18);
      cyl(2.32, 2.34, 0.35, 0x7a4a26, 0, 0.17, 0, 18);
      const straw = new THREE.Mesh(shared('straw', () => new THREE.ConeGeometry(3.1, 2.6, 18)), mats.color(0xc9a35a));
      straw.position.set(0, 3.55, 0);
      g.add(straw);
      box(0.9, 1.7, 0.1, 0x3b2414, 0, 0.85, 2.22);
      w = 6;
      d = 6;
      break;
    }
    case 'block': {
      // Entrer-coucher : pièce en parpaings enduits, toit de tôle à une pente, porte bleue, fenêtre grillagée
      box(5.6, 2.7, 4, 0xd8cfbe, 0, 1.35, 0);
      box(5.8, 0.3, 4.2, 0x9b8f7e, 0, 0.15, 0);
      box(6.2, 0.1, 4.8, 0x9aa3ad, 0, 2.95, 0.2, 0.5).rotation.x = 0.1;
      door(-1.2, 2.02, 0x1f6feb);
      win(1.1, 0.9, 1.3, 1.6, 2.02, 0x5b6b7f);
      w = 6.4;
      d = 5;
      break;
    }
    case 'studio': {
      // Studio moderne : cube blanc, bandeau couleur, toit-terrasse à acrotère, grande baie et auvent
      box(5, 3.2, 5, 0xf7f5f0, 0, 1.6, 0);
      box(5.1, 0.35, 5.1, 0x2a9d8f, 0, 3.05, 0);
      box(5.2, 0.12, 5.2, 0xdedad0, 0, 3.3, 0);
      win(2.4, 1.6, 0.8, 1.6, 2.52, 0x2b2f36);
      door(-1.6, 2.52, 0x2b2f36);
      cladding(0.5, 2.8, -0.75, 1.5, 2.53);
      solar(-0.9, 3.5, -0.8);
      solar(0.9, 3.5, -0.8);
      planter(2.1, 2.9);
      sconce(-2.3, 2.2, 2.55);
      box(2.2, 0.1, 1.1, 0x2b2f36, -1.2, 2.5, 3);
      w = 5.6;
      d = 6;
      break;
    }
    case 'veranda': {
      // Chambre-salon : maison de cour sable, véranda à poteaux, tôle à deux pans
      box(7.5, 2.9, 5, 0xf3d9a4, 0, 1.45, -0.5);
      box(7.7, 0.3, 5.2, 0xb08a5a, 0, 0.15, -0.5);
      box(7.5, 0.15, 2, 0xcbb592, 0, 0.08, 2.9);
      columns([-3.5, -1.2, 1.2, 3.5], 3.7, 2.6, 0x7f8790);
      roof2(8.4, 1.5, 7.6, 0x9aa3ad, 2.85, 0.4);
      door(0, 2.02, 0x2a9d8f);
      win(1, 0.9, -2.3, 1.6, 2.02, 0x2a9d8f);
      win(1, 0.9, 2.3, 1.6, 2.02, 0x2a9d8f);
      planter(-2.35, 3.7);
      planter(2.35, 3.7);
      sconce(-0.9, 2.1, 2.05);
      sconce(0.9, 2.1, 2.05);
      w = 8.4;
      d = 7.6;
      break;
    }
    case 'twobed': {
      // Deux chambres-salon : enduit pêche, toit de tuiles à quatre pans, perron, deux fenêtres par côté
      box(8.5, 3, 6.5, 0xf2c6a0, 0, 1.5, 0);
      box(8.7, 0.35, 6.7, 0xa0522d, 0, 0.17, 0);
      hip(10.2, 2, 8.2, 0xb5452b, 3);
      box(2.6, 0.3, 1.2, 0xd0d4da, 0, 0.15, 3.85);
      door(0, 3.27, 0x6b3e1f);
      for (const x of [-2.8, 2.8]) win(1.2, 1, x, 1.7, 3.27);
      for (const z of [-1.5, 1.5]) win(1, 1, 4.27, 1.7, z, 0xffffff, true);
      planter(-1.8, 4.2);
      planter(1.8, 4.2);
      sconce(-0.9, 2.1, 3.3);
      sconce(0.9, 2.1, 3.3);
      w = 10.2;
      d = 8.6;
      break;
    }
    case 'bungalow': {
      // Bungalow : plain-pied blanc, véranda tout autour, large toit vert débordant
      box(8, 2.8, 6, 0xffffff, 0, 1.4, 0);
      box(11, 0.2, 9, 0xcfc6b4, 0, 0.1, 0);
      for (const x of [-5.2, -1.7, 1.7, 5.2]) for (const z of [-4.2, 4.2]) cyl(0.12, 0.14, 2.7, 0x8b5a2b, x, 1.45, z, 8);
      hip(12, 1.8, 10, 0x2f6b4f, 2.8);
      door(0, 3.02, 0x8b5a2b);
      for (const x of [-2.6, 2.6]) win(1.3, 1, x, 1.6, 3.02, 0x8b5a2b);
      sconce(-0.8, 2.0, 3.06);
      sconce(0.8, 2.0, 3.06);
      hedge(8, 0, 4.9);
      w = 12;
      d = 10;
      break;
    }
    case 'villa_low':
    case 'villa_pool': {
      // Villa basse : plain-pied blanc et pierre, toit-terrasse à acrotère, grandes baies, abri de voiture
      box(11, 3.3, 7, 0xf6f3ee, -0.5, 1.65, -1.5);
      box(3.5, 3.3, 0.3, 0xa58c6f, -4, 1.65, 2.05); // parement pierre
      box(11.4, 0.35, 7.4, 0xdedad0, -0.5, 3.45, -1.5);
      win(3.6, 2, 1, 1.4, 2.03, 0x2b2f36);
      door(-1.8, 2.03, 0x5a3a22, 1.2, 2.3);
      // Abri de voiture : dalle sur deux poteaux
      box(3.6, 0.15, 4.2, 0xdedad0, 6.6, 2.7, -1);
      columns([8.2], 1, 2.6, 0x2b2f36);
      columns([8.2], -3, 2.6, 0x2b2f36);
      // Allée du garage, panneaux solaires sur le toit-terrasse, haie et bornes lumineuses
      box(3.8, 0.04, 5.6, 0x4a4d55, 6.6, 0.02, 0.2);
      solar(-3.2, 3.7, -1.5, 1.8, 1.1);
      solar(-0.9, 3.7, -1.5, 1.8, 1.1);
      solar(1.4, 3.7, -1.5, 1.8, 1.1);
      hedge(5, -1.5, 3.6);
      for (const bx of [-5, -3, -1, 1, 3]) bollard(bx, 3.0);
      w = 17;
      d = 9;
      if (style === 'villa_pool') {
        // Terrasse, piscine bleue à margelle claire, deux palmiers
        box(9, 0.2, 5, 0xe9e2d4, 0, 0.1, 5.2);
        box(7, 0.22, 3.2, 0x1fa3d6, 0.5, 0.13, 5.4, 0.1);
        palm(-5.6, 5.8);
        palm(6.2, 5.8);
        d = 14;
      }
      break;
    }
    case 'duplex': {
      // Duplex R+1 : deux niveaux, balcon filant à garde-corps vitré, toit-terrasse, baies vitrées
      box(9, 6.2, 7, 0xf1ece2, 0, 3.1, -0.5);
      box(9.4, 0.25, 8.4, 0xd0d4da, 0, 3.15, 0.2); // dalle du balcon
      box(9.2, 0.9, 0.06, 0x8fc1e3, 0, 3.7, 4.35, 0.15); // garde-corps vitré
      box(9.4, 0.3, 7.4, 0x2b2f36, 0, 6.35, -0.5);
      for (const x of [-2.6, 2.6]) win(2.4, 2.1, x, 4.6, 3.03, 0x2b2f36);
      win(2.6, 1.8, 2.2, 1.4, 3.03, 0x2b2f36);
      door(-2, 3.03, 0x2b2f36, 1.2, 2.3);
      cladding(0.6, 6, 4.15, 3, 3.05);
      for (const x of [-3, 0, 3]) solar(x, 6.6, -0.5, 1.9, 1.1);
      for (const x of [-3, 0, 3]) {
        box(1, 0.4, 0.35, 0x3a3d44, x, 3.5, 4.3);
        box(0.85, 0.3, 0.28, 0x2e8b57, x, 3.85, 4.3);
      }
      sconce(-0.6, 2.2, 3.08);
      w = 9.4;
      d = 9;
      break;
    }
    case 'villa': {
      // Villa à étage : colonnes du porche, balcon, étage, toit de tuiles à quatre pans
      box(9, 6.4, 6.5, 0xfaf6ee, 0, 3.2, -0.5);
      box(9.2, 0.35, 6.7, 0xc0522d, 0, 0.17, -0.5);
      box(9.4, 0.25, 8, 0xd0d4da, 0, 3.25, 0.3);
      for (let i = 0; i < 9; i++) box(0.06, 0.8, 0.06, 0xffffff, -4.4 + i * 1.1, 3.8, 4.25);
      box(9.4, 0.08, 0.08, 0xffffff, 0, 4.2, 4.25);
      columns([-1.4, 1.4], 3.9, 3.1);
      hip(11, 2.4, 8.5, 0xc0522d, 6.4, -0.5);
      for (const x of [-3, 3]) {
        win(1.2, 1.3, x, 1.7, 2.78, 0xffffff);
        win(1.2, 1.3, x, 4.9, 2.78, 0xffffff);
      }
      door(0, 2.78, 0x6b3e1f, 1.3, 2.4);
      planter(-2.6, 4.1);
      planter(2.6, 4.1);
      sconce(-0.9, 2.2, 2.82);
      sconce(0.9, 2.2, 2.82);
      w = 11;
      d = 9;
      break;
    }
    case 'immeuble': {
      // Petit immeuble R+2 : trois niveaux, balcons en saillie, cage d'escalier, château d'eau sur le toit
      box(10, 9, 8, 0xe9d8b4, 0, 4.5, -0.5);
      box(10.2, 0.3, 8.2, 0x9b8f7e, 0, 0.15, -0.5);
      for (const y of [3, 6]) {
        box(10.4, 0.2, 1.2, 0xd0d4da, 0, y, 4);
        box(10.4, 0.8, 0.06, 0xffffff, 0, y + 0.5, 4.57);
      }
      for (const y of [1.6, 4.6, 7.6]) for (const x of [-3.2, 0, 3.2]) win(1.6, 1.4, x, y, 3.53, 0x5b6b7f);
      box(10.4, 0.4, 8.4, 0xcfc3a5, 0, 9.2, -0.5);
      box(2.4, 2, 2.4, 0xe9d8b4, -3.2, 10.2, -2); // cage d'escalier sur le toit
      for (const [lx, lz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] as const) box(0.1, 1.4, 0.1, 0x5b6b7f, 3 + lx, 10.1, -2 + lz);
      cyl(0.9, 0.9, 1.2, 0x1f6feb, 3, 11.4, -2, 14);
      door(0, 3.53, 0x2b2f36, 1.4, 2.3);
      for (const x of [-1.2, 1.2]) solar(x, 9.6, 1.2, 1.6, 1);
      planter(-4, 4.1);
      planter(4, 4.1);
      sconce(-1.1, 2.3, 3.57);
      sconce(1.1, 2.3, 3.57);
      w = 10.4;
      d = 9.5;
      break;
    }
  }
  return { group: g, w, d };
}

/** Maisons modernes posées dans les quartiers de la ville : plain-pied pour les petites parcelles, à étage sinon. */
export const CITY_LOW: HouseStyle[] = ['villa_low', 'villa_pool'];
export const CITY_TALL: HouseStyle[] = ['duplex', 'villa'];
/** Teintes d'enduit des façades (blanc pur de la maquette) : chaque maison de quartier reçoit la sienne. */
const FACADE = new Set([0xffffff, 0xf6f3ee, 0xf1ece2, 0xfaf6ee]);

/**
 * Maison dessinée en code, cuite pour être répétée par instances dans toute la ville : trois parties seulement
 * (façades teintées par maison, reste du décor en couleurs par sommet, vitres qui s'allument la nuit).
 */
export function houseModel(mats: Materials, style: HouseStyle): Model {
  const { group } = buildHouse(mats, style);
  group.updateMatrixWorld(true);
  const facade: THREE.BufferGeometry[] = [];
  const paint: THREE.BufferGeometry[] = [];
  const other = new Map<THREE.Material, THREE.BufferGeometry[]>();
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return;
    const m = o.material as THREE.MeshLambertMaterial;
    if (m.transparent) return;
    const src = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(src.attributes)) if (!['position', 'normal', 'uv'].includes(k)) src.deleteAttribute(k);
    const n = src.getAttribute('position').count;
    if (!src.getAttribute('uv')) src.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    const plain = !m.map && !(m.emissive && m.emissive.getHex() !== 0);
    if (!plain) {
      const l = other.get(m) ?? [];
      l.push(src);
      other.set(m, l);
      return;
    }
    const c = m.color;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    src.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (FACADE.has(c.getHex()) ? facade : paint).push(src);
  });
  const parts: ModelPart[] = [];
  const add = (list: THREE.BufferGeometry[], material: THREE.Material, tint: boolean) => {
    if (list.length === 0) return;
    const geometry = mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    if (geometry) parts.push({ geometry, material, matrix: new THREE.Matrix4(), tint });
  };
  add(facade, mats.vertexPaint(), true);
  add(paint, mats.vertexPaint(), false);
  for (const [m, list] of other) add(list, m, false);
  const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  return { parts, size, offset: new THREE.Vector3() };
}
