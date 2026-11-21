// Lieux de culte : le joueur prie seul, assiste à l'office avec les fidèles, ou fait une offrande.
// Chaque personnage est porté par un pivot placé aux hanches : s'incliner, se prosterner ou s'asseoir
// se fait en tournant ce pivot et en contre-tournant les jambes pour qu'elles restent à la verticale.
import * as THREE from 'three';
import { animateWalk, buildPerson, randomLook, type Materials, type PersonLook } from './kit';

/** Événement émis par l'écran de jeu après une activité de culte réussie (détail : WorshipAct). */
export const WORSHIP_EVENT = 'agbe:worship';
export type WorshipAct = 'pray' | 'mass' | 'offering';
export type Faith = 'church' | 'mosque';

type Pt = { x: number; z: number };

/** Repères du lieu, posés par l'intérieur (bancs, tapis de prière, tronc, cierges). */
export interface SacredLayout {
  faith: Faith;
  /** Église : assises des bancs (yaw : face à l'autel) et point d'accès dans l'allée. */
  seats: { x: number; z: number; yaw: number; entry: Pt }[];
  /** Mosquée : places debout alignées face à la qibla. */
  spots: Pt[];
  /** Indice, dans seats ou spots, de la place du joueur. */
  playerPlace: number;
  /** Prêtre à l'autel ou imam sur le minbar (y : hauteur du sol sous ses pieds). */
  leader: { x: number; y: number; z: number; yaw: number };
  /** Tronc / boîte d'aumône : où se tenir (stand, tourné de yaw) et hauteur de la fente. */
  box: { x: number; z: number; top: number; stand: Pt; yaw: number };
  /** Église : support à cierges, pointes des cierges et nombre déjà allumés. */
  candles?: { stand: Pt; yaw: number; sticks: { x: number; y: number; z: number }[]; lit: number };
}

interface PoseParams {
  y: number;
  rx: number;
  leg: number;
  shin: number;
  arm: number;
  fore: number;
}

type PoseName = 'rest' | 'stand' | 'hands' | 'bow' | 'prostrate' | 'heels' | 'floor' | 'chair' | 'chairPray' | 'raise' | 'palms' | 'bend' | 'offer';

/**
 * Poses en angles du monde (0 = pendant vers le bas, négatif = vers l'avant) ; `shin` et `fore` sont relatifs
 * à la cuisse et au bras. `y` est la hauteur des hanches.
 */
const POSES: Record<PoseName, PoseParams> = {
  rest: { y: 0.95, rx: 0, leg: 0, shin: 0, arm: 0, fore: -0.05 },
  stand: { y: 0.95, rx: 0, leg: 0, shin: 0, arm: -0.45, fore: -1.55 },
  hands: { y: 0.95, rx: 0.08, leg: 0, shin: 0, arm: -0.7, fore: -1.7 },
  bow: { y: 0.95, rx: 1.35, leg: 0, shin: 0, arm: 0.1, fore: 0 },
  prostrate: { y: 0.5, rx: 1.5, leg: 0, shin: 1.45, arm: 0, fore: -0.1 },
  heels: { y: 0.32, rx: 0.12, leg: -1.2, shin: 2.6, arm: -0.7, fore: -0.15 },
  floor: { y: 0.14, rx: 0, leg: -1.5708, shin: 0, arm: -0.35, fore: -0.7 },
  chair: { y: 0.8, rx: 0, leg: -1.5708, shin: 1.5, arm: -0.5, fore: -0.9 },
  chairPray: { y: 0.8, rx: 0.4, leg: -1.5708, shin: 1.5, arm: -0.9, fore: -1.7 },
  raise: { y: 0.95, rx: 0, leg: 0, shin: 0, arm: -2.5, fore: -0.15 },
  palms: { y: 0.95, rx: 0, leg: 0, shin: 0, arm: -0.9, fore: -1.5 },
  bend: { y: 0.95, rx: 0.5, leg: 0, shin: 0, arm: -0.6, fore: -1.2 },
  offer: { y: 0.95, rx: 0.1, leg: 0, shin: 0, arm: -1.25, fore: -0.4 },
};

const HIP = 0.95;

/** Personnage posé sur un pivot aux hanches. */
class Actor {
  readonly root = new THREE.Group();
  private cur: PoseParams = { ...POSES.rest };
  private readonly legs: THREE.Object3D[];
  private readonly shins: THREE.Object3D[];
  private readonly arms: THREE.Object3D[];
  private readonly fores: THREE.Object3D[];
  /** Hauteur du sol sous ses pieds (minbar, estrade). */
  floor = 0;

