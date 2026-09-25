import { AgentIdentityManager } from './identity';
import { LocalDirectoryScanner } from './scanner';
import * as os from 'os';

export interface DaemonConfig {
  intervalMs?: number;
  apiUrl: string;
}

export class AgentDaemon {
  private isRunning: boolean = false;
  private intervalMs: number;
  private apiUrl: string;
  private identityManager: AgentIdentityManager;

  constructor(config: DaemonConfig) {
    this.intervalMs = config.intervalMs || 10000;
    this.apiUrl = config.apiUrl;
    this.identityManager = new AgentIdentityManager();
  }

  async start(): Promise<void> {
    const identity = await this.identityManager.load();
    if (!identity || !identity.apiKey) {
      throw new Error('Agent not enrolled. Please enroll first.');
    }

    this.isRunning = true;
    console.log(`Starting ERP Preflight Daemon on ${identity.hostname}...`);
    console.log(`Polling ${this.apiUrl} every ${this.intervalMs}ms.`);

    const shutdown = () => {
      console.log('\nShutting down daemon...');
      this.isRunning = false;
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    while (this.isRunning) {
      try {
        await this.poll(identity);
      } catch (err: any) {
        console.error(`[Daemon Error] ${err.message}`);
      }
      if (this.isRunning) {
        await new Promise((resolve) => setTimeout(resolve, this.intervalMs));
      }
    }
  }

  private async poll(identity: any): Promise<void> {
    const memUsage = process.memoryUsage();
    const heartbeat = {
      deviceId: identity.deviceId,
      uptime: process.uptime(),
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
      },
      cpuLoad: os.loadavg(),
      timestamp: new Date().toISOString()
    };

    const res = await fetch(`${this.apiUrl}/agent-gate/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${identity.apiKey}`
      },
      body: JSON.stringify(heartbeat)
    });

    if (!res.ok) {
      console.error(`Heartbeat failed: HTTP ${res.status}`);
      return;
    }

    const { tasks } = await res.json() as any;
    if (tasks && tasks.length > 0) {
      for (const task of tasks) {
        if (task.type === 'scan') {
          console.log(`Executing task ${task.id}: scan ${task.payload.dir}`);
          const artifacts = LocalDirectoryScanner.scan({
            rootDir: task.payload.dir,
            redactSecrets: true
          });
          
          await fetch(`${this.apiUrl}/agent-gate/tasks/${task.id}/complete`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${identity.apiKey}`
            },
            body: JSON.stringify({ artifactsCount: artifacts.length })
          });
          console.log(`Task ${task.id} completed.`);
        }
      }
    }
  }
}
