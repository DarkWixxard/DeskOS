# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- 🛡️ **Pi-hole-Plugin**: bindet einen Pi-hole im LAN ein. Der neue `PiholeService`
  fragt Kennzahlen (Anfragen, Blockrate, Blocklisten-Domains, aktive Clients),
  Top-Domains/-Clients, Query-Typen, Upstreams und den 24-Stunden-Verlauf ab und
  **erkennt dabei selbst, ob Pi-hole v6 (FTL-REST unter `/api`, Session per
  `X-FTL-SID`) oder v5 (`/admin/api.php` mit `?auth=`) antwortet**. Neue
  **Pi-hole-Ansicht** (Overlay-Menü) mit Verlaufschart und Top-Listen plus ein
  Dashboard-Widget mit Blockrate-Gauge; Live-Updates per WebSocket
  (`pihole:update`). Das **DNS-Blocking lässt sich aus DeskOS pausieren**
  (30 s / 5 min / 1 h / dauerhaft) – auch als Automations-/Szenen-Aktion
  (`{ type: 'pihole' }`). Die Abfrage läuft bewusst über das Backend, damit weder
  CORS noch das App-Passwort das Frontend erreichen; URL und Passwort liegen in
  den Plugin-Settings (SQLite) und werden nie über die API zurückgegeben.
  Endpunkte unter `/api/pihole/*`. Dokumentiert in [PIHOLE.md](./PIHOLE.md).
- 🗂️ **deej `config.yaml`** (deej-kompatibel): Der Lautstärkeregler lässt sich jetzt
  auch über eine Datei im deej-Format konfigurieren (`slider_mapping` inkl.
  **App-Gruppen** als Liste, `invert_sliders`, `com_port`, `baud_rate`,
  `noise_reduction`). Wird beim Start gelesen (und beim ersten Mal als Vorlage
  angelegt), bei Änderungen **live neu geladen** (Datei-Watch) und ist dann
  maßgeblich gegenüber der UI. Neuer Regler-Typ **`deej.current`** (aktive App,
  Windows) und **Gruppen** (ein Regler steuert mehrere Prozesse). Beispiel:
  [`config.example.yaml`](../config.example.yaml). Neuer Endpunkt
  `POST /api/deej/reload-config`.
- 🎚️ **deej-Hardware-Lautstärkeregler**: bindet einen selbstgebauten
  [deej](https://github.com/omriharel/deej)-Regler ein. Das Backend liest die
  serielle Zeile (Werte 0–1023), normiert jeden Regler auf 0–100 % (optional
  invertiert + rauschgeglättet) und setzt die Lautstärke des OS über den neuen
  `AudioController` (Linux `pactl` inkl. pro-App, macOS `osascript`, Windows
  `nircmd`). Neue **Audio-Ansicht** mit Live-Fadern, Port-Auswahl und
  Regler-Mapping; Live-Updates per WebSocket (`deej:update`). `serialport` ist
  eine optionale Abhängigkeit – ohne Hardware lassen sich Regler ziehen/simulieren.
  Endpunkte unter `/api/deej/*`. Dokumentiert in [DEEJ.md](./DEEJ.md).
- 🔌 **API-Console**: eingebauter REST-Client im Dashboard. Methode + Pfad wählen,
  optional JSON-Body senden und Status, Dauer, Header sowie den formatierten
  Antwort-Body sehen – mit kuratiertem Endpunkt-Katalog und lokalem Anfrage-Verlauf.
  Erreichbar über das Overlay-Menü (SYSTEM → API Console). Bisher führte die
  Kachel nur zurück aufs Dashboard. Dokumentiert in [API-CONSOLE.md](./API-CONSOLE.md).
- 🎵 **Spotify-Plugin voll angebunden**: OAuth-2.0-Login (Authorization-Code-Flow),
  „Now Playing"-Widget (Cover, Titel, Interpret, Fortschritt) und
  Wiedergabesteuerung (Play/Pause/Vor/Zurück) über die Spotify Web API.
  Backend-`SpotifyService` mit automatischem Token-Refresh; Refresh-Token
  persistent gespeichert. Neue Endpunkte unter `/api/spotify/*`. Einrichtung
  dokumentiert in [SPOTIFY.md](./SPOTIFY.md).

## [0.1.0] - 2024-01-15

### Added
- ✨ Initial project structure with monorepo setup
- 🎯 Event System core with pub/sub architecture
- 🖥️ Device Manager for multi-device support
- 📊 System monitoring for local PC
- 🌐 WebSocket server for real-time communication
- ⚙️ Plugin system for extensibility
- 🎨 React dashboard with real-time updates
- 🤖 Remote PC agent for distributed monitoring
- 📝 SQLite database integration
- 🧪 Unit tests for core services
- 📚 Comprehensive API documentation
- 🐳 Docker support with docker-compose
- 📖 Quick Start guide
- 🔧 Setup scripts for Windows/Linux/macOS
- 📋 Deployment guide

### Features

**Backend**
- RESTful API with Express.js
- WebSocket real-time communication with Socket.io
- Event-driven architecture
- Plugin system
- System metrics collection
- Device management
- Event history tracking
- SQLite database

**Frontend**
- React + Next.js dashboard
- Real-time device monitoring
- System metrics visualization
- Event streaming
- Responsive design with Tailwind CSS
- Zustand state management
- WebSocket integration

**Agent**
- Remote PC monitoring
- Metrics collection (CPU, RAM, etc.)
- Command execution capability
- Lightweight footprint

### Configuration
- Environment-based configuration
- Support for multiple environments (dev, production)
- Configurable monitoring intervals
- Customizable logging levels

### Documentation
- API reference
- Deployment guide
- Contributing guide
- Quick start guide
- Architecture overview

## Future Roadmap

### Phase 2 - Remote PCs (v0.2.0)
- [ ] Multi-PC coordination
- [ ] Remote command execution
- [ ] File synchronization
- [ ] Wake-on-LAN support

### Phase 3 - Hardware (v0.3.0)
- [ ] ESP32 integration
- [ ] LED control (WS2812B, SK6812)
- [ ] OLED display support
- [ ] Sensor integration
- [ ] MQTT protocol support

### Phase 4 - Automations (v0.4.0)
- [ ] Automation engine
- [ ] Rule-based triggers
- [ ] Scene management
- [ ] Scheduled tasks

### Phase 5 - Plugins (v0.5.0)
- [ ] Plugin marketplace
- [ ] Community plugins
- [ ] Plugin SDK
- [ ] Advanced widget system

### Additional Features
- [ ] User authentication
- [ ] Role-based access control
- [ ] Mobile app (Flutter/React Native)
- [ ] Voice control integration
- [ ] AI/ML automation suggestions
- [ ] Performance analytics
- [ ] Advanced alerting system
- [ ] Custom dashboard themes
- [ ] Multi-user support
- [ ] Cloud synchronization

## Known Issues

- None at this stage (v0.1.0 is stable)

## Support

- GitHub Issues: [Report bugs](https://github.com/your-repo/issues)
- Documentation: See [README.md](../README.md)
- Quick Start: See [QUICKSTART.md](./QUICKSTART.md)

---

For detailed information about each version, see the [Releases](https://github.com/your-repo/releases) page.