  constructor(readonly body: THREE.Group) {
    this.root.rotation.order = 'YXZ';
    body.position.set(0, -HIP, 0);
    body.rotation.set(0, 0, 0);
    this.root.add(body);
    const named = (n: string) => ['L', 'R'].map((s) => body.getObjectByName(n + s)).filter((o): o is THREE.Object3D => !!o);
    this.legs = named('leg');
    this.arms = named('arm');
    this.shins = this.legs.map((l) => l.getObjectByName('shin')).filter((o): o is THREE.Object3D => !!o);
    this.fores = this.arms.map((a) => a.getObjectByName('forearm')).filter((o): o is THREE.Object3D => !!o);
    this.setPose('rest', 1);
  }

  place(x: number, z: number, yaw: number): void {
    this.root.position.x = x;
    this.root.position.z = z;
    this.root.rotation.y = yaw;
  }

  /** Glisse vers la pose (k = 1 : tout de suite). */
  setPose(name: PoseName, k: number): void {
    const t = POSES[name];
    const c = this.cur;
    for (const key of Object.keys(t) as (keyof PoseParams)[]) c[key] += (t[key] - c[key]) * k;
    this.root.position.y = c.y + this.floor;
    this.root.rotation.x = c.rx;
    for (const l of this.legs) l.rotation.x = c.leg - c.rx;
    for (const s of this.shins) s.rotation.x = c.shin;
    for (const a of this.arms) a.rotation.x = c.arm - c.rx;
    for (const f of this.fores) f.rotation.x = c.fore;
  }

  /** Marche : debout, jambes et bras balancés. */
  walk(phase: number): void {
    this.setPose('rest', 1);
    animateWalk(this.body, phase, 0.6);
  }
}

interface Frame {
  dur: number;
  pose: PoseName;
  leader?: PoseName;
  text?: string;
}

type Step =
  | { kind: 'walk'; to: Pt; yaw: number }
  | { kind: 'snap'; at: Pt; yaw: number }
  | { kind: 'timeline'; frames: Frame[] }
  | { kind: 'hold'; pose: PoseName; dur: number; text?: string }
  | { kind: 'coin' }
  | { kind: 'candle' }
  | { kind: 'leave'; to: Pt };

export interface WorshipContext {
  scene: THREE.Scene;
  mats: Materials;
  player: THREE.Group;
  layout: SacredLayout;
  rand: () => number;
  route: (from: THREE.Vector3, to: THREE.Vector3) => Pt[];
  stepTo: (pos: THREE.Vector3, sx: number, sz: number) => boolean;
  label: (text: string, color: string, x: number, y: number, z: number) => THREE.Sprite;
}

