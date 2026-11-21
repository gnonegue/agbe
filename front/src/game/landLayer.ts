import * as THREE from 'three';
import type { Materials } from './kit';
import { buildHouse, styleOfUse } from './houses';

/** Une zone de terrain à vendre telle que la carte la dessine (données publiques : couleurs d'occupants, jamais de noms). */
export interface LandZoneView {
  id: string;
  /** Texte de l'enseigne d'entrée, déjà traduit. */
  label: string;
  sub: string;
  layout: { originX: number; originZ: number; cols: number; rows: number; cell: number };
  /** Rangées prévues au total (zone qui s'étend au fil des achats) : la part encore fermée est tracée en pointillé. */
  planRows?: number;
  /** Marge de sol autour de la grille (0 en pleine ville) et enseigne d'entrée (non pour un lotissement urbain). */
  margin?: number;
  sign?: boolean;
  /** Parcelles en mer : ponton de bois sur l'eau (et non terre battue), sans route d'accès ; à ne pas confondre avec les cases de publicité. */
  water?: boolean;
  /** Occupation par cellule : `q` masque des quarts vendus (4 bits), `o` indice de couleur de l'occupant, `use` exploitation ; `home` : ma maison habitée, dessinée ailleurs. */
  owners: { cell: number; q: number; g?: number; o: number; mine: boolean; home?: boolean; use: string | null; style?: string | null; ready: boolean }[];
}

