# DeskOS – Roadmap & Machbarkeit

> Vom Monitoring-Dashboard zum **„Betriebssystem für den Schreibtisch"**.
>
> Dieses Dokument hält fest, **was DeskOS werden soll**, **was heute real existiert**,
> **was noch fehlt** und in **welcher Reihenfolge** der Ausbau sinnvoll ist.
> Es ist die verbindliche Planungsgrundlage – der Code folgt den hier definierten
> Meilensteinen `M0`–`M6`.

---

## 1. Vision

DeskOS ist kein simples CPU/RAM-Widget, sondern ein modulares System für den gesamten
Schreibtisch: lokales **und** Multi-PC-Monitoring, Geräte-/Modul-Verwaltung, RGB-/LED-Steuerung,
Automationen, Layout-Profile, Notification- & Log-Center, Sensor-Hub und ein erweiterbares
Plugin-System – gegliedert in drei Ausbaustufen (v1.0 / v2.0 / v3.0).

**Aktuelle Hardware:** 2× **WLED**-Lichter (Ambient + Zimmerlicht), die unabhängig steuerbar
sein sollen. Ein generischer ESP32 (Sensor-/Display-/Makro-Node) folgt später; bis dahin wird
alles per **Simulator** entwickelt und getestet.

---

## 2. Machbarkeit – kurzes Urteil

| Bereich | Machbar? | Anmerkung |
|---------|----------|-----------|
| Komplette **Software** aller Bereiche (Backend, Dashboard, Automation, RGB-Logik, Notification/Log, Layout, Plugins, MQTT, Firmware-Verwaltung) | ✅ Ja | inkl. ESP32-Firmware **als Code** (PlatformIO/Arduino) |
| **WLED-Steuerung** der 2 Lichter | ✅ Ja | sofort, ohne weitere Hardware – via WLED-JSON-API/MQTT |
| Generische ESP32-/Sensor-Nodes **ohne Hardware** entwickeln/testen | ✅ Ja | via Node-Simulator |
| Physisches: löten, verkabeln, auf echte Chips flashen | ❌ Nein | Code wird geliefert, Hardware-Handling bleibt beim Nutzer |
| „Musikmodus" (LEDs reagieren live auf Ton) | ⚠️ Aufwändig | Audio-Capture ist plattformabhängig → später/optional |

---

## 3. Ist-Zustand (echter Code, nicht nur Doku)

### Trägt schon – real implementiert
- **Event-System** – Pub/Sub mit History & Wildcards · `apps/backend/src/core/EventSystem.ts`
- **Device-Manager** – Registry + Datenhistorie (in-memory) · `core/DeviceManager.ts`
- **Plugin-Loader** – dynamisches Laden aus `plugin.json` · `core/PluginSystem.ts`
- **Multi-PC im Ansatz** – `WebSocketServer` nimmt `register-agent` + `metrics` an; `apps/agent` sendet Metriken
- **REST-API** – Devices, System-Metriken, Events, Dashboard-Summary, Automations-CRUD · `api/routes.ts`
- **Holografisches Dashboard + Overlay-Menü** · `apps/frontend/src/components/`
- **Oszilloskop-Integration** (Bonus) · `services/oszi`, `OsziView`

### Stub / fehlt / nicht verdrahtet
| Thema | Status |
|-------|--------|
| Monitoring-Tiefe (GPU, Temp, Lüfter, Netz-Durchsatz, Prozesse) | ❌ nur CPU/RAM/Disk/Uptime via Node-`os` |
| Persistenz | ⚠️ SQLite-Schema da (`DatabaseService`), aber **nicht angeschlossen** – alles im RAM |
| MQTT (ESP32-Transport) | ⚠️ Dependency vorhanden, **nicht implementiert** |
| Overlay-Kacheln (RGB, Sensors, Scenes, Alerts, Plugins, Network, Storage …) | ❌ **Platzhalter** ohne echte View (nur `oszi` öffnet wirklich etwas) |
| RGB / Automation-Aktionen / Layout / Notification / Log-View / Sensor-Hub / Firmware / Modul-Manager | ❌ Stub oder nicht vorhanden |
| Typ-Definitionen | ⚠️ `Device`/`SystemMetrics` 3× dupliziert (`packages/shared`, `DeviceManager`, `dashboardStore`) |

---

## 4. Die 12 Vision-Bereiche → Status & Meilenstein

