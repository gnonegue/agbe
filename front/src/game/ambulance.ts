import * as THREE from 'three';
import { buildPerson, randomLook, rng, type Materials } from './kit';
import { buildCar } from './vehicles';

/**
 * Ambulance du SAMU : fourgon blanc à bande rouge, croix rouges, inscription SAMU, rampe de gyrophares (rouge et bleu, avec un
 * halo qui se voit de loin) et deux portes arrière qui s'ouvrent. L'avant est vers +z ; le sol est à y = 0.
 */
export interface AmbulanceRig {
  group: THREE.Group;
  /** Charnières des portes arrière (gauche, droite) : rotation.y = 0 fermée. */
  doors: [THREE.Group, THREE.Group];
  /** Matériaux des feux (rouge, bleu) et halos correspondants. */
  beacons: [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial];
  halos: [THREE.Sprite, THREE.Sprite];
  /** Arrière du véhicule (z local) et plancher de la cellule de soins (y). */
  rearZ: number;
  floorY: number;
  width: number;
  own: { geos: THREE.BufferGeometry[]; mats: THREE.Material[]; texs: THREE.Texture[] };
}

const RED = 0xd21034;

function haloTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

function labelTexture(text: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 64;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#d21034';
  g.font = 'bold 46px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildAmbulance(mats: Materials): AmbulanceRig {
  const own: AmbulanceRig['own'] = { geos: [], mats: [], texs: [] };
  const geo = <G extends THREE.BufferGeometry>(g: G) => (own.geos.push(g), g);
  const mat = <M extends THREE.Material>(m: M) => (own.mats.push(m), m);
  const group = new THREE.Group();
  const van = buildCar(mats, { kind: 'van', color: 0xf7f7f7, stripe: RED });
  group.add(van);
  const box = new THREE.Box3().setFromObject(van);
  const w = box.max.x - box.min.x;
  const top = box.max.y;
  const rearZ = box.min.z;
  const frontZ = box.max.z;
  const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const red = mats.color(RED, 0.4);
  // Croix rouges sur les flancs (et sur les portes arrière, plus bas)
  for (const sx of [-1, 1]) {
    add(geo(new THREE.BoxGeometry(0.02, 0.5, 0.15)), red, sx * (w / 2 + 0.005), top * 0.68, -0.6);
    add(geo(new THREE.BoxGeometry(0.02, 0.15, 0.5)), red, sx * (w / 2 + 0.005), top * 0.68, -0.6);
    // Inscription SAMU
    const tex = labelTexture('SAMU');
    own.texs.push(tex);
    const plate = add(geo(new THREE.PlaneGeometry(1.1, 0.28)), mat(new THREE.MeshBasicMaterial({ map: tex })), sx * (w / 2 + 0.012), top * 0.68, 0.7);
    plate.rotation.y = sx * Math.PI / 2;
  }
  // Grande croix rouge sur le toit : on reconnaît l'ambulance en vue d'en haut
  add(geo(new THREE.BoxGeometry(0.34, 0.02, 1.2)), red, 0, top + 0.01, -0.6);
  add(geo(new THREE.BoxGeometry(1.2, 0.02, 0.34)), red, 0, top + 0.01, -0.6);
  // Rampe de gyrophares à l'avant du toit
  add(geo(new THREE.BoxGeometry(w * 0.7, 0.1, 0.32)), mats.color(0x2a2f35, 0.5), 0, top + 0.05, frontZ - 1.3);
  const beacons: AmbulanceRig['beacons'] = [mat(new THREE.MeshBasicMaterial({ color: 0xff1a1a })), mat(new THREE.MeshBasicMaterial({ color: 0x1f5bff }))];
  const haloTex = haloTexture();
  own.texs.push(haloTex);
  const halos = beacons.map((b, i) => {
    const x = (i === 0 ? -1 : 1) * w * 0.22;
    add(geo(new THREE.BoxGeometry(0.34, 0.16, 0.28)), b, x, top + 0.17, frontZ - 1.3);
    const s = new THREE.Sprite(mat(new THREE.SpriteMaterial({ map: haloTex, color: i === 0 ? 0xff2020 : 0x2a6bff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    s.position.set(x, top + 0.2, frontZ - 1.3);
    s.scale.setScalar(1.6);
    group.add(s);
    return s;
  }) as [THREE.Sprite, THREE.Sprite];
  // Ouverture arrière (cellule sombre), masquée par les deux portes
  const floorY = 0.62;
  const hole = add(geo(new THREE.PlaneGeometry(w * 0.82, top - floorY - 0.35)), mat(new THREE.MeshBasicMaterial({ color: 0x2b333b })), 0, floorY + (top - floorY - 0.35) / 2, rearZ - 0.005);
  hole.rotation.y = Math.PI;
  const doorH = top - floorY - 0.25;
  const white = mats.color(0xf7f7f7, 0.28);
  const glass = mats.color(0x1c2733, 0.08);
  const doors = [-1, 1].map((sx) => {
    // Charnière au coin arrière ; la porte s'étend vers le milieu
    const hinge = new THREE.Group();
    hinge.position.set(sx * (w / 2 - 0.02), floorY + doorH / 2 - 0.05, rearZ - 0.04);
    group.add(hinge);
    add(geo(new THREE.BoxGeometry(w / 2 - 0.03, doorH, 0.05)), white, -sx * (w / 4), 0, 0, hinge);
    add(geo(new THREE.BoxGeometry(w / 2 - 0.25, doorH * 0.32, 0.02)), glass, -sx * (w / 4), doorH * 0.22, -0.03, hinge);
    add(geo(new THREE.BoxGeometry(0.02 + (sx < 0 ? 0.3 : 0), 0.1, 0.02)), red, -sx * (w / 4), -doorH * 0.12, -0.035, hinge);
    add(geo(new THREE.BoxGeometry(0.1, 0.3, 0.02)), red, -sx * (w / 2 - 0.08), -doorH * 0.12, -0.035, hinge);
    return hinge;
  }) as [THREE.Group, THREE.Group];
  return { group, doors, beacons, halos, rearZ, floorY, width: w, own };
}

/** Ouvre (k = 1) ou ferme (k = 0) les portes arrière : elles pivotent vers l'extérieur. */
export function setDoors(rig: AmbulanceRig, k: number): void {
  rig.doors[0].rotation.y = 1.9 * k;
  rig.doors[1].rotation.y = -1.9 * k;
}

/** Gyrophares : rouge et bleu en alternance rapide (double éclat), halos qui pulsent. */
export function flashBeacons(rig: AmbulanceRig, now: number): void {
  const phase = (now / 1000) % 0.8;
  const flash = (from: number) => (phase >= from && phase < from + 0.09) || (phase >= from + 0.15 && phase < from + 0.24);
  const red = flash(0);
  const blue = flash(0.4);
  rig.beacons[0].color.setHex(red ? 0xff3030 : 0x5a1010);
  rig.beacons[1].color.setHex(blue ? 0x4080ff : 0x10204f);
  rig.halos[0].visible = red;
  rig.halos[1].visible = blue;
}

/** Brancard à roulettes (le haut du matelas à y ≈ 0,86), dans l'axe z. */
export function buildStretcher(mats: Materials, rig: AmbulanceRig): THREE.Group {
  const geo = <G extends THREE.BufferGeometry>(g: G) => (rig.own.geos.push(g), g);
  const g = new THREE.Group();
  const metal = mats.color(0xc9d0d6, 0.3);
  const add = (gg: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(gg, m);
    o.position.set(x, y, z);
    g.add(o);
    return o;
  };
  add(geo(new THREE.BoxGeometry(0.62, 0.06, 1.95)), metal, 0, 0.72, 0);
  add(geo(new THREE.BoxGeometry(0.56, 0.1, 1.85)), mats.color(0xf08a24, 0.6), 0, 0.8, 0);
  add(geo(new THREE.BoxGeometry(0.42, 0.08, 0.32)), mats.color(0xffffff, 0.7), 0, 0.88, -0.72);
  for (const x of [-0.26, 0.26]) {
    for (const z of [-0.8, 0.8]) {
      add(geo(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 6)), metal, x, 0.39, z);
      add(geo(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10)), mats.color(0x1b1b1b, 0.8), x, 0.06, z).rotation.z = Math.PI / 2;
    }
  }
  return g;
}

/** Secouriste : gilet orange à bandes réfléchissantes par-dessus sa tenue. */
export function buildParamedic(mats: Materials, rig: AmbulanceRig, seed: number): THREE.Group {
  const geo = <G extends THREE.BufferGeometry>(g: G) => (rig.own.geos.push(g), g);
  const female = seed % 2 === 0;
  const g = buildPerson(mats, { ...randomLook(rng(seed)), female, hairStyle: female ? 'bun' : 'lowcut', outfit: 'work', fabric: 'plain', color: 1, wear: undefined });
  // Gilet ajusté sur le buste (le torse est un volume de révolution d'environ 0,2 m de rayon, aplati devant-derrière)
  const vest = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.228, 0.205, 0.46, 16)), mats.color(0xff7a1a, 0.6));
  vest.position.set(0, 1.2, 0);
  vest.scale.z = 0.82;
  g.add(vest);
  for (const y of [1.09, 1.29]) {
    const band = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.232, 0.226, 0.04, 16)), mats.color(0xe6ecef, 0.15));
    band.position.set(0, y, 0);
    band.scale.z = 0.83;
    g.add(band);
  }
  return g;
}
