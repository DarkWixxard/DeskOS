// Remote PC Agent
import dotenv from 'dotenv';
import { io, Socket } from 'socket.io-client';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { SystemMetrics, DiskMetrics, GpuMetrics, NetworkMetrics, ProcessInfo, DeviceType } from '@shared/types';

dotenv.config();

// `systeminformation` is an OPTIONAL dependency: it enriches the slow metric
// tier (temperature, GPU, disks, processes, network), but the agent must still
// run without it — e.g. a fresh Raspberry Pi checkout that only has the core
// dependencies installed. Load it lazily and cache the result (the module, or
// `null` when absent) so a missing module warns exactly once instead of
// crashing the process at import time with MODULE_NOT_FOUND.
type Si = typeof import('systeminformation');
let siPromise: Promise<Si | null> | undefined;
function loadSi(): Promise<Si | null> {
  if (!siPromise) {
    siPromise = import('systeminformation')
      .then((m) => ((m as { default?: Si }).default ?? m) as Si)
      .catch(() => {
        console.warn(
          '[RemoteAgent] Optionales Modul "systeminformation" nicht installiert — nutze native OS/Linux-Fallbacks. Für die vollständigen Metriken bitte `npm install` ausführen.'
        );
        return null;
      });
  }
  return siPromise;
}

const BACKEND_URL = process.env.BACKEND_URL || 'http://192.168.178.130:4001';
const AGENT_NAME = process.env.AGENT_NAME || os.hostname();
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '1000');

// Best-effort detection of the host's device category so a Raspberry Pi
// registers as "RaspberryPi" instead of the generic "remote". Reads the
// device-tree model / cpuinfo (only populated on Pi-class Linux boards) and
// looks for "Raspberry Pi". Overridable via the AGENT_TYPE env var (e.g.
// AGENT_TYPE=Arduino) to force any category from the start.
function detectDeviceType(): DeviceType {
  if (os.platform() === 'linux') {
    for (const file of ['/sys/firmware/devicetree/base/model', '/proc/cpuinfo']) {
      try {
        if (/raspberry pi/i.test(fsSync.readFileSync(file, 'utf8'))) return 'RaspberryPi';
      } catch {
        // file not present on this host — try the next probe
      }
    }
  }
  return 'remote';
}

const AGENT_TYPE: DeviceType = (process.env.AGENT_TYPE as DeviceType) || detectDeviceType();

// The agent reports the shared SystemMetrics shape (plus a capture timestamp).
type RemoteSystemMetrics = SystemMetrics & { timestamp: number };

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

