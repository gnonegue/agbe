// Modèles 3D libres (Kenney, licence CC0 — voir public/models/*/LICENSE.txt), chargés une fois puis gardés en mémoire.
// Chaque modèle est réduit à ses « parties » (géométrie + matériau + position locale) pour être instancié en masse.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface ModelPart {
  geometry: THREE.BufferGeometry;
  /** Un matériau, ou plusieurs pour une géométrie cuite à groupes (véhicules dessinés en code). */
  material: THREE.Material | THREE.Material[];
  /** Teinte par instance appliquée à cette partie (par défaut oui ; non pour vitres, pneus, chromes). */
  tint?: boolean;
  /** Position de la partie dans le modèle (roues, carrosserie…). */
  matrix: THREE.Matrix4;
}
export interface Model {
  parts: ModelPart[];
  /** Dimensions du modèle à l'échelle 1. */
  size: THREE.Vector3;
  /** Décalage pour poser le modèle au sol et le centrer. */
  offset: THREE.Vector3;
}

export const BUILDINGS = 'abcdefghijklmn'.split('').map((l) => `city/building-${l}`);
/** Maisons de quartier (Kenney City Kit Suburban, CC0) : toits recolorés en tôle. */
export const HOUSES = 'abcdefghijklmnopqrstu'.split('').map((l) => `suburb/building-type-${l}`);
export const CARS = ['car/taxi', 'car/sedan', 'car/suv', 'car/van', 'car/truck', 'car/delivery', 'car/garbage-truck', 'car/ambulance'] as const;
export const DETAILS = ['city/detail-awning', 'city/detail-awning-wide', 'city/detail-parasol-a', 'city/detail-parasol-b'] as const;

const cache = new Map<string, Promise<Model>>();
const loader = new GLTFLoader();

function load(name: string): Promise<Model> {
  let p = cache.get(name);
  if (!p) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`).then((gltf) => {
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const parts: ModelPart[] = [];
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            const mat = m as THREE.MeshStandardMaterial;
            // Rendu plus mat et plus doux, cohérent avec le reste de la scène
            if ('roughness' in mat) mat.roughness = 0.85;
            if ('metalness' in mat) mat.metalness = 0;
            parts.push({ geometry: o.geometry, material: mat, matrix: o.matrixWorld.clone() });
          }
        }
      });
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      return { parts, size, offset: new THREE.Vector3(-center.x, -box.min.y, -center.z) };
    });
    cache.set(name, p);
    // Un échec (réseau) ne doit pas rester en cache : on réessaiera au prochain chargement de scène.
    p.catch(() => cache.delete(name));
  }
  return p;
}

/** Charge plusieurs modèles ; ceux qui échouent sont simplement absents du résultat. */
export async function loadModels(names: readonly string[]): Promise<Map<string, Model>> {
  const out = new Map<string, Model>();
  await Promise.all(
    names.map(async (n) => {
      try {
        out.set(n, await load(n));
      } catch {
        /* modèle indisponible : la scène garde sa version dessinée en code */
      }
    }),
  );
  return out;
}

/**
 * Ensemble d'instances d'un modèle : une InstancedMesh par partie.
 * `set(i, matrice)` place l'instance i ; les couleurs d'instance teintent la texture (murs peints).
 */
export class ModelInstances {
  readonly meshes: THREE.InstancedMesh[];
  private readonly tmp = new THREE.Matrix4();
  private readonly base: THREE.Matrix4[];
  private readonly tinted: boolean[];

  constructor(model: Model, count: number, scene: THREE.Scene, shadows: boolean) {
    const fix = new THREE.Matrix4().makeTranslation(model.offset.x, model.offset.y, model.offset.z);
    this.base = model.parts.map((p) => fix.clone().multiply(p.matrix));
    this.tinted = model.parts.map((p) => p.tint !== false);
    this.meshes = model.parts.map((p) => {
      const m = new THREE.InstancedMesh(p.geometry, p.material, Math.max(1, count));
      m.castShadow = shadows;
      m.receiveShadow = shadows;
      m.frustumCulled = false; // les instances couvrent toute la ville
      scene.add(m);
      return m;
    });
  }

  set(i: number, world: THREE.Matrix4): void {
    this.meshes.forEach((m, k) => m.setMatrixAt(i, this.tmp.multiplyMatrices(world, this.base[k]!)));
  }

  color(i: number, c: THREE.Color): void {
    this.meshes.forEach((m, k) => this.tinted[k] && m.setColorAt(i, c));
  }

  count(n: number): void {
    this.meshes.forEach((m) => (m.count = n));
  }

  commit(colors = false): void {
    this.meshes.forEach((m) => {
      m.instanceMatrix.needsUpdate = true;
      if (colors && m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }

  /** Instances regroupées par quartier : on active l'élimination hors champ (calcul de la sphère englobante). */
  cull(): void {
    this.meshes.forEach((m) => {
      m.computeBoundingSphere();
      m.frustumCulled = true;
    });
  }

  dispose(): void {
    this.meshes.forEach((m) => {
      m.removeFromParent();
      m.dispose();
    });
  }
}
