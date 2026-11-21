// Intérieurs : la maison du joueur (selon son logement) et les lieux couverts (maquis, hôpital, université, guichets).
// Pièce vue de trois quarts, murs du fond seulement, figurants installés ; on s'y déplace en touchant le sol.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Quality } from '../lib/prefs';
import { furnitureParts } from './furniture';
import { PROFILES, pixelRatioFor, type QualityProfile } from './quality';
import { animateWalk, buildPerson, Materials, randomLook, rng, sitPose, type PersonLook } from './kit';
import { buildStation, poseArms, restArms, type Station } from './workstation';
import { Consultation, CONSULT_EVENT, Ward, type ConsultDetail } from './Clinic';
import { Worship, WORSHIP_EVENT, type SacredLayout, type WorshipAct } from './Worship';

export type InteriorKind = 'ENTRER_COUCHER' | 'CHAMBRE_SALON' | 'VILLA' | 'maquis' | 'clinic' | 'campus' | 'office' | 'studio' | 'studioPhoto' | 'shop' | 'church' | 'mosque' | 'hotel';

/** Lieux qui ont un intérieur ; les autres se vivent dans la rue. */
/** Événement émis après un repos réussi : la scène montre le personnage couché. */
export const SLEEP_EVENT = 'agbe:sleep';
/** Activité de loisir en cours (télé, lecture, musique) : le jeu l'affiche et propose « Arrêter » ; on s'arrête quand on veut. */
export const HOME_ACT_STATE = 'agbe:homeActState';
export const HOME_STOP_EVENT = 'agbe:homeStop';
/** Action de la maison jouée par le personnage (détail : HomeAct) : il va s'asseoir, se doucher, manger… */
export const HOME_ACT_EVENT = 'agbe:homeAct';
export type HomeAct = 'tv' | 'read' | 'music' | 'wash' | 'eat' | 'nap' | 'cook';
/** Cuisson réussie (détail : CookDetail) : il va au réchaud, fait cuire le plat, puis le mange à table. */
/** Le joueur danse sur la piste du maquis (quelques secondes). */
export const DANCE_EVENT = 'agbe:dance';
export const COOK_EVENT = 'agbe:cook';
export interface CookDetail {
  fuel: 'GAS' | 'CHARCOAL' | 'ELECTRIC';
  foodId: string;
}
type Spot = { x: number; z: number; rot: number; y: number };

/** Décor de marque d'un intérieur de partenaire : couleur, nom, logo et articles à vendre (étals touchables). */
export interface InteriorBrand {
  label: string;
  color: string;
  model: string;
  logo?: string | null;
  articles: { emoji: string; name: string; price: string }[];
}

export const INTERIOR_OF: Record<string, InteriorKind> = {
  maquis_be: 'maquis',
  deckon: 'maquis',
  chu: 'clinic',
  universite: 'campus',
  cnss: 'office',
  kiosque_momo: 'office',
  boutique: 'shop',
  studio_ori_infos: 'studio',
  capture_media: 'studioPhoto',
  supermarche: 'shop',
  epicerie: 'shop',
  cathedrale: 'church',
  grande_mosquee: 'mosque',
  hotel_2fevrier: 'hotel',
};

/** Intérieur d'un lieu de partenaire selon le modèle de son bâtiment (enregistré au chargement dans INTERIOR_OF). */
export const BRAND_INTERIOR: Record<string, InteriorKind> = { restaurant: 'maquis', clinic: 'clinic', shop: 'shop', station: 'shop', hotel: 'hotel', tower: 'office', agency: 'office', transport: 'office' };

const ROOM: Record<InteriorKind, { w: number; d: number; wall: number; floor: [number, number] }> = {
  ENTRER_COUCHER: { w: 7, d: 7, wall: 0xe9dcc3, floor: [0xb7a68a, 0xa8977b] },
  CHAMBRE_SALON: { w: 11, d: 9, wall: 0xf3d9a4, floor: [0xd8c3a0, 0xcbb592] },
  VILLA: { w: 22, d: 16, wall: 0xffffff, floor: [0xeef1f5, 0xe2e7ee] },
  maquis: { w: 18, d: 14, wall: 0xffe7a3, floor: [0xc9b28c, 0xbca37b] },
  clinic: { w: 16, d: 12, wall: 0xeaf6ef, floor: [0xf4f6f8, 0xe6eaee] },
  campus: { w: 18, d: 14, wall: 0xfdf3dc, floor: [0xd9cdb6, 0xcdbfa6] },
  office: { w: 14, d: 10, wall: 0xdbe9fb, floor: [0xeef1f5, 0xe2e7ee] },
  // Plateaux de média : studio d'émission sombre et insonorisé (Ori-Infos), studio photo-vidéo à fond blanc (Capture Média)
  studio: { w: 18, d: 13, wall: 0x2b3050, floor: [0x3a3f52, 0x333849] },
  studioPhoto: { w: 18, d: 13, wall: 0xf1f3f6, floor: [0xe2e4e9, 0xd9dce2] },
  shop: { w: 16, d: 12, wall: 0xf7f3ea, floor: [0xf2f2f2, 0xe4e4e4] },
  church: { w: 22, d: 18, wall: 0xf4ecdc, floor: [0xcfc2a8, 0xc2b497] },
  mosque: { w: 22, d: 18, wall: 0xfbfaf3, floor: [0xe9e4d3, 0xded8c4] },
  // Hall d'hôtel de luxe : marbre clair en damier, murs crème chaud
  hotel: { w: 20, d: 14, wall: 0xf1e6d0, floor: [0xf3efe7, 0xd9d0c1] },
};

export class Interior {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly profile: QualityProfile;
  private readonly mats: Materials;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly player: THREE.Group;
  private readonly extras: { g: THREE.Group; phase: number; home: THREE.Vector3; target: THREE.Vector3; speed: number }[] = [];
  private readonly target = new THREE.Vector3();
  private joy = { x: 0, y: 0 };
  /** Emprises au sol des meubles et murs (demi-tailles) : personne ne les traverse. */
  private readonly blocks: { x: number; z: number; hw: number; hd: number; lvl: number; furn?: string }[] = [];
  /** Villa à étages : un groupe par niveau, un seul affiché à la fois (vue en coupe) ; escaliers = plaques qui changent de niveau. */
  private readonly levels: THREE.Group[] = [];
  private level = 0;
  private buildLevel = 0;
  private bedLevel = 0;
  private readonly lamps: THREE.PointLight[] = [];
  private pads: { level: number; x: number; z: number; to: number; ax: number; az: number; zone: { x0: number; x1: number; z0: number; z1: number } }[] = [];
  private padCool = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly resizeObs: ResizeObserver;
  private readonly half: { w: number; d: number };
  private raf = 0;
  private last = 0;
  private phase = 0;
  /** Lit de la pièce (pour la scène de sommeil) et fin du sommeil en cours (ms, horloge de l'écran). */
  private bedSpot: { x: number; z: number; y: number } | null = null;
  /** Places où le personnage joue ses actions : canapé (télé, lecture), chaise de table (repas), douche. */
  private readonly spots: { sofa?: Spot; table?: Spot; shower?: Spot; stove?: Spot } = {};
  /** Plaque de cuisson : où la marmite se pose (x, z, hauteur), et le combustible de la cuisson en cours. */
  private groundAO = false;
  private hob: { x: number; z: number; y: number } | null = null;
  private cookFuel: CookDetail['fuel'] = 'GAS';
  private tvScreen: THREE.MeshLambertMaterial | null = null;
  /** Image animée de la télé : plusieurs chaînes (journal, football, clip) qui défilent pendant qu'on la regarde. */
  private tvCanvas: { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; last: number; slot: number; flash: number; idle: boolean } | null = null;
  private act: { kind: HomeAct; spot: Spot; doing: boolean; started: number; until: number; props: THREE.Object3D[] } | null = null;
  private sleepUntil = 0;
  /** Hôpital : consultation illustrée en cours, et salle d'hospitalisation (patient alité, soignants qui passent). */
  private consultation: Consultation | null = null;
  private ward: Ward | null = null;
  private wardOn = false;
  private consultDone: (() => void) | null = null;
  /** Transition de coucher (down) ou de lever (up) en cours : le personnage ne se téléporte plus sur le lit. */
  private bedAnim: { kind: 'down' | 'up'; t0: number; dur: number; from: THREE.Vector3 } | null = null;
  private hemi!: THREE.HemisphereLight;
  private key!: THREE.DirectionalLight;
  private lampBase = 1.4;
  private lastDaylight = 0;
  /** Heure de jeu (minutes depuis minuit), pour la lumière du jour et la lampe de nuit. */
  getMinute: (() => number) | null = null;
  private zzz: THREE.Sprite | null = null;
  private disposed = false;
  private downAt: { x: number; y: number } | null = null;
  /** Caméra orbitale : azimut, élévation (rad) et zoom ; glisser la fait tourner autour de la pièce. */
  private camAz = Math.atan2(0.55, 0.75);
  private camEl = Math.atan2(0.8, Math.hypot(0.55, 0.75));
  private camZoom = 1;
  private camBase = 10;
  private dragging = false;
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  /** Murs extérieurs : ceux qui se trouvent entre la caméra et la pièce disparaissent (coupe façon maison de poupée). */
  private walls: { m: THREE.Object3D; side: 'N' | 'S' | 'E' | 'W' }[] = [];
  /** Appelé quand le personnage s'approche de la porte : on sort. Armé seulement après s'en être éloigné. */
  onExit: (() => void) | null = null;
  private exitArmed = false;
  private readonly rand = rng(99);
  /** Poste de travail du joueur dans la pièce (comptoir, bureau…), les clients entrent par la porte et viennent à lui. */
  private work: { st: Station; x: number; z: number; yaw: number; act: { t: number; dur: number; wait: number; done: () => void } | null } | null = null;
  private customer: { g: THREE.Group; phase: number; arrived: boolean } | null = null;
  private leavers: { g: THREE.Group; phase: number; t: number }[] = [];
  private customerSeed = 1;
  private readonly roomKind: InteriorKind;
  /** Itinéraire contournant les cloisons et meubles jusqu'à `target` (points de passage), recalculé quand la cible change. */
  private route: { x: number; z: number }[] = [];
  private readonly routeFor = new THREE.Vector3(1e9, 0, 1e9);
  private readonly disposables: THREE.Material[] = [];
  /** Repères du lieu de culte (bancs, tapis, tronc, cierges) et office en cours. */
  private sacred: SacredLayout | null = null;
  private worship: Worship | null = null;
  /** Maquis : piste de danse éclairée (lumières colorées, boule à facettes) et danseurs ; le joueur peut y danser. */
  private disco: { spots: { light: THREE.SpotLight; beam: THREE.Mesh; c: number; floor: boolean }[]; led: THREE.MeshBasicMaterial[]; ball: THREE.Mesh; dancers: { g: THREE.Group; phase: number; base: number }[]; dj: THREE.Group | null; discs: THREE.Mesh[]; cx: number; cz: number; lift: number; pw: number; pd: number } | null = null;
  private dance: { t0: number; dur: number; arrived: boolean } | null = null;
  private readonly onDance = (): void => {
    if (!this.disco || this.dance || this.worship || this.consultation || this.act || this.sleepUntil) return;
    this.dance = { t0: 0, dur: 9000, arrived: false };
  };
  private readonly onWorship = (e: Event): void => {
    if (!this.sacred || this.worship || this.act || this.sleepUntil) return;
    this.worship = new Worship({
      scene: this.scene,
      mats: this.mats,
      player: this.player,
      layout: this.sacred,
      rand: this.rand,
      route: (a, b) => this.findRoute(a, b),
      stepTo: (pos, sx, sz) => this.stepTo(pos, sx, sz),
      label: (text, color, x, y, z) => this.label(text, color, x, y, z),
    });
    this.worship.start((e as CustomEvent<WorshipAct>).detail);
  };

