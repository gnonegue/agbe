/** Frais de transfert, calculés exactement comme le serveur (arrondi demi vers le haut, bornes min/max). */
export function transferFee(amount: number, cfg: { rateBp: number; min: number; max: number }): number {
  const raw = (BigInt(amount) * BigInt(cfg.rateBp) + 5000n) / 10000n;
  let fee = Number(raw);
  if (fee < cfg.min) fee = cfg.min;
  if (fee > cfg.max) fee = cfg.max;
  return fee;
}
