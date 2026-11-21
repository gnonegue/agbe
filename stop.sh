#!/usr/bin/env bash
# Arrête l'API (back) et le jeu (front) lancés par ./dev.sh, même depuis un autre terminal.
# ./stop.sh --db : arrête aussi le conteneur PostgreSQL agbe_db.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Uniquement les commandes lancées par dev.sh, reconnues à leur ligne de commande exacte ET à leur dossier
# de travail : on ne touche ni à l'éditeur (serveurs TypeScript…) ni aux autres services des ports 3000/5173.
pids=()
add_if() { # add_if <dossier attendu> <motif de la ligne de commande>
  for pid in $(pgrep -f "$2" || true); do
    [ "$pid" = "$$" ] && continue
    [ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" = "$1" ] || continue
    # Exécutable réel : node, npm ou dev.sh (jamais un shell qui contiendrait le motif dans son texte)
    exe="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | awk '{print $1}')"
    case "$(basename "$exe")" in node|npm|bash) ;; *) continue ;; esac
    [ "$(basename "$exe")" = bash ] && ! grep -q "dev.sh" "/proc/$pid/cmdline" 2>/dev/null && continue
    pids+=("$pid")
  done
}
add_if "$ROOT/back" '^node dist/main\.js'
add_if "$ROOT/front" 'node_modules/\.bin/vite'
add_if "$ROOT/front" '^npm exec vite'
add_if "$ROOT" '(^|/)dev\.sh'

if [ ${#pids[@]} -eq 0 ]; then
  echo "AGBE ne tourne pas."
else
  echo "■ Arrêt d'AGBE (${#pids[@]} processus)…"
  kill "${pids[@]}" 2>/dev/null || true
  for _ in $(seq 1 10); do
    alive=()
    for pid in "${pids[@]}"; do kill -0 "$pid" 2>/dev/null && alive+=("$pid"); done
    [ ${#alive[@]} -eq 0 ] && break
    sleep 0.5
  done
  # Récalcitrants : arrêt forcé
  [ ${#alive[@]} -gt 0 ] && kill -9 "${alive[@]}" 2>/dev/null || true
fi

if [ "${1:-}" = "--db" ]; then
  echo "■ Arrêt de la base agbe_db…"
  docker stop agbe_db >/dev/null && echo "  base arrêtée"
fi

for port in 3000 5173; do
  if curl -s -m 1 -o /dev/null "http://localhost:$port"; then
    echo "⚠ Le port $port répond encore (autre service ?)."
  fi
done
echo "✅ AGBE est arrêté."
