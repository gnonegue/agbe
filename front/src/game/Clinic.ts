// Scènes de l'hôpital : consultation illustrée (examen, résultats, ordonnance) et salle d'hospitalisation
// (le patient alité reçoit les soins, les médecins et infirmières passent le voir jusqu'à sa guérison).
import * as THREE from 'three';
import { animateWalk, buildPerson, randomLook, sitPose, type GarmentDef, type Materials } from './kit';
import { restArms } from './workstation';

/** Événement envoyé par l'écran de jeu après une consultation payée ; la pièce de clinique le joue. */
export const CONSULT_EVENT = 'agbe-consult';
export type ConsultPhase = 'examine' | 'results' | 'prescription';
export interface ConsultLabels {
  examine: string;
  results: string;
  prescription: string;
}
/** Détail de l'événement : textes traduits et étapes à jouer (la consultation d'abord, puis résultats et ordonnance après les analyses). */
export interface ConsultDetail {
  labels: ConsultLabels;
  phases: ConsultPhase[];
  /** Appelé à la fin de la scène, ou aussitôt si elle ne peut pas se jouer. */
  onDone?: () => void;
}

export interface ClinicCtx {
  scene: THREE.Scene;
  mats: Materials;
  rand: () => number;
  geos: THREE.BufferGeometry[];
  disposables: THREE.Material[];
  /** Pièce visible : fermée à cette heure, personne ne soigne. */
  open: boolean;
}

const ease = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Vêtement de service (blouse, tunique, pantalon), décrit comme un vêtement du catalogue pour être dessiné par `buildPerson`. */
const uniform = (slot: 'top' | 'bottom', style: string, color: number): GarmentDef => ({ id: `staff-${slot}-${style}`, slot, gender: 'u', style, fabric: 'plain', color, pattern: 0, price: 0, emoji: '', nameFr: '', nameEn: '' });

/**
 * Personnel soignant, habillé comme le joueur (vrais bras, vraies jambes) : le médecin porte une blouse blanche ouverte,
 * à manches longues et à pans jusqu'aux genoux, sur un pantalon sombre, stéthoscope au cou ; l'infirmière une tenue
 * (tunique à manches courtes et pantalon) d'une seule couleur.
 */
function buildStaff(ctx: ClinicCtx, kind: 'doctor' | 'nurse' = 'doctor'): THREE.Group {
  const doctor = kind === 'doctor';
  const scrubs = 0x5fb8c4;
  const look = {
    ...randomLook(ctx.rand),
    wear: doctor
      ? { top: uniform('top', 'jacket', 0xf7f8fa), bottom: uniform('bottom', 'trousers', 0x2b3a55) }
      : { top: uniform('top', 'tee', scrubs), bottom: uniform('bottom', 'trousers', scrubs) },
  };
  const g = buildPerson(ctx.mats, look);
  if (doctor) {
    // Pans de la blouse sous la taille, ouverts devant
    const coatMat = new THREE.MeshLambertMaterial({ color: 0xf7f8fa, side: THREE.DoubleSide });
    ctx.disposables.push(coatMat);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.245, 0.42, 16, 1, true, 0.35, Math.PI * 2 - 0.7), coatMat);
    tail.position.set(0, 0.74, 0);
    tail.scale.set(1, 1, 0.8);
    g.add(tail);
    const steth = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 16, Math.PI * 1.3), ctx.mats.color(0x20242a));
    steth.position.set(0, 1.45, 0.11);
    steth.rotation.set(-0.25, 0, Math.PI * 1.15);
    g.add(steth);
    ctx.geos.push(tail.geometry, steth.geometry);
  }
  return g;
}