function readIntFile(p: string): number | undefined {
  try {
    const v = parseInt(fsSync.readFileSync(p, 'utf8').trim(), 10);
    return Number.isFinite(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

// `systeminformation` only fills in load/temperature/VRAM for NVIDIA GPUs
// (via `nvidia-smi`) — AMD controllers are left with everything but
// model/vendor undefined, which is what renders as "N/A" in the GPU panel.
// The amdgpu kernel driver exposes the same data via sysfs, so read it
// directly as a fallback, matching the controller by its PCI bus address.
function readAmdSysfsGpuMetrics(busAddress: string): Pick<GpuMetrics, 'load' | 'tempC' | 'memUsed' | 'memTotal'> {
  const result: Pick<GpuMetrics, 'load' | 'tempC' | 'memUsed' | 'memTotal'> = {};
  try {
    const drmRoot = '/sys/class/drm';
    const cardDir = fsSync
      .readdirSync(drmRoot)
      .filter((n) => /^card\d+$/.test(n))
      .find((c) => {
        try {
          return fsSync.realpathSync(path.join(drmRoot, c, 'device')).toLowerCase().endsWith(busAddress.toLowerCase());
        } catch {
          return false;
        }
      });
    if (!cardDir) return result;

    const deviceDir = path.join(drmRoot, cardDir, 'device');
    result.load = readIntFile(path.join(deviceDir, 'gpu_busy_percent'));
    result.memUsed = readIntFile(path.join(deviceDir, 'mem_info_vram_used'));
    result.memTotal = readIntFile(path.join(deviceDir, 'mem_info_vram_total'));

    const hwmonRoot = path.join(deviceDir, 'hwmon');
    const hwmonDir = fsSync.readdirSync(hwmonRoot).find((n) => n.startsWith('hwmon'));
    if (hwmonDir) {
      const milliC = readIntFile(path.join(hwmonRoot, hwmonDir, 'temp1_input'));
      if (milliC !== undefined) result.tempC = Math.round(milliC / 1000);
    }
  } catch {
    // sysfs layout varies across kernel/driver versions — leave fields undefined.
  }
  return result;
}

const execFileAsync = promisify(execFile);

// On Windows, `systeminformation` has no `nvidia-smi`-equivalent for
// non-NVIDIA vendors, so AMD/Intel controllers are left without load/VRAM.
// Windows itself exposes both via the "GPU Engine" / "GPU Adapter Memory"
// performance counters (the same source Task Manager's Performance tab
// uses), available for any vendor since Windows 10 1803 — no admin rights or
// vendor SDK required. There is no equivalent counter for temperature.
// Only safe to apply when there is exactly one reported GPU, since the
// counters aren't matched here to a specific adapter (no cross-vendor LUID
// mapping without extra WMI calls).
let winGpuWarned = false;

async function readWindowsGpuAggregateMetrics(): Promise<Pick<GpuMetrics, 'load' | 'memUsed' | 'memTotal'>> {
  // Each counter is queried independently: "GPU Engine" instances only exist
  // while a process is actively using that engine, so a momentary miss there
  // must not also wipe out the (usually stable) VRAM readings.
  const script = [
    'function Sum($path, $stat) {',
    '  try {',
    '    $s = (Get-Counter -Counter $path -ErrorAction Stop).CounterSamples',
    "    if ($stat -eq 'max') { return ($s | Measure-Object -Property CookedValue -Maximum).Maximum }",
    '    return ($s | Measure-Object -Property CookedValue -Sum).Sum',
    '  } catch { return $null }',
    '}',
    "$load = Sum '\\GPU Engine(*engtype_3D)\\Utilization Percentage' 'sum'",
    "$used = Sum '\\GPU Adapter Memory(*)\\Dedicated Usage' 'sum'",
    "$limit = Sum '\\GPU Adapter Memory(*)\\Dedicated Limit' 'max'",
    '[PSCustomObject]@{ load = $load; used = $used; limit = $limit } | ConvertTo-Json -Compress',
  ].join('; ');

  try {
    // `Get-Counter`'s first hit on the "GPU Engine" counter set can take
    // several seconds to enumerate (cold PowerShell start + perf-counter
    // catalog build) — a short timeout kills it before it ever replies.
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 10000, windowsHide: true }
    );
    const parsed = JSON.parse(stdout.trim());
    const load = num(parsed.load);
    return {
      load: load !== undefined ? Math.min(100, Math.round(load)) : undefined,
      memUsed: num(parsed.used),
      memTotal: num(parsed.limit),
    };
  } catch (error) {
    if (!winGpuWarned) {
      winGpuWarned = true;
      const err = error as NodeJS.ErrnoException & { stderr?: string; signal?: string; killed?: boolean };
      console.warn('[RemoteAgent] Windows GPU performance-counter fallback failed — GPU load/VRAM will stay unavailable:', {
        message: err.message,
        stderr: err.stderr,
        code: err.code,
        signal: err.signal,
        killed: err.killed,
      });
    }
    return {};
  }
}

// The PowerShell round-trip above can take several seconds — running it
// inline inside `collectSlowTier()` would block that whole Promise.all (and
// therefore the 1s fast-tier CPU/RAM refresh, since `getSystemMetrics`
// awaits it) for just as long. Instead it's kicked off in the background and
// the slow tier always reads whatever was cached from the last completed run.
let winGpuCache: Pick<GpuMetrics, 'load' | 'memUsed' | 'memTotal'> = {};
let winGpuFetchInFlight = false;

function refreshWindowsGpuCache(): void {
  if (winGpuFetchInFlight) return;
  winGpuFetchInFlight = true;
  readWindowsGpuAggregateMetrics()
    .then((result) => {
      winGpuCache = result;
    })
    .finally(() => {
      winGpuFetchInFlight = false;
    });
}

// ---------------------------------------------------------------------------
// Native fallbacks for when the optional `systeminformation` module is absent
// (e.g. a fresh Raspberry Pi checkout without `npm install`). These read the
// same data straight from the Linux kernel — /sys, /proc and the coreutils
// `df`/`ps` — so the agent still reports meaningful metrics. Each is Linux-only
// and fully guarded; on other platforms (or on any read error) it returns
// nothing and the corresponding field simply stays undefined.
// ---------------------------------------------------------------------------

// CPU temperature from the thermal zones. On a Raspberry Pi `thermal_zone0` is
// the SoC/CPU sensor; on x86 the package sensor shows up as "x86_pkg_temp".
// Prefer a zone whose type looks like a CPU/SoC sensor, otherwise take the
// hottest plausible zone. Values are stored in milli-°C.
function readCpuTempFallback(): number | undefined {
  if (os.platform() !== 'linux') return undefined;
  try {
    const root = '/sys/class/thermal';
    const zones = fsSync.readdirSync(root).filter((n) => /^thermal_zone\d+$/.test(n));
    let preferred: number | undefined;
    let hottest: number | undefined;
    for (const z of zones) {
      const milliC = readIntFile(path.join(root, z, 'temp'));
      if (milliC === undefined) continue;
      const c = milliC / 1000;
      if (c <= 0 || c > 200) continue; // ignore obviously bogus readings
      hottest = hottest === undefined ? c : Math.max(hottest, c);
      let type = '';
      try {
        type = fsSync.readFileSync(path.join(root, z, 'type'), 'utf8').trim().toLowerCase();
      } catch {
        // `type` is optional — fall back to the hottest zone below
      }
      if (/cpu|x86_pkg|soc/.test(type)) preferred = preferred === undefined ? c : Math.max(preferred, c);
    }
    const chosen = preferred ?? hottest;
    return chosen === undefined ? undefined : Math.round(chosen);
  } catch {
    return undefined;
  }
}

// CPU model + core count without systeminformation. `os.cpus()` carries the
// brand string on x86 but is often blank on ARM, so fall back to parsing
// /proc/cpuinfo (which on a Pi carries a "Model" board name, e.g.
// "Raspberry Pi 4 Model B Rev 1.4").
function readCpuInfoFallback(): { cpuModel?: string; cpuCores?: number } {
  const cpus = os.cpus();
  const out: { cpuModel?: string; cpuCores?: number } = { cpuCores: cpus.length || undefined };
  const osModel = cpus[0]?.model?.trim();
  if (osModel) out.cpuModel = osModel;

  if (!out.cpuModel && os.platform() === 'linux') {
    try {
      const info = fsSync.readFileSync('/proc/cpuinfo', 'utf8');
      const pick = (key: string): string | undefined => {
        const m = info.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'im'));
        return m?.[1]?.trim() || undefined;
      };
      out.cpuModel = pick('model name') ?? pick('Model') ?? pick('Hardware');
    } catch {
      // leave cpuModel undefined
    }
  }
  return out;
}

