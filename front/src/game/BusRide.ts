import * as THREE from 'three';
import type { Quality } from '../lib/prefs';
import { PROFILES, pixelRatioFor, type QualityProfile } from './quality';
import { animateWalk, buildPerson, Materials, randomLook, rng, sitPose, type PersonLook } from './kit';

/**
 * Cabine (m) : le véhicule roule vers −z. Bus : la caméra est dans l'allée, deux rangées devant le joueur, tournée vers
 * l'arrière : on voit son visage, ses voisins et la rue par les vitres. Taxi : la caméra est au tableau de bord, tournée vers la
 * banquette arrière où le joueur est assis derrière le chauffeur.
 */
export type RideVehicle = 'bus' | 'taxi';
interface RideCfg {
  cabin: { w: number; h: number; z0: number; z1: number };
  rows: { z: number; xs: number[] }[];
  seatTop: number;
  camY: number;
  /** Place du joueur : rangée et colonne. */
  player: { row: number; x: number };
  /** Places toujours occupées (chauffeur), en plus des passagers tirés au hasard. */
  forced: { row: number; x: number }[];
  /** Nombre de rangées devant le joueur laissées libres, et part des places remplies au hasard. */
  clearAhead: number;
  fill: number;
  standing: number[];
  poles: number[];
  body: number;
  seat: number;
  seatBack: number;
  stops: boolean;
  cruise: number;
  /** Échelle des personnages (l'habitacle d'un taxi est plus petit que celui d'un bus). */
  person: number;
}
const BUS_ROWS = [-3.6, -2.75, -1.9, -1.05, -0.2, 0.65, 1.5, 2.35, 3.2, 4.05];
const BUS_X = [-1.0, -0.55, 0.55, 1.0];
const BUS: RideCfg = {
  cabin: { w: 2.5, h: 2.3, z0: -5.2, z1: 5.2 },
  rows: BUS_ROWS.map((z) => ({ z, xs: BUS_X })),
  seatTop: 0.62,
  camY: 1.8,
  player: { row: 4, x: 3 },
  forced: [],
  clearAhead: 2,
  fill: 0.38,
  standing: [-3.6, 2.4, 3.8],
  poles: [-2.3, 0.2, 2.8],
  body: 0x1f5fae,
  seat: 0x264f8f,
  seatBack: 0x1d3f74,
  stops: true,
  cruise: 8,
  person: 1,
};
const TAXI: RideCfg = {
  cabin: { w: 1.9, h: 1.45, z0: -1.9, z1: 1.9 },
  rows: [{ z: -0.5, xs: [-0.45] }, { z: 0.95, xs: [-0.6, 0, 0.6] }],
  seatTop: 0.5,
  camY: 1.0,
  player: { row: 1, x: 2 },
  forced: [{ row: 0, x: 0 }],
  clearAhead: 0,
  fill: 0,
  standing: [],
  poles: [],
  body: 0xffce00,
  seat: 0x5a4a3a,
  seatBack: 0x4a3c2e,
  stops: false,
  cruise: 10,
  person: 0.74,
};
/** Décor extérieur recyclé le long de la route (z de −SPAN à +SPAN). */
const SPAN = 70;
const SIDE_ITEMS = 26;
const WALLS = [0xffffff, 0xfdf3dc, 0xdbe9fb, 0xffe7a3, 0xd8f0e2, 0xfadde1, 0xf3efe6];
const ROOFS = [0x8a96a6, 0xb4552d, 0x9aa5b4, 0x3d7bd9, 0xc96a3b];

interface Rider {
  g: THREE.Group;
  phase: number;
  standing: boolean;
}

/**
 * Trajet en bus vu de l'intérieur : sièges, autres passagers, le personnage assis côté fenêtre et la rue
 * qui défile derrière les vitres. Le bus accélère, roule, freine et marque des arrêts ; la cabine tangue.
 * Purement visuel : le trajet lui-même (durée, arrivée) reste calculé par la ville.
 */
