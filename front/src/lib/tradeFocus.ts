// Article du Commerce mis en avant : choisi depuis une « bonne affaire » ou avant un trajet vers le lieu d'achat /
// de revente. À l'arrivée sur ce lieu, l'appli Commerce s'ouvre d'elle-même sur cet article.
let focus: { goodId: string; at: string | null } | null = null;

export function setTradeFocus(goodId: string, at: string | null = null): void {
  focus = { goodId, at };
}
/** Article à mettre en avant (lu à l'ouverture de l'appli Commerce). */
export function tradeFocusGood(): string | null {
  return focus?.goodId ?? null;
}
/** Vrai une seule fois, en arrivant au lieu attendu : l'écran de jeu ouvre alors l'appli Commerce. */
export function takeTradeArrival(location: string): boolean {
  if (!focus?.at || focus.at !== location) return false;
  focus = { goodId: focus.goodId, at: null };
  return true;
}
