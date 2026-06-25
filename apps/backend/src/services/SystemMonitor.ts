// System Monitor - Local PC Monitoring
import { deviceManager } from '../core/DeviceManager';
import { eventSystem } from '../core/EventSystem';
import * as os from 'os';
import * as fs from 'fs';
// `systeminformation` powers the extended ("slow tier") metrics: GPU, CPU
// temperature, per-disk usage, processes and network throughput. It is treated
// as an OPTIONAL dependency and loaded lazily — if it is missing (e.g. a stale
// or incomplete `npm install`), the backend keeps running and serves the
// os-level core metrics (CPU%, RAM, disk, uptime) instead of crashing on boot.
import type Si from 'systeminformation';
import type { SystemMetrics, DiskMetrics, GpuMetrics, NetworkMetrics, ProcessInfo } from '@shared/types';

let siLoader: Promise<Si | null> | undefined;
let siWarned = false;

function loadSi(): Promise<Si | null> {
  if (!siLoader) {
    siLoader = import('systeminformation')
      .then((mod) => (mod as { default?: Si }).default ?? (mod as unknown as Si))
      .catch(() => {
        if (!siWarned) {
          siWarned = true;
          console.warn(
            '[SystemMonitor] Optional dependency "systeminformation" is not installed — ' +
              'extended metrics (GPU, temperature, per-disk, processes, network) are disabled. ' +
              'Run `npm install` from the repo ROOT to enable them.'
          );
        }
        return null;
      });
  }
  return siLoader;
}

// Canonical definition lives in @shared/types; re-exported for existing callers.
export type { SystemMetrics };

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

export class SystemMonitor {
  private monitorInterval: NodeJS.Timeout | null = null;
  private localDeviceId: string | null = null;
  private updateInterval = 1000; // 1 second (fast tier)
  private slowIntervalMs = 5000; // heavier metrics (gpu/temp/disks/processes)
  private lastCPUMeasure: { idle: number; total: number } | null = null;

  // Cache of the heavy ("slow tier") metrics, merged into every snapshot.
  private slowCache: Partial<SystemMetrics> = {};
  private lastSlowAt = 0;
  private collecting = false;
  private lastMetrics: SystemMetrics | null = null;

