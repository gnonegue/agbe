import * as THREE from 'three';
import type { Materials } from './kit';

/** Gestes du joueur pendant qu'il sert un client. */
export type Motion = 'hand' | 'scrub' | 'clip' | 'sew' | 'hammer' | 'type';

/**
 * Poste de travail illustré d'un métier à pied. Repère local : l'origine est la place du joueur,
 * +z va vers le client. Les montants et les missions restent décidés par le serveur : ceci n'est que du décor.
 */
export interface Station {
  group: THREE.Group;
  /** Où le client vient se placer (repère local) ; `sit` : il s'assoit (fauteuil du coiffeur). */
  spot: { x: number; z: number; sit: boolean };
  motion: Motion;
  /** Objet tenu en main par le joueur pendant le service (plateau, tondeuse, éponge…). */
  hand?: THREE.Object3D;
  /** Objet remis au client pendant le geste (visible seulement pendant l'action). */
  goods?: { mesh: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3 };
  geos: THREE.BufferGeometry[];
  /** Matériaux propres au poste (écrans lumineux), à libérer avec les géométries. */
  own: THREE.Material[];
  /** Lavage : la voiture du client (elle arrive, se fait laver et repart ; sa peinture change à chaque client). */
  car?: { g: THREE.Group; paint: THREE.MeshLambertMaterial };
}

/** Métiers à pied qui ont un poste illustré ; les autres (zém, livraison, tricycle) se voient déjà sur la route. */
export const STATION_JOBS = new Set([
  'street_vendor', 'car_washer', 'tailor', 'accountant', 'maquis_waiter', 'shop_clerk', 'cyber_attendant', 'barber', 'moto_mechanic', 'hotel_waiter',
]);
/** Métiers diplômés qui réutilisent le poste d'un autre métier (même geste, même décor). */
const STATION_ALIAS: Record<string, string> = {
  agent_commercial: 'shop_clerk', responsable_commercial: 'shop_clerk', directeur_commercial: 'shop_clerk',
  aide_comptable: 'accountant', assistant_financier: 'accountant', directeur_financier: 'accountant', consultant_expert: 'accountant',
  developpeur: 'cyber_attendant', technicien_info: 'cyber_attendant', chef_projet_it: 'cyber_attendant', journaliste: 'cyber_attendant', redacteur_en_chef: 'cyber_attendant',
  enseignant_chercheur: 'accountant',
  styliste: 'tailor', directeur_creation: 'tailor',
  coiffeur_pro: 'barber', directeur_salon: 'barber',
  electricien_batiment: 'moto_mechanic', technicien_btp: 'moto_mechanic', ingenieur_electricien: 'moto_mechanic', ingenieur_energie: 'moto_mechanic', conducteur_travaux: 'moto_mechanic', ingenieur_btp: 'moto_mechanic',
};
/** Poste illustré d'un métier (le sien, ou celui dont il reprend le geste), ou null. */
export const stationOf = (jobId: string): string | null => (STATION_JOBS.has(jobId) ? jobId : STATION_ALIAS[jobId] ?? null);
/** Métiers qui se font à l'intérieur du lieu (boutique, bureau, salle, maquis) : le joueur y reste, les clients viennent à lui. */
export const INDOOR_JOBS = new Set(['shop_clerk', 'accountant', 'cyber_attendant', 'maquis_waiter', 'desk']);
/** Poste utilisé pour les séances de l'entreprise du joueur. */
export const DESK = 'desk';

const WOOD = 0x8b5a2b;
const WHITE = 0xf4f4f4;

