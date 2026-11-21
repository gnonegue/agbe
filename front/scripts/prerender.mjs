// Après `vite build` : écrit les pages publiques pré-rendues, dans chaque langue (accueil, « Comment jouer »,
// conditions d'utilisation, annonces, contact), en dist/<adresse>/index.html.
// Les moteurs de recherche et les aperçus de liens (WhatsApp, Facebook…) lisent ainsi le contenu sans exécuter le JS ;
// React remplace ensuite ce HTML au démarrage.
// Domaine (URL canonique, Open Graph, sitemap) :
//  - AGBE_SITE_URL=https://mon-domaine au build (hébergement mutualisé, Apache) : écrit dans les pages, et
//    dist/sitemap.xml + dist/robots.txt sont générés ;
//  - sinon (Docker) : __AGBE_ORIGIN__ reste dans les pages et nginx le remplace (voir nginx/agbe.conf.template).
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}node_modules/.prerender`;
await build({
  root,
  configFile: false,
  logLevel: 'warn',
  plugins: [react()],
  build: { ssr: 'src/prerender.tsx', outDir: out, emptyOutDir: true, copyPublicDir: false },
});

// Le code de l'appli lit quelques API du navigateur au chargement : on les simule (visiteur, sans stockage).
const noop = () => undefined;
globalThis.window = globalThis;
globalThis.document = { documentElement: {} };
globalThis.location = { pathname: '/', search: '' };
globalThis.addEventListener = noop;
globalThis.matchMedia = () => ({ matches: false });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: noop, removeItem: noop } });

const { render } = await import(pathToFileURL(`${out}/prerender.js`).href);
const SITE = (process.env.AGBE_SITE_URL ?? '').trim().replace(/\/+$/, '');
if (SITE && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(SITE)) throw new Error(`AGBE_SITE_URL invalide (https://domaine attendu) : ${SITE}`);
const ORIGIN = SITE || '__AGBE_ORIGIN__';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const template = readFileSync(`${root}dist/index.html`, 'utf8');

// Adresses de chaque page publique (mêmes valeurs que src/lib/pages.ts)
const PAGES = [
  { page: 'home', seo: 'landing.seo', paths: { fr: '/', en: '/en' } },
  { page: 'howto', seo: 'howto.seo', paths: { fr: '/comment-jouer', en: '/en/how-to-play' } },
  { page: 'terms', seo: 'terms.seo', paths: { fr: '/conditions', en: '/en/terms' } },
  { page: 'ads', seo: 'siteAds.seo', paths: { fr: '/annonces', en: '/en/ads' } },
  { page: 'contact', seo: 'contact.seo', paths: { fr: '/contact', en: '/en/contact' } },
];

for (const { page, seo, paths } of PAGES) for (const lang of ['fr', 'en']) {
  const { html, t } = await render(lang, page);
  const path = paths[lang];
  const title = t(`${seo}.title`);
  const description = t(`${seo}.description`);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: 'AGBE',
    alternateName: t('app.tagline'),
    description,
    url: `${ORIGIN}${path}`,
    image: `${ORIGIN}/og-image.jpg`,
    inLanguage: ['fr', 'en'],
    genre: ['Life simulation', 'Business simulation'],
    gamePlatform: ['Web browser', 'Android', 'iOS', 'PC'],
    applicationCategory: 'Game',
    operatingSystem: 'Any',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'XOF' },
    countryOfOrigin: { '@type': 'Country', name: 'Togo' },
  };
  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${ORIGIN}${path}" />`,
    `<link rel="alternate" hreflang="fr" href="${ORIGIN}${paths.fr}" />`,
    `<link rel="alternate" hreflang="en" href="${ORIGIN}${paths.en}" />`,
    `<link rel="alternate" hreflang="x-default" href="${ORIGIN}${paths.fr}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="AGBE" />`,
    `<meta property="og:locale" content="${lang === 'en' ? 'en_US' : 'fr_FR'}" />`,
    `<meta property="og:locale:alternate" content="${lang === 'en' ? 'fr_FR' : 'en_US'}" />`,
    `<meta property="og:url" content="${ORIGIN}${path}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:image" content="${ORIGIN}/og-image.jpg" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(title)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    // Données structurées (accueil) : non exécutées, donc compatibles avec la CSP (script-src 'self')
    ...(page === 'home' ? [`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`] : []),
  ].join('\n    ');
  const boot = `<div class="splash boot-splash"><div class="logo">AGBE</div><p class="muted">${esc(t('app.loading'))}</p></div>`;
  const doc = template
    .replace(/<html lang="[a-z]+">/, `<html lang="${lang}">`)
    .replace(/<title>[^<]*<\/title>\s*<meta name="description"[^>]*>/, head)
    .replace(/<!--app-->[\s\S]*<!--\/app-->/, boot + html.replace('<div class="screen landing', '<div data-prerendered="" class="screen landing'));
  if (doc === template || !doc.includes('data-prerendered')) throw new Error(`pré-rendu non injecté (${page}, ${lang})`);
  const file = `${root}dist${path === '/' ? '' : path}/index.html`;
  mkdirSync(file.replace(/\/[^/]+$/, ''), { recursive: true });
  writeFileSync(file, doc);
  console.log(`pré-rendu ${page} ${lang} → ${file.slice(root.length)}`);
}

// Domaine connu au build : plan du site et robots.txt (avec Docker, nginx les sert lui-même)
if (SITE) {
  const alt = (paths) => ['fr', 'en'].map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${SITE}${paths[l]}"/>`).join('');
  const urls = PAGES.flatMap(({ paths }) => ['fr', 'en'].map((l) => `<url><loc>${SITE}${paths[l]}</loc>${alt(paths)}</url>`));
  writeFileSync(`${root}dist/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);
  writeFileSync(`${root}dist/robots.txt`, `${readFileSync(`${root}public/robots.txt`, 'utf8').trimEnd()}\nSitemap: ${SITE}/sitemap.xml\n`);
  console.log(`domaine ${SITE} : sitemap.xml et robots.txt écrits`);
} else {
  console.log('AGBE_SITE_URL non défini : le domaine sera écrit par nginx (déploiement Docker)');
}
rmSync(out, { recursive: true, force: true });
