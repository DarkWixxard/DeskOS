@echo off
REM DeskOS - start the servers, then open the dashboard in kiosk mode.
REM This is the entry point used by the autostart shortcut.
set "HERE=%~dp0"
call "%HERE%start-descos.bat"
call "%HERE%start-kiosk.bat"
