// Zentrale Auflösung der Backend-Basis-URL für das Frontend.
//
// Reihenfolge:
//   1. NEXT_PUBLIC_API_URL (falls explizit gesetzt) hat Vorrang.
//   2. Sonst window.location.hostname + konfigurierter Backend-Port,
//      damit Remote-Zugriff / Tailscale weiter funktioniert.
//   3. Im SSR-Kontext Fallback auf localhost.
//
// Hinweis: NEXT_PUBLIC_BACKEND_PORT wird von Next.js beim Build eingebacken.
// `npm run dev` (scripts/dev.mjs) und setup.sh leiten ihn automatisch aus
// BACKEND_PORT ab, sodass geänderte Ports ohne weitere Eingriffe greifen.

const DEFAULT_BACKEND_PORT = '4001';

/** Konfigurierter Backend-Port (z. B. zu Anzeigezwecken). */
export function getBackendPort(): string {
  return process.env.NEXT_PUBLIC_BACKEND_PORT || DEFAULT_BACKEND_PORT;
}

/** Basis-URL des DeskOS-Backends (API + WebSocket). */
export function getApiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  const port = getBackendPort();
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:${port}`;
  }
  return `http://localhost:${port}`;
}
