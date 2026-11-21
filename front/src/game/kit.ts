// Outils communs aux scènes 3D : textures wax, générateur aléatoire déterministe, personnages style animation 3D.
// Tout est généré en code (aucun asset externe) et partagé pour rester léger sur mobile.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getSavedRealPeople } from '../lib/prefs';
import { buildRealPerson } from './realPerson';

export const WAX_PALETTES: [string, string, string][] = [
  ['#006a4e', '#ffce00', '#d21034'],
  ['#f18f01', '#2e86ab', '#ffffff'],
  ['#c73e1d', '#f2c14e', '#3b1f2b'],
  ['#6a4c93', '#ff595e', '#ffca3a'],
  ['#1f6feb', '#ffffff', '#ffce00'],
  ['#0b7a75', '#f4d35e', '#ee964b'],
];
/** Teintes de peau du plus clair au plus foncé (éditeur d'apparence). */
export const SKIN_TONES = [0xf1d3bf, 0xe4bb98, 0xd4a07a, 0xc48a62, 0xb27650, 0x9f6643, 0x8f5b3b, 0x7f4f32, 0x70452b, 0x613a24, 0x52301d, 0x432717];
export const HAIR_COLORS = [0x111111, 0x2a1a12, 0x3a2416, 0x6b4226, 0x9a5b2e, 0xc9a36b, 0x6b2fa0];
/** Couleurs de tissu uni (et indice de motif pour le wax). */
export const CLOTH_COLORS = [0xffffff, 0x1f6feb, 0xe5383b, 0xffce00, 0x22a861, 0xf18f01, 0x14213d, 0x8e44ad];
export const HAIR_STYLES = ['short', 'lowcut', 'afro', 'braids', 'bun', 'locs', 'gele', 'cap'] as const;
export const OUTFITS = ['casual', 'office', 'boubou', 'work'] as const;
export const FABRICS = ['plain', 'wax', 'kente', 'batik'] as const;
const PANTS = [0x141a26, 0x1d3557, 0x3d405b, 0x5b4636, 0x2b2d42];

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Texture « pagne wax » dessinée sur un canvas 64×64. */
export function waxTexture(p: [string, string, string], seed: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const g = cv.getContext('2d');
  if (g) {
    g.fillStyle = p[0];
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = p[1];
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        g.beginPath();
        g.arc(8 + x * 16, 8 + y * 16, 5 + ((x + y + seed) % 3) * 2, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.fillStyle = p[2];
    for (let i = 0; i < 4; i++) g.fillRect(0, i * 16 + 14, 64, 3);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        g.beginPath();
        g.arc(8 + x * 16, 8 + y * 16, 2, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function canvasTex(draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const g = cv.getContext('2d');
  if (g) draw(g);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Kente (tissage ewe) : bandes or, vert, rouge et noir, blocs alternés. */
function kenteTexture(seed: number): THREE.CanvasTexture {
  const cols = ['#e8b10c', '#1e7b3a', '#c8102e', '#111111', '#1f4fbf'];
  return canvasTex((g) => {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 4; x++) {
        g.fillStyle = cols[(x + y + seed) % cols.length]!;
        g.fillRect(x * 16, y * 8, 16, 8);
        g.fillStyle = cols[(x + y + seed + 2) % cols.length]!;
        if ((x + y) % 2) for (let i = 0; i < 4; i++) g.fillRect(x * 16 + i * 4, y * 8 + 2, 2, 4);
        else g.fillRect(x * 16, y * 8 + 3, 16, 2);
      }
    }
  });
}

/** Batik indigo : fond bleu profond, cercles et taches réservés. */
function batikTexture(seed: number): THREE.CanvasTexture {
  return canvasTex((g) => {
    g.fillStyle = seed % 2 ? '#1b2a5c' : '#24407a';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#cfe0ff';
    g.lineWidth = 2;
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      g.beginPath();
      g.arc(10 + x * 22, 10 + y * 22, 6 + ((x + y + seed) % 3), 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = '#9fbaf0';
    for (let i = 0; i < 9; i++) g.fillRect(((i * 23 + seed * 7) % 60) + 1, ((i * 37) % 60) + 1, 3, 3);
  });
}

/** Cache de matériaux partagés (une couleur = un matériau) pour limiter les changements d'état GPU. */
export class Materials {
  private readonly cache = new Map<string, THREE.Material>();
  readonly textures: THREE.Texture[] = [];
  constructor(private readonly standard: boolean) {}

  /** Vitre de maison : sombre le jour, elle s'éclaire la nuit (le monde règle `emissiveIntensity` ; 0 ailleurs, par exemple dans un intérieur). */
  windowLit(): THREE.MeshLambertMaterial {
    const k = 'window-lit';
    let m = this.cache.get(k);
    if (!m) {
      m = this.standard
        ? new THREE.MeshStandardMaterial({ color: 0x2f4a62, roughness: 0.2, metalness: 0, emissive: 0xffcf80, emissiveIntensity: 0 })
        : new THREE.MeshLambertMaterial({ color: 0x2f4a62, emissive: 0xffcf80, emissiveIntensity: 0 });
      this.cache.set(k, m);
    }
    return m as THREE.MeshLambertMaterial;
  }

  /** Blanc à couleur par sommet : décor cuit (maisons de quartier), une seule passe pour toutes ses couleurs. */
  vertexPaint(): THREE.Material {
    const k = 'vertex-paint';
    let m = this.cache.get(k);
    if (!m) {
      m = this.standard
        ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, vertexColors: true })
        : new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
      this.cache.set(k, m);
    }
    return m;
  }

  /** Couleur unie ; `roughness` plus bas = plus brillant (peau, yeux), seulement sur le profil physique. */
  color(hex: number, roughness = 0.9): THREE.Material {
    const k = roughness === 0.9 ? `c${hex}` : `c${hex}r${roughness}`;
    let m = this.cache.get(k);
    if (!m) {
      m = this.standard
        ? new THREE.MeshStandardMaterial({ color: hex, roughness, metalness: 0, flatShading: false })
        : new THREE.MeshLambertMaterial({ color: hex, flatShading: false });
      this.cache.set(k, m);
    }
    return m;
  }

  wax(i: number): THREE.Material {
    const k = `w${i % WAX_PALETTES.length}`;
    let m = this.cache.get(k);
    if (!m) {
      const tex = waxTexture(WAX_PALETTES[i % WAX_PALETTES.length]!, i);
      this.textures.push(tex);
      m = this.standard
        ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0 })
        : new THREE.MeshLambertMaterial({ map: tex });
      this.cache.set(k, m);
    }
    return m;
  }

  /** Cheveux crépus : petites boucles claires dessinées sur la couleur, teintées par le matériau. */
  hair(hex: number): THREE.Material {
    const k = `h${hex}`;
    let m = this.cache.get(k);
    if (!m) {
      const tex = canvasTex((g) => {
        g.fillStyle = '#b8b8b8';
        g.fillRect(0, 0, 64, 64);
        g.lineWidth = 1.5;
        const r = rng(hex + 7);
        for (let i = 0; i < 140; i++) {
          g.strokeStyle = r() < 0.5 ? '#ffffff' : '#7a7a7a';
          g.beginPath();
          g.arc(r() * 64, r() * 64, 1.2 + r() * 1.6, r() * 6, r() * 6 + 3.5);
          g.stroke();
        }
      });
      tex.repeat.set(4, 2);
      this.textures.push(tex);
      m = this.standard
        ? new THREE.MeshStandardMaterial({ color: hex, map: tex, roughness: 0.95, metalness: 0 })
        : new THREE.MeshLambertMaterial({ color: hex, map: tex });
      this.cache.set(k, m);
    }
    return m;
  }

  /** Tissu du vêtement : uni, wax, kente (bandes tissées) ou batik (indigo). */
  fabric(kind: Fabric, color: number): THREE.Material {
    if (kind === 'wax') return this.wax(color);
    if (kind === 'plain') return this.color(CLOTH_COLORS[color % CLOTH_COLORS.length]!);
    const k = `${kind}${color}`;
    let m = this.cache.get(k);
    if (!m) {
      const tex = kind === 'kente' ? kenteTexture(color) : batikTexture(color);
      this.textures.push(tex);
      m = this.standard
        ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.86, metalness: 0, flatShading: false })
        : new THREE.MeshLambertMaterial({ map: tex, flatShading: false });
      this.cache.set(k, m);
    }
    return m;
  }

  /** Ombre de contact très légère : garde les personnages ancrés au sol, même sans shadow map. */
  contactShadow(): THREE.Material {
    const k = 'contact-shadow';
    let m = this.cache.get(k);
    if (!m) {
      // Ombre douce : dégradé radial (noyau sombre, bord qui s'efface), au lieu d'un disque plat à bord net
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const g = cv.getContext('2d');
      if (g) {
        const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
        grad.addColorStop(0, 'rgba(10, 18, 12, 0.62)');
        grad.addColorStop(0.45, 'rgba(10, 18, 12, 0.34)');
        grad.addColorStop(1, 'rgba(10, 18, 12, 0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 1, depthWrite: false });
      this.cache.set(k, m);
    }
    return m;
  }

  /** Verre bleuté partagé pour véhicules et façades, avec transparence seulement sur le profil physique. */
  glass(): THREE.Material {
    const k = 'glass';
    let m = this.cache.get(k);
    if (!m) {
      m = this.standard
        ? new THREE.MeshStandardMaterial({ color: 0x38566f, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.82 })
        : new THREE.MeshLambertMaterial({ color: 0x38566f });
      this.cache.set(k, m);
    }
    return m;
  }

  dispose(): void {
    this.cache.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
  }
}

export type HairStyle = (typeof HAIR_STYLES)[number];
export type Outfit = (typeof OUTFITS)[number];
export type Fabric = (typeof FABRICS)[number];

/** Vêtement du catalogue des boutiques (« clothes.items » côté serveur). */
export interface GarmentDef {
  id: string;
  slot: 'top' | 'bottom' | 'dress' | 'shoes';
  gender: 'm' | 'f' | 'u';
  style: string;
  fabric: Fabric;
  /** Couleur du tissu uni (0xRRGGBB) ; motif pour wax, kente et batik. */
  color: number;
  pattern: number;
  price: number;
  emoji: string;
  nameFr: string;
  nameEn: string;
}
/** Tenue composée : identifiants des vêtements portés. */
export interface Wear {
  top?: string;
  bottom?: string;
  dress?: string;
  shoes?: string;
}
const WEAR_SLOTS = ['top', 'bottom', 'dress', 'shoes'] as const;
/** Catalogue des vêtements, chargé avec le catalogue du jeu : sert à dessiner la tenue de chacun. */
const GARMENTS = new Map<string, GarmentDef>();
export function setGarments(list: GarmentDef[] | undefined): void {
  GARMENTS.clear();
  for (const g of list ?? []) GARMENTS.set(g.id, g);
}
export function garment(id: string | undefined): GarmentDef | undefined {
  return id ? GARMENTS.get(id) : undefined;
}

/** Apparence d'un personnage (couleurs résolues). */
export interface PersonLook {
  female: boolean;
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  outfit: Outfit;
  fabric: Fabric;
  /** Indice de couleur / de motif du tissu. */
  color: number;
  pants: number;
  /** Vêtements achetés portés (remplacent la tenue d'origine). */
  wear?: { top?: GarmentDef; bottom?: GarmentDef; dress?: GarmentDef; shoes?: GarmentDef };
}

/** Apparence enregistrée (indices validés par le serveur). */
export interface SavedLook {
  female: boolean;
  hair: HairStyle;
  outfit: Outfit;
  fabric: Fabric;
  skin: number;
  hairColor: number;
  color: number;
  wear?: Wear;
}

/** Tenue enregistrée dans une apparence reçue (identifiants seulement, sans faire confiance au reste). */
export function wearOf(v: unknown): Wear | undefined {
  const w = v && typeof v === 'object' ? (v as Record<string, unknown>).wear : undefined;
  if (!w || typeof w !== 'object') return undefined;
  const out: Wear = {};
  for (const s of WEAR_SLOTS) {
    const id = (w as Record<string, unknown>)[s];
    if (typeof id === 'string' && /^[a-z0-9_]{2,32}$/.test(id)) out[s] = id;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Apparence complète d'un personnage : choix de l'éditeur (ou tirée de l'identifiant) et tenue composée. */
export function resolveLook(v: unknown, id: string): PersonLook {
  const base = isSavedLook(v) ? v : defaultLook(id);
  return lookFromSaved({ ...base, wear: wearOf(v) });
}

/** Apparence reçue d'un autre joueur : vérifiée avant usage (le serveur la valide déjà). */
export function isSavedLook(v: unknown): v is SavedLook {
  if (!v || typeof v !== 'object') return false;
  const l = v as Record<string, unknown>;
  const idx = (x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) < 64;
  return typeof l.female === 'boolean' && (HAIR_STYLES as readonly unknown[]).includes(l.hair) && (OUTFITS as readonly unknown[]).includes(l.outfit) && (FABRICS as readonly unknown[]).includes(l.fabric) && idx(l.skin) && idx(l.hairColor) && idx(l.color);
}

/** Apparence par défaut tirée de l'identifiant du personnage (stable d'une session à l'autre). */
export function defaultLook(id: string): SavedLook {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const n = (k: number) => (h >>> 0) % (k * 7919) % k;
  const female = (h & 1) === 1;
  return { female, hair: HAIR_STYLES[n(HAIR_STYLES.length)]!, outfit: OUTFITS[n(OUTFITS.length)]!, fabric: FABRICS[n(FABRICS.length)]!, skin: 6 + n(6), hairColor: 0, color: n(CLOTH_COLORS.length) };
}

export function lookFromSaved(l: SavedLook): PersonLook {
  return {
    female: l.female,
    skin: SKIN_TONES[l.skin] ?? SKIN_TONES[8]!,
    hair: HAIR_COLORS[l.hairColor] ?? HAIR_COLORS[0]!,
    hairStyle: l.hair,
    outfit: l.outfit,
    fabric: l.fabric,
    color: l.color,
    pants: PANTS[l.color % PANTS.length]!,
    wear: l.wear ? { top: garment(l.wear.top), bottom: garment(l.wear.bottom), dress: garment(l.wear.dress), shoes: garment(l.wear.shoes) } : undefined,
  };
}

/** Figurant au hasard (population de Lomé : peaux plutôt foncées, beaucoup de wax). */
export function randomLook(r: () => number): PersonLook {
  const female = r() < 0.5;
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)]!;
  const styles: HairStyle[] = female ? ['braids', 'bun', 'gele', 'afro', 'locs', 'short'] : ['short', 'lowcut', 'cap', 'afro', 'locs'];
  const f = r();
  return {
    female,
    skin: SKIN_TONES[5 + Math.floor(r() * 7)]!,
    hair: r() < 0.85 ? HAIR_COLORS[Math.floor(r() * 3)]! : pick(HAIR_COLORS),
    hairStyle: pick(styles),
    outfit: (['casual', 'casual', 'office', 'boubou', 'work'] as const)[Math.floor(r() * 5)]!,
    fabric: f < 0.45 ? 'wax' : f < 0.75 ? 'plain' : f < 0.88 ? 'kente' : 'batik',
    color: Math.floor(r() * 8),
    pants: pick(PANTS),
  };
}

const lathe = (pts: [number, number][], seg = 12) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const capsule = (r: number, len: number, radial = 12) => new THREE.CapsuleGeometry(r, len, 4, radial);
/** Calotte sphérique tournée vers l'avant (+z) : iris, pupille, paupière. */
const cap = (r: number, angle: number, seg = 16) => new THREE.SphereGeometry(r, seg, 6, 0, Math.PI * 2, 0, angle).rotateX(Math.PI / 2);
/** Arc de tore centré vers le bas (sourire) ou vers le haut (sourcil). */
const arc = (r: number, tube: number, angle: number, up: boolean) => new THREE.TorusGeometry(r, tube, 6, 14, angle).rotateZ((up ? Math.PI / 2 : -Math.PI / 2) - angle / 2);

/** Empeigne de basket d'une seule pièce : profil latéral (talon haut, bout arrondi) extrudé avec bords arrondis. */
function sneakerGeometry(): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(-0.07, 0);
  sh.lineTo(0.13, 0);
  sh.quadraticCurveTo(0.16, 0, 0.155, 0.02);
  sh.quadraticCurveTo(0.15, 0.038, 0.1, 0.045);
  sh.lineTo(0.03, 0.06);
  sh.lineTo(-0.02, 0.075);
  sh.lineTo(-0.065, 0.07);
  sh.quadraticCurveTo(-0.08, 0.05, -0.07, 0);
  const depth = 0.07;
  const extruded = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.018, bevelSegments: 4, curveSegments: 8 });
  // Normales lissées (sans les coutures d'UV), puis UV neutres pour pouvoir fusionner avec le reste de la jambe
  extruded.deleteAttribute('uv');
  extruded.deleteAttribute('normal');
  const geo = mergeVertices(extruded, 1e-4);
  extruded.dispose();
  geo.computeVertexNormals();
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
  // Profil dans le plan (avant, haut), épaisseur centrée sur x
  return geo.translate(0, 0, -depth / 2).rotateY(-Math.PI / 2);
}

