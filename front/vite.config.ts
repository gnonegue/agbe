import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

/** En-têtes de sécurité de la production (snippet nginx), repris par `vite preview` pour tester la note à travers un tunnel. */
const prodHeaders = Object.fromEntries(
  [...readFileSync(new URL('./nginx/snippets/agbe-security-headers.conf', import.meta.url), 'utf8').matchAll(/^add_header (\S+) "(.*)" always;$/gm)].map((m) => [m[1]!, m[2]!]),
);

/** Identifiant de ce build : comparé à `/version.json` par l'appli pour savoir qu'une nouvelle version est en ligne. */
const BUILD_ID = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;

// Aucune variable secrète ici : tout ce qui est dans le front est public.
export default defineConfig({
  define: { __AGBE_BUILD__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    {
      // Publie /version.json (hors précache du service worker, jamais mis en cache) : voir src/lib/pwaUpdate.ts
      name: 'agbe-version',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
      },
    },
    {
      // Derrière un tunnel HTTPS : une requête arrivée en HTTP est redirigée en HTTPS, comme le fait nginx en production
      name: 'agbe-https-redirect',
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.headers['x-forwarded-proto'] !== 'http' || !req.headers.host) return next();
          res.statusCode = 301;
          res.setHeader('Location', `https://${req.headers.host}${req.url ?? '/'}`);
          res.end();
        });
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script', // fichier registerSW.js externe : aucun script inline (CSP stricte)
      // Icônes : seulement les petites dans le précache (les grandes du manifeste sont lues par le navigateur à l'installation)
      includeAssets: ['icon.svg', 'icon-180.png'],
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'AGBE — La vie au Togo',
        short_name: 'AGBE',
        description: 'Simulation de vie à Lomé : travaille (zém Gozem, livraison…), prie, étudie, investis et fais grandir ta vie.',
        categories: ['games', 'simulation', 'lifestyle'],
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#006a4e',
        background_color: '#ffffff',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        // Uniquement les ressources statiques du build.
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        // Écrans que les joueurs n'ouvrent pas (administration, réservation de pub, initialisation, 2FA) : chargés à la
        // demande seulement. Le précache (téléchargé avant chaque mise à jour) reste ainsi léger en 3G.
        globIgnores: ['**/AdminScreen-*.js', '**/BookAdScreen-*.js', '**/InitScreen-*.js', '**/TotpSetup-*.js', '**/MockPay-*.js', '**/sitemap*', '**/robots*'],
        navigateFallback: '/index.html',
        // L'API n'est JAMAIS servie par le service worker (ni cache, ni fallback).
        navigateFallbackDenylist: [/^\/api\//],
        // Modèles 3D (≈ 4 Mo) : téléchargés à la première partie, puis servis depuis le cache (hors ligne, 3G).
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/models/'),
            handler: 'CacheFirst',
            options: { cacheName: 'agbe-models-v1', expiration: { maxEntries: 80 }, cacheableResponse: { statuses: [200] } },
          },
        ],
        cleanupOutdatedCaches: true,
        // Nouvelle version active immédiatement (évite de servir d'anciens chunks introuvables)
        skipWaiting: true,
        clientsClaim: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Tunnels de test (cloudflared "quick tunnel") : le sous-domaine change à chaque lancement.
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    headers: prodHeaders,
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
  build: {
    sourcemap: false,
    target: 'es2020',
    assetsInlineLimit: 0, // aucune ressource en data: inutile
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          if (id.includes('node_modules/i18next') || id.includes('node_modules/react-i18next')) return 'i18n';
          return undefined;
        },
      },
    },
  },
});
