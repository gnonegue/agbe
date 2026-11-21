// Exécuté avant React. index.html contient la page publique pré-rendue (visiteurs, moteurs de recherche, aperçus
// de liens) : un joueur déjà connecté, ou une adresse qui n'est pas l'accueil (/admin, /init, retour de paiement…),
// voit à la place l'écran de démarrage, sans apercevoir l'accueil.
(function () {
  var path = location.pathname.replace(/\/+$/, '');
  // Pages publiques pré-rendues : accueil et « Comment jouer », dans les deux langues
  var pages = ['', '/en', '/comment-jouer', '/en/how-to-play'];
  var home = pages.indexOf(path) >= 0 && !location.search;
  // Conditions d'utilisation, annonces et contact : toujours affichés, même pour un joueur connecté
  var terms = ['/conditions', '/en/terms', '/annonces', '/en/ads', '/contact', '/en/contact'].indexOf(path) >= 0;
  var known = false;
  var site = false;
  try {
    known = localStorage.getItem('agbe.hadSession') === '1';
    site = sessionStorage.getItem('agbe.site') === '1';
  } catch (e) {
    /* stockage indisponible : visiteur */
  }
  // Un joueur connecté revenu sur le site depuis le jeu (Réglages) voit les pages publiques comme un visiteur
  if (!terms && ((known && !site) || !home)) document.documentElement.classList.add('app-boot');
})();