  constructor(container: HTMLElement, quality: Quality, kind: InteriorKind, look: PersonLook, private readonly open = true, private readonly brand: InteriorBrand | null = null, private readonly custom = false) {
    this.roomKind = kind;
    this.container = container;
    this.profile = PROFILES[quality];
    this.mats = new Materials(this.profile.standardMaterials);
    this.renderer = new THREE.WebGLRenderer({ antialias: this.profile.antialias, alpha: false, stencil: false });
    this.renderer.setPixelRatio(pixelRatioFor(quality));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.profile.shadows;
    this.renderer.domElement.className = 'world-canvas';
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0xe9eef5);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    const room = ROOM[kind];
    this.half = { w: room.w / 2, d: room.d / 2 };
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 200);

    // Lumière ambiante un peu plus basse qu'avant (1,0) : les ombres du personnage et des meubles se lisent mieux dans la pièce
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xd8c8a8, 0.82);
    this.scene.add(this.hemi);
    const key = new THREE.DirectionalLight(0xfff3dc, 0.9);
    this.key = key;
    key.position.set(-8, 16, 10);
    key.castShadow = this.profile.shadows;
    if (this.profile.shadows) {
      key.shadow.mapSize.set(this.profile.shadowMapSize, this.profile.shadowMapSize);
      Object.assign(key.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
      // Ombres propres et douces : le personnage et les meubles se détachent du sol, sans moirage
      key.shadow.bias = -0.0003;
      key.shadow.normalBias = 0.03;
      key.shadow.radius = 3;
    }
    this.scene.add(key);

    if (kind === 'VILLA') this.buildVilla(room);
    else {
      this.buildRoom(room);
      this.groundAO = true;
      this.furnish(kind);
      if (this.brand) this.furnishBrand(this.brand);
      this.dress(kind);
      this.groundAO = false;
      this.mergeStatic(this.scene);
    }
    this.collectWalls();

    this.player = buildPerson(this.mats, look);
    // On apparaît juste derrière la porte d'entrée, tourné vers la pièce
    this.player.position.set(-this.half.w + 1.2, 0, this.half.d - 1.2);
    this.player.rotation.y = Math.PI / 2;
    this.target.copy(this.player.position);
    this.scene.add(this.player);

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener(SLEEP_EVENT, this.onSleep);
    window.addEventListener(HOME_ACT_EVENT, this.onAct);
    window.addEventListener(COOK_EVENT, this.onCook);
    window.addEventListener(HOME_STOP_EVENT, this.onStop);
    window.addEventListener(WORSHIP_EVENT, this.onWorship);
    window.addEventListener(CONSULT_EVENT, this.onConsult);
    window.addEventListener(DANCE_EVENT, this.onDance);
    // Redimensionner le canvas efface son image : on redessine aussitôt (le callback passe avant l'affichage),
    // sinon la pièce clignote jusqu'à l'image suivante de la boucle.
    this.resizeObs = new ResizeObserver(() => {
      this.resize();
      if (!this.disposed) this.renderer.render(this.scene, this.camera);
    });
    this.resizeObs.observe(container);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
    if (import.meta.env.DEV) (window as unknown as { __agbeInterior?: unknown }).__agbeInterior = this; // diagnostic en développement
  }

  /**
   * Décor immobile regroupé par matériau : quelques centaines de caisses, rayons et carreaux deviennent
   * une dizaine d'objets, dessinés (et projetés en ombre) en une fois chacun.
   */
  private mergeStatic(parent: THREE.Object3D): void {
    const groups = new Map<string, THREE.Mesh[]>();
    for (const o of [...parent.children]) {
      if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) continue;
      const g = o.geometry;
      if (!g.index || !g.getAttribute('normal') || !g.getAttribute('uv')) continue;
      const side = this.wallSide(o);
      if (side) o.userData.side = side;
      const key = `${o.material.uuid}|${o.castShadow ? 1 : 0}|${o.receiveShadow ? 1 : 0}|${side ?? ''}`;
      const list = groups.get(key);
      if (list) list.push(o);
      else groups.set(key, [o]);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrixWorld();
        const geo = m.geometry.clone();
        for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
        return geo.applyMatrix4(m.matrixWorld);
      });
      const merged = mergeGeometries(geos, false);
      geos.forEach((geo) => geo.dispose());
      if (!merged) continue;
      const first = list[0]!;
      const mesh = new THREE.Mesh(this.geo(merged), first.material);
      mesh.castShadow = first.castShadow;
      mesh.receiveShadow = first.receiveShadow;
      if (first.userData.side) mesh.userData.side = first.userData.side;
      for (const m of list) parent.remove(m);
      parent.add(mesh);
    }
  }

  /** Côté du mur extérieur auquel appartient un élément mince collé contre lui (mur, plinthe, fenêtre, porte, tableau…). */
  private wallSide(o: THREE.Mesh): 'N' | 'S' | 'E' | 'W' | null {
    o.updateMatrixWorld();
    const b = new THREE.Box3().setFromObject(o);
    const s = b.getSize(new THREE.Vector3());
    const c = b.getCenter(new THREE.Vector3());
    const { w, d } = this.half;
    const long = (a: number, other: number) => a > 0.3 || other > 0.3;
    if (s.x < 0.32 && long(s.z, s.y) && c.x < -w + 0.45 && c.x > -w - 0.3) return 'W';
    if (s.x < 0.32 && long(s.z, s.y) && c.x > w - 0.45 && c.x < w + 0.3) return 'E';
    if (s.z < 0.32 && long(s.x, s.y) && c.z < -d + 0.45 && c.z > -d - 0.3) return 'N';
    if (s.z < 0.32 && long(s.x, s.y) && c.z > d - 0.45 && c.z < d + 0.3) return 'S';
    return null;
  }

  /** Mémorise les éléments de mur (après regroupement) pour pouvoir les masquer selon la position de la caméra. */
  private collectWalls(): void {
    this.walls = [];
    this.scene.traverse((o) => {
      const side = o.userData.side as 'N' | 'S' | 'E' | 'W' | undefined;
      if (side) this.walls.push({ m: o, side });
    });
  }

  /** Un mur est visible seulement si la caméra est de son côté intérieur : les deux murs de devant s'effacent. */
  private updateWalls(): void {
    const { x, z } = this.camera.position;
    const { w, d } = this.half;
    for (const { m, side } of this.walls) m.visible = side === 'W' ? x > -w : side === 'E' ? x < w : side === 'N' ? z > -d : z < d;
  }

  /** Place la caméra sur son orbite autour de la pièce. */
  private placeCamera(): void {
    const r = this.camBase * this.camZoom;
    const ce = Math.cos(this.camEl);
    this.camera.position.set(r * ce * Math.sin(this.camAz), r * Math.sin(this.camEl), r * ce * Math.cos(this.camAz));
    this.camera.lookAt(0, 0.5, 0);
    this.updateWalls();
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  private box(w: number, h: number, d: number, color: number | THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, h, d)), typeof color === 'number' ? this.mats.color(color) : color);
    m.position.set(x, y, z);
    // Tout volume posé au sol et assez haut pour gêner le passage devient un obstacle
    if (y - h / 2 < 0.5 && y + h / 2 > 0.4) this.blocks.push({ x, z, hw: w / 2, hd: d / 2, lvl: this.buildLevel });
    m.castShadow = this.profile.shadows;
    m.receiveShadow = this.profile.shadows;
    this.scene.add(m);
    // Ombre douce au pied des meubles : ils se posent sur le sol au lieu de flotter
    if (this.groundAO && y - h / 2 < 0.03 && h >= 0.3 && h <= 2.6 && w >= 0.3 && w <= 5 && d >= 0.3 && d <= 5) {
      const ao = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(1, 1)), this.mats.contactShadow());
      ao.rotation.x = -Math.PI / 2;
      ao.scale.set(w + 0.55, d + 0.55, 1);
      ao.position.set(x, 0.026, z);
      this.scene.add(ao);
    }
    return m;
  }

  /** Petit objet du quotidien (assiette, tasse, sandale…) : un cylindre posé à la hauteur voulue. */
  private cyl(r: number, h: number, color: number, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(r, r, h, 14)), this.mats.color(color));
    m.position.set(x, y, z);
    m.castShadow = this.profile.shadows;
    this.scene.add(m);
    return m;
  }

  /** Paire de sandales posée par terre (près de la porte, au pied du lit). */
  private sandals(x: number, z: number, rot: number, color: number): void {
    const g = new THREE.Group();
    for (const dx of [-0.14, 0.14]) {
      const sole = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.17, 0.035, 0.42)), this.mats.color(0x2a2a2a));
      sole.position.set(dx, 0.045, 0);
      const strap = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.17, 0.05, 0.14)), this.mats.color(color));
      strap.position.set(dx, 0.085, -0.04);
      g.add(sole, strap);
    }
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    this.scene.add(g);
  }

  /** Détails de vie : calendrier, photo de famille, radio, repas sur la table… la pièce n'a plus l'air d'un décor vide. */
  private dress(kind: InteriorKind): void {
    const { w, d } = this.half;
    const frame = (fw: number, fh: number, x: number, y: number, z: number, inner: number) => {
      this.box(fw, fh, 0.04, 0x2b1d12, x, y, z);
      this.box(fw - 0.12, fh - 0.12, 0.05, inner, x, y, z + 0.005);
    };
    const calendar = (x: number, z: number) => {
      this.box(0.5, 0.7, 0.03, 0xf7f3ea, x, 2.1, z);
      this.box(0.5, 0.16, 0.04, 0xd22d2d, x, 2.37, z);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) this.box(0.06, 0.05, 0.045, 0x777777, x - 0.15 + c * 0.1, 2.15 - r * 0.1, z + 0.004);
    };
    if (kind === 'ENTRER_COUCHER') {
      calendar(-1.8, -d + 0.14);
      frame(0.55, 0.42, -0.7, 2.05, -d + 0.14, 0x6a8caf);
      // Radio sur la valise
      this.box(0.42, 0.22, 0.18, 0x1d1d22, 1.6, 0.71, -d + 0.4);
      this.box(0.02, 0.4, 0.02, 0xb8bcc4, 1.78, 0.98, -d + 0.4);
      this.cyl(0.05, 0.02, 0xe5383b, 1.45, 0.83, -d + 0.31);
      this.sandals(-w + 2.1, d - 0.7, 0.2, 0x2f6fd0);
      this.sandals(-w + 3.2, -d + 3.5, -0.4, 0xd62839);
    } else if (kind === 'CHAMBRE_SALON') {
      calendar(-0.2, -d + 0.14);
      frame(0.6, 0.45, 0.6, 2.05, -d + 0.14, 0xc98f58);
      frame(0.45, 0.6, -w + 6.3, 2.0, -d + 0.14, 0x7fa35c);
      // Repas sur la table du salon : assiette, plat, tasse et pichet
      const tx = 2.2;
      const tz = 0.9;
      this.cyl(0.24, 0.03, 0xffffff, tx - 0.3, 1.07, tz - 0.15);
      const food = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.15, 10, 6)), this.mats.color(0xc47f2a));
      food.scale.y = 0.5;
      food.position.set(tx - 0.3, 1.1, tz - 0.15);
      this.scene.add(food);
      this.cyl(0.07, 0.13, 0x2f6fd0, tx + 0.3, 1.11, tz + 0.2);
      this.cyl(0.11, 0.24, 0xf0e6d2, tx + 0.15, 1.17, tz - 0.4);
      this.sandals(-w + 1.8, d - 0.7, 0.15, 0x2f6fd0);
      this.sandals(-w + 3.4, -d + 3.6, -0.3, 0x22a861);
      // Natte tressée sous la table, pagne plié au pied du lit
      this.cyl(1.35, 0.02, 0xc9a46a, tx, 0.06, tz);
      this.cyl(1.05, 0.022, 0xa97f4c, tx, 0.065, tz);
      this.box(0.9, 0.08, 0.5, this.mats.wax(2), -w + 2, 0.74, -d + 3.7);
      // Meuble télé : décodeur, télécommande, vase de fleurs
      this.box(0.45, 0.07, 0.3, 0x15161b, w - 2.7, 0.93, -d + 0.6);
      this.box(0.14, 0.03, 0.05, 0x15161b, w - 1.6, 0.92, -d + 0.95);
      this.cyl(0.09, 0.26, 0x1f6feb, w - 1.25, 1.03, -d + 0.45);
      for (let i = 0; i < 3; i++) this.cyl(0.015, 0.3, 0x2f8a4a, w - 1.25 + (i - 1) * 0.04, 1.3, -d + 0.45).rotation.z = (i - 1) * 0.25;
      for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.06, 8, 6)), this.mats.color([0xe5383b, 0xffce00, 0xff7aa8][i]!));
        f.position.set(w - 1.25 + (i - 1) * 0.1, 1.46 - Math.abs(i - 1) * 0.05, -d + 0.45);
        this.scene.add(f);
      }
      // Table de chevet : verre d'eau, téléphone en charge, photo encadrée
      this.cyl(0.05, 0.12, 0xdbeaf5, -w + 3.85, 0.93, -d + 2.55);
      this.box(0.1, 0.02, 0.18, 0x15161b, -w + 4.2, 0.88, -d + 2.5);
      this.box(0.18, 0.14, 0.02, 0x2b1d12, -w + 4.2, 0.97, -d + 2.95);
      // Miroir en pied près de l'armoire
      this.box(0.62, 1.5, 0.05, 0x7a5a3a, -w + 6.9, 1.2, -d + 0.14);
      this.box(0.5, 1.38, 0.055, 0xcfe4ef, -w + 6.9, 1.2, -d + 0.15);
      // Veilleuse de la chambre : lumière chaude et douce près du lit
      const nightLamp = new THREE.PointLight(0xffb36b, 0.9, 6, 1.8);
      nightLamp.position.set(-w + 4.05, 1.5, -d + 2.7);
      nightLamp.userData.k = 0.45;
      this.lamps.push(nightLamp);
      this.scene.add(nightLamp);
    }
  }

  private buildRoom(room: (typeof ROOM)[InteriorKind], entrance = true): void {
    const { w, d } = room;
    // Socle et carrelage en damier : joints visibles, nuances légères d'un carreau à l'autre
    this.box(w + 2, 0.6, d + 2, 0x8f9aa8, 0, -0.3, 0);
    this.box(w, 0.03, d, 0xb9b2a6, 0, 0.005, 0);
    const tile = this.geo(new THREE.BoxGeometry(0.95, 0.04, 0.95));
    const tr = rng(w * 31 + d);
    const shade = new THREE.Color();
    for (let x = 0; x < w; x++) {
      for (let z = 0; z < d; z++) {
        shade.setHex(room.floor[(x + z) % 2]!).offsetHSL(0, 0, (tr() - 0.5) * 0.04);
        const t = new THREE.Mesh(tile, this.mats.color(shade.getHex()));
        t.position.set(-w / 2 + x + 0.5, 0.02, -d / 2 + z + 0.5);
        t.receiveShadow = this.profile.shadows;
        this.scene.add(t);
      }
    }
    // Tapis en pagne au centre de la pièce
    const holy = this.roomKind === 'church' || this.roomKind === 'mosque';
    const media = this.roomKind === 'studio' || this.roomKind === 'studioPhoto' || this.roomKind === 'hotel'; // plateaux et hall d'hôtel : décor sobre, sans pagnes
    if (!holy && !media) this.box(Math.min(5, w * 0.4), 0.02, Math.min(3.4, d * 0.35), this.mats.wax(5), 0, 0.05, d / 8);
    // Murs du fond et de gauche (coupe façon maison de poupée)
    this.box(w, 4, 0.25, room.wall, 0, 2, -d / 2);
    this.box(0.25, 4, d, room.wall, -w / 2, 2, 0);
    this.box(w, 0.25, 0.3, 0xffffff, 0, 4, -d / 2);
    this.box(0.3, 0.25, d, 0xffffff, -w / 2, 4, 0);
    // Murs de droite et de devant : invisibles dans la vue par défaut, ils apparaissent quand on fait tourner la pièce
    this.box(0.25, 4, d, room.wall, w / 2, 2, 0);
    this.box(w, 4, 0.25, room.wall, 0, 2, d / 2);
    this.box(0.3, 0.25, d, 0xffffff, w / 2, 4, 0);
    this.box(w, 0.25, 0.3, 0xffffff, 0, 4, d / 2);
    // Paillasson vert devant la porte : s'en approcher fait sortir
    this.box(0.9, 0.03, 1.5, 0x22a861, -w / 2 + 0.75, 0.06, d / 2 - 1.2);
    // Soubassement plus foncé, cimaise et plinthes (finition des murs)
    const low = new THREE.Color(room.wall).multiplyScalar(0.82).getHex();
    this.box(w, 1.1, 0.04, low, 0, 0.55, -d / 2 + 0.145);
    this.box(0.04, 1.1, d, low, -w / 2 + 0.145, 0.55, 0);
    this.box(w, 0.07, 0.07, 0xffffff, 0, 1.12, -d / 2 + 0.16);
    this.box(0.07, 0.07, d, 0xffffff, -w / 2 + 0.16, 1.12, 0);
    this.box(w, 0.14, 0.06, 0x5b3a1e, 0, 0.07, -d / 2 + 0.16);
    this.box(0.06, 0.14, d, 0x5b3a1e, -w / 2 + 0.16, 0.07, 0);
    // Tableau en pagne encadré et horloge murale
    if (!holy && !media) {
      this.box(2.1, 1.3, 0.06, 0x3b2a1a, w / 6, 2.5, -d / 2 + 0.16);
      this.box(1.9, 1.1, 0.04, this.mats.wax(1), w / 6, 2.5, -d / 2 + 0.2);
    }
    const clock = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 20)), this.mats.color(0xffffff));
    clock.rotation.x = Math.PI / 2;
    clock.position.set(w / 2 - 2, 2.9, -d / 2 + 0.17);
    this.scene.add(clock);
    this.box(0.03, 0.2, 0.02, 0x222222, w / 2 - 2, 2.97, -d / 2 + 0.21);
    this.box(0.15, 0.03, 0.02, 0x222222, w / 2 - 1.94, 2.9, -d / 2 + 0.21);
    // Plantes dans les angles
    this.plant(w / 2 - 0.7, -d / 2 + 0.7);
    this.plant(-w / 2 + 0.7, -d / 2 + 0.7);
    // Porte d'entrée sur le mur de gauche, près de l'avant : on entre par là
    if (entrance) {
      this.box(0.1, 2.4, 1.3, 0x5b3a1e, -w / 2 + 0.15, 1.2, d / 2 - 1.2); // porte
      this.box(0.1, 0.1, 1.4, 0xc9b28c, -w / 2 + 0.17, 2.45, d / 2 - 1.2); // linteau
      this.box(0.12, 0.06, 0.06, 0xd4af37, -w / 2 + 0.24, 1.15, d / 2 - 0.75); // poignée
    }
    // Fenêtre à persiennes avec rideaux en pagne, sur le mur de gauche (pas dans un plateau : lumière maîtrisée)
    if (!media) {
      this.box(0.08, 1.4, 1.8, 0x9fd0ff, -w / 2 + 0.16, 2.1, -d / 6);
      for (let i = 0; i < 6; i++) this.box(0.1, 0.06, 1.8, 0xffffff, -w / 2 + 0.2, 1.5 + i * 0.24, -d / 6);
    }
    if (!holy && !media) {
      this.box(0.06, 1.8, 0.55, this.mats.wax(3), -w / 2 + 0.25, 2.1, -d / 6 - 1.15);
      this.box(0.06, 1.8, 0.55, this.mats.wax(3), -w / 2 + 0.25, 2.1, -d / 6 + 1.15);
    }
    // Interrupteur, prise et ampoule au plafond (lumière chaude)
    this.box(0.18, 0.25, 0.04, 0xffffff, -w / 2 + 3.2, 1.4, -d / 2 + 0.15);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff2c4 });
    const bulb = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.16, 10, 8)), bulbMat);
    bulb.position.set(0, 3.6, 0);
    this.box(0.02, 0.4, 0.02, 0x222222, 0, 3.9, 0);
    this.scene.add(bulb);
    this.disposables.push(bulbMat);
    const lamp = new THREE.PointLight(0xffd9a0, 1.4, Math.max(w, d) * 1.2, 1.6);
    this.lamps.push(lamp);
    lamp.position.set(0, 3.4, 0);
    this.scene.add(lamp);
  }

  private chair(x: number, z: number, color: number, rot = 0): void {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.8, 0.12, 0.8)), this.mats.color(color));
    seat.position.y = 0.75;
    const back = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.8, 0.9, 0.1)), this.mats.color(color));
    back.position.set(0, 1.2, -0.36);
    g.add(seat, back);
    for (const [dx, dz] of [[-0.33, -0.33], [0.33, -0.33], [-0.33, 0.33], [0.33, 0.33]]) {
      const leg = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.08, 0.75, 0.08)), this.mats.color(color));
      leg.position.set(dx!, 0.37, dz!);
      g.add(leg);
    }
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    this.blocks.push({ x, z, hw: 0.4, hd: 0.4, lvl: this.buildLevel });
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = this.profile.shadows;
    });
    this.scene.add(g);
  }

  private table(x: number, z: number, r: number, color: number): void {
    const top = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(r, r, 0.1, 14)), this.mats.color(color));
    top.position.set(x, 1, z);
    const foot = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.1, 0.25, 1, 8)), this.mats.color(0x5b3a1e));
    foot.position.set(x, 0.5, z);
    this.blocks.push({ x, z, hw: r, hd: r, lvl: this.buildLevel });
    top.castShadow = foot.castShadow = this.profile.shadows;
    this.scene.add(top, foot);
  }

  private bed(x: number, z: number, w: number, wax: number): void {
    this.bedSpot ??= { x, z, y: 0.95 };
    // Sommier sur pieds, matelas épais, tête de lit, drap et oreillers séparés : la silhouette
    // reste légère mais ressemble à un vrai couchage, même en vue rapprochée.
    for (const dx of [-w / 2 + 0.18, w / 2 - 0.18]) for (const dz of [-1.38, 1.38]) this.box(0.16, 0.36, 0.16, 0x4a2d19, x + dx, 0.18, z + dz);
    this.box(w, 0.32, 3.2, 0x704321, x, 0.42, z);
    this.box(w + 0.18, 1.45, 0.2, 0x7a4a27, x, 1.08, z - 1.58);
    for (let i = -2; i <= 2; i++) this.box(w - 0.28, 0.06, 0.06, 0x9b6840, x, 0.65 + i * 0.22, z - 1.69);
    this.box(w - 0.16, 0.38, 3, 0xf6f2e9, x, 0.75, z);
    this.box(w - 0.22, 0.07, 1.75, this.mats.wax(wax), x, 0.98, z + 0.58);
    const pillows = w > 3 ? [-w * 0.23, w * 0.23] : [0];
    for (const dx of pillows) {
      const pillow = this.box(Math.min(1.15, w * 0.38), 0.2, 0.62, 0xfffcf5, x + dx, 1.02, z - 1.08);
      pillow.rotation.x = -0.08;
    }
    this.box(w - 0.28, 0.06, 0.12, 0xd8d3c8, x, 0.97, z + 1.46);
  }

  /** Petite table de nuit avec tiroir et lampe chaude, réservée aux logements. */
  private bedside(x: number, z: number, color = 0x8b5a2b): void {
    this.box(0.82, 0.68, 0.72, color, x, 0.34, z);
    this.box(0.7, 0.2, 0.04, 0x6d4024, x, 0.45, z + 0.38);
    const knob = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.055, 8, 6)), this.mats.color(0xd4af37));
    knob.position.set(x, 0.46, z + 0.43);
    this.scene.add(knob);
    this.box(0.08, 0.65, 0.08, 0xc8b58f, x, 1.02, z);
    const shade = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.34, 0.48, 16, 1, true)), this.mats.color(0xf0d49b));
    shade.position.set(x, 1.48, z);
    this.scene.add(shade);
  }

  private plant(x: number, z: number): void {
    const pot = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.32, 0.24, 0.6, 12)), this.mats.color(0xc96a3b));
    pot.position.set(x, 0.3, z);
    this.scene.add(pot);
    this.blocks.push({ x, z, hw: 0.35, hd: 0.35, lvl: this.buildLevel });
    const leaf = this.geo(new THREE.SphereGeometry(0.3, 8, 6));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const l = new THREE.Mesh(leaf, this.mats.color(i % 2 ? 0x2e9e5b : 0x3fb26b));
      l.scale.set(0.5, 1.4, 0.25);
      l.position.set(x + Math.cos(a) * 0.22, 1.05 + (i % 3) * 0.15, z + Math.sin(a) * 0.22);
      l.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      this.scene.add(l);
    }
  }

  /** Ventilateur sur pied : socle, tige, moteur, grille en anneau et trois pales (il se reconnaît de loin, ce n'est pas un panneau). */
  private fan(x: number, z: number, rot = 0): void {
    const g = new THREE.Group();
    const metal = this.mats.color(0x8e98a6);
    const base = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.3, 0.34, 0.06, 14)), this.mats.color(0x3a3f48));
    base.position.y = 0.03;
    const pole = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.035, 0.035, 1.35, 8)), metal);
    pole.position.y = 0.72;
    const motor = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.11, 0.11, 0.24, 12)), this.mats.color(0x3a3f48));
    motor.rotation.x = Math.PI / 2;
    motor.position.set(0, 1.5, 0);
    const ring = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.34, 0.015, 6, 22)), metal);
    ring.position.set(0, 1.5, 0.13);
    const ring2 = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.17, 0.01, 6, 18)), metal);
    ring2.position.set(0, 1.5, 0.13);
    g.add(base, pole, motor, ring, ring2);
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.1, 0.3, 0.015)), this.mats.color(0xdfe6ee));
      const a = (i / 3) * Math.PI * 2 + 0.4;
      blade.position.set(Math.sin(a) * 0.16, 1.5 + Math.cos(a) * 0.16, 0.09);
      blade.rotation.z = -a;
      g.add(blade);
    }
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = this.profile.shadows;
    });
    this.scene.add(g);
  }

  /** Moustiquaire suspendue au-dessus du lit (indispensable contre le paludisme). */
  private net(x: number, z: number, w: number): void {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    this.disposables.push(mat);
    const net = new THREE.Mesh(this.geo(new THREE.ConeGeometry(Math.max(w, 3.2) * 0.62, 2.6, 4, 1, true)), mat);
    net.rotation.y = Math.PI / 4;
    net.position.set(x, 2.3, z);
    this.scene.add(net);
  }

  private wardrobe(x: number, z: number): void {
    this.box(2, 2.8, 0.9, 0x8b5a2b, x, 1.4, z);
    this.box(0.04, 2.6, 0.02, 0x5b3a1e, x, 1.4, z + 0.46);
    this.box(0.7, 1.4, 0.04, 0xcfe3f5, x + 1.4, 1.8, z - 0.4); // miroir
  }

  /** Coin cuisine : réchaud à gaz sur sa bouteille, marmite, glacière. */
  private kitchen(x: number, z: number): void {
    this.box(1.6, 0.9, 0.7, 0xb0b8c4, x, 0.45, z);
    const bottle = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.28, 0.28, 0.8, 10)), this.mats.color(0x1f6feb));
    bottle.position.set(x + 1.3, 0.4, z);
    const pot = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.3, 0.26, 0.35, 10)), this.mats.color(0x9aa5b4));
    pot.position.set(x - 0.3, 1.08, z);
    this.scene.add(bottle, pot);
    this.box(1, 0.7, 0.6, 0x1f6feb, x - 1.5, 0.35, z + 0.1); // glacière
    this.box(1.02, 0.12, 0.62, 0xffffff, x - 1.5, 0.75, z + 0.1);
    // Plan de travail en bois, portes du meuble, grille du réchaud, tuyau de gaz et petits pots posés dessus
    this.box(1.7, 0.05, 0.78, 0x7a5a3a, x, 0.925, z);
    for (const dx of [-0.4, 0.4]) this.box(0.02, 0.7, 0.02, 0x6f7885, x + dx, 0.45, z + 0.36);
    this.box(0.04, 0.04, 0.04, 0x4a4f58, x - 0.78, 0.5, z + 0.37);
    this.box(0.04, 0.04, 0.04, 0x4a4f58, x + 0.78, 0.5, z + 0.37);
    this.cyl(0.24, 0.03, 0x2b2e35, x - 0.3, 0.96, z);
    this.cyl(0.14, 0.03, 0x2b2e35, x + 0.45, 0.96, z - 0.1);
    this.box(0.5, 0.035, 0.035, 0x1a1a1a, x + 1.05, 0.78, z + 0.05);
    this.cyl(0.07, 0.04, 0xd22d2d, x + 1.3, 0.83, z);
    this.cyl(0.06, 0.2, 0xe8d9a8, x + 0.62, 1.06, z + 0.18); // huile
    this.cyl(0.07, 0.12, 0xffffff, x + 0.42, 1.01, z + 0.22); // sel
    this.box(0.3, 0.02, 0.2, 0xcfd5de, x + 0.65, 0.96, z - 0.2); // planche
  }

  private jerrycans(x: number, z: number, n: number): void {
    for (let i = 0; i < n; i++) this.box(0.45, 0.65, 0.3, [0xffce00, 0x22a861, 0x1f6feb][i % 3]!, x + i * 0.55, 0.33, z);
  }

  /** Calendrier ou affiche au mur (rectangle coloré). */
  private poster(x: number, y: number, z: number, wax: number): void {
    this.box(1, 1.3, 0.04, 0xffffff, x, y, z);
    this.box(0.86, 0.6, 0.05, this.mats.wax(wax), x, y + 0.25, z + 0.01);
  }

  /** Figurant : assis (immobile) ou qui flâne dans la pièce. */
  private extra(x: number, z: number, sit: boolean, rotY = 0): void {
    // Lieu fermé à cette heure : ni personnel ni clients
    if (!this.open) return;
    const g = buildPerson(this.mats, randomLook(this.rand));
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    if (sit) sitPose(g);
    this.scene.add(g);
    if (!sit) this.extras.push({ g, phase: this.rand() * 6, home: g.position.clone(), target: g.position.clone(), speed: 1 + this.rand() * 0.6 });
  }


  /**
   * Plateau de média. `photo` faux : studio d'émission / podcast d'Ori-Infos (table ovale à micros sur bras, trois invités, cadreur,
   * régie avec console et écrans, panneau « EN DIRECT », caissons acoustiques, rampe de projecteurs). `photo` vrai : studio photo-vidéo
   * de Capture Média (fond blanc, parapluies et réflecteurs, modèle, photographe, caméra sur pied, poste de montage).
   */
  private furnishStudio(photo: boolean): void {
    const { w, d } = this.half;
    const glow = (hex: number): THREE.MeshBasicMaterial => {
      const m = new THREE.MeshBasicMaterial({ color: hex });
      this.disposables.push(m);
      return m;
    };
    const black = 0x16181d;
    const steel = 0x3a3f47;
    /** Pied de caméra : fût, trois jambes écartées, tête, boîtier et objectif tourné vers `rot`. */
    const camera = (x: number, z: number, rot: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = rot;
      this.scene.add(g);
      const add = (mesh: THREE.Mesh) => {
        g.add(mesh);
        return mesh;
      };
      const mk = (geo: THREE.BufferGeometry, col: number | THREE.Material, px: number, py: number, pz: number) => {
        const m = new THREE.Mesh(this.geo(geo), typeof col === 'number' ? this.mats.color(col) : col);
        m.position.set(px, py, pz);
        return add(m);
      };
      mk(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 8), steel, 0, 0.95, 0);
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI * 2) / 3;
        const leg = mk(new THREE.CylinderGeometry(0.02, 0.02, 1.35, 6), steel, Math.sin(a) * 0.3, 0.62, Math.cos(a) * 0.3);
        leg.rotation.set(Math.cos(a) * 0.24, 0, -Math.sin(a) * 0.24);
      }
      mk(new THREE.BoxGeometry(0.34, 0.3, 0.55), black, 0, 1.75, 0);
      mk(new THREE.CylinderGeometry(0.11, 0.13, 0.42, 12), 0x24272e, 0, 1.75, 0.46).rotation.x = Math.PI / 2;
      mk(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 12), 0x5aa0ff, 0, 1.75, 0.68).rotation.x = Math.PI / 2;
      mk(new THREE.BoxGeometry(0.16, 0.12, 0.02), glow(0xff3b30), -0.1, 1.95, -0.1); // voyant d'enregistrement
      this.blocks.push({ x, z, hw: 0.4, hd: 0.4, lvl: this.buildLevel });
    };
    /** Projecteur sur pied : pied, boîte à lumière lumineuse inclinée vers le plateau. */
    const softbox = (x: number, z: number, rot: number, color = 0xfff4d6) => {
      this.cyl(0.04, 2.3, steel, x, 1.15, z);
      this.cyl(0.25, 0.05, steel, x, 0.03, z);
      const g = new THREE.Group();
      g.position.set(x, 2.35, z);
      g.rotation.y = rot;
      const face = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1, 0.8, 0.18)), glow(color));
      face.rotation.x = 0.18;
      g.add(face);
      this.scene.add(g);
      this.blocks.push({ x, z, hw: 0.3, hd: 0.3, lvl: this.buildLevel });
    };
    // Caissons acoustiques colorés sur les murs du fond et de gauche (studio sombre) ou panneaux blancs (studio photo)
    const panel = photo ? [0xf7f8fa, 0xe3e6eb] : [0x3b4a7a, 0x4a3a7a, 0x2f3a63];
    for (let i = 0; i < 7; i++) this.box(1.9, 1.7, 0.14, panel[i % panel.length]!, -w + 2.4 + i * 2.5, 2.2, -d + 0.12);
    // Câbles au sol
    for (const [cx, cz, cw, cd] of [[-2.5, 0.4, 3.2, 0.06], [1.6, 1.6, 0.06, 4.4], [4.6, -3, 3, 0.06]] as const) this.box(cw, 0.03, cd, black, cx, 0.02, cz);
    if (!photo) {
      // Fond lumineux derrière la table (couleurs d'Ori-Infos : violet et vert citron) et panneau « EN DIRECT »
      this.box(9, 3.2, 0.1, glow(0x5b2be0), 0, 2.1, -d + 0.35);
      this.box(8.4, 0.18, 0.12, glow(0xc9f31d), 0, 0.55, -d + 0.4);
      this.box(8.4, 0.18, 0.12, glow(0xc9f31d), 0, 3.65, -d + 0.4);
      this.box(2.2, 0.55, 0.14, glow(0xe5383b), w - 3.2, 3.1, -d + 0.2);
      this.box(2.4, 0.9, 0.12, 0x23283a, -w + 2.8, 3.0, -d + 0.2);
      this.box(0.18, 0.18, 0.14, glow(0xff3b30), -w + 1.9, 3.0, -d + 0.28);
      // Table ovale à plateau de bois et pied central, tapis rond en dessous
      this.cyl(3.2, 0.03, 0x1f2438, 0, 0.02, -d + 4.1);
      this.box(5.2, 0.12, 1.7, 0x7a4a26, 0, 0.98, -d + 4.1);
      this.box(0.5, 0.95, 0.5, steel, 0, 0.5, -d + 4.1);
      // Quatre micros sur bras articulés et filtres anti-pop, casques posés sur la table
      for (let i = 0; i < 4; i++) {
        const mx = -1.9 + i * 1.27;
        this.cyl(0.03, 0.55, black, mx, 1.3, -d + 3.6);
        const mic = this.cyl(0.07, 0.24, 0x222428, mx, 1.64, -d + 3.75);
        mic.rotation.x = 0.7;
        const pop = this.cyl(0.11, 0.015, 0x666b75, mx, 1.64, -d + 3.9);
        pop.rotation.x = 0.7;
        this.cyl(0.1, 0.05, black, mx + 0.3, 1.04, -d + 4.5);
      }
      // Trois invités et l'animateur, assis derrière la table, face au public/caméra
      for (let i = 0; i < 4; i++) {
        const sx = -1.9 + i * 1.27;
        this.chair(sx, -d + 2.7, i === 1 ? 0xe5383b : 0x2f3a63, 0);
        this.extra(sx, -d + 2.7, true, 0);
      }
      // Rampe de projecteurs au plafond
      this.box(9, 0.1, 0.1, steel, 0, 3.9, -d + 4.6);
      for (let i = 0; i < 5; i++) {
        const can = this.cyl(0.14, 0.4, black, -3.6 + i * 1.8, 3.65, -d + 4.6);
        can.rotation.x = 0.3;
        this.box(0.22, 0.04, 0.22, glow(0xfff4d6), -3.6 + i * 1.8, 3.42, -d + 4.45);
      }
      softbox(-5.4, -d + 3.6, 0.6);
      softbox(5.4, -d + 3.6, -0.6);
      // Deux caméras de plateau : une face à la table, une de biais ; le cadreur est à la première
      camera(-1.2, 1.2, Math.PI);
      camera(3.8, 0.4, Math.PI + 0.55);
      this.extra(-2.3, 1.5, false, Math.PI);
      // Perche audio : bras horizontal avec micro, tenu par un preneur de son
      this.box(0.06, 0.06, 3.2, black, 1.8, 2.9, -d + 6.1);
      this.cyl(0.09, 0.3, 0x222428, 1.8, 2.78, -d + 4.6);
      this.extra(2.6, -d + 7.6, false, Math.PI);
      // Régie à droite : console de mixage à boutons, deux écrans, technicien assis
      this.box(1.6, 0.85, 3.4, 0x2a2e3a, w - 1.3, 0.43, -1);
      this.box(1.5, 0.08, 3.2, 0x14161c, w - 1.3, 0.9, -1);
      const knobs = new THREE.InstancedMesh(this.geo(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 8)), glow(0xc9f31d), 30);
      this.scene.add(knobs);
      let kk = 0;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 10; c++) this.setInst(knobs, kk++, w - 1.7 + r * 0.32, 0.96, -2.4 + c * 0.32);
      for (const dz of [-1.7, -0.3]) {
        this.box(0.08, 0.6, 1.1, glow(0x2f6df6), w - 0.6, 1.5, dz);
        this.box(0.14, 0.04, 0.5, steel, w - 0.7, 1.12, dz);
      }
      this.chair(w - 3, -1, 0x14161c, Math.PI / 2);
      this.extra(w - 3, -1, true, Math.PI / 2);
      // Écran de contrôle « EN DIRECT » au mur de gauche
      this.box(0.1, 1.4, 2.6, glow(0x1a2540), -w + 0.2, 2.2, -2);
      this.box(0.14, 0.2, 0.6, glow(0xe5383b), -w + 0.28, 2.75, -2.9);
    } else {
      // Fond blanc continu (rouleau de papier) avec sol clair, deux parapluies de studio et deux réflecteurs
      this.box(9, 3.6, 0.1, 0xfafafa, 0, 2.1, -d + 0.35);
      this.box(9, 0.04, 6.5, 0xf4f4f4, 0, 0.03, -d + 3.4);
      this.cyl(0.045, 3.6, steel, -4.8, 1.8, -d + 0.8);
      this.cyl(0.045, 3.6, steel, 4.8, 1.8, -d + 0.8);
      this.box(9.8, 0.06, 0.06, steel, 0, 3.6, -d + 0.8);
      for (const sx of [-1, 1]) {
        softbox(sx * 5.2, -d + 4.2, -sx * 0.8, 0xffffff);
        const umb = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.75, 0.55, 14, 1, true)), glow(0xf3f6ff));
        umb.position.set(sx * 3.4, 2.5, -d + 5.6);
        umb.rotation.set(Math.PI / 2 + 0.2, 0, -sx * 0.9);
        this.scene.add(umb);
        this.cyl(0.03, 2.4, steel, sx * 3.6, 1.2, -d + 5.9);
        const refl = this.cyl(0.55, 0.03, 0xfdfdfd, sx * 3.1, 1.2, -d + 2.6);
        refl.rotation.x = Math.PI / 2;
        refl.rotation.z = sx * 0.4;
        this.cyl(0.03, 1.2, steel, sx * 3.1, 0.6, -d + 2.8);
      }
      // Modèle sur le fond blanc, photographe et assistant face à lui, caméra vidéo sur pied
      this.extra(0, -d + 3.4, false, 0);
      this.box(0.5, 0.45, 0.5, 0xd9d9de, 1.4, 0.23, -d + 3.2); // tabouret
      camera(0.8, 1.6, Math.PI);
      this.extra(-0.5, 2.1, false, Math.PI);
      this.extra(2.2, 0.9, false, Math.PI + 0.4);
      // Poste de montage : bureau, grand écran, souris, monteur assis ; étagère à matériel
      this.box(3.2, 0.1, 1.3, 0xf2f2f2, w - 2.6, 0.9, d - 3.4);
      this.box(0.1, 0.9, 1.1, steel, w - 4, 0.45, d - 3.4);
      this.box(0.1, 0.9, 1.1, steel, w - 1.2, 0.45, d - 3.4);
      this.box(1.5, 0.85, 0.06, glow(0x2f6df6), w - 3, 1.45, d - 3.9);
      this.box(1.1, 0.7, 0.06, glow(0x1f9d6b), w - 1.7, 1.4, d - 3.9);
      this.chair(w - 2.6, d - 2.5, 0x2a2e3a, Math.PI);
      this.extra(w - 2.6, d - 2.5, true, Math.PI);
      this.box(0.5, 2.2, 3, 0xe8e8ec, -w + 0.9, 1.1, d - 4.5);
      for (let i = 0; i < 4; i++) this.box(0.34, 0.26, 0.5 + (i % 2) * 0.4, [0x24272e, 0x5aa0ff, 0xe5383b, 0xffce00][i]!, -w + 0.9, 0.5 + i * 0.5, d - 4.5);
      // Enseigne lumineuse du studio et voyant « enregistrement »
      this.box(0.18, 0.18, 0.14, glow(0xff3b30), w - 2.2, 3.1, -d + 0.2);
      // ─── Finitions de studio professionnel ───
      /** Texture dessinée sur un canevas (enseigne, tirages, écrans). */
      const canvasMat = (cw: number, ch: number, draw: (g: CanvasRenderingContext2D) => void): THREE.MeshBasicMaterial => {
        const cv = document.createElement('canvas');
        cv.width = cw;
        cv.height = ch;
        const g = cv.getContext('2d');
        if (g) draw(g);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        this.mats.textures.push(tex);
        const m = new THREE.MeshBasicMaterial({ map: tex });
        this.disposables.push(m);
        return m;
      };
      // Enseigne de la marque au mur du fond (objectif, nom, signature) à la place du simple bandeau jaune
      const sign = canvasMat(768, 192, (g) => {
        g.fillStyle = '#ffd60a';
        g.fillRect(0, 0, 768, 192);
        g.fillStyle = '#111';
        g.beginPath();
        g.arc(110, 96, 70, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ffd60a';
        g.beginPath();
        g.arc(110, 96, 38, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#111';
        g.beginPath();
        g.arc(110, 96, 20, 0, Math.PI * 2);
        g.fill();
        g.textBaseline = 'alphabetic';
        g.font = '900 96px system-ui, sans-serif';
        g.fillText('CAPTURE', 216, 112);
        g.font = '700 30px system-ui, sans-serif';
        g.fillText('L’AFRIQUE EN UN SEUL CLIC', 220, 158);
      });
      this.box(3.4, 0.85, 0.1, sign, -w + 2.1, 3.0, -d + 0.22);
      // Plinthe et liseré jaune de la marque le long des murs
      this.box(w * 2, 0.1, 0.05, 0xffd60a, 0, 0.3, -d + 0.2);
      this.box(0.05, 0.1, d * 2, 0xffd60a, -w + 0.2, 0.3, 0);
      // Tirages encadrés au mur de gauche (coucher de soleil, portrait, ville) : cadre noir, passe-partout blanc
      const prints: [number, number, (g: CanvasRenderingContext2D) => void][] = [
        [1.9, 1.3, (g) => {
          const gr = g.createLinearGradient(0, 0, 0, 260);
          gr.addColorStop(0, '#2b3a7a');
          gr.addColorStop(0.55, '#ff9a3c');
          gr.addColorStop(0.62, '#1d4f8f');
          gr.addColorStop(1, '#0d2f5c');
          g.fillStyle = gr;
          g.fillRect(0, 0, 380, 260);
          g.fillStyle = '#ffe27a';
          g.beginPath();
          g.arc(190, 142, 38, 0, Math.PI * 2);
          g.fill();
        }],
        [1.2, 1.6, (g) => {
          const gr = g.createLinearGradient(0, 0, 240, 320);
          gr.addColorStop(0, '#5b2be0');
          gr.addColorStop(1, '#16113a');
          g.fillStyle = gr;
          g.fillRect(0, 0, 240, 320);
          g.fillStyle = '#d9a066';
          g.beginPath();
          g.arc(120, 120, 46, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#0c0c14';
          g.fillRect(70, 170, 100, 150);
        }],
        [1.9, 1.3, (g) => {
          g.fillStyle = '#16213d';
          g.fillRect(0, 0, 380, 260);
          for (let i = 0; i < 9; i++) {
            g.fillStyle = i % 2 ? '#2d4a7c' : '#3b5f99';
            g.fillRect(14 + i * 40, 90 + ((i * 37) % 80), 32, 170);
            g.fillStyle = '#ffd60a';
            g.fillRect(20 + i * 40, 110 + ((i * 37) % 80), 6, 6);
          }
        }],
      ];
      prints.forEach(([pw, ph, draw], i) => {
        const pz = -d + 3.6 + i * 2.7;
        this.box(0.06, ph + 0.16, pw + 0.16, 0x111111, -w + 0.2, 2.2, pz);
        this.box(0.04, ph, pw, canvasMat(Math.round(pw * 200), Math.round(ph * 200), draw), -w + 0.25, 2.2, pz);
      });
      // Mur d'écrans au fond à droite : trois écrans verticaux qui diffusent des images (dégradés et symbole de lecture)
      for (let i = 0; i < 3; i++) {
        const sx = 5.6 + i * 1.35;
        this.box(1.2, 1.7, 0.08, 0x0b0c10, sx, 2.3, -d + 0.22);
        this.box(1.06, 1.56, 0.05, canvasMat(150, 220, (g) => {
          const gr = g.createLinearGradient(0, 0, 150, 220);
          gr.addColorStop(0, ['#1f6feb', '#e5383b', '#22a861'][i]!);
          gr.addColorStop(1, '#10162a');
          g.fillStyle = gr;
          g.fillRect(0, 0, 150, 220);
          g.fillStyle = 'rgba(255,255,255,.9)';
          g.beginPath();
          g.moveTo(54, 80);
          g.lineTo(54, 140);
          g.lineTo(100, 110);
          g.closePath();
          g.fill();
        }), sx, 2.3, -d + 0.26);
      }
      // Coin salon d'accueil : canapé noir à coussins jaunes, table basse en verre, plante, le long du mur de gauche
      this.box(1.1, 0.45, 3.0, 0x1d2025, -w + 1.2, 0.3, 1.2);
      this.box(0.3, 0.9, 3.0, 0x1d2025, -w + 0.7, 0.75, 1.2);
      for (const dz of [0.4, 2.0]) this.box(0.5, 0.4, 0.9, 0xffd60a, -w + 1.2, 0.75, dz);
      this.box(1.1, 0.06, 1.3, 0xbfe4ff, -w + 3.0, 0.55, 1.2);
      for (const dz of [0.7, 1.7]) this.box(0.08, 0.5, 0.08, 0x1d2025, -w + 3.0, 0.27, dz);
      this.box(0.4, 0.04, 0.3, 0x111111, -w + 3.0, 0.6, 1.2); // album
      // Rampe d'éclairage au-dessus du fond : six projecteurs orientables, face éclairée
      this.box(10, 0.1, 0.1, steel, 0, 3.95, -d + 3.8);
      for (let i = 0; i < 6; i++) {
        const can = this.cyl(0.13, 0.36, black, -4.5 + i * 1.8, 3.72, -d + 3.8);
        can.rotation.x = 0.35;
        this.box(0.2, 0.04, 0.2, glow(0xffffff), -4.5 + i * 1.8, 3.52, -d + 3.65);
      }
      // Valises de transport empilées (angles argentés) et caisse à roulettes près du poste de montage
      this.box(1.0, 0.5, 0.65, 0x22252b, w - 1.1, 0.25, -d + 1.1);
      this.box(0.9, 0.45, 0.6, 0x2c3037, w - 1.1, 0.72, -d + 1.1);
      this.box(1.0, 0.04, 0.05, 0xc7ccd4, w - 1.1, 0.5, -d + 0.78);
      this.box(0.9, 0.5, 0.6, 0x22252b, w - 2.3, 0.25, -d + 1.1);
      // Clap de cinéma sur un guéridon
      this.cyl(0.04, 0.9, steel, 3.6, 0.45, -1.0);
      this.cyl(0.2, 0.03, steel, 3.6, 0.02, -1.0);
      this.box(0.5, 0.36, 0.04, 0x111111, 3.6, 1.05, -1.0);
      this.box(0.5, 0.08, 0.05, 0xf4f4f4, 3.6, 1.28, -1.0).rotation.z = 0.12;
    }
  }

  /** Une instance (position seulement) dans un maillage instancié : petits boutons, voyants. */
  private setInst(m: THREE.InstancedMesh, i: number, x: number, y: number, z: number): void {
    const t = new THREE.Matrix4().makeTranslation(x, y, z);
    m.setMatrixAt(i, t);
    m.instanceMatrix.needsUpdate = true;
  }

  /** Maquis : podium de danse (marches, bandeau LED), portique de projecteurs dont les faisceaux balaient les murs, boule à facettes, coin DJ. */
  private furnishDisco(): void {
    if (!this.open) return;
    const { w, d } = this.half;
    const PW = 5.2; // profondeur du podium (x)
    const PD = 6.4; // largeur du podium, le long du mur de droite (z)
    const cx = w - PW / 2 - 0.2;
    const cz = 2.2;
    const H = 0.38; // hauteur du podium
    const palette = [0xe5383b, 0xffce00, 0x1f6feb, 0x2fa56a, 0xff7aa8, 0x9b5de5];
    const dark = 0x3a3e50;
    // Podium : plateau sombre, liseré LED sur le pourtour, deux marches côté salle
    this.box(PW, H, PD, dark, cx, H / 2, cz);
    this.box(PW + 0.1, 0.04, PD + 0.1, 0x7a8099, cx, H + 0.02, cz);
    const led: THREE.MeshBasicMaterial[] = [];
    const strip = (sw: number, sd: number, x: number, z: number) => {
      const m = new THREE.MeshBasicMaterial({ color: palette[0]! });
      this.disposables.push(m);
      led.push(m);
      const bar = new THREE.Mesh(this.geo(new THREE.BoxGeometry(sw, 0.05, sd)), m);
      bar.position.set(x, H + 0.06, z);
      this.scene.add(bar);
      const base = new THREE.Mesh(this.geo(new THREE.BoxGeometry(sw, 0.04, sd)), m);
      base.position.set(x, 0.05, z);
      this.scene.add(base);
    };
    strip(PW, 0.07, cx, cz - PD / 2 + 0.02);
    strip(PW, 0.07, cx, cz + PD / 2 - 0.02);
    strip(0.07, PD, cx - PW / 2 + 0.02, cz);
    strip(0.07, PD, cx + PW / 2 - 0.02, cz);
    this.box(0.7, 0.13, 3, 0x23242e, cx - PW / 2 - 0.35, 0.065, cz);
    this.box(0.45, 0.26, 3, 0x23242e, cx - PW / 2 - 0.1, 0.13, cz);
    // Portique : deux montants et une traverse, avec quatre projecteurs
    const metal = 0x3a3d48;
    const tz = PD / 2 - 0.3;
    this.box(0.12, 4.1, 0.12, metal, cx - PW / 2 + 0.2, 2.05, cz - tz);
    this.box(0.12, 4.1, 0.12, metal, cx - PW / 2 + 0.2, 2.05, cz + tz);
    this.box(0.12, 0.12, tz * 2, metal, cx - PW / 2 + 0.2, 4.05, cz);
    this.box(0.12, 0.12, tz * 2, metal, cx - 0.5, 4.05, cz);
    this.box(0.12, 0.12, tz * 2, metal, cx + PW / 2 - 0.5, 4.05, cz);
    this.box(PW - 0.7, 0.12, 0.12, metal, cx - 0.2, 4.05, cz - tz);
    this.box(PW - 0.7, 0.12, 0.12, metal, cx - 0.2, 4.05, cz + tz);
    // Boule à facettes au centre
    const ballMat = new THREE.MeshLambertMaterial({ color: 0xdfe6ee, emissive: 0x9aa4b2, emissiveIntensity: 0.7 });
    this.disposables.push(ballMat);
    const ball = new THREE.Mesh(this.geo(new THREE.IcosahedronGeometry(0.34, 1)), ballMat);
    ball.position.set(cx - 0.5, 3.3, cz);
    this.scene.add(ball);
    this.box(0.03, 0.8, 0.03, 0x222222, cx - 0.5, 3.8, cz);
    // Projecteurs : un faisceau visible par couleur, et une tache de lumière qui court sur les murs
    const beamMat = (c: number) => {
      const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      this.disposables.push(m);
      return m;
    };
    const unit = new THREE.ConeGeometry(1, 1, 18, 1, true);
    unit.translate(0, -0.5, 0);
    unit.rotateX(-Math.PI / 2); // pointe à l'origine, ouverte vers +z
    const spotColors = [0xe5383b, 0x1f6feb, 0xffce00, 0x2fa56a, 0xff7aa8, 0x9b5de5, 0xffffff];
    const spots = spotColors.map((c, i) => {
      // 0-3 : faisceaux qui balaient les murs ; 4-6 : faisceaux qui jouent sur le podium
      const onFloor = i >= 4;
      const light = new THREE.SpotLight(c, 0, 22, onFloor ? 0.17 : 0.2, 0.5, 1.4);
      light.position.set(onFloor ? cx - 0.5 : cx - 0.5 + ((i % 2) * 2 - 1) * 1.6, 3.95, onFloor ? cz + (i - 5) * 2.1 : cz + (Math.floor(i / 2) * 2 - 1) * 1.6);
      this.scene.add(light, light.target);
      const beam = new THREE.Mesh(this.geo(unit), beamMat(c));
      beam.position.copy(light.position);
      this.scene.add(beam);
      // Petit boîtier du projecteur
      this.box(0.28, 0.22, 0.28, 0x0d0d10, light.position.x, 3.88, light.position.z);
      return { light, beam, c, floor: onFloor };
    });
    // Danseurs sur le podium
    const dancers: { g: THREE.Group; phase: number; base: number }[] = [];
    for (const [dx, dz] of [[-1.0, -2.1], [0.9, -1.3], [-0.5, -0.1], [1.0, 1.1], [-0.9, 1.9], [0.4, 2.4]] as const) {
      const g = buildPerson(this.mats, randomLook(this.rand));
      g.position.set(cx + dx, H, cz + dz);
      const base = -Math.PI / 2; // face à la salle
      g.rotation.y = base;
      this.scene.add(g);
      dancers.push({ g, phase: this.rand() * 6, base });
    }
    // Deuxième enceinte, à côté du podium
    this.box(0.9, 1.7, 0.8, 0x14213d, w - 0.6, 0.85, cz + PD / 2 + 0.5);
    this.box(0.9, 1.7, 0.8, 0x14213d, w - 0.6, 0.85, cz - PD / 2 - 0.5);
    // Coin DJ : table, deux platines et le DJ derrière
    this.box(3.4, 0.95, 1, 0x1b1d26, -4.6, 0.48, -d + 1.5);
    const discs: THREE.Mesh[] = [];
    for (const dx of [-0.8, 0.8]) {
      const disc = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 20)), this.mats.color(0x0d0d10));
      disc.position.set(-4.6 + dx, 1, -d + 1.5);
      const label = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12)), this.mats.color(0xe5383b));
      label.position.set(0, 0.01, 0);
      disc.add(label);
      this.scene.add(disc);
      discs.push(disc);
    }
    const dj = buildPerson(this.mats, randomLook(this.rand));
    dj.position.set(-4.6, 0, -d + 0.6);
    dj.rotation.y = 0;
    this.scene.add(dj);
    this.disco = { spots, led, ball, dancers, dj, discs, cx, cz, lift: H, pw: PW, pd: PD };
  }

  /** Pas de danse : bras levés qui balancent, jambes qui rebondissent, petit saut sur le temps (`lift` = hauteur du sol). */
  private danceStep(g: THREE.Group, t: number, phase: number, lift = 0): void {
    const s = Math.sin(t * 5 + phase);
    const c = Math.cos(t * 5 + phase);
    const set = (n: string, x: number) => {
      const o = g.getObjectByName(n);
      if (o) o.rotation.x = x;
    };
    set('armL', -2.3 + s * 0.45);
    set('armR', -2.3 - s * 0.45);
    const fl = g.getObjectByName('armL')?.getObjectByName('forearm');
    const fr = g.getObjectByName('armR')?.getObjectByName('forearm');
    if (fl) fl.rotation.x = -0.5 - Math.max(0, c) * 0.5;
    if (fr) fr.rotation.x = -0.5 - Math.max(0, -c) * 0.5;
    set('legL', s * 0.3);
    set('legR', -s * 0.3);
    g.position.y = lift + Math.abs(s) * 0.08;
  }

  /** Projecteurs, liseré LED, boule, DJ et danseurs ; appelée à chaque image. */
  private updateDisco(now: number): void {
    const d = this.disco;
    if (!d) return;
    const { w, d: depth } = this.half;
    const t = now / 1000;
    const palette = [0xe5383b, 0xffce00, 0x1f6feb, 0x2fa56a, 0xff7aa8, 0x9b5de5];
    const step = Math.floor(t * 2);
    // Chaque faisceau court sur un mur : fond, côté droit, côté gauche, fond (courbes qui se croisent)
    d.spots.forEach((o, i) => {
      const a = t * (0.55 + i * 0.13) + i * 1.7;
      const y = 1.7 + Math.sin(a * 1.3) * 1.1;
      const tg = o.light.target.position;
      if (o.floor) {
        // Projection sur le podium : une tache colorée qui se promène sur le plateau et les danseurs
        tg.set(d.cx + Math.sin(a * 1.1) * (d.pw / 2 - 0.7), d.lift, d.cz + Math.sin(a * 0.8 + i) * (d.pd / 2 - 0.7));
      } else if (i % 3 === 0) tg.set(Math.sin(a) * (w - 1), y, -depth + 0.05);
      else if (i % 3 === 1) tg.set(w - 0.05, y, Math.sin(a) * (depth - 1));
      else tg.set(-w + 0.05, y, Math.sin(a) * (depth - 1));
      o.light.intensity = (o.floor ? 45 : 34) + Math.sin(t * 4 + i) * 8;
      // Faisceau visible : du projecteur à la tache sur le mur
      const L = o.light.position.distanceTo(tg);
      o.beam.lookAt(tg);
      o.beam.scale.set(L * 0.13, L * 0.13, L);
    });
    d.led.forEach((m) => m.color.setHex(palette[step % palette.length]!));
    d.ball.rotation.y = t * 1.2;
    for (const disc of d.discs) disc.rotation.y = t * 3;
    if (d.dj) {
      // Le DJ mixe : bras avancés vers les platines, suivant le tempo
      const set = (n: string, x: number) => {
        const o = d.dj!.getObjectByName(n);
        if (o) o.rotation.x = x;
      };
      set('armL', -1.0 + Math.sin(t * 5) * 0.12);
      set('armR', -1.0 - Math.sin(t * 5) * 0.12);
      d.dj.position.y = Math.abs(Math.sin(t * 5)) * 0.03;
    }
    for (const o of d.dancers) {
      this.danceStep(o.g, t, o.phase, d.lift);
      o.g.rotation.y = o.base + Math.sin(t * 1.4 + o.phase) * 0.5;
    }
  }

  /** Le joueur monte sur le podium, danse quelques secondes, puis reste là, libre de repartir. Rend false à la fin. */
  private stepDance(now: number, dt: number): boolean {
    const a = this.dance;
    const d = this.disco;
    if (!a || !d) return false;
    const p = this.player;
    if (!a.arrived) {
      const dx = d.cx + 0.4 - p.position.x;
      const dz = d.cz - p.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.15) {
        const step = Math.min(dist, 3.4 * dt);
        p.position.x += (dx / dist) * step;
        p.position.z += (dz / dist) * step;
        const target = Math.atan2(dx, dz);
        p.rotation.y += Math.atan2(Math.sin(target - p.rotation.y), Math.cos(target - p.rotation.y)) * Math.min(1, dt * 10);
        animateWalk(p, now / 120, 0.6);
        // Il monte les marches en s'approchant du podium
        p.position.y = d.lift * Math.min(1, Math.max(0, 1 - (dist - 0.3) / 2.2));
        return true;
      }
      a.arrived = true;
      a.t0 = now;
    }
    const t = (now - a.t0) / 1000;
    this.danceStep(p, t, 0, d.lift);
    p.rotation.y = Math.sin(t * 1.6) * 0.7;
    if (now - a.t0 >= a.dur) {
      animateWalk(p, 0, 0);
      p.position.y = 0;
      p.position.x -= 1.4; // il redescend vers la salle
      this.target.copy(p.position);
      this.routeFor.set(1e9, 0, 1e9);
      this.dance = null;
      return false;
    }
    return true;
  }

  /** Église : chœur avec autel et vitraux, deux files de bancs de part et d'autre de l'allée, tronc et cierges. */
  private furnishChurch(): void {
    const { w, d } = this.half;
    const stone = 0xd8cdb8;
    const wood = 0x6b3f1d;
    this.box(9, 0.4, 3.2, stone, 0, 0.2, -d + 1.9);
    this.box(2.8, 1, 0.9, 0xf5f1e6, 0, 0.9, -d + 2.2);
    this.box(3.2, 0.06, 1.2, 0xb3202a, 0, 1.43, -d + 2.2);
    this.box(0.2, 2.8, 0.15, 0x7a5a3a, 0, 3, -d + 0.2);
    this.box(1.4, 0.2, 0.15, 0x7a5a3a, 0, 3.5, -d + 0.2);
    // Vitraux lumineux sur le mur du fond
    const panes = [0x1f6feb, 0xe5383b, 0xffce00].map((c) => {
      const m = new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.45 });
      this.disposables.push(m);
      return m;
    });
    [-6.2, -3.4, 3.4, 6.2].forEach((x, i) => {
      this.box(1.2, 2.6, 0.08, panes[i % 3]!, x, 2.6, -d + 0.2);
      this.box(1.4, 0.15, 0.1, 0xffffff, x, 3.95, -d + 0.2);
    });
    // Tapis rouge de l'allée
    this.box(2, 0.02, 12.5, 0x9c1c2c, 0, 0.05, 0.75);
    const seats: SacredLayout['seats'] = [];
    const rows = [-2.6, -0.8, 1, 2.8, 4.6];
    for (const side of [-1, 1]) {
      for (const z of rows) {
        const cx = side * 5.1;
        this.box(5.4, 0.1, 0.55, 0x7a4a24, cx, 0.72, z);
        this.box(5.4, 0.8, 0.08, wood, cx, 1.2, z + 0.3);
        this.box(0.12, 0.75, 0.6, wood, cx - 2.7, 0.38, z);
        this.box(0.12, 0.75, 0.6, wood, cx + 2.7, 0.38, z);
        this.blocks.push({ x: cx, z, hw: 2.7, hd: 0.45, lvl: this.buildLevel });
        for (let k = 0; k < 5; k++) seats.push({ x: side * (3 + k * 1.05), z, yaw: Math.PI, entry: { x: side * 1.6, z } });
      }
    }
    // Support à cierges : on y allume une bougie
    this.box(1.8, 0.9, 0.5, 0x4a4a52, -4.4, 0.45, -4.9);
    const sticks: NonNullable<SacredLayout['candles']>['sticks'] = [];
    for (let i = 0; i < 7; i++) {
      const x = -5.15 + i * 0.25;
      this.box(0.07, 0.3, 0.07, 0xfff6e0, x, 1.05, -4.9);
      sticks.push({ x, y: 1.2, z: -4.9 });
    }
    // Tronc des offrandes
    this.box(0.6, 1, 0.6, 0x5b3a1e, 3, 0.5, -5);
    this.box(0.66, 0.08, 0.66, 0x2a1d14, 3, 1.04, -5);
    this.plant(-w + 1.2, -d + 3.6);
    this.sacred = {
      faith: 'church',
      seats,
      spots: [],
      playerPlace: 2 * 5,
      leader: { x: 0, y: 0.4, z: -d + 1.1, yaw: 0 },
      box: { x: 3, z: -5, top: 1.1, stand: { x: 3, z: -4 }, yaw: Math.PI },
      candles: { stand: { x: -4.4, z: -3.7 }, yaw: Math.PI, sticks, lit: 0 },
    };
  }

  /** Mosquée : tapis vert aux rangées de prière tournées vers le mihrab, minbar, colonnes, déchaussoir et boîte d'aumône. */
  private furnishMosque(): void {
    const { d } = this.half;
    this.box(16, 0.03, 12.5, 0x2f7d57, 0, 0.07, -1.8);
    for (let r = 0; r < 5; r++) this.box(15.4, 0.02, 0.07, 0xf3e7bf, 0, 0.095, -5.4 + r * 1.6 + 0.8);
    // Mihrab : niche qui indique la direction de la prière
    this.box(2.6, 3.6, 0.4, 0xd9c27a, 0, 1.8, -d + 0.2);
    this.box(1.8, 3, 0.2, 0x1d5b45, 0, 1.5, -d + 0.35);
    this.box(0.9, 0.12, 0.05, 0xf3e7bf, 0, 2.4, -d + 0.48);
    // Minbar : la chaire de l'imam, trois marches et un dais
    this.box(1.5, 1.2, 1.5, 0x8b5a2b, 4.2, 0.6, -d + 1.2);
    this.box(1, 0.8, 0.6, 0x8b5a2b, 4.2, 0.4, -d + 2.2);
    this.box(1, 0.4, 0.6, 0x8b5a2b, 4.2, 0.2, -d + 2.8);
    this.box(1.7, 0.12, 1.7, 0xd9c27a, 4.2, 3.4, -d + 1.2);
    for (const [dx, dz] of [[-0.75, -0.75], [0.75, -0.75], [0.75, 0.75], [-0.75, 0.75]]) this.box(0.08, 2.2, 0.08, 0xd9c27a, 4.2 + dx!, 2.3, -d + 1.2 + dz!);
    // Colonnes
    for (const x of [-8, 8]) {
      for (const z of [-2, 3]) {
        this.box(0.6, 4, 0.6, 0xffffff, x, 2, z);
        this.box(0.9, 0.2, 0.9, 0xd9c27a, x, 3.9, z);
      }
    }
    // Déchaussoir près de la porte
    this.box(1.4, 0.7, 0.6, 0x7a5a3a, -9.6, 0.35, 5.3);
    for (let i = 0; i < 4; i++) this.box(0.22, 0.05, 0.5, i % 2 ? 0x1f6feb : 0x222222, -10.05 + i * 0.3, 0.75, 5.3);
    // Boîte d'aumône (sadaqa)
    this.box(0.6, 1, 0.6, 0x8b5a2b, -7.2, 0.5, 6.2);
    this.box(0.5, 0.4, 0.5, 0xcfe9ff, -7.2, 1.2, 6.2);
    const spots: SacredLayout['spots'] = [];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 9; k++) spots.push({ x: -4.4 + k * 1.1, z: -5.4 + r * 1.6 });
    this.sacred = {
      faith: 'mosque',
      seats: [],
      spots,
      playerPlace: 2 * 9 + 3,
      leader: { x: 4.2, y: 1.2, z: -d + 1.2, yaw: 0 },
      box: { x: -7.2, z: 6.2, top: 1.45, stand: { x: -7.2, z: 5.2 }, yaw: 0 },
    };
  }

  /** Villa : trois niveaux (rez-de-chaussée, étage 1, étage 2) construits à plat, un seul visible à la fois. */
  private buildVilla(room: (typeof ROOM)[InteriorKind]): void {
    const { w, d } = { w: this.half.w, d: this.half.d };
    for (let lvl = 0; lvl < 3; lvl++) {
      this.buildLevel = lvl;
      const before = this.scene.children.length;
      this.buildRoom(room, lvl === 0);
      this.furnishVilla(lvl, w, d);
      const group = new THREE.Group();
      for (const o of this.scene.children.slice(before)) group.add(o);
      this.scene.add(group);
      this.mergeStatic(group);
      group.visible = lvl === 0;
      this.levels.push(group);
    }
    this.buildLevel = 0;
  }

  /** Cloison basse (1,6 m) le long de x (à z fixe) ou de z (à x fixe), avec des passages libres. */
  private partition(axis: 'x' | 'z', from: number, to: number, at: number, gaps: [number, number][] = []): void {
    const H = 1.6;
    const cuts = [from, ...gaps.flatMap(([a, b]) => [a, b]), to];
    for (let i = 0; i < cuts.length; i += 2) {
      const a = cuts[i]!;
      const b = cuts[i + 1]!;
      if (b - a < 0.05) continue;
      const len = b - a;
      const mid = (a + b) / 2;
      if (axis === 'x') {
        this.box(len, H, 0.18, ROOM.VILLA.wall, mid, H / 2, at);
        this.box(len + 0.06, 0.06, 0.26, 0x5b3a1e, mid, H + 0.03, at);
      } else {
        this.box(0.18, H, len, ROOM.VILLA.wall, at, H / 2, mid);
        this.box(0.26, 0.06, len + 0.06, 0x5b3a1e, at, H + 0.03, mid);
      }
    }
  }

  /** Escalier : marches, plaque au pied (on marche dessus ou on touche l'escalier), repère « ↑ n » / « ↓ n ». */
  private stairs(level: number, steps: { x: number; z: number; dir: 'x' | 'z'; sign: 1 | -1 } | null, pad: { x: number; z: number }, to: number, arrive: { x: number; z: number }, zone: { x0: number; x1: number; z0: number; z1: number }): void {
    if (steps) {
      for (let i = 0; i < 6; i++) {
        const o = i * 0.7 * steps.sign;
        if (steps.dir === 'x') this.box(0.7, 0.3 * (i + 1), 1.4, 0xd9c7a8, steps.x + o, 0.15 * (i + 1), steps.z);
        else this.box(1.4, 0.3 * (i + 1), 0.7, 0xd9c7a8, steps.x, 0.15 * (i + 1), steps.z + o);
      }
    }
    this.box(1.2, 0.04, 1.2, to > level ? 0x22a861 : 0xf18f01, pad.x, 0.06, pad.z);
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 64;
    const g = cv.getContext('2d');
    if (g) {
      g.fillStyle = '#14213d';
      g.font = '900 48px system-ui, sans-serif';
      g.fillText(`${to > level ? '↑' : '↓'} ${to}`, 14, 50);
    }
    const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true });
    this.disposables.push(mat);
    const sp = new THREE.Sprite(mat);
    sp.scale.set(1.3, 0.65, 1);
    sp.position.set(pad.x, 1.5, pad.z);
    this.scene.add(sp);
    this.pads.push({ level, x: pad.x, z: pad.z, to, ax: arrive.x, az: arrive.z, zone });
  }

  private furnishVilla(lvl: number, w: number, d: number): void {
    const wax = (n: number) => this.mats.wax(n);
    const glass = new THREE.MeshLambertMaterial({ color: 0xcfe9ff, transparent: true, opacity: 0.35, depthWrite: false });
    this.disposables.push(glass);
    const windowAt = (x: number) => {
      this.box(2.8, 1.7, 0.05, 0xb9dcf4, x, 2.2, -d + 0.16);
      this.box(0.65, 2, 0.06, wax(1), x - 1.7, 2.2, -d + 0.2);
      this.box(0.65, 2, 0.06, wax(1), x + 1.7, 2.2, -d + 0.2);
    };
    if (lvl === 0) {
      // Salon : canapé face à la télé, tapis et table basse
      this.box(3.6, 0.05, 2.6, wax(5), -5, 0.05, -3.4);
      this.box(1.6, 0.4, 0.8, 0x8b5a2b, -5, 0.2, -3.4);
      this.poster(-9, 2.5, -d + 0.15, 0);
      this.box(4.5, 0.9, 1.5, 0x22a861, -5, 0.45, -1.2);
      this.box(4.5, 1, 0.4, 0x22a861, -5, 1.2, -0.5);
      this.box(3, 1.6, 0.2, 0x14213d, -5, 2.1, -d + 0.2);
      this.tvScreen = this.screen(2.8, 1.4, -5, 2.1, -d + 0.31);
      this.spots.sofa = { x: -5, z: -1.3, rot: Math.PI, y: -0.05 };
      // Salle à manger
      this.table(-4, 4.6, 1.2, 0xffffff);
      this.chair(-5.7, 4.6, 0xffffff, Math.PI / 2);
      this.chair(-2.3, 4.6, 0xffffff, -Math.PI / 2);
      this.spots.table = { x: -5.7, z: 4.6, rot: Math.PI / 2, y: -0.15 };
      // Cuisine fermée (fond à droite)
      this.partition('x', 4, w, -2.5, [[5.2, 7.2]]);
      this.partition('z', -d, -2.5, 4);
      this.box(1.4, 2.4, 1.2, 0xe9edf3, w - 1, 1.2, -d + 1); // frigo
      this.box(1.6, 0.9, 0.6, 0xc8ccd2, 6, 0.45, -d + 0.4);
      this.hob = { x: 6, z: -d + 0.4, y: 1.05 };
      this.spots.stove = { x: 6, z: -d + 1.5, rot: Math.PI, y: 0 };
      this.box(1.6, 0.9, 0.6, 0xc8ccd2, 7.8, 0.45, -d + 0.4);
      this.table(7.5, -4.6, 0.8, 0xc49a6c);
      // Salle d'eau : douche vitrée, lavabo, WC
      this.partition('x', -0.5, 3.5, -3.5, [[0.2, 1.6]]);
      this.partition('z', -d, -3.5, -0.5);
      this.box(1.6, 0.12, 1.6, 0xdfe7ef, 2.4, 0.06, -6.4);
      this.box(1.6, 2.4, 0.06, glass, 2.4, 1.2, -7.2);
      this.box(0.06, 2.4, 1.6, glass, 1.6, 1.2, -6.4);
      this.box(0.06, 2.4, 1.6, glass, 3.2, 1.2, -6.4);
      this.box(0.08, 0.5, 0.08, 0x9aa5b4, 2.4, 2.35, -7.0);
      this.spots.shower = { x: 2.4, z: -6.4, rot: 0, y: 0 };
      this.box(0.6, 0.5, 0.8, 0xffffff, 0.1, 0.25, -7.4);
      this.box(0.8, 0.9, 0.5, 0xffffff, -0.1, 0.45, -5.2);
      this.plant(-w + 1.2, -d + 1.5);
      this.plant(3, 2.2);
      this.plant(-w + 1.2, 2.5);
      this.fan(w - 1.2, 1.5);
      windowAt(-8);
      // Escalier vers l'étage 1
      this.stairs(0, { x: 6.6, z: 6.2, dir: 'x', sign: 1 }, { x: 4.8, z: 6.2 }, 1, { x: 8.8, z: 6.2 }, { x0: 6.2, x1: 10.5, z0: 5.4, z1: 7 });
    } else if (lvl === 1) {
      // Trois chambres au fond (cloisons basses, passages en façade)
      this.partition('x', -w, w, -1.5, [[-7.5, -6], [-1, 0.5], [6, 7.5]]);
      this.partition('z', -d, -1.5, -3.5);
      this.partition('z', -d, -1.5, 3.5);
      // Chambre parentale (le lit où l'on dort)
      this.bed(-7.5, -5.9, 3.4, 4);
      this.net(-7.5, -5.9, 3.4);
      this.bedLevel = 1;
      this.bedside(-10.3, -7.2, 0x6f4b32);
      this.wardrobe(-4.9, -7.4);
      windowAt(-7.5);
      // Chambre 2
      this.bed(0, -5.9, 2.6, 2);
      this.net(0, -5.9, 2.6);
      this.bedside(2.2, -7.2);
      this.wardrobe(-2.4, -7.4);
      windowAt(0);
      // Chambre 3
      this.bed(8, -5.9, 2.6, 3);
      this.net(8, -5.9, 2.6);
      this.bedside(10.1, -7.2);
      this.wardrobe(5, -7.4);
      windowAt(8);
      this.plant(-w + 1.2, -2.4);
      this.plant(4.2, -2.4);
      // Salle de bain
      this.partition('x', -w, -6.5, 2);
      this.partition('z', 2, d, -6.5, [[4.5, 6.2]]);
      this.box(2.2, 0.7, 1, 0xffffff, -9.5, 0.35, 7.2);
      this.box(0.6, 0.5, 0.8, 0xffffff, -10.3, 0.25, 3.2);
      this.box(0.8, 0.9, 0.5, 0xffffff, -8.2, 0.45, 2.6);
      // Petit salon et bureau
      this.box(3.6, 0.8, 1.2, 0x1f6feb, -1, 0.4, 6.8);
      this.box(3.6, 0.9, 0.3, 0x1f6feb, -1, 1.1, 7.4);
      this.box(1.4, 0.4, 0.8, 0x8b5a2b, -1, 0.2, 5.2);
      this.box(2.2, 0.8, 0.9, 0x8b5a2b, 1.8, 0.4, 2.4);
      this.chair(1.8, 3.4, 0xe5383b, Math.PI);
      this.plant(-4.5, 6.8);
      // Rampe de l'escalier du rez-de-chaussée (descente) et escalier vers l'étage 2
      this.box(3.8, 0.9, 0.08, 0xa67c52, 8.3, 0.45, 5.2);
      this.stairs(1, null, { x: 10, z: 6.2 }, 0, { x: 3.4, z: 6.2 }, { x0: 9.2, x1: 10.5, z0: 5.5, z1: 7 });
      this.stairs(1, { x: 5.9, z: 2.4, dir: 'x', sign: 1 }, { x: 4.4, z: 2.4 }, 2, { x: 8.8, z: 2.4 }, { x0: 5.5, x1: 10.2, z0: 1.6, z1: 3.2 });
    } else {
      // Étage 2 : suite parentale, bibliothèque, billard et grand salon-bar
      this.partition('x', -w, -2, -1.5, [[-7, -5.5]]);
      this.partition('z', -d, -1.5, -2);
      this.bed(-6.5, -5.9, 3.4, 1);
      this.net(-6.5, -5.9, 3.4);
      this.bedside(-9.2, -7.2, 0x6f4b32);
      this.wardrobe(-3.3, -7.4);
      windowAt(-6.5);
      this.box(6, 2.4, 0.5, 0x8b5a2b, 5, 1.2, -d + 0.45); // bibliothèque
      for (let i = 0; i < 12; i++) this.box(0.3, 0.5, 0.3, [0xd21034, 0x1f6feb, 0x22a861, 0xf18f01][i % 4]!, 2.6 + i * 0.4, 1.6, -d + 0.75);
      this.box(3.4, 0.9, 1.9, 0x1f7a4d, 6.5, 0.45, -4); // billard
      this.box(3.6, 0.12, 2.1, 0x5b3a1e, 6.5, 0.9, -4);
      this.box(4.2, 1.1, 0.8, 0x704321, 6, 0.55, 6.6); // bar
      for (const x of [4.6, 6, 7.4]) this.chair(x, 5.5, 0xffffff, Math.PI);
      this.box(3.6, 0.8, 1.2, 0x22a861, -5, 0.4, 5.2);
      this.box(3.6, 0.9, 0.3, 0x22a861, -5, 1.1, 5.8);
      this.box(1.6, 0.4, 0.8, 0x8b5a2b, -5, 0.2, 3.6);
      this.plant(-w + 1.2, d - 1.5);
      this.plant(w - 1.2, 2);
      this.fan(-1, 2.5);
      this.stairs(2, null, { x: 10, z: 2.4 }, 1, { x: 3.4, z: 2.4 }, { x0: 9.2, x1: 10.5, z0: 1.7, z1: 3.1 });
    }
  }

  private furnish(kind: InteriorKind): void {
    const { w, d } = { w: this.half.w, d: this.half.d };
    switch (kind) {
      case 'ENTRER_COUCHER':
        // Une seule pièce : matelas mousse au sol, moustiquaire, seau, réchaud, valise.
        // En mode `custom`, ces meubles sont ceux du joueur (déplaçables, rangeables, donnables) : setFurniture les dessine.
        if (!this.custom) {
          this.box(2.05, 0.14, 3.05, 0x8b6b43, -w + 1.6, 0.07, -d + 2);
          this.box(2, 0.3, 3, 0xf3efe6, -w + 1.6, 0.23, -d + 2);
          this.box(1.9, 0.08, 2.15, this.mats.wax(2), -w + 1.6, 0.42, -d + 2.35);
          this.box(0.9, 0.18, 0.55, 0xfffcf5, -w + 1.6, 0.48, -d + 0.75);
          this.bedSpot = { x: -w + 1.6, z: -d + 1.2, y: 0.45 };
          this.net(-w + 1.6, -d + 2, 2);
          this.box(0.7, 0.8, 0.7, 0x1f6feb, w - 1.2, 0.4, -d + 1); // seau d'eau
          this.jerrycans(w - 2.6, -d + 0.6, 2);
          this.chair(0.6, -d + 1.2, 0xe5383b);
          this.spots.table = { x: 0.6, z: -d + 1.2, rot: 0, y: -0.15 };
          this.box(1.1, 0.6, 0.4, 0x5b3a1e, 1.6, 0.3, -d + 0.4); // valise
          // Coin cuisine : caisse et fourneau posé dessus
          this.box(1.1, 0.5, 0.6, 0x7a5a3a, 3.2, 0.25, -d + 0.6);
          const brazier = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.28, 0.2, 0.2, 12)), this.mats.color(0x555b66));
          brazier.position.set(3.2, 0.6, -d + 0.6);
          this.scene.add(brazier);
          this.hob = { x: 3.2, z: -d + 0.6, y: 0.72 };
          this.spots.stove = { x: 3.2, z: -d + 1.9, rot: Math.PI, y: 0 };
          this.fan(w - 1, d - 2);
        }
        this.poster(0.5, 2.4, -d + 0.15, 4);
        break;
      case 'CHAMBRE_SALON':
        if (!this.custom) {
          this.bed(-w + 2, -d + 2, 2.6, 0);
          this.net(-w + 2, -d + 2, 2.6);
          this.bedside(-w + 4.05, -d + 2.7);
          this.wardrobe(-w + 5.2, -d + 0.6);
          this.kitchen(w - 2.5, d - 1);
          this.hob = { x: w - 2.8, z: d - 1, y: 1.26 };
          this.spots.stove = { x: w - 2.8, z: d - 2.3, rot: 0, y: 0 };
          // Bidons d'eau rangés contre la cloison, côté salon, pas au milieu du sol
          for (let i = 0; i < 2; i++) this.box(0.3, 0.65, 0.45, [0xffce00, 0x22a861][i]!, 1.2, 0.33, -2.1 - i * 0.55);
        }
        this.poster(-w + 7.4, 2.4, -d + 0.15, 1);
        if (!this.custom) {
          // Table du salon devant la cloison, hors du passage vers la chambre et de la place du réchaud
          this.table(2.2, 0.9, 0.9, 0xc49a6c);
          this.chair(1.05, 1.1, 0xe5383b, Math.PI / 2);
          this.spots.table = { x: 1.05, z: 1.1, rot: Math.PI / 2, y: -0.15 };
          this.chair(3.35, 0.7, 0xe5383b, -Math.PI / 2);
          this.box(2, 1.2, 0.2, 0x14213d, w - 2, 1.8, -d + 0.2); // télé
          this.tvScreen = this.screen(1.8, 1, w - 2, 1.8, -d + 0.31);
          this.chair(w - 2, -d + 3.2, 0x8b5a2b, Math.PI); // chaise face à la télé
          this.spots.sofa = { x: w - 2, z: -d + 3.2, rot: Math.PI, y: -0.15 };
          this.box(2.2, 0.9, 0.7, 0x8b5a2b, w - 2, 0.45, -d + 0.6);
          this.box(0.8, 0.9, 0.8, 0x1f6feb, w - 1, 0.45, d - 1.5);
          this.fan(-w + 0.8, -d + 4.7, 0.5); // contre le mur, au pied du lit (jamais sur le lit)
          this.plant(w - 1, -d + 2.5);
        }
        // Deux pièces : cloison entre la chambre et le salon, passage fermé par un rideau en pagne
        this.box(0.2, 3.2, 3.3, ROOM.CHAMBRE_SALON.wall, 0.9, 1.6, -d + 1.65);
        this.box(0.06, 2.4, 1.3, this.mats.wax(3), 0.9, 1.2, -d + 3.95);
        // Rideau et fenêtre de chambre pour casser l'effet de boîte fermée.
        this.box(2.2, 1.5, 0.05, 0x9fd0ff, -w + 2.1, 2.15, -d + 0.16);
        this.box(0.55, 1.85, 0.06, this.mats.wax(4), -w + 0.8, 2.15, -d + 0.2);
        this.box(0.55, 1.85, 0.06, this.mats.wax(4), -w + 3.4, 2.15, -d + 0.2);
        break;
      case 'VILLA':
        break; // meublée par buildVilla (plusieurs étages)
      case 'maquis': {
        this.box(6, 1.3, 1.2, 0x8b5a2b, w - 4, 0.65, -d + 1.5); // comptoir
        this.box(1.2, 2.2, 1, 0x14213d, -w + 1.5, 1.1, -d + 1.2); // enceinte
        for (let i = 0; i < 4; i++) {
          const tx = -w + 4 + (i % 2) * 7;
          const tz = -1 + Math.floor(i / 2) * 5;
          this.table(tx, tz, 0.9, 0xffffff);
          this.chair(tx - 1.3, tz, 0xe5383b, Math.PI / 2);
          this.chair(tx + 1.3, tz, 0x1f6feb, -Math.PI / 2);
          if (i === 1) this.spots.table = { x: tx + 1.3, z: tz, rot: -Math.PI / 2, y: -0.15 };
          this.extra(tx - 1.3, tz, true, Math.PI / 2);
          if (i % 2 === 0) this.extra(tx + 1.3, tz, true, -Math.PI / 2);
        }
        this.extra(w - 4, -d + 0.4, false); // serveuse
        this.extra(0, 2, false);
        this.furnishDisco();
        break;
      }
      case 'church':
        this.furnishChurch();
        break;
      case 'mosque':
        this.furnishMosque();
        break;
      case 'clinic':
        for (let i = 0; i < 3; i++) this.bed(-w + 2.5 + i * 4, -d + 2.5, 2.2, 4);
        this.box(3, 1.1, 1, 0xffffff, w - 2.5, 0.55, 2);
        this.extra(w - 2.5, 0.8, false, Math.PI); // infirmière
        for (let i = 0; i < 4; i++) {
          this.chair(-w + 3.6 + i * 1.3, d - 1.6, 0x1f6feb, Math.PI);
          if (i % 2) this.extra(-w + 3.6 + i * 1.3, d - 1.6, true, Math.PI);
        }
        break;
      case 'campus':
        this.box(8, 2.4, 0.15, 0x14532d, 0, 2.2, -d + 0.2); // tableau
        for (let r = 0; r < 3; r++) {
          this.box(w * 1.4, 0.9, 0.9, 0x8b5a2b, 0, 0.45, -d + 3.5 + r * 2.6);
          for (let s = 0; s < 4; s++) if ((r + s) % 2 === 0) this.extra(-w * 0.6 + s * 3, -d + 4.4 + r * 2.6, true, Math.PI);
        }
        this.extra(-3, -d + 1.2, false); // enseignant
        break;
      case 'shop': {
        // Rayons garnis de produits colorés, frigos lumineux, caisse et caissière
        const r = rng(91);
        const colors = [0xe5383b, 0x1f6feb, 0xffce00, 0x22a861, 0xf18f01, 0xffffff, 0x8e44ad, 0x14213d];
        for (let row = 0; row < 3; row++) {
          const z = -d + 3.2 + row * 2.6;
          this.box(w * 1.1, 1.8, 0.7, 0xdfe4ea, -1, 0.9, z);
          for (let lvl = 0; lvl < 3; lvl++) {
            for (let i = 0; i < 16; i++) {
              const px = -1 - w * 0.53 + 0.3 + i * ((w * 1.06) / 16);
              const c = colors[Math.floor(r() * colors.length)]!;
              const h = 0.25 + r() * 0.2;
              for (const side of [-1, 1]) {
                const m = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.42, h, 0.22)), this.mats.color(c));
                m.position.set(px, 0.42 + lvl * 0.55 + h / 2, z + side * 0.42);
                this.scene.add(m);
              }
            }
          }
        }
        // Frigos vitrés au fond
        const glow = new THREE.MeshLambertMaterial({ color: 0xcfe9ff, emissive: 0x9fd0ff, emissiveIntensity: 0.5 });
        this.disposables.push(glow);
        for (let i = 0; i < 4; i++) {
          this.box(1.6, 2.4, 0.9, 0xffffff, w - 1 - i * 1.7, 1.2, -d + 0.65);
          const door = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.4, 2, 0.05)), glow);
          door.position.set(w - 1 - i * 1.7, 1.25, -d + 1.12);
          this.scene.add(door);
        }
        // Caisse près de l'entrée
        this.box(2.6, 1, 1, 0x14213d, -w + 3.2, 0.5, d - 3);
        this.box(0.5, 0.4, 0.4, 0x222222, -w + 2.6, 1.2, d - 3);
        this.extra(-w + 3.2, d - 4, false, 0);
        this.extra(2, -d + 4.5, false, Math.PI / 2);
        this.extra(-3, -d + 7, false, -Math.PI / 2);
        break;
      }
      case 'studio':
        this.furnishStudio(false);
        break;
      case 'studioPhoto':
        this.furnishStudio(true);
        break;
      case 'hotel':
        this.furnishHotel(w, d);
        break;
      case 'office':
        this.box(w * 1.2, 1.2, 1, 0xffffff, 0, 0.6, -d + 2);
        this.box(w * 1.2, 0.3, 1.1, 0x1f6feb, 0, 1.3, -d + 2);
        this.extra(-2, -d + 1, false);
        this.extra(2, -d + 1, false);
        for (let i = 0; i < 5; i++) {
          this.chair(-4 + i * 2, d - 2, 0x9aa5b4, Math.PI);
          if (i % 2 === 0) this.extra(-4 + i * 2, d - 2, true, Math.PI);
        }
        break;
    }
  }

  /**
   * Hall d'hôtel de luxe (Hôtel du 2 Février, hôtels partenaires) : réception en bois sombre au plateau de marbre devant un mur
   * rétroéclairé à l'enseigne, colonnes de marbre cerclées d'or, deux lustres, salon (canapés, fauteuils, table basse en verre,
   * bouquet) sur un grand tapis rond bleu, ascenseurs à gauche, palmiers en pot, chariot à bagages doré ; réceptionnistes et clients.
   */
  private furnishHotel(w: number, d: number): void {
    const gold = 0xc9a24a;
    const wood = 0x4a2e1c;
    const marble = 0xf4f1ea;
    // Mur de réception en bois, enseigne lumineuse
    this.box(9, 3.4, 0.12, 0x6b4423, 0, 2, -d + 0.2);
    for (const dx of [-4.5, 4.5]) this.box(0.12, 3.4, 0.16, gold, dx, 2, -d + 0.22);
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 256;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 1024, 256);
    g.save();
    g.translate(380, 110);
    g.transform(1, 0, -0.32, 1, 0, 0);
    g.font = 'italic 700 150px "Brush Script MT", "Segoe Script", Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#f6d36b';
    g.fillText('Radisson', 0, 0);
    g.restore();
    g.fillStyle = '#2f5bea';
    g.fillRect(700, 40, 130, 130);
    g.fillStyle = '#ffffff';
    g.font = '700 46px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('BLU', 765, 106);
    g.fillStyle = '#f0d27a';
    g.font = '700 42px Ubuntu, Arial, sans-serif';
    g.fillText('HÔTEL 2 FÉVRIER', 512, 218);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(6, 1.5)), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    sign.position.set(0, 2.6, -d + 0.3);
    this.scene.add(sign);
    // Comptoir : caisson bois, plateau de marbre, filet doré
    this.box(7, 1.1, 0.9, wood, 0, 0.55, -d + 2.2);
    this.box(7.3, 0.08, 1.05, marble, 0, 1.14, -d + 2.2);
    this.box(7.02, 0.06, 0.04, gold, 0, 0.9, -d + 1.74);
    this.extra(-1.6, -d + 1.2, false);
    this.extra(1.6, -d + 1.2, false);
    // Petite sonnette et bouquet sur le comptoir
    const bell = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)), this.mats.color(gold));
    bell.position.set(2.6, 1.18, -d + 2.1);
    this.scene.add(bell);
    // Colonnes de marbre cerclées d'or
    for (const [cx, cz] of [[-5, -d + 4.5], [5, -d + 4.5], [-5, d - 3.5], [5, d - 3.5]] as const) {
      const col = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.38, 0.38, 4, 18)), this.mats.color(marble));
      col.position.set(cx, 2, cz);
      col.castShadow = this.profile.shadows;
      this.scene.add(col);
      this.blocks.push({ x: cx, z: cz, hw: 0.4, hd: 0.4, lvl: this.buildLevel });
      for (const yy of [0.12, 3.85]) {
        const ring = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.48, 0.48, 0.24, 18)), this.mats.color(gold));
        ring.position.set(cx, yy, cz);
        this.scene.add(ring);
      }
    }
    // Lustres : couronne dorée et ampoules chaudes
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff1c4 });
    for (const lx of [-3.2, 3.2]) {
      const ring = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.75, 0.05, 6, 24)), this.mats.color(gold));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(lx, 3.25, 0.4);
      this.scene.add(ring);
      const rod = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6)), this.mats.color(gold));
      rod.position.set(lx, 3.6, 0.4);
      this.scene.add(rod);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const b = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.09, 8, 6)), bulbMat);
        b.position.set(lx + Math.cos(a) * 0.75, 3.15, 0.4 + Math.sin(a) * 0.75);
        this.scene.add(b);
      }
      const drop = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.28, 0.6, 12)), new THREE.MeshBasicMaterial({ color: 0xfff6dc }));
      drop.rotation.x = Math.PI;
      drop.position.set(lx, 3.0, 0.4);
      this.scene.add(drop);
    }
    // Grand tapis rond bleu bordé d'or, salon au centre
    const rug = new THREE.Mesh(this.geo(new THREE.CircleGeometry(3.1, 40)), this.mats.color(0x1f3c8f));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0.5, 0.05, 1.2);
    this.scene.add(rug);
    const rugRim = new THREE.Mesh(this.geo(new THREE.RingGeometry(2.95, 3.1, 48)), this.mats.color(gold));
    rugRim.rotation.x = -Math.PI / 2;
    rugRim.position.set(0.5, 0.06, 1.2);
    this.scene.add(rugRim);
    const sofa = (sx: number, sz: number, rot: number) => {
      const grp = new THREE.Group();
      const seat = new THREE.Mesh(this.geo(new THREE.BoxGeometry(2.4, 0.45, 0.9)), this.mats.color(0xe8dcc5));
      seat.position.y = 0.32;
      const back = new THREE.Mesh(this.geo(new THREE.BoxGeometry(2.4, 0.7, 0.22)), this.mats.color(0xe0d2b8));
      back.position.set(0, 0.75, -0.36);
      grp.add(seat, back);
      for (const ax of [-1.22, 1.22]) {
        const arm = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.22, 0.6, 0.9)), this.mats.color(0xe0d2b8));
        arm.position.set(ax, 0.45, 0);
        grp.add(arm);
      }
      for (const cx2 of [-0.6, 0.6]) {
        const cushion = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.42, 0.42, 0.14)), this.mats.color(0x2f5bea));
        cushion.position.set(cx2, 0.72, -0.2);
        cushion.rotation.x = -0.25;
        grp.add(cushion);
      }
      grp.position.set(sx, 0, sz);
      grp.rotation.y = rot;
      grp.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = this.profile.shadows;
      });
      this.scene.add(grp);
      const along = Math.abs(Math.sin(rot)) < 0.5;
      this.blocks.push({ x: sx, z: sz, hw: along ? 1.3 : 0.5, hd: along ? 0.5 : 1.3, lvl: this.buildLevel });
    };
    sofa(0.5, -0.6, 0);
    sofa(0.5, 3.0, Math.PI);
    this.chair(-2.1, 1.2, 0x2f5bea, Math.PI / 2);
    this.chair(3.1, 1.2, 0x2f5bea, -Math.PI / 2);
    // Table basse en verre, pieds dorés, bouquet
    this.box(1.6, 0.05, 0.9, 0xbfe3f2, 0.5, 0.45, 1.2);
    for (const [tx, tz] of [[-0.2, 0.85], [1.2, 0.85], [-0.2, 1.55], [1.2, 1.55]] as const) this.box(0.05, 0.42, 0.05, gold, tx, 0.22, tz);
    const vase = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.1, 0.14, 0.3, 10)), this.mats.color(0xffffff));
    vase.position.set(0.5, 0.62, 1.2);
    this.scene.add(vase);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const fl = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.09, 8, 6)), this.mats.color(k % 2 ? 0xe5383b : 0xffce00));
      fl.position.set(0.5 + Math.cos(a) * 0.12, 0.86 + (k % 3) * 0.04, 1.2 + Math.sin(a) * 0.12);
      this.scene.add(fl);
    }
    // Clients au salon
    this.extra(0.0, -0.6, true, 0);
    this.extra(1.2, 3.0, true, Math.PI);
    // Ascenseurs à gauche : portes métal, cadre doré, voyant
    for (const ez of [-d + 4, -d + 6.4]) {
      this.box(0.08, 2.4, 1.5, 0xc4c8cd, -w + 0.2, 1.2, ez);
      this.box(0.1, 2.6, 0.08, gold, -w + 0.22, 1.3, ez - 0.79);
      this.box(0.1, 2.6, 0.08, gold, -w + 0.22, 1.3, ez + 0.79);
      this.box(0.1, 0.08, 1.66, gold, -w + 0.22, 2.6, ez);
      const lamp = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.06, 10)), bulbMat);
      lamp.position.set(-w + 0.27, 2.8, ez);
      lamp.rotation.y = Math.PI / 2;
      this.scene.add(lamp);
    }
    // Palmiers en pot aux angles et près de l'entrée
    this.plant(w - 1.2, -d + 1.2);
    this.plant(-w + 1.4, -d + 1.4);
    this.plant(w - 1.2, d - 1.6);
    this.plant(-3.2, d - 1.2);
    // Chariot à bagages doré avec valises, client qui arrive
    this.box(1.1, 0.08, 0.6, gold, w - 3, 0.25, d - 3.2);
    for (const px of [-0.5, 0.5]) this.box(0.05, 1.6, 0.05, gold, w - 3 + px, 1.05, d - 3.2);
    this.box(1.1, 0.05, 0.05, gold, w - 3, 1.85, d - 3.2);
    this.box(0.7, 0.5, 0.3, 0x1f2a44, w - 3, 0.55, d - 3.2);
    this.box(0.5, 0.4, 0.28, 0x8a2b2b, w - 3, 1.0, d - 3.2);
    this.extra(w - 4.2, d - 3, false, Math.PI);
  }

  private readonly onDown = (e: PointerEvent): void => {
    this.downAt = { x: e.clientX, y: e.clientY };
    this.dragging = false;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      this.pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      this.dragging = true; // à deux doigts : pas de déplacement du personnage
    }
  };

  /** Glisser fait tourner la pièce (horizontalement) et l'incline (verticalement) ; deux doigts zooment. */
  private readonly onMove = (e: PointerEvent): void => {
    const prev = this.touches.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    this.touches.set(e.pointerId, next);
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (this.pinch > 0 && d > 0) this.camZoom = THREE.MathUtils.clamp((this.camZoom * this.pinch) / d, 0.45, 1.6);
      this.pinch = d;
      this.placeCamera();
      return;
    }
    const d0 = this.downAt;
    if (!d0 || (!this.dragging && Math.hypot(e.clientX - d0.x, e.clientY - d0.y) <= 12)) return;
    this.dragging = true;
    this.camAz -= (next.x - prev.x) * 0.008;
    this.camEl = THREE.MathUtils.clamp(this.camEl + (next.y - prev.y) * 0.006, 0.3, 1.35);
    this.placeCamera();
  };

  private readonly onCancel = (e: PointerEvent): void => {
    this.touches.delete(e.pointerId);
    this.downAt = null;
    this.dragging = false;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.camZoom = THREE.MathUtils.clamp(this.camZoom * (e.deltaY > 0 ? 1.08 : 0.92), 0.45, 1.6);
    this.placeCamera();
  };

  /** Scène de sommeil : le personnage se couche dans le lit, lumière tamisée, « Zzz », puis se relève. */
  private readonly onSleep = (): void => this.lieDown(Infinity);

  private clinicCtx() {
    return { scene: this.scene, mats: this.mats, rand: this.rand, geos: this.geos, disposables: this.disposables, open: this.open };
  }

  /** Consultation jouée après un acte médical payé (événement de l'écran de jeu) : seulement dans une clinique ouverte. */
  private readonly onConsult = (e: Event): void => {
    const detail = (e as CustomEvent<ConsultDetail>).detail;
    if (this.roomKind !== 'clinic' || !this.open || this.consultation || this.sleepUntil || this.worship) return detail.onDone?.();
    this.consult(detail).then(() => detail.onDone?.(), () => detail.onDone?.());
  };

  /** Examen, résultats puis ordonnance, sous les yeux du joueur ; résolue à la fin de la scène. */
  consult(detail: ConsultDetail): Promise<void> {
    if (this.consultation) return Promise.resolve();
    if (this.act) this.endAct();
    return new Promise((resolve) => {
      const end = () => {
        this.consultDone = null;
        this.target.copy(this.player.position);
        this.routeFor.set(1e9, 0, 1e9);
        resolve();
      };
      this.consultDone = end;
      this.consultation = new Consultation(this.clinicCtx(), this.player, detail.labels, detail.phases, () => {
        this.consultation = null;
        end();
      });
    });
  }

  /** Salle d'hospitalisation : le patient s'allonge dans son lit et les soignants passent le voir ; false = il se lève. */
  setWard(on: boolean): void {
    if (this.roomKind !== 'clinic' || on === this.wardOn) return;
    this.wardOn = on;
    if (on) {
      this.ward ??= this.bedSpot ? new Ward(this.clinicCtx(), this.bedSpot) : null;
      // Hospitalisé : aucune consultation ni activité en cours ne doit garder le patient debout
      this.consultDone?.();
      this.consultation = null;
      this.endAct();
      this.setAsleep(true);
      // Le SAMU l'a déjà installé : il est allongé dès l'arrivée, sans marcher jusqu'au lit
      if (this.bedAnim?.kind === 'down') this.bedAnim.t0 = performance.now() - this.bedAnim.dur;
    } else this.setAsleep(false);
  }

  /** Nuit en cours côté serveur (aussi après un rechargement) : couché tant qu'elle dure, debout ensuite. */
  setAsleep(on: boolean): void {
    if (on && this.sleepUntil !== Infinity) this.lieDown(Infinity);
    // Hospitalisé : la fin de « la nuit » ne le relève pas, seule la sortie de la salle de soins (setWard(false)) le fait
    else if (!on && this.sleepUntil === Infinity && !this.wardOn) this.wakeUp();
  }

  private lieDown(ms: number): void {
    if (!this.bedSpot) return;
    this.endAct();
    if (this.levels.length > 0 && this.level !== this.bedLevel) this.setLevel(this.bedLevel, this.bedSpot.x, this.bedSpot.z + 2.4);
    const p = this.player;
    animateWalk(p, 0, 0);
    // Il va au bord du lit, s'assoit, puis s'allonge (une sieste de quelques secondes laisse aussi le temps de se coucher)
    this.bedAnim = { kind: 'down', t0: performance.now(), dur: 2400, from: p.position.clone() };
    this.target.set(this.bedSpot.x, 0, this.bedSpot.z + 0.85);
    this.sleepUntil = performance.now() + ms + 2400;
    if (!this.zzz) {
      const cv = document.createElement('canvas');
      cv.width = 128;
      cv.height = 64;
      const g = cv.getContext('2d');
      if (g) {
        g.fillStyle = '#1f6feb';
        g.font = '900 44px system-ui, sans-serif';
        g.fillText('Zzz', 8, 48);
      }
      const tex = new THREE.CanvasTexture(cv);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      this.disposables.push(mat);
      this.zzz = new THREE.Sprite(mat);
      this.zzz.scale.set(1.2, 0.6, 1);
      this.scene.add(this.zzz);
    }
    this.zzz.visible = true;
    this.zzz.position.set(this.bedSpot.x, 2, this.bedSpot.z - 1);
  }

  /** Écran de télé à part (non fusionné) : il s'allume quand on regarde. */
  private screenObjs: THREE.Object3D[] = [];
  private screen(w: number, h: number, x: number, y: number, z: number, rotY = 0): THREE.MeshLambertMaterial {
    const mat = new THREE.MeshLambertMaterial({ color: 0x0b1020, emissive: 0x6fb8ff, emissiveIntensity: 0 });
    this.disposables.push(mat);
    if (!this.tvCanvas) {
      const cv = document.createElement('canvas');
      cv.width = 192;
      cv.height = 108;
      const ctx2 = cv.getContext('2d');
      if (ctx2) {
        const tex = new THREE.CanvasTexture(cv);
        this.tvCanvas = { ctx: ctx2, tex, last: 0, slot: -1, flash: 0, idle: false };
        mat.emissiveMap = tex;
        mat.emissive.set(0xffffff);
      }
    }
    const m = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(w, h)), mat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    this.scene.add(m);
    // Voyant rouge de veille, en bas à droite du cadre
    const led = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.07, 0.04, 0.03)), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    this.disposables.push(led.material as THREE.Material);
    const lx = w / 2 - 0.15;
    led.position.set(x + lx * Math.cos(rotY) + 0.01 * Math.sin(rotY), y - h / 2 - 0.06, z - lx * Math.sin(rotY) + 0.01 * Math.cos(rotY));
    led.rotation.y = rotY;
    this.scene.add(led);
    this.screenObjs.push(m, led);
    return mat;
  }

  /** Télé : allumée seulement pendant qu'on la regarde, avec des programmes qui défilent comme sur les panneaux de la ville. */
  private updateTv(now: number): void {
    if (!this.tvScreen || !this.tvCanvas) return;
    // Éteinte tant qu'on ne la regarde pas ; allumée avec des programmes qui défilent pendant le visionnage
    if (!(this.act?.kind === 'tv' && this.act.doing)) {
      this.tvCanvas.slot = -1;
      // Veille : verre sombre bleuté avec un reflet de fenêtre, au lieu d'un aplat noir
      if (!this.tvCanvas.idle) {
        const g = this.tvCanvas.ctx;
        const grad = g.createLinearGradient(0, 0, 192, 108);
        grad.addColorStop(0, '#26344d');
        grad.addColorStop(0.55, '#141c2c');
        grad.addColorStop(1, '#0c111c');
        g.fillStyle = grad;
        g.fillRect(0, 0, 192, 108);
        g.fillStyle = 'rgba(255,255,255,0.10)';
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(90, 0);
        g.lineTo(30, 108);
        g.lineTo(0, 108);
        g.fill();
        this.tvCanvas.tex.needsUpdate = true;
        this.tvCanvas.idle = true;
      }
      this.tvScreen.emissiveIntensity = 0.55;
      return;
    }
    this.tvCanvas.idle = false;
    this.drawTv(now);
    const f = Math.min(1, (now - this.tvCanvas.flash) / 400);
    this.tvScreen.emissiveIntensity = 1.1 * (0.35 + 0.65 * f);
  }

  /** Dessine une image de la télé : chaîne choisie selon le temps (changement toutes les ~5 s, avec un court grésillement). */
  private drawTv(now: number): void {
    const tv = this.tvCanvas;
    if (!tv || now - tv.last < 90) return;
    tv.last = now;
    // Comme les écrans des panneaux : programme suivant toutes les 8 s, avec un bref allumage
    const slotNow = Math.floor(now / 8000);
    if (slotNow !== tv.slot) {
      tv.slot = slotNow;
      tv.flash = now;
    }
    const g = tv.ctx;
    const W = 192;
    const H = 108;
    const ch = slotNow % 3;
    const t = now / 1000;
    if (now - tv.flash < 220) {
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgb(${(Math.random() * 255) | 0},${(Math.random() * 255) | 0},${(Math.random() * 255) | 0})`;
        g.fillRect(Math.random() * W, Math.random() * H, 30, 6);
      }
    } else if (ch === 0) {
      // Journal télévisé : fond bleu, présentateur, bandeau défilant
      g.fillStyle = '#12306b';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#e8b896';
      g.beginPath();
      g.arc(W * 0.35, 40, 14, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2a2a38';
      g.fillRect(W * 0.35 - 20, 54, 40, 34);
      g.fillStyle = '#fff';
      g.fillRect(W * 0.62, 24, 52, 38);
      g.fillStyle = '#d21034';
      g.fillRect(0, H - 22, W, 22);
      g.fillStyle = '#fff';
      g.font = '700 13px system-ui';
      g.fillText('TVT · INFOS · LOMÉ · MÉTÉO · SPORT ·', ((-t * 40) % 260) + 200, H - 7);
    } else if (ch === 1) {
      // Football : pelouse, lignes, balle et joueurs qui bougent
      g.fillStyle = '#2d8a3e';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = '#ffffffcc';
      g.lineWidth = 2;
      g.strokeRect(8, 8, W - 16, H - 16);
      g.beginPath();
      g.moveTo(W / 2, 8);
      g.lineTo(W / 2, H - 8);
      g.stroke();
      g.beginPath();
      g.arc(W / 2, H / 2, 16, 0, Math.PI * 2);
      g.stroke();
      for (let i = 0; i < 6; i++) {
        g.fillStyle = i % 2 ? '#ffce00' : '#006a4e';
        g.fillRect(30 + i * 24 + Math.sin(t * 2 + i) * 8, 30 + (i % 3) * 22 + Math.cos(t * 1.7 + i) * 6, 7, 11);
      }
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(W / 2 + Math.sin(t * 1.6) * 60, H / 2 + Math.cos(t * 2.1) * 26, 4, 0, Math.PI * 2);
      g.fill();
    } else {
      // Clip musical : dégradé qui tourne et barres d'égaliseur
      const hue = (t * 40) % 360;
      g.fillStyle = `hsl(${hue},70%,35%)`;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 16; i++) {
        const h = 14 + Math.abs(Math.sin(t * 3 + i * 0.7)) * 70;
        g.fillStyle = `hsl(${(hue + i * 14) % 360},90%,62%)`;
        g.fillRect(8 + i * 11, H - 8 - h, 8, h);
      }
    }
    tv.tex.needsUpdate = true;
  }

  /** Petit texte flottant (♪, Zzz, vapeur…) au-dessus d'un point. */
  private label(text: string, color: string, x: number, y: number, z: number): THREE.Sprite {
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 64;
    const g = cv.getContext('2d');
    if (g) {
      g.fillStyle = color;
      g.font = '900 44px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(text, 64, 48);
    }
    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    this.disposables.push(mat);
    const sp = new THREE.Sprite(mat);
    sp.scale.set(1.2, 0.6, 1);
    sp.position.set(x, y, z);
    this.scene.add(sp);
    return sp;
  }

  /** Change de niveau (villa) : le personnage réapparaît à l'arrivée de l'escalier. */
  private setLevel(to: number, ax: number, az: number): void {
    if (this.levels.length === 0) return;
    this.level = to;
    this.levels.forEach((g, i) => (g.visible = i === to));
    this.player.position.set(ax, 0, az);
    this.target.copy(this.player.position);
    this.padCool = performance.now() + 1200;
  }

  private readonly onStop = (): void => {
    if (this.act?.doing) this.endAct();
  };

  private readonly onAct = (e: Event): void => {
    const kind = (e as CustomEvent<HomeAct>).detail;
    if (this.sleepUntil) return;
    // Toute nouvelle activité (télé, musique, repas…) met fin à la précédente, lecture comprise : pas de bouton « poser le livre »
    if (this.act?.doing) this.endAct();
    if (kind === 'nap') return this.lieDown(6000);
    if (this.levels.length > 0 && this.level !== 0) this.setLevel(0, 3.4, 6.2);
    const door: Spot = { x: -this.half.w + 1.2, z: this.half.d - 1.2, rot: -Math.PI / 2, y: 0 };
    const spot = kind === 'wash' ? (this.spots.shower ?? door) : kind === 'eat' ? (this.spots.table ?? this.spots.sofa) : (this.spots.sofa ?? this.spots.table);
    if (!spot) return;
    this.endAct();
    this.act = { kind, spot, doing: false, started: performance.now(), until: 0, props: [] };
    this.target.set(spot.x, 0, spot.z);
  };

  private readonly onCook = (e: Event): void => {
    const detail = (e as CustomEvent<CookDetail>).detail;
    if (this.sleepUntil) return;
    if (this.act?.doing) this.endAct();
    if (this.levels.length > 0 && this.level !== 0) this.setLevel(0, 3.4, 6.2);
    const spot = this.spots.stove;
    // Pas de coin cuisine dans cette pièce : il passe directement à table
    if (!spot || !this.hob) return this.onAct(new CustomEvent<HomeAct>(HOME_ACT_EVENT, { detail: 'eat' }));
    this.endAct();
    this.cookFuel = detail?.fuel ?? 'GAS';
    this.act = { kind: 'cook', spot, doing: false, started: performance.now(), until: 0, props: [] };
    this.target.set(spot.x, 0, spot.z);
  };

  /** Il fait cuire : marmite sur la plaque, flamme ou braise selon le combustible, vapeur qui monte. */
  private beginCook(a: NonNullable<typeof this.act>): void {
    const hob = this.hob!;
    const add = (o: THREE.Object3D) => {
      this.scene.add(o);
      a.props.push(o);
      return o;
    };
    const pot = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.34, 0.3, 0.38, 14)), this.mats.color(0x8d97a3));
    pot.position.set(hob.x, hob.y + 0.2, hob.z);
    add(pot);
    const lid = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.36, 0.36, 0.05, 14)), this.mats.color(0xb4bcc6));
    lid.position.set(hob.x, hob.y + 0.42, hob.z);
    lid.userData.lid = true;
    add(lid);
    const glow = (color: number, r: number, h: number, y: number): THREE.Mesh => {
      const m = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(r, r, h, 14)), new THREE.MeshBasicMaterial({ color }));
      this.disposables.push(m.material as THREE.Material);
      m.position.set(hob.x, hob.y + y, hob.z);
      m.userData.flame = true;
      return add(m) as THREE.Mesh;
    };
    if (this.cookFuel === 'GAS') {
      // Couronne de petites flammes bleues sous la marmite
      for (let i = 0; i < 8; i++) {
        const f = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.035, 0.12, 5)), new THREE.MeshBasicMaterial({ color: 0x4aa8ff }));
        this.disposables.push(f.material as THREE.Material);
        f.position.set(hob.x + Math.cos((i / 8) * Math.PI * 2) * 0.2, hob.y + 0.02, hob.z + Math.sin((i / 8) * Math.PI * 2) * 0.2);
        f.userData.flame = true;
        add(f);
      }
    } else if (this.cookFuel === 'CHARCOAL') {
      glow(0xff5a1f, 0.24, 0.05, 0);
      glow(0xffb02e, 0.14, 0.06, 0.02);
    } else {
      glow(0xe5383b, 0.26, 0.03, 0); // plaque électrique rougeoyante
    }
    // Vapeur : quelques volutes qui montent en boucle
    for (let i = 0; i < 5; i++) {
      const puff = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.12, 8, 6)), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
      this.disposables.push(puff.material as THREE.Material);
      puff.userData.puff = i;
      puff.position.set(hob.x, hob.y + 0.5, hob.z);
      add(puff);
    }
  }

  /** Arrivé à sa place : il s'assoit (ou entre dans la douche) et l'action se joue quelques secondes. */
  private beginAct(now: number): void {
    const a = this.act!;
    const p = this.player;
    const { spot } = a;
    a.doing = true;
    // Télé, lecture et musique durent tant que le joueur le veut (bouton « Arrêter ») ; repas et toilette sont brefs
    const open = a.kind === 'tv' || a.kind === 'read' || a.kind === 'music';
    a.until = open ? Infinity : now + 5000;
    window.dispatchEvent(new CustomEvent<HomeAct | null>(HOME_ACT_STATE, { detail: open ? a.kind : null }));
    p.position.set(spot.x, 0, spot.z);
    p.rotation.set(0, spot.rot, 0);
    this.target.copy(p.position);
    animateWalk(p, 0, 0);
    if (a.kind === 'cook') {
      a.until = now + 7000;
      this.beginCook(a);
      return;
    }
    if (a.kind === 'wash') {
      p.visible = false; // dans la douche (ou dehors, à la douche de la cour)
      a.props.push(this.label('💧', '#2f8fd8', spot.x, 2.7, spot.z));
      return;
    }
    sitPose(p);
    p.position.y = spot.y;
    const fx = Math.sin(spot.rot);
    const fz = Math.cos(spot.rot);
    if (a.kind === 'read') {
      const book = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.42, 0.55, 0.06)), this.mats.color(0xd21034));
      book.position.set(0, 1.25, 0.42);
      book.rotation.x = -0.5;
      p.add(book);
      a.props.push(book);
    }
    if (a.kind === 'eat') {
      const plate = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.28, 0.22, 0.06, 14)), this.mats.color(0xffffff));
      plate.position.set(spot.x + fx * 0.75, 1.08, spot.z + fz * 0.75);
      const food = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.16, 10, 6)), this.mats.color(0xe8c27a));
      food.scale.y = 0.6;
      food.position.set(plate.position.x, 1.15, plate.position.z);
      this.scene.add(plate, food);
      a.props.push(plate, food);
    }
    if (a.kind === 'music') a.props.push(this.label('♪ ♫', '#0a7d4f', spot.x, 2.6, spot.z));
  }

  /** Fin de l'action : il se relève, ressort de la douche, la télé s'éteint. */
  private endAct(): void {
    const a = this.act;
    if (!a) return;
    this.act = null;
    window.dispatchEvent(new CustomEvent<HomeAct | null>(HOME_ACT_STATE, { detail: null }));
    const p = this.player;
    for (const o of a.props) o.removeFromParent();
    p.visible = true;
    p.position.y = 0;
    animateWalk(p, 0, 0);
    if (a.doing) {
      // Il se relève et fait un pas, devant ou derrière selon la place libre
      const fx = Math.sin(a.spot.rot);
      const fz = Math.cos(a.spot.rot);
      const out = a.kind === 'wash' ? 1.4 : 1;
      const [x, z] = [[a.spot.x + fx * out, a.spot.z + fz * out], [a.spot.x - fx * out, a.spot.z - fz * out]].find(([cx, cz]) => !this.blocked(cx!, cz!)) ?? [a.spot.x, a.spot.z];
      p.position.set(x!, 0, z!);
      this.target.copy(p.position);
    }
  }

  /** Réveil progressif : il se redresse, s'assoit un instant au bord du lit, puis se lève. */
  private wakeUp(): void {
    if (this.bedAnim?.kind === 'up') return;
    if (this.zzz) this.zzz.visible = false;
    this.sleepUntil = Infinity;
    this.bedAnim = { kind: 'up', t0: performance.now(), dur: 2800, from: this.player.position.clone() };
  }

  private finishWake(): void {
    this.sleepUntil = 0;
    this.bedAnim = null;
    const p = this.player;
    // Il reste tourné comme à la fin du mouvement (pas de demi-tour brusque), puis repart normalement
    p.rotation.set(0, 0, 0);
    p.position.set(this.bedSpot!.x, 0, this.bedSpot!.z + 2.6);
    this.target.copy(p.position);
    this.setLegs(0);
    p.rotation.order = 'XYZ';
  }

  private setLegs(angle: number): void {
    const l = this.player.getObjectByName('legL');
    const r = this.player.getObjectByName('legR');
    if (l) l.rotation.x = angle;
    if (r) r.rotation.x = angle;
  }

  /**
   * Coucher / lever : le corps pivote autour du bassin (et non des pieds). Au lever il se redresse, tourne les jambes hors du lit,
   * pose les pieds par terre au bord du lit, s'assoit un instant puis se lève, face à la pièce. Le coucher fait le chemin inverse.
   */
  private stepBedAnim(now: number): void {
    const a = this.bedAnim;
    const bed = this.bedSpot;
    if (!a || !bed) return;
    const p = this.player;
    p.rotation.order = 'YXZ';
    const t = Math.min(1, (now - a.t0) / a.dur);
    const ease = (x: number) => x * x * (3 - 2 * x);
    const lerp = (x: number, y: number, k: number) => x + (y - x) * k;
    const HIP = 0.95; // hauteur du bassin debout
    // Pose décrite par le bassin (H), l'inclinaison du buste, l'orientation et l'angle des jambes ; l'origine du personnage suit
    const pose = (h: THREE.Vector3, pitch: number, yaw: number, legs: number) => {
      p.rotation.set(pitch, yaw, 0);
      const off = new THREE.Vector3(0, HIP, 0).applyEuler(p.rotation);
      p.position.set(h.x - off.x, h.y - off.y, h.z - off.z);
      this.setLegs(legs);
    };
    const lying = new THREE.Vector3(bed.x, bed.y + 0.15, bed.z - 0.1);
    // Le lit se quitte par le pied (côté jambes), pas par le côté de la table de chevet
    const edge = new THREE.Vector3(bed.x, 0.62, bed.z + 1.3);
    const stand = new THREE.Vector3(bed.x, HIP, bed.z + 2.6);
    const hips = (v: THREE.Vector3, w: THREE.Vector3, k: number) => new THREE.Vector3(lerp(v.x, w.x, k), lerp(v.y, w.y, k), lerp(v.z, w.z, k));
    const SEAT = -0.9; // jambes qui pendent au bord du lit, pieds au sol
    const FACE = 0; // face à la pièce, dos au lit
    if (a.kind === 'up') {
      if (t < 0.4) pose(hips(lying, edge, ease(t / 0.4)), lerp(-Math.PI / 2, -0.15, ease(t / 0.4)), lerp(0, FACE, ease(t / 0.4)), lerp(0, SEAT, ease(t / 0.4)));
      else if (t < 0.62) pose(edge, lerp(-0.15, 0, ease((t - 0.4) / 0.22)), FACE, SEAT);
      else {
        // Il se lève en poussant sur les pieds
        const k = ease((t - 0.62) / 0.38);
        pose(hips(edge, stand, k), 0, FACE, lerp(SEAT, 0, k));
      }
      if (t >= 1) this.finishWake();
      return;
    }
    // Coucher : marche jusqu'au bord, s'assoit dos au lit, jambes sur le lit, puis s'allonge
    if (t < 0.3) {
      const k = ease(t / 0.3);
      const side = new THREE.Vector3(bed.x, 0, bed.z + 2.6);
      p.rotation.set(0, Math.PI, 0);
      p.position.set(lerp(a.from.x, side.x, k), 0, lerp(a.from.z, side.z, k));
      animateWalk(p, now / 120, 1);
    } else if (t < 0.5) {
      const k = ease((t - 0.3) / 0.2);
      pose(hips(stand, edge, k), 0, lerp(Math.PI, FACE, k), lerp(0, SEAT, k));
    } else {
      const k = ease((t - 0.5) / 0.5);
      pose(hips(edge, lying, k), lerp(0, -Math.PI / 2, k), lerp(FACE, 0, k), lerp(SEAT, 0, k));
    }
    if (t >= 1) {
      pose(lying, -Math.PI / 2, 0, 0);
      this.bedAnim = null;
      if (this.zzz) this.zzz.visible = true;
    }
  }

  /** Appelé quand on touche un article exposé (indice dans la liste des articles du lieu). */
  onArticle: ((index: number) => void) | null = null;
  private readonly articleMeshes: THREE.Object3D[] = [];

  /**
   * Décor d'un lieu de partenaire par-dessus la pièce de base : grand panneau de marque (logo et nom) au mur du fond, tapis à ses
   * couleurs de la porte au comptoir, plantes, et étals d'articles le long du mur de droite (objet, étiquette avec emoji, nom et prix) :
   * toucher un étal achète l'article.
   */
  private furnishBrand(b: InteriorBrand): void {
    const { w, d } = this.half;
    const main = new THREE.Color(b.color).getHex();
    const dark = new THREE.Color(b.color).multiplyScalar(0.55).getHex();
    const canvasTex = (cw: number, ch: number, paint: (g: CanvasRenderingContext2D) => void) => {
      const cv = document.createElement('canvas');
      cv.width = cw;
      cv.height = ch;
      const g = cv.getContext('2d');
      if (g) paint(g);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.disposables.push(tex as unknown as THREE.Material);
      return { tex, cv };
    };
    // Panneau de marque au mur du fond
    const sw = Math.min(6.5, w * 1.3);
    const sh = 1.7;
    const draw = (img: HTMLImageElement | null) => (g: CanvasRenderingContext2D) => {
      const W = 1024;
      const H = Math.round((W * sh) / sw);
      const grad = g.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, new THREE.Color(b.color).lerp(new THREE.Color(0xffffff), 0.2).getStyle());
      grad.addColorStop(1, new THREE.Color(b.color).multiplyScalar(0.75).getStyle());
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,.7)';
      g.lineWidth = 8;
      g.strokeRect(14, 14, W - 28, H - 28);
      const side = H * 0.74;
      let left = W * 0.06;
      if (img) {
        g.fillStyle = '#fff';
        g.beginPath();
        g.roundRect(H * 0.13, H * 0.13, side, side, side * 0.18);
        g.fill();
        const k = Math.min((side * 0.82) / img.width, (side * 0.82) / img.height);
        g.drawImage(img, H * 0.13 + (side - img.width * k) / 2, H * 0.13 + (side - img.height * k) / 2, img.width * k, img.height * k);
        left = H * 0.13 + side + H * 0.16;
      }
      g.fillStyle = '#fff';
      g.textBaseline = 'middle';
      g.font = `900 ${Math.round(H * 0.4)}px system-ui, sans-serif`;
      g.fillText(b.label, left, H * 0.5, W - left - W * 0.05);
    };
    const signSize = { w: 1024, h: Math.round((1024 * sh) / sw) };
    const sign = canvasTex(signSize.w, signSize.h, draw(null));
    const signMesh = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(sw, sh)), new THREE.MeshBasicMaterial({ map: sign.tex }));
    signMesh.position.set(-w * 0.28, 2.9, -d + 0.2); // à gauche des frigos et autres meubles du fond
    this.scene.add(signMesh);
    if (b.logo) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const g = sign.cv.getContext('2d');
        if (g) draw(img)(g);
        sign.tex.needsUpdate = true;
      };
      img.src = b.logo;
    }
    // Tapis de la porte au comptoir, bordé d'un liseré clair
    this.box(2.6, 0.02, 2 * d - 3.6, main, 0, 0.07, 1.2);
    this.box(2.9, 0.02, 2 * d - 3.6, 0xf4f2ee, 0, 0.06, 1.2);
    // Plantes de part et d'autre de la porte et au fond
    for (const [px, pz] of [[-w + 0.8, d - 0.9], [w - 0.8, d - 0.9], [-w + 0.8, -d + 1.1]] as const) {
      this.box(0.6, 0.55, 0.6, 0xb9b3a8, px, 0.28, pz);
      const bush = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.5, 8, 6)), this.mats.color(0x3f8f4a));
      bush.position.set(px, 0.95, pz);
      this.scene.add(bush);
    }
    // Étals d'articles le long du mur de droite : socle, objet, étiquette (emoji, nom, prix)
    const n = Math.min(b.articles.length, 8);
    const palette = [0xe5383b, 0x1f6feb, 0xffce00, 0x22a861, 0xf18f01, 0x8e44ad];
    for (let i = 0; i < n; i++) {
      const a = b.articles[i]!;
      const px = w - 1.3;
      const pz = -d + 3 + (i * (2 * d - 6.5)) / Math.max(1, n - 1);
      const stand = this.box(1, 0.8, 1, 0xf4f2ee, px, 0.4, pz);
      this.box(1.06, 0.08, 1.06, main, px, 0.82, pz);
      const item = new THREE.Mesh(this.geo(i % 3 === 0 ? new THREE.BoxGeometry(0.45, 0.4, 0.45) : i % 3 === 1 ? new THREE.CylinderGeometry(0.2, 0.2, 0.5, 14) : new THREE.SphereGeometry(0.27, 12, 10)), this.mats.color(palette[i % palette.length]!));
      item.position.set(px, 1.15, pz);
      this.scene.add(item);
      const tag = canvasTex(256, 160, (g) => {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, 256, 160);
        g.fillStyle = new THREE.Color(b.color).getStyle();
        g.fillRect(0, 0, 256, 18);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = '56px system-ui, sans-serif';
        g.fillText(a.emoji, 128, 62);
        g.fillStyle = '#14213d';
        g.font = '700 22px system-ui, sans-serif';
        g.fillText(a.name.length > 20 ? `${a.name.slice(0, 19)}…` : a.name, 128, 108, 240);
        g.fillStyle = new THREE.Color(b.color).multiplyScalar(0.7).getStyle();
        g.font = '900 26px system-ui, sans-serif';
        g.fillText(a.price, 128, 138, 240);
      });
      const tagMesh = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(0.95, 0.6)), new THREE.MeshBasicMaterial({ map: tag.tex }));
      tagMesh.position.set(px + 0.54, 0.62, pz);
      tagMesh.rotation.y = Math.PI / 2;
      tagMesh.userData.article = i;
      item.userData.article = i;
      stand.userData.article = i;
      this.scene.add(tagMesh);
      this.articleMeshes.push(tagMesh, item, stand);
    }
    void dark;
  }

  private readonly onUp = (e: PointerEvent): void => {
    const d = this.downAt;
    this.downAt = null;
    this.touches.delete(e.pointerId);
    // Un glissé a fait tourner la pièce : ce n'est pas un toucher pour se déplacer
    if (this.dragging) {
      if (this.touches.size === 0) this.dragging = false;
      return;
    }
    if (this.sleepUntil) return;
    // Télé, lecture et musique durent tant qu'on veut ; toucher la pièce pour aller ailleurs les arrête
    if (this.act && !(this.act.doing && this.act.until === Infinity)) return;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
    if (this.act) this.endAct();
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // Toucher un article exposé : on l'achète
    const art = this.articleMeshes.length ? this.raycaster.intersectObjects(this.articleMeshes, false)[0] : undefined;
    if (art && typeof art.object.userData.article === 'number') {
      this.onArticle?.(art.object.userData.article);
      return;
    }
    const ray = this.raycaster.ray;
    if (Math.abs(ray.direction.y) < 1e-4) return;
    const t = -ray.origin.y / ray.direction.y;
    if (t <= 0) return;
    const p = ray.at(t, new THREE.Vector3());
    // Toucher un escalier : on marche jusqu'à sa plaque
    const pad = this.pads.find((q) => q.level === this.level && p.x >= q.zone.x0 && p.x <= q.zone.x1 && p.z >= q.zone.z0 && p.z <= q.zone.z1);
    if (pad) {
      this.target.set(pad.x, 0, pad.z);
      return;
    }
    this.target.set(THREE.MathUtils.clamp(p.x, -this.half.w + 0.8, this.half.w - 0.8), 0, THREE.MathUtils.clamp(p.z, -this.half.d + 0.8, this.half.d - 0.8));
  };

  /**
   * Plus court chemin (A*) sur une grille de 0,3 m qui contourne cloisons et meubles, puis tiré au cordeau
   * (points de passage réduits aux coins nécessaires). Cible occupée (chaise, canapé) : on va à la case libre la plus proche.
   */
  private findRoute(from: THREE.Vector3, to: THREE.Vector3): { x: number; z: number }[] {
    const S = 0.3;
    const x0 = -this.half.w + 0.4;
    const z0 = -this.half.d + 0.4;
    const nx = Math.floor((this.half.w * 2 - 0.8) / S) + 1;
    const nz = Math.floor((this.half.d * 2 - 0.8) / S) + 1;
    const cx = (i: number) => x0 + i * S;
    const cz = (j: number) => z0 + j * S;
    const ci = (x: number) => Math.min(nx - 1, Math.max(0, Math.round((x - x0) / S)));
    const cj = (z: number) => Math.min(nz - 1, Math.max(0, Math.round((z - z0) / S)));
    const free = new Map<number, boolean>();
    const isFree = (i: number, j: number) => {
      const k = j * nx + i;
      let f = free.get(k);
      if (f === undefined) {
        f = !this.blocked(cx(i), cz(j));
        free.set(k, f);
      }
      return f;
    };
    const si = ci(from.x);
    const sj = cj(from.z);
    const key = (i: number, j: number) => j * nx + i;
    // Parcours de toute la zone atteignable depuis le joueur (la grille est petite) : le but est la case atteignable
    // la plus proche de la cible, jamais une poche fermée (derrière une cloison, entre deux meubles)
    const g = new Map<number, number>([[key(si, sj), 0]]);
    const prev = new Map<number, number>();
    const open: { k: number; f: number }[] = [{ k: key(si, sj), f: 0 }];
    while (open.length > 0) {
      open.sort((p, q) => p.f - q.f);
      const cur = open.shift()!;
      const ci0 = cur.k % nx;
      const cj0 = Math.floor(cur.k / nx);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const ni = ci0 + di;
        const nj = cj0 + dj;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz || !isFree(ni, nj)) continue;
        // pas de coin coupé à travers un angle de cloison
        if (di !== 0 && dj !== 0 && (!isFree(ci0 + di, cj0) || !isFree(ci0, cj0 + dj))) continue;
        const nk = key(ni, nj);
        const cost = cur.f + (di !== 0 && dj !== 0 ? 1.414 : 1);
        if (cost < (g.get(nk) ?? Infinity)) {
          g.set(nk, cost);
          prev.set(nk, cur.k);
          open.push({ k: nk, f: cost });
        }
      }
    }
    let goal = key(si, sj);
    let best = Infinity;
    for (const k of g.keys()) {
      const d = Math.hypot(cx(k % nx) - to.x, cz(Math.floor(k / nx)) - to.z);
      if (d < best - 1e-6) ((best = d), (goal = k));
    }
    const gi = goal % nx;
    const gj = Math.floor(goal / nx);
    const cells: { x: number; z: number }[] = [];
    for (let k: number | undefined = key(gi, gj); k !== undefined; k = prev.get(k)) cells.push({ x: cx(k % nx), z: cz(Math.floor(k / nx)) });
    cells.reverse();
    // Tirer au cordeau : on saute les points intermédiaires tant que la ligne droite est libre
    const clear = (a: { x: number; z: number }, b: { x: number; z: number }) => {
      const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.15);
      for (let t = 1; t < n; t++) if (this.blocked(a.x + ((b.x - a.x) * t) / n, a.z + ((b.z - a.z) * t) / n)) return false;
      return true;
    };
    const out: { x: number; z: number }[] = [];
    let a: { x: number; z: number } = { x: from.x, z: from.z };
    for (let i = 1; i < cells.length; i++) {
      if (i === cells.length - 1 || !clear(a, cells[i + 1]!)) {
        out.push(cells[i]!);
        a = cells[i]!;
      }
    }
    return out;
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Cadre toute la pièce, en portrait comme en paysage
    const span = Math.max(this.half.w, this.half.d) * 2;
    const dist = span * (w < h ? 2.9 : 1.35);
    this.camBase = dist * Math.hypot(0.55, 0.8, 0.75);
    this.placeCamera();
    this.camera.updateProjectionMatrix();
  }

  private blocked(x: number, z: number, r = 0.3): boolean {
    if (Math.abs(x) > this.half.w - 0.5 || Math.abs(z) > this.half.d - 0.5) return true;
    return this.blocks.some((b) => b.lvl === this.level && Math.abs(x - b.x) < b.hw + r && Math.abs(z - b.z) < b.hd + r);
  }

  /** Avance vers la cible ; glisse le long d'un obstacle, sinon s'arrête. Renvoie false si bloqué. */
  private stepTo(pos: THREE.Vector3, sx: number, sz: number): boolean {
    const inside = this.blocked(pos.x, pos.z);
    const ok = (x: number, z: number) => inside || !this.blocked(x, z);
    if (ok(pos.x + sx, pos.z + sz)) pos.set(pos.x + sx, 0, pos.z + sz);
    else if (ok(pos.x + sx, pos.z)) pos.x += sx;
    else if (ok(pos.x, pos.z + sz)) pos.z += sz;
    else return false;
    return true;
  }

  /** Lumière selon l'heure : jour franc par les fenêtres, nuit sombre où la lampe chaude éclaire la pièce. */
  private daylight(): void {
    if (!this.getMinute) return;
    const m = this.getMinute();
    // 0 la nuit, 1 en plein jour, transitions à l'aube (5 h 30 – 7 h 30) et au soir (17 h 30 – 19 h 30)
    const day = THREE.MathUtils.clamp(Math.min((m - 330) / 120, (1170 - m) / 120), 0, 1);
    this.hemi.intensity = 0.28 + 0.72 * day;
    this.hemi.color.setHex(day > 0.5 ? 0xffffff : 0xaab8ff);
    this.key.intensity = 0.12 + 0.78 * day;
    this.key.color.setHex(day > 0.5 ? 0xfff3dc : 0x9fb2ff);
    this.lampBase = 1.4 + 1.8 * (1 - day);
  }

  // ---------- meubles posés par le joueur ----------

  private readonly furnGroups: THREE.Group[] = [];
  private readonly furnGeos = new Map<string, THREE.BoxGeometry>();

  /** Disque (axe selon la profondeur du meuble) ou anneau, partagés par taille. */
  private furnRound(kind: 'disc' | 'ring', diameter: number, thick: number): THREE.BufferGeometry {
    const k = `${kind}|${diameter.toFixed(3)}|${thick.toFixed(3)}`;
    let g = this.furnRoundGeos.get(k);
    if (!g) {
      g = kind === 'disc' ? new THREE.CylinderGeometry(diameter / 2, diameter / 2, thick, 24).rotateX(Math.PI / 2) : new THREE.TorusGeometry(diameter / 2, thick, 8, 28);
      this.furnRoundGeos.set(k, g);
      this.geos.push(g);
    }
    return g;
  }
  private readonly furnRoundGeos = new Map<string, THREE.BufferGeometry>();

  private furnGeo(w: number, h: number, d: number): THREE.BoxGeometry {
    const k = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
    let g = this.furnGeos.get(k);
    if (!g) {
      g = new THREE.BoxGeometry(w, h, d);
      this.furnGeos.set(k, g);
      this.geos.push(g);
    }
    return g;
  }

  /**
   * Pose (ou remplace) les meubles du joueur : chaque meuble est un assemblage de pavés orienté par quarts de tour, avec son
   * obstacle au sol. `selectedId` : le meuble en cours de réglage reçoit un repère vert (place libre) ou rouge (bloqué).
   */
  setFurniture(list: { id: string; model: string; x: number; z: number; rot: number; w: number; d: number; flat?: boolean }[], selectedId: string | null = null): void {
    for (const g of this.furnGroups) this.scene.remove(g);
    this.furnGroups.length = 0;
    for (let i = this.blocks.length - 1; i >= 0; i--) if (this.blocks[i]!.furn) this.blocks.splice(i, 1);
    for (const f of list) {
      const g = new THREE.Group();
      g.position.set(f.x, 0, f.z);
      g.rotation.y = (f.rot * Math.PI) / 2;
      for (const p of furnitureParts(f.model, f.w, f.d)) {
        const m = new THREE.Mesh(p.kind === 'disc' || p.kind === 'ring' ? this.furnRound(p.kind, p.w, p.d) : this.furnGeo(p.w, p.h, p.d), this.mats.color(p.c));
        m.position.set(p.x, p.y, p.z);
        if (p.rz) m.rotation.z = p.rz;
        m.castShadow = this.profile.shadows;
        m.receiveShadow = this.profile.shadows;
        g.add(m);
      }
      if (f.id === selectedId) {
        const ok = this.canPlace(f, f.id);
        const ring = new THREE.Mesh(this.furnGeo(f.w + 0.16, 0.02, f.d + 0.16), new THREE.MeshBasicMaterial({ color: ok ? 0x2fd37a : 0xe5383b, transparent: true, opacity: 0.55 }));
        ring.position.y = 0.04;
        g.add(ring);
      }
      this.scene.add(g);
      this.furnGroups.push(g);
      if (!f.flat) {
        const odd = f.rot % 2 === 1;
        this.blocks.push({ x: f.x, z: f.z, hw: (odd ? f.d : f.w) / 2, hd: (odd ? f.w : f.d) / 2, lvl: 0, furn: f.id });
      }
    }
    if (this.custom) this.applyAnchors(list);
  }

  /**
   * Meubles du joueur qui servent : le lit (sommeil), la chaise ou la table (repas), le fauteuil ou le canapé (télé, lecture, musique),
   * le réchaud ou la cuisinière (cuisson), la télé (écran). Leurs points d'usage suivent le meuble déplacé ; sans le meuble, plus d'usage.
   */
  private applyAnchors(list: { id: string; model: string; x: number; z: number; rot: number; w: number; d: number }[]): void {
    const first = (...models: string[]) => list.find((f) => models.includes(f.model));
    const turn = (f: { rot: number }) => (f.rot * Math.PI) / 2;
    // Lit : le sommeil suppose la tête vers le nord (le lit ne se tourne pas) ; le matelas est repéré à sa tête
    const bed = first('bed', 'mattress');
    this.bedSpot = bed ? (bed.model === 'bed' ? { x: bed.x, z: bed.z, y: 0.95 } : { x: bed.x, z: bed.z - 0.8, y: 0.45 }) : null;
    // Repas : la chaise la plus proche d'une table à manger, sinon la première chaise
    const table = first('dining');
    const chairs = list.filter((f) => f.model === 'chair');
    const seat = table ? [...chairs].sort((a, b) => Math.hypot(a.x - table.x, a.z - table.z) - Math.hypot(b.x - table.x, b.z - table.z))[0] : chairs[0];
    if (seat) this.spots.table = { x: seat.x, z: seat.z, rot: turn(seat), y: -0.15 };
    else delete this.spots.table;
    // Télé, lecture, musique : fauteuil ou canapé, sinon la table
    const sofa = first('armchair', 'sofa');
    if (sofa) this.spots.sofa = { x: sofa.x, z: sofa.z, rot: turn(sofa), y: -0.15 };
    else delete this.spots.sofa;
    // Cuisson : la plaque est au centre du meuble, le cuisinier se tient devant (sens de sa face avant)
    const stove = first('kitchen', 'stove');
    if (stove) {
      const t = turn(stove);
      this.hob = { x: stove.x, z: stove.z, y: stove.model === 'stove' ? 0.72 : 1.26 };
      this.spots.stove = { x: stove.x + Math.sin(t) * 1.3, z: stove.z + Math.cos(t) * 1.3, rot: t + Math.PI, y: 0 };
    } else {
      this.hob = null;
      delete this.spots.stove;
    }
    // Télé : l'écran qui s'allume est posé sur la face du meuble
    for (const o of this.screenObjs) this.scene.remove(o);
    this.screenObjs = [];
    this.tvScreen = null;
    const tv = first('tv');
    if (tv) {
      const t = turn(tv);
      this.tvScreen = this.screen(tv.w * 0.86, 0.86, tv.x + Math.sin(t) * 0.02, 1.12, tv.z + Math.cos(t) * 0.02, t);
    }
  }

  /** Le meuble tient dans la pièce, hors des murs, des meubles d'origine et des autres meubles posés (`ignoreId` : lui-même). */
  canPlace(f: { x: number; z: number; rot: number; w: number; d: number; flat?: boolean }, ignoreId: string | null = null): boolean {
    const odd = f.rot % 2 === 1;
    const hw = (odd ? f.d : f.w) / 2;
    const hd = (odd ? f.w : f.d) / 2;
    if (Math.abs(f.x) + hw > this.half.w - 0.15 || Math.abs(f.z) + hd > this.half.d - 0.15) return false;
    if (f.flat) return true;
    return !this.blocks.some((b) => b.lvl === 0 && b.furn !== ignoreId && Math.abs(f.x - b.x) < hw + b.hw - 0.02 && Math.abs(f.z - b.z) < hd + b.hd - 0.02);
  }

  /** Première place libre au sol, en spirale autour du centre de la pièce (pas de 0,5 m) ; null si la pièce est pleine. */
  findFreeSpot(def: { w: number; d: number; flat?: boolean }): { x: number; z: number; rot: number } | null {
    for (let r = 0; r <= 14; r++) {
      for (let ix = -r; ix <= r; ix++) {
        for (let iz = -r; iz <= r; iz++) {
          if (Math.max(Math.abs(ix), Math.abs(iz)) !== r) continue;
          const c = { x: ix * 0.5, z: iz * 0.5, rot: 0, w: def.w, d: def.d, flat: def.flat };
          if (this.canPlace(c)) return { x: c.x, z: c.z, rot: 0 };
        }
      }
    }
    return null;
  }

  /** Déplacement d'un pas de 0,5 m dans le sens de l'écran (haut, bas, gauche, droite), calé sur l'axe de la pièce le plus proche. */
  screenStep(dir: 'up' | 'down' | 'left' | 'right'): { dx: number; dz: number } {
    const fx = -Math.sin(this.camAz);
    const fz = -Math.cos(this.camAz);
    const [vx, vz] = dir === 'up' ? [fx, fz] : dir === 'down' ? [-fx, -fz] : dir === 'right' ? [fz * -1, fx] : [fz, -fx];
    return Math.abs(vx) >= Math.abs(vz) ? { dx: Math.sign(vx) * 0.5, dz: 0 } : { dx: 0, dz: Math.sign(vz) * 0.5 };
  }

  /** Joystick tactile (x = droite, y = avant, de -1 à 1). */
  setMove(x: number, y: number): void {
    this.joy = { x: THREE.MathUtils.clamp(x, -1, 1), y: THREE.MathUtils.clamp(y, -1, 1) };
  }

  private readonly loop = (now: number): void => {
    if (now - this.lastDaylight > 1000) {
      this.lastDaylight = now;
      this.daylight();
    }
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    const p = this.player.position;
    // Joystick tactile : le personnage avance dans la direction poussée, vue depuis la caméra (pas d'effet pendant une action ou le sommeil)
    if ((this.joy.x !== 0 || this.joy.y !== 0) && !this.act && this.sleepUntil === 0 && !this.dance && !this.consultation && !this.worship) {
      const fx = -Math.sin(this.camAz);
      const fz = -Math.cos(this.camAz);
      const rx = Math.cos(this.camAz);
      const rz = -Math.sin(this.camAz);
      const mx = rx * this.joy.x + fx * this.joy.y;
      const mz = rz * this.joy.x + fz * this.joy.y;
      const len = Math.hypot(mx, mz);
      if (len > 0.05) {
        const k = 0.45 / Math.max(1, len);
        this.target.set(THREE.MathUtils.clamp(p.x + mx * k, -this.half.w + 0.8, this.half.w - 0.8), 0, THREE.MathUtils.clamp(p.z + mz * k, -this.half.d + 0.8, this.half.d - 0.8));
      }
    }
    const dx = this.target.x - p.x;
    const dz = this.target.z - p.z;
    // Lampe : l'intensité glisse vers sa cible (tamisée pendant le sommeil) au lieu de sauter, ce qui évitait des « flashs »
    const lampTarget = this.sleepUntil !== 0 && this.bedAnim?.kind !== 'up' && !this.wardOn ? 0.2 : this.lampBase;
    for (const l of this.lamps) l.intensity += (lampTarget * ((l.userData.k as number | undefined) ?? 1) - l.intensity) * Math.min(1, dt * 3);
    this.updateTv(now);
    this.updateDisco(now);
    if (this.dance) {
      // Danse en cours : la scène pilote le joueur ; les autres figurants restent figés le temps de la danse
      if (!this.stepDance(now, dt)) this.dance = null;
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.consultation) {
      // Consultation en cours : la scène pilote le patient et le médecin
      if (!this.consultation.update(now)) this.consultation = null;
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.worship) {
      // Office en cours : le culte pilote le personnage (marche, prière, offrande)
      if (!this.worship.update(now, dt)) {
        this.worship = null;
        this.target.copy(this.player.position);
        this.routeFor.set(1e9, 0, 1e9);
      }
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.sleepUntil) {
      // Pendant le sommeil : on ne bouge pas, les « Zzz » flottent ; coucher et lever sont animés
      if (this.bedAnim) this.stepBedAnim(now);
      // Garde-fou : hospitalisé, le patient est toujours allongé dans son lit (jamais debout au pied du lit)
      else if (this.wardOn && this.sleepUntil === Infinity && Math.abs(this.player.rotation.x + Math.PI / 2) > 0.2) {
        this.bedAnim = { kind: 'down', t0: now - 2400, dur: 2400, from: this.player.position.clone() };
      }
      if (this.zzz) {
        this.zzz.position.y = 2 + Math.sin(now / 400) * 0.15;
        // À l'hôpital, pas de « Zzz » : on voit les soins, pas un dormeur
        if (this.wardOn) this.zzz.visible = false;
      }
      this.ward?.update(now, dt);
      // (sleepUntil vaut 0 juste après la fin du réveil : on ne relance pas un second réveil, qui recouchait le personnage)
      if (!this.bedAnim && this.sleepUntil !== 0 && now > this.sleepUntil) this.wakeUp();
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.pads.length > 0 && now > this.padCool && !this.act) {
      const pd = this.pads.find((q) => q.level === this.level && Math.hypot(p.x - q.x, p.z - q.z) < 0.8);
      if (pd) {
        this.setLevel(pd.to, pd.ax, pd.az);
        this.renderer.render(this.scene, this.camera);
        return;
      }
    }
    const dist = Math.hypot(dx, dz);
    if (this.act) {
      if (this.act.doing) {
        for (const o of this.act.props) if (o instanceof THREE.Sprite) o.position.y += Math.sin(now / 300) * 0.004;
        if (this.act.kind === 'read') {
          // Plusieurs livres de suite : un nouveau livre (couleur) toutes les 6 s, avec un petit mouvement de pages
          const book = this.act.props.find((o): o is THREE.Mesh => o instanceof THREE.Mesh);
          if (book) {
            const BOOKS = [0xd21034, 0x1f6feb, 0x22a861, 0xf18f01, 0x6d28d9];
            (book.material as THREE.MeshLambertMaterial).color.setHex(BOOKS[Math.floor((now - this.act.started) / 6000) % BOOKS.length]!);
            book.rotation.x = -0.5 + Math.sin(now / 700) * 0.04;
          }
        }
        if (this.act.kind === 'cook') {
          // Il remue : bras qui tournent, couvercle qui vibre, flammes qui vacillent, vapeur qui monte
          poseArms(this.player, 'scrub', now / 1000, 0.5);
          for (const o of this.act.props) {
            if (o.userData.flame) o.scale.setScalar(0.85 + 0.25 * Math.sin(now / 90 + o.position.x * 9));
            if (o.userData.lid) o.rotation.z = Math.sin(now / 70) * 0.03;
            if (typeof o.userData.puff === 'number') {
              const k = ((now / 1400 + o.userData.puff / 5) % 1);
              o.position.y = this.hob!.y + 0.5 + k * 1.1;
              o.position.x = this.hob!.x + Math.sin(now / 500 + o.userData.puff * 2) * 0.12 * k;
              o.scale.setScalar(0.6 + k * 1.2);
              ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k);
            }
          }
        }
        if (now > this.act.until) {
          const cooked = this.act.kind === 'cook';
          this.endAct();
          // Le plat est prêt : il l'apporte à table et le mange
          if (cooked) this.onAct(new CustomEvent<HomeAct>(HOME_ACT_EVENT, { detail: 'eat' }));
        }
        this.renderer.render(this.scene, this.camera);
        return;
      }
      // En chemin vers sa place : près du but (meubles autour) ou coincé trop longtemps, il s'y installe
      // (le chemin contourne les cloisons : plus de temps qu'en ligne droite avant de s'installer d'office)
      if (dist < 1.6 || now - this.act.started > 20000) {
        this.beginAct(now);
        this.renderer.render(this.scene, this.camera);
        return;
      }
    }
    // Nouvelle cible : on calcule le chemin qui contourne cloisons et meubles, puis on suit ses points de passage
    if (this.target.distanceToSquared(this.routeFor) > 1e-4) {
      this.routeFor.copy(this.target);
      this.route = dist > 0.5 ? this.findRoute(p, this.target) : [];
    }
    while (this.route.length > 0 && Math.hypot(this.route[0]!.x - p.x, this.route[0]!.z - p.z) < 0.2) this.route.shift();
    const way = this.route[0];
    const gx = (way ? way.x : this.target.x) - p.x;
    const gz = (way ? way.z : this.target.z) - p.z;
    const gd = Math.hypot(gx, gz);
    if (dist > 0.05 && gd > 0.001) {
      const step = Math.min(gd, 4 * dt);
      if (!this.stepTo(p, (gx / gd) * step, (gz / gd) * step) && !way) this.target.copy(p);
      this.player.rotation.y = Math.atan2(gx, gz);
      this.phase += dt * 10;
      animateWalk(this.player, this.phase, 0.6);
    } else animateWalk(this.player, 0, 0);
    // Figurants qui flânent autour de leur place
    for (const e of this.extras) {
      const ex = e.target.x - e.g.position.x;
      const ez = e.target.z - e.g.position.z;
      const ed = Math.hypot(ex, ez);
      if (ed < 0.1) {
        if (this.rand() < dt * 0.4) {
          const tx = e.home.x + (this.rand() - 0.5) * 4;
          const tz = e.home.z + (this.rand() - 0.5) * 3;
          // Cible libre seulement ; sinon on retente plus tard
          if (!this.blocked(tx, tz)) e.target.set(tx, 0, tz);
        }
        animateWalk(e.g, 0, 0);
      } else {
        if (!this.stepTo(e.g.position, (ex / ed) * e.speed * dt, (ez / ed) * e.speed * dt)) e.target.copy(e.g.position);
        e.g.rotation.y = Math.atan2(ex, ez);
        e.phase += dt * 8;
        animateWalk(e.g, e.phase, 0.5);
      }
    }
    this.updateWork(dt);
    this.checkExit();
    this.renderer.render(this.scene, this.camera);
  };

  /** S'approcher de la porte fait sortir ; la porte ne s'ouvre qu'après s'en être éloigné (à l'arrivée on est juste derrière). */
  private checkExit(): void {
    if (!this.onExit || this.act || this.sleepUntil || this.level !== 0) return;
    const p = this.player.position;
    const door = this.door();
    const near = p.x < -this.half.w + 1.0 && Math.abs(p.z - door.z) < 0.9;
    if (!near) {
      if (Math.hypot(p.x - door.x, p.z - door.z) > 2.2) this.exitArmed = true;
      return;
    }
    if (!this.exitArmed) return;
    this.exitArmed = false;
    this.onExit();
  }

  /** La porte : là où les clients entrent et ressortent. */
  private door(): { x: number; z: number } {
    return { x: -this.half.w + 1.2, z: this.half.d - 1.2 };
  }

  /**
   * Installe (ou retire, avec null) le poste de travail du joueur dans la pièce : il reste à son poste,
   * ce sont les clients qui entrent et viennent à lui.
   */
  setWork(id: string | null): void {
    if (this.work) {
      this.work.act?.done();
      this.scene.remove(this.work.st.group);
      this.work.st.hand?.removeFromParent();
      this.work.st.geos.forEach((g) => g.dispose());
      this.work.st.own.forEach((m) => m.dispose());
      restArms(this.player);
      this.work = null;
    }
    if (this.customer) this.scene.remove(this.customer.g);
    this.customer = null;
    for (const l of this.leavers) this.scene.remove(l.g);
    this.leavers = [];
    if (!id) return;
    const st = buildStation(this.mats, id, true);
    // Côté droit de la pièce, face à la salle : le comptoir est entre le joueur et les clients
    const { x, z, yaw } = this.workPost();
    st.group.position.set(x, 0, z);
    st.group.rotation.y = yaw;
    this.scene.add(st.group);
    if (st.hand) this.player.getObjectByName('armR')?.getObjectByName('forearm')?.add(st.hand);
    this.player.position.set(x, 0, z);
    this.player.rotation.y = yaw;
    this.target.copy(this.player.position);
    this.work = { st, x, z, yaw, act: null };
  }

  /** Place du joueur et sens du service (vers l'avant de la pièce, visible de la caméra), dans la zone libre. */
  private workPost(): { x: number; z: number; yaw: number } {
    // Magasin : rayons sur toute la largeur, la bande libre est devant ; ailleurs, le côté droit de la pièce
    if (this.roomKind === 'shop') return { x: this.half.w * 0.45, z: this.half.d - 2.5, yaw: 0 };
    return { x: this.half.w * 0.5, z: -this.half.d * 0.1, yaw: 0 };
  }

  /** Un client entre par la porte et vient au comptoir ; le précédent repart. false : plus personne. */
  setCustomer(on: boolean): void {
    if (this.customer) {
      this.leavers.push({ g: this.customer.g, phase: 0, t: 0 });
      this.customer = null;
    }
    if (!on || !this.work) return;
    const g = buildPerson(this.mats, randomLook(rng(this.customerSeed++ * 7919)));
    const d = this.door();
    g.position.set(d.x, 0, d.z);
    this.scene.add(g);
    this.customer = { g, phase: 0, arrived: false };
  }

  /** Le geste du métier : attend le client, joue l'animation (service, saisie…), puis rend la main. */
  performWork(): Promise<void> {
    const w = this.work;
    if (!w) return Promise.resolve();
    return new Promise((done) => {
      w.act = { t: 0, dur: 1.5, wait: 0, done: () => ((w.act = null), done()) };
    });
  }

  private updateWork(dt: number): void {
    const door = this.door();
    for (let i = this.leavers.length - 1; i >= 0; i--) {
      const l = this.leavers[i]!;
      l.t += dt;
      l.phase += dt * 9;
      const dx = door.x - l.g.position.x;
      const dz = door.z - l.g.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.4 || l.t > 8) {
        this.scene.remove(l.g);
        this.leavers.splice(i, 1);
        continue;
      }
      l.g.position.x += (dx / d) * 2.2 * dt;
      l.g.position.z += (dz / d) * 2.2 * dt;
      l.g.rotation.y = Math.atan2(dx, dz);
      animateWalk(l.g, l.phase, 0.55);
    }
    const w = this.work;
    if (!w) return;
    const c = this.customer;
    if (c) {
      // Il vient se placer devant le comptoir (2,1 m du joueur, côté porte)
      const s = Math.sin(w.yaw);
      const co = Math.cos(w.yaw);
      const tx = w.x + w.st.spot.x * co + w.st.spot.z * s;
      const tz = w.z - w.st.spot.x * s + w.st.spot.z * co;
      const dx = tx - c.g.position.x;
      const dz = tz - c.g.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.15) {
        // On l'a déjà servi (OK appuyé) : il presse le pas, pour que le geste ne reste pas en attente
        const v = w.act ? 6 : 2.4;
        c.g.position.x += (dx / d) * Math.min(d, v * dt);
        c.g.position.z += (dz / d) * Math.min(d, v * dt);
        c.g.rotation.y = Math.atan2(dx, dz);
        c.phase += dt * (w.act ? 16 : 9);
        animateWalk(c.g, c.phase, 0.55);
      } else {
        c.arrived = true;
        c.g.rotation.y = Math.atan2(w.x - c.g.position.x, w.z - c.g.position.z);
        animateWalk(c.g, 0, 0);
      }
    }
    const act = w.act;
    if (!act) return;
    if (act.t === 0 && c && !c.arrived && act.wait < 1) {
      act.wait += dt;
      return;
    }
    act.t += dt;
    const p = Math.min(1, act.t / act.dur);
    poseArms(this.player, w.st.motion, act.t, p);
    const goods = w.st.goods;
    if (goods) {
      goods.mesh.visible = p > 0.12 && p < 0.8;
      goods.mesh.position.lerpVectors(goods.from, goods.to, Math.min(1, Math.max(0, (p - 0.12) / 0.4)));
    }
    if (p >= 1) {
      if (goods) goods.mesh.visible = false;
      restArms(this.player);
      act.done();
    }
  }

  dispose(): void {
    this.setWork(null);
    window.dispatchEvent(new CustomEvent<HomeAct | null>(HOME_ACT_STATE, { detail: null }));
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointercancel', this.onCancel);
    el.removeEventListener('wheel', this.onWheel);
    window.removeEventListener(SLEEP_EVENT, this.onSleep);
    window.removeEventListener(HOME_ACT_EVENT, this.onAct);
    window.removeEventListener(COOK_EVENT, this.onCook);
    window.removeEventListener(HOME_STOP_EVENT, this.onStop);
    window.removeEventListener(WORSHIP_EVENT, this.onWorship);
    window.removeEventListener(CONSULT_EVENT, this.onConsult);
    window.removeEventListener(DANCE_EVENT, this.onDance);
    this.consultation?.dispose();
    this.consultDone?.();
    this.consultDone = null;
    this.ward?.dispose();
    this.worship?.dispose();
    this.geos.forEach((g) => g.dispose());
    this.disposables.forEach((m) => m.dispose());
    this.mats.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    el.remove();
  }
}
