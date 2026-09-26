import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../test/render';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EngineMatrix } from '../components/engine-matrix';
import * as apiClient from '../lib/api-client';

describe('R6: Dynamic Engine Matrix Resilience & Failure Representation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          retryDelay: 0,
        },
      },
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    queryClient.clear();
  });

  function renderWithQueryClient(ui: React.ReactElement) {
    return render(
      <QueryClientProvider client={queryClient}>
        {ui}
      </QueryClientProvider>
    );
  }

  it('renders OFFLINE status with non-color triad on network failure (never static OPERATIONAL)', async () => {
    // Simulate network error / connection refused
    vi.spyOn(apiClient, 'fetchEngineStatus').mockRejectedValue(
      new Error('Failed to fetch: Connection refused (ECONNREFUSED 127.0.0.1:8000)')
    );

    renderWithQueryClient(<EngineMatrix />);

    // Wait for the query error state to settle
    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    // 1. Alert banner must be rendered with role="alert" and descriptive text
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/Analysis Services Offline \/ Unavailable/i);
    expect(alert).toHaveTextContent(/Connection refused/i);

    // 2. Retry prompt must be rendered and accessible
    const retryBtn = screen.getByRole('button', {
      name: /Retry connection to analysis services/i,
    });
    expect(retryBtn).toBeInTheDocument();

    // 3. Header status must indicate disconnected
    expect(screen.getByText(/Status: Disconnected \(0 \/ 19 Online\)/i)).toBeInTheDocument();

    // 4. EVERY engine card must be OFFLINE, ZERO cards must be OPERATIONAL
    const offlineBadges = screen.getAllByRole('status', {
      name: 'Engine status: Offline',
    });
    expect(offlineBadges.length).toBe(apiClient.CANONICAL_ENGINES.length);

    // CRITICAL INVARIANT: Zero OPERATIONAL cards when backend is unreachable!
    const operationalBadges = screen.queryAllByRole('status', {
      name: 'Engine status: Operational',
    });
    expect(operationalBadges.length).toBe(0);

    // 5. Non-color triad verification on OFFLINE cards:
    // a) Label text "OFFLINE"
    // b) Icon SVG present and aria-hidden="true"
    // c) Accessible role="status" and aria-label
    for (const badge of offlineBadges) {
      expect(badge).toHaveTextContent('OFFLINE');
      const icon = badge.querySelector('svg');
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('renders OFFLINE status with retry prompt on HTTP 500 server error', async () => {
    // Simulate HTTP 500 Internal Server Error
    const fetchSpy = vi.spyOn(apiClient, 'fetchEngineStatus').mockRejectedValue(
      new Error('HTTP 500 Internal Server Error')
    );

    renderWithQueryClient(<EngineMatrix />);

    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    // Initial call + 1 automatic retry = at least 2 calls
    const initialCalls = fetchSpy.mock.calls.length;
    expect(initialCalls).toBeGreaterThanOrEqual(2);

    // Zero OPERATIONAL cards
    expect(
      screen.queryAllByRole('status', { name: 'Engine status: Operational' }).length
    ).toBe(0);

    // All are OFFLINE
    const offlineBadges = screen.getAllByRole('status', {
      name: 'Engine status: Offline',
    });
    expect(offlineBadges.length).toBe(apiClient.CANONICAL_ENGINES.length);

    // Retry button triggers refetch
    const retryBtn = screen.getByRole('button', {
      name: /Retry connection to analysis services/i,
    });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  it('renders loading skeleton during initial query (never prematurely OPERATIONAL)', () => {
    // Return a promise that never resolves during this assertion
    vi.spyOn(apiClient, 'fetchEngineStatus').mockReturnValue(new Promise(() => {}));

    renderWithQueryClient(<EngineMatrix />);

    // Skeleton is active
    const skeleton = screen.getByLabelText('Loading engine operational status');
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute('aria-busy', 'true');

    // Zero cards with OPERATIONAL or any badge
    expect(
      screen.queryAllByRole('status', { name: 'Engine status: Operational' }).length
    ).toBe(0);
  });

  it('renders UNKNOWN fallback with non-color triad when empty data is returned without error', async () => {
    // Simulate empty response
    vi.spyOn(apiClient, 'fetchEngineStatus').mockResolvedValue({
      summary: { totalEngines: 19, operationalCount: 0, totalRules: 0, serviceStatus: 'UNKNOWN' },
      engines: [],
    });

    renderWithQueryClient(<EngineMatrix />);

    await waitFor(
      () => {
        const unknownBadges = screen.getAllByRole('status', {
          name: 'Engine status: Unknown',
        });
        expect(unknownBadges.length).toBe(apiClient.CANONICAL_ENGINES.length);
      },
      { timeout: 3000 }
    );

    // Zero OPERATIONAL cards
    expect(
      screen.queryAllByRole('status', { name: 'Engine status: Operational' }).length
    ).toBe(0);

    // Non-color triad on UNKNOWN cards
    const unknownBadges = screen.getAllByRole('status', {
      name: 'Engine status: Unknown',
    });
    for (const badge of unknownBadges) {
      expect(badge).toHaveTextContent('UNKNOWN');
      const icon = badge.querySelector('svg');
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('renders OPERATIONAL status only when backend explicitly returns operational status', async () => {
    // Simulate successful backend response
    vi.spyOn(apiClient, 'fetchEngineStatus').mockResolvedValue({
      summary: { totalEngines: 19, operationalCount: 19, totalRules: 310, serviceStatus: 'HEALTHY' },
      engines: apiClient.CANONICAL_ENGINES.map((e) => ({
        ...e,
        status: 'OPERATIONAL' as const,
      })),
    });

    renderWithQueryClient(<EngineMatrix />);

    await waitFor(
      () => {
        const opBadges = screen.getAllByRole('status', {
          name: 'Engine status: Operational',
        });
        expect(opBadges.length).toBe(apiClient.CANONICAL_ENGINES.length);
      },
      { timeout: 3000 }
    );

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/19 \/ 19 Active/i)).toBeInTheDocument();
    // Rule counts are not derived from a real rule registry, so they are never displayed.
    expect(screen.queryByText(/Rules/)).toBeNull();
  });
});