/** `indoor` : poste installé dans une pièce couverte (pas d'auvent ni de parasol). */
export function buildStation(mats: Materials, id: string, indoor = false): Station {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const own: THREE.Material[] = [];
  const reg = <T extends THREE.BufferGeometry>(g: T): T => (geos.push(g), g);
  const place = (m: THREE.Mesh, x: number, y: number, z: number, parent: THREE.Object3D = group) => {
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const box = (w: number, h: number, d: number, c: number, x: number, y: number, z: number, parent?: THREE.Object3D) =>
    place(new THREE.Mesh(reg(new THREE.BoxGeometry(w, h, d)), mats.color(c)), x, y, z, parent);
  const cyl = (rt: number, rb: number, h: number, c: number, x: number, y: number, z: number, seg = 14, parent?: THREE.Object3D) =>
    place(new THREE.Mesh(reg(new THREE.CylinderGeometry(rt, rb, h, seg)), mats.color(c)), x, y, z, parent);
  const ball = (r: number, c: number, x: number, y: number, z: number, parent?: THREE.Object3D) =>
    place(new THREE.Mesh(reg(new THREE.SphereGeometry(r, 10, 8)), mats.color(c)), x, y, z, parent);
  const glow = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.MeshLambertMaterial({ color: 0x9fd0ff, emissive: 0x4a8fd8, emissiveIntensity: 0.7 });
    own.push(m);
    return place(new THREE.Mesh(reg(new THREE.BoxGeometry(w, h, d)), m), x, y, z);
  };

  /** Comptoir de service devant le joueur. */
  const counter = (w: number, body: number, top: number, z = 1) => {
    box(w, 0.9, 0.7, body, 0, 0.45, z);
    box(w + 0.1, 0.07, 0.8, top, 0, 0.93, z);
  };
  /** Auvent rayé tenu par deux poteaux, au-dessus et derrière le joueur. */
  const awning = (w: number, a: number, b: number) => {
    for (const s of [-1, 1]) cyl(0.05, 0.05, 2.5, 0x6b7280, s * (w / 2), 1.25, -1.2, 8);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const strip = box(w / n, 0.06, 3, i % 2 ? a : b, -w / 2 + (i + 0.5) * (w / n), 2.55, 0.1);
      strip.rotation.x = 0.1;
    }
  };
  /** Étagère garnie de produits colorés, derrière le joueur. */
  const shelves = (w: number, z: number, levels: number) => {
    box(w, levels * 0.55 + 0.1, 0.5, 0xdfe4ea, 0, (levels * 0.55 + 0.1) / 2, z);
    const cols = [0xe5383b, 0x1f6feb, 0xffce00, 0x22a861, 0xf18f01, 0x8e44ad];
    for (let l = 0; l < levels; l++) for (let i = 0; i < 9; i++) box(0.22, 0.3, 0.2, cols[(i + l * 2) % cols.length]!, -w / 2 + 0.3 + i * ((w - 0.5) / 8), 0.4 + l * 0.55, z + 0.28);
  };

  let spot = { x: 0, z: 2.1, sit: false };
  let motion: Motion = 'hand';
  let hand: THREE.Object3D | undefined;
  let carWash: Station['car'];
  let goods: Station['goods'];
  const giveFrom = new THREE.Vector3(0, 1.05, 1.0);
  const giveTo = new THREE.Vector3(0, 1.15, 1.9);
  const gift = (mesh: THREE.Object3D) => {
    mesh.visible = false;
    group.add(mesh);
    goods = { mesh, from: giveFrom, to: giveTo };
  };
  const holdTray = () => {
    const tray = new THREE.Group();
    cyl(0.3, 0.3, 0.03, 0xc0c4cc, 0, 0, 0, 16, tray);
    cyl(0.04, 0.04, 0.22, 0x2a9d8f, 0.1, 0.12, 0, 8, tray); // bouteille
    cyl(0.09, 0.09, 0.02, WHITE, -0.1, 0.03, 0.04, 12, tray);
    tray.position.set(0, -0.3, 0.22);
    hand = tray;
  };

  switch (id) {
    case 'street_vendor': {
      // Table de marché, panier d'oranges, beignets, sachets d'eau et parasol
      box(2, 0.07, 0.8, WOOD, 0, 0.85, 1);
      for (const [x, z] of [[-0.9, 0.7], [0.9, 0.7], [-0.9, 1.3], [0.9, 1.3]] as const) box(0.07, 0.85, 0.07, WOOD, x, 0.42, z);
      cyl(0.32, 0.26, 0.2, 0xc49a6c, -0.55, 0.99, 1, 14);
      for (let i = 0; i < 9; i++) ball(0.09, 0xf18f01, -0.55 + Math.cos(i * 2.1) * 0.15, 1.12 + (i % 3) * 0.02, 1 + Math.sin(i * 2.1) * 0.15);
      cyl(0.2, 0.17, 0.08, 0xdddddd, 0.3, 0.92, 1.05, 14);
      for (let i = 0; i < 6; i++) ball(0.07, 0xc98a3b, 0.3 + Math.cos(i * 1.4) * 0.09, 1.0, 1.05 + Math.sin(i * 1.4) * 0.09);
      for (let i = 0; i < 5; i++) box(0.16, 0.05, 0.22, 0x8ecae6, 0.75, 0.92 + i * 0.05, 1);
      if (!indoor) {
        cyl(0.04, 0.04, 2.4, 0x6b7280, 1.3, 1.2, -0.3, 8);
        place(new THREE.Mesh(reg(new THREE.ConeGeometry(1.6, 0.5, 10)), mats.color(0xe5383b)), 1.3, 2.55, -0.3);
      }
      const o = ball(0.1, 0xf18f01, 0, 0, 0);
      gift(o);
      break;
    }
    case 'shop_clerk': {
      // Kiosque de quartier : comptoir, étagères de produits, cartes de crédit, enseigne
      counter(2.8, 0x1f6feb, 0xffce00);
      if (!indoor) awning(3, 0xe5383b, 0xffffff);
      if (!indoor) shelves(3, -1, 4); // dans le magasin, les rayons de la pièce font office d'étagères
      box(2.4, 0.5, 0.08, 0xffce00, 0, 3.0, 1.1); // enseigne
      // Articles sur le comptoir : crédits, savons, biscuits, bouteilles, bonbons
      const cols = [0xe5383b, 0x1f6feb, 0xffce00, 0x22a861, 0xf18f01, 0x8e44ad];
      for (let i = 0; i < 9; i++) box(0.22, 0.3, 0.14, cols[i % cols.length]!, -1.15 + i * 0.28, 1.12, 1.28); // présentoir arrière
      for (let i = 0; i < 5; i++) cyl(0.05, 0.05, 0.28, cols[(i + 2) % cols.length]!, -1.1 + i * 0.13, 1.11, 0.8, 8); // bouteilles
      for (let i = 0; i < 4; i++) box(0.2, 0.08 + (i % 2) * 0.04, 0.14, 0xffffff, 0.2 + i * 0.22, 0.99, 0.85); // savons
      for (let i = 0; i < 3; i++) box(0.3, 0.1, 0.2, 0xf18f01, 0.55, 0.99 + i * 0.1, 1.15); // biscuits empilés
      box(0.4, 0.04, 0.26, 0xe5383b, -0.9, 0.98, 1); // cartes
      box(0.14, 0.02, 0.26, 0x14213d, 0.9, 0.98, 1); // téléphone
      gift(box(0.28, 0.2, 0.18, 0x22a861, 0, 0, 0));
      break;
    }
    case 'cyber_attendant': {
      // Comptoir avec deux écrans allumés, clavier, imprimante ; routeur derrière
      counter(2.6, 0x374151, 0xe5e7eb);
      for (const x of [-0.7, 0.5]) {
        box(0.6, 0.4, 0.05, 0x14213d, x, 1.3, 0.95);
        glow(0.52, 0.32, 0.02, x, 1.3, 0.98);
        box(0.12, 0.2, 0.1, 0x14213d, x, 1.1, 0.95);
        box(0.46, 0.03, 0.16, 0x9ca3af, x, 0.98, 1.2);
      }
      box(0.5, 0.18, 0.4, WHITE, 1.05, 1.05, 1);
      shelves(2.6, -1, 3);
      box(2, 0.45, 0.08, 0x1f6feb, 0, 2.5, 1.1);
      gift(box(0.3, 0.01, 0.21, WHITE, 0, 0, 0));
      break;
    }
    case 'maquis_waiter': {
      // Deux tables du maquis avec assiettes et bouteilles, tabourets ; plateau en main
      for (const x of [-0.9, 0.9]) {
        cyl(0.55, 0.55, 0.05, 0xc1121f, x, 0.8, 1.3, 18);
        cyl(0.05, 0.05, 0.78, 0x6b7280, x, 0.4, 1.3, 8);
        cyl(0.09, 0.09, 0.02, WHITE, x - 0.15, 0.84, 1.25, 12);
        cyl(0.04, 0.04, 0.2, 0x2a9d8f, x + 0.15, 0.94, 1.35, 8);
        cyl(0.18, 0.18, 0.05, WOOD, x, 0.3, 2.0, 10);
        cyl(0.18, 0.18, 0.05, WOOD, x, 0.3, 0.6, 10);
      }
      holdTray();
      const plate = new THREE.Group();
      cyl(0.13, 0.13, 0.02, WHITE, 0, 0, 0, 14, plate);
      ball(0.08, 0xc98a3b, 0, 0.06, 0, plate);
      gift(plate);
      spot = { x: 0, z: 2.0, sit: false };
      break;
    }
    case 'hotel_waiter': {
      // Chariot de service nappé : cafetière, tasses, carafe de jus ; plateau en main
      box(1.4, 0.06, 0.7, 0xfafafa, 0, 0.9, 1);
      for (const x of [-0.6, 0.6]) {
        box(0.05, 0.85, 0.05, 0xb8c0cc, x, 0.45, 0.7);
        box(0.05, 0.85, 0.05, 0xb8c0cc, x, 0.45, 1.3);
        cyl(0.1, 0.1, 0.04, 0x111111, x, 0.06, 1, 10).rotation.z = Math.PI / 2;
      }
      cyl(0.1, 0.13, 0.28, 0xd4af37, -0.45, 1.07, 1, 12);
      for (const x of [-0.1, 0.05, 0.2]) cyl(0.05, 0.04, 0.07, WHITE, x, 0.97, 1.1, 10);
      cyl(0.09, 0.09, 0.26, 0xf18f01, 0.5, 1.06, 1, 12);
      holdTray();
      gift(cyl(0.05, 0.04, 0.08, WHITE, 0, 0, 0, 10));
      break;
    }
    case 'barber': {
      // Fauteuil de coiffeur, miroir, poteau de barbier, plateau de peignes ; le client s'assoit
      box(0.8, 0.1, 0.8, 0x14213d, 0, 0.68, 1.55);
      box(0.8, 0.9, 0.12, 0x14213d, 0, 1.15, 1.15); // dossier côté joueur
      cyl(0.09, 0.14, 0.62, 0x6b7280, 0, 0.31, 1.55, 10);
      cyl(0.32, 0.32, 0.04, 0x374151, 0, 0.02, 1.55, 14);
      box(0.1, 0.5, 0.1, 0x14213d, -0.42, 0.9, 1.55);
      box(0.1, 0.5, 0.1, 0x14213d, 0.42, 0.9, 1.55);
      box(1.5, 1.2, 0.05, 0xcfe9ff, 0, 1.7, 2.8); // miroir
      box(1.6, 1.3, 0.04, WOOD, 0, 1.7, 2.84);
      box(1.6, 0.8, 0.5, 0x374151, 0, 0.4, 2.55);
      const pole = new THREE.Group();
      cyl(0.1, 0.1, 1.5, 0xffffff, 0, 0.75, 0, 12, pole);
      for (let i = 0; i < 5; i++) {
        cyl(0.105, 0.105, 0.12, i % 2 ? 0xe5383b : 0x1f6feb, 0, 0.2 + i * 0.28, 0, 12, pole);
      }
      pole.position.set(1.4, 0, 0.6);
      group.add(pole);
      box(0.5, 0.04, 0.3, 0x14213d, -1.2, 0.95, 0.9);
      box(0.2, 0.03, 0.04, 0x111111, -1.3, 1.0, 0.9);
      const clip = new THREE.Group();
      box(0.05, 0.14, 0.04, 0x111111, 0, 0, 0, clip);
      clip.position.set(0, -0.3, 0.08);
      hand = clip;
      spot = { x: 0, z: 1.55, sit: true };
      motion = 'clip';
      break;
    }
    case 'tailor': {
      // Table avec machine à coudre, rouleaux de tissu, mannequin habillé de wax
      box(2, 0.07, 0.8, WOOD, 0, 0.85, 1);
      for (const [x, z] of [[-0.9, 0.7], [0.9, 0.7], [-0.9, 1.3], [0.9, 1.3]] as const) box(0.07, 0.85, 0.07, WOOD, x, 0.42, z);
      box(0.5, 0.3, 0.2, 0x111827, -0.2, 1.05, 1);
      box(0.3, 0.08, 0.14, 0x111827, -0.05, 1.28, 1).rotation.z = 0.2;
      box(0.5, 0.03, 0.4, 0xe5383b, 0.5, 0.9, 1.1);
      const bolts = [0x22a861, 0xffce00, 0x1f6feb, 0x8e44ad];
      bolts.forEach((c, i) => cyl(0.14, 0.14, 0.7, c, -1.0 + i * 0.35, 0.7 + (i % 2) * 0.3, -1.1, 12).rotation.z = Math.PI / 2);
      box(1.6, 0.05, 0.4, WOOD, -0.3, 0.55, -1.1);
      box(1.6, 0.05, 0.4, WOOD, -0.3, 0.85, -1.1);
      cyl(0.22, 0.28, 0.7, 0xf18f01, -1.5, 1.15, 0.9, 12);
      cyl(0.03, 0.03, 0.8, 0x6b7280, -1.5, 0.4, 0.9, 6);
      ball(0.1, 0xd4a07a, -1.5, 1.6, 0.9);
      const scissors = new THREE.Group();
      box(0.03, 0.18, 0.02, 0xc0c4cc, 0, 0, 0, scissors);
      scissors.position.set(0, -0.3, 0.08);
      hand = scissors;
      gift(box(0.3, 0.05, 0.22, 0xf18f01, 0, 0, 0));
      motion = 'sew';
      break;
    }
    case 'moto_mechanic': {
      // Moto du client sur béquille, établi d'outils, pneus
      const bike = new THREE.Group();
      for (const x of [-0.6, 0.6]) {
        const w = cyl(0.3, 0.3, 0.1, 0x111111, x, 0.3, 0, 16, bike);
        w.rotation.z = Math.PI / 2;
        w.rotation.y = Math.PI / 2;
      }
      box(1.3, 0.12, 0.2, 0xe5383b, 0, 0.55, 0, bike);
      box(0.5, 0.08, 0.22, 0x111111, -0.1, 0.78, 0, bike);
      box(0.35, 0.3, 0.2, 0xc0c4cc, 0.15, 0.4, 0, bike);
      box(0.05, 0.5, 0.05, 0x6b7280, 0.55, 0.8, 0, bike).rotation.z = -0.3;
      box(0.35, 0.04, 0.5, 0x6b7280, 0.55, 0.98, 0, bike);
      bike.position.set(0.5, 0, 1.5);
      group.add(bike);
      box(1.4, 0.07, 0.6, 0x374151, -1.4, 0.85, 0.5);
      for (const z of [0.25, 0.75]) box(0.07, 0.85, 0.07, 0x374151, -2.0, 0.42, z);
      box(0.4, 0.2, 0.25, 0xe5383b, -1.3, 1.0, 0.5);
      cyl(0.28, 0.28, 0.16, 0x1b1b1b, -1.9, 0.08, 1.4, 14);
      cyl(0.28, 0.28, 0.16, 0x1b1b1b, -1.9, 0.24, 1.4, 14);
      const wrench = new THREE.Group();
      box(0.04, 0.26, 0.03, 0xc0c4cc, 0, -0.02, 0, wrench);
      wrench.position.set(0, -0.3, 0.08);
      hand = wrench;
      spot = { x: -0.5, z: 2.4, sit: false };
      motion = 'hammer';
      break;
    }
    case 'car_washer': {
      // Voiture du client à laver (le client, c'est elle) : seau de mousse, éponge
      const car = new THREE.Group();
      const paint = new THREE.MeshLambertMaterial({ color: 0x2563eb });
      own.push(paint);
      place(new THREE.Mesh(reg(new THREE.BoxGeometry(3.4, 0.7, 1.6)), paint), 0, 0.6, 0, car);
      place(new THREE.Mesh(reg(new THREE.BoxGeometry(1.8, 0.55, 1.45)), paint), -0.1, 1.2, 0, car);
      box(1.7, 0.4, 1.5, 0xcfe9ff, -0.1, 1.2, 0, car);
      for (const [x, z] of [[-1.1, 0.8], [1.1, 0.8], [-1.1, -0.8], [1.1, -0.8]] as const) cyl(0.32, 0.32, 0.2, 0x111111, x, 0.32, z, 14, car).rotation.x = Math.PI / 2;
      for (const x of [-1.72, 1.72]) box(0.06, 0.18, 0.4, x < 0 ? 0xffe9a8 : 0xe5383b, x, 0.7, 0.45, car);
      for (let i = 0; i < 5; i++) ball(0.07, 0xffffff, -0.6 + i * 0.35, 1.5, -0.8, car);
      car.position.set(0, 0, 2.7);
      car.visible = false;
      group.add(car);
      carWash = { g: car, paint };
      cyl(0.22, 0.18, 0.34, 0xf18f01, 1.2, 0.17, 1.0, 12);
      for (let i = 0; i < 6; i++) ball(0.09, 0xffffff, 1.2 + Math.cos(i * 1.1) * 0.1, 0.38 + (i % 2) * 0.03, 1.0 + Math.sin(i * 1.1) * 0.1);
      const sponge = new THREE.Group();
      box(0.14, 0.06, 0.1, 0xffce00, 0, 0, 0, sponge);
      sponge.position.set(0, -0.29, 0.08);
      hand = sponge;
      spot = { x: -2.5, z: 1.3, sit: false };
      motion = 'scrub';
      break;
    }
    default: {
      // Bureau (comptable, séance d'entreprise) : ordinateur, dossiers, calculatrice
      counter(2.2, 0x6b4f2a, 0xd9c8a8);
      box(0.55, 0.02, 0.38, 0x374151, -0.3, 0.98, 1.1);
      box(0.55, 0.36, 0.03, 0x374151, -0.3, 1.18, 0.95).rotation.x = -0.15;
      glow(0.47, 0.28, 0.02, -0.3, 1.18, 0.97);
      for (let i = 0; i < 4; i++) box(0.34, 0.03, 0.26, i % 2 ? 0xffffff : 0xfde68a, 0.6, 0.99 + i * 0.03, 1.05);
      box(0.14, 0.03, 0.2, 0x111827, 0.2, 0.98, 1.2);
      box(2.2, 1.2, 0.3, 0xdfe4ea, 0, 0.6, -1.0);
      for (let i = 0; i < 8; i++) box(0.2, 0.3, 0.2, [0x1f6feb, 0xe5383b, 0x22a861, 0xffce00][i % 4]!, -0.8 + i * 0.23, 1.35, -1.0);
      gift(box(0.3, 0.01, 0.21, WHITE, 0, 0, 0));
      motion = 'type';
    }
  }
  return { group, spot, motion, hand, goods, geos, own, car: carWash };
}

