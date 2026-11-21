import { describe, expect, it } from 'vitest';
import { accruedYield, cellCenter, feeBp, landPrice, nextStep, pricePerM2At, quarterCount, stepFee, quartersConnected, type LandPriceModel } from './land';
import { SETTING_DEFAULTS, SETTING_SCHEMAS } from '../settings/settings.service';

const model: LandPriceModel = {
  hubX: 20, hubZ: -50, centerPerM2: 30_000, edgePerM2: 1_200, halfDistance: 150,
  roads: [{ axis: 'x', at: 0 }], roadBonusBp: 3_000, roadRange: 40, seaZ: 36, seaBonusBp: 4_000, seaRange: 60,
};

describe('foncier : prix du m² selon la position', () => {
  it('plus cher au centre, plus on s’éloigne moins cher, jamais sous le plancher', () => {
    const centre = pricePerM2At(model, 20, -50).perM2;
    const proche = pricePerM2At(model, 120, -250).perM2;
    const loin = pricePerM2At(model, 600, -900).perM2;
    expect(centre > proche).toBe(true);
    expect(proche > loin).toBe(true);
    expect(loin >= 1_200n).toBe(true);
  });

  it('bordure de route et littoral majorent le prix', () => {
    const sansRoute = pricePerM2At(model, 100, -300);
    const surRoute = pricePerM2At(model, 2, -300);
    expect(sansRoute.roadBp).toBe(0);
    expect(surRoute.roadBp).toBeGreaterThan(0);
    expect(surRoute.perM2 > sansRoute.perM2).toBe(true);
    const mer = pricePerM2At(model, 200, 30);
    expect(mer.seaBp).toBeGreaterThan(0);
  });

  it('coefficient de zone et arrondi à la dizaine', () => {
    const a = pricePerM2At(model, 200, -300, 10_000).perM2;
    const b = pricePerM2At(model, 200, -300, 20_000).perM2;
    expect(b >= a * 2n - 10n && b <= a * 2n + 10n).toBe(true);
    expect(a % 10n).toBe(0n);
  });

  it('prix d’un quart, d’un demi-lot et d’un lot : 150, 300 et 600 m²', () => {
    const p = 5_000n;
    expect(landPrice(p, 1, 150)).toBe(750_000n);
    expect(landPrice(p, 2, 150)).toBe(1_500_000n);
    expect(landPrice(p, 4, 150)).toBe(3_000_000n);
  });

  it('centre d’une cellule, quarts, frais et démarches', () => {
    expect(cellCenter({ originX: 100, originZ: -200, cols: 4, cell: 10 }, 5)).toEqual({ x: 115, z: -185 });
    expect(quarterCount(0b1011)).toBe(3);
    expect(feeBp(1_000_000n, 250)).toBe(25_000n);
    expect(stepFee({ feePerM2: 10, minFee: 50_000 }, 150)).toBe(50_000n);
    expect(stepFee({ feePerM2: 10, minFee: 50_000 }, 600)).toBe(50_000n);
    expect(stepFee({ feePerM2: 100, minFee: 50_000 }, 600)).toBe(60_000n);
    expect(nextStep('BOUGHT')).toBe('SURVEYED');
    expect(nextStep('SURVEYED')).toBe('OPINION');
    expect(nextStep('OPINION')).toBe('TITLED');
    expect(nextStep('TITLED')).toBeNull();
  });

  it('rendement d’une exploitation : jours entiers, plafonné à la durée de vie', () => {
    expect(accruedYield(1_000_000n, 70, 10.9, 300)).toBe(70_000n);
    expect(accruedYield(1_000_000n, 70, 1_000, 300)).toBe(2_100_000n);
    expect(accruedYield(1_000_000n, 70, -4, 300)).toBe(0n);
  });
});

