// Remote PC Agent
import dotenv from 'dotenv';
import { io, Socket } from 'socket.io-client';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import type { SystemMetrics } from '@shared/types';

dotenv.config();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4001';
const AGENT_NAME = process.env.AGENT_NAME || os.hostname();
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '1000');

// The agent reports the shared SystemMetrics shape (plus a capture timestamp).
type RemoteSystemMetrics = SystemMetrics & { timestamp: number };

class RemoteAgent {
  private socket: Socket | null = null;
  private agentId: string = '';
  private pollInterval: NodeJS.Timeout | null = null;
  private lastCpuTimes: { [key: string]: number } = {};
  private previousCpuData: any[] = [];
  private readonly agentInfoPath = path.join(os.homedir(), '.deskos-agent.json');

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

    this.pollInterval = setInterval(() => {
      this.collectAndSendMetrics();
    }, POLL_INTERVAL);
  }

  /**
   * Collect and send metrics
   */
  private collectAndSendMetrics(): void {
    if (!this.socket) return;

    try {
      const metrics = this.getSystemMetrics();
      this.socket.emit('metrics', {
        agentId: this.agentId,
        metrics,
      });
    } catch (error) {
      console.error('Error collecting metrics:', error);
    }
  }

  /**
   * Get system metrics
   */
  private getSystemMetrics(): RemoteSystemMetrics {
    const cpus = os.cpus();
    const cpuUsage = this.calculateCPUUsage();
    const memInfo = os.totalmem();
    const memFree = os.freemem();
    const memUsed = memInfo - memFree;

    return {
      cpu: cpuUsage,
      ram: {
        used: memUsed,
        total: memInfo,
        percentage: (memUsed / memInfo) * 100,
      },
      uptime: os.uptime(),
      hostname: os.hostname(),
      platform: os.platform(),
      timestamp: Date.now(),
    };
  }

  /**
   * Calculate CPU usage (simplified)
   */
  private calculateCPUUsage(): number {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });

    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - ~~(100 * idle / total);

    return Math.max(0, Math.min(100, usage));
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
      case 'get-metrics':
        const metrics = this.getSystemMetrics();
        this.socket?.emit('metrics-response', { agentId: this.agentId, metrics });
        break;
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