export class BusRide {
  private readonly cfg: RideCfg;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 160);
  private readonly profile: QualityProfile;
  private readonly mats: Materials;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly ownMats: THREE.Material[] = [];
  private readonly riders: Rider[] = [];
  private player: THREE.Group | null = null;
  /** Repère rouge au-dessus du joueur (le même qu'en ville), pour le retrouver parmi les passagers. */
  private youArrow: THREE.Mesh | null = null;
  private readonly resizeObs: ResizeObserver;
  private readonly tmp = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Color(), e: new THREE.Euler() };
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly ceilingGlow: THREE.MeshBasicMaterial;
  private readonly outside = new THREE.Group();
  /** Orientation de la caméra au repos (le roulis s'ajoute par-dessus, autour de l'axe de visée). */
  private readonly baseQuat = new THREE.Quaternion();
  private readonly rollQuat = new THREE.Quaternion();
  private readonly viewAxis = new THREE.Vector3(0, 0, 1);
  private houses!: THREE.InstancedMesh;
  private roofs!: THREE.InstancedMesh;
  private crowns!: THREE.InstancedMesh;
  private trunks!: THREE.InstancedMesh;
  private dashes!: THREE.InstancedMesh;
  private readonly items: { z: number; side: 1 | -1; kind: 'house' | 'tree'; w: number; h: number; d: number; off: number }[] = [];
  private readonly dashZ: number[] = [];
  private readonly rand = rng(2024);
  private raf = 0;
  private last = 0;
  private t = 0;
  private speed = 0;
  /** Prochain arrêt (s de trajet) et fin de l'arrêt en cours. */
  private nextStop = 14;
  private stopUntil = 0;
  private disposed = false;
  getMinute: (() => number) | null = null;

  constructor(private readonly container: HTMLElement, quality: Quality, look: PersonLook, vehicle: RideVehicle = 'bus') {
    this.cfg = vehicle === 'taxi' ? TAXI : BUS;
    if (!this.cfg.stops) this.nextStop = 1e9;
    this.profile = PROFILES[quality];
    this.mats = new Materials(this.profile.standardMaterials);
    this.renderer = new THREE.WebGLRenderer({ antialias: this.profile.antialias, alpha: false, stencil: false });
    this.renderer.setPixelRatio(pixelRatioFor(quality));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.className = 'world-canvas';
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0xd6ecff);
    this.scene.fog = new THREE.Fog(0xd6ecff, 30, 90);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xb9a88a, 1.0);
    this.sun = new THREE.DirectionalLight(0xfff1d0, 0.9);
    this.sun.position.set(20, 30, -10);
    this.scene.add(this.hemi, this.sun);
    this.ceilingGlow = this.own(new THREE.MeshBasicMaterial({ color: 0xfff6dd }));

    this.buildCabin();
    this.buildRiders(look);
    this.buildOutside();
    if (this.player) {
      const arrow = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.09, 0.18, 12)), this.own(new THREE.MeshBasicMaterial({ color: 0xe5383b, depthTest: false, transparent: true })));
      arrow.rotation.x = Math.PI; // pointe vers le bas
      arrow.renderOrder = 10;
      this.scene.add(arrow);
      this.youArrow = arrow;
    }
    this.scene.add(this.outside);


    // Redessiner aussitôt après un redimensionnement : un canvas redimensionné est vide jusqu'à l'image suivante
    this.resizeObs = new ResizeObserver(() => {
      this.resize();
      if (!this.disposed) this.renderer.render(this.scene, this.camera);
    });
    this.resizeObs.observe(container);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  private own<T extends THREE.Material>(m: T): T {
    this.ownMats.push(m);
    return m;
  }

  private box(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, h, d)), this.mats.color(color));
    m.position.set(x, y, z);
    this.scene.add(m);
    return m;
  }

  /** Carrosserie intérieure : plancher, plafond lumineux, flancs percés de grandes vitres, barres de maintien. */
  private buildCabin(): void {
    const { w, h, z0, z1 } = this.cfg.cabin;
    const len = z1 - z0;
    const mid = (z0 + z1) / 2;
    this.box(w, 0.1, len, 0x4a5058, 0, -0.05, mid); // plancher
    this.box(0.5, 0.012, len, 0x6b7179, 0, 0.006, mid); // tapis de l'allée
    // Plafond clair (non éclairé : l'éclairage d'ambiance venu du sol le rendait brun)
    const ceiling = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, 0.08, len)), this.own(new THREE.MeshBasicMaterial({ color: 0xdfe4ea })));
    ceiling.position.set(0, h, mid);
    this.scene.add(ceiling);
    const strip = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.18, 0.03, len - 0.6)), this.ceilingGlow);
    strip.position.set(0, h - 0.05, mid);
    this.scene.add(strip);
    for (const sx of [-1, 1]) {
      const x = (sx * w) / 2;
      this.box(0.08, 0.92, len, this.cfg.body, x, 0.46, mid); // bas de caisse (bleu Sotral, jaune taxi)
      this.box(0.08, 0.36, len, 0xf4f6f8, x, h - 0.18, mid); // bandeau haut
      // Montants entre les vitres
      for (let z = z0; z <= z1 + 0.01; z += len / (this.cfg.stops ? 6 : 3)) this.box(0.1, h, 0.12, 0xd9dde2, x, h / 2, z);
      // Vitres : verre très léger, la rue se voit au travers
      const glass = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(len, h - 0.36 - 0.92)), this.own(new THREE.MeshBasicMaterial({ color: 0xcfe6f5, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })));
      glass.position.set(x, 0.92 + (h - 1.28) / 2, mid);
      glass.rotation.y = Math.PI / 2;
      this.scene.add(glass);
      // Barre de maintien longitudinale au-dessus des sièges
      if (this.cfg.stops) {
        const rail = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.02, 0.02, len - 0.4, 8)), this.mats.color(0xc8ccd2));
        rail.rotation.x = Math.PI / 2;
        rail.position.set(sx * 0.32, h - 0.25, mid);
        this.scene.add(rail);
      }
    }
    this.box(w, h, 0.08, 0xf4f6f8, 0, h / 2, z1); // cloison arrière
    // Poteaux verticaux dans l'allée
    for (const z of this.cfg.poles) {
      const pole = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.025, 0.025, h, 8)), this.mats.color(0xffce00));
      pole.position.set(0.3, h / 2, z);
      this.scene.add(pole);
    }
    // Sièges (assise + dossier), en instances
    const top = this.cfg.seatTop;
    const n = this.cfg.rows.reduce((a, r) => a + r.xs.length, 0);
    const seat = new THREE.InstancedMesh(this.geo(new THREE.BoxGeometry(0.42, 0.1, 0.42)), this.mats.color(this.cfg.seat), n);
    const back = new THREE.InstancedMesh(this.geo(new THREE.BoxGeometry(0.42, 0.55, 0.08)), this.mats.color(this.cfg.seatBack), n);
    const legs = new THREE.InstancedMesh(this.geo(new THREE.BoxGeometry(0.05, top - 0.05, 0.05)), this.mats.color(0x8d939b), n);
    let i = 0;
    for (const row of this.cfg.rows) {
      for (const x of row.xs) {
        this.place(seat, i, x, top - 0.05, row.z);
        this.place(back, i, x, top + 0.27, row.z + 0.2);
        this.place(legs, i, x * 0.92, (top - 0.05) / 2, row.z);
        i++;
      }
    }
    if (!this.cfg.stops) {
      // Taxi : tableau de bord et pare-brise devant, volant devant le chauffeur
      this.box(w, 0.22, 0.3, 0x2b2f36, 0, 0.62, z0 + 0.15);
      const wind = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(w, h - 0.95)), this.own(new THREE.MeshBasicMaterial({ color: 0xcfe6f5, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })));
      wind.position.set(0, 0.95 + (h - 0.95) / 2, z0);
      this.scene.add(wind);
      const wheel = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.17, 0.02, 8, 18)), this.mats.color(0x1b1d21));
      wheel.position.set(-0.45, 0.92, z0 + 0.7);
      wheel.rotation.x = -0.9;
      this.scene.add(wheel);
      // Enseigne « TAXI » sur le toit, vue de l'intérieur par le plafond : un liseré damier jaune et noir le long des flancs
      for (const sx of [-1, 1]) this.box(0.05, 0.1, len, 0x111111, (sx * w) / 2, h - 0.5, mid);
    }
    this.scene.add(seat, back, legs);
  }

  private place(m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): void {
    const t = this.tmp;
    t.m.compose(t.p.set(x, y, z), t.q.identity(), t.s.set(sx, sy, sz));
    m.setMatrixAt(i, t.m);
  }

  /** Passagers : la plupart assis tournés vers l'avant, quelques-uns debout dans l'allée ; le joueur côté fenêtre. */
  private buildRiders(look: PersonLook): void {
    const r = this.rand;
    const cfg = this.cfg;
    cfg.rows.forEach((rowCfg, row) => {
      rowCfg.xs.forEach((x, k) => {
        const isPlayer = row === cfg.player.row && k === cfg.player.x;
        const forced = cfg.forced.some((f) => f.row === row && f.x === k);
        // Les rangées entre la caméra et le joueur restent libres : rien ne le cache.
        const inFront = row < cfg.player.row && row >= cfg.player.row - cfg.clearAhead;
        if (!isPlayer && !forced && (inFront || r() > cfg.fill)) return;
        const g = buildPerson(this.mats, isPlayer ? look : randomLook(r));
        sitPose(g);
        // Jambes descendant vers le plancher (la pose du kit les tend à l'horizontale : les pieds
        // traverseraient le dossier de devant, la rangée étant serrée).
        for (const n of ['legL', 'legR']) {
          const leg = g.getObjectByName(n);
          if (leg) leg.rotation.x = -0.85;
        }
        if (isPlayer) this.player = g;
        g.scale.setScalar(cfg.person);
        g.position.set(x, cfg.seatTop - 0.8 * cfg.person, rowCfg.z - 0.02);
        g.rotation.y = Math.PI; // face à l'avant (−z)
        this.scene.add(g);
        this.riders.push({ g, phase: r() * 6, standing: false });
      });
    });
    for (const z of cfg.standing) {
      if (r() < 0.25) continue;
      const g = buildPerson(this.mats, randomLook(r));
      g.position.set(0.05 + (r() - 0.5) * 0.15, 0, z);
      g.rotation.y = Math.PI + (r() - 0.5) * 0.8;
      this.scene.add(g);
      this.riders.push({ g, phase: r() * 6, standing: true });
    }
  }

  /** Rue de part et d'autre : chaussée, trottoirs, maisons et arbres recyclés au fil du trajet. */
  private buildOutside(): void {
    const road = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(16, SPAN * 2)), this.mats.color(0x5b5f66));
    road.rotation.x = -Math.PI / 2;
    road.position.y = -0.62;
    this.outside.add(road);
    for (const sx of [-1, 1]) {
      const verge = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(40, SPAN * 2)), this.mats.color(0xc9a46e));
      verge.rotation.x = -Math.PI / 2;
      verge.position.set(sx * 28, -0.6, 0);
      this.outside.add(verge);
    }
    this.dashes = new THREE.InstancedMesh(this.geo(new THREE.BoxGeometry(0.15, 0.02, 2)), this.mats.color(0xffffff), 24);
    for (let i = 0; i < 24; i++) this.dashZ.push(-SPAN + (i * 2 * SPAN) / 24);
    this.houses = new THREE.InstancedMesh(this.geo(new THREE.BoxGeometry(1, 1, 1)), this.mats.color(0xffffff), SIDE_ITEMS);
    this.roofs = new THREE.InstancedMesh(this.geo(new THREE.BoxGeometry(1, 1, 1)), this.mats.color(0xffffff), SIDE_ITEMS);
    this.crowns = new THREE.InstancedMesh(this.geo(new THREE.SphereGeometry(1, 10, 8)), this.mats.color(0x3f8f45), SIDE_ITEMS);
    this.trunks = new THREE.InstancedMesh(this.geo(new THREE.CylinderGeometry(0.15, 0.2, 1, 6)), this.mats.color(0x6b4a2e), SIDE_ITEMS);
    for (const m of [this.dashes, this.houses, this.roofs, this.crowns, this.trunks]) {
      m.frustumCulled = false;
      this.outside.add(m);
    }
    for (let i = 0; i < SIDE_ITEMS; i++) {
      this.items.push({ z: -SPAN + (i * 2 * SPAN) / SIDE_ITEMS, side: i % 2 ? 1 : -1, kind: 'house', w: 0, h: 0, d: 0, off: 0 });
      this.reroll(i);
    }
  }

  /** Nouvel élément de décor (maison ou arbre) quand l'ancien est passé derrière le bus. */
  private reroll(i: number): void {
    const r = this.rand;
    const it = this.items[i]!;
    it.kind = r() < 0.65 ? 'house' : 'tree';
    it.w = 4 + r() * 4;
    it.d = 4 + r() * 3;
    it.h = it.kind === 'house' ? 2.8 * (r() < 0.3 ? 2 : 1) + r() * 0.6 : 2.5 + r() * 2;
    it.off = 9 + r() * 6;
    this.houses.setColorAt(i, this.tmp.c.setHex(WALLS[Math.floor(r() * WALLS.length)]!));
    this.roofs.setColorAt(i, this.tmp.c.setHex(ROOFS[Math.floor(r() * ROOFS.length)]!));
    if (this.houses.instanceColor) this.houses.instanceColor.needsUpdate = true;
    if (this.roofs.instanceColor) this.roofs.instanceColor.needsUpdate = true;
  }

  private updateOutside(dz: number): void {
    const hidden = 0.0001;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]!;
      it.z += dz;
      if (it.z > SPAN) {
        it.z -= 2 * SPAN;
        this.reroll(i);
      }
      const x = it.side * it.off;
      const house = it.kind === 'house';
      this.place(this.houses, i, x, -0.6 + it.h / 2, it.z, house ? it.w : hidden, house ? it.h : hidden, house ? it.d : hidden);
      this.place(this.roofs, i, x, -0.6 + it.h + 0.15, it.z, house ? it.w + 0.4 : hidden, house ? 0.3 : hidden, house ? it.d + 0.4 : hidden);
      this.place(this.trunks, i, x, -0.6 + (house ? 0 : it.h / 2), it.z, house ? hidden : 1, house ? hidden : it.h, house ? hidden : 1);
      this.place(this.crowns, i, x, -0.6 + it.h + 1, it.z, house ? hidden : 1.6, house ? hidden : 1.4, house ? hidden : 1.6);
    }
    for (let i = 0; i < this.dashZ.length; i++) {
      let z = this.dashZ[i]! + dz;
      if (z > SPAN) z -= 2 * SPAN;
      this.dashZ[i] = z;
      this.place(this.dashes, i, -1.6, -0.6, z);
    }
    for (const m of [this.houses, this.roofs, this.crowns, this.trunks, this.dashes]) m.instanceMatrix.needsUpdate = true;
  }

  /** Lumière selon l'heure : jour clair, soir orangé, nuit sombre avec l'éclairage de la cabine. */
  private applyDaylight(): void {
    const minute = this.getMinute?.() ?? 720;
    const day = Math.max(0, Math.min(1, Math.min((minute - 330) / 90, (1170 - minute) / 90)));
    const bg = this.scene.background as THREE.Color;
    bg.setHex(0x101b3c).lerp(this.tmp.c.setHex(0xd6ecff), day);
    (this.scene.fog as THREE.Fog).color.copy(bg);
    this.sun.intensity = 0.15 + day * 0.9;
    this.hemi.intensity = 0.55 + day * 0.5;
    this.ceilingGlow.color.setHex(day > 0.5 ? 0xf2f4f6 : 0xfff2c8);
  }

  private readonly loop = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const minDt = 1000 / this.profile.maxFps;
    if (this.last && now - this.last < minDt - 1) return;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this.t += dt;
    // Conduite : arrêts réguliers, sinon vitesse de croisière avec de légères variations
    let target = this.cfg.cruise + Math.sin(this.t * 0.35) * 2;
    if (this.t >= this.nextStop && this.stopUntil === 0) this.stopUntil = this.t + 4;
    if (this.stopUntil > 0) {
      target = 0;
      if (this.t > this.stopUntil) {
        this.stopUntil = 0;
        this.nextStop = this.t + 16 + this.rand() * 10;
      }
    }
    const accel = target > this.speed ? 1.6 : -3;
    const prev = this.speed;
    this.speed = Math.max(0, accel > 0 ? Math.min(target, this.speed + accel * dt) : Math.max(target, this.speed + accel * dt));
    const longit = dt > 0 ? (this.speed - prev) / dt : 0;
    this.updateOutside(this.speed * dt);
    // Tangage et roulis : la cabine bouge avec la route, plus fort en roulant ; on bascule au freinage.
    const shake = Math.min(1, this.speed / 8);
    const bob = Math.sin(this.t * 7.3) * 0.012 * shake + Math.sin(this.t * 2.1) * 0.008 * shake;
    const roll = Math.sin(this.t * 1.3) * 0.012 * shake;
    this.camera.position.y = this.cfg.camY + bob;
    this.camera.quaternion.copy(this.baseQuat).multiply(this.rollQuat.setFromAxisAngle(this.viewAxis, roll));
    for (const rd of this.riders) {
      const sway = Math.sin(this.t * 1.3 + rd.phase * 0.2) * 0.03 * shake - longit * 0.012;
      rd.g.rotation.x = sway * 0.5;
      rd.g.rotation.z = Math.sin(this.t * 1.3 + rd.phase) * 0.02 * shake;
      if (rd.standing) animateWalk(rd.g, 0, 0);
    }
    if (this.youArrow && this.player) {
      const p = this.player.position;
      this.youArrow.position.set(p.x, (this.cfg.stops ? 1.92 : 1.2) + Math.sin(this.t * 3) * 0.04, p.z);
    }
    this.applyDaylight();
    this.renderer.render(this.scene, this.camera);
  };

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // En portrait, champ plus large pour voir les deux rangées de sièges
    this.camera.fov = w < h ? 78 : 62;
    this.camera.updateProjectionMatrix();
    // Cadrage sur la place du joueur ; en portrait (champ étroit), on se tourne davantage vers lui.
    const pRow = this.cfg.rows[this.cfg.player.row]!;
    const seatZ = pRow.z;
    const seatX = pRow.xs[this.cfg.player.x]!;
    if (this.cfg.stops) {
      this.camera.position.set(0.05, this.cfg.camY, seatZ - 2.4);
      this.camera.lookAt(seatX * (w < h ? 0.85 : 0.5), 1.0, seatZ + 1.4);
    } else {
      // Taxi : du tableau de bord, face à la banquette arrière
      this.camera.position.set(0.15, this.cfg.camY + 0.05, this.cfg.cabin.z0 + 0.65);
      this.camera.lookAt(seatX * (w < h ? 0.7 : 0.5), 0.7, seatZ);
    }
    this.baseQuat.copy(this.camera.quaternion);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    // Géométries des passagers (construites par le kit) comprises
    const all = new Set<THREE.BufferGeometry>(this.geos);
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) all.add(o.geometry);
    });
    all.forEach((g) => g.dispose());
    this.ownMats.forEach((m) => m.dispose());
    this.mats.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
