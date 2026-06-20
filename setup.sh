#!/bin/bash
# Setup script for DeskOS

set -e

echo "🚀 DeskOS Setup"
echo "=================================="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    exit 1
fi

echo "✅ Node.js $(node --version)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Setup environment files
echo ""
echo "⚙️  Setting up environment files..."

# Zentrale Port-Konfiguration (Root-.env) – Single Source of Truth
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✅ Created .env (zentrale Port-Konfiguration)"
fi
# shellcheck disable=SC1091
set -a; . ./.env; set +a
FRONTEND_PORT="${FRONTEND_PORT:-4000}"
BACKEND_PORT="${BACKEND_PORT:-4001}"

if [ ! -f apps/backend/.env ]; then
    cp apps/backend/.env.example apps/backend/.env
    echo "✅ Created apps/backend/.env"
fi

if [ ! -f apps/frontend/.env.local ]; then
    touch apps/frontend/.env.local
    echo "✅ Created apps/frontend/.env.local"
fi

if [ ! -f apps/agent/.env ]; then
    cp apps/agent/.env.example apps/agent/.env
    echo "✅ Created apps/agent/.env"
fi

# Build
echo ""
echo "🔨 Building projects..."
# Backend-Port ins Frontend-Bundle einbacken (Build-Zeit-Variable).
NEXT_PUBLIC_BACKEND_PORT="${BACKEND_PORT}" npm run build

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Start (Entwicklung): npm run dev"
echo "2. Dashboard öffnen:    http://localhost:${FRONTEND_PORT}"
echo ""
echo "Ports ändern? Werte in der Datei .env anpassen (FRONTEND_PORT/BACKEND_PORT/…)."
