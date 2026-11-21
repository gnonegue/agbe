// Personnage « réaliste » (proposition) : proportions d'un adulte (environ 7,5 têtes, 1,78 m), silhouette modelée par des
// profils de révolution (buste, taille, hanches), visage détaillé (yeux avec iris, sourcils, nez, lèvres, oreilles), mains à
// trois phalanges par doigt, baskets modelées (empeigne, semelle, lacets, bande de couleur), cheveux texturés (coupes courtes
// à brins, afro en boucles, nattes collées et tresses retombantes, locks) et tenues détaillées (tee-shirt, jean à poches et
// ceinture à boucle, chemise et cravate sous blazer, boubou brodé, combinaison de chantier à bandes). Mêmes noms
// d'articulations que `buildPerson` (legL, legR, shin, armL, armR, forearm) : `animateWalk` et `sitPose` s'appliquent.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GarmentDef, Materials, PersonLook } from './kit';

const cap = (r: number, len: number, seg = 10) => new THREE.CapsuleGeometry(r, len, 4, seg);
const ball = (r: number, ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs);
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Profil de révolution (rayon, hauteur) du buste, de la taille et des hanches. */
const torsoProfile = (female: boolean): THREE.Vector2[] =>
  (female
    ? [[0.001, 0.86], [0.13, 0.88], [0.172, 0.97], [0.158, 1.06], [0.138, 1.2], [0.152, 1.3], [0.168, 1.38], [0.162, 1.44], [0.135, 1.49], [0.06, 1.52], [0.001, 1.53]]
    : [[0.001, 0.86], [0.14, 0.88], [0.168, 0.97], [0.155, 1.08], [0.158, 1.22], [0.178, 1.34], [0.192, 1.42], [0.172, 1.49], [0.07, 1.52], [0.001, 1.53]]
  ).map(([r, y]) => new THREE.Vector2(r!, y!));

/** Texture de cheveux : fond de la couleur, brins fins plus clairs et plus sombres (lisses) ou petites boucles (crépus). */
function hairTexture(hex: number, coily: boolean): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  const base = new THREE.Color(hex);
  g.fillStyle = `#${base.getHexString()}`;
  g.fillRect(0, 0, 256, 256);
  const r = rng(hex % 9973);
  for (let i = 0; i < (coily ? 1400 : 700); i++) {
    const light = r() < 0.5;
    const c = base.clone().multiplyScalar(light ? 1.5 + r() * 0.7 : 0.45 + r() * 0.3);
    g.strokeStyle = `rgba(${Math.min(255, Math.round(c.r * 255))},${Math.min(255, Math.round(c.g * 255))},${Math.min(255, Math.round(c.b * 255))},${0.25 + r() * 0.4})`;
    g.lineWidth = coily ? 1.2 : 0.8 + r();
    const x = r() * 256;
    const y = r() * 256;
    g.beginPath();
    if (coily) g.arc(x, y, 1.5 + r() * 3, 0, Math.PI * (1 + r()));
    else {
      g.moveTo(x, y);
      g.quadraticCurveTo(x + (r() - 0.5) * 8, y + 14, x + (r() - 0.5) * 4, y + 30 + r() * 20);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Empeigne de basket modelée (profil latéral extrudé, bords arrondis) : contrefort de talon relevé, col qui entoure la
 * cheville, languette en saillie devant la jambe, voûte qui descend vers un bout arrondi. L'origine est le centre de la
 * cheville : le talon est à −0,09 m, le bout à +0,21 m.
 */
function sneakerUpper(): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(-0.088, -0.036);
  sh.lineTo(-0.092, 0.0);
  sh.bezierCurveTo(-0.094, 0.026, -0.09, 0.046, -0.078, 0.062); // contrefort de talon
  sh.quadraticCurveTo(-0.06, 0.072, -0.04, 0.064); // bord arrière du col
  sh.quadraticCurveTo(-0.022, 0.054, -0.006, 0.06); // creux à la cheville
  sh.lineTo(0.012, 0.084); // languette
  sh.quadraticCurveTo(0.03, 0.088, 0.042, 0.078);
  sh.lineTo(0.06, 0.044);
  sh.bezierCurveTo(0.09, 0.034, 0.13, 0.03, 0.16, 0.016); // voûte
  sh.bezierCurveTo(0.195, 0.004, 0.214, -0.014, 0.212, -0.032); // bout arrondi
  sh.lineTo(0.205, -0.04);
  sh.lineTo(-0.082, -0.04);
  sh.closePath();
  const depth = 0.05;
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.014, bevelSegments: 4, curveSegments: 12 });
  return g.translate(0, 0, -depth / 2).rotateY(-Math.PI / 2);
}
/** Semelle : talon épais, pointe légèrement relevée, bords arrondis. */
function sneakerSole(): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(-0.097, -0.062);
  sh.lineTo(0.185, -0.062);
  sh.quadraticCurveTo(0.226, -0.06, 0.231, -0.04);
  sh.quadraticCurveTo(0.226, -0.026, 0.2, -0.026);
  sh.lineTo(0.1, -0.03);
  sh.lineTo(-0.075, -0.022);
  sh.quadraticCurveTo(-0.102, -0.03, -0.097, -0.062);
  const depth = 0.062;
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 3, curveSegments: 10 });
  return g.translate(0, 0, -depth / 2).rotateY(-Math.PI / 2);
}

