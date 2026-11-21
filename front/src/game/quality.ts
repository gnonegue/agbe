import type { Quality } from '../lib/prefs';

export interface QualityProfile {
  pixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  pointLights: number;
  zems: number;
  maxFps: number;
  standardMaterials: boolean;
  trees: number;
}

export const PROFILES: Record<Quality, QualityProfile> = {
  low: { pixelRatio: 1, antialias: false, shadows: false, shadowMapSize: 0, pointLights: 0, zems: 6, maxFps: 30, standardMaterials: false, trees: 18 },
  medium: { pixelRatio: 1.25, antialias: false, shadows: true, shadowMapSize: 1024, pointLights: 2, zems: 12, maxFps: 60, standardMaterials: false, trees: 30 },
  high: { pixelRatio: 2, antialias: true, shadows: true, shadowMapSize: 2048, pointLights: 4, zems: 20, maxFps: 60, standardMaterials: true, trees: 44 },
};

/** Choix automatique selon la mémoire, le nombre de cœurs et la densité de pixels. */
export function detectQuality(): Quality {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : 4;
  const cores = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 4;
  const dpr = window.devicePixelRatio || 1;
  const small = Math.min(window.screen?.width ?? 1000, window.screen?.height ?? 1000) < 500;
  if (mem <= 2 || cores <= 4) return 'low';
  if (mem >= 8 && cores >= 8 && !(small && dpr > 2.5)) return 'high';
  return 'medium';
}

export function pixelRatioFor(q: Quality): number {
  return Math.min(window.devicePixelRatio || 1, PROFILES[q].pixelRatio);
}