| # | Bereich | Status heute | Geplant in |
|---|---------|--------------|-----------|
| 1 | Monitoring Center | Teilweise (CPU/RAM/Disk) | **M1** |
| 2 | Device Center | Backend-Registry da, UI fehlt | **M2** |
| 3 | RGB Engine | Stub (15 Zeilen) | **M3** |
| 4 | Automation Engine | Minimal (threshold→emit_event) | **M4** |
| 5 | Module Manager | Fehlt | **M5** |
| 6 | Layout System | Fehlt (`activeView`-Hook vorhanden) | **M4** |
| 7 | Notification Center | Fehlt | **M2** |
| 8 | Log System | Schema da, nicht angeschlossen | **M0/M2** |
| 9 | Plugin System | Loader da, nur Stub-Plugins | **M6** |
| 11 | Firmware Center | Fehlt | **M6** |
| 12 | Sensor Hub | Fehlt (`sensor`-Devicetyp vorhanden) | **M5** |

---

## 5. Architektur-Prinzipien für den Ausbau

- **Event-Bus bleibt das Herz** – jede neue Domäne (RGB, Sensor, Notification) kommuniziert über `eventSystem`, keine direkte Kopplung.
- **`packages/shared` = einzige Typquelle** – Duplikate auflösen, neue Typen dort.
- **Persistenz zuerst** – Logs, History und Regeln müssen Neustarts überleben.
- **Geräte-Abstraktion wiederverwenden** – WLED, ESP32 und Sensoren sind `Device`s mit `capabilities`, kein paralleles Modell.
- **Frontend auf Vorhandenem aufbauen** – Holo-Komponenten (`holo.tsx`: `Panel`, `Sparkline`, `RadialGauge`, `StatBar`) und `activeView`/`deviceFilter` nutzen; Overlay-Kacheln Schritt für Schritt „scharf schalten".

---

## 6. Meilensteine (empfohlene Reihenfolge)

Reihenfolge nach **Abhängigkeit & Nutzen**. WLED ist bewusst nach vorne gezogen (M3),
weil die Hardware bereits vorhanden ist.

### M0 – Fundament: Cleanup & Persistenz  · *Basis für v1.0*
- `Device`/`SystemMetrics`/Event-Typen in `packages/shared` zusammenführen, Duplikate entfernen.
- `DatabaseService` an `DeviceManager` (Geräte + Datenpunkte), `EventSystem` (Logs) und `AutomationEngine` (Regeln) anschließen; Daten beim Start laden, mit Retention/Downsampling.
- **Warum zuerst:** geringes Risiko; alles Spätere (Logs, History, Regeln) baut darauf auf.

### M1 – Monitoring Center (Tiefe)  · *v1.0*
- `systeminformation` in Backend **und** Agent: GPU (Last/Temp/VRAM), CPU-Temp, Lüfter, pro-Disk-SSD, Netz-Durchsatz, Top-Prozesse; `os`-Fallback wenn Sensor fehlt.
- `SystemMetrics`-Typ erweitern; echte Views „System Monitor"/„Metrics"/„Network"/„Storage" (Recharts), pro Gerät.
- Overlay-Kacheln `monitor/metrics/network/storage` real verdrahten.

### M2 – Device Center + Notification + Log Center  · *v1.0 → v2.0*
- Geräte-Detailansicht mit Tabs **Infos / Einstellungen / Logs / (Firmware-Platzhalter)**.
- `NotificationService` + `/api/notifications` + WS-Push + Notification-Center-UI (Glocke/`alerts`-Kachel).
- Durchsuchbare/filterbare **Log-View** auf Basis der persistierten Logs.

### M3 – RGB-Engine + WLED (deine 2 Lichter)  · *v2.0 – vorgezogen*
- `WledService`: Steuerung über WLED-**JSON-API** (`/json/state`: Power, Helligkeit, Farbe, Effekt, Preset); je Licht eine Config („Ambient", „Zimmerlicht") per IP/Name, **unabhängig** steuerbar. WLED als `Device` (type `esp32`, capability `led`).
- RGB-Engine mit **Modi**: Manuell, Temperatur (an Metriken gekoppelt), Alarm; danach Download/Gaming; **Musikmodus optional/später**.
- Frontend-RGB-View: Farb-/Effekt-Picker pro Licht + Modus-Auswahl.

