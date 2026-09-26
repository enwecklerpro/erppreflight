import * as os from 'os';
import { AgentIdentity, AgentIdentityManager, AGENT_VERSION } from './identity';
import { DeviceApiClient, DeviceApiError } from './client';
import { JobRejectedError, executeJob, verifyJob } from './jobs';

export interface DaemonConfig {
  intervalMs?: number;
  /** Run a single heartbeat/poll cycle and exit (used by `daemon --once` and tests). */
  once?: boolean;
  identityManager?: AgentIdentityManager;
  log?: (msg: string) => void;
}

/**
 * Outbound-only agent loop: signed heartbeat → receive signed jobs → verify →
 * execute locally (with redaction) → submit signed results.
 */
export class AgentDaemon {
  private running = false;
  private readonly seenJobs = new Set<string>();
  private readonly log: (msg: string) => void;
  private readonly identityManager: AgentIdentityManager;

  constructor(private readonly config: DaemonConfig = {}) {
    this.identityManager = config.identityManager ?? new AgentIdentityManager();
    this.log = config.log ?? ((m) => console.log(`[${new Date().toISOString()}] ${m}`));
  }

  async start(): Promise<{ cycles: number; jobsExecuted: number; jobsRejected: number }> {
    const identity = await this.identityManager.load();
    if (!identity) throw new Error('Agent not enrolled. Run: erp-preflight-agent enroll <apiUrl> <enrollmentToken>');
    const client = new DeviceApiClient(identity);
    const interval = this.config.intervalMs ?? identity.heartbeatIntervalSec * 1000;
    this.running = true;
    const stats = { cycles: 0, jobsExecuted: 0, jobsRejected: 0 };
    this.log(`Agent ${identity.name} (${identity.deviceId}) polling ${identity.apiUrl} every ${Math.round(interval / 1000)}s (outbound only)`);

    const stop = () => {
      this.running = false;
    };
    if (!this.config.once) {
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    }

    while (this.running) {
      try {
        const r = await this.cycle(identity, client);
        stats.jobsExecuted += r.executed;
        stats.jobsRejected += r.rejected;
      } catch (err: any) {
        if (err instanceof DeviceApiError && (err.status === 401 || err.status === 403)) {
          this.log(`Device credential rejected (${err.message}); the device may have been revoked. Stopping.`);
          throw err;
        }
        this.log(`Poll failed: ${err.message}`);
      }
      stats.cycles++;
      if (this.config.once) break;
      await new Promise((r) => setTimeout(r, interval));
    }
    return stats;
  }

  async cycle(identity: AgentIdentity, client: DeviceApiClient): Promise<{ executed: number; rejected: number }> {
    const mem = process.memoryUsage();
    const hb = await client.request<{ jobs: Array<{ jobId: string; envelope: string; signature: string }> }>('POST', '/agent-api/heartbeat', {
      agentVersion: AGENT_VERSION,
      uptimeSec: Math.round(process.uptime()),
      platform: `${process.platform}-${process.arch}`,
      capabilities: ['SCAN_DIRECTORY', 'PROBE_URL', 'LOCAL_REDACTION'],
      rssBytes: mem.rss,
      loadAvg: os.loadavg(),
    });
    let executed = 0;
    let rejected = 0;
    for (const j of hb.jobs || []) {
      let job;
      try {
        job = verifyJob(identity, j.envelope, j.signature, this.seenJobs);
      } catch (err: any) {
        rejected++;
        this.log(`Rejected job ${j.jobId}: ${err.message}`);
        if (err instanceof JobRejectedError && !/signature/.test(err.message)) {
          // Report rejections of authentic jobs so the operator sees why nothing ran.
          await client.request('POST', `/agent-api/jobs/${j.jobId}/result`, { status: 'REJECTED', error: err.message }).catch(() => undefined);
        }
        continue;
      }
      this.seenJobs.add(job.jobId);
      this.log(`Executing signed job ${job.jobId} (${job.type})`);
      try {
        const outcome = await executeJob(job);
        await client.request('POST', `/agent-api/jobs/${job.jobId}/result`, outcome);
        executed++;
        this.log(`Job ${job.jobId} completed`);
      } catch (err: any) {
        const status = err instanceof JobRejectedError ? 'REJECTED' : 'FAILED';
        await client.request('POST', `/agent-api/jobs/${job.jobId}/result`, { status, error: String(err.message).slice(0, 900) }).catch(() => undefined);
        this.log(`Job ${job.jobId} ${status}: ${err.message}`);
      }
    }
    return { executed, rejected };
  }
}