// Géométries partagées : style « animation 3D » — grosse tête ronde, grands yeux, formes lisses et membres en capsules.
const GEO = {
  torsoM: lathe([[0.16, 0], [0.17, 0.12], [0.19, 0.3], [0.215, 0.45], [0.2, 0.56], [0.08, 0.62]], 20),
  torsoF: lathe([[0.17, 0], [0.155, 0.14], [0.18, 0.3], [0.195, 0.42], [0.185, 0.53], [0.08, 0.6]], 20),
  pelvis: lathe([[0.14, -0.07], [0.18, 0], [0.175, 0.1], [0.155, 0.15]], 18),
  tunic: lathe([[0.29, -0.62], [0.23, -0.2], [0.18, 0.1], [0.215, 0.42], [0.2, 0.52], [0.08, 0.6]], 20),
  dress: lathe([[0.3, -0.92], [0.24, -0.5], [0.165, -0.02], [0.165, 0.14], [0.175, 0.38], [0.16, 0.48], [0.08, 0.56]], 20),
  skirt: lathe([[0.21, -0.5], [0.19, -0.2], [0.16, 0.06]], 18),
  pagne: lathe([[0.25, -0.86], [0.215, -0.5], [0.18, -0.15], [0.165, 0.06]], 18),
  shirtFront: new THREE.BoxGeometry(0.1, 0.24, 0.02),
  heelBlock: new THREE.BoxGeometry(0.034, 0.06, 0.034),
  strap: new THREE.BoxGeometry(0.1, 0.018, 0.024),
  collar: new THREE.TorusGeometry(0.068, 0.017, 6, 18),
  neck: new THREE.CylinderGeometry(0.052, 0.058, 0.12, 12),
  head: new THREE.SphereGeometry(0.15, 24, 18),
  jaw: new THREE.SphereGeometry(0.12, 18, 12),
  ear: new THREE.SphereGeometry(0.04, 10, 8),
  noseTip: new THREE.SphereGeometry(0.03, 12, 8),
  nostril: new THREE.SphereGeometry(0.018, 8, 6),
  eye: new THREE.SphereGeometry(0.036, 16, 12),
  iris: cap(0.0368, 0.62),
  pupil: cap(0.0372, 0.3, 12),
  shine: new THREE.SphereGeometry(0.0065, 6, 4),
  lid: cap(0.039, 1.15),
  brow: arc(0.042, 0.0095, 1.5, true),
  smile: arc(0.036, 0.0065, Math.PI * 0.62, false),
  upperArm: capsule(0.05, 0.2),
  sleeve: new THREE.CylinderGeometry(0.066, 0.074, 0.15, 14),
  forearm: capsule(0.043, 0.17),
  palm: new THREE.SphereGeometry(0.045, 14, 10),
  finger: capsule(0.011, 0.03, 6),
  thumb: capsule(0.012, 0.022, 6),
  shoulder: new THREE.SphereGeometry(0.064, 14, 10),
  belt: new THREE.CylinderGeometry(0.178, 0.178, 0.04, 18),
  thigh: capsule(0.088, 0.24),
  shin: capsule(0.067, 0.29),
  hem: new THREE.CylinderGeometry(0.069, 0.07, 0.022, 14),
  shoe: sneakerGeometry(),
  sole: capsule(0.058, 0.155, 16).rotateX(Math.PI / 2),
  lace: new THREE.BoxGeometry(0.052, 0.008, 0.012),
  hairCap: new THREE.SphereGeometry(0.158, 24, 10, 0, Math.PI * 2, 0, Math.PI / 1.9),
  hairTop: new THREE.SphereGeometry(0.14, 18, 10),
  afro: new THREE.SphereGeometry(0.2, 20, 14),
  bun: new THREE.SphereGeometry(0.085, 12, 10),
  strand: capsule(0.02, 0.26, 6),
  loc: capsule(0.024, 0.28, 6),
  geleBase: new THREE.CylinderGeometry(0.17, 0.16, 0.12, 12),
  geleFan: new THREE.ConeGeometry(0.21, 0.25, 8, 1, true),
  cap: new THREE.SphereGeometry(0.164, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  brim: new THREE.CylinderGeometry(0.1, 0.1, 0.014, 16, 1, false, -Math.PI / 2, Math.PI),
  stripe: new THREE.BoxGeometry(0.46, 0.03, 0.38),
  contactShadow: new THREE.CircleGeometry(0.46, 20),
};

type BodyCut = 'torso' | 'tunic' | 'dress' | 'gown';
type LegCut = 'pants' | 'shorts' | 'skirt' | 'pagne' | 'none';
type ShoeStyle = 'sneakers' | 'sandals' | 'dress_shoes' | 'heels';
/** Ce que porte le personnage, réduit à des formes et des matériaux. */
interface Plan {
  top: THREE.Material;
  body: BodyCut;
  longSleeves: boolean;
  jacket: boolean;
  bottom: THREE.Material;
  legs: LegCut;
  belt: boolean;
  stripes: boolean;
  shoe: { style: ShoeStyle; color: number };
}

/** Matériau d'un vêtement du catalogue : couleur unie ou motif (wax, kente, batik). */
function garmentMat(mats: Materials, g: GarmentDef): THREE.Material {
  return g.fabric === 'plain' ? mats.color(g.color) : mats.fabric(g.fabric, g.pattern);
}

function planOf(mats: Materials, look: PersonLook): Plan {
  const F = look.female;
  const work = look.outfit === 'work';
  // Tenue d'origine (éditeur d'apparence, figurants)
  const p: Plan = {
    top: work ? mats.color(0xf18f01) : mats.fabric(look.fabric, look.color),
    body: look.outfit === 'boubou' ? (F ? 'gown' : 'tunic') : 'torso',
    longSleeves: look.outfit === 'office' || look.outfit === 'boubou' || work,
    jacket: false,
    bottom: work ? mats.color(0xf18f01) : look.outfit === 'office' ? mats.color(0x1b2233) : mats.color(look.pants),
    legs: F && look.outfit === 'office' ? 'skirt' : F && look.outfit === 'boubou' ? 'none' : 'pants',
    belt: look.outfit !== 'boubou' && !(F && look.outfit === 'office'),
    stripes: work,
    shoe: { style: 'sneakers', color: work ? 0x3b2a1a : F ? 0x8a2a3a : [0x1b1b1b, 0x9a6232, 0x3d4a5c, 0xf0ece4][look.color % 4]! },
  };
  const w = look.wear;
  if (!w) return p;
  // Vêtements achetés : une robe, ou un haut et un bas
  if (w.dress) {
    const m = garmentMat(mats, w.dress);
    Object.assign(p, { top: m, bottom: m, body: w.dress.style === 'gown' ? 'gown' : 'dress', longSleeves: false, jacket: false, legs: w.dress.style === 'gown' ? 'none' : 'skirt', belt: false, stripes: false });
  } else if (w.top && w.bottom) {
    const t = w.top.style;
    const b = w.bottom.style;
    Object.assign(p, {
      top: garmentMat(mats, w.top),
      body: t === 'tunic' ? 'tunic' : 'torso',
      longSleeves: t === 'shirt' || t === 'tunic' || t === 'jacket',
      jacket: t === 'jacket',
      bottom: garmentMat(mats, w.bottom),
      legs: b === 'shorts' ? 'shorts' : b === 'skirt' ? 'skirt' : b === 'pagne' ? 'pagne' : 'pants',
      belt: t !== 'tunic' && (b === 'jeans' || b === 'trousers' || b === 'shorts'),
      stripes: false,
    });
  }
  if (w.shoes) p.shoe = { style: (['sneakers', 'sandals', 'dress_shoes', 'heels'] as const).find((s) => s === w.shoes!.style) ?? 'sneakers', color: w.shoes.color };
  return p;
}

/**
 * Personnage humanoïde (~1,9 m) au style « animation 3D » (grosse tête, grands yeux, sourire). Membres nommés
 * (armL, armR, legL, legR) pour l'animation ; le coude et le genou sont des articulations enfants (forearm, shin).
 */
export function buildClassicPerson(mats: Materials, look: PersonLook): THREE.Group {
  const g = new THREE.Group();
  const skin = mats.color(look.skin, 0.55);
  const palmSkin = mats.color(new THREE.Color(look.skin).lerp(new THREE.Color(0xe8b49a), 0.35).getHex(), 0.55);
  const hairMat = mats.hair(look.hair);
  const plan = planOf(mats, look);
  const top = plan.top;
  const pants = plan.bottom;
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const F = look.female;
  // Jambes cachées sous une robe longue ou un pagne ; nues sous une jupe ou une robe courte
  const longDress = plan.legs === 'none' || plan.legs === 'pagne';
  const skirt = plan.legs === 'skirt';
  // Buste (tunique longue du boubou, robe longue), bassin, jupe ou pagne, ceinture, col
  if (plan.body === 'tunic') add(GEO.tunic, top, 0, 0.93, 0).scale.set(1.05, 1, 0.78);
  else if (plan.body === 'gown') add(GEO.dress, top, 0, 0.93, 0).scale.set(1, 0.96, 0.8);
  else add(F ? GEO.torsoF : GEO.torsoM, top, 0, 0.93, 0).scale.set(1, 1, 0.78);
  if (plan.body !== 'gown') add(GEO.pelvis, pants, 0, 0.9, 0).scale.set(1, 1, 0.8);
  if (skirt) add(GEO.skirt, pants, 0, 0.93, 0).scale.set(1, 0.92, 0.8);
  if (plan.legs === 'pagne') add(GEO.pagne, pants, 0, 0.93, 0).scale.set(1, 1, 0.8);
  if (plan.belt) add(GEO.belt, mats.color(0x2a1d14), 0, 0.94, 0).scale.set(1, 1, 0.78);
  const collar = add(GEO.collar, top, 0, 1.525, 0);
  collar.rotation.x = Math.PI / 2 - 0.15;
  collar.scale.set(1.05, 0.9, 1);
  if (plan.jacket) {
    // Veste ouverte sur une chemise blanche
    add(GEO.shirtFront, mats.color(0xf7f7f5), 0, 1.38, 0.158).rotation.x = -0.14;
  }
  if (plan.stripes) {
    // Bandes réfléchissantes de la tenue de chantier
    add(GEO.stripe, mats.color(0xe9edf3), 0, 1.2, 0).scale.set(0.82, 1, 0.78);
    add(GEO.stripe, mats.color(0xe9edf3), 0, 1.36, 0).scale.set(0.9, 1, 0.8);
  }
  // Cou et tête : crâne rond, mâchoire pleine, oreilles, nez large et arrondi
  add(GEO.neck, skin, 0, 1.55, -0.005);
  add(GEO.head, skin, 0, 1.75, 0).scale.set(0.92, 1, 0.95);
  add(GEO.jaw, skin, 0, 1.68, 0.014).scale.set(0.84, 0.74, 0.86);
  for (const x of [-0.138, 0.138]) add(GEO.ear, skin, x, 1.735, -0.004).scale.set(0.5, 1, 0.78);
  add(GEO.noseTip, skin, 0, 1.714, 0.13).scale.set(1, 0.72, 0.75);
  for (const x of [-0.022, 0.022]) add(GEO.nostril, skin, x, 1.708, 0.122).scale.set(1, 0.8, 0.8);
  // Grands yeux : blanc brillant, iris brun, pupille, reflet ; paupière supérieure et sourcil épais
  const white = mats.color(0xf6f3ee, 0.25);
  const iris = mats.color(0x5b3418, 0.3);
  const dark = mats.color(0x0c0806, 0.3);
  const shine = mats.color(0xffffff, 0.1);
  for (const x of [-0.055, 0.055]) {
    const turn = x < 0 ? -0.12 : 0.12;
    add(GEO.eye, white, x, 1.765, 0.102);
    add(GEO.iris, iris, x, 1.765, 0.102);
    add(GEO.pupil, dark, x, 1.765, 0.102);
    add(GEO.shine, shine, x + 0.009, 1.773, 0.134);
    const lid = add(GEO.lid, skin, x, 1.767, 0.1);
    lid.rotation.x = -1.7;
    const brow = add(GEO.brow, hairMat, x, 1.778, 0.126);
    brow.rotation.set(-0.3, turn, -turn);
    brow.scale.set(1, 0.8, 1);
  }
  const lips = mats.color(new THREE.Color(look.skin).multiplyScalar(F ? 0.62 : 0.68).getHex(), 0.4);
  const smile = add(GEO.smile, lips, 0, 1.684, 0.112);
  smile.rotation.x = -0.25;
  // Coiffures : calotte inclinée vers l'arrière (front dégagé, nuque couverte)
  const hairCap = (r = 1) => {
    const c = add(GEO.hairCap, hairMat, 0, 1.755, -0.006);
    c.rotation.x = -0.68;
    c.scale.set(0.93 * r, r, 0.96 * r);
    return c;
  };
  const strands = (geo: THREE.BufferGeometry, n: number, len: number) => {
    for (let i = 0; i < n; i++) {
      const a = 0.04 * Math.PI + (i / (n - 1)) * Math.PI * 0.92;
      const s = add(geo, hairMat, Math.cos(a) * 0.145, 1.78 - len / 2, -Math.sin(a) * 0.14 - 0.012);
      s.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
    }
  };
  switch (look.hairStyle) {
    case 'afro':
      hairCap();
      add(GEO.afro, hairMat, 0, 1.86, -0.075).scale.set(1.08, 0.85, 0.95);
      break;
    case 'lowcut':
      hairCap(0.975);
      break;
    case 'braids':
      hairCap();
      strands(GEO.strand, 13, 0.3);
      break;
    case 'locs':
      hairCap();
      add(GEO.hairTop, hairMat, 0, 1.83, -0.03).scale.set(1, 0.55, 1.05);
      strands(GEO.loc, 11, 0.32);
      break;
    case 'bun':
      hairCap();
      add(GEO.bun, hairMat, 0, 1.93, -0.06);
      break;
    case 'gele': {
      // Foulard de tête noué haut (gèlè), dans le tissu de la tenue
      const tie = mats.fabric(look.fabric === 'plain' ? 'wax' : look.fabric, look.color + 1);
      add(GEO.geleBase, tie, 0, 1.85, -0.02).rotation.x = -0.25;
      const fan = add(GEO.geleFan, tie, 0, 2.0, -0.06);
      fan.rotation.x = Math.PI;
      fan.scale.set(1.2, 1, 0.8);
      break;
    }
    case 'cap': {
      const c = mats.color(CLOTH_COLORS[(look.color + 3) % CLOTH_COLORS.length]!);
      add(GEO.cap, c, 0, 1.77, -0.01).rotation.x = -0.25;
      add(GEO.brim, c, 0, 1.845, 0.13).scale.set(1, 1, 1.25);
      break;
    }
    default:
      // Coupe courte avec un peu de volume sur le dessus
      hairCap();
      add(GEO.hairTop, hairMat, 0, 1.835, -0.025).scale.set(0.98, 0.52, 1.02);
  }
  // Bras : épaule (pivot nommé) puis coude légèrement plié ; main en moufle avec pouce
  const longSleeves = plan.longSleeves;
  const sx = F ? 0.2 : 0.225;
  for (const [name, x] of [['armL', -sx], ['armR', sx]] as const) {
    const arm = new THREE.Group();
    arm.name = name;
    arm.position.set(x, 1.47, 0);
    arm.rotation.z = x < 0 ? -0.06 : 0.06;
    g.add(arm);
    add(GEO.shoulder, top, 0, -0.01, 0, arm);
    add(GEO.upperArm, longSleeves ? top : skin, 0, -0.135, 0, arm);
    add(GEO.sleeve, top, 0, -0.07, 0, arm);
    const fore = new THREE.Group();
    fore.name = 'forearm';
    fore.position.set(0, -0.27, 0);
    fore.rotation.x = -0.18;
    arm.add(fore);
    add(GEO.forearm, longSleeves ? top : skin, 0, -0.11, 0, fore);
    // Main : paume plate tournée vers le corps (intérieur plus clair), quatre doigts un peu repliés, pouce vers l'avant
    const inward = x < 0 ? 1 : -1;
    add(GEO.palm, skin, 0, -0.255, 0.002, fore).scale.set(0.46, 0.85, 0.8);
    add(GEO.palm, palmSkin, inward * 0.01, -0.258, 0.002, fore).scale.set(0.2, 0.68, 0.6);
    for (const [z, len] of [[0.0225, 0.88], [0.0075, 1], [-0.0075, 0.96], [-0.021, 0.8]] as const) {
      const f = add(GEO.finger, skin, inward * 0.004, -0.29 - 0.006 * len, z, fore);
      f.scale.set(1, len, 1);
      f.rotation.set(-z * 1.5, 0, inward * 0.28);
    }
    const thumb = add(GEO.thumb, skin, inward * 0.01, -0.268, 0.03, fore);
    thumb.rotation.set(-0.45, 0, inward * 0.25);
  }
  // Jambes : hanche (pivot nommé), genou, ourlet, chaussures selon le modèle porté
  const shorts = plan.legs === 'shorts';
  const bareShins = longDress || skirt || shorts;
  const shoe = plan.shoe;
  const shoeMat = mats.color(shoe.color, shoe.style === 'sneakers' ? 0.9 : 0.4);
  const laceMat = mats.color(plan.stripes ? 0xc9a36b : 0xf7f5f0);
  const soleMat = mats.color(plan.stripes ? 0x2b2622 : shoe.style === 'sneakers' ? 0xf2efe8 : 0x2a1c12);
  for (const [name, x] of [['legL', -0.095], ['legR', 0.095]] as const) {
    const leg = new THREE.Group();
    leg.name = name;
    leg.position.set(x, 0.88, 0);
    g.add(leg);
    if (!longDress) add(GEO.thigh, skirt ? skin : pants, 0, -0.185, 0, leg);
    const shin = new THREE.Group();
    shin.name = 'shin';
    shin.position.set(0, -0.37, 0);
    leg.add(shin);
    add(GEO.shin, bareShins ? skin : pants, 0, -0.17, 0, shin);
    if (!bareShins) add(GEO.hem, pants, 0, -0.345, 0, shin);
    switch (shoe.style) {
      case 'sandals':
        // Pied nu sur une semelle, bride sur le dessus
        add(GEO.shoe, skin, 0, -0.43, 0, shin).scale.set(0.88, 0.55, 0.95);
        add(GEO.strap, shoeMat, 0, -0.4, 0.07, shin).rotation.x = 0.25;
        add(GEO.sole, shoeMat, 0, -0.452, 0.037, shin).scale.set(1, 0.24, 1);
        break;
      case 'dress_shoes':
        // Chaussure de ville basse et brillante, semelle fine
        add(GEO.shoe, shoeMat, 0, -0.432, 0, shin).scale.set(0.95, 0.72, 1);
        add(GEO.sole, soleMat, 0, -0.452, 0.037, shin).scale.set(0.98, 0.22, 0.98);
        break;
      case 'heels':
        // Escarpin : empeigne fine, semelle fine et talon
        add(GEO.shoe, shoeMat, 0, -0.428, 0.004, shin).scale.set(0.85, 0.62, 0.92);
        add(GEO.sole, shoeMat, 0, -0.448, 0.04, shin).scale.set(0.9, 0.18, 0.95);
        add(GEO.heelBlock, shoeMat, 0, -0.455, -0.072, shin);
        break;
      default:
        // Basket : empeigne d'une pièce, lacets, semelle épaisse légèrement débordante
        add(GEO.shoe, shoeMat, 0, -0.424, 0, shin);
        for (const z of [0.03, 0.058, 0.086]) add(GEO.lace, laceMat, 0, -0.343 - (z - 0.03) * 0.22, z, shin).rotation.x = 0.22;
        add(GEO.sole, soleMat, 0, -0.442, 0.037, shin).scale.set(1.02, 0.46, 1);
    }
  }
  // Moins d'appels de dessin : chaque partie rigide (corps, bras, avant-bras, cuisse, jambe) devient un seul maillage
  mergeRigid(g);
  g.traverse((o) => {
    if (o instanceof THREE.Group && o !== g) mergeRigid(o);
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  const shadow = new THREE.Mesh(GEO.contactShadow, mats.contactShadow());
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  shadow.scale.set(1, 1.7, 1);
  shadow.renderOrder = 1;
  shadow.userData.merged = true;
  g.add(shadow);
  return g;
}

/** Fusionne les maillages enfants directs d'un nœud (un groupe de géométrie par matériau). */
function mergeRigid(node: THREE.Object3D): void {
  const meshes = node.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && !c.userData.merged);
  if (meshes.length < 2) return;
  const materials: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  for (const m of meshes) {
    m.updateMatrix();
    const geo = (m.geometry.index ? m.geometry : m.geometry).clone().applyMatrix4(m.matrix);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    geos.push(geo);
    materials.push(m.material as THREE.Material);
  }
  const merged = mergeGeometries(geos, true);
  for (const geo of geos) geo.dispose();
  if (!merged) return;
  for (const m of meshes) node.remove(m);
  const mesh = new THREE.Mesh(merged, materials);
  mesh.userData.merged = true;
  node.add(mesh);
}

/** Anime la marche (phase en radians) ou remet au repos (amp = 0). */
export function animateWalk(p: THREE.Group, phase: number, amp: number): void {
  const s = Math.sin(phase) * amp;
  const c = Math.cos(phase) * amp;
  const legL = p.getObjectByName('legL');
  const legR = p.getObjectByName('legR');
  const armL = p.getObjectByName('armL');
  const armR = p.getObjectByName('armR');
  if (legL) legL.rotation.x = s;
  if (legR) legR.rotation.x = -s;
  // Genou qui plie quand la jambe revient vers l'avant, coude qui accompagne le bras
  const kneeL = legL?.getObjectByName('shin');
  const kneeR = legR?.getObjectByName('shin');
  if (kneeL) kneeL.rotation.x = Math.max(0, -c) * 0.9 + (amp > 0 ? 0.08 : 0);
  if (kneeR) kneeR.rotation.x = Math.max(0, c) * 0.9 + (amp > 0 ? 0.08 : 0);
  if (armL) {
    armL.rotation.x = -s * 0.8;
    const f = armL.getObjectByName('forearm');
    if (f) f.rotation.x = -0.18 - Math.max(0, s) * 0.5;
  }
  if (armR) {
    armR.rotation.x = s * 0.8;
    const f = armR.getObjectByName('forearm');
    if (f) f.rotation.x = -0.18 - Math.max(0, -s) * 0.5;
  }
}

/** Pose assise (pour les figurants installés sur une chaise). */
/** Jambes d'un personnage assis : cuisses à l'horizontale, genoux pliés (jambes qui descendent vers le sol), pieds à plat. */
export function seatLegs(p: THREE.Object3D): void {
  for (const n of ['legL', 'legR']) {
    const leg = p.getObjectByName(n);
    if (!leg) continue;
    leg.rotation.x = -Math.PI / 2;
    const shin = leg.getObjectByName('shin');
    if (shin) shin.rotation.x = Math.PI / 2;
    const foot = leg.getObjectByName('foot');
    if (foot) foot.rotation.x = 0;
  }
}

export function sitPose(p: THREE.Group): void {
  seatLegs(p);
  // Bassin posé sur l'assise (~0,8 m) au lieu des hanches debout (0,95 m)
  p.position.y -= 0.15;
}

/**
 * Cuit un groupe immobile (personnage posé, véhicule) en une seule géométrie à groupes de matériaux, dans le repère
 * du groupe : une InstancedMesh peut alors en dessiner des dizaines en quelques appels. Les maillages transparents
 * (ombre de contact) sont ignorés. `split` sépare certains matériaux (peinture teintée par instance) du reste.
 */
export function bakeGroup(root: THREE.Object3D, split?: (m: THREE.Material) => boolean): { geometry: THREE.BufferGeometry; materials: THREE.Material[] }[] {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = [new Map<THREE.Material, THREE.BufferGeometry[]>(), new Map<THREE.Material, THREE.BufferGeometry[]>()];
  const push = (m: THREE.Material, geo: THREE.BufferGeometry) => {
    const b = buckets[split?.(m) ? 1 : 0]!;
    const l = b.get(m) ?? [];
    l.push(geo);
    b.set(m, l);
  };
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.every((m) => m.transparent)) return;
    const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const src = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(local);
    for (const k of Object.keys(src.attributes)) if (!['position', 'normal', 'uv'].includes(k)) src.deleteAttribute(k);
    if (!src.getAttribute('uv')) src.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(src.getAttribute('position').count * 2), 2));
    const groups = Array.isArray(o.material) && src.groups.length ? src.groups : [{ start: 0, count: src.getAttribute('position').count, materialIndex: 0 }];
    for (const gr of groups) {
      const m = mats[gr.materialIndex ?? 0];
      if (!m || m.transparent) continue;
      const part = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv']) {
        const a = src.getAttribute(k) as THREE.BufferAttribute;
        part.setAttribute(k, new THREE.BufferAttribute((a.array as Float32Array).slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize));
      }
      push(m, part);
    }
    src.dispose();
  });
  return buckets
    .filter((b) => b.size > 0)
    .map((b) => {
      const materials = [...b.keys()];
      const merged = mergeGeometries(materials.map((m) => mergeGeometries(b.get(m)!, false)!), true)!;
      for (const l of b.values()) for (const g of l) g.dispose();
      return { geometry: merged, materials };
    });
}

