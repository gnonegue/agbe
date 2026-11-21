// Le tableau de bord s'ouvre comme une page web : /admin (ou l'ancien #admin)
export const wantsAdmin = () => window.location.pathname.replace(/\/+$/, '') === '/admin' || window.location.hash === '#admin';
/** Va vers /admin ou revient au jeu sans recharger la page. */
export function goAdmin(on: boolean) {
  window.history.pushState(null, '', on ? '/admin' : '/');
  window.dispatchEvent(new PopStateEvent('popstate'));
}
