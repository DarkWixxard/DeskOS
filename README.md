# DeskOS - Modular Monitoring & Control System

Ein vollständig modulares Monitoring- und Steuerungssystem für:
- Haupt-PC
- Remote-PCs
- ESP32-Controller
- Sensoren
- Displays
- LEDs
- Audio
- Automationen

## Struktur

```
DeskOS/
├── apps/
│   ├── backend/        # Node.js + TypeScript Backend
│   ├── frontend/       # React + Next.js Dashboard
│   └── agent/          # Remote PC Agent
├── packages/
│   └── shared/         # Gemeinsame Types und Utils
└── plugins/            # Plugin System
```

## Schnellstart

### Backend
```bash
cd apps/backend
npm install
npm run dev
```

### Frontend
```bash
cd apps/frontend
npm install
npm run dev
```

## Tech Stack

- **Frontend**: React, Next.js, TailwindCSS, Framer Motion, Zustand, Recharts
- **Backend**: Node.js, TypeScript, Express, Socket.IO, MQTT
- **Database**: SQLite (initial), PostgreSQL (production)
- **Hardware**: ESP32, Raspberry Pi, WS2812B LEDs, OLED Displays
