import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Materials } from './kit';

/**
 * Décor du secteur marin (parcelles en mer, à l'ouest de la grille de publicité) : digue de pierres autour des parcelles,
 * route sur l'eau (chaussée surélevée avec bretelles vers chaque zone), île de prestige avec tours et hôtel en voile,
 * yachts et voiliers à quai ou qui croisent au large. Tout est regroupé en peu d'objets.
 * Les positions suivent les zones par défaut (`mer_*` du réglage `land`) : x −294…−206, z 46…244.
 */
export interface SeaDistrict {
  group: THREE.Group;
  geos: THREE.BufferGeometry[];
  own: (THREE.Material | THREE.Texture)[];
  /** Bercement des bateaux et croisières ; `t` en secondes, `dt` le pas réel. */
  update: (t: number, dt: number) => void;
}

const ROAD_X = -312; // axe de la route sur l'eau
const ROAD_W = 8;
const SPURS = [70, 120, 170, 222]; // bretelles vers les zones de l'est (z)
const WEST_SPURS = [130, 210]; // bretelles vers la rive ouest (z) // bretelles vers la rive ouest (z)

function rngOf(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildSeaDistrict(mats: Materials, shadows: boolean, low: boolean): SeaDistrict {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const own: (THREE.Material | THREE.Texture)[] = [];
  const reg = <T extends THREE.BufferGeometry>(g: T): T => (geos.push(g), g);
  const r = rngOf(20261111);
  const tmp = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();

  /**
   * Fusionne les pièces fixes (maillages simples, enfants directs de `root`) en un maillage par matériau : quelques appels de
   * dessin au lieu d'une centaine. Les maillages instanciés et les sous-groupes (bateaux) ne sont pas touchés.
   */
  const mergeByMaterial = (root: THREE.Object3D) => {
    const byMat = new Map<THREE.Material, THREE.Mesh[]>();
    for (const c of root.children) {
      if (!(c instanceof THREE.Mesh) || c instanceof THREE.InstancedMesh || Array.isArray(c.material)) continue;
      const list = byMat.get(c.material);
      if (list) list.push(c);
      else byMat.set(c.material, [c]);
    }
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const parts = list.map((m) => {
        m.updateMatrix();
        const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
        return g;
      });
      const merged = mergeGeometries(parts, false);
      parts.forEach((g) => g.dispose());
      if (!merged) continue;
      for (const m of list) {
        root.remove(m);
        const i = geos.indexOf(m.geometry);
        if (i >= 0) geos.splice(i, 1);
        m.geometry.dispose();
      }
      const one = new THREE.Mesh(reg(merged), mat);
      one.castShadow = shadows;
      one.receiveShadow = shadows;
      root.add(one);
    }
  };

  const box = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, parent: THREE.Object3D = group): THREE.Mesh => {
    const m = new THREE.Mesh(reg(new THREE.BoxGeometry(w, h, d)), mats.color(color));
    m.position.set(x, y, z);
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    parent.add(m);
    return m;
  };

  // --- Digue de pierres : deux rangs de blocs autour des parcelles (rien sur le côté de la route, où passent les bretelles)
  const x0 = -300;
  const x1 = -203;
  const z0 = 42;
  const z1 = 252;
  const spots: [number, number][] = [];
  const step = low ? 3.6 : 2.4;
  const ring = (x: number, z: number, side: 'n' | 's' | 'e' | 'w') => {
    if (side === 'w' && SPURS.some((s) => Math.abs(z - s) < 5)) return;
    spots.push([x, z]);
  };
  for (let x = x0; x <= x1; x += step) {
    ring(x + (r() - 0.5), z0 - 1 + (r() - 0.5) * 1.5, 'n');
    ring(x + (r() - 0.5), z1 + (r() - 0.5) * 1.5, 's');
  }
  for (let z = z0; z <= z1; z += step) {
    ring(x0 - 1 + (r() - 0.5) * 1.5, z + (r() - 0.5), 'w');
    ring(x1 + 1 + (r() - 0.5) * 1.5, z + (r() - 0.5), 'e');
  }
  // Rive ouest (de l'autre côté de la route) : mêmes pierres autour, sauf côté route
  const wx0 = -358;
  const wz1 = 246;
  for (let x = wx0; x <= -317; x += step) {
    spots.push([x + (r() - 0.5), 93 + (r() - 0.5) * 1.5], [x + (r() - 0.5), wz1 + (r() - 0.5) * 1.5]);
  }
  for (let z = 94; z <= wz1; z += step) if (!WEST_SPURS.some((s) => Math.abs(z - s) < 5)) spots.push([wx0 - 1 + (r() - 0.5) * 1.5, z + (r() - 0.5)]);
  for (let x = -392; x <= -317; x += step) spots.push([x + (r() - 0.5), 40 + (r() - 0.5) * 1.5], [x + (r() - 0.5), 83 + (r() - 0.5) * 1.5]);
  for (let z = 41; z <= 83; z += step) spots.push([-392 + (r() - 0.5) * 1.5, z + (r() - 0.5)]);
  const rockMat = mats.color(0x7d8186, 0.95);
  const rocks = new THREE.InstancedMesh(reg(new THREE.DodecahedronGeometry(1, 0)), rockMat, spots.length * 2);
  const rcol = new THREE.Color();
  let ri = 0;
  for (const [x, z] of spots) {
    for (let k = 0; k < 2; k++) {
      const s = 0.9 + r() * 0.9;
      v.set(x + (k ? (r() - 0.5) * 1.6 : 0), 0.15 + (k ? 0.5 : 0.1), z + (k ? (r() - 0.5) * 1.6 : 0));
      q.setFromEuler(e.set(r() * 3, r() * 3, r() * 3));
      sc.set(s * 1.1, s * 0.75, s);
      rocks.setMatrixAt(ri, tmp.compose(v, q, sc));
      rocks.setColorAt(ri, rcol.setHex([0x7d8186, 0x6b6f74, 0x8b8f94, 0x5f6368][Math.floor(r() * 4)]!));
      ri++;
    }
  }
  rocks.castShadow = shadows;
  group.add(rocks);

  // --- Route sur l'eau : chaussée, bordures, ligne centrale, lampadaires, bretelles vers les zones
  const roadLen = 252 - 36;
  const roadZ = (36 + 252) / 2;
  box(ROAD_W, 0.6, roadLen, 0x3a3d42, ROAD_X, -0.1, roadZ);
  for (const sgn of [-1, 1]) box(0.5, 0.75, roadLen, 0xe9e6dc, ROAD_X + (sgn * (ROAD_W + 0.5)) / 2, -0.05, roadZ);
  const dashes: number[] = [];
  for (let z = 40; z < 250; z += 6) dashes.push(z);
  const dashMesh = new THREE.InstancedMesh(reg(new THREE.BoxGeometry(0.25, 0.03, 2.6)), mats.color(0xf4f1e6), dashes.length);
  dashes.forEach((z, i) => dashMesh.setMatrixAt(i, tmp.makeTranslation(ROAD_X, 0.22, z)));
  group.add(dashMesh);
  for (const z of SPURS) {
    box(14, 0.6, 5, 0x3a3d42, (ROAD_X + x0) / 2 + 2, -0.1, z);
    box(2.2, 0.03, 5.2, 0xf4f1e6, x0 + 1, 0.22, z);
  }
  for (const z of WEST_SPURS) {
    box(5, 0.6, 5, 0x3a3d42, ROAD_X - 5.5, -0.1, z);
    box(2, 0.03, 5.2, 0xf4f1e6, ROAD_X - 8, 0.22, z);
  }
  const lampZ: number[] = [];
  for (let z = 48; z < 250; z += 26) lampZ.push(z);
  const poles = new THREE.InstancedMesh(reg(new THREE.CylinderGeometry(0.1, 0.12, 5.5, 6)), mats.color(0x2b2f34), lampZ.length * 2);
  const heads = new THREE.InstancedMesh(reg(new THREE.BoxGeometry(0.9, 0.18, 0.5)), new THREE.MeshBasicMaterial({ color: 0xfff1c4 }), lampZ.length * 2);
  own.push(heads.material as THREE.Material);
  let li = 0;
  for (const z of lampZ) {
    for (const sgn of [-1, 1]) {
      const x = ROAD_X + sgn * (ROAD_W / 2 + 0.2);
      poles.setMatrixAt(li, tmp.makeTranslation(x, 3, z));
      heads.setMatrixAt(li, tmp.makeTranslation(x - sgn * 0.4, 5.7, z));
      li++;
    }
  }
  group.add(poles, heads);

  // Terrain de front de mer (zone `mer_corniche`, x −388…−320, z 42…80) : un ponton, une bretelle et un rang de pierres autour
  box(9, 0.6, 6, 0x3a3d42, ROAD_X - 6, -0.1, 58); // raccord route / terrain
  box(2, 0.03, 6.2, 0xf4f1e6, ROAD_X - 6, 0.22, 58);

  // --- Bateaux : yachts et voiliers
  const boats: { g: THREE.Group; baseY: number; phase: number; cruise?: { x0: number; x1: number; v: number; dir: 1 | -1; yaw: number } }[] = [];
  const hullShape = (len: number, h: number): THREE.Shape => {
    const s = new THREE.Shape();
    s.moveTo(-len / 2, 0);
    s.lineTo(len / 2 - 1.2, 0);
    s.quadraticCurveTo(len / 2 + 0.6, h * 0.35, len / 2 + 1.1, h);
    s.lineTo(-len / 2, h);
    s.lineTo(-len / 2, 0);
    return s;
  };
  const makeBoat = (kind: 'yacht' | 'sail', color: number): THREE.Group => {
    const g = new THREE.Group();
    const len = kind === 'yacht' ? 11 : 7.5;
    const w = kind === 'yacht' ? 3 : 2.2;
    const hull = new THREE.Mesh(reg(new THREE.ExtrudeGeometry(hullShape(len, 1.4), { depth: w, bevelEnabled: false })), mats.color(color, 0.35));
    hull.rotation.y = -Math.PI / 2; // proue vers +z
    hull.position.set(w / 2, 0.1, 0);
    g.add(hull);
    box(w + 0.05, 0.2, len + 1, 0xf2f2ee, 0, 1.5, 0.2, g);
    if (kind === 'yacht') {
      box(w - 0.5, 1.1, len * 0.5, 0xf8f8f5, 0, 2.15, -0.8, g);
      box(w - 0.4, 0.5, len * 0.42, 0x1c2733, 0, 2.3, -0.7, g);
      box(w - 1, 0.7, len * 0.3, 0xf8f8f5, 0, 3.0, -1.2, g);
      box(0.1, 1.6, 0.1, 0xd5dbe1, 0, 4.1, -1.2, g);
    } else {
      const mast = new THREE.Mesh(reg(new THREE.CylinderGeometry(0.07, 0.09, 9, 6)), mats.color(0xd5dbe1));
      mast.position.set(0, 5.6, 0.4);
      g.add(mast);
      const main = new THREE.Shape();
      main.moveTo(0, 0);
      main.lineTo(0, 7.6);
      main.lineTo(-3.2, 0.4);
      main.lineTo(0, 0);
      const mainSail = new THREE.Mesh(reg(new THREE.ShapeGeometry(main)), new THREE.MeshLambertMaterial({ color: 0xfafafa, side: THREE.DoubleSide }));
      own.push(mainSail.material as THREE.Material);
      mainSail.rotation.y = Math.PI / 2;
      mainSail.position.set(0.02, 2.0, 0.3);
      g.add(mainSail);
    }
    mergeByMaterial(g);
    group.add(g);
    return g;
  };
  const dock = (x: number, z: number, yaw: number, kind: 'yacht' | 'sail', color: number) => {
    const g = makeBoat(kind, color);
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    boats.push({ g, baseY: -0.02, phase: r() * 6 });
  };
  // Amarrés le long de la route et de l'île
  dock(-302, 100, 0, 'yacht', 0x1f3a5f);
  dock(-402, 62, 0, 'yacht', 0x7a1f1f);
  dock(-402, 96, 0, 'sail', 0x2e3a8c);
  dock(-332, 262, 0, 'sail', 0xb3122e);
  dock(-302, 252, Math.PI / 2, 'yacht', 0x1b1d22);
  // En croisière au large : de part et d'autre, loin de la grille de publicité (z > 200)
  const cruise = (x0c: number, x1c: number, z: number, v: number, kind: 'yacht' | 'sail', color: number) => {
    const g = makeBoat(kind, color);
    g.position.set(x0c + r() * (x1c - x0c), 0, z);
    boats.push({ g, baseY: -0.02, phase: r() * 6, cruise: { x0: x0c, x1: x1c, v, dir: r() < 0.5 ? 1 : -1, yaw: 0 } });
  };
  cruise(-190, 80, 215, 2.4, 'yacht', 0xf2f2f2);
  cruise(-190, 60, 250, 1.6, 'sail', 0xe5383b);
  cruise(-180, 90, 270, 2.0, 'yacht', 0x1f6feb);
  cruise(-190, 40, 232, 1.3, 'sail', 0x22a861);

  // Décor fixe (route, bordures, bretelles, raccords) : une poignée de maillages
  mergeByMaterial(group);

  const update = (t: number, dt: number) => {
    for (const b of boats) {
      b.g.position.y = b.baseY + Math.sin(t * 0.9 + b.phase) * 0.06;
      b.g.rotation.z = Math.sin(t * 0.7 + b.phase) * 0.025;
      const c = b.cruise;
      if (!c) continue;
      b.g.position.x += c.dir * c.v * dt;
      if (b.g.position.x > c.x1) c.dir = -1;
      else if (b.g.position.x < c.x0) c.dir = 1;
      // Demi-tour progressif : la proue (+z du modèle) pointe vers +x ou −x
      const target = c.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
      let d = target - b.g.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      b.g.rotation.y += d * Math.min(1, dt * 0.8);
    }
  };
  return { group, geos, own, update };
}
