import * as THREE from 'three';
import type { Quality } from '../lib/prefs';
import { PROFILES, pixelRatioFor, type QualityProfile } from './quality';
import { animateWalk, buildPerson, Materials, randomLook, rng, type PersonLook } from './kit';
import { buildMoto } from './vehicles';

/**
 * Salle de cours (m) : le tableau et l'écran de projection sont au fond, vers −z ; les élèves, assis à leurs tables,
 * regardent vers −z. Le joueur est au milieu de la salle.
 */
const ROOM = { w: 13, z0: -7, z1: 8, h: 3.4 };
const ROWS = [-3.0, -1.6, -0.2, 1.2, 2.6, 4.0];
const COLS = [-4.0, -2.9, -0.55, 0.55, 2.9, 4.0];
const PLAYER_SEAT = { row: 3, col: 3 };
const SEAT_TOP = 0.47;
/** Hanches debout du personnage du kit : assis, son origine descend de HIP − SEAT_TOP. */
const HIP = 0.88;
const BOARD = { x: -1.6, y: 1.85, w: 5.2, h: 1.7 };
const SCREEN = { x: 3.7, y: 2.0, w: 3.0, h: 1.9 };
const PROJECTOR = new THREE.Vector3(3.7, 3.15, -1.2);
/** Bureau du professeur, dans le coin gauche : il ne gêne pas ses allées et venues entre tableau et écran. */
const DESK = { x: -5.0, z: -4.4 };
/** Objet de démonstration, dans le coin droit. */
const PROP = { x: 5.0, z: -4.0 };

/** Ce que fait le professeur : écrire au tableau, commenter la diapositive projetée, expliquer à la classe, interroger. */
export type LecturePhase = 'board' | 'slides' | 'explain' | 'question';
/** Objet de démonstration posé devant la classe pour les apprentissages. */
export type LectureProp = 'moto' | 'sewing' | 'barber' | null;

interface Student {
  g: THREE.Group;
  phase: number;
  /** Fin du bras levé (s), 0 si le bras est baissé. */
  handUntil: number;
}

interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  secs: number;
}

/**
 * Séance de cours vue en 3D : salle pleine, professeur qui écrit au tableau, projette des diapositives, circule et
 * interroge ; les élèves prennent des notes et lèvent la main. La caméra alterne plan large, professeur et joueur.
 * Purement visuel : la séance elle-même (horaires, question) est décidée par le serveur.
 */
