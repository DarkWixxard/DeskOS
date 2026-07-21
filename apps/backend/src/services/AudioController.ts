// Audio Controller — best-effort OS volume control for the deej integration.
//
// deej's whole job is to turn a physical slider into a change of the operating
// system's volume. This tiny controller does exactly that step: given a target
// (master / mic / a specific app) and a percentage (0–100), it shells out to the
// platform's standard audio CLI. It is intentionally *best-effort* — if the tool
// isn't available it logs one warning and becomes a no-op, so the rest of the
// deej feature (live slider read-out, mapping UI, automations) keeps working.
//
// Coverage per platform:
//   - Linux  : PulseAudio/PipeWire via `pactl` — master, mic AND per-app.
//   - macOS  : `osascript` — master + mic (system-wide); per-app not supported.
//   - Windows: `nircmd` (if on PATH) — master + mute; per-app not supported.
//
// The command builders below are pure functions (exported for tests); the class
// only adds process spawning + platform dispatch on top.

import { execFile } from 'child_process';
import { WindowsAudio } from './WindowsAudio';

const clampPct = (v: number): number => Math.max(0, Math.min(100, Math.round(v)));

/** pactl arguments for the default output sink volume (Linux). */
export function pactlMasterArgs(pct: number): string[] {
  return ['set-sink-volume', '@DEFAULT_SINK@', `${clampPct(pct)}%`];
}

/** pactl arguments for the default input source volume (Linux mic). */
export function pactlMicArgs(pct: number): string[] {
  return ['set-source-volume', '@DEFAULT_SOURCE@', `${clampPct(pct)}%`];
}

/** AppleScript snippet for the system output volume (macOS). */
export function osaMasterScript(pct: number): string {
  return `set volume output volume ${clampPct(pct)}`;
}

/** AppleScript snippet for the system input volume (macOS mic). */
export function osaMicScript(pct: number): string {
  return `set volume input volume ${clampPct(pct)}`;
}

/**
 * Parse `pactl list sink-inputs` output into (index, identifiers) pairs so an
 * app slider can be matched to a running audio stream by name. Exposed for tests.
 */
export function parseSinkInputs(output: string): { index: number; names: string[] }[] {
  const blocks = output.split(/\n(?=Sink Input #)/);
  const result: { index: number; names: string[] }[] = [];
  for (const block of blocks) {
    const idMatch = block.match(/Sink Input #(\d+)/);
    if (!idMatch) continue;
    const index = Number(idMatch[1]);
    const names: string[] = [];
    for (const prop of ['application.name', 'application.process.binary', 'media.name']) {
      const re = new RegExp(`${prop.replace(/\./g, '\\.')}\\s*=\\s*"([^"]*)"`);
      const m = block.match(re);
      if (m) names.push(m[1]);
    }
    result.push({ index, names });
  }
  return result;
}

/** True when one of a stream's identifiers matches the requested app name. */
export function sinkInputMatchesApp(names: string[], app: string): boolean {
  const needle = app.toLowerCase().replace(/\.exe$/, '').trim();
  if (!needle) return false;
  return names.some((n) => {
    const hay = n.toLowerCase();
    return hay.includes(needle) || needle.includes(hay.replace(/\.exe$/, ''));
  });
}

export class AudioController {
  readonly platform = process.platform;
  // Warn at most once per missing tool so a headless box doesn't spam the log.
  private warned = new Set<string>();
  // Persistent Windows Core Audio helper (lazily started on first Windows call).
  private win: WindowsAudio | null = null;

  /** Per-app volume works on Linux (PulseAudio) and Windows (Core Audio sessions). */
  get perAppSupported(): boolean {
    return this.platform === 'linux' || this.platform === 'win32';
  }

  private windows(): WindowsAudio {
    if (!this.win) this.win = new WindowsAudio();
    return this.win;
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[audio] ${message}`);
  }

  private run(file: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      execFile(file, args, { timeout: 4000 }, (err) => {
        if (err) {
          this.warnOnce(file, `"${file}" nicht verfügbar oder fehlgeschlagen (${err.message}). Lautstärke wird nur angezeigt, nicht gesetzt.`);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  /** Set the system master output volume (0–100). */
  async setMaster(pct: number): Promise<boolean> {
    const p = clampPct(pct);
    if (this.platform === 'linux') return this.run('pactl', pactlMasterArgs(p));
    if (this.platform === 'darwin') return this.run('osascript', ['-e', osaMasterScript(p)]);
    if (this.platform === 'win32') return this.windows().setMaster(p);
    this.warnOnce('master', `Master-Lautstärke auf ${this.platform} nicht unterstützt.`);
    return false;
  }

  /** Mute/unmute the master output. */
  async setMasterMute(muted: boolean): Promise<boolean> {
    if (this.platform === 'linux') return this.run('pactl', ['set-sink-mute', '@DEFAULT_SINK@', muted ? '1' : '0']);
    if (this.platform === 'darwin') return this.run('osascript', ['-e', `set volume ${muted ? 'with' : 'without'} output muted`]);
    if (this.platform === 'win32') return this.windows().setMasterMute(muted);
    return false;
  }

  /** Set the default microphone / input volume (0–100). */
  async setMic(pct: number): Promise<boolean> {
    const p = clampPct(pct);
    if (this.platform === 'linux') return this.run('pactl', pactlMicArgs(p));
    if (this.platform === 'darwin') return this.run('osascript', ['-e', osaMicScript(p)]);
    if (this.platform === 'win32') return this.windows().setMic(p);
    this.warnOnce('mic', `Mikrofon-Lautstärke auf ${this.platform} nicht unterstützt.`);
    return false;
  }

  /** Set the volume of every audio stream belonging to a given app (0–100). */
  async setApp(app: string, pct: number): Promise<boolean> {
    const p = clampPct(pct);
    if (this.platform === 'win32') return this.windows().setApp(app, p);
    if (this.platform === 'linux') {
      const inputs = await this.listSinkInputs();
      const matches = inputs.filter((si) => sinkInputMatchesApp(si.names, app));
      if (matches.length === 0) return false;
      let ok = false;
      for (const si of matches) {
        const done = await this.run('pactl', ['set-sink-input-volume', String(si.index), `${p}%`]);
        ok = ok || done;
      }
      return ok;
    }
    this.warnOnce('app', `Pro-App-Lautstärke auf ${this.platform} (noch) nicht unterstützt.`);
    return false;
  }

  /** Set the volume of the currently focused app (deej.current — Windows only). */
  async setCurrentApp(pct: number): Promise<boolean> {
    if (this.platform === 'win32') return this.windows().setCurrent(clampPct(pct));
    this.warnOnce('current', `„Aktive App" (deej.current) wird auf ${this.platform} nicht unterstützt.`);
    return false;
  }

  /** Tear down any long-lived platform helper (called on shutdown). */
  dispose(): void {
    this.win?.dispose();
    this.win = null;
  }

  private listSinkInputs(): Promise<{ index: number; names: string[] }[]> {
    return new Promise((resolve) => {
      execFile('pactl', ['list', 'sink-inputs'], { timeout: 4000 }, (err, stdout) => {
        if (err) {
          this.warnOnce('pactl-list', 'pactl nicht verfügbar — pro-App-Lautstärke deaktiviert.');
          resolve([]);
        } else {
          resolve(parseSinkInputs(stdout || ''));
        }
      });
    });
  }
}

export const audioController = new AudioController();
