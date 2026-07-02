# Quick Start Guide

## Prerequisites

- Node.js 18+ ([Download](https://nodejs.org/))
- npm (comes with Node.js)
- Git (optional)

## 5-Minute Setup

### Option 1: Local Development (Recommended)

1. **Extract/Clone DeskOS**
   ```bash
   cd DeskOS
   ```

2. **Run setup script**
   
   **Windows:**
   ```bash
   setup.bat
   ```
   
   **macOS/Linux:**
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```

3. **Start backend** (Terminal 1)
   ```bash
   npm run dev --workspace=apps/backend
   ```
   
   Wait for: `✅ Server listening on http://localhost:4001`

4. **Start frontend** (Terminal 2)
   ```bash
   npm run dev --workspace=apps/frontend
   ```
   
   Wait for: `ready - started server on 0.0.0.0:4000`

5. **Open in browser**
   - Dashboard: http://localhost:4000
   - Backend API: http://localhost:4001

### Option 2: Docker (Single Command)

```bash
docker-compose up
```

Access:
- Dashboard: http://localhost:4000
- Backend API: http://localhost:4001

### Option 3: Production Build

```bash
npm run build

# Start backend
cd apps/backend
NODE_ENV=production npm start

# Start frontend (in another terminal)
cd apps/frontend
npm start
```

## Testing the System

### 1. Check Backend Health
```bash
curl http://localhost:4001/health
```

### 2. View Dashboard
Open http://localhost:4000 in your browser

### 3. Check Devices
```bash
curl http://localhost:4001/api/devices
```

### 4. Monitor System Metrics
```bash
curl http://localhost:4001/api/system/metrics
```

### 5. View Event History
```bash
curl http://localhost:4001/api/events
```

## Troubleshooting

### Backend won't start
```bash
# Check if port 4001 is available
netstat -an | grep 4001

# Ports zentral ändern: in der Root-.env z. B. BACKEND_PORT=4500 setzen, dann:
npm run dev
```

### Frontend can't connect
```bash
# Clear Next.js cache
rm -rf apps/frontend/.next

# Restart frontend
npm run dev --workspace=apps/frontend
```

### Node modules issues
```bash
# Clean reinstall
rm -rf node_modules package-lock.json
npm install
```

## Deploy Remote Agent

### 1. On Remote PC

```bash
# Navigate to agent directory
cd apps/agent

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your backend URL:
# BACKEND_URL=http://your-backend-ip:4001
```

### 2. Start Agent
```bash
npm run dev
```

Or for production:
```bash
npm run build
NODE_ENV=production node dist/index.js
```

### 3. Verify in Dashboard
Go to http://localhost:4000 and check the Devices section.

## Next Steps

1. **Explore the Dashboard**
   - View system metrics
   - Monitor connected devices
   - Check event history

2. **Add More Remote PCs**
   - Deploy agent to additional machines
   - Watch them appear in the dashboard

3. **Customize**
   - Create plugins
   - Build custom widgets
   - Setup automations

4. **Connect Hardware** (Optional)
   - ESP32 devices
   - LED strips
   - Displays
   - Sensors

## Resources

- [Full Documentation](../README.md)
- [API Documentation](./API.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Contributing Guide](./CONTRIBUTING.md)

## Support

For issues:
1. Check logs in the terminal
2. Read error messages carefully
3. Check [Troubleshooting](#troubleshooting) section
4. Review documentation

## Architecture Overview

```
┌─────────────────────┐
│  Browser/Dashboard  │
│   (http://localhost:4000)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   React Frontend    │
│   (Next.js)         │
└──────────┬──────────┘
           │ WebSocket
           ▼
┌─────────────────────┐        ┌──────────────┐
│  Node.js Backend    │◄─────►│   SQLite DB  │
│  (localhost:4001)   │        └──────────────┘
└──────────┬──────────┘
           │
     ┌─────┴─────┬──────────┐
     ▼           ▼          ▼
┌─────────┐ ┌────────┐ ┌──────────┐
│ Local   │ │ Remote │ │ ESP32    │
│Monitor  │ │ Agents │ │ Devices  │
└─────────┘ └────────┘ └──────────┘
```

## Performance Tips

- Limit device data history: Edit `maxDataPoints` in DeviceManager
- Adjust monitoring interval: `MONITORING_INTERVAL` in .env
- Use SQLite for < 1M data points, PostgreSQL for more
- Enable caching on frontend
- Monitor logs for errors

## Common Commands

```bash
# Install dependencies
npm install

# Development
npm run dev
npm run dev --workspace=apps/backend
npm run dev --workspace=apps/frontend

# Build
npm run build

# Test
npm run test --workspace=apps/backend

# Lint
npm run lint

# Clean
rm -rf node_modules dist .next
npm install
```

Happy monitoring! 🚀