/** Points (repère du véhicule) où le personnage s'appuie sur un deux-roues : hanche sur la selle, plante des pieds, mains. */
export interface RideSpec {
  /** Hauteur et position avant/arrière de l'articulation de la hanche (au-dessus de la selle). */
  hip: { y: number; z: number };
  /** Inclinaison du buste vers l'avant (rad), autour de la hanche. */
  lean: number;
  /** Dessus des cale-pieds / pédales : [gauche, droit], là où se pose la plante du pied. */
  feet: [THREE.Vector3, THREE.Vector3];
  /** Centre des poignées (ou de la taille du conducteur) : [gauche, droite] ; sans mains, les bras restent le long du corps. */
  hands?: [THREE.Vector3, THREE.Vector3];
}

interface RideDims {
  hipH: number;
  thigh: number;
  shin: number;
  upper: number;
  fore: number;
}

/**
 * Pose un personnage sur un deux-roues par cinématique inverse : les pieds sur les cale-pieds, les genoux pliés vers l'avant,
 * le buste penché, les mains sur le guidon. Le corps est enveloppé une fois dans un pivot placé à la hanche (`ridePivot`),
 * et `clearRidePose` le remet debout. `shift` convertit les points du repère du véhicule vers celui du personnage.
 */
export function ridePose(p: THREE.Group, spec: RideSpec, shift = new THREE.Vector3()): void {
  let pivot = p.getObjectByName('ridePivot') as THREE.Group | undefined;
  if (!pivot) {
    // Mesures au repos : jambes et bras droits, sans rotation
    const limbs = ['legL', 'legR', 'armL', 'armR'].map((n) => p.getObjectByName(n)!);
    const joints = [...limbs, ...['shin', 'forearm', 'foot'].map((n) => p.getObjectByName(n)).filter((j): j is THREE.Object3D => !!j)];
    const saved = joints.map((j) => j.rotation.clone());
    joints.forEach((j) => j.rotation.set(0, 0, 0));
    p.updateWorldMatrix(true, true);
    const scale = p.getWorldScale(new THREE.Vector3()).y;
    const baseY = p.getWorldPosition(new THREE.Vector3()).y;
    const low = (o: THREE.Object3D) => (new THREE.Box3().setFromObject(o).min.y - baseY) / scale;
    const leg = limbs[0]!;
    const arm = limbs[2]!;
    const thigh = Math.abs(leg.getObjectByName('shin')!.position.y);
    const upper = Math.abs(arm.getObjectByName('forearm')!.position.y);
    const dims: RideDims = {
      hipH: leg.position.y,
      thigh,
      // Du genou à la cheville (la semelle est ~6,5 cm plus bas)
      shin: leg.position.y - thigh - low(leg) - 0.065,
      upper,
      // De l'épaule à la paume (le bas de la main est ~4 cm sous son centre)
      fore: arm.position.y - upper - low(arm) - 0.04,
    };
    joints.forEach((j, i) => j.rotation.copy(saved[i]!));
    pivot = new THREE.Group();
    pivot.name = 'ridePivot';
    pivot.userData.dims = dims;
    pivot.position.set(0, dims.hipH, 0);
    // Le corps passe sous le pivot ; l'ombre de contact (transparente) reste au sol
    for (const c of [...p.children]) {
      if (c instanceof THREE.Mesh && (c.material as THREE.Material).transparent) continue;
      c.position.y -= dims.hipH;
      pivot.add(c);
    }
    p.add(pivot);
    p.userData.ridden = true;
  }
  const d = pivot.userData.dims as RideDims;
  const hip = new THREE.Vector3(0, spec.hip.y, spec.hip.z).add(shift);
  pivot.position.copy(hip);
  pivot.rotation.set(spec.lean, 0, 0);
  pivot.updateMatrix();
  const inv = pivot.matrix.clone().invert();
  const local = (v: THREE.Vector3) => v.clone().add(shift).applyMatrix4(inv);
  p.userData.ridden = true;

  /** Articulation à deux segments : place l'extrémité sur `target` (repère du pivot) ; `sign` +1 genou, −1 coude. */
  const solve = (root: THREE.Object3D, mid: THREE.Object3D | undefined, target: THREE.Vector3, l1: number, l2: number, sign: 1 | -1): void => {
    const t = target.clone().sub(root.position);
    const dist = THREE.MathUtils.clamp(t.length(), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.004);
    const inner = Math.acos(THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2), -1, 1));
    const bend = sign * (Math.PI - inner);
    const qy = -(l1 + l2 * Math.cos(bend));
    const qz = -l2 * Math.sin(bend);
    const c = Math.asin(THREE.MathUtils.clamp(-t.x / qy, -1, 1));
    const a = Math.atan2(t.z, t.y) - Math.atan2(qz, qy * Math.cos(c));
    root.rotation.set(a, 0, c);
    if (mid) mid.rotation.set(bend, 0, 0);
  };
  (['legL', 'legR'] as const).forEach((n, i) => {
    const leg = p.getObjectByName(n);
    if (!leg) return;
    const ankle = local(spec.feet[i]!).add(new THREE.Vector3(0, 0.095, 0));
    solve(leg, leg.getObjectByName('shin'), ankle, d.thigh, d.shin, 1);
    // Le pied reste à plat sur le cale-pied (pointe à peine baissée), quelle que soit l'inclinaison de la jambe
    const foot = leg.getObjectByName('foot');
    if (foot) foot.rotation.x = -(spec.lean + leg.rotation.x + (leg.getObjectByName('shin')?.rotation.x ?? 0)) + 0.1;
  });
  (['armL', 'armR'] as const).forEach((n, i) => {
    const arm = p.getObjectByName(n);
    if (!arm) return;
    if (!spec.hands) {
      arm.rotation.set(-0.3, 0, i === 0 ? 0.12 : -0.12);
      const f = arm.getObjectByName('forearm');
      if (f) f.rotation.set(-0.35, 0, 0);
      return;
    }
    solve(arm, arm.getObjectByName('forearm'), local(spec.hands[i]!), d.upper, d.fore, -1);
  });
}

