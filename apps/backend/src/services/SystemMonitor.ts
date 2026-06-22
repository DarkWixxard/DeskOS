// System Monitor - Local PC Monitoring
import { deviceManager } from '../core/DeviceManager';
import { eventSystem } from '../core/EventSystem';
import * as os from 'os';
import * as fs from 'fs';
import type { SystemMetrics } from '@shared/types';

// Canonical definition lives in @shared/types; re-exported for existing callers.
export type { SystemMetrics };

export class SystemMonitor {
  private monitorInterval: NodeJS.Timeout | null = null;
  private localDeviceId: string | null = null;
  private updateInterval = 1000; // 1 second
  private lastCPUMeasure: { idle: number; total: number } | null = null;

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
        ['cpu', 'ram', 'disk', 'uptime', 'network'],
        { os: os.platform(), arch: os.arch() }
      );
      this.localDeviceId = device.id;
    }

    // Initialize CPU baseline
    this.lastCPUMeasure = this.getCPUTimeDiff();

    this.monitorInterval = setInterval(() => {
      this.collectMetrics();
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
   * Collect system metrics
   */
  private collectMetrics(): void {
    if (!this.localDeviceId) return;

    try {
      const cpuUsage = this.getCPUUsage();
      const memInfo = os.totalmem();
      const memFree = os.freemem();
      const memUsed = memInfo - memFree;

      const metrics: SystemMetrics = {
        cpu: cpuUsage,
        ram: {
          used: memUsed,
          total: memInfo,
          percentage: (memUsed / memInfo) * 100
        },
        disk: this.getDiskUsage(),
        uptime: os.uptime(),
        hostname: os.hostname(),
        platform: os.platform()
      };

      deviceManager.recordData(this.localDeviceId, metrics);
    } catch (error) {
      console.error('Error collecting metrics:', error);
    }
  }

  /**
   * Get disk usage for the root filesystem
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
   * Get current metrics
   */
  getCurrentMetrics(): SystemMetrics {
    const cpuUsage = this.getCPUUsage();
    const memInfo = os.totalmem();
    const memFree = os.freemem();
    const memUsed = memInfo - memFree;

    return {
      cpu: cpuUsage,
      ram: {
        used: memUsed,
        total: memInfo,
        percentage: (memUsed / memInfo) * 100
      },
      disk: this.getDiskUsage(),
      uptime: os.uptime(),
      hostname: os.hostname(),
      platform: os.platform()
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
