// Commerce au port : prix du jour et montants (fonctions pures, entiers FCFA, taux en points de base).

/** Prix du jour : base ± variation (déterministe par marchandise, sens et jour de jeu). */
export function dayPrice(base: number, goodId: string, side: 'buy' | 'sell', day: number, swingBp: number): number {
  let h = 2166136261;
  for (const ch of `${goodId}|${side}|${day}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const r = (h >>> 0) % (2 * swingBp + 1); // 0 … 2·swing
  const bp = 10_000 - swingBp + r;
  // Arrondi à 25 FCFA (pièce la plus courante)
  return Math.max(25, Math.round((base * bp) / 10_000 / 25) * 25);
}

/** Taxe en FCFA (arrondie à l'unité supérieure) sur un montant entier. */
export function tax(amount: bigint, rateBp: number): bigint {
  return (amount * BigInt(rateBp) + 9_999n) / 10_000n;
}

/**
 * Cours de rachat à distance (vente depuis le téléphone, sans aller au lieu de revente) : le prix d'achat du jour
 * moins un écart. Acheter puis revendre aussitôt à distance fait donc toujours perdre l'écart ; on ne gagne qu'en
 * attendant un jour où le prix d'achat a assez monté. La grosse marge reste au bout du trajet.
 */
export function remoteSellPrice(buyToday: number, spreadBp: number): number {
  return Math.max(25, Math.floor((buyToday * (10_000 - spreadBp)) / 10_000 / 25) * 25);
}

const round25 = (n: number, mode: 'floor' | 'ceil' | 'round' = 'floor') => Math.max(25, Math[mode](n / 25) * 25);

/**
 * Prix de revente au lieu prévu, plafonné : jamais plus de `maxMarginBp` au-dessus du coût de revient du jour
 * (prix d'achat + droits de douane pour un import). La marge d'un trajet reste celle d'un commerçant, pas celle d'un jackpot.
 */
export function sellQuote(buyToday: number, sellToday: number, kind: 'IMPORT' | 'EXPORT' | 'LOCAL' | 'CAR', taxBp: number, maxMarginBp: number): number {
  const duty = kind === 'IMPORT' || kind === 'CAR' ? taxBp : 0;
  const landed = (buyToday * (10_000 + duty)) / 10_000;
  const cap = round25((landed * (10_000 + maxMarginBp)) / 10_000, 'floor');
  return Math.min(sellToday, cap);
}

/**
 * Prix d'un achat à distance (téléphone, sans être au lieu d'achat) : le prix d'achat du jour majoré de l'écart de commodité.
 * Acheter ainsi évite le premier trajet mais coûte un peu plus cher ; la revente, elle, se fait toujours sur place (le cours de
 * revente à distance est plus bas) : la grosse marge reste au bout du trajet de revente.
 */
export function remoteBuyPrice(buyToday: number, spreadBp: number): number {
  return round25((buyToday * (10_000 + spreadBp)) / 10_000, 'ceil');
}

/**
 * Quantité maximale vendable par jour de jeu et par marchandise (profondeur du marché) : elle varie chaque jour, entre `min`
 * et `max` unités, quelle que soit la marchandise. Tirage déterministe (marchandise, jour) : la même pour tous les joueurs.
 */
export function dailySellLimit(goodId: string, day: number, min = 5, max = 25): number {
  const lo = Math.max(1, Math.min(min, max));
  const hi = Math.max(lo, max);
  let h = 2166136261;
  for (const ch of `${goodId}|depth|${day}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return lo + ((h >>> 0) % (hi - lo + 1));
}
