import { SetMetadata } from '@nestjs/common';

export const AUDITED_KEY = 'erppreflight:audited';

export interface AuditContext {
  request: any;
  params: Record<string, string>;
  body: any;
  result: any;
}

export interface AuditSpec {
  /** Dotted action name, e.g. `project.created`. */
  action: string | ((ctx: AuditContext) => string);
  /** Stored in audit_events.target_type, e.g. `PROJECT`. */
  targetType: string;
  /** Resolves the target id (must be a UUID to be stored in target_id; anything else goes to payload). */
  targetId?: (ctx: AuditContext) => string | null | undefined;
  /**
   * Explicit, minimal payload. Never pass whole request bodies: bodies can
   * contain secrets (passwords, webhook secrets, API keys).
   */
  payload?: (ctx: AuditContext) => Record<string, unknown>;
  /**
   * Security-relevant events are FAIL-CLOSED: if the audit row cannot be
   * written the request fails with 503 (for login this means no session token
   * is issued). Operational events are fail-open and logged at ERROR level.
   */
  security?: boolean;
  /** Also record a `<failureAction>` event when the handler throws. */
  failureAction?: string;
  /**
   * How to find the tenant ledger for failure events when there is no
   * authenticated tenant (e.g. failed login → the account's primary org).
   */
  failureTenant?: 'loginEmail';
  /** For successful unauthenticated calls (login/register), read tenant + actor from the response. */
  tenantFromResult?: (result: any) => { organizationId?: string; actorId?: string } | null | undefined;
}

/** Marks a route as an auditable business event (see AuditInterceptor). */
export const Audited = (spec: AuditSpec) => SetMetadata(AUDITED_KEY, spec);
