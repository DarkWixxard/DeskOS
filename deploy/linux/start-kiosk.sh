#!/usr/bin/env bash
# DeskOS - Kiosk launcher
# Waits until the dashboard is reachable, then opens it fullscreen in Chromium/Chrome.
# Intended to be started from the graphical session (see descos-kiosk.desktop).

set -euo pipefail

URL="${DESCOS_KIOSK_URL:-http://localhost:3000}"

# 1. Wait until the frontend answers (max ~60s) ----------------------------
echo "[descos-kiosk] Waiting for ${URL} ..."
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "${URL}"; then
    echo "[descos-kiosk] Dashboard is up."
    break
  fi
  sleep 1
done

# 2. Find a Chromium/Chrome binary -----------------------------------------
BROWSER=""
for c in chromium-browser chromium google-chrome google-chrome-stable; do
  if command -v "$c" >/dev/null 2>&1; then
    BROWSER="$c"
    break
  fi
done
if [ -z "$BROWSER" ]; then
  echo "[descos-kiosk] ERROR: No Chromium/Chrome found." >&2
  echo "[descos-kiosk] Install it with: sudo apt install chromium-browser" >&2
  exit 1
fi

# 3. Disable screen blanking / power saving (X11 only, ignored on Wayland) --
if command -v xset >/dev/null 2>&1; then
  xset s off || true
  xset s noblank || true
  xset -dpms || true
fi
# Hide the mouse cursor when idle (optional, X11 only)
if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0.5 -root &
fi

# 4. Launch the browser in kiosk mode --------------------------------------
PROFILE_DIR="${HOME}/.config/descos-kiosk"
mkdir -p "$PROFILE_DIR"

echo "[descos-kiosk] Launching ${BROWSER} in kiosk mode -> ${URL}"
exec "$BROWSER" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --disable-features=TranslateUI \
  --check-for-update-interval=31536000 \
  --user-data-dir="$PROFILE_DIR" \
  "$URL"