// Per-filesystem usage via coreutils `df` (portable -P columns so each mount is
// on one line, -k KiB blocks, -T filesystem type). Skips pseudo/virtual mounts.
async function readDiskFallback(): Promise<DiskMetrics[]> {
  if (os.platform() !== 'linux') return [];
  try {
    const { stdout } = await execFileAsync('df', ['-kPT'], { timeout: 5000 });
    const skip = /^(tmpfs|devtmpfs|overlay|squashfs|proc|sysfs|cgroup|cgroup2|ramfs|debugfs|tracefs|mqueue|efivarfs|autofs|fusectl|configfs|securityfs|pstore|bpf|nsfs|none)$/i;
    const disks: DiskMetrics[] = [];
    for (const line of stdout.trim().split('\n').slice(1)) {
      // Filesystem Type 1024-blocks Used Available Capacity Mounted-on
      const cols = line.trim().split(/\s+/);
      if (cols.length < 7) continue;
      const [fs, type, blocksStr, usedStr] = cols;
      if (skip.test(type)) continue;
      const total = parseInt(blocksStr, 10) * 1024;
      const used = parseInt(usedStr, 10) * 1024;
      if (!Number.isFinite(total) || total <= 0) continue;
      const capacity = parseInt(cols[5], 10); // e.g. "42%"
      disks.push({
        fs,
        mount: cols.slice(6).join(' '), // mount point may contain spaces
        type,
        used,
        total,
        percentage: Number.isFinite(capacity) ? capacity : (used / total) * 100,
      });
    }
    return disks;
  } catch {
    return [];
  }
}

