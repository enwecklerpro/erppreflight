import { Injectable, Logger, Optional } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';

export interface IntegrationAuditEvent {
  organizationId: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  actorId?: string | null;
  actorType?: 'HUMAN' | 'AI_AGENT' | 'API_KEY' | 'SYSTEM';
  payload?: Record<string, unknown>;
}

/**
 * Audit hook for integration, identity and partner events (Part 15.24, C §61).
 * Writes to the tamper-evident audit ledger through AuditService. Audit failures
 * are logged, never swallowed silently, and never leak secrets: callers pass
 * only non-secret payload fields.
 */
@Injectable()
export class IntegrationAuditService {
  private readonly logger = new Logger(IntegrationAuditService.name);

  constructor(@Optional() private readonly audit?: AuditService) {}

  async record(event: IntegrationAuditEvent): Promise<void> {
    if (!this.audit) {
      this.logger.warn(`Audit service unavailable; event ${event.action} for ${event.organizationId} not recorded`);
      return;
    }
    try {
      await this.audit.recordEvent({
        organizationId: event.organizationId,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId ?? null,
        actorType: event.actorType ?? (event.actorId ? 'HUMAN' : 'SYSTEM'),
        actorId: event.actorId ?? null,
        payload: event.payload ?? {},
      });
    } catch (err: any) {
      this.logger.error(`Failed to record audit event ${event.action}: ${err?.message}`);
    }
  }
}
