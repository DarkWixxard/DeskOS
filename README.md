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

## Autostart & Kiosk-Modus

DeskOS kann beim Booten automatisch starten und das Dashboard im Vollbild
(Kiosk-Modus) anzeigen – z. B. auf einem Raspberry Pi oder Mini-PC am
Schreibtisch.

**Linux / Raspberry Pi:**
```bash
sudo ./deploy/linux/install.sh
```

**Windows:**
```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\install-autostart.ps1
```

Details, Autologin und Troubleshooting: siehe [KIOSK.md](./KIOSK.md).

## Tech Stack

- **Frontend**: React, Next.js, TailwindCSS, Framer Motion, Zustand, Recharts
- **Backend**: Node.js, TypeScript, Express, Socket.IO, MQTT
- **Database**: SQLite (initial), PostgreSQL (production)
- **Hardware**: ESP32, Raspberry Pi, WS2812B LEDs, OLED Displays
