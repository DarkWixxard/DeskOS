# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
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