/** Bulle au-dessus d'un personnage : une icône et, au besoin, une ligne de texte (déjà traduite). */
function makeBubble(ctx: ClinicCtx, icon: string, text = ''): THREE.Sprite {
  const cv = document.createElement('canvas');
  // Icône seule : petite bulle ronde ; avec texte : bulle large
  cv.width = text ? 512 : 128;
  cv.height = text ? 160 : 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = 'rgba(255,255,255,0.96)';
  g.strokeStyle = '#1f6feb';
  g.lineWidth = 5;
  const r = text ? 28 : 59;
  const w = cv.width - 10;
  const h = cv.height - 10;
  g.beginPath();
  g.moveTo(5 + r, 5);
  g.arcTo(5 + w, 5, 5 + w, 5 + h, r);
  g.arcTo(5 + w, 5 + h, 5, 5 + h, r);
  g.arcTo(5, 5 + h, 5, 5, r);
  g.arcTo(5, 5, 5 + w, 5, r);
  g.closePath();
  g.fill();
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '56px system-ui, sans-serif';
  g.fillStyle = '#14213d';
  g.fillText(icon, cv.width / 2, text ? 52 : cv.height / 2);
  if (text) {
    let size = 34;
    g.font = `800 ${size}px system-ui, sans-serif`;
    while (g.measureText(text).width > cv.width - 40 && size > 16) g.font = `800 ${(size -= 2)}px system-ui, sans-serif`;
    g.fillText(text, cv.width / 2, 116);
  }
  // Sans espace sRGB, le blanc, le bleu et l'icône sortent délavés
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  ctx.disposables.push(mat);
  const s = new THREE.Sprite(mat);
  const sw = text ? 4.6 : 1.1;
  s.scale.set(sw, (sw * cv.height) / cv.width, 1);
  s.renderOrder = 30;
  return s;
}

/**
 * Consultation : le patient s'assoit face au médecin, qui l'examine (stéthoscope), commente les résultats puis
 * lui remet l'ordonnance. `update` rend false une fois la scène finie.
 */
export class Consultation {
  private readonly doctor: THREE.Group;
  private readonly stool: THREE.Mesh;
  private readonly paper: THREE.Mesh;
  private bubble: THREE.Sprite | null = null;
  private stage = -1;
  private readonly t0 = performance.now();
  private readonly from: THREE.Vector3;
  private readonly doctorFrom: THREE.Vector3;
  private seated = false;
  private readonly seat = new THREE.Vector3(0.5, 0, 1.9);
  private readonly desk = new THREE.Vector3(0.5, 0, -0.1);

