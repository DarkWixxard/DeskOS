# DeskOS - launch the kiosk browser and place it on a specific monitor.
#
# Chrome/Edge ignore --window-position in --kiosk mode and always open on the
# primary display. This script launches the browser itself (so it knows the
# exact process), waits for its window and moves it onto the monitor that
# contains the given point via Win32 SetWindowPos. It only ever touches the
# kiosk window (its own process / dedicated user-data-dir), never your normal
# browser. Progress is written to %LOCALAPPDATA%\descos-kiosk-place.log.
param(
  [Parameter(Mandatory = $true)][string]$Browser,   # full path to chrome.exe, or "msedge"
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$Position,  # "X,Y" - a point on the target monitor
  [string]$Edge = "0",                              # "1" when $Browser is Microsoft Edge
  [string]$KioskProfile = "$env:LOCALAPPDATA\descos-kiosk",
  [int]$TimeoutSec = 30
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class KioskWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int X, int Y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
}
"@

$log = Join-Path $env:LOCALAPPDATA "descos-kiosk-place.log"
function Say($m) {
  $line = "{0}  {1}" -f (Get-Date -Format "HH:mm:ss"), $m
  Write-Host "kiosk-place: $m"
  try { Add-Content -Path $log -Value $line } catch {}
}

# --- Resolve the target monitor from the point -----------------------------
$parts = $Position -split ','
if ($parts.Count -lt 2) { Say "invalid position '$Position'"; exit 1 }
$pt  = [System.Drawing.Point]::new([int]$parts[0].Trim(), [int]$parts[1].Trim())
$scr = [System.Windows.Forms.Screen]::FromPoint($pt)
$b   = $scr.Bounds
Say ("target monitor at {0},{1} ({2}x{3})" -f $b.X, $b.Y, $b.Width, $b.Height)

# --- Launch the browser ourselves so we know exactly which process it is ----
if ($Edge -eq "1") {
  $bargs = @("--kiosk", $Url, "--edge-kiosk-type=fullscreen", "--no-first-run",
             "--user-data-dir=$KioskProfile",
             "--window-position=$($b.X),$($b.Y)", "--window-size=$($b.Width),$($b.Height)")
} else {
  $bargs = @("--kiosk", "--noerrdialogs", "--disable-infobars",
             "--disable-session-crashed-bubble", "--disable-restore-session-state",
             "--check-for-update-interval=31536000", "--user-data-dir=$KioskProfile",
             "--window-position=$($b.X),$($b.Y)", "--window-size=$($b.Width),$($b.Height)", $Url)
}
$proc = Start-Process -FilePath $Browser -ArgumentList $bargs -PassThru
Say ("launched '{0}' (pid {1})" -f $Browser, $proc.Id)

# --- Find the kiosk window (our process, or a same-profile handoff) ---------
function Get-KioskHandle {
  param($proc, $profile)
  if ($proc -and -not $proc.HasExited) {
    $proc.Refresh()
    if ($proc.MainWindowHandle -ne [IntPtr]::Zero) { return $proc.MainWindowHandle }
  }
  $leaf = Split-Path $profile -Leaf
  $cands = Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue |
           Where-Object { $_.CommandLine -and $_.CommandLine -like "*$leaf*" }
  foreach ($c in $cands) {
    $pp = Get-Process -Id $c.ProcessId -ErrorAction SilentlyContinue
    if ($pp -and $pp.MainWindowHandle -ne [IntPtr]::Zero) { return $pp.MainWindowHandle }
  }
  return [IntPtr]::Zero
}

# --- Move it onto the target monitor (repeat briefly to beat late layout) ---
$flags     = [uint32]0x0074   # NOZORDER | NOACTIVATE | FRAMECHANGED | SHOWWINDOW
$deadline  = (Get-Date).AddSeconds($TimeoutSec)
$firstMove = $null
while ((Get-Date) -lt $deadline) {
  $h = Get-KioskHandle -proc $proc -profile $KioskProfile
  if ($h -ne [IntPtr]::Zero) {
    [KioskWin]::SetWindowPos($h, [IntPtr]::Zero, $b.X, $b.Y, $b.Width, $b.Height, $flags) | Out-Null
    if (-not $firstMove) {
      $firstMove = Get-Date
      $r = New-Object 'KioskWin+RECT'
      [void][KioskWin]::GetWindowRect($h, [ref]$r)
      Say ("moved window -> now at {0},{1} ({2}x{3})" -f $r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top))
    }
    if ((Get-Date) -gt $firstMove.AddSeconds(2)) { break }
    Start-Sleep -Milliseconds 400
  } else {
    Start-Sleep -Milliseconds 300
  }
}

if (-not $firstMove) { Say "could not find the kiosk window within timeout"; exit 1 }
Say "done"
exit 0