/** Position des bras du joueur à l'instant `t` (secondes) d'un geste de `p` (0..1) ; `bump` monte puis redescend. */
export function poseArms(player: THREE.Object3D, motion: Motion, t: number, p: number): void {
  const armL = player.getObjectByName('armL');
  const armR = player.getObjectByName('armR');
  const foreL = armL?.getObjectByName('forearm');
  const foreR = armR?.getObjectByName('forearm');
  if (!armL || !armR || !foreL || !foreR) return;
  const bump = Math.sin(Math.PI * Math.min(1, Math.max(0, p)));
  switch (motion) {
    case 'hand': // les deux bras tendent l'article au client
      armL.rotation.x = armR.rotation.x = -1.25 * bump;
      foreL.rotation.x = foreR.rotation.x = -0.18 - 0.25 * bump;
      break;
    case 'scrub': // frotte la carrosserie
      armR.rotation.x = -1.1 + 0.3 * Math.sin(t * 14);
      armR.rotation.z = 0.15 * Math.sin(t * 14);
      foreR.rotation.x = -0.5;
      armL.rotation.x = -0.4;
      break;
    case 'clip': // tondeuse autour de la tête du client
      armR.rotation.x = -1.9 + 0.12 * Math.sin(t * 9);
      armR.rotation.z = 0.25 * Math.sin(t * 4.5);
      foreR.rotation.x = -0.8;
      armL.rotation.x = -0.9;
      foreL.rotation.x = -0.9;
      break;
    case 'sew': // guide le tissu sous l'aiguille
      armL.rotation.x = armR.rotation.x = -0.95 + 0.06 * Math.sin(t * 18);
      foreL.rotation.x = foreR.rotation.x = -0.6;
      break;
    case 'hammer': // frappe, serre : coups de clé
      armR.rotation.x = -1.2 + 0.8 * Math.max(0, Math.sin(t * 9));
      foreR.rotation.x = -0.7;
      armL.rotation.x = -0.5;
      break;
    case 'type': // écrit, tape, tamponne
      armL.rotation.x = armR.rotation.x = -0.85 + 0.05 * Math.sin(t * 16);
      foreL.rotation.x = foreR.rotation.x = -0.9 + 0.1 * Math.sin(t * 16 + 1);
      break;
  }
}

/** Remet les bras au repos après un geste. */
export function restArms(player: THREE.Object3D): void {
  for (const n of ['armL', 'armR']) {
    const arm = player.getObjectByName(n);
    if (!arm) continue;
    arm.rotation.x = 0;
    arm.rotation.z = n === 'armL' ? -0.035 : 0.035;
    const f = arm.getObjectByName('forearm');
    if (f) f.rotation.x = -0.18;
  }
}
