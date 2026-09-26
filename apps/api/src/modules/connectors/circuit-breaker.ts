/**
 * Persistent circuit breaker for connector instances (state lives in
 * connector_instances so it is shared by all API replicas).
 *
 * CLOSED   → calls allowed; `failureThreshold` consecutive failures → OPEN.
 * OPEN     → calls refused until `cooldownMs` elapsed, then one trial call (HALF_OPEN).
 * HALF_OPEN→ success closes the circuit, failure re-opens it.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitSnapshot {
  circuitState: CircuitState;
  consecutiveFailures: number;
  circuitOpenedAt: Date | null;
}

export interface CircuitSettings {
  failureThreshold: number;
  cooldownMs: number;
}

export function circuitSettings(env: NodeJS.ProcessEnv = process.env): CircuitSettings {
  const threshold = Number(env.CONNECTOR_CIRCUIT_FAILURE_THRESHOLD || 5);
  const cooldown = Number(env.CONNECTOR_CIRCUIT_COOLDOWN_MS || 60_000);
  return {
    failureThreshold: Number.isFinite(threshold) && threshold >= 1 ? Math.floor(threshold) : 5,
    cooldownMs: Number.isFinite(cooldown) && cooldown >= 0 ? cooldown : 60_000,
  };
}

export class CircuitOpenError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`Connector circuit is open after repeated failures; next trial in ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = 'CircuitOpenError';
  }
}

/** Decides whether a call may proceed; returns the state to persist before the call. */
export function beforeCall(
  snap: CircuitSnapshot,
  settings: CircuitSettings,
  now: Date
): { allowed: true; state: CircuitState } | { allowed: false; retryAfterMs: number } {
  if (snap.circuitState === 'OPEN') {
    const openedAt = snap.circuitOpenedAt?.getTime() ?? 0;
    const elapsed = now.getTime() - openedAt;
    if (elapsed < settings.cooldownMs) {
      return { allowed: false, retryAfterMs: settings.cooldownMs - elapsed };
    }
    return { allowed: true, state: 'HALF_OPEN' };
  }
  return { allowed: true, state: snap.circuitState };
}

export function afterSuccess(): CircuitSnapshot {
  return { circuitState: 'CLOSED', consecutiveFailures: 0, circuitOpenedAt: null };
}

export function afterFailure(snap: CircuitSnapshot, settings: CircuitSettings, now: Date, trial: boolean): CircuitSnapshot {
  const failures = snap.consecutiveFailures + 1;
  if (trial || snap.circuitState === 'HALF_OPEN' || failures >= settings.failureThreshold) {
    return { circuitState: 'OPEN', consecutiveFailures: failures, circuitOpenedAt: now };
  }
  return { circuitState: 'CLOSED', consecutiveFailures: failures, circuitOpenedAt: null };
}

/** Health derived from the breaker state and the last result. */
export function healthFor(snap: CircuitSnapshot, lastOk: boolean): 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' {
  if (snap.circuitState === 'OPEN') return 'UNHEALTHY';
  if (lastOk) return 'HEALTHY';
  return 'DEGRADED';
}