// Top processes (by CPU) + total count via `ps`. `rss` is reported in KiB.
async function readProcessesFallback(): Promise<{ count?: number; top: ProcessInfo[] } | undefined> {
  if (os.platform() !== 'linux') return undefined;
  try {
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid,comm,%cpu,rss', '--sort=-%cpu'], { timeout: 5000 });
    const rows = stdout.trim().split('\n').slice(1);
    const top: ProcessInfo[] = [];
    for (const line of rows.slice(0, 8)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4) continue;
      // pid comm %cpu rss — %cpu and rss are always the last two numeric columns,
      // so anything between the pid and them is the (possibly spaced) command.
      const pid = parseInt(cols[0], 10);
      const rss = parseInt(cols[cols.length - 1], 10);
      const cpu = parseFloat(cols[cols.length - 2]);
      top.push({
        pid,
        name: cols.slice(1, cols.length - 2).join(' '),
        cpu: Number.isFinite(cpu) ? Math.round(cpu * 10) / 10 : 0,
        memBytes: Number.isFinite(rss) ? rss * 1024 : undefined,
      });
    }
    return { count: rows.length || undefined, top };
  } catch {
    return undefined;
  }
}

// Network throughput from /proc/net/dev. The kernel exposes cumulative byte
// counters, so per-second rates are derived by diffing against the previous
// sample; the busiest non-loopback interface is chosen. The first call (or an
// interface switch) reports 0/sec but still carries the cumulative totals.
let lastNetSample: { at: number; iface: string; rx: number; tx: number } | null = null;

