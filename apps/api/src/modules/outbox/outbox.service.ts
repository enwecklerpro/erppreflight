import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DomainEventOutbox, OutboxEventStatus } from '@erppreflight/schemas';
import { v4 as uuidv4 } from 'uuid';

export interface OutboxSubscriber {
  (event: DomainEventOutbox): Promise<void>;
}

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private readonly subscribers = new Map<string, OutboxSubscriber[]>();

  constructor(private readonly db: DatabaseService) {}

  /**
   * Atomically records a domain event in the PostgreSQL outbox.
   * Can accept a specific transactional client or defaults to the database pool.
   */
  async recordEvent(
    tenantId: string,
    eventType: string,
    aggregateType: 'ANALYSIS' | 'FINDING' | 'PROJECT' | 'CHANGE_SET' | 'AGENT_PROPOSAL',
    aggregateId: string,
    payload: Record<string, any>,
    client?: any
  ): Promise<DomainEventOutbox> {
    const eventId = uuidv4();
    const sql = `
      INSERT INTO domain_events_outbox (
        id, organization_id, event_type, aggregate_type, aggregate_id, payload, status, attempts, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', 0, NOW())
      RETURNING *;
    `;
    const params = [
      eventId,
      tenantId,
      eventType,
      aggregateType,
      aggregateId,
      JSON.stringify(payload),
    ];

    const res = client
      ? await client.query(sql, params)
      : await this.db.query(sql, params);

    const row = res.rows[0];
    this.logger.debug(
      `Recorded outbox event ${row.id} [${row.event_type}] for ${row.aggregate_type}:${row.aggregate_id}`
    );

    return this.mapRowToDomainEvent(row);
  }

  /**
   * Registers an in-process subscriber for specific domain event types.
   */
  subscribe(eventType: string, handler: OutboxSubscriber): void {
    const list = this.subscribers.get(eventType) || [];
    list.push(handler);
    this.subscribers.set(eventType, list);
  }

  /**
   * Dispatches pending events with at-least-once delivery guarantees and retry tracking.
   */
  async dispatchPendingEvents(limit = 10): Promise<{ dispatched: number; failed: number }> {
    const pool = this.db.getPool();
    const client = await pool.connect();

    let dispatched = 0;
    let failed = 0;

    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `SELECT * FROM domain_events_outbox
         WHERE status = 'PENDING' AND attempts < max_attempts
         ORDER BY created_at ASC
         LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [limit]
      );

      for (const row of rows) {
        const event = this.mapRowToDomainEvent(row);
        try {
          const handlers = this.subscribers.get(event.eventType) || [];
          const wildcardHandlers = this.subscribers.get('*') || [];
          const allHandlers = [...handlers, ...wildcardHandlers];

          for (const handler of allHandlers) {
            await handler(event);
          }

          await client.query(
            `UPDATE domain_events_outbox
             SET status = 'DISPATCHED', dispatched_at = NOW(), attempts = attempts + 1
             WHERE id = $1`,
            [event.id]
          );
          dispatched++;
        } catch (err: any) {
          failed++;
          const nextAttempts = (row.attempts || 0) + 1;
          const newStatus = nextAttempts >= (row.max_attempts || 5) ? 'FAILED' : 'PENDING';

          await client.query(
            `UPDATE domain_events_outbox
             SET status = $1, attempts = $2, last_attempt_at = NOW(), error_message = $3
             WHERE id = $4`,
            [newStatus, nextAttempts, err.message || 'Unknown dispatch error', event.id]
          );

          this.logger.error(
            `Failed to dispatch event ${event.id} [${event.eventType}]: ${err.message}`
          );
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(`Error in dispatchPendingEvents transaction: ${(error as Error).message}`);
    } finally {
      client.release();
    }

    return { dispatched, failed };
  }

  /**
   * Retrieves outbox events for audit tracing.
   */
  async getOutboxEvents(
    tenantId: string,
    limit = 100
  ): Promise<DomainEventOutbox[]> {
    const res = await this.db.query(
      `SELECT * FROM domain_events_outbox
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [tenantId, limit]
    );
    return res.rows.map(this.mapRowToDomainEvent);
  }

  private mapRowToDomainEvent(row: any): DomainEventOutbox {
    return {
      id: row.id,
      organizationId: row.organization_id,
      eventType: row.event_type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      status: row.status as OutboxEventStatus,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at).toISOString() : undefined,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at).toISOString(),
      dispatchedAt: row.dispatched_at ? new Date(row.dispatched_at).toISOString() : undefined,
    };
  }
}
