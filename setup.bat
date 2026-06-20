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

REM Zentrale Port-Konfiguration (Root-.env) - Single Source of Truth
if not exist ".env" (
    copy ".env.example" ".env" >nul
    echo ✅ Created .env (zentrale Port-Konfiguration)
)
set "BACKEND_PORT=4001"
set "FRONTEND_PORT=4000"
for /f "usebackq tokens=1,2 delims==" %%A in (".env") do (
    if /i "%%A"=="BACKEND_PORT"  set "BACKEND_PORT=%%B"
    if /i "%%A"=="FRONTEND_PORT" set "FRONTEND_PORT=%%B"
)

if not exist "apps\backend\.env" (
    copy "apps\backend\.env.example" "apps\backend\.env" >nul
    echo ✅ Created apps\backend\.env
)

if not exist "apps\frontend\.env.local" (
    type nul > "apps\frontend\.env.local"
    echo ✅ Created apps\frontend\.env.local
)

if not exist "apps\agent\.env" (
    copy "apps\agent\.env.example" "apps\agent\.env" >nul
    echo ✅ Created apps\agent\.env
)

REM Build
echo.
echo 🔨 Building projects...
REM Backend-Port ins Frontend-Bundle einbacken (Build-Zeit-Variable).
set "NEXT_PUBLIC_BACKEND_PORT=%BACKEND_PORT%"
call npm run build

echo.
echo ✅ Setup complete!
echo.
echo Next steps:
echo 1. Start (Entwicklung): npm run dev
echo 2. Dashboard: http://localhost:%FRONTEND_PORT%
echo.
echo Ports aendern? Werte in .env anpassen (FRONTEND_PORT/BACKEND_PORT).
echo.
pause
