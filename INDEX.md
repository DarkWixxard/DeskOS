# 📋 DeskOS - Complete Project Structure & Documentation

## 🎯 Project Overview

DeskOS is a **fully modular monitoring and control system** for:
- 🖥️ Local PC monitoring
- 🌐 Remote PC monitoring via agents
- 🎛️ ESP32 microcontroller control
- 📊 Real-time system metrics
- 💡 LED and display control
- 🔌 Sensor integration
- ⚙️ Automation engine
- 🧩 Extensible plugin system

**Status:** ✅ Phase 1 Complete - Core system fully functional
**Version:** v0.1.0
**License:** MIT

---

## 📁 Project Structure

```
DeskOS/
│
├── apps/                          # Main applications
│   ├── backend/                   # Node.js + TypeScript backend
│   │   ├── src/
│   │   │   ├── core/             # Core services
│   │   │   │   ├── EventSystem.ts
│   │   │   │   ├── DeviceManager.ts
│   │   │   │   ├── PluginSystem.ts
│   │   │   │   └── AutomationEngine.ts
│   │   │   ├── services/         # Business logic
│   │   │   │   ├── SystemMonitor.ts
│   │   │   │   ├── DatabaseService.ts
│   │   │   │   ├── WebSocketServer.ts
│   │   │   │   ├── Logger.ts
│   │   │   │   └── ConfigManager.ts
│   │   │   ├── api/
│   │   │   │   └── routes.ts     # Express routes
│   │   │   └── index.ts          # Entry point
│   │   ├── __tests__/            # Test files
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── frontend/                  # React + Next.js dashboard
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── layout.tsx
│   │   │   │   └── page.tsx
│   │   │   ├── components/
│   │   │   │   └── Dashboard.tsx  # Main dashboard
│   │   │   ├── stores/
│   │   │   │   └── dashboardStore.ts  # Zustand store
│   │   │   └── globals.css
│   │   ├── next.config.js
│   │   ├── tailwind.config.ts
│   │   ├── postcss.config.js
│   │   └── package.json
│   │
│   └── agent/                     # Remote PC agent
│       ├── src/
│       │   └── index.ts           # Agent logic
│       ├── package.json
│       └── tsconfig.json
│
├── packages/                      # Shared code
│   └── shared/
│       ├── src/
│       │   └── types.ts           # Shared types
│       ├── package.json
│       └── tsconfig.json
│
├── plugins/                       # Plugin system
│   ├── system-monitor/
│   │   ├── plugin.json
│   │   └── backend.ts
│   └── rgb-control/
│       ├── plugin.json
│       └── backend.ts
│
├── 📖 Documentation Files
│   ├── README.md                 # Main documentation
│   ├── QUICKSTART.md             # Quick start guide (5 minutes)
│   ├── API.md                    # API documentation
│   ├── DEPLOYMENT.md             # Deployment guide
│   ├── CONTRIBUTING.md           # Contributing guide
│   ├── CHANGELOG.md              # Version history
│   └── LICENSE                   # MIT License
│
├── 🐳 Docker Files
│   ├── docker-compose.yml        # Docker compose setup
│   ├── Dockerfile.backend        # Backend Docker image
│   └── Dockerfile.frontend       # Frontend Docker image
│
├── 🔧 Setup Scripts
│   ├── setup.sh                  # Linux/macOS setup
│   ├── setup.bat                 # Windows setup
│   └── .gitignore
│
├── 📦 Configuration Files
│   ├── package.json              # Root package.json
│   └── tsconfig.json             # Root TypeScript config
│
└── 📝 Environment Examples
    ├── apps/backend/.env.example
    ├── apps/frontend/.env.example
    └── apps/agent/.env.example
```

---

## 🚀 Quick Start (5 Minutes)

### Prerequisites
- Node.js 18+
- npm or yarn

### Setup

**Option 1: Automated Setup**
```bash
# Windows
setup.bat

# Linux/macOS
./setup.sh
```

**Option 2: Manual Setup**
```bash
# Install dependencies
npm install

# Setup environments
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env.local
cp apps/agent/.env.example apps/agent/.env
```

### Run