function buildRaw(mats: Materials, look: PersonLook): THREE.Group {
  const g = new THREE.Group();
  const F = look.female;
  const skin = mats.color(look.skin, 0.5);
  const skinDark = mats.color(new THREE.Color(look.skin).multiplyScalar(0.62).getHex(), 0.45);
  const skinLight = mats.color(new THREE.Color(look.skin).lerp(new THREE.Color(0xf0c8ac), 0.35).getHex(), 0.5);
  const coily = look.hairStyle === 'afro' || look.hairStyle === 'braids' || look.hairStyle === 'locs';
  const hairMat = (mats.hair(look.hair) as THREE.MeshStandardMaterial).clone();
  hairMat.map = hairTexture(look.hair, coily);
  hairMat.color.set(0xffffff);
  const metal = mats.color(0xc9ccd2, 0.3);
  const gold = mats.color(0xe0b13a, 0.35);

  // Tenue : vêtements achetés en boutique (robe, ou haut et bas) sinon tenue d'origine du personnage
  const w = look.wear;
  const gm = (d: GarmentDef): THREE.Material => (d.fabric === 'plain' ? mats.color(d.color) : mats.fabric(d.fabric, d.pattern));
  const dressDef = w?.dress;
  const wearOn = !!(dressDef || (w?.top && w?.bottom));
  const outfit = wearOn ? 'wear' : look.outfit;
  const topStyle = wearOn && !dressDef ? w!.top!.style : '';
  const botStyle = wearOn && !dressDef ? w!.bottom!.style : '';
  const office = outfit === 'office' || topStyle === 'jacket';
  const work = outfit === 'work';
  const boubou = outfit === 'boubou';
  const top = wearOn ? gm((dressDef ?? w!.top)!) : work ? mats.color(0xf18f01) : outfit === 'office' ? mats.color(0xf4f6f9) : mats.fabric(look.fabric, look.color);
  const shirt = outfit === 'office' ? top : mats.color(0xf4f6f9);
  const jacket = topStyle === 'jacket' ? top : mats.color(0x1c2740, 0.85);
  const bottom = wearOn && !dressDef ? gm(w!.bottom!) : work ? mats.color(0xf18f01) : mats.color(outfit === 'office' ? 0x141a2a : look.pants);
  // Hauteur de l'ourlet des vêtements longs (robe, boubou, tunique) ou des jupes ; sinon pantalon
  const longHem: number | null = dressDef ? (dressDef.style === 'gown' ? 0.07 : 0.5) : boubou ? (F ? 0.07 : 0.5) : topStyle === 'tunic' ? 0.5 : null;
  const skirtHem: number | null = longHem === null ? (botStyle === 'skirt' ? 0.5 : botStyle === 'pagne' ? 0.12 : null) : null;
  const shorts = botStyle === 'shorts';
  const bareLegs = shorts || skirtHem !== null || (!!dressDef && longHem === 0.5);
  const denim = outfit === 'casual';
  const longSleeves = outfit === 'office' || work || boubou || topStyle === 'shirt' || topStyle === 'tunic' || topStyle === 'jacket';
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const TZ = F ? 0.66 : 0.62; // aplatissement avant-arrière du buste
  const FZ = F ? 0.112 : 0.128; // profondeur de la poitrine (devant du buste)

  // --- Buste : une seule enveloppe modelée, puis ceinture, col, vêtements
  const torso = mesh(new THREE.LatheGeometry(torsoProfile(F), 28), top, 0, 0, 0);
  torso.scale.set(1, 1, TZ);
  if (longHem !== null) {
    // Boubou, robe ou tunique : évasée jusqu'au genou ou aux chevilles ; le boubou est bordé et brodé d'or
    const hem = longHem;
    const flare = hem < 0.2 ? 0.28 : 0.2;
    const prof = [[0.001, hem], [flare, hem], [flare * 0.82, hem + (1.0 - hem) * 0.45], [F ? 0.155 : 0.18, 1.04]].map(([r, y]) => new THREE.Vector2(r!, y!));
    mesh(new THREE.LatheGeometry(prof, 28), top, 0, 0, 0).scale.set(1, 1, 0.78);
    if (boubou) {
      const trim = mesh(new THREE.TorusGeometry(flare, 0.01, 6, 36), gold, 0, hem + 0.012, 0);
      trim.rotation.x = Math.PI / 2;
      trim.scale.set(1, 0.78, 1);
      const nk = mesh(new THREE.TorusGeometry(0.062, 0.009, 6, 20), gold, 0, 1.515, 0.006);
      nk.rotation.x = Math.PI / 2 - 0.25;
    }
    const vShape = new THREE.Shape();
    vShape.moveTo(-0.06, 0);
    vShape.lineTo(0.06, 0);
    vShape.lineTo(0, -0.2);
    vShape.closePath();
    if (boubou) mesh(new THREE.ShapeGeometry(vShape), gold, 0, 1.5, FZ - 0.006).rotation.x = -0.08;
  } else if (skirtHem !== null) {
    // Jupe ou pagne noué à la taille
    const sh = skirtHem;
    const prof = [[0.001, sh], [F ? 0.24 : 0.22, sh], [0.19, sh + (1.04 - sh) * 0.5], [F ? 0.15 : 0.165, 1.04]].map(([r, y]) => new THREE.Vector2(r!, y!));
    mesh(new THREE.LatheGeometry(prof, 28), bottom, 0, 0, 0).scale.set(1, 1, 0.74);
  } else {
    // Entrejambe : bloc de tissu qui relie les deux cuisses sous les hanches (sinon un creux sombre apparaît)
    mesh(ball(0.12, 16, 12), bottom, 0, 0.9, 0).scale.set(1.28, 0.85, F ? 0.78 : 0.72);
    // Bas du buste en tissu du pantalon (hanches), ceinture avec boucle
    // Les hanches s'élargissent vers le bas pour rejoindre le haut des cuisses sans marche
    const hips = mesh(new THREE.LatheGeometry(torsoProfile(F).filter((p) => p.y <= 1.04).map((p) => new THREE.Vector2(p.y < 0.99 ? p.x * 1.2 + 0.012 : p.x + 0.006, p.y)), 28), bottom, 0, 0, 0);
    hips.scale.set(1, 1, TZ);
    const belt = mesh(new THREE.TorusGeometry(F ? 0.147 : 0.161, 0.0085, 6, 28), mats.color(0x2a1d14, 0.5), 0, 1.045, 0);
    belt.rotation.x = Math.PI / 2;
    belt.scale.set(1, TZ, 1);
    mesh(new THREE.BoxGeometry(0.036, 0.026, 0.008), metal, 0, 1.045, (F ? 0.147 : 0.161) * TZ + 0.003);
    if (denim) {
      // Poches arrière du jean
      for (const sx of [-1, 1]) {
        const p = mesh(new THREE.BoxGeometry(0.056, 0.058, 0.005), mats.color(new THREE.Color(look.pants).multiplyScalar(1.25).getHex(), 0.85), sx * 0.075, 0.97, -0.112 * (TZ / 0.62));
        p.rotation.x = 0.1;
      }
    }
  }
  if (office) {
    // Blazer : enveloppe sombre, chemise blanche et cravate dans le V, boutons et pochette
    const jk = mesh(new THREE.LatheGeometry(torsoProfile(F).filter((p) => p.y >= 0.98 && p.y <= 1.52).map((p) => new THREE.Vector2(p.x + 0.014, p.y)), 28), jacket, 0, 0, 0);
    jk.scale.set(1, 1, TZ + 0.02);
    const vS = new THREE.Shape();
    vS.moveTo(-0.075, 0);
    vS.lineTo(0.075, 0);
    vS.lineTo(0.012, -0.34);
    vS.lineTo(-0.012, -0.34);
    vS.closePath();
    mesh(new THREE.ShapeGeometry(vS), shirt, 0, 1.5, FZ + 0.012).rotation.x = -0.1;
    const tie = mesh(new THREE.BoxGeometry(0.036, 0.27, 0.01), mats.color(0xb11d2a, 0.6), 0, 1.31, FZ + 0.03);
    tie.rotation.x = -0.1;
    mesh(ball(0.02, 8, 6), mats.color(0xb11d2a, 0.6), 0, 1.47, FZ + 0.028);
    for (const y of [1.14, 1.22]) mesh(ball(0.0085, 8, 6), mats.color(0x0b0f1a, 0.4), 0, y, FZ + 0.004);
    mesh(new THREE.BoxGeometry(0.045, 0.012, 0.006), shirt, -0.085, 1.36, FZ + 0.004);
  }
  if (work) {
    for (const y of [1.2, 1.36]) {
      const band = mesh(new THREE.TorusGeometry(F ? 0.158 : 0.176, 0.011, 6, 28), mats.color(0xe9edf3, 0.3), 0, y, 0);
      band.rotation.x = Math.PI / 2;
      band.scale.set(1, TZ, 1);
    }
  }
  if (longHem === null) {
    if (office) {
      // Col de chemise à deux pointes
      for (const sx of [-1, 1]) mesh(new THREE.BoxGeometry(0.052, 0.05, 0.008), shirt, sx * 0.03, 1.535, 0.05).rotation.set(-0.3, 0, sx * 0.5);
    } else {
      // Encolure ronde du tee-shirt
      const collar = mesh(new THREE.TorusGeometry(0.056, 0.0125, 8, 20), top, 0, 1.52, 0.004);
      collar.rotation.x = Math.PI / 2 - 0.25;
      collar.scale.set(1.05, 1, 1.15);
    }
  }

  // --- Cou, tête et visage
  mesh(new THREE.CylinderGeometry(0.046, 0.054, 0.12, 14), skin, 0, 1.57, 0);
  const head = new THREE.Group();
  head.position.set(0, 1.71, 0.005);
  g.add(head);
  mesh(ball(0.105, 22, 16), skin, 0, 0, 0, head).scale.set(0.88, 1.08, 0.98);
  const jaw = mesh(ball(0.082, 18, 12), skin, 0, -0.045, 0.014, head);
  jaw.scale.set(0.92, 0.72, 0.96);
  const sclera = mats.color(0xf4f1ea, 0.25);
  const iris = mats.color(0x3d2616, 0.3);
  const pupil = mats.color(0x0a0605, 0.3);
  for (const sx of [-1, 1]) {
    mesh(ball(0.0165, 12, 8), sclera, sx * 0.037, 0.014, 0.0875, head).scale.set(1.25, 0.85, 0.55);
    mesh(new THREE.CircleGeometry(0.0091, 16), iris, sx * 0.037, 0.014, 0.0975, head);
    mesh(new THREE.CircleGeometry(0.0043, 10), pupil, sx * 0.037, 0.014, 0.0979, head);
    const lid = mesh(cap(0.0042, 0.03, 6), skinDark, sx * 0.037, 0.0265, 0.0925, head);
    lid.rotation.z = Math.PI / 2 + sx * 0.08;
    const brow = mesh(cap(0.0062, 0.04, 6), hairMat, sx * 0.038, 0.045, 0.0915, head);
    brow.rotation.z = Math.PI / 2 - sx * 0.12;
    brow.rotation.x = -0.15;
    mesh(ball(0.019, 10, 8), skin, sx * 0.093, -0.004, -0.004, head).scale.set(0.42, 1.05, 0.75);
  }
  const bridge = mesh(cap(0.008, 0.04, 8), skin, 0, -0.002, 0.096, head);
  bridge.rotation.x = -0.35;
  mesh(ball(0.0185, 10, 8), skin, 0, -0.027, 0.109, head).scale.set(1.1, 0.8, 0.85);
  for (const sx of [-1, 1]) mesh(ball(0.0085, 8, 6), skin, sx * 0.0135, -0.03, 0.1, head).scale.set(0.9, 0.8, 0.8);
  mesh(cap(0.0072, 0.036, 6), skinDark, 0, -0.056, 0.093, head).rotation.z = Math.PI / 2;
  mesh(cap(0.0085, 0.032, 6), skinDark, 0, -0.066, 0.091, head).rotation.z = Math.PI / 2;

  // --- Cheveux
  const shell = (r: number, y: number, z: number, theta: number, tilt: number, sx = 0.9, sy = 1.08) => {
    const m = mesh(new THREE.SphereGeometry(r, 28, 18, 0, Math.PI * 2, 0, theta), hairMat, 0, y, z, head);
    m.scale.set(sx, sy, 1.0);
    m.rotation.x = tilt;
    return m;
  };
  const rnd = rng(look.hair + (F ? 7 : 3));
  const instanced = (geo: THREE.BufferGeometry, pts: { p: THREE.Vector3; s: number }[]) => {
    const im = new THREE.InstancedMesh(geo, hairMat, pts.length);
    const m4 = new THREE.Matrix4();
    pts.forEach(({ p, s }, i) => {
      m4.compose(p, new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      im.setMatrixAt(i, m4);
    });
    im.castShadow = true;
    head.add(im);
  };
  switch (look.hairStyle) {
    case 'afro': {
      // Noyau sombre, puis couronne de boucles sur le haut, les côtés et l'arrière (visage dégagé)
      shell(0.122, 0.016, -0.01, Math.PI * 0.6, -0.4);
      const pts: { p: THREE.Vector3; s: number }[] = [];
      for (let i = 0; i < 280; i++) {
        const u = rnd() * 2 - 1;
        const a = rnd() * Math.PI * 2;
        const rr = Math.sqrt(1 - u * u);
        const d = new THREE.Vector3(rr * Math.cos(a), u, rr * Math.sin(a));
        if ((d.z > 0.35 && d.y < 0.62) || d.y < -0.1) continue;
        const R = 0.135 + rnd() * 0.02;
        pts.push({ p: new THREE.Vector3(d.x * R * 1.02, d.y * R + 0.03, d.z * R - 0.012), s: 0.7 + rnd() * 0.5 });
      }
      instanced(ball(0.03, 8, 6), pts);
      break;
    }
    case 'braids':
    case 'bun': {
      // Nattes collées : sillons tressés de l'avant vers l'arrière, puis tresses retombantes (ou chignon)
      shell(0.1185, 0.004, -0.004, Math.PI * 0.46, -0.5);
      const R = 0.118;
      for (let i = 0; i < 7; i++) {
        const xi = (i - 3) * 0.024;
        const r = R * Math.sqrt(1 - (xi / R) ** 2);
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 16; k++) {
          const al = 0.62 + (k / 16) * 1.95;
          pts.push(new THREE.Vector3(xi * 1.02, r * Math.sin(al) * 1.12 + 0.005, r * Math.cos(al) - 0.004));
        }
        mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.0072, 6, false), hairMat, 0, 0, 0, head);
      }
      if (look.hairStyle === 'bun') mesh(ball(0.055, 14, 10), hairMat, 0, 0.1, -0.06, head);
      else {
        const pts: { p: THREE.Vector3; s: number }[] = [];
        for (let b = 0; b < 20; b++) {
          const a = Math.PI * 0.1 + (b / 19) * Math.PI * 0.8;
          const bx = Math.cos(a) * 0.098;
          const bz = -Math.sin(a) * 0.092 - 0.01;
          const len = 0.26 + (b % 3) * 0.025;
          for (let k = 0; k < Math.round(len / 0.0175); k++) pts.push({ p: new THREE.Vector3(bx + (k % 2 ? 0.0035 : -0.0035), -0.03 - k * 0.0175, bz), s: 1 - k * 0.012 });
        }
        instanced(ball(0.0095, 7, 5), pts);
      }
      break;
    }
    case 'locs': {
      shell(0.1185, 0.004, -0.004, Math.PI * 0.46, -0.5);
      const pts: { p: THREE.Vector3; s: number }[] = [];
      for (let b = 0; b < 30; b++) {
        const a = Math.PI * 0.06 + (b / 29) * Math.PI * 0.88;
        const ring = b % 2 ? 0.1 : 0.088;
        const bx = Math.cos(a) * ring;
        const bz = -Math.sin(a) * (ring - 0.006) - 0.012;
        const len = 0.19 + rnd() * 0.08;
        for (let k = 0; k < Math.round(len / 0.014); k++) pts.push({ p: new THREE.Vector3(bx + Math.sin(k * 0.8 + b) * 0.0025, -0.025 - k * 0.014, bz + Math.cos(k * 0.8 + b) * 0.002), s: 1.05 - k * 0.006 });
      }
      instanced(ball(0.0125, 7, 5), pts);
      break;
    }
    case 'gele': {
      // Foulard de tête noué (gèlè), dans un tissu wax
      const wrap = mats.fabric('wax', look.color + 1);
      for (let k = 0; k < 3; k++) {
        const t = mesh(new THREE.TorusGeometry(0.106 - k * 0.004, 0.022, 8, 28), wrap, 0, 0.045 + k * 0.025, -0.005, head);
        t.rotation.x = Math.PI / 2 - 0.15;
        t.scale.set(0.92, 1.0, 1.1);
      }
      const fan = mesh(new THREE.ConeGeometry(0.1, 0.12, 6), wrap, 0.045, 0.16, -0.01, head);
      fan.rotation.set(0.1, 0, -0.6);
      fan.scale.set(1.4, 1, 0.45);
      break;
    }
    case 'cap': {
      // Casquette : calotte colorée et visière
      const capMat = mats.color([0xffffff, 0x1f6feb, 0xe5383b, 0xffce00, 0x22a861, 0xf18f01, 0x14213d, 0x8e44ad][(look.color + 3) % 8]!, 0.7);
      const dome = mesh(new THREE.SphereGeometry(0.119, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), capMat, 0, 0.012, -0.004, head);
      dome.scale.set(0.92, 1.06, 1.0);
      dome.rotation.x = -0.12;
      mesh(new THREE.BoxGeometry(0.15, 0.008, 0.075), capMat, 0, 0.032, 0.115, head).rotation.x = 0.12;
      break;
    }
    case 'lowcut': {
      shell(0.1145, 0.003, -0.003, Math.PI * 0.43, -0.55);
      for (const sx of [-1, 1]) mesh(cap(0.006, 0.034, 5), hairMat, sx * 0.087, 0.01, 0.028, head);
      break;
    }
    default: {
      shell(0.1195, 0.006, -0.004, Math.PI * 0.46, -0.5);
      mesh(ball(0.07, 14, 10), hairMat, 0, 0.09, 0.0, head).scale.set(1.15, 0.5, 1.1);
      for (const sx of [-1, 1]) mesh(cap(0.007, 0.04, 5), hairMat, sx * 0.088, 0.012, 0.03, head);
    }
  }

  // --- Bras : épaule, bras, coude, avant-bras, main détaillée
  const sx0 = F ? 0.178 : 0.205;
  for (const [name, side] of [['armL', -1], ['armR', 1]] as const) {
    const arm = new THREE.Group();
    arm.name = name;
    arm.position.set(side * sx0, 1.455, 0);
    arm.rotation.z = side * 0.06;
    g.add(arm);
    const sleeve = office ? jacket : top;
    mesh(ball(F ? 0.04 : 0.046, 14, 10), sleeve, 0, 0.0, 0, arm).scale.set(1, 0.9, 0.9);
    mesh(cap(F ? 0.04 : 0.046, 0.2, 10), skin, 0, -0.16, 0, arm); // bras
    mesh(cap(F ? 0.043 : 0.049, longSleeves ? 0.2 : 0.1, 10), sleeve, 0, longSleeves ? -0.16 : -0.1, 0, arm); // manche
    if (!longSleeves) mesh(new THREE.TorusGeometry(F ? 0.0455 : 0.0515, 0.004, 6, 18), sleeve, 0, -0.2, 0, arm).rotation.x = Math.PI / 2;
    const fore = new THREE.Group();
    fore.name = 'forearm';
    fore.position.set(0, -0.3, 0);
    fore.rotation.x = -0.18;
    arm.add(fore);
    mesh(ball(F ? 0.039 : 0.044, 10, 8), longSleeves ? sleeve : skin, 0, 0, 0, fore); // coude
    mesh(cap(F ? 0.032 : 0.037, 0.2, 10), skin, 0, -0.14, 0, fore); // avant-bras
    if (longSleeves) {
      mesh(cap(F ? 0.038 : 0.043, 0.19, 10), sleeve, 0, -0.12, 0, fore);
      mesh(new THREE.TorusGeometry(F ? 0.0375 : 0.042, 0.006, 6, 16), office ? shirt : sleeve, 0, -0.225, 0, fore).rotation.x = Math.PI / 2;
    }
    // Poignet et main : paume, articulations, doigts à trois phalanges légèrement fléchis, pouce à deux segments
    const hand = new THREE.Group();
    hand.position.set(0, -0.285, 0);
    // Bras le long du corps : paume tournée vers la cuisse (quart de tour autour de l'avant-bras), doigts repliés vers
    // l'intérieur (le corps), pouce vers l'avant
    hand.rotation.y = side * (Math.PI / 2);
    fore.add(hand);
    mesh(cap(0.026, 0.02, 8), skin, 0, -0.012, 0, hand);
    mesh(ball(0.042, 16, 12), skin, 0, -0.056, 0, hand).scale.set(1.08, 1.28, 0.52);
    mesh(ball(0.03, 12, 8), skin, 0, -0.025, 0, hand).scale.set(1, 1.1, 0.7); // poignet qui s'évase vers le dos de la main
    mesh(ball(0.0185, 8, 6), skinLight, 0, -0.06, 0.012, hand).scale.set(1.6, 1.5, 0.35);
    // Doigts : trois phalanges sans boules d'articulation (les bouts arrondis se prolongent), serrés les uns contre les autres
    // et légèrement fléchis, comme une main détendue ; pouce à deux segments appuyé contre la paume
    const lens = [0.94, 1.0, 0.97, 0.8];
    for (let f = 0; f < 4; f++) {
      const fx = (f - 1.5) * 0.0172;
      const k = lens[f]!;
      const base = new THREE.Group();
      base.position.set(fx, -0.098, 0.004);
      base.rotation.x = 0.14 + f * 0.035;
      hand.add(base);
      mesh(cap(0.0098, 0.036 * k, 8), skin, 0, -0.024 * k, 0, base);
      const mid = new THREE.Group();
      mid.position.set(0, -0.046 * k, 0);
      mid.rotation.x = 0.34;
      base.add(mid);
      mesh(cap(0.009, 0.022 * k, 8), skin, 0, -0.0165 * k, 0, mid);
      const tip = new THREE.Group();
      tip.position.set(0, -0.034 * k, 0);
      tip.rotation.x = 0.34;
      mid.add(tip);
      mesh(cap(0.0083, 0.016 * k, 8), skin, 0, -0.0135 * k, 0, tip);
      mesh(new THREE.BoxGeometry(0.0082, 0.009, 0.003), skinLight, 0, -0.019 * k, 0.0078, tip); // ongle
    }
    const th = new THREE.Group();
    // Pouce du côté qui, une fois la main tournée, regarde vers l'avant
    th.position.set(-side * 0.03, -0.058, -0.008);
    th.rotation.set(0.25, 0, side * 0.5);
    hand.add(th);
    mesh(cap(0.0125, 0.03, 8), skin, 0, -0.02, 0, th);
    const th2 = new THREE.Group();
    th2.position.set(0, -0.042, 0);
    th2.rotation.x = 0.28;
    th.add(th2);
    mesh(cap(0.0108, 0.024, 8), skin, 0, -0.016, 0, th2);
    hand.scale.setScalar(F ? 0.96 : 1.06);
  }

  // --- Jambes : cuisse, genou, jambe, cheville et basket modelée
  const shoeDef = wearOn ? w!.shoes : undefined;
  const sneaker = !shoeDef || shoeDef.style === 'sneakers';
  const shoeColor = shoeDef ? shoeDef.color : work ? 0x3b2a1a : office ? 0x1a1411 : F ? 0xf3f1ec : [0xf3f1ec, 0x1f2a44, 0xeeeeee][look.color % 3]!;
  const accent = work ? 0x1a1a1a : office ? 0x2a1d14 : F ? 0xe5383b : [0x1f6feb, 0xe5383b, 0xffce00][look.color % 3]!;
  const upperGeo = sneakerUpper();
  const soleGeo = sneakerSole();
  for (const [name, side] of [['legL', -1], ['legR', 1]] as const) {
    const leg = new THREE.Group();
    leg.name = name;
    leg.position.set(side * (F ? 0.088 : 0.092), 0.93, 0);
    g.add(leg);
    mesh(new THREE.CylinderGeometry(F ? 0.082 : 0.086, F ? 0.058 : 0.062, 0.47, 14), bareLegs ? skin : bottom, 0, -0.225, 0, leg); // cuisse effilée
    if (shorts) mesh(new THREE.CylinderGeometry(F ? 0.085 : 0.089, F ? 0.07 : 0.074, 0.3, 14), bottom, 0, -0.14, 0, leg); // short
    const shin = new THREE.Group();
    shin.name = 'shin';
    shin.position.set(0, -0.45, 0);
    leg.add(shin);
    mesh(ball(F ? 0.058 : 0.062, 12, 8), bareLegs ? skin : bottom, 0, 0, 0, shin); // genou
    mesh(new THREE.CylinderGeometry(F ? 0.058 : 0.062, 0.045, 0.43, 14), bareLegs ? skin : bottom, 0, -0.215, 0.002, shin); // jambe effilée
    if (!bareLegs) mesh(new THREE.TorusGeometry(0.046, 0.007, 6, 16), denim ? mats.color(new THREE.Color(look.pants).multiplyScalar(1.3).getHex(), 0.85) : bottom, 0, -0.412, 0.002, shin).rotation.x = Math.PI / 2;
    mesh(cap(0.03, 0.03, 8), skin, 0, -0.43, 0, shin); // cheville entrevue
    const foot = new THREE.Group();
    foot.name = 'foot';
    foot.position.set(0, -0.425, 0);
    shin.add(foot);
    mesh(upperGeo, mats.color(shoeColor, 0.55), 0, 0, 0, foot);
    mesh(soleGeo, mats.color(!sneaker || office || work ? 0x2b2622 : 0xeeece6, 0.7), 0, 0, 0, foot);
    if (sneaker && !office && !work) {
      // Lacets : cinq croisillons blancs le long de la voûte ; bande de couleur de chaque côté, languette et talon colorés, bout renforcé
      for (let i = 0; i < 5; i++) {
        const z = 0.064 + i * 0.024;
        const y = 0.056 - (z - 0.064) * 0.34;
        mesh(new THREE.BoxGeometry(0.056, 0.005, 0.007), mats.color(0xffffff, 0.9), 0, y + 0.012, z, foot).rotation.x = 0.33;
      }
      mesh(new THREE.BoxGeometry(0.03, 0.026, 0.006), mats.color(accent, 0.6), 0, 0.074, 0.03, foot).rotation.x = 0.35; // languette
      for (const sd of [-1, 1]) {
        mesh(new THREE.BoxGeometry(0.004, 0.012, 0.1), mats.color(accent, 0.6), sd * 0.0345, 0.0, 0.035, foot).rotation.x = -0.1; // bande latérale
        mesh(new THREE.BoxGeometry(0.004, 0.032, 0.026), mats.color(accent, 0.6), sd * 0.0345, 0.022, -0.075, foot); // pièce de talon
      }
      mesh(ball(0.03, 12, 8), mats.color(0xffffff, 0.6), 0, -0.016, 0.19, foot).scale.set(0.98, 0.62, 1.0); // bout renforcé
    }
  }
  return g;
}

