#!/usr/bin/env bash
# DeskOS - Tailscale Serve setup
# Publishes the DeskOS dashboard (frontend :3000) and backend (:3001) over HTTPS
# on your tailnet, so DeskOS becomes reachable at
#   https://<device>.<tailnet>.ts.net
# in ADDITION to the existing http://localhost:3000 (which keeps working unchanged).
#
# Usage:
#   sudo ./deploy/linux/tailscale-serve.sh [on|off|status]
#
#   on      (default) publish frontend on :443 and backend on :3001 via HTTPS
#   off     remove all Tailscale Serve mappings  (tailscale serve reset)
#   status  show the current Tailscale Serve configuration
#
# Override the ports if your setup differs:
#   sudo FRONTEND_PORT=3000 BACKEND_PORT=3001 ./deploy/linux/tailscale-serve.sh

set -euo pipefail

ACTION="${1:-on}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_PORT="${BACKEND_PORT:-3001}"

# --- tailscale must be installed -------------------------------------------
if ! command -v tailscale >/dev/null 2>&1; then
  echo "ERROR: 'tailscale' not found. Install it first: https://tailscale.com/download" >&2
  exit 1
fi

# --- 'status' needs no root ------------------------------------------------
if [ "$ACTION" = "status" ]; then
  exec tailscale serve status
fi

# --- serve config lives in tailscaled -> needs root ------------------------
if [ "$(id -u)" -ne 0 ]; then
  echo "Please run with sudo:  sudo ./deploy/linux/tailscale-serve.sh ${ACTION}" >&2
  exit 1
fi

case "$ACTION" in
  off)
    echo "==> Removing DeskOS Tailscale Serve mappings ..."
    tailscale serve reset
    echo "✅ Done. DeskOS is no longer served over the tailnet."
    exit 0
    ;;
  on)
    : # handled below
    ;;
  *)
    echo "Usage: sudo ./deploy/linux/tailscale-serve.sh [on|off|status]" >&2
    exit 1
    ;;
esac

# --- must be connected to a tailnet ----------------------------------------
if ! tailscale status >/dev/null 2>&1; then
  echo "ERROR: Tailscale is not connected. Run 'sudo tailscale up' and log in first." >&2
  exit 1
fi

echo "==> Publishing DeskOS over HTTPS on the tailnet ..."
echo "    frontend  127.0.0.1:${FRONTEND_PORT}  ->  https://<device>.<tailnet>.ts.net"
echo "    backend   127.0.0.1:${BACKEND_PORT}   ->  https://<device>.<tailnet>.ts.net:${BACKEND_PORT}"

# Dashboard (frontend) on the standard HTTPS port 443
if ! tailscale serve --bg --https=443 "http://127.0.0.1:${FRONTEND_PORT}"; then
  echo "ERROR: Could not publish the dashboard over HTTPS." >&2
  echo "       Is 'HTTPS Certificates' enabled for your tailnet?" >&2
  echo "       Admin console -> DNS -> HTTPS Certificates." >&2
  exit 1
fi

# Backend / WebSocket on :3001 (the frontend talks to <host>:3001 automatically)
tailscale serve --bg --https="${BACKEND_PORT}" "http://127.0.0.1:${BACKEND_PORT}"

echo
echo "==> Current Tailscale Serve status:"
tailscale serve status || true

# Best-effort: print this device's actual MagicDNS URL (uses jq if available)
DNS_NAME=""
if command -v jq >/dev/null 2>&1; then
  DNS_NAME="$(tailscale status --json 2>/dev/null | jq -r '.Self.DNSName // empty' | sed 's/\.$//')"
fi

cat <<EOF

✅ Done!

DeskOS is now reachable on your tailnet at:
EOF
if [ -n "$DNS_NAME" ]; then
  echo "    https://${DNS_NAME}"
else
  echo "    https://<your-device>.<your-tailnet>.ts.net   (see the URL shown above)"
fi
cat <<EOF

Local/kiosk access at http://localhost:${FRONTEND_PORT} keeps working unchanged.

  Status:  sudo ./deploy/linux/tailscale-serve.sh status
  Remove:  sudo ./deploy/linux/tailscale-serve.sh off

Note: MagicDNS + HTTPS certificates must be enabled for your tailnet
(admin console -> DNS -> "HTTPS Certificates"). The first request may take
a few seconds while the TLS certificate is issued.
EOF
