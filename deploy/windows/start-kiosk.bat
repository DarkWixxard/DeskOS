@echo off
REM DeskOS - open the dashboard fullscreen (kiosk) in Chrome, falling back to Edge.
setlocal
REM Frontend-Port + Fensterposition zentral aus der Root-.env; Umgebungsvariablen haben Vorrang.
set "FRONTEND_PORT=4000"
set "KIOSK_POS=%DESCOS_KIOSK_POSITION%"
if exist "%~dp0..\..\.env" (
  for /f "usebackq tokens=1,2 delims==" %%A in ("%~dp0..\..\.env") do (
    if /i "%%A"=="FRONTEND_PORT" set "FRONTEND_PORT=%%B"
    if not defined KIOSK_POS if /i "%%A"=="DESCOS_KIOSK_POSITION" set "KIOSK_POS=%%B"
  )
)
set "URL=%DESCOS_KIOSK_URL%"
if not defined URL set "URL=http://localhost:%FRONTEND_PORT%"

REM Optional: Kiosk auf einen bestimmten Monitor legen (X,Y = linke obere Ecke).
set "POSARG="
if defined KIOSK_POS set "POSARG=--window-position=%KIOSK_POS%"

echo Waiting for %URL% ...
set /a tries=0
:waitloop
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%URL%' ^| Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto ready
set /a tries+=1
if %tries% geq 60 goto ready
timeout /t 1 /nobreak >nul
goto waitloop

:ready
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe"      set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"  set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if defined CHROME (
  echo Launching Chrome in kiosk mode...
  start "" "%CHROME%" --kiosk %POSARG% --noerrdialogs --disable-infobars --disable-session-crashed-bubble --disable-restore-session-state --check-for-update-interval=31536000 --user-data-dir="%LOCALAPPDATA%\descos-kiosk" "%URL%"
) else (
  echo Chrome not found - using Microsoft Edge...
  start "" msedge --kiosk %POSARG% %URL% --edge-kiosk-type=fullscreen --no-first-run
)
endlocal