describe('plan des zones de terrain', () => {
  const rect = (z: (typeof SETTING_DEFAULTS.land.zones)[number]) => {
    const m = z.margin ?? 6;
    return { x0: z.originX - m, x1: z.originX + z.cols * z.cell + m, z0: z.originZ - m, z1: z.originZ + z.rows * z.cell + m };
  };
  const zones = SETTING_DEFAULTS.land.zones;

  it('une zone, extension comprise, ne recouvre jamais une autre zone', () => {
    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) {
        const a = rect(zones[i]!);
        const b = rect(zones[j]!);
        const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
        expect(overlap, `${zones[i]!.id} / ${zones[j]!.id}`).toBe(false);
      }
    }
  });

  it('aucune zone ne recouvre la maison d’un joueur ni sa cour', () => {
    // Cour : 14 m autour de chaque position de logement par défaut
    for (const [kind, h] of Object.entries(SETTING_DEFAULTS['home.position'])) {
      for (const z of zones) {
        const r = rect(z);
        const hit = h.x > r.x0 - 14 && h.x < r.x1 + 14 && h.z > r.z0 - 14 && h.z < r.z1 + 14;
        expect(hit, `${z.id} / ${kind}`).toBe(false);
      }
    }
  });

  it('le réglage foncier par défaut respecte son schéma (un identifiant invalide ferait disparaître toutes les zones)', () => {
    const r = SETTING_SCHEMAS.land.safeParse(SETTING_DEFAULTS.land);
    expect(r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)).toEqual([]);
  });

  it('les identifiants de zone sont uniques', () => {
    expect(new Set(zones.map((z) => z.id)).size).toBe(zones.length);
  });

  it('les zones en mer ne recouvrent pas la grille de cases de publicité et valent au moins le double du plus cher à terre', () => {
    const ad = SETTING_DEFAULTS['sea.plots'];
    const adRect = { x0: ad.originX, x1: ad.originX + ad.cols * ad.cell, z0: ad.originZ, z1: ad.originZ + ad.rows * ad.cell };
    const p = SETTING_DEFAULTS.land.price;
    // Plus cher à terre : centre-ville, en bordure de route et de littoral, zone au coefficient maximal
    const maxTier = Math.max(...zones.filter((z) => !z.water).map((z) => z.tierBp));
    const dearest = Number(pricePerM2At(p, p.hubX, p.roads[0]!.at, maxTier).perM2);
    const sea = zones.filter((z) => z.water);
    expect(sea.length).toBeGreaterThan(0);
    for (const z of sea) {
      const r = rect(z);
      expect(r.x0 < adRect.x1 && adRect.x0 < r.x1 && r.z0 < adRect.z1 && adRect.z0 < r.z1, z.id).toBe(false);
      expect(z.fixedPerM2 ?? 0, z.id).toBeGreaterThanOrEqual(dearest * 2);
    }
  });

  it('toutes les zones, extension comprise, tiennent sur le sol de la carte', () => {
    for (const z of zones) {
      const r = rect(z);
      expect(r.x0, z.id).toBeGreaterThanOrEqual(z.water ? -400 : -300);
      expect(r.x1, z.id).toBeLessThanOrEqual(260);
      expect(r.z0, z.id).toBeGreaterThanOrEqual(-1110);
      // À terre : jusqu'au rivage ; en mer : dans l'eau (mer dessinée jusqu'à z = 335)
      expect(r.z1, z.id).toBeLessThanOrEqual(z.water ? 330 : 36);
      expect(z.startRows ?? z.rows, z.id).toBeLessThanOrEqual(z.rows);
    }
  });
});

describe('quartersConnected : un seul terrain d’un tenant', () => {
  const lot = (cell: number) => [0, 1, 2, 3].map((q) => ({ cell, q }));
  it('deux lots entiers côte à côte, ou l’un au-dessus de l’autre : oui', () => {
    expect(quartersConnected(18, [...lot(64), ...lot(65)])).toBe(true);
    expect(quartersConnected(18, [...lot(46), ...lot(64)])).toBe(true);
  });
  it('deux lots séparés par un lot : non', () => {
    expect(quartersConnected(18, [...lot(64), ...lot(66)])).toBe(false);
  });
  it('lots qui ne se touchent que par un coin : non', () => {
    expect(quartersConnected(18, [...lot(46), ...lot(65)])).toBe(false);
  });
  it('fin de rangée et début de la suivante ne sont pas voisins', () => {
    expect(quartersConnected(18, [...lot(17), ...lot(18)])).toBe(false);
  });
  it('lots voisins mais quarts éloignés (gauche du premier, droite du second) : non', () => {
    expect(quartersConnected(18, [{ cell: 64, q: 0 }, { cell: 65, q: 1 }])).toBe(false);
  });
  it('quarts qui se touchent à la frontière des deux lots : oui', () => {
    expect(quartersConnected(18, [{ cell: 64, q: 1 }, { cell: 65, q: 0 }])).toBe(true);
    expect(quartersConnected(18, [{ cell: 64, q: 0 }, { cell: 64, q: 1 }, { cell: 65, q: 0 }, { cell: 65, q: 2 }])).toBe(true);
  });
});