/** Remet debout un personnage posé par `ridePose` (pivot à sa place, jambes et bras sans écart latéral). */
export function clearRidePose(p: THREE.Group): void {
  if (!p.userData.ridden) return;
  p.userData.ridden = false;
  const pivot = p.getObjectByName('ridePivot');
  if (pivot) {
    pivot.position.set(0, (pivot.userData.dims as RideDims).hipH, 0);
    pivot.rotation.set(0, 0, 0);
  }
  for (const n of ['legL', 'legR', 'armL', 'armR', 'foot']) p.getObjectByName(n)?.rotation.set(0, 0, 0);
}

/** Personnages réalistes (choisis dans les Réglages, par défaut) ou classiques ; le changement recharge le jeu. */
const realisticPeople = getSavedRealPeople();
export const isRealisticPeople = () => realisticPeople;
/** Personnage d'une apparence : même structure (legL, legR, shin, armL, armR, forearm) dans les deux versions. */
export function buildPerson(mats: Materials, look: PersonLook, accessories = false): THREE.Group {
  const g = realisticPeople ? buildRealPerson(mats, look) : buildClassicPerson(mats, look);
  // Accessoires (sac à dos, casque audio, montre) : seulement pour les passants, jamais sur le joueur ni ses interlocuteurs
  if (accessories) addModernAccessories(g, mats, look);
  return g;
}

