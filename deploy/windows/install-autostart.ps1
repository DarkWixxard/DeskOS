# DeskOS - register kiosk autostart for the current Windows user.
# Creates a shortcut to start-all.bat in the user's Startup folder so that
# DeskOS launches (servers + kiosk browser) automatically at login.
#
# Run with:
#   powershell -ExecutionPolicy Bypass -File deploy\windows\install-autostart.ps1

$ErrorActionPreference = 'Stop'

$here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $here 'start-all.bat'
if (-not (Test-Path $target)) { throw "start-all.bat not found at $target" }

$startup = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startup 'DeskOS Kiosk.lnk'

$ws  = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath       = $target
$lnk.WorkingDirectory = $here
$lnk.WindowStyle      = 7   # minimized
$lnk.Description      = 'Start DeskOS and open the dashboard in kiosk mode'
$lnk.Save()

Write-Host "Autostart shortcut created:" $lnkPath
Write-Host "DeskOS will start automatically at the next login."
Write-Host ""
Write-Host "Start it now:      `"$target`""
Write-Host "Remove autostart:  delete `"$lnkPath`""
