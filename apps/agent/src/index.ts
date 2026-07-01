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
import si from 'systeminformation';
import type { SystemMetrics, DiskMetrics, GpuMetrics, NetworkMetrics, ProcessInfo } from '@shared/types';

dotenv.config();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4001';
const AGENT_NAME = process.env.AGENT_NAME || os.hostname();
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '1000');

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
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 4000, windowsHide: true }
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
      console.warn(
        '[RemoteAgent] Windows GPU performance-counter fallback failed — GPU load/VRAM will stay unavailable:',
        error instanceof Error ? error.message : error
      );
    }
    return {};
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
      type: 'remote',
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
    await Promise.all([
      si.cpuTemperature().then((t) => {
        const main = num(t.main);
        if (main !== undefined && main > 0) out.cpuTempC = Math.round(main);
      }).catch(() => undefined),
      si.cpu().then((c) => {
        out.cpuModel = `${c.manufacturer ?? ''} ${c.brand ?? ''}`.trim() || undefined;
        out.cpuCores = num(c.cores);
      }).catch(() => undefined),
      si.graphics().then(async (g) => {
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
          const fallback = await readWindowsGpuAggregateMetrics();
          gpus[0].load ??= fallback.load;
          gpus[0].memUsed ??= fallback.memUsed;
          gpus[0].memTotal ??= fallback.memTotal;
        }

        if (gpus.length) out.gpus = gpus;
      }).catch(() => undefined),
      si.fsSize().then((list) => {
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
      }).catch(() => undefined),
      si.processes().then((p) => {
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
      }).catch(() => undefined),
    ]);
    return out;
  }

  private async getNetwork(): Promise<NetworkMetrics | undefined> {
    try {
      const stats = await si.networkStats();
      const primary = stats?.[0];
      if (!primary) return undefined;
      return {
        iface: primary.iface,
        rxSec: Math.max(0, num(primary.rx_sec) ?? 0),
        txSec: Math.max(0, num(primary.tx_sec) ?? 0),
        rxBytes: num(primary.rx_bytes),
        txBytes: num(primary.tx_bytes),
      };
    } catch {
      return undefined;
    }
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
