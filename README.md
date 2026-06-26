# DeskOS – Modulares Monitoring & Steuerungssystem

Ein „**Betriebssystem für den Schreibtisch**": Überwachung und Steuerung von lokalen PCs,
Remote-PCs, WLED-Lichtern, ESP32-/Sensor-Nodes, Automationen, Layout-Profilen und Plugins –
mit holografischem React-Dashboard, Echtzeit-WebSockets, MQTT und einem Plugin-Marktplatz.

**Status:** ✅ Roadmap **M0–M6** vollständig umgesetzt (v1.0–v3.0). Siehe [ROADMAP.md](./ROADMAP.md).

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
- [Tests](#tests)
- [Deployment](#deployment)
- [Dokumentation](#dokumentation)
- [Roadmap](#roadmap)
- [Lizenz](#lizenz)

---

## Features

### 🖥️ Monitoring Center
- Lokales **und** Multi-PC-Monitoring (über den `agent`-Workspace).
- Tiefe Metriken via `systeminformation`: CPU (Last + Temperatur + Modell/Kerne), RAM,
  **GPU(s)** (Last/Temp/VRAM), **pro-Disk**-Speicher, **Netzwerk-Durchsatz**, **Top-Prozesse**.
- Zweistufige Erfassung (leichte Werte je Sekunde, schwere alle 5 s); `os`-Fallback wenn ein Sensor fehlt.
- Frontend-Views **Übersicht / Metrics / Netzwerk / Speicher / Prozesse**, pro Gerät auswählbar (Recharts).

### 🖧 Device Center
- Geräte-Detailansicht mit Tabs **Infos / Einstellungen / Logs / Firmware**.
- Umbenennen, Entfernen, Live-Metriken, Metadaten; Geräte aller Typen (local/remote/esp32/sensor).

### 🔔 Notification Center & 📜 Log Center
- `NotificationService`: kuratierte Benachrichtigungen aus Events (Alarme, Statuswechsel …),
  persistent, live per WebSocket, mit Gelesen-Status. Glocken-Button + Slide-over-Panel.
- Durchsuch- und filterbares **Log Center** auf Basis persistierter Logs.

### 🌈 RGB-Engine + WLED
- `WledService`: Steuerung von WLED-Lichtern über die JSON-API (Power, Helligkeit, Farbe, Effekt) mit Timeout/Fehlerbehandlung.
- Jedes Licht ist ein `Device` (Status-Polling); Modi pro Licht: **Manuell / Temperatur** (Farbe folgt CPU-Temp) **/ Alarm**.
- RGB-Dashboard zum Hinzufügen/Steuern der Lichter. Zwei Lichter sind vorkonfiguriert (über `WLED_LIGHTS`).

### ⚡ Automation-Engine v2 + 🗂️ Layout-Profile
- Trigger: **Schwellwert · Event · Gerätestatus · Zeitplan**. Aktionen (entkoppelt über Event-Bus):
  Event auslösen, **Benachrichtigung**, **WLED steuern**, **Layout wechseln**.
- **No-Code-Regelbuilder** im Frontend; Regeln persistent, mit Cooldown.
- Layout-Profile (Gaming/Coding/Streaming/Work/Minimal): wenden per Knopfdruck eine **Szene** an (RGB) und wechseln die Ansicht.

### 📡 ESP32 / MQTT, Sensor-Hub & Modul-Manager
- `MqttService` mit **eingebettetem Broker** (aedes) – funktioniert out-of-the-box ohne externe Infrastruktur.
- Topic-Schema `deskos/nodes/<id>/{announce,telemetry,status,cmd}`: Auto-Registrierung, Telemetrie, LWT-Status, Befehle.
- **Sensor-Hub**: Sensor-Nodes mit Live-Messwerten (Temp/Feuchte/CO₂/Licht/Geräusch).
- **Modul-Manager**: Module werden beim `announce` automatisch erfasst und angezeigt.
- **ESP32-Simulator** (`apps/simulator`): testet die komplette MQTT-Strecke ohne Hardware.

### 🔧 Firmware-Center & 🧩 Plugin-Marktplatz
- Firmware-Center (im Geräte-Detail): **Neustart / WLAN-Konfig / OTA** für MQTT-Nodes; WLED verlinkt auf seine OTA-Web-UI.
- Plugin-System v2 mit **Marktplatz**: funktionale Built-ins (Uhr, System-Übersicht) + Katalog
  (Spotify, Discord, OBS, Steam, Home Assistant, Philips Hue) mit Install/Aktivieren/Einstellungen, persistent.
- **Spotify-Plugin voll funktionsfähig**: OAuth-Login, „Now Playing"-Anzeige (Cover/Titel/Fortschritt)
  und Wiedergabesteuerung (Play/Pause/Vor/Zurück) über die Spotify Web API – Einrichtung in [SPOTIFY.md](./SPOTIFY.md).
- Aktivierte Plugins rendern Widgets im Dashboard.

### 🏗️ Infrastruktur
- TypeScript in allen Schichten, Monorepo mit npm Workspaces, **eine** Typquelle (`packages/shared`).
- **SQLite-Persistenz** für Geräte, Geräte-Daten (gedrosselt), Logs, Automationen, Layouts, Plugins, Notifications.
- Event-getriebene Architektur (Pub/Sub), Docker & Docker Compose, Kiosk-/Autostart, Oszilloskop-Integration (Bonus).
- Unit- & Integrationstests mit Jest (inkl. eingebettetem MQTT-Broker im Test).

---

## Architektur

```
        Browser / Dashboard (http://localhost:4000)
                       │  REST + WebSocket (Socket.IO)
                       ▼
        ┌───────────────────────────────────────────────┐
        │           Node.js Backend (Express)            │
        │              http://localhost:4001             │
        ├───────────────────────────────────────────────┤
        │  EventSystem (Bus)  ·  DeviceManager           │
        │  SystemMonitor      ·  PersistenceService (SQLite)
        │  NotificationService·  AutomationEngine v2     │
        │  ActionExecutor     ·  LayoutService           │
        │  WledService        ·  MqttService (+ Broker)  │
        │  PluginRegistry     ·  WebSocketServer         │
        └───────┬───────────┬──────────┬────────┬────────┘
                │           │          │        │
        ┌───────▼──┐  ┌─────▼────┐ ┌───▼────┐ ┌─▼──────────┐
        │ Lokales  │  │ Remote-  │ │ WLED   │ │ MQTT-Nodes │
        │ System   │  │ Agents   │ │ (HTTP) │ │ (ESP32/Sim)│
        └──────────┘  └──────────┘ └────────┘ └────────────┘
```

Alle Domänen kommunizieren über den **Event-Bus**; Aktionen (Notify/WLED/Layout) werden als
Bus-Events ausgeführt und von den jeweiligen Services verarbeitet – maximal entkoppelt.

---

## Tech Stack

| Bereich | Technologie | Version |
|---------|-------------|---------|
| **Frontend** | React / Next.js | 18+ / 14+ |
| | Tailwind CSS · Zustand · Recharts · Framer Motion · Socket.IO Client | – |
| **Backend** | Node.js · Express · TypeScript | 18+ / 4.18+ / 5.x |
| | Socket.IO · SQLite3 · Winston | – |
| | **systeminformation** (Metriken) | 5.x |
| | **mqtt** (Client) · **aedes** (eingebetteter Broker) | 5.x / 0.51 |
| **Tooling** | tsx · Jest + ts-jest · npm Workspaces | – |
| **DevOps** | Docker / Docker Compose | Latest |

---

## Voraussetzungen

- **Node.js** 18 oder neuer · **npm** 9 oder neuer
- Optional: **Docker** & **Docker Compose**
- Ein MQTT-Broker ist **nicht** nötig – DeskOS startet selbst einen eingebetteten Broker.

---

## Schnellstart

```bash
# 1. Abhängigkeiten installieren
npm install

# 2. Backend + Frontend gemeinsam starten (liest Ports zentral aus der Root-.env)
npm run dev
#   → Dashboard:  http://localhost:4000
#   → Backend/API: http://localhost:4001  (inkl. eingebettetem MQTT-Broker)

# 3. Optional: virtueller ESP32-Sensor-Node (ohne Hardware)
npm run dev --workspace=apps/simulator

# 4. Optional: Remote-PC-Agent auf einem zweiten Rechner
npm run dev --workspace=apps/agent
```

Im Dashboard das Overlay-Menü mit **Strg + K** (bzw. ⌘ + K auf Mac) öffnen – alternativ mit der
**`** -Taste oder **F2** → Monitor / RGB / Automationen / Sensoren / Plugins / Logs.

**Automatisches Setup** (legt `.env`-Dateien an): `./setup.sh` (Linux/macOS) bzw. `setup.bat` (Windows).
**Docker:** `docker-compose up --build`.

---

## Projektstruktur

```
DeskOS/
├── apps/
│   ├── backend/                  # Node.js + TypeScript Backend
│   │   └── src/
│   │       ├── core/             # EventSystem, DeviceManager, AutomationEngine, ActionExecutor, PluginSystem
│   │       ├── services/         # SystemMonitor, PersistenceService, NotificationService, WledService,
│   │       │                     #   MqttService, LayoutService, PluginRegistry, DatabaseService, WebSocketServer
│   │       └── api/routes.ts      # REST-Endpoints
│   ├── frontend/                 # React + Next.js Dashboard
│   │   └── src/
│   │       ├── components/        # Dashboard, MonitorView, LogView, RgbView, AutomationsView,
│   │       │                      #   SensorView, PluginsView, PluginWidgets, NotificationCenter,
│   │       │                      #   DeviceDetail, LayoutBar, OverlayMenu, holo
│   │       └── stores/            # Zustand Store (dashboardStore.ts)
│   ├── agent/                    # Remote-PC-Agent (sendet Metriken via WebSocket)
│   └── simulator/                # Virtueller ESP32-Sensor-/LED-Node (MQTT)
├── packages/
│   └── shared/                   # Einzige Typquelle (Device, SystemMetrics, WledLight, AutomationRule,
│                                 #   LayoutProfile, SensorNode, PluginInstance, …)
├── services/oszi/               # Oszilloskop-Service (Flask, Bonus)
├── plugins/                     # Dir-basierte Backend-Plugins (system-monitor, rgb-control)
├── deploy/                      # systemd / Windows-Autostart / Kiosk
├── docker-compose.yml · Dockerfile.* · setup.sh · setup.bat
└── package.json                 # Monorepo-Root (npm Workspaces)
```

---

## Umgebungsvariablen

### Ports zentral (`.env` im Projekt-Root)

| Variable | Standard | Dienst |
|----------|----------|--------|
| `FRONTEND_PORT` | `4000` | Web-Dashboard (Next.js) |
| `BACKEND_PORT` | `4001` | API + WebSocket |
| `OSZI_PORT` | `4002` | Oszi-Service (Flask) |
| `MQTT_PORT` | `1883` | (eingebetteter) MQTT-Broker |

### Backend (`apps/backend/.env`)

| Variable | Standard | Beschreibung |
|----------|----------|--------------|
| `BACKEND_PORT` | `4001` | HTTP-Port des Backends |
| `DATABASE_PATH` | `./descos.db` | Pfad zur SQLite-Datenbank |
| `MQTT_PORT` | `1883` | Port des eingebetteten Brokers |
| `MQTT_BROKER` | – | externer Broker (wenn gesetzt, kein eigener) |
| `MQTT_EMBEDDED` | `true` | eingebetteten Broker starten (`false` zum Deaktivieren) |
| `WLED_LIGHTS` | *(2 Defaults)* | JSON-Array `[{"name":"…","ip":"…"}]`, beim ersten Start angelegt |
| `LOG_LEVEL` | `debug` | Log-Level |

### Frontend (`apps/frontend/.env.local`)
`NEXT_PUBLIC_API_URL` – Backend-URL (Standard `http://localhost:4001`).

### Agent (`apps/agent/.env`)
`BACKEND_URL`, `AGENT_NAME`, `POLL_INTERVAL`.

### Simulator (`apps/simulator`)
`MQTT_BROKER` (Standard `mqtt://localhost:1883`), `SIM_NODE_ID`, `SIM_NAME`, `SIM_INTERVAL`.

---

## API-Referenz

**Base URL:** `http://localhost:4001`

| Bereich | Endpoints |
|---------|-----------|
| **System** | `GET /health` · `GET /api/system/metrics` · `GET /api/dashboard/summary` |
| **Geräte** | `GET /api/devices` · `GET /api/devices/:id` · `GET /api/devices/:id/data` · `PATCH /api/devices/:id` (umbenennen) · `DELETE /api/devices/:id` · `POST /api/devices/:id/command` (MQTT/Firmware) |
| **Events / Logs** | `GET /api/events` · `GET /api/logs?level=&limit=` |
| **Notifications** | `GET /api/notifications` · `GET /api/notifications/unread-count` · `POST /api/notifications/:id/read` · `POST /api/notifications/read-all` |
| **Automationen** | `GET/POST /api/automations` · `PATCH/DELETE /api/automations/:id` |
| **WLED / RGB** | `GET/POST /api/wled/lights` · `PATCH/DELETE /api/wled/lights/:id` · `POST /api/wled/lights/:id/state` · `POST /api/wled/lights/:id/mode` · `GET /api/wled/lights/:id/effects` |
| **Layouts** | `GET /api/layouts` · `POST /api/layouts` · `PATCH/DELETE /api/layouts/:id` · `POST /api/layouts/:id/activate` |
| **Sensoren** | `GET /api/sensors` |
| **Plugins** | `GET /api/plugins` · `POST /api/plugins/:id/{install,uninstall,enable,disable}` · `PATCH /api/plugins/:id/settings` |
| **Spotify** | `GET /api/spotify/{status,login,callback,now-playing}` · `POST /api/spotify/control/:action` · `POST /api/spotify/disconnect` |
| **Oszi** | `ALL /api/oszi/*` (Proxy zum Flask-Dienst) |

**WebSocket (Socket.IO), Server → Client:** `devices:list`, `device:update`, `event:new`,
`notification:new`, `wled:update`, `layout:set`, `local:device:id`.
**Client → Server:** `get:devices`, `subscribe:device`, `subscribe:events`, `register-agent`, `metrics`.

Detaillierte Beispiele: [API.md](./API.md).

---

## Plugin-System

DeskOS hat einen **Plugin-Marktplatz** (`PluginRegistry`): Plugins werden installiert, aktiviert
und (falls nötig) mit Zugangsdaten konfiguriert – alles persistent. Funktionale Built-ins (Uhr,
System-Übersicht) rendern echte Widgets; Katalog-Einträge wie Spotify/Discord/OBS/Steam/
Home Assistant/Philips Hue sind als Framework angelegt und benötigen für die echte Anbindung
deine API-Zugangsdaten.

Das **Spotify-Plugin** ist bereits vollständig angebunden (OAuth, Now Playing,
Wiedergabesteuerung) – Schritt-für-Schritt-Anleitung in [SPOTIFY.md](./SPOTIFY.md).
Die übrigen Katalog-Einträge (Discord/OBS/Steam/Home Assistant/Hue) sind als
Framework angelegt und benötigen für die echte Anbindung deine API-Zugangsdaten.

Zusätzlich existiert das ursprüngliche **dir-basierte Backend-Plugin-System** (`plugins/` mit
`plugin.json` + `backend.ts`) für serverseitige Erweiterungen.

---

## Tests

```bash
npm run test --workspace=apps/backend
```

Jest-Suiten decken EventSystem, DeviceManager, Persistenz, Notifications, WLED (Mock-Server),
Automation/Layout, MQTT (mit eingebettetem Broker) und die Plugin-Registry ab.

---

## Deployment

- **Linux / Raspberry Pi (systemd):** `sudo ./deploy/linux/install.sh` → `descos-backend.service` + `descos-frontend.service`; Kiosk via `./deploy/linux/start-kiosk.sh`.
- **Windows (Autostart):** `powershell -ExecutionPolicy Bypass -File deploy\windows\install-autostart.ps1`.
- **Docker:** `docker-compose up -d`.

Details: [DEPLOYMENT.md](./DEPLOYMENT.md) · [KIOSK.md](./KIOSK.md) · [TAILSCALE.md](./TAILSCALE.md).

---

## Dokumentation

| Datei | Inhalt |
|-------|--------|
| [ROADMAP.md](./ROADMAP.md) | Vision, Meilensteine M0–M6 (umgesetzt) |
| [QUICKSTART.md](./QUICKSTART.md) | Schnellstart & Troubleshooting |
| [MENU.md](./MENU.md) | Overlay-Menü & Tastatur-Befehle (Strg + K …) |
| [SPOTIFY.md](./SPOTIFY.md) | Spotify verbinden (OAuth, Now Playing, Steuerung) |
| [API.md](./API.md) | API-Beispiele |
| [DEPLOYMENT.md](./DEPLOYMENT.md) · [KIOSK.md](./KIOSK.md) | Produktion / Kiosk |
| [CHANGELOG.md](./CHANGELOG.md) | Versionshistorie |

---

## Roadmap

✅ **Vollständig umgesetzt** – siehe [ROADMAP.md](./ROADMAP.md).

| Stufe | Meilensteine | Inhalt |
|-------|--------------|--------|
| ✅ **v1.0** | M0 · M1 · M2 | Persistenz · Monitoring-Tiefe · Device-/Notification-/Log-Center |
| ✅ **v2.0** | M3 · M4 | RGB/WLED · Automation v2 + Layout-Profile |
| ✅ **v3.0** | M5 · M6 | ESP32/MQTT + Sensor-Hub + Simulator · Firmware + Plugin-Marktplatz |

**Nächste Ausbaustufen (offen):** echte Anbindung weiterer Credential-Plugins (Discord/Hue/…)
— **Spotify ist bereits live** (siehe [SPOTIFY.md](./SPOTIFY.md)) —,
ESP32-Firmware-Sketch (PlatformIO) für echte Hardware, optionaler „Musikmodus".

---

## Lizenz

MIT – siehe [LICENSE](./LICENSE)
