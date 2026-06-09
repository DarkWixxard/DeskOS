@echo off
REM Setup script for DeskOS on Windows

echo.
echo 🚀 DeskOS Setup
echo ==================================
echo.

REM Check Node.js
node --version > nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo ✅ Node.js %NODE_VERSION%

REM Install dependencies
echo.
echo 📦 Installing dependencies...
call npm install

REM Setup environment files
echo.
echo ⚙️  Setting up environment files...

if not exist "apps\backend\.env" (
    copy "apps\backend\.env.example" "apps\backend\.env"
    echo ✅ Created apps\backend\.env
)

if not exist "apps\frontend\.env.local" (
    type nul > "apps\frontend\.env.local"
    echo ✅ Created apps\frontend\.env.local
)

if not exist "apps\agent\.env" (
    copy "apps\agent\.env.example" "apps\agent\.env"
    echo ✅ Created apps\agent\.env
)

REM Build
echo.
echo 🔨 Building projects...
call npm run build

echo.
echo ✅ Setup complete!
echo.
echo Next steps:
echo 1. Start backend: npm run start --workspace=apps/backend
echo 2. Start frontend: npm run dev --workspace=apps/frontend
echo 3. Access dashboard: http://localhost:3000
echo.
pause
