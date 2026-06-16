@echo off
REM DeskOS - open the dashboard fullscreen (kiosk) in Chrome, falling back to Edge.
setlocal
set "URL=http://localhost:3000"

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
  start "" "%CHROME%" --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --disable-restore-session-state --check-for-update-interval=31536000 --user-data-dir="%LOCALAPPDATA%\descos-kiosk" "%URL%"
) else (
  echo Chrome not found - using Microsoft Edge...
  start "" msedge --kiosk %URL% --edge-kiosk-type=fullscreen --no-first-run
)
endlocal