const NORM = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Worship {
  private readonly you: Actor;
  private readonly crowd: { a: Actor; delay: number }[] = [];
  private leader: Actor | null = null;
  private steps: Step[] = [];
  private i = 0;
  private t = 0;
  private phase = 0;
  private path: Pt[] = [];
  private pathFor: Pt | null = null;
  private tag: THREE.Sprite | null = null;
  private coin: THREE.Mesh | null = null;
  private readonly tmp = new THREE.Vector3();
  private readonly home: { parent: THREE.Object3D | null };
  /** Fin de l'office : plus personne ne s'active. */
  active = true;

  constructor(private readonly c: WorshipContext) {
    this.home = { parent: c.player.parent };
    const { x, z } = c.player.position;
    const yaw = c.player.rotation.y;
    this.you = new Actor(c.player);
    this.you.place(x, z, yaw);
    c.scene.add(this.you.root);
  }

  start(act: WorshipAct): void {
    const { layout: L } = this.c;
    const church = L.faith === 'church';
    const seat = church ? L.seats[L.playerPlace]! : null;
    const spot = church ? null : L.spots[L.playerPlace]!;
    const aisle: Pt = seat ? seat.entry : { x: spot!.x, z: spot!.z + 1.4 };
    const yaw = seat ? seat.yaw : Math.PI;
    const place: Pt = seat ?? spot!;
    const go = (to: Pt, y = yaw): Step => ({ kind: 'walk', to, yaw: y });
    const leave: Step = { kind: 'leave', to: aisle };

    if (act === 'offering') {
      const { box, candles } = L;
      this.steps = [go(box.stand, box.yaw), { kind: 'hold', pose: 'offer', dur: 0.7 }, { kind: 'coin' }, { kind: 'hold', pose: 'hands', dur: 0.5 }];
      if (candles) this.steps.push(go(candles.stand, candles.yaw), { kind: 'hold', pose: 'bend', dur: 1.2 }, { kind: 'candle' }, { kind: 'hold', pose: 'hands', dur: 1.8, text: '🕯️' });
      else this.steps.push({ kind: 'hold', pose: 'palms', dur: 2.6, text: '🤲' });
      return;
    }
    if (act === 'pray') {
      if (church) this.steps = [go(aisle), { kind: 'snap', at: place, yaw }, { kind: 'hold', pose: 'chairPray', dur: 9, text: '🙏' }, leave];
      else this.steps = [go(aisle), { kind: 'snap', at: place, yaw }, { kind: 'timeline', frames: PRAYER_CYCLE }, leave];
      return;
    }
    // Office avec les fidèles : tous suivent la même partition
    this.fillRoom();
    const frames: Frame[] = church
      ? [
          { dur: 4, pose: 'chair', leader: 'raise', text: '🎶' },
          { dur: 3, pose: 'hands', leader: 'hands', text: '🎶' },
          { dur: 3, pose: 'chair', leader: 'raise' },
          { dur: 2.6, pose: 'hands', leader: 'raise', text: '🙏' },
        ]
      : [{ dur: 7, pose: 'floor', leader: 'raise', text: '🕌' }, ...PRAYER_CYCLE.map((f) => ({ ...f, leader: f.pose }))];
    this.steps = [go(aisle), { kind: 'snap', at: place, yaw }, { kind: 'timeline', frames }, leave];
  }

  /** Les fidèles s'installent (chacun avec un léger décalage pour ne pas bouger comme un seul homme) et le célébrant se place. */
  private fillRoom(): void {
    const { layout: L, rand, mats, scene } = this.c;
    const church = L.faith === 'church';
    const places: (Pt & { yaw: number })[] = church ? L.seats : L.spots.map((s) => ({ ...s, yaw: Math.PI }));
    const fill = church ? 0.72 : 0.8;
    places.forEach((p, idx) => {
      if (idx === L.playerPlace || rand() > fill) return;
      const look: PersonLook = randomLook(rand);
      if (!church) {
        look.female = false;
        look.outfit = rand() < 0.6 ? 'boubou' : 'casual';
      }
      const a = new Actor(buildPerson(mats, look));
      a.place(p.x, p.z, p.yaw);
      a.setPose(church ? 'chair' : 'stand', 1);
      scene.add(a.root);
      this.crowd.push({ a, delay: rand() * 0.35 });
    });
    const look: PersonLook = { ...randomLook(rand), female: false, outfit: 'boubou', fabric: 'plain', color: 0, hairStyle: church ? 'lowcut' : 'cap' };
    const lead = new Actor(buildPerson(mats, look));
    lead.floor = L.leader.y;
    lead.place(L.leader.x, L.leader.z, L.leader.yaw);
    lead.setPose('rest', 1);
    scene.add(lead.root);
    this.leader = lead;
  }

  private sprite(text: string): void {
    this.tag?.removeFromParent();
    this.tag = this.c.label(text, '#6d28d9', this.you.root.position.x, 2.9, this.you.root.position.z);
  }

  private next(): void {
    this.i++;
    this.t = 0;
    this.path = [];
    this.pathFor = null;
  }

  /** Avance d'une image. Renvoie false quand tout est terminé. */
  update(_now: number, dt: number): boolean {
    if (!this.active) return false;
    this.t += dt;
    const step = this.steps[this.i];
    if (!step) {
      this.finish();
      return false;
    }
    const you = this.you;
    const k = 1 - Math.exp(-dt * 7);
    switch (step.kind) {
      case 'walk':
      case 'leave': {
        const to = step.to;
        if (this.walkTo(to, dt)) {
          if (step.kind === 'walk') you.root.rotation.y = step.yaw;
          you.setPose('rest', 1);
          this.next();
        }
        break;
      }
      case 'snap': {
        you.place(step.at.x, step.at.z, step.yaw);
        this.next();
        break;
      }
      case 'hold':
        you.setPose(step.pose, k);
        if (step.text && !this.tag) this.sprite(step.text);
        if (this.t > step.dur) this.next();
        break;
      case 'timeline': {
        const total = step.frames.reduce((s, f) => s + f.dur, 0);
        const at = (t: number) => {
          let acc = 0;
          for (const f of step.frames) {
            acc += f.dur;
            if (t < acc) return f;
          }
          return step.frames[step.frames.length - 1]!;
        };
        const f = at(this.t);
        you.setPose(f.pose, k);
        for (const m of this.crowd) m.a.setPose(at(Math.max(0, this.t - m.delay)).pose, k);
        this.leader?.setPose(f.leader ?? 'rest', k);
        if (f.text) {
          if (!this.tag) this.sprite(f.text);
        } else if (this.tag) {
          this.tag.removeFromParent();
          this.tag = null;
        }
        if (this.t > total) this.next();
        break;
      }
      case 'coin':
        this.stepCoin(dt);
        break;
      case 'candle':
        this.lightCandle();
        this.next();
        break;
    }
    if (this.tag) this.tag.position.set(you.root.position.x, 2.9 + this.you.root.position.y - HIP, you.root.position.z);
    return true;
  }

  /** Marche vers un point en contournant les meubles ; vrai à l'arrivée. */
  private walkTo(to: Pt, dt: number): boolean {
    const root = this.you.root;
    const dx = to.x - root.position.x;
    const dz = to.z - root.position.z;
    if (Math.hypot(dx, dz) < 0.12) return true;
    if (!this.pathFor || this.pathFor.x !== to.x || this.pathFor.z !== to.z) {
      this.pathFor = to;
      this.tmp.set(root.position.x, 0, root.position.z);
      this.path = this.c.route(this.tmp, new THREE.Vector3(to.x, 0, to.z));
    }
    while (this.path.length > 0 && Math.hypot(this.path[0]!.x - root.position.x, this.path[0]!.z - root.position.z) < 0.2) this.path.shift();
    const way = this.path[0] ?? to;
    const gx = way.x - root.position.x;
    const gz = way.z - root.position.z;
    const gd = Math.hypot(gx, gz);
    if (gd < 0.001) return true;
    const s = Math.min(gd, 3.2 * dt);
    this.tmp.set(root.position.x, 0, root.position.z);
    if (!this.c.stepTo(this.tmp, (gx / gd) * s, (gz / gd) * s) && this.path.length === 0) return true;
    root.position.x = this.tmp.x;
    root.position.z = this.tmp.z;
    const want = Math.atan2(gx, gz);
    root.rotation.y += NORM(want - root.rotation.y) * Math.min(1, dt * 10);
    this.phase += dt * 10;
    this.you.walk(this.phase);
    return false;
  }

  /** La pièce glisse de la main du fidèle dans la fente du tronc. */
  private stepCoin(dt: number): void {
    const { box } = this.c.layout;
    const root = this.you.root;
    if (!this.coin) {
      this.coin = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.025, 14), this.c.mats.color(0xffc400));
      this.c.scene.add(this.coin);
    }
    const k = Math.min(1, this.t / 0.7);
    const from = { x: root.position.x + Math.sin(root.rotation.y) * 0.5, y: 1.25, z: root.position.z + Math.cos(root.rotation.y) * 0.5 };
    this.coin.position.set(from.x + (box.x - from.x) * k, from.y + (box.top - from.y) * k + Math.sin(Math.PI * k) * 0.45, from.z + (box.z - from.z) * k);
    this.coin.rotation.x = k * 9;
    this.you.setPose('offer', 1 - Math.exp(-dt * 7));
    if (k >= 1) {
      this.coin.removeFromParent();
      this.coin = null;
      this.next();
    }
  }

  private lightCandle(): void {
    const cd = this.c.layout.candles;
    if (!cd) return;
    const s = cd.sticks[Math.min(cd.lit, cd.sticks.length - 1)]!;
    cd.lit++;
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 8), new THREE.MeshBasicMaterial({ color: 0xffb21a }));
    flame.position.set(s.x, s.y + 0.12, s.z);
    this.c.scene.add(flame);
  }

  /** Remet le joueur dans la scène normale, debout dans l'allée. */
  private finish(): void {
    this.active = false;
    const p = this.c.player;
    const x = this.you.root.position.x;
    const z = this.you.root.position.z;
    const yaw = this.you.root.rotation.y;
    this.you.setPose('rest', 1);
    animateWalk(p, 0, 0);
    this.you.root.remove(p);
    this.you.root.removeFromParent();
    (this.home.parent ?? this.c.scene).add(p);
    p.position.set(x, 0, z);
    p.rotation.set(0, yaw, 0);
    this.dispose();
  }

  /** Retire les figurants et les accessoires (le joueur n'est pas touché). */
  dispose(): void {
    for (const m of this.crowd) m.a.root.removeFromParent();
    this.crowd.length = 0;
    this.leader?.root.removeFromParent();
    this.leader = null;
    this.tag?.removeFromParent();
    this.tag = null;
    this.coin?.removeFromParent();
    this.coin = null;
  }
}

/** Deux unités de prière : debout, inclinaison, prosternation, assis sur les talons, seconde prosternation. */
const PRAYER_CYCLE: Frame[] = [
  { dur: 2.4, pose: 'stand', text: '🤲' },
  { dur: 1.6, pose: 'bow' },
  { dur: 1.0, pose: 'stand' },
  { dur: 2.0, pose: 'prostrate' },
  { dur: 1.4, pose: 'heels' },
  { dur: 2.0, pose: 'prostrate' },
  { dur: 1.2, pose: 'heels' },
  { dur: 1.6, pose: 'stand' },
];