/**
 * Accessoires d'aujourd'hui, répartis selon l'apparence (sans aléatoire) : sac à dos, casque audio, montre connectée.
 * Ils n'ont aucun effet sur les poses : le sac est collé au dos, le casque à la tête, la montre à l'avant-bras gauche.
 */
function addModernAccessories(g: THREE.Group, mats: Materials, look: PersonLook): void {
  const h = ((look.skin ^ (look.hair * 3) ^ (look.color * 7919) ^ (look.pants * 104729)) >>> 0) % 100;
  const mesh = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const m = new THREE.Mesh(geo, mats.color(color, 0.6));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  // Sac à dos (un sur cinq environ) : corps, poche et bretelles
  if (h < 20 && look.outfit !== 'boubou') {
    const c = [0x1f3a5f, 0x2b2f36, 0x7a1f2b, 0x2e6b4f][h % 4]!;
    mesh(new THREE.BoxGeometry(0.28, 0.36, 0.13), c, 0, 1.2, -0.17);
    mesh(new THREE.BoxGeometry(0.2, 0.14, 0.04), 0x15181d, 0, 1.12, -0.25);
    for (const x of [-0.1, 0.1]) mesh(new THREE.BoxGeometry(0.035, 0.3, 0.03), 0x15181d, x, 1.28, 0.13);
  }
  // Casque audio sans fil (un sur six environ) : arceau et deux coussinets
  if (h >= 20 && h < 36) {
    const c = h % 2 ? 0x20242b : 0xe8ebef;
    for (const x of [-0.145, 0.145]) mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.035, 14).rotateZ(Math.PI / 2), c, x, 1.74, -0.004);
    const band = mesh(new THREE.TorusGeometry(0.15, 0.011, 6, 18, Math.PI), c, 0, 1.74, -0.004);
    band.rotation.set(0, 0, 0);
    band.scale.set(1, 1.05, 1);
  }
  // Montre connectée (deux sur cinq environ) au poignet gauche
  if (h >= 50 && h < 90) {
    const fore = g.getObjectByName('armL')?.getObjectByName('forearm');
    if (fore) {
      mesh(new THREE.BoxGeometry(0.06, 0.03, 0.055), 0x15181d, 0, -0.2, 0.0, fore);
      mesh(new THREE.BoxGeometry(0.045, 0.004, 0.04), 0x4cc9f0, 0, -0.2, 0.0, fore).position.y = -0.184;
    }
  }
}
