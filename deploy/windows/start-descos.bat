@echo off
REM DeskOS - start backend (port 3001) + frontend (port 3000) in the background.
setlocal
set "REPO_DIR=%~dp0..\.."
pushd "%REPO_DIR%"

REM Ensure a production build exists (first run builds automatically).
if not exist "apps\backend\dist"  goto needbuild
if not exist "apps\frontend\.next" goto needbuild
goto run

:needbuild
echo Building DeskOS (first run, this can take a few minutes)...
call npm install
call npm run build

:run
echo Starting DeskOS backend (port 3001)...
start "DeskOS Backend"  /min cmd /c "set NODE_ENV=production&& npm run start --workspace=apps/backend"
echo Starting DeskOS frontend (port 3000)...
start "DeskOS Frontend" /min cmd /c "set NODE_ENV=production&& npm run start --workspace=apps/frontend"

popd
endlocal
