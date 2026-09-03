#!/usr/bin/env bash
# DeskOS - Remote-PC-Agent starten (Linux / Raspberry Pi).
#
# Prueft Node.js und startet den Agent-Launcher, der fehlende Abhaengigkeiten
# selbst nachinstalliert. Beenden mit Strg+C.

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../apps/agent" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "[descos-agent] Node.js fehlt — bitte Node 18+ installieren (z. B. via nodesource oder nvm)." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt 18 ]; then
  echo "[descos-agent] Node.js ${NODE_MAJOR} ist zu alt — der Agent benoetigt Node 18 oder neuer." >&2
  exit 1
fi

echo "[descos-agent] Starte Agent aus ${AGENT_DIR}"
echo "[descos-agent] Backend-URL / Agent-Name stehen in ${AGENT_DIR}/.env"
cd "${AGENT_DIR}"
exec npm run dev
