import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import { OutboxDispatcherService } from '../src/modules/outbox/outbox-dispatcher.service';

describe('Transactional Outbox Service Suite (Part 16.7)', () => {
  let service: OutboxService;
  let dispatcher: OutboxDispatcherService;
  let mockDb: any;
  let storedEvents: any[] = [];

  beforeEach(() => {
    storedEvents = [];
    mockDb = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (sql.includes('INSERT INTO domain_events_outbox')) {
          const row = {
            id: params![0],
            organization_id: params![1],
            event_type: params![2],
            aggregate_type: params![3],
            aggregate_id: params![4],
            payload: JSON.parse(params![5]),
            status: 'PENDING',
            attempts: 0,
            max_attempts: 5,
            created_at: new Date().toISOString(),
          };
          storedEvents.push(row);
          return { rows: [row] };
        }
        if (sql.includes("WHERE status = 'PENDING'")) {
          return { rows: storedEvents.filter((e) => e.status === 'PENDING') };
        }
        if (sql.includes("SET status = 'DISPATCHED'")) {
          const id = params![0];
          const item = storedEvents.find((e) => e.id === id);
          if (item) {
            item.status = 'DISPATCHED';
            item.attempts += 1;
            item.dispatched_at = new Date().toISOString();
          }
          return { rows: [] };
        }
        if (sql.includes('UPDATE domain_events_outbox')) {
          const id = params![3];
          const item = storedEvents.find((e) => e.id === id);
          if (item) {
            item.status = params![0];
            item.attempts = params![1];
            item.error_message = params![2];
          }
          return { rows: [] };
        }
        if (sql.includes('WHERE organization_id = $1')) {
          return { rows: storedEvents.filter((e) => e.organization_id === params![0]) };
        }
        return { rows: [] };
      }),
    };
    service = new OutboxService(mockDb);
    dispatcher = new OutboxDispatcherService(service);
  });

  it('atomically records domain event with PENDING status and valid metadata', async () => {
    const event = await service.recordEvent(
      'org-100',
      'finding.created',
      'FINDING',
      'f0000000-0000-0000-0000-000000000001',
      { ruleId: 'OPD_DETERMINATION_STEP_MISSING', severity: 'BLOCKER' }
    );

    expect(event.organizationId).toBe('org-100');
    expect(event.eventType).toBe('finding.created');
    expect(event.aggregateType).toBe('FINDING');
    expect(event.aggregateId).toBe('f0000000-0000-0000-0000-000000000001');
    expect(event.status).toBe('PENDING');
    expect(event.payload.ruleId).toBe('OPD_DETERMINATION_STEP_MISSING');
  });

  it('dispatches pending events to registered subscribers and marks DISPATCHED', async () => {
    const handled: any[] = [];
    service.subscribe('finding.created', async (evt) => {
      handled.push(evt);
    });

    await service.recordEvent(
      'org-100',
      'finding.created',
      'FINDING',
      'f0000000-0000-0000-0000-000000000001',
      { ruleId: 'OPD_DETERMINATION_STEP_MISSING' }
    );

    const result = await service.dispatchPendingEvents();
    expect(result.dispatched).toBe(1);
    expect(result.failed).toBe(0);
    expect(handled.length).toBe(1);
    expect(handled[0].eventType).toBe('finding.created');
    expect(storedEvents[0].status).toBe('DISPATCHED');
  });

  it('increments attempts and preserves PENDING if subscriber fails, failing to FAILED after max attempts', async () => {
    service.subscribe('error.event', async () => {
      throw new Error('Connection timeout to downstream webhook');
    });

    await service.recordEvent(
      'org-100',
      'error.event',
      'ANALYSIS',
      'a0000000-0000-0000-0000-000000000001',
      { test: true }
    );

    // Attempt 1
    const res1 = await service.dispatchPendingEvents();
    expect(res1.failed).toBe(1);
    expect(storedEvents[0].attempts).toBe(1);
    expect(storedEvents[0].status).toBe('PENDING');
    expect(storedEvents[0].error_message).toContain('downstream webhook');
  });

  it('OutboxDispatcherService starts worker, executes triggerDispatch, and stops worker cleanly', async () => {
    await service.recordEvent(
      'org-100',
      'project.created',
      'PROJECT',
      'p0000000-0000-0000-0000-000000000001',
      { name: 'Migration Project' }
    );

    const res = await dispatcher.triggerDispatch(10);
    expect(res.dispatched).toBe(1);
    expect(res.failed).toBe(0);
    expect(storedEvents[0].status).toBe('DISPATCHED');

    dispatcher.onModuleInit();
    dispatcher.onModuleDestroy();
  });
});
