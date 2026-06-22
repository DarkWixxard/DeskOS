# DeskOS – Modulares Monitoring & Steuerungssystem

Ein vollständig modulares System zur Überwachung und Steuerung von lokalen PCs, Remote-PCs, ESP32-Controllern, Sensoren, Displays und LEDs – mit einem React-Dashboard, Echtzeit-WebSockets und einem erweiterbaren Plugin-System.

**Status:** v0.1.0 – Phase 1 abgeschlossen und produktionsbereit

---

## Inhaltsverzeichnis

- [Features](#features)
- [Architektur](#architektur)
- [Tech Stack](#tech-stack)
- [Voraussetzungen](#voraussetzungen)
- [Schnellstart](#schnellstart)
- [Projektstruktur](#projektstruktur)
- [Umgebungsvariablen](#umgebungsvariablen)
- [API-Referenz](#api-referenz)
- [Plugin-System](#plugin-system)
- [Deployment](#deployment)
- [Dokumentation](#dokumentation)
- [Roadmap](#roadmap)
- [Lizenz](#lizenz)

---

## Features

**Backend**
- REST-API mit Express.js
- Echtzeit-WebSocket-Server (Socket.IO)
- Event-getriebene Architektur (Pub/Sub-System)
- Geräteverwaltung (lokal, remote, ESP32, Sensoren)
- Lokales System-Monitoring (CPU, RAM, Disk, Uptime)
- SQLite-Datenbankintegration
- Plugin-System mit dynamischem Laden
- Konfigurationsverwaltung via dotenv
- Strukturiertes Logging (Winston)

**Frontend**
- React + Next.js Dashboard
- Echtzeit-Gerätemonitoring via WebSocket
- Systemmetriken-Visualisierung (Recharts)
- Event-Log-Anzeige
- Geräte-Statusanzeigen und Detailansicht
- Overlay-Menü (Kiosk-kompatibel)
- Responsives Design mit Tailwind CSS
- Zustand State Management

**Infrastruktur**
- TypeScript in allen Schichten
- Monorepo mit npm Workspaces
- Docker & Docker Compose
- Automatisierte Setup-Skripte (Windows/Linux/macOS)
- Autostart & Kiosk-Modus (systemd/Windows Autostart)
- Unit-Testing mit Jest

---

## Architektur

```
Browser / Dashboard (http://localhost:4000)
              │
              ▼
      React Frontend
     (Next.js + Zustand)
              │
              │  REST + WebSocket (Socket.IO)
              ▼
┌─────────────────────────────────────┐
│    Node.js Backend (Express)        │
│    http://localhost:4001            │
├─────────────────────────────────────┤
│  EventSystem  │  DeviceManager      │
│  PluginSystem │  AutomationEngine   │
│  SystemMonitor│  DatabaseService    │
│  WebSocketServer │ REST API         │
└──────────────┬──────────────────────┘
               │
     ┌─────────┼──────────┬───────────┐
     ▼         ▼          ▼           ▼
  Lokales   Remote-    ESP32-     MQTT-
  System    Agents     Geräte     Broker
```

---

## Tech Stack

| Bereich | Technologie | Version |
|---------|-------------|---------|
| **Frontend** | React | 18+ |
| | Next.js | 14+ |
| | Tailwind CSS | 3.4+ |
| | Zustand | 4.4+ |
| | Recharts | 2.10+ |
| | Framer Motion | 10.0+ |
| | Socket.IO Client | 4.7+ |
| | Axios | 1.6+ |
| **Backend** | Node.js | 18+ |
| | Express.js | 4.18+ |
| | TypeScript | 5.0+ |
| | Socket.IO | 4.7+ |
| | MQTT | 5.0+ |
| | SQLite3 | 5.1+ |
| | Winston | 3.11+ |
| **DevOps** | Docker / Docker Compose | Latest |
| **Testing** | Jest + ts-jest | 29.0+ |

---

## Voraussetzungen

- **Node.js** 18 oder neuer
- **npm** 9 oder neuer
- Optional: **Docker** & **Docker Compose** für Container-Deployment

---

## Schnellstart

### Automatisch (empfohlen)

**Linux / macOS:**
```bash
./setup.sh
```

**Windows:**
```bat
setup.bat
```

Das Skript installiert alle Abhängigkeiten und legt die `.env`-Dateien aus den Beispielen an.

---

### Manuell

**1. Abhängigkeiten installieren**
```bash
npm install
```

**2. Umgebungsvariablen anlegen**
```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env.local
cp apps/agent/.env.example apps/agent/.env
```

**3. Entwicklungsserver starten (3 Terminals)**

```bash
# Terminal 1 – Backend (Port 4001)
npm run dev --workspace=apps/backend

# Terminal 2 – Frontend (Port 4000)
npm run dev --workspace=apps/frontend

# Terminal 3 – Agent (optional)
npm run dev --workspace=apps/agent
```

Das Dashboard ist dann unter **http://localhost:4000** erreichbar.

---

### Docker

```bash
docker-compose up --build
```

---

## Projektstruktur

```
DeskOS/
├── apps/
│   ├── backend/                  # Node.js + TypeScript Backend
│   │   └── src/
│   │       ├── core/             # EventSystem, DeviceManager, PluginSystem, AutomationEngine
│   │       ├── services/         # SystemMonitor, DatabaseService, WebSocketServer, Logger, ConfigManager
│   │       └── api/routes.ts     # REST-Endpoints
│   ├── frontend/                 # React + Next.js Dashboard
│   │   └── src/
│   │       ├── app/              # Next.js App Router (layout.tsx, page.tsx)
│   │       ├── components/       # Dashboard, OverlayMenu
│   │       └── stores/           # Zustand Store (dashboardStore.ts)
│   └── agent/                    # Remote-PC-Agent
│       └── src/index.ts
├── packages/
│   └── shared/                   # Gemeinsame TypeScript-Typen
│       └── src/types.ts          # Device, SystemMetrics, DeskOSEvent, PluginConfig, …
├── plugins/
│   ├── system-monitor/           # System-Monitoring-Plugin
│   └── rgb-control/              # LED/RGB-Steuerungs-Plugin
├── deploy/
│   ├── linux/                    # install.sh, start-kiosk.sh
│   └── windows/                  # install-autostart.ps1, start-kiosk.bat
├── docker-compose.yml
├── Dockerfile.backend
├── Dockerfile.frontend
├── setup.sh
├── setup.bat
└── package.json                  # Monorepo-Root mit npm Workspaces
```

---

## Umgebungsvariablen

### Ports zentral ändern (`.env` im Projekt-Root)

Alle Ports lassen sich an **einer** Stelle anpassen: `.env.example` nach `.env` kopieren
und die Werte ändern. Standard ist bewusst der 4000er-Bereich (statt 3000/3001), um
Konflikte mit anderen Anwendungen zu vermeiden.

| Variable | Standard | Dienst |
|----------|----------|--------|
| `FRONTEND_PORT` | `4000` | Web-Dashboard (Next.js) |
| `BACKEND_PORT` | `4001` | API + WebSocket |
| `OSZI_PORT` | `4002` | Oszi-Service (Flask) |
| `MQTT_PORT` | `1883` | MQTT-Broker |

`npm run dev`, `docker compose` und `setup.sh` lesen diese `.env` automatisch. Nach einer
Port-Änderung in Produktion das Frontend neu bauen (`setup.sh`/Docker erledigen das),
damit der Backend-Port ins Client-Bundle eingebacken wird.

### Backend (`apps/backend/.env`)

| Variable | Standard | Beschreibung |
|----------|----------|--------------|
| `BACKEND_PORT` | `4001` | HTTP-Port des Backends (zentral über Root-`.env`) |
| `NODE_ENV` | `development` | Umgebung (`development` / `production`) |
| `DATABASE_PATH` | `./descos.db` | Pfad zur SQLite-Datenbank |
| `MQTT_BROKER` | – | MQTT-Broker-URL (optional) |
| `LOG_LEVEL` | `debug` | Log-Level (debug / info / warn / error) |

### Frontend (`apps/frontend/.env.local`)

| Variable | Standard | Beschreibung |
|----------|----------|--------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4001` | Backend-URL |

### Agent (`apps/agent/.env`)

| Variable | Standard | Beschreibung |
|----------|----------|--------------|
| `BACKEND_URL` | – | Adresse des Backends |
| `AGENT_NAME` | – | Name dieses Agents |
| `POLL_INTERVAL` | `1000` | Polling-Intervall in ms |

---

## API-Referenz

**Base URL:** `http://localhost:4001/api`

### REST-Endpoints

| Methode | Endpoint | Beschreibung |
|---------|----------|--------------|
| GET | `/health` | Health Check |
| GET | `/devices` | Alle Geräte auflisten |
| GET | `/devices/:id` | Gerätedetails inkl. neuester Daten |
| GET | `/devices/:id/data?limit=100` | Historische Gerätedaten |
| GET | `/system/metrics` | Aktuelle Systemmetriken (CPU, RAM, Disk) |
| GET | `/events?type=...&limit=50` | Event-Verlauf (optional gefiltert) |
| GET | `/dashboard/summary` | Aggregierte Dashboard-Zusammenfassung |

### WebSocket-Events (Socket.IO)

**Client → Server:**

| Event | Beschreibung |
|-------|--------------|
| `subscribe:device` | Gerät abonnieren |
| `get:devices` | Alle Geräte anfragen |
| `get:device` | Einzelnes Gerät anfragen |
| `get:event-history` | Event-Verlauf anfragen |
| `subscribe:events` | Events abonnieren |

**Server → Client:**

| Event | Beschreibung |
|-------|--------------|
| `devices:list` | Liste aller Geräte |
| `device:update` | Gerät-Update |
| `device:details` | Gerätedetails |
| `event:new` | Neues Event |
| `event:history` | Event-Verlauf |
| `error` | Fehlermeldung |

---

## Plugin-System

Plugins liegen im `plugins/`-Verzeichnis und bestehen aus:

- **`plugin.json`** – Metadaten, Capabilities, Widget-Definitionen
- **`backend.ts`** – Implementierung mit Zugriff auf `PluginContext`

```ts
// Beispiel: Plugin-Initialisierung
export async function init(context: PluginContext): Promise<void> {
  const { eventSystem, config, logger } = context;
  // Plugin-Logik hier
}

export async function destroy(): Promise<void> {
  // Aufräumen
}
```

**Mitgelieferte Plugins:**

| Plugin | Beschreibung |
|--------|--------------|
| `system-monitor` | Erweitertes System-Monitoring mit CPU-, RAM- und Netzwerk-Widget |
| `rgb-control` | LED/RGB-Steuerung für Hardware-Integration |

---

## Deployment

### Linux / Raspberry Pi (systemd)

Installiert Backend und Frontend als systemd-Dienste und richtet optionalen Chromium-Kiosk-Modus ein:

```bash
sudo ./deploy/linux/install.sh
```

Erstellt die Dienste `descos-backend.service` und `descos-frontend.service`.

Kiosk-Browser manuell starten:
```bash
./deploy/linux/start-kiosk.sh
```

### Windows (Autostart)

Legt eine Verknüpfung im Windows-Autostart-Ordner an und startet Chrome/Edge im Kiosk-Modus:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\install-autostart.ps1
```

### Docker

```bash
docker-compose up -d
```

Weitere Details zu Autologin, Troubleshooting und Produktivkonfiguration: [DEPLOYMENT.md](./DEPLOYMENT.md) · [KIOSK.md](./KIOSK.md)

---

## Dokumentation

| Datei | Inhalt |
|-------|--------|
| [QUICKSTART.md](./QUICKSTART.md) | 5-Minuten-Setup-Anleitung mit Troubleshooting |
| [API.md](./API.md) | Vollständige API-Referenz mit Beispielen |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Produktions-Deployment-Anleitung |
| [KIOSK.md](./KIOSK.md) | Autostart & Kiosk-Modus (Linux/Windows) |
| [INDEX.md](./INDEX.md) | Vollständige Projektstruktur & Übersicht |
| [CHANGELOG.md](./CHANGELOG.md) | Versionshistorie & Roadmap |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Beitragsrichtlinien |

---

## Roadmap

Die vollständige Roadmap inkl. Machbarkeit, Ist-Zustand und Detailaufgaben steht in
**[ROADMAP.md](./ROADMAP.md)**. Kurzüberblick der Meilensteine:

| Meilenstein | Version | Thema |
|-------------|---------|-------|
| ✅ Basis | v0.1.0 | Core-System, Backend, Frontend, Multi-PC-Monitoring (Ansatz), Oszi |
| 🔜 M0 | v1.0 | Fundament: Typen-Cleanup & SQLite-Persistenz anschließen |
| 🔜 M1 | v1.0 | Monitoring-Tiefe: GPU, Temperaturen, Lüfter, Netz, Prozesse (`systeminformation`) |
| 🔜 M2 | v1.0 | Device Center (Detailansicht) + Notification- & Log-Center |
| 🔜 M3 | v2.0 | RGB-Engine + WLED-Steuerung (Ambient + Zimmerlicht) |
| 🔜 M4 | v2.0 | Automation-Engine v2 + Layout-/Profil-System |
| 🔜 M5 | v3.0 | ESP32/MQTT + Sensor-Hub + Modul-Manager (inkl. Simulator) |
| 🔜 M6 | v3.0 | Firmware-Center + Plugin-System v2 (Spotify, Discord, OBS, Hue …) |

---

## Lizenz

MIT – siehe [LICENSE](./LICENSE)
