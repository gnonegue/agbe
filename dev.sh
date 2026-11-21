#!/usr/bin/env bash
# Lance l'API (back) et le jeu (front) en développement, en une seule commande.
# Ctrl+C arrête les deux.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ./dev.sh --lan : jeu accessible depuis les autres appareils du réseau local (téléphone, autre PC).
# L'API reste sur 127.0.0.1 : on y accède seulement à travers le proxy du jeu.
HOST=localhost
LAN_IP=""
if [ "${1:-}" = "--lan" ]; then
  LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [ -z "$LAN_IP" ]; then
    echo "Adresse du réseau local introuvable." >&2
    exit 1
  fi
  HOST=0.0.0.0
  # Autorise l'origine du réseau local en plus de celles de back/.env (sans modifier le fichier)
  BASE_ORIGINS="$(grep -E '^CORS_ORIGINS=' "$ROOT/back/.env" | cut -d= -f2- | tr -d '"' || true)"
  export CORS_ORIGINS="${BASE_ORIGINS:+$BASE_ORIGINS,}http://$LAN_IP:5173"
fi

if [ ! -f "$ROOT/back/.env" ]; then
  echo "back/.env manquant : copiez back/.env.example en back/.env et remplissez les secrets (voir README.md)." >&2
  exit 1
fi

for port in 3000 5173; do
  if curl -s -m 1 -o /dev/null "http://localhost:$port"; then
    echo "Le port $port est déjà utilisé : AGBE tourne peut-être déjà (fermez-le d'abord)." >&2
    exit 1
  fi
done

pids=()
cleanup() {
  echo
  echo "Arrêt d'AGBE…"
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "▶ Compilation de l'API…"
(cd "$ROOT/back" && npm run build --silent)

echo "▶ Démarrage de l'API (port 3000)…"
(cd "$ROOT/back" && exec node dist/main.js) 2>&1 | sed -u 's/^/[back]  /' &
pids+=($!)

echo "▶ Démarrage du jeu (port 5173)…"
(cd "$ROOT/front" && exec npx vite --host "$HOST" --port 5173) 2>&1 | sed -u 's/^/[front] /' &
pids+=($!)

for i in $(seq 1 60); do
  if curl -sf -m 1 -o /dev/null http://localhost:3000/api/health && curl -sf -m 1 -o /dev/null http://localhost:5173; then
    echo
    echo "✅ AGBE est prêt : ouvrez http://localhost:5173   (Ctrl+C pour arrêter)"
    [ -n "$LAN_IP" ] && echo "📱 Sur le réseau local : http://$LAN_IP:5173"
    echo
    break
  fi
  sleep 1
done

wait -n "${pids[@]}"
