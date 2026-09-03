@echo off
REM DeskOS - Remote-PC-Agent starten (Windows).
REM
REM Doppelklick auf einem Remote-PC: prueft Node.js, laesst den Agent-Launcher
REM fehlende Abhaengigkeiten nachinstallieren und startet den Agent im Vordergrund.
REM Beenden mit Strg+C.
setlocal
set "AGENT_DIR=%~dp0..\..\apps\agent"

if not exist "%AGENT_DIR%\package.json" (
    echo Agent-Ordner nicht gefunden: %AGENT_DIR%
    echo Dieses Skript gehoert in das DeskOS-Repository ^(deploy\windows^).
    pause
    exit /b 1
)

node --version > nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js ist nicht installiert oder nicht im PATH.
    echo Bitte Node.js 18+ installieren: https://nodejs.org/
    pause
    exit /b 1
)

pushd "%AGENT_DIR%"
echo Starting DeskOS agent...
echo Backend-URL / Agent-Name stehen in: %AGENT_DIR%\.env
call npm run dev
popd

endlocal
pause
