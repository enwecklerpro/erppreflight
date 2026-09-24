export class TenantIsolationViolationException extends Error {
  constructor(message = 'TenantIsolationViolationException: Access denied to foreign tenant entity') {
    super(message);
    this.name = 'TenantIsolationViolationException';
  }
}

export function assertTenantMatch(resourceTenantId: string, requestedTenantId: string): void {
  if (resourceTenantId !== requestedTenantId) {
    throw new TenantIsolationViolationException(
      `TenantIsolationViolationException: Resource tenant '${resourceTenantId}' does not match requested tenant '${requestedTenantId}'`
    );
  }
}