/** Parties articulées : chacune devient un maillage par matériau (doigts, cheveux, lacets… fusionnés), le jeu anime ces nœuds. */
const JOINTS = new Set(['armL', 'armR', 'forearm', 'legL', 'legR', 'shin', 'foot']);
function bake(root: THREE.Group): void {
  root.updateMatrixWorld(true);
  const nodes: THREE.Object3D[] = [root];
  root.traverse((o) => {
    if (o !== root && JOINTS.has(o.name)) nodes.push(o);
  });
  const tmp = new THREE.Matrix4();
  for (const node of nodes) {
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const trash: THREE.Object3D[] = [];
    const take = (m: THREE.Mesh | THREE.InstancedMesh) => {
      const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      const list = buckets.get(m.material as THREE.Material) ?? [];
      const count = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
      for (let i = 0; i < count; i++) {
        const geo = src.clone();
        if (count > 1 || (m as THREE.InstancedMesh).isInstancedMesh) {
          (m as THREE.InstancedMesh).getMatrixAt(i, tmp);
          geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rel, tmp));
        } else geo.applyMatrix4(rel);
        for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
        list.push(geo);
      }
      buckets.set(m.material as THREE.Material, list);
    };
    const walk = (o: THREE.Object3D) => {
      for (const c of o.children) {
        if (JOINTS.has(c.name)) continue;
        if ((c as THREE.Mesh).isMesh) {
          take(c as THREE.Mesh);
          trash.push(c);
        } else {
          walk(c);
          trash.push(c);
        }
      }
    };
    walk(node);
    for (const t of trash) {
      t.parent?.remove(t);
      if ((t as THREE.Mesh).isMesh) (t as THREE.Mesh).geometry.dispose();
    }
    for (const [mat, list] of buckets) {
      const merged = mergeGeometries(list, false);
      list.forEach((l) => l.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      node.add(mesh);
    }
  }
}

/** Modèles déjà construits, par jeu de matériaux et par apparence : les figurants identiques partagent leurs géométries. */
const CACHE = new WeakMap<Materials, Map<string, THREE.Group>>();

/** Personnage réaliste léger : pièces fusionnées par articulation, mis en cache et cloné pour chaque personnage. */
export function buildRealPerson(mats: Materials, look: PersonLook): THREE.Group {
  const key = JSON.stringify([look.female, look.skin, look.hair, look.hairStyle, look.outfit, look.fabric, look.color, look.pants, look.wear ? Object.values(look.wear).map((d) => d?.id ?? null) : null]);
  let cache = CACHE.get(mats);
  if (!cache) CACHE.set(mats, (cache = new Map()));
  let base = cache.get(key);
  if (!base) {
    base = buildRaw(mats, look);
    bake(base);
    cache.set(key, base);
  }
  return base.clone(true);
}