function readNetworkFallback(): NetworkMetrics | undefined {
  if (os.platform() !== 'linux') return undefined;
  try {
    const raw = fsSync.readFileSync('/proc/net/dev', 'utf8');
    let best: { iface: string; rx: number; tx: number } | null = null;
    for (const line of raw.split('\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const iface = line.slice(0, idx).trim();
      if (!iface || iface === 'lo') continue;
      const nums = line.slice(idx + 1).trim().split(/\s+/).map((n) => parseInt(n, 10));
      const rx = nums[0]; // rx_bytes
      const tx = nums[8]; // tx_bytes
      if (!Number.isFinite(rx) || !Number.isFinite(tx)) continue;
      if (!best || rx + tx > best.rx + best.tx) best = { iface, rx, tx };
    }
    if (!best) return undefined;

    const now = Date.now();
    let rxSec = 0;
    let txSec = 0;
    if (lastNetSample && lastNetSample.iface === best.iface) {
      const dt = (now - lastNetSample.at) / 1000;
      if (dt > 0) {
        rxSec = Math.max(0, (best.rx - lastNetSample.rx) / dt);
        txSec = Math.max(0, (best.tx - lastNetSample.tx) / dt);
      }
    }
    lastNetSample = { at: now, iface: best.iface, rx: best.rx, tx: best.tx };
    return {
      iface: best.iface,
      rxSec: Math.round(rxSec),
      txSec: Math.round(txSec),
      rxBytes: best.rx,
      txBytes: best.tx,
    };
  } catch {
    return undefined;
  }
}

class RemoteAgent {
  private socket: Socket | null = null;
  private agentId: string = '';
  private pollInterval: NodeJS.Timeout | null = null;
  private lastCpuTimes: { [key: string]: number } = {};
  private previousCpuData: any[] = [];
  private readonly agentInfoPath = path.join(os.homedir(), '.deskos-agent.json');

  // Metric collection state (fast tier every poll, heavy metrics cached).
  private lastCPUMeasure: { idle: number; total: number } | null = null;
  private slowCache: Partial<RemoteSystemMetrics> = {};
  private lastSlowAt = 0;
  private collecting = false;
  private lastMetrics: RemoteSystemMetrics | null = null;
  private readonly slowIntervalMs = 5000;

  /**
   * Initialize agent
   */
  async initialize(): Promise<void> {
    console.log(`🤖 DeskOS Remote Agent - ${AGENT_NAME}`);
    console.log(`📡 Looking for saved agent identity...`);
    await this.loadAgentId();
    console.log(`📡 Connecting to ${BACKEND_URL}...`);

    this.socket = io(BACKEND_URL);

    this.socket.on('connect', () => {
      console.log('✅ Connected to DeskOS Backend');
      this.registerAgent();
    });

    this.socket.on('disconnect', () => {
      console.log('⚠️ Disconnected from DeskOS Backend');
    });

    this.socket.on('error', (error: any) => {
      console.error('❌ Socket error:', error);
    });

    this.socket.on('command', (cmd: any) => {
      this.handleCommand(cmd);
    });
  }

  /**
   * Register agent with backend
   */
  private async loadAgentId(): Promise<void> {
    try {
      const raw = await fs.readFile(this.agentInfoPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.agentId) {
        this.agentId = String(parsed.agentId);
        console.log(`🔑 Loaded saved agent ID: ${this.agentId}`);
      }
    } catch {
      // Ignore missing or invalid file
    }
  }

  private async saveAgentId(): Promise<void> {
    try {
      await fs.writeFile(
        this.agentInfoPath,
        JSON.stringify({ agentId: this.agentId }, null, 2),
        'utf8'
      );
      console.log(`🔒 Saved agent ID to ${this.agentInfoPath}`);
    } catch (error) {
      console.warn('Unable to save agent ID:', error);
    }
  }

  private registerAgent(): void {
    if (!this.socket) return;

    const metadata = {
      os: os.platform(),
      arch: os.arch(),
      cpuCount: os.cpus().length,
      totalMemory: os.totalmem(),
    };

    this.socket.emit('register-agent', {
      agentId: this.agentId || undefined,
      name: AGENT_NAME,
      type: AGENT_TYPE,
      metadata,
    }, async (response: any) => {
      const previousAgentId = this.agentId;
      this.agentId = response.agentId;
      if (this.agentId && this.agentId !== previousAgentId) {
        await this.saveAgentId();
      }
      console.log(`✅ Agent registered with ID: ${this.agentId}`);
      this.startPolling();
    });
  }

  /**
   * Start polling system metrics
   */
  private startPolling(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.lastCPUMeasure = this.getCPUTimeDiff();

    this.pollInterval = setInterval(() => {
      void this.collectAndSendMetrics();
    }, POLL_INTERVAL);
  }

  /**
   * Collect and send metrics
   */
  private async collectAndSendMetrics(): Promise<void> {
    if (!this.socket) return;

    try {
      const metrics = await this.getSystemMetrics();
      this.socket.emit('metrics', {
        agentId: this.agentId,
        metrics,
      });
    } catch (error) {
      console.error('Error collecting metrics:', error);
    }
  }

  /**
   * Get system metrics (fast tier each poll, heavier metrics on a relaxed
   * cadence). Mirrors the local SystemMonitor so remote PCs report the same
   * rich shape; every probe is guarded so missing sensors never break it.
   */
  private async getSystemMetrics(): Promise<RemoteSystemMetrics> {
    if (this.collecting && this.lastMetrics) return this.lastMetrics;
    this.collecting = true;
    try {
      const cpuUsage = this.getCPUUsage();
      const memTotal = os.totalmem();
      const memUsed = memTotal - os.freemem();
      const network = await this.getNetwork();

      const now = Date.now();
      if (now - this.lastSlowAt >= this.slowIntervalMs || this.lastSlowAt === 0) {
        this.lastSlowAt = now;
        this.slowCache = await this.collectSlowTier();
      }

      const metrics: RemoteSystemMetrics = {
        cpu: cpuUsage,
        cpuTempC: this.slowCache.cpuTempC,
        cpuModel: this.slowCache.cpuModel,
        cpuCores: this.slowCache.cpuCores ?? os.cpus().length,
        ram: { used: memUsed, total: memTotal, percentage: (memUsed / memTotal) * 100 },
        disk: this.slowCache.disks?.[0]
          ? {
              used: this.slowCache.disks[0].used,
              total: this.slowCache.disks[0].total,
              percentage: this.slowCache.disks[0].percentage,
            }
          : undefined,
        disks: this.slowCache.disks,
        gpus: this.slowCache.gpus,
        network,
        processes: this.slowCache.processes,
        uptime: os.uptime(),
        hostname: os.hostname(),
        platform: os.platform(),
        timestamp: Date.now(),
      };
      this.lastMetrics = metrics;
      return metrics;
    } finally {
      this.collecting = false;
    }
  }

  private async collectSlowTier(): Promise<Partial<RemoteSystemMetrics>> {
    const out: Partial<RemoteSystemMetrics> = {};
    // Use `systeminformation` when it's installed; otherwise (and whenever a
    // given probe comes back empty) fall back to native OS/Linux sources so the
    // agent still reports metrics on a Pi that never ran `npm install`.
    const si = await loadSi();
    await Promise.all([
      // CPU temperature
      (async () => {
        if (si) {
          try {
            const t = await si.cpuTemperature();
            const main = num(t.main);
            if (main !== undefined && main > 0) out.cpuTempC = Math.round(main);
          } catch {
            // fall through to the native probe below
          }
        }
        if (out.cpuTempC === undefined) {
          const t = readCpuTempFallback();
          if (t !== undefined) out.cpuTempC = t;
        }
      })(),
      // CPU model + core count
      (async () => {
        if (si) {
          try {
            const c = await si.cpu();
            out.cpuModel = `${c.manufacturer ?? ''} ${c.brand ?? ''}`.trim() || undefined;
            out.cpuCores = num(c.cores);
          } catch {
            // fall through to the native probe below
          }
        }
        if (!out.cpuModel || out.cpuCores === undefined) {
          const f = readCpuInfoFallback();
          out.cpuModel ??= f.cpuModel;
          out.cpuCores ??= f.cpuCores;
        }
      })(),
      // GPU — systeminformation only. A Raspberry Pi has no standard
      // discrete-GPU sysfs to enumerate, so without the module GPU metrics
      // simply stay undefined.
      (async () => {
        if (!si) return;
        try {
          const g = await si.graphics();
          const gpus: GpuMetrics[] = (g.controllers ?? [])
            .map((c) => {
              const gpu: GpuMetrics = {
                model: c.model,
                vendor: c.vendor,
                load: num(c.utilizationGpu),
                tempC: num(c.temperatureGpu),
                memUsed: num(c.memoryUsed) !== undefined ? (c.memoryUsed as number) * 1024 * 1024 : undefined,
                memTotal: num(c.memoryTotal) !== undefined ? (c.memoryTotal as number) * 1024 * 1024 : undefined,
              };
              const needsFallback = gpu.load === undefined || gpu.tempC === undefined || gpu.memTotal === undefined;
              if (os.platform() === 'linux' && c.busAddress && needsFallback && /amd|ati|advanced micro devices/i.test(c.vendor ?? '')) {
                const fallback = readAmdSysfsGpuMetrics(c.busAddress);
                gpu.load ??= fallback.load;
                gpu.tempC ??= fallback.tempC;
                gpu.memUsed ??= fallback.memUsed;
                gpu.memTotal ??= fallback.memTotal;
              }
              return gpu;
            })
            .filter((gpu) => gpu.model || gpu.load !== undefined || gpu.memTotal !== undefined);

          if (gpus.length === 1 && os.platform() === 'win32' && (gpus[0].load === undefined || gpus[0].memTotal === undefined)) {
            refreshWindowsGpuCache();
            gpus[0].load ??= winGpuCache.load;
            gpus[0].memUsed ??= winGpuCache.memUsed;
            gpus[0].memTotal ??= winGpuCache.memTotal;
          }

          if (gpus.length) out.gpus = gpus;
        } catch {
          // GPU metrics stay undefined
        }
      })(),
      // Disks
      (async () => {
        if (si) {
          try {
            const list = await si.fsSize();
            const disks: DiskMetrics[] = (list ?? [])
              .filter((d) => num(d.size) !== undefined && (d.size as number) > 0)
              .map((d) => ({
                fs: d.fs,
                mount: d.mount,
                type: d.type,
                used: d.used,
                total: d.size,
                percentage: num(d.use) ?? (d.size ? (d.used / d.size) * 100 : 0),
              }));
            if (disks.length) out.disks = disks;
          } catch {
            // fall through to the native probe below
          }
        }
        if (!out.disks?.length) {
          const disks = await readDiskFallback();
          if (disks.length) out.disks = disks;
        }
      })(),
      // Processes
      (async () => {
        if (si) {
          try {
            const p = await si.processes();
            const top: ProcessInfo[] = [...(p.list ?? [])]
              .sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0))
              .slice(0, 8)
              .map((x) => ({
                pid: x.pid,
                name: x.name,
                cpu: Math.round((x.cpu ?? 0) * 10) / 10,
                memBytes: typeof x.memRss === 'number' ? x.memRss * 1024 : undefined,
              }));
            out.processes = { count: num(p.all), top };
          } catch {
            // fall through to the native probe below
          }
        }
        if (!out.processes) {
          const p = await readProcessesFallback();
          if (p) out.processes = p;
        }
      })(),
    ]);
    return out;
  }

  private async getNetwork(): Promise<NetworkMetrics | undefined> {
    const si = await loadSi();
    if (si) {
      try {
        const stats = await si.networkStats();
        const primary = stats?.[0];
        if (primary) {
          return {
            iface: primary.iface,
            rxSec: Math.max(0, num(primary.rx_sec) ?? 0),
            txSec: Math.max(0, num(primary.tx_sec) ?? 0),
            rxBytes: num(primary.rx_bytes),
            txBytes: num(primary.tx_bytes),
          };
        }
      } catch {
        // fall through to the native probe below
      }
    }
    return readNetworkFallback();
  }

  private getCPUTimeDiff(): { idle: number; total: number } {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    cpus.forEach((cpu) => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });
    return { idle: totalIdle, total: totalTick };
  }

  /** Current CPU usage based on a delta measurement between polls. */
  private getCPUUsage(): number {
    const current = this.getCPUTimeDiff();
    if (!this.lastCPUMeasure) {
      this.lastCPUMeasure = current;
      return 0;
    }
    const idleDiff = current.idle - this.lastCPUMeasure.idle;
    const totalDiff = current.total - this.lastCPUMeasure.total;
    this.lastCPUMeasure = current;
    if (totalDiff === 0) return 0;
    return Math.max(0, Math.min(100, 100 - ~~((100 * idleDiff) / totalDiff)));
  }

  /**
   * Handle commands from backend
   */
  private handleCommand(cmd: any): void {
    console.log(`📋 Received command: ${cmd.action}`);

    switch (cmd.action) {
      case 'ping':
        this.socket?.emit('pong', { agentId: this.agentId });
        break;
      case 'get-metrics': {
        if (this.lastMetrics) {
          this.socket?.emit('metrics-response', { agentId: this.agentId, metrics: this.lastMetrics });
        } else {
          void this.getSystemMetrics().then((m) =>
            this.socket?.emit('metrics-response', { agentId: this.agentId, metrics: m })
          );
        }
        break;
      }
      case 'restart':
        console.log('Restarting agent...');
        process.exit(0);
        break;
      default:
        console.warn(`Unknown command: ${cmd.action}`);
    }
  }

  /**
   * Stop agent
   */
  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    if (this.socket) {
      this.socket.disconnect();
    }
    console.log('✅ Agent stopped');
  }
}

// Main
const agent = new RemoteAgent();

agent.initialize().catch(error => {
  console.error('❌ Failed to initialize agent:', error);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\n⏹️ Shutting down agent...');
  await agent.stop();
  process.exit(0);
});
