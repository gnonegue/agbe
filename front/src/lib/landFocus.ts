// Lot touché sur la carte : l'appli Foncier s'ouvre sur cette zone et ce lot (consommé une seule fois).
export interface LandFocus {
  zoneId: string;
  cell?: number;
}
let pending: LandFocus | null = null;
export const setLandFocus = (f: LandFocus): void => {
  pending = f;
};
export const takeLandFocus = (): LandFocus | null => {
  const f = pending;
  pending = null;
  return f;
};