### M4 – Automation-Engine v2 + Layout/Profile-System  · *v2.0*
- Trigger: threshold (vorhanden) + Event + Zeitplan (cron) + Gerätestatus + Tageszeit.
- Aktionen: emit_event (vorhanden) + WLED/RGB steuern + Notification senden + Layout wechseln + Szene ausführen + Agent-Command.
- Regeln persistent (M0); **No-Code-Regelbuilder** im Frontend.
- Layout-Profile (Gaming/Coding/Streaming/Work/Minimal): wechseln Dashboard-Layout **und** wenden Szene an (RGB + Automationen); nutzt `activeView`.

### M5 – ESP32/MQTT + Sensor-Hub + Modul-Manager (+ Simulator)  · *v3.0*
- `MqttService` (Broker-Anbindung) + Topic-Schema für Nodes.
- **ESP32-Simulator** (Node-Skript): sendet Sensor-Daten, nimmt LED/Display-Commands an → komplett ohne Hardware testbar.
- Sensor-Hub: Aufnahme von Sensor-Nodes (Temp/Feuchte/CO₂/Licht/Lautstärke) + Aggregation/UI.
- Modul-Manager: Module als Sub-Capabilities eines Nodes, Auto-Registrierung bei „announce".
- Sobald echter ESP32 da ist: PlatformIO/Arduino-Firmware-Sketch dazu, Rest funktioniert bereits.

### M6 – Firmware-Center + Plugin-System v2 + „Marktplatz"  · *v3.0*
- Firmware-Center: Neustart, WLAN-Konfig, OTA-Push (WLED-OTA + eigene Nodes).
- Plugin-SDK: Frontend-Widget-Plugins + Backend-Plugins, Manifest v2.
- Echte Plugins: Spotify, Discord, OBS, Steam, Home Assistant, Philips Hue.

---

## 7. Mapping auf die Versionen

| Version | Meilensteine | Inhalt |
|---------|-------------|--------|
| **v1.0** | M0 + M1 + M2 | tiefes Monitoring, Multi-PC, Device-Manager, Persistenz, Notification/Log |
| **v2.0** | M3 + M4 | RGB/WLED-Engine, Automation v2, Layout-Profile, Notification-Center |
| **v3.0** | M5 + M6 | Plugin-System, Sensor-Hub, Modul-Manager, Firmware-Center, generischer ESP32 |

---

## 8. WLED-Hinweise (für M3)

- WLED bringt eine dokumentierte **JSON-API** mit (`/json/state`, `/json/info`) → **keine eigene Firmware nötig**, direkte Steuerung von Power, Helligkeit, Farbe, Effekt und Presets.
- Beide Lichter werden als eigenständige `Device`s geführt und **unabhängig** angesteuert.
- Alternativ unterstützt WLED **MQTT** – wird relevant, sobald in M5 ohnehin ein Broker läuft.

**Vor dem Bau von M3 zu klären:**
- IP-Adressen / Namen der beiden Lichter.
- Sprechen **beide** die Standard-WLED-JSON-API, oder benötigt das „Obsidian"-Ambient-Light eine Hersteller-API?

---

## 9. Wiederverwendung (vorhandenes nutzen statt neu bauen)

| Baustein | Datei | Verwendung im Ausbau |
|----------|-------|----------------------|
| `eventSystem.emit/on` | `core/EventSystem.ts` | zentrale Verdrahtung aller neuen Features |
| `deviceManager.registerOrUpdateDevice` | `core/DeviceManager.ts` | auch für WLED/ESP32/Sensoren |
| `automationEngine` | `core/AutomationEngine.ts` | erweitern, nicht ersetzen |
| `DatabaseService` | `services/DatabaseService.ts` | Schema steht, nur anschließen |
| `holo.tsx`-Komponenten | `frontend/src/components/holo.tsx` | UI für neue Views |
| `dashboardStore` (`activeView`, `deviceFilter`, WS) | `frontend/src/stores/` | View-Wechsel & Live-Daten |

---

## 10. Status

- [ ] **M0** – Fundament: Cleanup & Persistenz
- [ ] **M1** – Monitoring Center (Tiefe)
- [ ] **M2** – Device Center + Notification + Log Center
- [ ] **M3** – RGB-Engine + WLED
- [ ] **M4** – Automation-Engine v2 + Layout-System
- [ ] **M5** – ESP32/MQTT + Sensor-Hub + Modul-Manager
- [ ] **M6** – Firmware-Center + Plugin-System v2

*Dieses Dokument ist die lebende Roadmap – Meilensteine werden beim Abschluss abgehakt.*