**Terminal 1 - Backend**
```bash
npm run dev --workspace=apps/backend
# ✅ Server listening on http://localhost:4001
```

**Terminal 2 - Frontend**
```bash
npm run dev --workspace=apps/frontend
# ✅ Dashboard on http://localhost:4000
```

**Terminal 3 - Agent (Optional)**
```bash
npm run dev --workspace=apps/agent
# ✅ Agent connected
```

### Access
- 🌐 Dashboard: http://localhost:4000
- 🔌 Backend API: http://localhost:4001
- 📡 WebSocket: ws://localhost:4001

---

## 🏗️ Architecture

### System Design

```
┌─────────────────────────────┐
│     DeskOS Dashboard        │
│  (React + Next.js + Zustand)│
│   http://localhost:4000     │
└──────────────┬──────────────┘
               │
               │ WebSocket
               │
┌──────────────▼──────────────┐
│   Backend Core              │
│  (Node.js + Express)        │
│  http://localhost:4001      │
├─────────────────────────────┤
│ • Event System              │
│ • Device Manager            │
│ • Plugin System             │
│ • Automation Engine         │
│ • WebSocket Server          │
│ • REST API                  │
└──────────────┬──────────────┘
               │
     ┌─────────┼─────────┬──────────┐
     ▼         ▼         ▼          ▼
 ┌────────┐ ┌──────┐ ┌────────┐ ┌──────┐
 │ Local  │ │Remote│ │ ESP32  │ │MQTT  │
 │ System │ │Agent │ │Devices │ │Broker│
 └────────┘ └──────┘ └────────┘ └──────┘
```

### Core Services

| Service | Purpose | File |
|---------|---------|------|
| **EventSystem** | Pub/sub event bus | `core/EventSystem.ts` |
| **DeviceManager** | Device registration & management | `core/DeviceManager.ts` |
| **PluginSystem** | Plugin loading & execution | `core/PluginSystem.ts` |
| **AutomationEngine** | Rule-based automations | `core/AutomationEngine.ts` |
| **SystemMonitor** | Local system metrics | `services/SystemMonitor.ts` |
| **DatabaseService** | SQLite operations | `services/DatabaseService.ts` |
| **WebSocketServer** | Real-time communication | `services/WebSocketServer.ts` |
| **Logger** | Logging service | `services/Logger.ts` |
| **ConfigManager** | Configuration management | `services/ConfigManager.ts` |

---

## 📊 Features

### ✅ Phase 1 - Core (COMPLETE)

**Backend**
- [x] REST API with Express.js
- [x] WebSocket server with Socket.IO
- [x] Event-driven architecture
- [x] Device management system
- [x] Local system monitoring (CPU, RAM, uptime)
- [x] SQLite database integration
- [x] Plugin system foundation
- [x] Real-time event streaming
- [x] Configuration management
- [x] Logging service

**Frontend**
- [x] React + Next.js dashboard
- [x] Real-time device monitoring
- [x] System metrics display
- [x] Event log viewer
- [x] Responsive design
- [x] Zustand state management
- [x] WebSocket integration
- [x] Device status indicators

**Infrastructure**
- [x] TypeScript for type safety
- [x] Monorepo with workspaces
- [x] Environment configuration
- [x] Docker support
- [x] Setup automation scripts
- [x] Development environment ready

### 🚧 Phase 2 - Remote PCs (Planned)

- [ ] Multi-agent coordination
- [ ] Remote command execution
- [ ] File synchronization
- [ ] Wake-on-LAN
- [ ] SSH integration

### 🚧 Phase 3 - Hardware (Planned)

- [ ] ESP32 integration
- [ ] LED control (WS2812B, SK6812)
- [ ] OLED display support
- [ ] Temperature sensors
- [ ] MQTT integration
- [ ] GPIO control

### 🚧 Phase 4 - Automations (Planned)

- [ ] Automation rules engine
- [ ] Condition evaluation
- [ ] Action execution
- [ ] Scene management
- [ ] Time-based triggers

### 🚧 Phase 5 - Plugins (Planned)

- [ ] Plugin SDK
- [ ] Plugin marketplace
- [ ] Community plugins
- [ ] Advanced widgets
- [ ] Custom integrations