  constructor(
    private readonly ctx: ClinicCtx,
    private readonly player: THREE.Group,
    private readonly labels: ConsultLabels,
    private readonly phases: ConsultPhase[],
    private readonly done: () => void,
  ) {
    this.from = player.position.clone();
    this.doctor = buildStaff(ctx);
    this.doctorFrom = new THREE.Vector3(5.2, 0, 1.4);
    this.doctor.position.copy(this.doctorFrom);
    ctx.scene.add(this.doctor);
    this.stool = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.55), ctx.mats.color(0x1f6feb));
    this.stool.position.set(this.seat.x, 0.22, this.seat.z);
    this.stool.visible = false;
    this.paper = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.44), ctx.mats.color(0xffffff));
    this.paper.visible = false;
    ctx.geos.push(this.stool.geometry, this.paper.geometry);
    ctx.scene.add(this.stool, this.paper);
  }

  private show(stage: number): void {
    if (stage === this.stage) return;
    this.stage = stage;
    if (this.bubble) {
      this.ctx.scene.remove(this.bubble);
      this.bubble = null;
    }
    const L = this.labels;
    const phase = this.phases[stage];
    const spec = phase === 'examine' ? ['🩺', L.examine] : phase === 'results' ? ['📋', L.results] : phase === 'prescription' ? ['💊', L.prescription] : null;
    if (!spec) return;
    this.bubble = makeBubble(this.ctx, spec[0]!, spec[1]);
    this.ctx.scene.add(this.bubble);
  }

  /** Durée de chaque étape (s). */
  private static readonly LENGTH: Record<ConsultPhase, number> = { examine: 3.2, results: 3.2, prescription: 2.8 };

  update(now: number): boolean {
    const t = (now - this.t0) / 1000;
    const p = this.player;
    const d = this.doctor;
    const arm = (g: THREE.Object3D, n: string) => g.getObjectByName(n);
    if (t < 2.2) {
      // Arrivée : le patient va à sa place, le médecin se poste devant lui
      const k = ease(t / 2.2);
      p.position.set(lerp(this.from.x, this.seat.x, k), 0, lerp(this.from.z, this.seat.z - 0.6, k));
      p.rotation.y = Math.atan2(this.seat.x - this.from.x, this.seat.z - 0.6 - this.from.z);
      animateWalk(p, now / 120, 0.9);
      d.position.set(lerp(this.doctorFrom.x, this.desk.x, k), 0, lerp(this.doctorFrom.z, this.desk.z, k));
      d.rotation.y = Math.atan2(this.desk.x - this.doctorFrom.x, this.desk.z - this.doctorFrom.z);
      animateWalk(d, now / 120, 0.9);
    } else {
      if (!this.seated) {
        this.seated = true;
        animateWalk(p, 0, 0);
        animateWalk(d, 0, 0);
        this.stool.visible = true;
        p.position.set(this.seat.x, 0, this.seat.z);
        sitPose(p);
        p.rotation.y = Math.PI; // face au médecin
        d.rotation.y = 0;
      }
      const aR = arm(d, 'armR');
      const aL = arm(d, 'armL');
      const fR = aR?.getObjectByName('forearm');
      // Étape en cours d'après l'horaire des étapes demandées
      let at = t - 2.2;
      let idx = -1;
      for (let i = 0; i < this.phases.length; i++) {
        const len = Consultation.LENGTH[this.phases[i]!];
        if (at < len) {
          idx = i;
          break;
        }
        at -= len;
      }
      if (idx < 0) {
        this.finish();
        return false;
      }
      this.show(idx);
      const phase = this.phases[idx]!;
      if (phase === 'examine') {
        // Auscultation : la main du médecin se promène devant la poitrine du patient
        if (aR && fR) {
          aR.rotation.x = -1.2 + 0.1 * Math.sin(t * 5);
          aR.rotation.z = 0.12 * Math.sin(t * 2.5);
          fR.rotation.x = -0.4;
        }
        this.paper.visible = false;
      } else if (phase === 'results') {
        // Il montre et note les résultats sur sa feuille
        if (aR && aL && fR) {
          aR.rotation.x = -0.9 + 0.05 * Math.sin(t * 14);
          aL.rotation.x = -0.7;
          fR.rotation.x = -0.9;
        }
        this.paper.visible = true;
        this.paper.position.set(d.position.x - 0.15, 1.05, d.position.z + 0.38);
        this.paper.rotation.set(-0.5, 0, 0);
      } else {
        // Ordonnance : la feuille passe de la main du médecin à celle du patient
        const k = ease(at / Consultation.LENGTH.prescription);
        if (aR && aL && fR) {
          aR.rotation.x = aL.rotation.x = -1.25 * Math.sin(Math.PI * Math.min(1, k));
          fR.rotation.x = -0.2;
        }
        this.paper.visible = true;
        this.paper.rotation.set(-0.2, 0, 0);
        this.paper.position.set(lerp(d.position.x - 0.15, p.position.x + 0.1, k), lerp(1.05, 1.0, k), lerp(d.position.z + 0.38, p.position.z - 0.25, k));
      }
      if (this.bubble) this.bubble.position.set(d.position.x + 0.4, 2.7, d.position.z);
    }
    return true;
  }

  /** Le patient se relève ; médecin, tabouret et feuille disparaissent. */
  private finish(): void {
    const p = this.player;
    if (this.seated) {
      for (const n of ['legL', 'legR']) {
        const l = p.getObjectByName(n);
        if (l) l.rotation.x = 0;
      }
      p.position.y = 0;
    }
    restArms(p);
    animateWalk(p, 0, 0);
    this.dispose();
    this.done();
  }

  dispose(): void {
    const s = this.ctx.scene;
    s.remove(this.doctor, this.stool, this.paper);
    if (this.bubble) s.remove(this.bubble);
    this.bubble = null;
    restArms(this.doctor);
  }
}

