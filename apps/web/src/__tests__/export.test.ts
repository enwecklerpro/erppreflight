import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Table, Row, Column } from '@tanstack/react-table';
import {
  escapeCsvCell,
  exportRawData,
  triggerExport,
  downloadBlob,
} from '../lib/export';

// exportToCsv convenience helper conforming to Part 21/22 export contract
export function exportToCsv(
  data: Record<string, unknown>[],
  filename?: string
): void {
  exportRawData(data, 'csv', filename);
}

describe('Enterprise CSV/JSON Export Pipeline & Invariants', () => {
  let createdBlob: Blob | null = null;
  let clickedHref = '';
  let clickedDownload = '';

  beforeEach(() => {
    createdBlob = null;
    clickedHref = '';
    clickedDownload = '';

    vi.spyOn(window.URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
      createdBlob = blob as Blob;
      return 'blob:mock-url-12345';
    });

    vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});

    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedHref = this.href;
      clickedDownload = this.download;
    });

    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('RFC 4180 Cell Escaping & Special Characters', () => {
    it('returns empty string for null and undefined', () => {
      expect(escapeCsvCell(null)).toBe('');
      expect(escapeCsvCell(undefined)).toBe('');
    });

    it('returns plain string without quotes for alphanumeric text', () => {
      expect(escapeCsvCell('SAP_ECC_60')).toBe('SAP_ECC_60');
      expect(escapeCsvCell(2023)).toBe('2023');
    });

    it('encloses text in double quotes if it contains commas', () => {
      expect(escapeCsvCell('Clean Core, Tier 1, RAP')).toBe('"Clean Core, Tier 1, RAP"');
    });

    it('escapes embedded double quotes by doubling them according to RFC 4180', () => {
      expect(escapeCsvCell('SAP Note "2827658"')).toBe('"SAP Note ""2827658"""');
      expect(escapeCsvCell('He said "Hello, World"')).toBe('"He said ""Hello, World"""');
    });

    it('encloses text containing carriage returns and newlines in double quotes', () => {
      expect(escapeCsvCell("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
      expect(escapeCsvCell("Line 1\r\nLine 2")).toBe('"Line 1\r\nLine 2"');
    });

    it('serializes object payloads as JSON strings and escapes appropriately', () => {
      const obj = { key: 'value', number: 42 };
      const escaped = escapeCsvCell(obj);
      expect(escaped).toContain('""key"":""value""');
    });
  });

  describe('CWE-1236: CSV Formula Injection Neutralization', () => {
    it('neutralizes formula injection by prefixing single quote on cells starting with =', () => {
      const payload = "=1+1; EXEC('calc')";
      const escaped = escapeCsvCell(payload);
      expect(escaped).toBe("'=1+1; EXEC('calc')");
    });

    it('neutralizes formula injection starting with + and -', () => {
      expect(escapeCsvCell('+12345')).toBe("'+12345");
      expect(escapeCsvCell('-SUM(A1:A10)')).toBe("'-SUM(A1:A10)");
    });

    it('neutralizes formula injection starting with @', () => {
      expect(escapeCsvCell('@SUM(B1:B5)')).toBe("'@SUM(B1:B5)");
    });

    it('neutralizes formula injection starting with tab (\\t) or carriage return (\\r)', () => {
      expect(escapeCsvCell('\tmalicious_tab_payload')).toBe("'\tmalicious_tab_payload");
      expect(escapeCsvCell('\rmalicious_cr_payload')).toBe("\"'\rmalicious_cr_payload\"");
    });
  });

  describe('UTF-8 BOM (\uFEFF) & exportRawData / exportToCsv', () => {
    it('prepends UTF-8 BOM (\\uFEFF) to guarantee Excel character encoding fidelity', async () => {
      const sampleRecords = [
        { id: 'REC-001', name: 'Z_SAP_EXT', status: 'VERIFIED' },
        { id: 'REC-002', name: 'BAPI_PO_CREATE', status: 'INFERRED' },
      ];

      exportToCsv(sampleRecords, 'test-export.csv');

      expect(createdBlob).not.toBeNull();
      expect(createdBlob?.type).toBe('text/csv;charset=utf-8;');
      expect(clickedDownload).toBe('test-export.csv');

      const content = await createdBlob!.text();
      // Must start with UTF-8 BOM
      expect(content.charCodeAt(0)).toBe(0xfeff);
      expect(content.startsWith('\uFEFF')).toBe(true);

      // Verify header and row line endings
      const lines = content.slice(1).split('\r\n');
      expect(lines[0]).toBe('id,name,status');
      expect(lines[1]).toBe('REC-001,Z_SAP_EXT,VERIFIED');
      expect(lines[2]).toBe('REC-002,BAPI_PO_CREATE,INFERRED');
    });

    it('exports valid formatted JSON when format is json', async () => {
      const sampleRecords = [{ id: '1', rule: 'CLEAN_CORE' }];

      exportRawData(sampleRecords, 'json', 'data.json');

      expect(createdBlob).not.toBeNull();
      expect(createdBlob?.type).toBe('application/json;charset=utf-8;');
      expect(clickedDownload).toBe('data.json');

      const content = await createdBlob!.text();
      const parsed = JSON.parse(content);
      expect(parsed).toEqual(sampleRecords);
    });
  });

  describe('triggerExport() Client and Server Pipeline', () => {
    function createMockTable<TData>(rows: TData[], columns: Array<{ id: string; header: string }>): Table<TData> {
      const rowObjects = rows.map((original, index) => ({
        id: `row-${index}`,
        original,
        getValue: (colId: string) => (original as any)[colId],
      })) as unknown as Row<TData>[];

      const columnObjects = columns.map((col) => ({
        id: col.id,
        columnDef: { header: col.header },
      })) as unknown as Column<TData, unknown>[];

      return {
        getFilteredRowModel: () => ({ rows: rowObjects }),
        getSelectedRowModel: () => ({ rows: [rowObjects[0]] }),
        getVisibleLeafColumns: () => columnObjects,
      } as unknown as Table<TData>;
    }

    it('exports the complete filtered dataset (Complete Dataset Export Invariant) omitting select/actions columns', async () => {
      const mockData = [
        { id: 'f-1', code: 'TIER3_DB', severity: 'BLOCKER' },
        { id: 'f-2', code: 'OPD_RULE', severity: 'CRITICAL' },
      ];

      const mockColumns = [
        { id: 'select', header: 'Select' },
        { id: 'code', header: 'Finding Code' },
        { id: 'severity', header: 'Severity' },
        { id: 'actions', header: 'Actions' },
      ];

      const table = createMockTable(mockData, mockColumns);

      await triggerExport({
        table,
        format: 'csv',
        filename: 'findings.csv',
        selectedOnly: false,
      });

      expect(createdBlob).not.toBeNull();
      const content = await createdBlob!.text();
      expect(content.startsWith('\uFEFF')).toBe(true);

      const lines = content.slice(1).split('\r\n');
      // Must include 'Finding Code' and 'Severity', but NOT 'Select' or 'Actions'
      expect(lines[0]).toBe('Finding Code,Severity');
      expect(lines[1]).toBe('TIER3_DB,BLOCKER');
      expect(lines[2]).toBe('OPD_RULE,CRITICAL');
    });

    it('exports only selected rows when selectedOnly=true', async () => {
      const mockData = [
        { id: 'f-1', code: 'TIER3_DB', severity: 'BLOCKER' },
        { id: 'f-2', code: 'OPD_RULE', severity: 'CRITICAL' },
      ];

      const mockColumns = [
        { id: 'code', header: 'Finding Code' },
        { id: 'severity', header: 'Severity' },
      ];

      const table = createMockTable(mockData, mockColumns);

      await triggerExport({
        table,
        format: 'csv',
        filename: 'selected-findings.csv',
        selectedOnly: true,
      });

      expect(createdBlob).not.toBeNull();
      const content = await createdBlob!.text();
      const lines = content.slice(1).split('\r\n');
      expect(lines.length).toBe(2); // Header + 1 selected row
      expect(lines[1]).toBe('TIER3_DB,BLOCKER');
    });

    it('falls back seamlessly to client-side serialization when serverExportUrl returns HTTP 404 Not Found', async () => {
      // Mock global fetch to return 404
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

      const mockData = [{ id: 'f-1', code: 'API_BREAK', severity: 'MAJOR' }];
      const mockColumns = [{ id: 'code', header: 'Finding Code' }];
      const table = createMockTable(mockData, mockColumns);

      await triggerExport({
        table,
        format: 'csv',
        filename: 'fallback.csv',
        serverExportUrl: '/api/v1/projects/proj-123/export',
        selectedOnly: false,
      });

      expect(fetchSpy).toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('returned HTTP 404. Falling back to client-side dataset serialization')
      );

      // Successfully downloaded fallback blob
      expect(createdBlob).not.toBeNull();
      const content = await createdBlob!.text();
      expect(content.startsWith('\uFEFF')).toBe(true);
      expect(content).toContain('API_BREAK');
    });

    it('falls back seamlessly to client-side serialization when server request throws network exception', async () => {
      // Mock global fetch to reject with network failure
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error: ECONNREFUSED'));

      const mockData = [{ id: 'f-1', code: 'SYS_REFRESH', severity: 'LOW' }];
      const mockColumns = [{ id: 'code', header: 'Code' }];
      const table = createMockTable(mockData, mockColumns);

      await triggerExport({
        table,
        format: 'csv',
        filename: 'network-fallback.csv',
        serverExportUrl: '/api/v1/projects/proj-123/export',
        selectedOnly: false,
      });

      expect(fetchSpy).toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Server export request failed (Network error: ECONNREFUSED)')
      );

      // Downloaded client fallback blob
      expect(createdBlob).not.toBeNull();
      const content = await createdBlob!.text();
      expect(content).toContain('SYS_REFRESH');
    });

    it('downloads server blob directly when server export succeeds with HTTP 200 OK', async () => {
      const serverBlob = new Blob(['server,csv,content'], { type: 'text/csv' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () => serverBlob,
      } as Response);

      const table = createMockTable([], []);

      await triggerExport({
        table,
        format: 'csv',
        filename: 'server-success.csv',
        serverExportUrl: '/api/v1/projects/proj-123/export',
        selectedOnly: false,
      });

      expect(createdBlob).toBe(serverBlob);
      expect(clickedDownload).toBe('server-success.csv');
    });
  });
});
