# Installation & Deployment Guide

## System Requirements

- Node.js 18+
- npm or yarn
- 512MB RAM minimum
- 1GB disk space

## Development Installation

### 1. Clone or download the repository

### 2. Install dependencies

```bash
npm install
```

This will install dependencies for all workspaces (backend, frontend, agent, shared).

### 3. Setup environment variables

Backend:
```bash
cp apps/backend/.env.example apps/backend/.env
# Edit apps/backend/.env with your settings
```

Frontend:
```bash
cp apps/frontend/.env.example apps/frontend/.env.local
# Set NEXT_PUBLIC_API_URL if needed
```

Agent:
```bash
cp apps/agent/.env.example apps/agent/.env
# Edit with your backend URL and agent name
```

### 4. Start development servers

Start backend:
```bash
npm run dev --workspace=apps/backend
```

Start frontend (in another terminal):
```bash
npm run dev --workspace=apps/frontend
```

Access the dashboard at http://localhost:3000

## Production Deployment

### 1. Build all packages

```bash
npm run build
```

### 2. Start backend in production

```bash
cd apps/backend
npm run build
NODE_ENV=production npm start
```

### 3. Build and start frontend

```bash
cd apps/frontend
npm run build
npm start
```

### 4. Deploy agent to remote machines

```bash
cd apps/agent
npm run build
# Copy dist/ and .env to remote machine
# Run: node dist/index.js
```

## Docker Deployment (Optional)

Create Dockerfile for backend:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build --workspace=apps/backend
EXPOSE 3001
CMD ["node", "apps/backend/dist/index.js"]
```

Build and run:
```bash
docker build -t descos-backend .
docker run -p 3001:3001 descos-backend
```

## Database Setup

SQLite is automatically initialized on first run. For PostgreSQL:

1. Install PostgreSQL
2. Create database: `createdb descos`
3. Update DATABASE_URL in .env
4. Run migrations (if available)

## Troubleshooting

### Backend won't start
- Check NODE_ENV is set correctly
- Ensure port 3001 is available
- Check .env file is properly configured

### Frontend can't connect
- Verify NEXT_PUBLIC_API_URL is correct
- Check backend is running
- Clear browser cache

### Agent connection failed
- Verify BACKEND_URL is reachable
- Check firewall settings
- Ensure agent credentials are correct

## Monitoring

View logs:
```bash
# Backend
tail -f logs/backend.log

# Frontend (Browser console)
# Open DevTools F12
```

## Performance Tuning

- Increase event history limit for more data retention
- Adjust polling intervals for agents
- Use production database for large deployments
- Enable caching on frontend

## Security Considerations

1. Change default credentials
2. Use HTTPS in production
3. Setup authentication for API
4. Use VPN for remote connections
5. Enable firewall rules
6. Keep dependencies updated

```bash
npm audit
npm audit fix
```
