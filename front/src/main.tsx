import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { i18nReady } from './i18n';
import './lib/install';
import './styles.css';
import App from './App';
import UpdateBanner from './ui/UpdateBanner';
import { watchUpdates } from './lib/pwaUpdate';

// Après un déploiement, un ancien onglet peut demander un chunk qui n'existe plus : on recharge.
// Un seul rechargement par minute : si le chunk manque encore, on ne boucle pas.
window.addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('agbe-chunk-reload') ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem('agbe-chunk-reload', String(Date.now()));
  } catch {
    /* stockage indisponible : on recharge quand même une fois */
  }
  e.preventDefault();
  window.location.reload();
});

// Mises à jour de l'appli installée : recherche régulière et bandeau (voir lib/pwaUpdate.ts)
watchUpdates();

// Premier rendu dès que les textes de la langue du joueur sont là (l'écran de démarrage s'affiche en attendant)
void i18nReady.finally(() => {
  const bannerRoot = document.createElement('div');
  document.body.appendChild(bannerRoot);
  createRoot(bannerRoot).render(<UpdateBanner />);

  const root = document.getElementById('root');
  if (root) {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  }
});
