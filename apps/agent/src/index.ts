// Remote PC Agent
import dotenv from 'dotenv';
import { io, Socket } from 'socket.io-client';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
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
      si.graphics().then((g) => {
        const gpus: GpuMetrics[] = (g.controllers ?? [])
          .map((c) => ({
            model: c.model,
            vendor: c.vendor,
            load: num(c.utilizationGpu),
            tempC: num(c.temperatureGpu),
            memUsed: num(c.memoryUsed) !== undefined ? (c.memoryUsed as number) * 1024 * 1024 : undefined,
            memTotal: num(c.memoryTotal) !== undefined ? (c.memoryTotal as number) * 1024 * 1024 : undefined,
          }))
          .filter((gpu) => gpu.model || gpu.load !== undefined || gpu.memTotal !== undefined);
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