export class Lecture {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 80);
  private readonly profile: QualityProfile;
  private readonly mats: Materials;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly ownMats: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly students: Student[] = [];
  private readonly teacher: THREE.Group;
  private player: THREE.Group | null = null;
  private youArrow: THREE.Mesh | null = null;
  private readonly board: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; key: string };
  private readonly screen: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; key: string };
  private readonly beam: THREE.Mesh;
  private readonly windows: THREE.MeshBasicMaterial;
  private readonly fans: THREE.Group[] = [];
  private readonly hemi: THREE.HemisphereLight;
  private readonly resizeObs: ResizeObserver;
  private readonly rand = rng(777);
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private readonly lookNow = new THREE.Vector3();
  private shots: Shot[] = [];
  private shot = 0;
  private shotT = 0;
  private phase: LecturePhase = 'explain';
  private boardProgress = 0;
  private raf = 0;
  private last = 0;
  private t = 0;
  private disposed = false;
  getMinute: (() => number) | null = null;

  constructor(private readonly container: HTMLElement, quality: Quality, look: PersonLook, o: { teacherFemale: boolean; teacherSeed: number; prop: LectureProp }) {
    this.profile = PROFILES[quality];
    this.mats = new Materials(this.profile.standardMaterials);
    this.renderer = new THREE.WebGLRenderer({ antialias: this.profile.antialias, alpha: false, stencil: false });
    this.renderer.setPixelRatio(pixelRatioFor(quality));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.className = 'world-canvas';
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x1d2433);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xa89a80, 1.05);
    const key = new THREE.DirectionalLight(0xfff4dc, 0.7);
    key.position.set(-6, 8, 4);
    this.scene.add(this.hemi, key);

    this.buildRoom();
    this.board = this.canvasPanel(BOARD.w, BOARD.h, 1024, BOARD.x, BOARD.y, ROOM.z0 + 0.09, 0x2f5d3a);
    this.screen = this.canvasPanel(SCREEN.w, SCREEN.h, 768, SCREEN.x, SCREEN.y, ROOM.z0 + 0.09, 0xf2f2ee);
    this.beam = this.buildBeam();
    this.buildDesks();
    this.buildStudents(look, quality === 'low' ? 0.45 : quality === 'medium' ? 0.65 : 0.8);
    this.teacher = buildPerson(this.mats, { ...randomLook(rng(o.teacherSeed)), female: o.teacherFemale });
    this.teacher.position.set(-0.5, 0, -4.8);
    this.scene.add(this.teacher);
    this.buildProp(o.prop);
    this.windows = this.own(new THREE.MeshBasicMaterial({ color: 0x0f1a33 }));
    for (const z of [-3.5, 0.5, 4.5]) {
      const pane = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(2.4, 1.4)), this.windows);
      pane.position.set(-ROOM.w / 2 + 0.07, 1.9, z);
      pane.rotation.y = Math.PI / 2;
      this.scene.add(pane);
      this.box(0.04, 1.5, 0.08, 0xe9e4d8, -ROOM.w / 2 + 0.09, 1.9, z); // meneau
    }
    if (this.player) {
      const arrow = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.09, 0.18, 12)), this.own(new THREE.MeshBasicMaterial({ color: 0xe5383b, depthTest: false, transparent: true })));
      arrow.rotation.x = Math.PI;
      arrow.renderOrder = 10;
      this.scene.add(arrow);
      this.youArrow = arrow;
    }

    // Redessiner aussitôt après un redimensionnement : un canvas redimensionné est vide jusqu'à l'image suivante
    this.resizeObs = new ResizeObserver(() => {
      this.resize();
      if (!this.disposed) this.renderer.render(this.scene, this.camera);
    });
    this.resizeObs.observe(container);
    this.resize();
    this.camera.position.copy(this.camPos);
    this.lookNow.copy(this.camLook);
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

  private box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, parent: THREE.Object3D = this.scene): THREE.Mesh {
    const m = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, h, d)), this.mats.color(color));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  /** Sol carrelé, murs, plinthe, plafond éclairé, ventilateurs, porte et prises. */
  private buildRoom(): void {
    const { w, z0, z1, h } = ROOM;
    const len = z1 - z0;
    const mid = (z0 + z1) / 2;
    this.box(w, 0.1, len, 0xcfc3a8, 0, -0.05, mid);
    this.box(w - 1, 0.1, 2.2, 0xb59f7a, 0, 0.0, z0 + 1.6); // estrade du professeur, à peine surélevée
    const ceiling = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, 0.08, len)), this.own(new THREE.MeshBasicMaterial({ color: 0xe9e9e4 })));
    ceiling.position.set(0, h, mid);
    this.scene.add(ceiling);
    const glow = this.own(new THREE.MeshBasicMaterial({ color: 0xfffbe8 }));
    for (const x of [-3.2, 3.2]) {
      for (const z of [-4.5, 0, 4.5]) {
        const tube = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.25, 0.04, 1.4)), glow);
        tube.position.set(x, h - 0.05, z);
        this.scene.add(tube);
      }
    }
    // Murs : bas peint plus foncé, haut crème
    for (const sx of [-1, 1]) {
      this.box(0.1, h, len, 0xf1e9d8, (sx * w) / 2, h / 2, mid);
      this.box(0.12, 1.0, len, 0x7fa6c9, (sx * w) / 2, 0.5, mid);
    }
    this.box(w, h, 0.1, 0xf1e9d8, 0, h / 2, z0);
    this.box(w, h, 0.1, 0xf1e9d8, 0, h / 2, z1);
    this.box(w, 1.0, 0.12, 0x7fa6c9, 0, 0.5, z1);
    this.box(1.1, 2.2, 0.06, 0x7a4b28, w / 2 - 0.05, 1.1, z1 - 1.6).rotation.y = Math.PI / 2; // porte
    // Horloge murale au-dessus du tableau
    const clock = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 24)), this.mats.color(0xffffff));
    clock.rotation.x = Math.PI / 2;
    clock.position.set(BOARD.x, 3.0, z0 + 0.08);
    this.scene.add(clock);
    // Ventilateurs de plafond (on est à Lomé)
    for (const [x, z] of [[-2.5, -1], [2.5, 2.5]] as const) {
      const fan = new THREE.Group();
      fan.position.set(x, h - 0.45, z);
      this.box(0.04, 0.4, 0.04, 0x555555, 0, 0.22, 0, fan);
      this.box(0.18, 0.1, 0.18, 0x666666, 0, 0, 0, fan);
      for (let i = 0; i < 3; i++) {
        const blade = this.box(0.9, 0.02, 0.14, 0x8a6a4a, 0, -0.02, 0, fan);
        blade.geometry.translate(0.5, 0, 0);
        blade.rotation.y = (i * Math.PI * 2) / 3;
      }
      this.scene.add(fan);
      this.fans.push(fan);
    }
    // Bureau du professeur avec l'ordinateur relié au projecteur
    this.box(1.8, 0.06, 0.8, 0x6b4426, DESK.x, 0.75, DESK.z);
    this.box(1.7, 0.7, 0.05, 0x5a381f, DESK.x, 0.4, DESK.z + 0.38);
    this.box(0.38, 0.02, 0.26, 0x2b2f36, DESK.x + 0.4, 0.79, DESK.z - 0.1);
    const lid = this.box(0.38, 0.25, 0.015, 0x2b2f36, DESK.x + 0.4, 0.91, DESK.z - 0.22);
    lid.rotation.x = -0.25;
    this.box(0.3, 0.2, 0.02, 0x7fb3ff, DESK.x + 0.4, 0.91, DESK.z - 0.21).rotation.x = -0.25;
    // Projecteur suspendu
    this.box(0.04, 0.2, 0.04, 0x444444, PROJECTOR.x, ROOM.h - 0.1, PROJECTOR.z);
    this.box(0.42, 0.14, 0.34, 0xe4e4e4, PROJECTOR.x, PROJECTOR.y, PROJECTOR.z);
  }

  /** Panneau dont la face est un canvas (tableau noir à la craie, écran de projection). */
  private canvasPanel(w: number, h: number, px: number, x: number, y: number, z: number, frame: number) {
    this.box(w + 0.2, h + 0.2, 0.06, frame === 0x2f5d3a ? 0x5a3a20 : 0x3a3d44, x, y, z - 0.04);
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = Math.round((px * h) / w);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.textures.push(tex);
    // Sans tonemapping : la craie et le texte projeté gardent leur contraste
    const mesh = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(w, h)), this.own(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })));
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    const panel = { canvas, tex, key: '' };
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = frame === 0x2f5d3a ? '#2f5d3a' : '#e9e9e4';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      tex.needsUpdate = true;
    }
    return panel;
  }

  /** Faisceau du projecteur vers l'écran (visible pendant les diapositives). */
  private buildBeam(): THREE.Mesh {
    // Le faisceau s'arrête juste avant l'écran : il ne délave pas la diapositive
    const target = new THREE.Vector3(SCREEN.x, SCREEN.y, ROOM.z0 + 0.6);
    const dir = target.clone().sub(PROJECTOR);
    const len = dir.length();
    const cone = new THREE.Mesh(
      this.geo(new THREE.ConeGeometry(SCREEN.h * 0.55, len, 4, 1, true)),
      this.own(new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })),
    );
    // Pointe du cône (+y) sur l'objectif, base sur l'écran
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
    cone.position.copy(PROJECTOR).add(target).multiplyScalar(0.5);
    cone.rotateY(Math.PI / 4);
    cone.visible = false;
    this.scene.add(cone);
    return cone;
  }

  /** Tables et chaises des élèves, en instances ; cahiers ouverts sur les tables. */
  private buildDesks(): void {
    const n = ROWS.length * COLS.length;
    const seat = new THREE.InstancedMesh(this.geo(new THREE.BoxGeometry(0.44, 0.05, 0.42)), this.mats.color(0x8b5a2b), n);
    const back = new THREE.InstancedMesh(this.geo(new THREE.BoxGeometry(0.44, 0.42, 0.04)), this.mats.color(0x7a4d24), n);
    const top = new THREE.InstancedMesh(this.geo(new THREE.BoxGeometry(0.98, 0.05, 0.48)), this.mats.color(0xa0703f), n);
    const leg = new THREE.InstancedMesh(this.geo(new THREE.BoxGeometry(0.05, 0.72, 0.05)), this.mats.color(0x3d3d3d), n * 2);
    const book = new THREE.InstancedMesh(this.geo(new THREE.BoxGeometry(0.34, 0.012, 0.24)), this.mats.color(0xfbfaf4), n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    let i = 0;
    for (const z of ROWS) {
      for (const x of COLS) {
        seat.setMatrixAt(i, m.compose(p.set(x, SEAT_TOP - 0.025, z), q, s));
        back.setMatrixAt(i, m.compose(p.set(x, SEAT_TOP + 0.24, z + 0.22), q, s));
        top.setMatrixAt(i, m.compose(p.set(x, 0.74, z - 0.5), q, s));
        leg.setMatrixAt(i * 2, m.compose(p.set(x - 0.42, 0.36, z - 0.5), q, s));
        leg.setMatrixAt(i * 2 + 1, m.compose(p.set(x + 0.42, 0.36, z - 0.5), q, s));
        book.setMatrixAt(i, m.compose(p.set(x + 0.05, 0.772, z - 0.42), q, s));
        i++;
      }
    }
    this.scene.add(seat, back, top, leg, book);
  }

  /** Élèves assis (plus ou moins nombreux selon la qualité), le joueur parmi eux. */
  private buildStudents(look: PersonLook, fill: number): void {
    const r = this.rand;
    ROWS.forEach((z, row) => {
      COLS.forEach((x, col) => {
        const isPlayer = row === PLAYER_SEAT.row && col === PLAYER_SEAT.col;
        if (!isPlayer && r() > fill) return;
        const g = buildPerson(this.mats, isPlayer ? look : randomLook(r));
        g.position.set(x, SEAT_TOP - HIP, z);
        g.rotation.y = Math.PI;
        this.seat(g);
        this.scene.add(g);
        if (isPlayer) this.player = g;
        this.students.push({ g, phase: r() * 10, handUntil: 0 });
      });
    });
  }

  /** Cuisses à l'horizontale, jambes qui pendent jusqu'au sol. */
  private seat(g: THREE.Group): void {
    for (const n of ['legL', 'legR']) {
      const leg = g.getObjectByName(n);
      if (!leg) continue;
      leg.rotation.x = -Math.PI / 2;
      const shin = leg.getObjectByName('shin');
      if (shin) shin.rotation.x = Math.PI / 2;
    }
  }

  private buildProp(prop: LectureProp): void {
    if (prop === 'moto') {
      const moto = buildMoto(this.mats, 0xe5383b);
      moto.position.set(PROP.x, 0.05, PROP.z);
      moto.rotation.y = Math.PI / 2.4;
      this.scene.add(moto);
    } else if (prop === 'sewing') {
      // Machine à coudre sur le bureau et rouleaux de pagne
      this.box(0.42, 0.22, 0.2, 0x1d1d1d, DESK.x - 0.4, 0.89, DESK.z);
      this.box(0.08, 0.16, 0.18, 0x1d1d1d, DESK.x - 0.23, 1.04, DESK.z);
      for (const [i, c] of [0xe5383b, 0xffce00, 0x1f6feb].entries()) {
        const roll = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 14)), this.mats.color(c));
        roll.rotation.z = Math.PI / 2;
        roll.position.set(PROP.x, 0.1 + i * 0.18, PROP.z);
        this.scene.add(roll);
      }
    } else if (prop === 'barber') {
      this.box(0.6, 0.12, 0.6, 0x222222, PROP.x, 0.55, PROP.z);
      this.box(0.6, 0.7, 0.08, 0x222222, PROP.x, 0.95, PROP.z + 0.3);
      this.box(0.12, 0.5, 0.12, 0x9a9a9a, PROP.x, 0.25, PROP.z);
    }
  }

  /** Change ce que fait le professeur. */
  setPhase(phase: LecturePhase): void {
    this.phase = phase;
    this.beam.visible = phase === 'slides';
    if (phase === 'question') {
      // Quelques élèves lèvent la main pour répondre
      for (const s of this.students) if (s.g !== this.player && this.rand() < 0.35) s.handUntil = this.t + 3 + this.rand() * 5;
    }
  }

  /** Tableau : titre et texte écrits à la craie, `progress` (0–1) de la phrase déjà écrite. */
  setBoard(title: string, text: string, progress: number): void {
    this.boardProgress = Math.min(1, Math.max(0, progress));
    const shown = text.slice(0, Math.round(text.length * this.boardProgress));
    const key = `${title}|${shown}`;
    if (key === this.board.key) return;
    this.board.key = key;
    const ctx = this.board.canvas.getContext('2d');
    if (!ctx) return;
    const { width: W, height: H } = this.board.canvas;
    ctx.fillStyle = '#2f5d3a';
    ctx.fillRect(0, 0, W, H);
    // Traces d'effaçage
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < 6; i++) ctx.fillRect(40 + i * 160, 30 + (i % 3) * 70, 150, 50);
    ctx.font = 'bold 36px "Comic Sans MS", "Segoe Print", cursive';
    ctx.fillStyle = '#ffe28a';
    const head = wrap(ctx, title, W - 64)[0] ?? '';
    ctx.fillText(head, 32, 52);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(32, 66, Math.min(W - 64, ctx.measureText(head).width), 3);
    ctx.font = 'bold 44px "Comic Sans MS", "Segoe Print", cursive';
    ctx.fillStyle = '#f4f4ee';
    wrap(ctx, shown, W - 64).slice(0, 5).forEach((line, i) => ctx.fillText(line, 32, 124 + i * 52));
    this.board.tex.needsUpdate = true;
  }

  /** Écran : diapositive (titre, pictogramme, texte), ou écran éteint si `text` est null. */
  setSlide(title: string, emoji: string, text: string | null): void {
    const key = text === null ? '' : `${title}|${text}`;
    if (key === this.screen.key) return;
    this.screen.key = key;
    const ctx = this.screen.canvas.getContext('2d');
    if (!ctx) return;
    const { width: W, height: H } = this.screen.canvas;
    if (text === null) {
      ctx.fillStyle = '#e9e9e4';
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#1f6feb';
      ctx.fillRect(0, 0, W, 92);
      ctx.fillStyle = '#ffce00';
      ctx.fillRect(0, 92, W, 8);
      ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(wrap(ctx, title, W - 60)[0] ?? '', 30, 60);
      ctx.font = '84px system-ui, sans-serif';
      ctx.fillText(emoji, W - 120, H - 36);
      ctx.font = 'bold 36px system-ui, sans-serif';
      ctx.fillStyle = '#14213d';
      wrap(ctx, text, W - 80).slice(0, 7).forEach((line, i) => {
        ctx.fillText(i === 0 ? `• ${line}` : `  ${line}`, 30, 160 + i * 46);
      });
    }
    this.screen.tex.needsUpdate = true;
  }

  /** Plans de caméra : salle entière, professeur, joueur à sa table ; on alterne au fil du cours. */
  private computeShots(portrait: boolean): void {
    const p = this.player?.position ?? new THREE.Vector3(0.55, 0, 1.2);
    const k = portrait ? 1.25 : 1;
    this.shots = [
      { pos: new THREE.Vector3(4.4 * k, 2.6, 7.2), look: new THREE.Vector3(-0.3, 1.0, -4.5), secs: 14 },
      { pos: new THREE.Vector3(1.6, 1.8, -1.2), look: new THREE.Vector3(-0.8, 1.6, -6.2), secs: 9 },
      { pos: new THREE.Vector3(-5.0, 2.4, 6.5), look: new THREE.Vector3(1.0, 0.9, -3.5), secs: 11 },
      { pos: new THREE.Vector3(p.x + 1.3, 1.55, p.z - 1.9), look: new THREE.Vector3(p.x, 1.0, p.z), secs: 7 },
    ];
    // En portrait, la carte du cours couvre le bas de l'écran : on regarde plus bas pour remonter la scène dans l'image
    if (portrait) for (const s of this.shots) s.look.y -= 1.1;
  }

  private readonly loop = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const minDt = 1000 / this.profile.maxFps;
    if (this.last && now - this.last < minDt - 1) return;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this.t += dt;

    // Caméra : un plan après l'autre, transition douce
    this.shotT += dt;
    const cur = this.shots[this.shot];
    if (cur && this.shotT > cur.secs) {
      this.shotT = 0;
      this.shot = (this.shot + 1) % this.shots.length;
    }
    const s = this.shots[this.shot];
    if (s) {
      const k = 1 - Math.exp(-dt * 1.4);
      this.camera.position.lerp(s.pos, k);
      this.lookNow.lerp(s.look, k);
      this.camera.lookAt(this.lookNow);
    }
    for (const f of this.fans) f.rotation.y += dt * 5;

    this.animateTeacher(dt);
    this.animateStudents();
    if (this.youArrow && this.player) {
      const p = this.player.position;
      this.youArrow.position.set(p.x, 1.75 + Math.sin(this.t * 3) * 0.04, p.z);
    }
    this.applyDaylight();
    this.renderer.render(this.scene, this.camera);
  };

  /** Le professeur va à sa place pour la phase en cours, puis écrit, montre l'écran, explique ou interroge. */
  private animateTeacher(dt: number): void {
    const g = this.teacher;
    let tx: number;
    let tz: number;
    let face: number;
    if (this.phase === 'board') {
      tx = BOARD.x - BOARD.w / 2 + 0.7 + this.boardProgress * (BOARD.w - 1.6);
      tz = ROOM.z0 + 0.65;
      face = Math.PI;
    } else if (this.phase === 'slides') {
      tx = SCREEN.x - SCREEN.w / 2 - 0.7;
      tz = ROOM.z0 + 1.3;
      face = 0;
    } else if (this.phase === 'explain') {
      // Va et vient devant la classe
      tx = -0.8 + Math.sin(this.t * 0.18) * 2.4;
      tz = ROOM.z0 + 2.3;
      face = 0;
    } else {
      tx = -0.4;
      tz = ROOM.z0 + 2.5;
      face = 0;
    }
    const dx = tx - g.position.x;
    const dz = tz - g.position.z;
    const d = Math.hypot(dx, dz);
    const turn = (to: number, k: number) => (g.rotation.y += Math.atan2(Math.sin(to - g.rotation.y), Math.cos(to - g.rotation.y)) * Math.min(1, dt * k));
    const armL = g.getObjectByName('armL');
    const armR = g.getObjectByName('armR');
    const foreL = armL?.getObjectByName('forearm');
    const foreR = armR?.getObjectByName('forearm');
    if (armR) armR.rotation.z = 0.06;
    // Au tableau il suit la craie à petits pas ; ailleurs, au-delà de 15 cm il marche
    if (d > (this.phase === 'board' ? 0.6 : 0.15)) {
      const step = Math.min(d, 1.1 * dt);
      g.position.x += (dx / d) * step;
      g.position.z += (dz / d) * step;
      turn(Math.atan2(dx, dz), 8);
      animateWalk(g, this.t * 7, 0.5);
      return;
    }
    if (this.phase === 'board' && d > 0.02) {
      const step = Math.min(d, 0.5 * dt);
      g.position.x += (dx / d) * step;
      g.position.z += (dz / d) * step;
    }
    turn(face, 5);
    animateWalk(g, 0, 0);
    if (!armL || !armR || !foreL || !foreR) return;
    if (this.phase === 'board') {
      // Bras droit levé vers le tableau, la craie trace de petites boucles
      armR.rotation.x = -2.1 + Math.sin(this.t * 9) * 0.08;
      foreR.rotation.x = -0.5 + Math.cos(this.t * 9) * 0.12;
      armL.rotation.x = -0.25;
      foreL.rotation.x = -1.2;
    } else if (this.phase === 'slides') {
      // Face à la classe, bras tendu vers l'écran sur sa droite
      armR.rotation.x = -0.35;
      armR.rotation.z = 1.25 + Math.sin(this.t * 1.5) * 0.05;
      foreR.rotation.x = -0.15;
      armL.rotation.x = -0.3;
      foreL.rotation.x = -1.3;
    } else if (this.phase === 'explain') {
      // Gestes des mains en parlant
      armR.rotation.x = -0.55 + Math.sin(this.t * 2.3) * 0.25;
      foreR.rotation.x = -1.0 + Math.sin(this.t * 3.1) * 0.3;
      armL.rotation.x = -0.45 + Math.sin(this.t * 1.9 + 1) * 0.2;
      foreL.rotation.x = -0.9 + Math.sin(this.t * 2.7 + 2) * 0.25;
    } else {
      // Interroge : désigne la classe
      armR.rotation.x = -1.35;
      foreR.rotation.x = -0.1;
      armL.rotation.x = -0.1;
      foreL.rotation.x = -0.4;
    }
  }

  /** Les élèves prennent des notes (tableau, diapositive), écoutent ou lèvent la main. */
  private animateStudents(): void {
    const writing = this.phase === 'board' || this.phase === 'slides';
    for (const s of this.students) {
      const armL = s.g.getObjectByName('armL');
      const armR = s.g.getObjectByName('armR');
      const foreL = armL?.getObjectByName('forearm');
      const foreR = armR?.getObjectByName('forearm');
      if (!armL || !armR || !foreL || !foreR) continue;
      // Pendant les explications, une main se lève de temps en temps
      if (this.phase === 'explain' && s.handUntil === 0 && s.g !== this.player && this.rand() < 0.0004) s.handUntil = this.t + 3;
      if (s.handUntil && this.t > s.handUntil) s.handUntil = 0;
      armL.rotation.x = -0.7;
      foreL.rotation.x = -1.0;
      if (s.handUntil) {
        armR.rotation.x = -2.95;
        foreR.rotation.x = -0.1;
      } else if (writing && Math.sin(this.t * 0.4 + s.phase) > -0.4) {
        // Écrit dans son cahier : la main va et vient sur la ligne
        armR.rotation.x = -0.75 + Math.sin(this.t * 6 + s.phase) * 0.05;
        foreR.rotation.x = -0.95 + Math.cos(this.t * 6 + s.phase) * 0.08;
      } else {
        armR.rotation.x = -0.7;
        foreR.rotation.x = -1.05;
      }
      // Léger balancement sur sa chaise
      s.g.rotation.y = Math.PI + Math.sin(this.t * 0.3 + s.phase) * 0.06;
    }
  }

  /** Fenêtres : ciel de jour, coucher de soleil ou nuit noire selon l'heure du cours. */
  private applyDaylight(): void {
    const m = this.getMinute?.() ?? 19 * 60;
    const h = m / 60;
    const c = h >= 7 && h < 17.5 ? 0xbfe3ff : h >= 17.5 && h < 18.7 ? 0xf2a65a : 0x0f1a33;
    if (this.windows.color.getHex() !== c) this.windows.color.setHex(c);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 72 : 52;
    this.camera.updateProjectionMatrix();
    this.computeShots(w < h);
    const s = this.shots[this.shot]!;
    this.camPos.copy(s.pos);
    this.camLook.copy(s.look);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    const all = new Set<THREE.BufferGeometry>(this.geos);
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) all.add(o.geometry);
    });
    all.forEach((g) => g.dispose());
    this.ownMats.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.mats.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

/** Coupe un texte en lignes qui tiennent dans `max` pixels. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
