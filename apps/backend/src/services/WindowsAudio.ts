// Windows audio backend for the deej integration.
//
// The first version shelled out to `nircmd`, which nobody has on PATH — so on
// Windows the sliders moved in the UI but nothing changed on the PC. This talks
// directly to the Windows Core Audio API (the same API the native deej app uses)
// through a SINGLE long-lived PowerShell process:
//
//   - On first use we spawn `powershell -File <script>`. The script compiles a
//     tiny C# helper (Add-Type) that wraps IAudioEndpointVolume (master/mic/mute)
//     and IAudioSessionManager2 (per-app volume), then loops reading one-line
//     commands from stdin and applies them.
//   - Every volume change is just a line written to that process's stdin, so
//     updates are fast (no per-change process spawn, no C# recompile).
//
// No installs, no admin rights — PowerShell + the .NET Framework CSC compiler
// ship with every Windows. If anything fails we log once and become a no-op.

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The PowerShell helper: two independent Add-Type blocks (endpoint + sessions)
// so that even if the per-app session code ever fails to compile, master/mic/mute
// keep working. Then a stdin command loop: "M <0-100>", "I <0-100>", "U <0|1>",
// "A <name> <0-100>".
const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'

$endpointCode = @'
using System;
using System.Runtime.InteropServices;
namespace DeskOSAudio {
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
  }
  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr p);
    int UnregisterControlChangeNotify(IntPtr p);
    int GetChannelCount(out int c);
    int SetMasterVolumeLevel(float l, ref Guid ctx);
    int SetMasterVolumeLevelScalar(float l, ref Guid ctx);
    int GetMasterVolumeLevel(out float l);
    int GetMasterVolumeLevelScalar(out float l);
    int SetChannelVolumeLevel(uint ch, float l, ref Guid ctx);
    int SetChannelVolumeLevelScalar(uint ch, float l, ref Guid ctx);
    int GetChannelVolumeLevel(uint ch, out float l);
    int GetChannelVolumeLevelScalar(uint ch, out float l);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
    int GetMute(out bool mute);
  }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
  public static class Endpoint {
    static IAudioEndpointVolume Vol(int dataFlow) {
      var e = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
      IMMDevice dev; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(dataFlow, 0, out dev));
      Guid iid = typeof(IAudioEndpointVolume).GUID; object o;
      Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 1, IntPtr.Zero, out o));
      return (IAudioEndpointVolume)o;
    }
    public static void SetMaster(float v) { var g = Guid.Empty; Vol(0).SetMasterVolumeLevelScalar(v, ref g); }
    public static void SetMic(float v) { var g = Guid.Empty; Vol(1).SetMasterVolumeLevelScalar(v, ref g); }
    public static void SetMasterMute(bool m) { var g = Guid.Empty; Vol(0).SetMute(m, ref g); }
  }
}
'@

$sessionCode = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
namespace DeskOSAudioS {
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
  }
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr guid, int flags, out IntPtr ctl);
    int GetSimpleAudioVolume(IntPtr guid, int flags, out IntPtr vol);
    int GetSessionEnumerator(out IAudioSessionEnumerator e);
  }
  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    int GetCount(out int count);
    int GetSession(int index, out IAudioSessionControl2 session);
  }
  [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(out int state);
    int GetDisplayName(out IntPtr n);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string v, ref Guid ctx);
    int GetIconPath(out IntPtr n);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string v, ref Guid ctx);
    int GetGroupingParam(out Guid g);
    int SetGroupingParam(ref Guid g, ref Guid ctx);
    int RegisterAudioSessionNotification(IntPtr n);
    int UnregisterAudioSessionNotification(IntPtr n);
    int GetSessionIdentifier(out IntPtr id);
    int GetSessionInstanceIdentifier(out IntPtr id);
    int GetProcessId(out uint pid);
    int IsSystemSoundsSession();
    int SetDuckingPreference(bool optOut);
  }
  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    int SetMasterVolume(float level, ref Guid ctx);
    int GetMasterVolume(out float level);
    int SetMute(bool mute, ref Guid ctx);
    int GetMute(out bool mute);
  }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
  public static class Sessions {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    // Enumerate every audio session and set the volume of those whose owning
    // process id matches the predicate.
    static void Apply(float v, Predicate<uint> match) {
      var e = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
      IMMDevice dev; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 0, out dev));
      Guid iid = typeof(IAudioSessionManager2).GUID; object o;
      Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 1, IntPtr.Zero, out o));
      var mgr = (IAudioSessionManager2)o;
      IAudioSessionEnumerator sessions; Marshal.ThrowExceptionForHR(mgr.GetSessionEnumerator(out sessions));
      int count; sessions.GetCount(out count);
      for (int i = 0; i < count; i++) {
        IAudioSessionControl2 ctl;
        if (sessions.GetSession(i, out ctl) != 0 || ctl == null) continue;
        uint pid; if (ctl.GetProcessId(out pid) != 0 || pid == 0) continue;
        if (match(pid)) { var sav = (ISimpleAudioVolume)ctl; var g = Guid.Empty; sav.SetMasterVolume(v, ref g); }
      }
    }
    public static void SetApp(string app, float v) {
      string needle = app.ToLowerInvariant();
      if (needle.EndsWith(".exe")) needle = needle.Substring(0, needle.Length - 4);
      Apply(v, delegate(uint pid) {
        string pname; try { pname = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch { return false; }
        return pname == needle || pname.Contains(needle) || needle.Contains(pname);
      });
    }
    public static void SetCurrent(float v) {
      IntPtr hwnd = GetForegroundWindow();
      if (hwnd == IntPtr.Zero) return;
      uint target; GetWindowThreadProcessId(hwnd, out target);
      if (target == 0) return;
      Apply(v, delegate(uint pid) { return pid == target; });
    }
  }
}
'@

