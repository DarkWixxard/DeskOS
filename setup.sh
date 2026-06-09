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
npm run build

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Start backend: npm run start --workspace=apps/backend"
echo "2. Start frontend: npm run dev --workspace=apps/frontend"
echo "3. Access dashboard: http://localhost:3000"
