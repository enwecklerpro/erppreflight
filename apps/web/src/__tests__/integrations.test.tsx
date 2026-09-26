import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../test/render';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HealthBadge, RemediationBadge, OutcomeBadge, ConfirmButton, PanelError } from '../components/integrations/ui';
import { buildFieldSchema } from '../components/integrations/connectors-panel';
import { WorkItemIntegration } from '../components/findings/work-item-integration';
import { ConnectorSchema } from '../lib/api/integrations';

function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('integration status badges never rely on colour alone', () => {
  it.each([
    ['HEALTHY', 'Healthy'],
    ['DEGRADED', 'Degraded'],
    ['UNHEALTHY', 'Unhealthy'],
    ['UNKNOWN', 'Not checked'],
  ])('HealthBadge %s renders text + icon', (status, text) => {
    const { container } = render(<HealthBadge status={status} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('explains that task completion is not a fix', () => {
    render(<RemediationBadge state="PENDING_VERIFICATION" />);
    const badge = screen.getByText('Pending verification').parentElement!;
    expect(badge.getAttribute('title')).toMatch(/never closes a finding/);
  });

  it('labels delivery outcomes', () => {
    render(<OutcomeBadge outcome="DEAD" />);
    expect(screen.getByText('Gave up')).toBeInTheDocument();
  });
});

describe('ConfirmButton', () => {
  it('requires a second explicit click and can be cancelled with Escape', () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Revoke" confirmLabel="Revoke now" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Revoke'));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Revoke now')).toBeNull();
    fireEvent.click(screen.getByText('Revoke'));
    fireEvent.click(screen.getByText('Revoke now'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('connector form schema from the server registry', () => {
  it('enforces required fields and URL formats', () => {
    const schema = buildFieldSchema([
      { name: 'baseUrl', kind: 'string', required: true },
      { name: 'projectKey', kind: 'string', required: true },
      { name: 'issueType', kind: 'string', required: false, defaultValue: 'Task' },
    ]);
    expect(schema.safeParse({ baseUrl: 'https://acme.atlassian.net', projectKey: 'SAP', issueType: '' }).success).toBe(true);
    const bad = schema.safeParse({ baseUrl: 'not a url', projectKey: '', issueType: '' });
    expect(bad.success).toBe(false);
  });

  it('validates connector API payloads at runtime', () => {
    expect(ConnectorSchema.safeParse({ id: 'x' }).success).toBe(false);
  });
});

describe('PanelError', () => {
  it('shows the error and a retry action', () => {
    const retry = vi.fn();
    render(<PanelError error={new Error('boom')} onRetry={retry} what="connectors" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load connectors');
    fireEvent.click(screen.getByText('Retry'));
    expect(retry).toHaveBeenCalled();
  });
});

describe('WorkItemIntegration (finding → work item)', () => {
  it('shows an actionable empty state instead of fake systems when nothing is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    );
    withQuery(<WorkItemIntegration findingId="11111111-1111-4111-8111-111111111111" />);
    await waitFor(() => expect(screen.getByText(/No work item connector is configured/)).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /Connect SAP Cloud ALM/ })).toHaveAttribute('href', '/integrations?tab=connectors');
  });
});
