// Test de charge du temps réel : N joueurs invités, chacun avec son flux SSE et sa position toutes les 1,5 s.
//
//   node loadtest/live-load.mjs --url http://localhost:3000/api --players 500 --duration 60
//
// À lancer UNIQUEMENT contre un serveur de test avec une base jetable (il crée N comptes invités + personnages).
// Chaque joueur simulé présente une fausse IP via X-Forwarded-For (TRUST_PROXY_HOPS=1 requis côté serveur),
// sinon les limites par IP des routes d'inscription bloqueraient le test dès le 4e joueur.
// Sortie : latence des envois de position, intervalle entre deux mises à jour de présence reçues, erreurs.

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const URL_BASE = arg('url', 'http://localhost:3000/api').replace(/\/$/, '');
const PLAYERS = Number(arg('players', '200'));
const DURATION_S = Number(arg('duration', '60'));
const RAMP_PER_S = Number(arg('ramp', '25')); // créations de comptes par seconde (argon2 est coûteux côté serveur)
const ORIGIN = arg('origin', 'http://localhost:5173'); // doit figurer dans CORS_ORIGINS du serveur testé
const POS_EVERY_MS = 1500;

const stats = { posOk: 0, posErr: new Map(), posMs: [], presenceGaps: [], streams: 0, streamErr: 0, setupErr: 0, events: 0 };
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const RUN = Math.floor(Math.random() * 200) + 1; // plage d'IP propre à chaque lancement (quota de création par IP)
const ip = (n) => `${RUN}.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((a.length * p) / 100))] : 0);

async function api(path, body, token, n) {
  const res = await fetch(`${URL_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-agbe-csrf': '1', 'x-forwarded-for': ip(n), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return res;
}

async function setup(n) {
  const g = await api('/auth/guest', { birthDate: '1995-01-01', acceptTerms: true, locale: 'fr' }, null, n);
  if (!g.ok) throw new Error(`guest ${g.status}`);
  const { accessToken } = await g.json();
  const c = await api('/character', { name: `Test ${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(97 + ((n >> 5) % 26))}`, profile: 'LOCAL', region: 'MARITIME', mode: 'FREE_CHOICE', condition: 'MIDDLE' }, accessToken, n);
  if (!c.ok) throw new Error(`character ${c.status}`);
  return accessToken;
}

async function openStream(n, token, signal) {
  const res = await fetch(`${URL_BASE}/live/stream`, { headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream', origin: ORIGIN, 'x-forwarded-for': ip(n) }, signal });
  if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
  stats.streams++;
  let last = 0;
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (frame.includes('event: presence')) {
        stats.events++;
        const now = Date.now();
        if (last) stats.presenceGaps.push(now - last);
        last = now;
      }
    }
  }
}

async function player(n, endAt, signal) {
  let token;
  try {
    token = await setup(n);
  } catch (e) {
    stats.setupErr++;
    if (stats.setupErr === 1) console.log(`Premier échec de création (joueur ${n}) : ${e.message}`);
    return;
  }
  openStream(n, token, signal).catch((e) => {
    if (!signal.aborted) stats.streamErr++;
  });
  // Les joueurs se répartissent sur une zone de 200 m, comme dans une ville réelle
  let x = (n * 37) % 200, z = (n * 91) % 200;
  await sleep(Math.random() * POS_EVERY_MS);
  while (Date.now() < endAt && !signal.aborted) {
    x += (Math.random() - 0.5) * 3;
    z += (Math.random() - 0.5) * 3;
    const t0 = performance.now();
    try {
      const r = await api('/live/pos', { x, z, yaw: Math.random() * 6 }, token, n);
      if (r.ok) {
        stats.posOk++;
        stats.posMs.push(performance.now() - t0);
      } else bump(stats.posErr, r.status);
      await r.arrayBuffer();
    } catch (e) {
      bump(stats.posErr, 'net');
    }
    await sleep(POS_EVERY_MS);
  }
}

const ac = new AbortController();
const startedAt = Date.now();
console.log(`Chargement : ${PLAYERS} joueurs, ${DURATION_S}s de jeu, ${URL_BASE}`);
const tasks = [];
const endAt = startedAt + (PLAYERS / RAMP_PER_S + DURATION_S) * 1000;
for (let n = 1; n <= PLAYERS; n++) {
  tasks.push(player(n, endAt, ac.signal));
  if (n % RAMP_PER_S === 0) await sleep(1000);
}
const report = setInterval(() => {
  const ms = stats.posMs.splice(0);
  const gaps = stats.presenceGaps.splice(0);
  console.log(`[${Math.round((Date.now() - startedAt) / 1000)}s] flux=${stats.streams} pos ok=${stats.posOk} p50=${pct(ms, 50).toFixed(0)}ms p95=${pct(ms, 95).toFixed(0)}ms p99=${pct(ms, 99).toFixed(0)}ms | présence: écart p50=${pct(gaps, 50)}ms p95=${pct(gaps, 95)}ms (attendu ≈2000) | erreurs pos=${JSON.stringify([...stats.posErr])} flux=${stats.streamErr} setup=${stats.setupErr}`);
}, 5000);
await Promise.all(tasks);
clearInterval(report);
ac.abort();
console.log(`Terminé. positions ok=${stats.posOk}, erreurs=${JSON.stringify([...stats.posErr])}, flux ouverts=${stats.streams}/${PLAYERS}, échecs flux=${stats.streamErr}, échecs création=${stats.setupErr}`);
process.exit(0);