Add-Type -TypeDefinition $endpointCode
$sessionsOk = $true
try { Add-Type -TypeDefinition $sessionCode } catch { $sessionsOk = $false }
[Console]::Out.WriteLine("READY")

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $p = $line.Split(' ')
  try {
    switch ($p[0]) {
      'M' { [DeskOSAudio.Endpoint]::SetMaster([single]([double]$p[1] / 100.0)) }
      'I' { [DeskOSAudio.Endpoint]::SetMic([single]([double]$p[1] / 100.0)) }
      'U' { [DeskOSAudio.Endpoint]::SetMasterMute($p[1] -eq '1') }
      'A' { if ($sessionsOk) { [DeskOSAudioS.Sessions]::SetApp($p[1], [single]([double]$p[2] / 100.0)) } }
      'C' { if ($sessionsOk) { [DeskOSAudioS.Sessions]::SetCurrent([single]([double]$p[1] / 100.0)) } }
    }
  } catch { }
}
`;

export class WindowsAudio {
  private proc: ChildProcess | null = null;
  private scriptPath: string | null = null;
  private failed = false;

  /** Spawn (or reuse) the persistent PowerShell helper. Returns false if unusable. */
  private ensure(): boolean {
    if (this.proc && !this.proc.killed) return true;
    if (this.failed) return false;
    try {
      if (!this.scriptPath) {
        this.scriptPath = path.join(os.tmpdir(), 'deskos-audio.ps1');
        fs.writeFileSync(this.scriptPath, PS_SCRIPT, 'utf8');
      }
      const proc = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath],
        { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true }
      );
      proc.on('error', (err) => {
        this.failed = true;
        this.proc = null;
        console.warn(`[audio] PowerShell-Audio-Helfer konnte nicht gestartet werden (${err.message}). Lautstärke wird nur angezeigt.`);
      });
      proc.on('exit', () => {
        // Allow a respawn on the next command (unless a spawn error marked us failed).
        if (this.proc === proc) this.proc = null;
      });
      proc.stdin?.on('error', () => undefined);
      proc.unref();
      this.proc = proc;
      return true;
    } catch (err) {
      this.failed = true;
      console.warn(`[audio] PowerShell-Audio-Helfer nicht verfügbar (${err instanceof Error ? err.message : String(err)}).`);
      return false;
    }
  }

  private send(line: string): boolean {
    if (!this.ensure() || !this.proc?.stdin?.writable) return false;
    try {
      this.proc.stdin.write(line + '\n');
      return true;
    } catch {
      return false;
    }
  }

  setMaster(pct: number): boolean {
    return this.send(`M ${Math.round(pct)}`);
  }

  setMic(pct: number): boolean {
    return this.send(`I ${Math.round(pct)}`);
  }

  setMasterMute(muted: boolean): boolean {
    return this.send(`U ${muted ? 1 : 0}`);
  }

  setApp(app: string, pct: number): boolean {
    // Process names carry no spaces; strip any just in case so the parser stays simple.
    return this.send(`A ${app.replace(/\s+/g, '')} ${Math.round(pct)}`);
  }

  setCurrent(pct: number): boolean {
    return this.send(`C ${Math.round(pct)}`);
  }

  dispose(): void {
    if (this.proc) {
      try {
        this.proc.stdin?.end();
        this.proc.kill();
      } catch {
        /* ignore */
      }
      this.proc = null;
    }
  }
}
