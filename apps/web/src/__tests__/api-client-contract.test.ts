import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchProjects,
  fetchProject,
  createProject,
  fetchFindings,
  normalizeFindingsPage,
  triggerAnalysis,
  fetchAgentProposals,
  submitAgentProposal,
  normalizeProjectFile,
  fetchProjectFiles,
  downloadReproducibilityBundle,
  exportAnalysisReport,
  CANONICAL_ENGINES,
} from '../lib/api-client';
import {
  ApiError,
  LEGACY_AUTH_TOKEN_KEY,
  parseContentDispositionFileName,
  resolveApiRootUrl,
} from '../lib/api/custom-instance';
import { buildFindingsQueryParams } from '../hooks/useFindingsPage';

const BASE = 'https://api.example.test';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api-client contract', () => {
  const originalEnv = process.env.NEXT_PUBLIC_API_URL;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = BASE;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalEnv !== undefined) process.env.NEXT_PUBLIC_API_URL = originalEnv;
    else delete process.env.NEXT_PUBLIC_API_URL;
  });

  const lastCall = () => {
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    return { url: String(url), init: (init ?? {}) as RequestInit };
  };

  describe('projects', () => {
    it('propagates API errors instead of returning an empty list', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ statusCode: 500, message: 'boom' }, 500));
      await expect(fetchProjects()).rejects.toBeInstanceOf(ApiError);
    });

    it('parses camelCase project records', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse([
          {
            id: 'p1',
            organizationId: 'o1',
            name: 'Proj',
            description: null,
            targetRelease: 'S4H_2022',
            status: 'ACTIVE',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        ])
      );
      const list = await fetchProjects();
      expect(list).toHaveLength(1);
      expect(list[0].targetRelease).toBe('S4H_2022');
      expect(list[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(lastCall().url).toBe(`${BASE}/api/v1/projects`);
    });

    it('rejects a malformed project payload', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ id: 'p1' }));
      await expect(fetchProject('p1')).rejects.toThrow();
    });

    it('does not send environments when creating a project', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ id: 'p1', name: 'x' }));
      await createProject({ name: 'x', targetRelease: 'S4H_2023' });
      const body = JSON.parse(String(lastCall().init.body));
      expect(body).toEqual({ name: 'x', targetRelease: 'S4H_2023' });
      expect(body).not.toHaveProperty('environments');
    });
  });

  describe('findings', () => {
    it('returns the paginated envelope and forwards page/pageSize', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          items: [{ id: 'f1' }],
          pagination: { page: 2, pageSize: 25, total: 51, totalPages: 3 },
        })
      );
      const page = await fetchFindings({ projectId: 'p1', page: 2, pageSize: 25 });
      expect(page.items).toHaveLength(1);
      expect(page.pagination).toEqual({ page: 2, pageSize: 25, total: 51, totalPages: 3 });
      expect(lastCall().url).toBe(`${BASE}/api/v1/findings?projectId=p1&page=2&pageSize=25`);
    });

    it('propagates errors so the UI can show isError + retry', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ statusCode: 503, message: 'down' }, 503));
      await expect(fetchFindings()).rejects.toBeInstanceOf(ApiError);
    });

    it('treats an unexpected shape as an error', () => {
      expect(() => normalizeFindingsPage(undefined)).toThrow();
    });

    it('maps URL table state to server query params (single-value filters, capped page size)', () => {
      expect(
        buildFindingsQueryParams(
          {
            page: 3,
            pageSize: 250,
            search: 'bkpf',
            filters: { severity: ['BLOCKER'], engineType: ['OPD_GUARD', 'FORM_DOCTOR'] },
          },
          'p1'
        )
      ).toEqual({
        projectId: 'p1',
        page: 3,
        pageSize: 100,
        search: 'bkpf',
        severity: 'BLOCKER',
        engine: undefined,
        latest: true,
      });
    });

    it('passes finding lifecycle filters (multi-status, assignee, due) to the server', () => {
      const params = buildFindingsQueryParams(
        {
          page: 1,
          pageSize: 50,
          filters: { status: ['OPEN', 'ACKNOWLEDGED'], assignee: ['me'], due: ['overdue'] },
        },
        'p1'
      );
      expect(params).toMatchObject({ status: 'OPEN,ACKNOWLEDGED', assignee: 'me', due: 'overdue', latest: true });
      expect(buildFindingsQueryParams({ page: 1, pageSize: 50, filters: {} }).latest).toBeUndefined();
    });

    it('serializes lifecycle filters into the findings request', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ items: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }));
      await fetchFindings({ projectId: 'p1', status: 'OPEN,RESOLVED', assignee: 'unassigned', due: 'due_soon', latest: true });
      const url = String(fetchMock.mock.calls[0][0]);
      expect(url).toContain('status=OPEN%2CRESOLVED');
      expect(url).toContain('assignee=unassigned');
      expect(url).toContain('due=due_soon');
      expect(url).toContain('latest=true');
    });
  });

  describe('analyses', () => {
    it('refuses to launch without file IDs', async () => {
      await expect(
        triggerAnalysis({ projectId: 'p1', engineTypes: ['OPD_GUARD'], fileIds: [] })
      ).rejects.toThrow(/CLEAN/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('posts fileIds and target release and returns the queued analysis', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          analysisId: 'a1',
          status: 'QUEUED',
          engineTypes: ['OPD_GUARD'],
          targetRelease: 'S4H_2022',
        })
      );
      const res = await triggerAnalysis({
        projectId: 'p1',
        engineTypes: ['OPD_GUARD'],
        targetRelease: 'S4H_2022',
        fileIds: ['f1'],
      });
      expect(res.status).toBe('QUEUED');
      const { url, init } = lastCall();
      expect(url).toBe(`${BASE}/api/v1/analyses`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({
        projectId: 'p1',
        engineTypes: ['OPD_GUARD'],
        targetRelease: 'S4H_2022',
        fileIds: ['f1'],
      });
    });
  });

  describe('project files', () => {
    it('normalizes camelCase and legacy snake_case file records', () => {
      expect(
        normalizeProjectFile({
          id: 'f1',
          name: 'a.xml',
          detectedFormat: 'XML',
          sizeBytes: 10,
          quarantineStatus: 'CLEAN',
          createdAt: '2026-01-01',
        })
      ).toMatchObject({ id: 'f1', name: 'a.xml', detectedFormat: 'XML', sizeBytes: 10, quarantineStatus: 'CLEAN' });
      expect(
        normalizeProjectFile({ id: 'f2', file_name: 'b.csv', file_size: '5', quarantine_status: 'QUARANTINED' })
      ).toMatchObject({ name: 'b.csv', detectedFormat: 'CSV', sizeBytes: 5, quarantineStatus: 'QUARANTINED' });
    });

    it('lists files from the ingestion route', async () => {
      fetchMock.mockResolvedValue(jsonResponse([{ id: 'f1', name: 'a.json', quarantineStatus: 'CLEAN' }]));
      const files = await fetchProjectFiles('p1');
      expect(files[0].quarantineStatus).toBe('CLEAN');
      expect(lastCall().url).toBe(`${BASE}/api/v1/projects/p1/files`);
    });
  });

  describe('agent gate', () => {
    it('lists proposals via the project-scoped route and requires a project', async () => {
      await expect(fetchAgentProposals('')).rejects.toThrow();
      fetchMock.mockResolvedValue(jsonResponse([]));
      await fetchAgentProposals('p1');
      expect(lastCall().url).toBe(`${BASE}/api/v1/agent-gate/projects/p1/proposals`);
    });

    it('submits proposals to POST /agent-gate/propose', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ id: 'x', verdict: 'CLEAR' }));
      await submitAgentProposal({
        projectId: 'p1',
        agentId: 'ag1',
        changeType: 'REMOVE_CUSTOM_FIELD',
        proposedDiff: { a: 1 },
      });
      const { url, init } = lastCall();
      expect(url).toBe(`${BASE}/api/v1/agent-gate/propose`);
      expect(init.method).toBe('POST');
    });
  });

  describe('downloads', () => {
    it('downloads the reproducibility bundle with the session cookie (never a stored bearer token)', async () => {
      localStorage.setItem(LEGACY_AUTH_TOKEN_KEY, 'tok-123');
      fetchMock.mockResolvedValue(
        new Response(new Blob(['PK']), {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="bundle-a1.zip"' },
        })
      );
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      const file = await downloadReproducibilityBundle('a1');
      expect(file.fileName).toBe('bundle-a1.zip');
      const { url, init } = lastCall();
      expect(url).toBe(`${BASE}/api/v1/analyses/a1/reproducibility-bundle`);
      expect(new Headers(init.headers).get('Authorization')).toBeNull();
      expect(init.credentials).toBe('include');
      expect(clickSpy).toHaveBeenCalledTimes(1);
      clickSpy.mockRestore();
    });

    it('surfaces download failures as ApiError', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ statusCode: 404, message: 'nope' }, 404));
      await expect(downloadReproducibilityBundle('a1')).rejects.toBeInstanceOf(ApiError);
    });

    it('requests report exports through the real export endpoint', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ reportId: 'r1', downloadUrl: 'https://s3/x' }));
      await exportAnalysisReport('p1', 'a1', 'PDF');
      const { url, init } = lastCall();
      expect(url).toBe(`${BASE}/api/v1/projects/p1/analyses/a1/export`);
      expect(JSON.parse(String(init.body))).toEqual({ format: 'PDF' });
    });

    it('parses Content-Disposition file names', () => {
      expect(parseContentDispositionFileName('attachment; filename="r.html"')).toBe('r.html');
      expect(parseContentDispositionFileName("attachment; filename*=UTF-8''a%20b.zip")).toBe('a b.zip');
      expect(parseContentDispositionFileName(null)).toBeNull();
    });
  });

  describe('health URL resolution', () => {
    it('resolves /health/readiness outside the /api/v1 prefix', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test/api/v1/';
      expect(resolveApiRootUrl('/health/readiness')).toBe('https://api.example.test/health/readiness');
      process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test';
      expect(resolveApiRootUrl('health/readiness')).toBe('https://api.example.test/health/readiness');
    });
  });

  it('does not ship invented per-engine rule counts', () => {
    for (const engine of CANONICAL_ENGINES) {
      expect(engine).not.toHaveProperty('rulesCount');
    }
  });
});
