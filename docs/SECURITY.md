# Security-Center & Auth-Modell

Das **Security-Center** ist die Bedienoberfläche für die Sicherheit von DeskOS. Es macht die
bereits im Backend vorhandenen Schutzmechanismen – **Shared-Token-Auth**, CORS, Rate-Limit und
Security-Header – sichtbar und prüfbar. Erreichbar über die Kachel **Security** (Seite 2 des
Overlay-Menüs, `Strg + K`).

Quellen:
- Auth-Middleware: [`apps/backend/src/api/auth.ts`](../apps/backend/src/api/auth.ts)
- Status-Endpoint: [`apps/backend/src/api/routes.ts`](../apps/backend/src/api/routes.ts) (`/api/security/status`)
- Ansicht: [`apps/frontend/src/components/SecurityView.tsx`](../apps/frontend/src/components/SecurityView.tsx)

---

## Kurzüberblick

| Schutz | Womit | Standard |
|--------|-------|----------|
| **Auth** (API + WebSocket) | Shared-Token `DESKOS_TOKEN` | **aus** (offen im LAN) |
| **Security-Header** | `helmet` | aktiv |
| **CORS** | `CORS_ORIGINS` | Anfrage-Origin gespiegelt (LAN-freundlich) |
| **Rate-Limit** | `RATE_LIMIT_MAX` Requests/min je IP auf `/api` | `300` |

> **Wichtig:** Ohne gesetzten `DESKOS_TOKEN` sind API und WebSocket **offen** – jeder im selben
> Netzwerk kann DeskOS steuern. Für den Betrieb über ein Netzwerk immer einen Token setzen.

---

## Shared-Token-Auth

DeskOS nutzt ein **gemeinsames LAN-Geheimnis** statt Benutzerkonten – passend für ein Dashboard, das
mehrere eigene Geräte im Heimnetz bedienen. Ist `DESKOS_TOKEN` gesetzt, verlangen **alle** `/api/*`-Routen
(außer `/health` und die OAuth-Callbacks) sowie der **WebSocket**-Verbindungsaufbau diesen Token. Der
Vergleich läuft zeitkonstant (`crypto.timingSafeEqual`), um Timing-Angriffe zu vermeiden.

### Aktivieren

1. **Token erzeugen:**
   ```bash
   openssl rand -hex 24
   ```
2. **Backend** – in `apps/backend/.env` (oder Root-`.env`):
   ```env
   DESKOS_TOKEN=dein-erzeugtes-geheimnis
   ```
3. **Frontend** – denselben Wert in `apps/frontend/.env.local`, damit das Dashboard ihn mitschickt:
   ```env
   NEXT_PUBLIC_DESKOS_TOKEN=dein-erzeugtes-geheimnis
   ```
   Das Frontend hängt den Token danach automatisch an jeden Backend-Request und an den WebSocket-Handshake
   an (siehe [`apps/frontend/src/lib/api.ts`](../apps/frontend/src/lib/api.ts)).

Beim Start meldet das Backend `🔒 Auth aktiv` bzw. warnt mit `⚠️  Auth DEAKTIVIERT`.

### Token mitschicken (für eigene Clients / weitere Geräte)

Das Backend akzeptiert den Token auf drei Wegen:

| Weg | Beispiel |
|-----|----------|
| Header `x-deskos-token` | `x-deskos-token: <token>` |
| `Authorization: Bearer` | `Authorization: Bearer <token>` |
| Query-Parameter `?token=` | `GET /api/devices?token=<token>` |

```bash
curl -H "x-deskos-token: <token>" http://localhost:4001/api/security/status
```

---

## CORS, Rate-Limit & Header

- **CORS** (`CORS_ORIGINS`): leer → die Anfrage-Origin wird gespiegelt (bequem im LAN). Eine Komma-Liste
  beschränkt auf genau diese Origins; `*` erlaubt alle.
- **Rate-Limit** (`RATE_LIMIT_MAX`, Standard `300`): begrenzt Requests je Minute und IP auf `/api` und
  bremst so u. a. das Durchprobieren von Tokens.
- **Security-Header:** `helmet` ist immer aktiv (mit `crossOriginResourcePolicy: cross-origin`, damit eine
  getrennte Frontend-Origin die Antworten lesen darf).

---

## Status-Endpoint

```
GET /api/security/status
```

Liefert eine **geheimnis-freie** Momentaufnahme (der Token selbst wird **nie** ausgeliefert – nur, *ob*
einer gesetzt ist):

```json
{
  "auth": {
    "enabled": true,
    "scheme": "shared-token",
    "accepts": ["x-deskos-token", "Authorization: Bearer", "?token="],
    "websocketProtected": true
  },
  "cors": { "mode": "mirror", "origins": [] },
  "rateLimit": { "windowMs": 60000, "max": 300 },
  "headers": { "helmet": true },
  "connections": { "websocketClients": 2 },
  "server": { "env": "development", "uptimeSec": 128 }
}
```

Ist Auth aktiv, ist auch dieser Endpoint selbst geschützt (401 ohne Token) – konsistent mit dem Rest der API.

---

## Die Security-Ansicht

Die Kachel **Security** öffnet eine eigene Ansicht mit:

- **Auth-Status** als großem Indikator: **Geschützt** (grün) oder **Ungeschützt** (rot), inkl. Hinweis, dass
  das Frontend selbst einen Token sendet – oder eben nicht (dann drohen 401-Fehler).
- **Netzwerk & Zugriff:** CORS-Modus (mit Allowlist-Origins), Rate-Limit, `helmet`, WebSocket-Zustand.
- **Verbindungen:** Anzahl aktuell verbundener WebSocket-Clients.
- **Server:** Umgebung (`NODE_ENV`) und Uptime, mit Produktions-Hinweis.

Ein **Aktualisieren**-Knopf lädt den Status neu.

---

## Empfehlungen für den produktiven Betrieb

- `DESKOS_TOKEN` **immer** setzen, sobald DeskOS über ein Netzwerk erreichbar ist.
- `NODE_ENV=production` setzen.
- Bei Zugriff außerhalb des lokalen Rechners **HTTPS** verwenden (z. B. Reverse-Proxy oder
  [Tailscale](./TAILSCALE.md)) – ein Shared-Token ohne Transportverschlüsselung ist abhörbar.
- `CORS_ORIGINS` auf die tatsächlich genutzten Frontend-Origins beschränken.
