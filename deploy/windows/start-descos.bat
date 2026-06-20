@echo off
REM DeskOS - start backend + frontend in the background.
REM Die Ports kommen zentral aus der Root-.env (Fallback Backend 4001 / Frontend 4000).
setlocal
set "REPO_DIR=%~dp0..\.."
pushd "%REPO_DIR%"

REM --- Zentrale Port-Konfiguration laden -----------------------------------
set "BACKEND_PORT=4001"
set "FRONTEND_PORT=4000"
if exist ".env" (
  for /f "usebackq tokens=1,2 delims==" %%A in (".env") do (
    if /i "%%A"=="BACKEND_PORT"  set "BACKEND_PORT=%%B"
    if /i "%%A"=="FRONTEND_PORT" set "FRONTEND_PORT=%%B"
  )
)

REM Ensure a production build exists (first run builds automatically).
if not exist "apps\backend\dist"  goto needbuild
if not exist "apps\frontend\.next" goto needbuild
goto run

:needbuild
echo Building DeskOS (first run, this can take a few minutes)...
call npm install
REM Backend-Port ins Frontend-Bundle einbacken (Build-Zeit-Variable).
set "NEXT_PUBLIC_BACKEND_PORT=%BACKEND_PORT%"
call npm run build

:run
echo Starting DeskOS backend (port %BACKEND_PORT%)...
start "DeskOS Backend"  /min cmd /c "set NODE_ENV=production&& set BACKEND_PORT=%BACKEND_PORT%&& npm run start --workspace=apps/backend"
echo Starting DeskOS frontend (port %FRONTEND_PORT%)...
start "DeskOS Frontend" /min cmd /c "set NODE_ENV=production&& set PORT=%FRONTEND_PORT%&& npm run start --workspace=apps/frontend"

popd
endlocal