export interface LandLayer {
  group: THREE.Group;
  /** Sols cliquables (userData.landZone = identifiant de la zone). */
  pick: THREE.Mesh[];
  geos: THREE.BufferGeometry[];
  own: THREE.Material[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const OWNER_COLORS = [0xe5383b, 0xf18f01, 0xffce00, 0x22a861, 0x8e44ad, 0xd6336c, 0x0f766e, 0x7c5a2a];
const MINE = 0x2563eb;
const DEFAULT_MARGIN = 6;

/**
 * Zones de terrain à vendre : sol de terre battue, lots délimités, bornes aux coins, quarts vendus colorés par
 * propriétaire (le joueur en bleu), maisons, chantiers et exploitations, enseigne à l'entrée.
 * Tout est regroupé en peu d'objets (lignes, maillages instanciés) : une zone de 100 lots coûte une dizaine d'appels.
 */
export function buildLandLayer(zones: LandZoneView[], mats: Materials, poster: (title: string, sub: string, bg: string, fg: string, w: number, h: number) => THREE.Texture, shadows: boolean): LandLayer {
  const group = new THREE.Group();
  const pick: THREE.Mesh[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const own: THREE.Material[] = [];
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const reg = <T extends THREE.BufferGeometry>(g: T): T => (geos.push(g), g);
  const add = (m: THREE.Object3D) => (group.add(m), m);
  const box = (w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(reg(new THREE.BoxGeometry(w, h, d)), mats.color(color));
    m.position.set(x, y, z);
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    group.add(m);
    return m;
  };
  const cyl = (rt: number, rb: number, h: number, color: number, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(reg(new THREE.CylinderGeometry(rt, rb, h, 14)), mats.color(color));
    m.position.set(x, y, z);
    m.castShadow = shadows;
    group.add(m);
    return m;
  };

  // Arbres des parcelles : une seule géométrie partagée (mise à l'échelle par arbre)
  const TRUNK = reg(new THREE.CylinderGeometry(0.1, 0.15, 1.3, 6));
  const CROWN = reg(new THREE.SphereGeometry(0.85, 8, 6));

  for (const z of zones) {
    const { originX: ox, originZ: oz, cols, rows, cell } = z.layout;
    const MARGIN = z.margin ?? DEFAULT_MARGIN;
    const w = cols * cell;
    const d = rows * cell;
    bounds.minX = Math.min(bounds.minX, ox - MARGIN);
    bounds.maxX = Math.max(bounds.maxX, ox + w + MARGIN);
    bounds.minZ = Math.min(bounds.minZ, oz - MARGIN);
    bounds.maxZ = Math.max(bounds.maxZ, oz + d + MARGIN + 8);

    // Sol : terre battue, un peu au-dessus de l'herbe ; c'est lui qu'on touche pour choisir un lot
    // En mer : ponton de bois clair bordé de blanc, bien différent des cases bleu pâle de publicité
    const plate = box(w + MARGIN * 2, 0.3, d + MARGIN * 2, z.water ? 0xd9b98a : 0xcaa86b, ox + w / 2, 0.05, oz + d / 2);
    plate.castShadow = false;
    plate.userData.landZone = z.id;
    pick.push(plate);
    box(w + MARGIN * 2 + 1.2, 0.2, d + MARGIN * 2 + 1.2, z.water ? 0xf4f1ea : 0x8f6f3a, ox + w / 2, 0.02, oz + d / 2).castShadow = false; // liseré

    // Limites des lots (foncées) et séparations des quarts (claires)
    const lot: number[] = [];
    const quarter: number[] = [];
    for (let i = 0; i <= cols; i++) lot.push(ox + i * cell, 0.21, oz, ox + i * cell, 0.21, oz + d);
    for (let j = 0; j <= rows; j++) lot.push(ox, 0.21, oz + j * cell, ox + w, 0.21, oz + j * cell);
    for (let i = 0; i < cols; i++) quarter.push(ox + i * cell + cell / 2, 0.215, oz, ox + i * cell + cell / 2, 0.215, oz + d);
    for (let j = 0; j < rows; j++) quarter.push(ox, 0.215, oz + j * cell + cell / 2, ox + w, 0.215, oz + j * cell + cell / 2);
    for (const [pts, color] of [[lot, 0x6b4f26], [quarter, 0xb08d52]] as const) {
      const g = reg(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const m = new THREE.LineBasicMaterial({ color });
      own.push(m);
      add(new THREE.LineSegments(g, m));
    }

    // Extension prévue : contour pointillé de la part encore fermée, qui s'ouvrira au fil des achats
    if (z.planRows && z.planRows > rows) {
      const pts: number[] = [];
      const zEnd = oz + z.planRows * cell;
      const dash = (ax: number, az: number, bx: number, bz: number) => {
        const len = Math.hypot(bx - ax, bz - az);
        for (let t = 0; t < len; t += 3) pts.push(ax + ((bx - ax) * t) / len, 0.25, az + ((bz - az) * t) / len, ax + ((bx - ax) * Math.min(t + 1.6, len)) / len, 0.25, az + ((bz - az) * Math.min(t + 1.6, len)) / len);
      };
      dash(ox, oz + d, ox + w, oz + d);
      dash(ox, oz + d, ox, zEnd);
      dash(ox + w, oz + d, ox + w, zEnd);
      dash(ox, zEnd, ox + w, zEnd);
      const g = reg(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const m = new THREE.LineBasicMaterial({ color: 0x6b4f26 });
      own.push(m);
      add(new THREE.LineSegments(g, m));
    }

    // Bornes aux coins des lots
    const posts = new THREE.InstancedMesh(reg(new THREE.BoxGeometry(0.45, 0.9, 0.45)), mats.color(0xf4f4f1), (cols + 1) * (rows + 1));
    const tmp = new THREE.Matrix4();
    let n = 0;
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) posts.setMatrixAt(n++, tmp.makeTranslation(ox + i * cell, 0.65, oz + j * cell));
    posts.castShadow = shadows;
    add(posts);

    // Quarts vendus : dalles colorées par propriétaire (le joueur en bleu)
    const sold: { x: number; zz: number; color: number }[] = [];
    const half = cell / 2;
    const subCenter = (c: number, q: number) => ({ x: ox + (c % cols) * cell + (q % 2) * half + half / 2, z: oz + Math.floor(c / cols) * cell + Math.floor(q / 2) * half + half / 2 });
    // Parcelles : les lots réunis (même numéro `g`) forment un seul terrain d'un tenant
    const parcels = new Map<number | string, { o: (typeof z.owners)[number]; qs: { x: number; z: number }[] }>();
    for (const o of z.owners) {
      const key = o.g ?? `c${o.cell}`;
      const p = parcels.get(key) ?? { o, qs: [] };
      for (let q = 0; q < 4; q++) if ((o.q >> q) & 1) p.qs.push(subCenter(o.cell, q));
      parcels.set(key, p);
    }
    const wide: { x: number; zz: number; w: number; d: number; color: number }[] = [];
    for (const { o, qs } of parcels.values()) {
      const color = o.mine ? MINE : OWNER_COLORS[o.o % OWNER_COLORS.length]!;
      const x0 = Math.min(...qs.map((p) => p.x));
      const x1 = Math.max(...qs.map((p) => p.x));
      const z0 = Math.min(...qs.map((p) => p.z));
      const z1 = Math.max(...qs.map((p) => p.z));
      const nx = Math.round((x1 - x0) / half) + 1;
      const nz = Math.round((z1 - z0) / half) + 1;
      // Rectangle plein de plus d'un lot : une seule dalle, sans joint entre les lots
      if (qs.length > 4 && nx * nz === qs.length) wide.push({ x: (x0 + x1) / 2, zz: (z0 + z1) / 2, w: nx * half - 0.5, d: nz * half - 0.5, color });
      else for (const p of qs) sold.push({ x: p.x, zz: p.z, color });
    }
    for (const wslab of wide) {
      const m = box(wslab.w, 0.32, wslab.d, wslab.color, wslab.x, 0.36, wslab.zz);
      m.castShadow = false;
      m.receiveShadow = shadows;
    }
    if (sold.length > 0) {
      const slabs = new THREE.InstancedMesh(reg(new THREE.BoxGeometry(half - 0.5, 0.32, half - 0.5)), mats.color(0xffffff), sold.length);
      const c = new THREE.Color();
      sold.forEach((s, i) => {
        slabs.setMatrixAt(i, tmp.makeTranslation(s.x, 0.36, s.zz));
        slabs.setColorAt(i, c.setHex(s.color));
      });
      slabs.receiveShadow = shadows;
      add(slabs);
    }

    // Constructions : maison, chantier (échafaudage) ou exploitation sur le premier quart de chaque occupant
    for (const { o, qs: parcelQs } of parcels.values()) {
      if (!o.use || o.home) continue;
      // Parcelle d'un seul lot : sur son premier quart ; parcelle réunie : au centre de tout le terrain, en plus grand
      const merged = parcelQs.length > 4;
      const { x, z: zc } = merged
        ? { x: parcelQs.reduce((a, p) => a + p.x, 0) / parcelQs.length, z: parcelQs.reduce((a, p) => a + p.z, 0) / parcelQs.length }
        : parcelQs[0]!;
      const big = parcelQs.length >= 2;
      const s = parcelQs.length >= 16 ? 2.4 : merged ? 1.8 : big ? 1.25 : 1;
      // Fanion aux couleurs de l'occupant : l'exploitation se repère de loin sur la carte
      box(0.14, 6.5, 0.14, 0x4a3a2a, x - 1.7 * s, 3.3, zc + 1.7 * s);
      box(2, 1.1, 0.1, o.mine ? MINE : OWNER_COLORS[o.o % OWNER_COLORS.length]!, x - 0.7 * s, 6, zc + 1.7 * s);
      if (!o.ready) {
        // Chantier : murs à mi-hauteur, quatre poteaux d'échafaudage, tas de sable
        box(3.2 * s, 1.1, 2.6 * s, 0x9aa1a8, x, 0.9, zc);
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) box(0.12, 2.8, 0.12, 0xb07a3a, x + dx * 1.9 * s, 1.7, zc + dz * 1.6 * s);
        const sand = new THREE.Mesh(reg(new THREE.ConeGeometry(0.8, 0.7, 8)), mats.color(0xe0c48a));
        sand.position.set(x + 2.2 * s, 0.7, zc + 1.4 * s);
        add(sand);
        continue;
      }
      if (o.use.startsWith('house_')) {
        // Maison du modèle choisi, réduite pour tenir sur ses quarts de lot (façade vers le sud, face à la carte), dans une parcelle
        // aménagée : pelouse, clôture basse avec portail, allée dallée, arbres et fleurs
        const h = buildHouse(mats, styleOfUse(o.use, o.style ?? undefined));
        const qs = parcelQs;
        const cx = qs.reduce((a, p) => a + p.x, 0) / qs.length;
        const cz = qs.reduce((a, p) => a + p.z, 0) / qs.length;
        const x0 = Math.min(...qs.map((p) => p.x)) - half / 2 + 0.3;
        const x1 = Math.max(...qs.map((p) => p.x)) + half / 2 - 0.3;
        const z0 = Math.min(...qs.map((p) => p.z)) - half / 2 + 0.3;
        const z1 = Math.max(...qs.map((p) => p.z)) + half / 2 - 0.3;
        const fit = (qs.length >= 4 ? cell - 1.6 : qs.length >= 2 ? half + 0.6 : half - 0.6) * 0.86;
        const base = 0.575;
        // Pelouse (le liseré de la dalle garde la couleur du propriétaire)
        box(x1 - x0, 0.06, z1 - z0, 0x86c964, (x0 + x1) / 2, 0.55, (z0 + z1) / 2).castShadow = false;
        // Clôture basse tout autour, sauf un portail au sud
        const wallY = base + 0.2;
        const gate = 1.7;
        box(x1 - x0, 0.4, 0.12, 0xf4f0e6, (x0 + x1) / 2, wallY, z0);
        box(0.12, 0.4, z1 - z0, 0xf4f0e6, x0, wallY, (z0 + z1) / 2);
        box(0.12, 0.4, z1 - z0, 0xf4f0e6, x1, wallY, (z0 + z1) / 2);
        const left = cx - gate / 2 - x0;
        const right = x1 - (cx + gate / 2);
        if (left > 0.2) box(left, 0.4, 0.12, 0xf4f0e6, x0 + left / 2, wallY, z1);
        if (right > 0.2) box(right, 0.4, 0.12, 0xf4f0e6, x1 - right / 2, wallY, z1);
        for (const gx of [cx - gate / 2, cx + gate / 2]) box(0.26, 0.85, 0.26, 0x8a7a62, gx, base + 0.42, z1);
        // Allée dallée du portail jusqu'à la maison
        box(1.2, 0.03, z1 - cz, 0xd9d3c4, cx, base + 0.01, (cz + z1) / 2).castShadow = false;
        // Place de stationnement dallée (voiture) à côté de l'allée, sur les parcelles assez larges
        if (qs.length >= 2 && x1 - cx > 3.6) {
          const px = cx + 2.5;
          box(2.3, 0.04, 2.8, 0x8a8d93, px, base + 0.02, z1 - 1.8).castShadow = false;
          for (const dx of [-1.1, 1.1]) box(0.07, 0.05, 2.7, 0xf5f5f0, px + dx, base + 0.03, z1 - 1.8).castShadow = false;
          box(2.2, 0.05, 0.07, 0xf5f5f0, px, base + 0.03, z1 - 3.15).castShadow = false;
        }
        // Arbres aux coins du fond et fleurs près du portail (plus de place sur les grandes parcelles)
        const treeAt = (tx: number, tz: number, k: number) => {
          const trunk = new THREE.Mesh(TRUNK, mats.color(0x7a5a3a));
          trunk.scale.setScalar(k);
          trunk.position.set(tx, base + 0.65 * k, tz);
          const crown = new THREE.Mesh(CROWN, mats.color(0x3fa14f));
          crown.scale.setScalar(k);
          crown.position.set(tx, base + 1.7 * k, tz);
          crown.castShadow = shadows;
          group.add(trunk, crown);
        };
        const k = qs.length >= 2 ? 1 : 0.7;
        treeAt(x0 + 0.7, z0 + 0.7, k);
        if (qs.length >= 2) treeAt(x1 - 0.7, z0 + 0.7, k * 0.9);
        [0xe5383b, 0xffce00, 0xff7aa8].forEach((color, i) => {
          box(0.22, 0.22, 0.22, color, cx + gate / 2 + 0.5 + i * 0.3, base + 0.12, z1 - 0.4);
          box(0.22, 0.22, 0.22, color, cx - gate / 2 - 0.5 - i * 0.3, base + 0.12, z1 - 0.4);
        });
        h.group.scale.setScalar(fit / Math.max(h.w, h.d));
        h.group.position.set(cx, base, cz - 0.3);
        h.group.traverse((m) => {
          if (m instanceof THREE.Mesh) m.castShadow = shadows;
        });
        add(h.group);
      } else if (o.use === 'biz_garden') {
        for (let r = 0; r < 4; r++) box(3.4 * s, 0.35, 0.45, r % 2 ? 0x2f8f3a : 0x4fb04a, x, 0.5, zc - 1.2 + r * 0.8);
      } else if (o.use === 'biz_poultry') {
        box(4 * s, 1.5, 1.8, 0xd9c7a8, x, 1, zc);
        box(4.3 * s, 0.25, 2.2, 0xc0392b, x, 1.85, zc);
      } else if (o.use === 'biz_bricks') {
        for (let r = 0; r < 3; r++) for (let c2 = 0; c2 < 3; c2++) box(1, 0.6, 0.6, 0xc2602d, x - 1.2 + c2 * 1.2, 0.6 + (r % 2) * 0.1, zc - 0.8 + r * 0.8);
      } else if (o.use === 'biz_warehouse') {
        box(4.6 * s, 2.4, 3.2, 0xcfd3d8, x, 1.4, zc);
        box(4.9 * s, 0.3, 3.5, 0x1f6feb, x, 2.75, zc);
      } else if (o.use === 'biz_cement') {
        // Silos et atelier, à l'échelle de la parcelle (plus grands sur des lots réunis)
        cyl(0.9 * s, 0.9 * s, 5.5 * s, 0xdfe2e5, x - 1.2 * s, 2.75 * s + 0.25, zc);
        cyl(0.9 * s, 0.9 * s, 4.5 * s, 0xcfd3d8, x + 0.4 * s, 2.25 * s + 0.25, zc + 0.3 * s);
        box(2.2 * s, 1.6 * s, 2 * s, 0x8d97a3, x + 1.6 * s, 0.8 * s + 0.2, zc - 0.5 * s);
      } else if (o.use === 'biz_refinery') {
        cyl(1.1 * s, 1.1 * s, 2.4 * s, 0xe8e8e8, x - 1.5 * s, 1.2 * s + 0.2, zc + 0.6 * s);
        cyl(1.1 * s, 1.1 * s, 2.4 * s, 0xe8e8e8, x + 0.1 * s, 1.2 * s + 0.2, zc + 0.6 * s);
        cyl(0.3 * s, 0.3 * s, 6 * s, 0x9aa3ad, x + 1.8 * s, 3 * s + 0.4, zc - 0.7 * s);
        box(0.5 * s, 0.5 * s, 0.5 * s, 0xff7a1a, x + 1.8 * s, 6.25 * s + 0.4, zc - 0.7 * s);
        box(2.6 * s, 0.3 * s, 0.3 * s, 0x8d97a3, x - 0.7 * s, 2.7 * s + 0.2, zc + 0.6 * s);
      } else {
        box(3 * s, 2, 2.4, 0xd9dde3, x, 1.2, zc);
      }
    }

    if (z.sign !== false) {
      // Enseigne à l'entrée (côté sud, face à la caméra de la carte)
      const sx = ox + w / 2;
      const sz = oz + d + MARGIN - 1.2;
      box(0.5, 8, 0.5, 0x5b3a1e, sx - 7.6, 4, sz);
      box(0.5, 8, 0.5, 0x5b3a1e, sx + 7.6, 4, sz);
      box(15.6, 4.2, 0.4, 0xffffff, sx, 7, sz);
      const tex = poster(z.label, z.sub, '#6b4f26', '#ffffff', 768, 192);
      const sign = new THREE.Mesh(reg(new THREE.PlaneGeometry(15, 3.75)), new THREE.MeshBasicMaterial({ map: tex }));
      own.push(sign.material as THREE.Material);
      sign.position.set(sx, 7, sz + 0.25);
      add(sign);
    }
  }
  return { group, pick, geos, own, bounds };
}
