# DeskOS - moves the kiosk browser window onto a specific monitor.
#
# Chrome/Edge ignore --window-position in --kiosk mode and always open on the
# primary display. This script waits for the kiosk window (identified by its
# dedicated user-data-dir, so it never touches your normal browser) and moves
# it onto the monitor that contains the given point via Win32 SetWindowPos.
param(
  [Parameter(Mandatory = $true)]
  [string]$Position,             # "X,Y" - a point that lies on the target monitor
  [string]$Match = "descos-kiosk",
  [int]$TimeoutSec = 25
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class KioskWin {
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int X, int Y, int cx, int cy, uint flags);
}
"@

# --- Resolve the target monitor from the point -----------------------------
$parts = $Position -split ','
if ($parts.Count -lt 2) { Write-Host "kiosk-place: ungueltige Position '$Position'"; exit 1 }
$px = [int]$parts[0].Trim()
$py = [int]$parts[1].Trim()
$screen = [System.Windows.Forms.Screen]::FromPoint([System.Drawing.Point]::new($px, $py))
$b = $screen.Bounds
Write-Host ("kiosk-place: Zielmonitor bei {0},{1} ({2}x{3})" -f $b.X, $b.Y, $b.Width, $b.Height)

# SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW
$flags = [uint32]0x0074

# --- Wait for the kiosk window, then move it (repeat briefly) ---------------
$deadline  = (Get-Date).AddSeconds($TimeoutSec)
$firstMove = $null
while ((Get-Date) -lt $deadline) {
  $hwnd = [IntPtr]::Zero
  $procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue |
           Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Match*" }
  foreach ($cim in $procs) {
    $proc = Get-Process -Id $cim.ProcessId -ErrorAction SilentlyContinue
    if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) { $hwnd = $proc.MainWindowHandle; break }
  }
  if ($hwnd -ne [IntPtr]::Zero) {
    [KioskWin]::SetWindowPos($hwnd, [IntPtr]::Zero, $b.X, $b.Y, $b.Width, $b.Height, $flags) | Out-Null
    if (-not $firstMove) {
      $firstMove = Get-Date
      Write-Host ("kiosk-place: Kiosk-Fenster auf {0},{1} verschoben" -f $b.X, $b.Y)
    }
    if ((Get-Date) -gt $firstMove.AddSeconds(2)) { break }   # a few reps beat late re-layout
    Start-Sleep -Milliseconds 500
  } else {
    Start-Sleep -Milliseconds 400
  }
}

if (-not $firstMove) { Write-Host "kiosk-place: kein Kiosk-Fenster gefunden (Timeout)"; exit 1 }
exit 0