/** Un soignant de la salle : aller au chevet, examiner, repartir (chemin par l'allée, jamais à travers un lit). */
interface WardStaff {
  g: THREE.Group;
  kind: 'doctor' | 'nurse';
  state: 'away' | 'going' | 'checking' | 'back';
  until: number;
  /** Place au chevet (chacun la sienne : ils ne se superposent jamais). */
  spot: THREE.Vector3;
  home: THREE.Vector3;
  route: THREE.Vector3[];
  bubble: THREE.Sprite | null;
  phase: number;
  speed: number;
}

/**
 * Salle d'hospitalisation : perfusion et moniteur près du lit ; un médecin et une infirmière viennent à tour de rôle
 * au chevet du patient, l'examinent, puis repartent vers leurs autres malades. Ils passent par l'allée centrale puis
 * l'allée entre les lits, et un seul est en route ou au chevet à la fois.
 */
export class Ward {
  private readonly staff: WardStaff[] = [];
  private readonly props: THREE.Object3D[] = [];
  private readonly monitor: THREE.MeshBasicMaterial;
  /** Allée longeant le lit du patient, et son débouché dans l'allée centrale (devant les lits). */
  private readonly aisle: THREE.Vector3;

  constructor(private readonly ctx: ClinicCtx, bed: { x: number; z: number }) {
    this.aisle = new THREE.Vector3(bed.x + 1.75, 0, bed.z + 3.7);
    const { mats, scene } = ctx;
    // Potence de perfusion et poche
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2, 6), mats.color(0xc8ccd2));
    pole.position.set(bed.x - 1.45, 1, bed.z - 0.5);
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.32, 0.08), mats.color(0xbfe3f5));
    bag.position.set(bed.x - 1.45, 1.85, bed.z - 0.5);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 10), mats.color(0x8d96a2));
    base.position.set(bed.x - 1.45, 0.02, bed.z - 0.5);
    // Moniteur à côté de la tête du lit
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.5), mats.color(0xe9edf2));
    stand.position.set(bed.x + 1.55, 0.45, bed.z - 1.2);
    this.monitor = new THREE.MeshBasicMaterial({ color: 0x1b3a2a });
    ctx.disposables.push(this.monitor);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.36), this.monitor);
    screen.position.set(bed.x + 1.55, 1.2, bed.z - 0.94);
    const casing = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.46, 0.18), mats.color(0x20242a));
    casing.position.set(bed.x + 1.55, 1.2, bed.z - 1.04);
    for (const m of [pole, bag, base, stand, screen, casing]) {
      ctx.geos.push(m.geometry);
      this.props.push(m);
      scene.add(m);
    }
    if (!ctx.open) return;
    // Postes de départ près de l'accueil, places au chevet : le médecin vers la tête du lit, l'infirmière vers le pied
    for (const [kind, homeX, spotZ, wait] of [['doctor', 3, bed.z - 0.4, 3000], ['nurse', 1.6, bed.z + 1.1, 9000]] as const) {
      const g = buildStaff(ctx, kind);
      g.position.set(homeX, 0, bed.z + 6.9);
      g.rotation.y = Math.PI;
      scene.add(g);
      const spot = new THREE.Vector3(this.aisle.x, 0, spotZ);
      this.staff.push({ g, kind, state: 'away', until: performance.now() + wait, spot, home: g.position.clone(), route: [], bubble: null, phase: 0, speed: 0 });
    }
  }

  private bubbleFor(s: WardStaff, icon: string): void {
    if (s.bubble) this.ctx.scene.remove(s.bubble);
    s.bubble = icon ? makeBubble(this.ctx, icon) : null;
    if (s.bubble) this.ctx.scene.add(s.bubble);
  }

  /** Avance le long de la route : démarre et s'arrête en douceur, tourne progressivement. Rend true à l'arrivée. */
  private walk(s: WardStaff, dt: number): boolean {
    const to = s.route[0];
    if (!to) return true;
    const dx = to.x - s.g.position.x;
    const dz = to.z - s.g.position.z;
    const dist = Math.hypot(dx, dz);
    const last = s.route.length === 1;
    // Point de passage : on coupe le virage ; dernier point : on s'arrête dessus
    if (dist < (last ? 0.05 : 0.45)) {
      s.route.shift();
      if (!s.route.length) {
        s.speed = 0;
        animateWalk(s.g, 0, 0);
        return true;
      }
      return false;
    }
    const cruise = 1.15;
    const want = last ? Math.min(cruise, 0.25 + dist * 1.4) : cruise;
    s.speed += Math.max(-2.5 * dt, Math.min(1.8 * dt, want - s.speed));
    const step = Math.min(dist, s.speed * dt);
    s.g.position.x += (dx / dist) * step;
    s.g.position.z += (dz / dist) * step;
    turnTowards(s.g, Math.atan2(dx, dz), dt);
    s.phase += dt * 7 * (s.speed / cruise);
    animateWalk(s.g, s.phase, Math.min(0.6, s.speed / 2));
    return false;
  }

  update(now: number, dt: number): void {
    // Moniteur : trace verte qui défile
    const beat = Math.sin(now / 160) > 0.92 ? 0x7dff9b : 0x2c8a4e;
    this.monitor.color.setHex(beat);
    for (const s of this.staff) {
      if (s.state === 'going' || s.state === 'back') {
        if (this.walk(s, dt)) {
          if (s.state === 'going') {
            s.state = 'checking';
            s.until = now + 4500 + (s.kind === 'nurse' ? 1000 : 0);
            this.bubbleFor(s, s.kind === 'doctor' ? '🩺' : '💉');
          } else {
            s.state = 'away';
            s.until = now + (s.kind === 'doctor' ? 9000 : 12000);
          }
        }
      } else if (s.state === 'checking') {
        // Face au lit, il examine : bras tendu vers le patient, puis note sur sa feuille
        turnTowards(s.g, -Math.PI / 2, dt);
        const arm = s.g.getObjectByName('armR');
        const fore = arm?.getObjectByName('forearm');
        if (arm && fore) {
          arm.rotation.x = -1.15 + 0.08 * Math.sin(now / 200);
          fore.rotation.x = -0.4;
        }
        if (now > s.until - 1500 && s.bubble && s.kind === 'doctor') this.bubbleFor(s, '📋');
        if (now > s.until) {
          restArms(s.g);
          this.bubbleFor(s, '');
          s.state = 'back';
          s.route = [this.aisle.clone(), s.home.clone()];
        }
      } else {
        turnTowards(s.g, Math.PI, dt);
        // Un seul soignant au chevet à la fois : l'autre attend qu'il soit revenu à son poste
        const busy = this.staff.some((o) => o !== s && o.state !== 'away');
        if (now > s.until && !busy) {
          s.state = 'going';
          s.route = [this.aisle.clone(), s.spot.clone()];
        } else if (busy && now > s.until) s.until = now + 1500;
      }
      if (s.bubble) s.bubble.position.set(s.g.position.x, 2.6, s.g.position.z);
    }
  }

  dispose(): void {
    for (const o of this.props) this.ctx.scene.remove(o);
    for (const s of this.staff) {
      this.ctx.scene.remove(s.g);
      if (s.bubble) this.ctx.scene.remove(s.bubble);
    }
  }
}

/** Tourne un personnage vers un cap, progressivement (par le plus court côté). */
function turnTowards(g: THREE.Object3D, yaw: number, dt: number): void {
  const diff = Math.atan2(Math.sin(yaw - g.rotation.y), Math.cos(yaw - g.rotation.y));
  g.rotation.y += diff * Math.min(1, dt * 7);
}
