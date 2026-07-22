@echo off
REM DeskOS - zeigt die angeschlossenen Monitore mit der Nummer und den Koordinaten,
REM die der Kiosk verwendet. Nutze die angezeigte "Monitor"-Nummer fuer
REM DESCOS_KIOSK_MONITOR oder die exakten X,Y fuer DESCOS_KIOSK_POSITION (in der .env).
echo Angeschlossene Monitore:
echo.
powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $i=0; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $i++; $p = if ($_.Primary) { ' (Primaer)' } else { '' }; 'Monitor {0}: X={1} Y={2}  {3}x{4}{5}' -f $i, $_.Bounds.X, $_.Bounds.Y, $_.Bounds.Width, $_.Bounds.Height, $p }"
echo.
echo Setze in der .env z.B. DESCOS_KIOSK_POSITION=887,1080  (oder DESCOS_KIOSK_POSITION=X,Y).
echo Der untere Bildschirm hat eine positive Y-Zahl - das ist in der Regel Monitor 3.
pause