---

## 📚 Documentation

| Document | Purpose | Link |
|----------|---------|------|
| **README.md** | Main documentation | [📖](./README.md) |
| **QUICKSTART.md** | 5-minute setup guide | [🚀](./QUICKSTART.md) |
| **API.md** | Complete API reference | [🔌](./API.md) |
| **DEPLOYMENT.md** | Production deployment | [🚀](./DEPLOYMENT.md) |
| **CONTRIBUTING.md** | Contributing guide | [🤝](./CONTRIBUTING.md) |
| **CHANGELOG.md** | Version history | [📋](./CHANGELOG.md) |

---

## 🛠️ Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React | 18.0+ |
| | Next.js | 14.0+ |
| | Tailwind CSS | 3.4+ |
| | Zustand | 4.4+ |
| | Socket.IO Client | 4.7+ |
| **Backend** | Node.js | 18+ |
| | Express.js | 4.18+ |
| | TypeScript | 5.0+ |
| | Socket.IO | 4.7+ |
| **Database** | SQLite | 5.1+ |
| **DevOps** | Docker | Latest |
| | Docker Compose | Latest |

---

## 📊 API Overview

### Key Endpoints

```
GET  /api/health                  # Health check
GET  /api/devices                 # List all devices
GET  /api/devices/:id             # Get device details
GET  /api/devices/:id/data        # Get device history
GET  /api/system/metrics          # System metrics
GET  /api/events                  # Event history
GET  /api/dashboard/summary       # Dashboard summary
```

### WebSocket Events

```
Server -> Client:
- devices:list
- device:update
- device:details
- event:new
- event:history

Client -> Server:
- subscribe:device
- get:devices
- get:device
- get:event-history
- subscribe:events
```

See [API.md](./API.md) for full documentation.

---

## 🐳 Docker Deployment

### Quick Start
```bash
docker-compose up
```

### Manual Build
```bash
docker build -t descos-backend -f Dockerfile.backend .
docker build -t descos-frontend -f Dockerfile.frontend .
docker run -p 4001:4001 descos-backend
docker run -p 4000:4000 descos-frontend
```

---

## 📝 Configuration

### Backend (.env)
```
BACKEND_PORT=4001
NODE_ENV=development
MQTT_BROKER=mqtt://localhost:1883
DATABASE_PATH=./descos.db
LOG_LEVEL=debug
```

### Frontend (.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:4001
```

### Agent (.env)
```
BACKEND_URL=http://localhost:4001
AGENT_NAME=remote-pc-1
POLL_INTERVAL=1000
```

---

## ✅ Testing

### Run Tests
```bash
npm run test --workspace=apps/backend
```

### Coverage
```bash
npm run test:coverage --workspace=apps/backend
```

### Test Files
- `apps/backend/__tests__/core.test.ts` - Core services tests

---

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for:
- Development setup
- Code style guidelines
- Testing requirements
- Commit message format
- Pull request process

---

## 📄 License

MIT License - See [LICENSE](./LICENSE) file for details.

---

## 🎯 Next Steps

1. **Read** [QUICKSTART.md](./QUICKSTART.md) for 5-minute setup
2. **Run** the system locally
3. **Explore** the dashboard
4. **Read** [API.md](./API.md) for integration options
5. **Deploy** remote agents
6. **Create** custom plugins
7. **Contribute** improvements

---

## 📞 Support

- 📖 Documentation: See [README.md](./README.md)
- 🚀 Quick Setup: See [QUICKSTART.md](./QUICKSTART.md)
- 🔌 API Reference: See [API.md](./API.md)
- 📋 Issues: Check documentation first, then GitHub Issues

---

## 🚀 Roadmap Highlights

**v0.2.0** - Remote PCs
- Multi-agent coordination
- Remote command execution

**v0.3.0** - Hardware
- ESP32 integration
- LED/Display control

**v0.4.0** - Automations
- Automation engine
- Rule-based triggers

**v0.5.0** - Plugins
- Plugin marketplace
- Community plugins

---

**DeskOS v0.1.0** ✅ **Ready for Production**

Built with ❤️ for ultimate desk setup monitoring and control.