  /**
   * Start monitoring
   */
  start(): void {
    if (this.monitorInterval) {
      console.warn('System monitor already running');
      return;
    }

    // Register local device, reusing a persisted entry (matched by name + type)
    // so restarts don't accumulate duplicate "local" devices.
    if (!this.localDeviceId) {
      const device = deviceManager.registerOrUpdateDevice(
        'local',
        os.hostname(),
        ['cpu', 'ram', 'disk', 'gpu', 'network', 'temperature', 'processes', 'uptime'],
        { os: os.platform(), arch: os.arch() }
      );
      this.localDeviceId = device.id;
    }

    // Initialize CPU baseline
    this.lastCPUMeasure = this.getCPUTimeDiff();

    this.monitorInterval = setInterval(() => {
      void this.collectMetrics();
    }, this.updateInterval);

    eventSystem.emit('monitor:started', { deviceId: this.localDeviceId }, 'system-monitor');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      eventSystem.emit('monitor:stopped', {}, 'system-monitor');
    }
  }

  /**
   * Collect system metrics (async: fast tier every tick, slow tier cached).
   */
  private async collectMetrics(): Promise<void> {
    if (!this.localDeviceId || this.collecting) return;
    this.collecting = true;

    try {
      const cpuUsage = this.getCPUUsage();
      const memTotal = os.totalmem();
      const memUsed = memTotal - os.freemem();

      // Fast tier: network throughput (systeminformation keeps internal state,
      // so rates become meaningful after the first sample).
      const network = await this.getNetwork();

      // Slow tier: refresh the heavier metrics on a relaxed cadence.
      const now = Date.now();
      if (now - this.lastSlowAt >= this.slowIntervalMs || this.lastSlowAt === 0) {
        this.lastSlowAt = now;
        this.slowCache = await this.collectSlowTier();
      }

      const primaryDisk = this.getDiskUsage();
      const metrics: SystemMetrics = {
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
          : primaryDisk,
        disks: this.slowCache.disks,
        gpus: this.slowCache.gpus,
        fansRpm: this.slowCache.fansRpm,
        network,
        processes: this.slowCache.processes,
        uptime: os.uptime(),
        hostname: os.hostname(),
        platform: os.platform(),
      };

      this.lastMetrics = metrics;
      deviceManager.recordData(this.localDeviceId, metrics);
    } catch (error) {
      console.error('Error collecting metrics:', error);
    } finally {
      this.collecting = false;
    }
  }

  /**
   * Heavier metrics gathered on a relaxed cadence. Every probe is guarded so a
   * single unavailable sensor (e.g. no GPU/temperature in a VM) never breaks the
   * whole snapshot.
   */
  private async collectSlowTier(): Promise<Partial<SystemMetrics>> {
    const out: Partial<SystemMetrics> = {};

    const s = await loadSi();
    if (!s) return out;

    await Promise.all([
      s
        .cpuTemperature()
        .then((t) => {
          const main = num(t.main);
          if (main !== undefined && main > 0) out.cpuTempC = Math.round(main);
        })
        .catch(() => undefined),
      s
        .cpu()
        .then((c) => {
          out.cpuModel = `${c.manufacturer ?? ''} ${c.brand ?? ''}`.trim() || undefined;
          out.cpuCores = num(c.cores);
        })
        .catch(() => undefined),
      s
        .graphics()
        .then((g) => {
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
        })
        .catch(() => undefined),
      s
        .fsSize()
        .then((list) => {
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
        })
        .catch(() => undefined),
      s
        .processes()
        .then((p) => {
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
        })
        .catch(() => undefined),
    ]);

    return out;
  }

  private async getNetwork(): Promise<NetworkMetrics | undefined> {
    const s = await loadSi();
    if (!s) return undefined;
    try {
      const stats = await s.networkStats();
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

  /**
   * Get disk usage for the root filesystem (os-level fallback).
   */
  private getDiskUsage(): SystemMetrics['disk'] {
    try {
      const stats = (fs as any).statfsSync('/');
      const total = stats.blocks * stats.bsize;
      const free = stats.bfree * stats.bsize;
      const used = total - free;
      return { used, total, percentage: (used / total) * 100 };
    } catch {
      return undefined;
    }
  }

  /**
   * Get cumulative CPU times
   */
  private getCPUTimeDiff(): { idle: number; total: number } {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });

    return { idle: totalIdle, total: totalTick };
  }

  /**
   * Get CPU usage percentage based on delta measurement
   */
  private getCPUUsage(): number {
    const currentCPU = this.getCPUTimeDiff();

    if (!this.lastCPUMeasure) {
      this.lastCPUMeasure = currentCPU;
      return 0;
    }

    const idleDiff = currentCPU.idle - this.lastCPUMeasure.idle;
    const totalDiff = currentCPU.total - this.lastCPUMeasure.total;

    this.lastCPUMeasure = currentCPU;

    if (totalDiff === 0) {
      return 0;
    }

    const usage = 100 - ~~(100 * idleDiff / totalDiff);
    return Math.max(0, Math.min(100, usage));
  }

  /**
   * Get current metrics (last collected snapshot, or an os-only fallback before
   * the first async collection completes).
   */
  getCurrentMetrics(): SystemMetrics {
    if (this.lastMetrics) return this.lastMetrics;

    const memTotal = os.totalmem();
    const memUsed = memTotal - os.freemem();
    return {
      cpu: this.getCPUUsage(),
      cpuCores: os.cpus().length,
      ram: { used: memUsed, total: memTotal, percentage: (memUsed / memTotal) * 100 },
      disk: this.getDiskUsage(),
      uptime: os.uptime(),
      hostname: os.hostname(),
      platform: os.platform(),
    };
  }

  /**
   * Get local device ID
   */
  getLocalDeviceId(): string | null {
    return this.localDeviceId;
  }
}

export const systemMonitor = new SystemMonitor();
