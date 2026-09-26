import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '../test/render';
import { ApiBaselineSelector, ApiBaselinesPanel } from '../components/analysis/api-baselines-panel';

const PROJECT = 'c3333333-3333-4333-8333-333333333333';
const FILE = 'f1111111-1111-4111-8111-111111111111';

function baseline(over: Record<string, unknown> = {}) {
  return {
    id: 'e7777777-7777-4777-8777-777777777777',
    projectId: PROJECT,
    name: 'Sales Order API',
    format: 'OPENAPI',
    specVersion: '3.0.3',
    version: '1.4.0',
    sha256: 'ab'.repeat(32),
    sizeBytes: 5120,
    sourceFileId: FILE,
    sourceFileName: 'salesorder-v1.json',
    apiTitle: 'Sales Order API',
    surface: { paths: 3, operations: 4, schemas: 1 },
    isActive: true,
    createdBy: null,
    createdAt: '2026-09-26T10:00:00.000Z',
    activatedAt: '2026-09-26T10:00:00.000Z',
    ...over,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderWithQuery(ui: React.ReactElement, locale: 'en' | 'de' = 'en') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>, { locale });
}

afterEach(() => vi.unstubAllGlobals());

describe('ApiBaselinesPanel', () => {
  it('lists baselines with a non-colour status, surface and hash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([baseline(), baseline({ id: 'e8888888-8888-4888-8888-888888888888', name: 'SO EDMX', format: 'EDMX', version: 'sha-0123456789ab', isActive: false, surface: { entityTypes: 2, entitySets: 2 } })])));
    renderWithQuery(<ApiBaselinesPanel projectId={PROJECT} files={[]} />);
    const table = await screen.findByTestId('api-baselines-table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText('Active')).toBeInTheDocument();
    expect(within(rows[1]).getByText('3 paths · 4 operations · 1 schema')).toBeInTheDocument();
    expect(within(rows[1]).getByTitle('ab'.repeat(32))).toBeInTheDocument();
    expect(within(rows[2]).getByText('Inactive')).toBeInTheDocument();
    expect(within(rows[2]).getByText('2 entity types · 2 entity sets')).toBeInTheDocument();
    expect(within(rows[2]).getByRole('button', { name: 'Make SO EDMX sha-0123456789ab the active baseline' })).toBeInTheDocument();
  });

  it('shows the empty state and the German texts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([])));
    renderWithQuery(<ApiBaselinesPanel projectId={PROJECT} files={[]} />, 'de');
    expect(await screen.findByText('Noch keine API-Baseline registriert')).toBeInTheDocument();
    expect(screen.getByText('Keine CLEAN-Datei verfügbar – laden Sie zuerst die Spezifikation hoch.')).toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    const fetchMock = vi.fn(async () => json({ statusCode: 500, message: 'boom' }, 500));
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<ApiBaselinesPanel projectId={PROJECT} files={[]} />);
    expect(await screen.findByText('The API baselines could not be loaded')).toBeInTheDocument();
    fetchMock.mockImplementation(async () => json([]));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No API baseline registered yet')).toBeInTheDocument();
  });

  it('validates the form (Zod) and posts the registration, mapping server error codes', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (init?.method === 'POST') {
          return json({ statusCode: 422, code: 'API_BASELINE_UNSUPPORTED_FORMAT', message: 'x' }, 422);
        }
        return json([]);
      })
    );
    renderWithQuery(<ApiBaselinesPanel projectId={PROJECT} files={[{ id: FILE, name: 'notes.txt', detectedFormat: 'TXT' }]} />);
    await screen.findByText('No API baseline registered yet');
    fireEvent.click(screen.getByRole('button', { name: 'Register baseline' }));
    expect(await screen.findByText('Select the specification file.')).toBeInTheDocument();
    expect(screen.getByText('Enter a name for the baseline.')).toBeInTheDocument();
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);

    fireEvent.change(screen.getByLabelText(/Specification file/), { target: { value: FILE } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register baseline' }));
    expect(await screen.findByText('The file is not an OpenAPI (JSON / YAML) or OData EDMX specification.')).toBeInTheDocument();
    const post = calls.find((c) => c.init?.method === 'POST')!;
    expect(post.url).toContain(`/projects/${PROJECT}/api-baselines`);
    expect(JSON.parse(String(post.init?.body))).toEqual({ fileId: FILE, name: 'Notes' });
  });

  it('asks for confirmation before deleting', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (init?.method === 'DELETE') return json({ id: baseline().id, deleted: true, wasActive: true });
        return json([baseline()]);
      })
    );
    renderWithQuery(<ApiBaselinesPanel projectId={PROJECT} files={[]} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete baseline Sales Order API 1.4.0' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Sales Order API @ 1.4.0/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete baseline' }));
    await waitFor(() => expect(calls.some((c) => c.startsWith('DELETE'))).toBe(true));
  });
});

describe('ApiBaselineSelector', () => {
  it('defaults to the active baseline and lists every baseline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([baseline(), baseline({ id: 'e8888888-8888-4888-8888-888888888888', version: '1.3.0', isActive: false })])));
    const onChange = vi.fn();
    renderWithQuery(<ApiBaselineSelector projectId={PROJECT} value="" onChange={onChange} />);
    const select = await screen.findByLabelText('API baseline');
    expect(select).toHaveValue('');
    expect(within(select).getByText('Active baseline: Sales Order API @ 1.4.0')).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'e8888888-8888-4888-8888-888888888888' } });
    expect(onChange).toHaveBeenCalledWith('e8888888-8888-4888-8888-888888888888');
  });

  it('explains how to proceed without registered baselines', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([])));
    renderWithQuery(<ApiBaselineSelector projectId={PROJECT} value="" onChange={() => undefined} />);
    expect(await screen.findByText(/No API baseline is registered for this project/)).toBeInTheDocument();
  });
});
