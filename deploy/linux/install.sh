#!/usr/bin/env bash
# DeskOS - Linux installer
# Sets up systemd autostart for the backend + frontend and a Chromium kiosk
# autostart entry. Designed for Raspberry Pi OS / Debian / Ubuntu.
#
# Usage:  sudo ./deploy/linux/install.sh

set -euo pipefail

# --- Resolve paths ---------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"   # deploy/linux -> repo root
SYSTEMD_DIR="${SCRIPT_DIR}/systemd"

# --- Must be root for the systemd part -------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  echo "Please run with sudo:  sudo ./deploy/linux/install.sh" >&2
  exit 1
fi

# --- Target user (the human, not root) -------------------------------------
TARGET_USER="${SUDO_USER:-$(logname 2>/dev/null || echo "${USER:-root}")}"
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
if [ -z "$TARGET_HOME" ]; then
  echo "ERROR: could not determine home directory for user '${TARGET_USER}'." >&2
  exit 1
fi
echo "==> Installing DeskOS autostart for user: ${TARGET_USER}"
echo "==> Repo directory:                       ${REPO_DIR}"

# --- Detect node / npm (resolve as the target user so nvm is found too) ----
NPM_BIN="$(sudo -u "$TARGET_USER" bash -lc 'command -v npm' 2>/dev/null || true)"
NODE_BIN="$(sudo -u "$TARGET_USER" bash -lc 'command -v node' 2>/dev/null || true)"
if [ -z "$NPM_BIN" ] || [ -z "$NODE_BIN" ]; then
  echo "ERROR: node/npm not found for user '${TARGET_USER}'. Install Node.js 18+ first." >&2
  exit 1
fi
NODE_DIR="$(dirname "$NODE_BIN")"
echo "==> Using npm:  ${NPM_BIN}"
echo "==> Using node: ${NODE_BIN}"

# --- Ensure env files exist ------------------------------------------------
sudo -u "$TARGET_USER" bash -lc "cd '${REPO_DIR}' && \
  { [ -f .env ] || cp .env.example .env; } && \
  { [ -f apps/backend/.env ]  || cp apps/backend/.env.example apps/backend/.env; } && \
  { [ -f apps/frontend/.env.local ] || touch apps/frontend/.env.local; } && \
  { [ ! -f apps/agent/.env.example ] || [ -f apps/agent/.env ] || cp apps/agent/.env.example apps/agent/.env; }"

# --- Load central port configuration (root .env) ---------------------------
if [ -f "${REPO_DIR}/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "${REPO_DIR}/.env"; set +a
fi
FRONTEND_PORT="${FRONTEND_PORT:-4000}"
BACKEND_PORT="${BACKEND_PORT:-4001}"
echo "==> Ports:                                frontend :${FRONTEND_PORT}, backend :${BACKEND_PORT}"

# --- Build if needed -------------------------------------------------------
if [ ! -d "${REPO_DIR}/apps/backend/dist" ] || [ ! -d "${REPO_DIR}/apps/frontend/.next" ]; then
  echo "==> No production build found - building now (npm install && npm run build)..."
  sudo -u "$TARGET_USER" bash -lc "cd '${REPO_DIR}' && npm install && NEXT_PUBLIC_BACKEND_PORT='${BACKEND_PORT}' npm run build"
else
  echo "==> Existing build found (skipping). Re-run with a fresh build after code"
  echo "    or port changes:  NEXT_PUBLIC_BACKEND_PORT=${BACKEND_PORT} npm run build"
fi

# --- Install systemd services ----------------------------------------------
install_service() {
  local name="$1"
  local src="${SYSTEMD_DIR}/${name}"
  local dst="/etc/systemd/system/${name}"
  sed -e "s|__DESCOS_USER__|${TARGET_USER}|g" \
      -e "s|__DESCOS_DIR__|${REPO_DIR}|g" \
      -e "s|__NPM_BIN__|${NPM_BIN}|g" \
      -e "s|__NODE_DIR__|${NODE_DIR}|g" \
      -e "s|__BACKEND_PORT__|${BACKEND_PORT}|g" \
      -e "s|__FRONTEND_PORT__|${FRONTEND_PORT}|g" \
      "$src" > "$dst"
  echo "==> Installed ${dst}"
}

install_service "descos-backend.service"
install_service "descos-frontend.service"

systemctl daemon-reload
systemctl enable --now descos-backend.service
systemctl enable --now descos-frontend.service

# --- Set up kiosk autostart (.desktop in the user's autostart dir) ---------
chmod +x "${SCRIPT_DIR}/start-kiosk.sh"
AUTOSTART_DIR="${TARGET_HOME}/.config/autostart"
mkdir -p "$AUTOSTART_DIR"
sed -e "s|__DESCOS_DIR__|${REPO_DIR}|g" \
    "${SCRIPT_DIR}/descos-kiosk.desktop" > "${AUTOSTART_DIR}/descos-kiosk.desktop"
chown -R "${TARGET_USER}:${TARGET_USER}" "${TARGET_HOME}/.config" 2>/dev/null || true

echo "==> Installed kiosk autostart: ${AUTOSTART_DIR}/descos-kiosk.desktop"

cat <<EOF

✅ Done!

  Services:
    systemctl status descos-backend
    systemctl status descos-frontend
    journalctl -u descos-backend -u descos-frontend -f

  Dashboard:  http://localhost:${FRONTEND_PORT}   (backend API on :${BACKEND_PORT})

The kiosk browser starts automatically on the next graphical login.
For an always-on display, enable desktop autologin:
    sudo raspi-config   ->  System Options  ->  Boot / Auto Login  ->  "Desktop Autologin"

Test the kiosk now (without rebooting):
    ${SCRIPT_DIR}/start-kiosk.sh

Uninstall:
    sudo systemctl disable --now descos-backend descos-frontend
    sudo rm /etc/systemd/system/descos-backend.service /etc/systemd/system/descos-frontend.service
    rm ${AUTOSTART_DIR}/descos-kiosk.desktop
    sudo systemctl daemon-reload
EOF
