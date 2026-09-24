import type { Table } from '@tanstack/react-table';

export interface TriggerExportOptions<TData> {
  table: Table<TData>;
  format: 'csv' | 'json';
  filename?: string;
  serverExportUrl?: string;
  selectedOnly?: boolean;
}

/**
 * Escapes a single string field according to RFC 4180 CSV specifications.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Downloads a Blob object as a browser file.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof window === 'undefined') return;
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

/**
 * Direct export helper for an array of arbitrary record objects.
 */
export function exportRawData(
  data: Record<string, unknown>[],
  format: 'csv' | 'json',
  filename?: string
): void {
  const resolvedFilename =
    filename ||
    `erp-preflight-export-${new Date().toISOString().slice(0, 10)}.${format}`;

  let fileContent: string;
  let mimeType: string;

  if (format === 'csv') {
    if (data.length === 0) {
      fileContent = '\uFEFF';
    } else {
      const headers = Object.keys(data[0]);
      const rowsContent = data.map((item) =>
        headers.map((h) => escapeCsvCell(item[h])).join(',')
      );
      fileContent = '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rowsContent].join('\r\n');
    }
    mimeType = 'text/csv;charset=utf-8;';
  } else {
    fileContent = JSON.stringify(data, null, 2);
    mimeType = 'application/json;charset=utf-8;';
  }

  const blob = new Blob([fileContent], { type: mimeType });
  downloadBlob(blob, resolvedFilename);
}

/**
 * Triggers full-dataset export adhering to the Complete Dataset Export Invariant.
 * Never exports merely the visible 20–30 virtualized DOM rows.
 */
export async function triggerExport<TData>({
  table,
  format,
  filename,
  serverExportUrl,
  selectedOnly = false,
}: TriggerExportOptions<TData>): Promise<void> {
  const resolvedFilename =
    filename ||
    `erp-preflight-export-${new Date().toISOString().slice(0, 10)}.${format}`;

  // 1. Path A: Server-Side Streaming Export (Tier 1 Architecture)
  if (serverExportUrl && !selectedOnly) {
    try {
      const params = new URLSearchParams(window.location.search);
      params.set('format', format);

      const response = await fetch(`${serverExportUrl}?${params.toString()}`, {
        method: 'GET',
        headers: {
          Accept: format === 'json' ? 'application/json' : 'text/csv',
        },
      });

      if (!response.ok) {
        console.warn(
          `Server export endpoint ${serverExportUrl} returned HTTP ${response.status}. Falling back to client-side dataset serialization.`
        );
      } else {
        const blob = await response.blob();
        downloadBlob(blob, resolvedFilename);
        return;
      }
    } catch (err) {
      console.warn(
        `Server export request failed (${err instanceof Error ? err.message : String(err)}). Falling back to client-side dataset serialization.`
      );
    }
  }

  // 2. Path B: Full Client-Side Dataset Serialization (Tier 2 Virtualization)
  // Extracts the complete filtered model or selected model, NOT virtualized viewport slices
  const targetRows = selectedOnly
    ? table.getSelectedRowModel().rows
    : table.getFilteredRowModel().rows;

  const visibleColumns = table
    .getVisibleLeafColumns()
    .filter((col) => col.id !== 'select' && col.id !== 'actions');

  let fileContent: string;
  let mimeType: string;

  if (format === 'csv') {
    // Header row
    const headers = visibleColumns.map((col) => {
      const headerDef = col.columnDef.header;
      return typeof headerDef === 'string' ? headerDef : col.id;
    });

    const rowsContent = targetRows.map((row) => {
      return visibleColumns
        .map((col) => {
          const val = row.getValue(col.id);
          return escapeCsvCell(val);
        })
        .join(',');
    });

    // Prepend UTF-8 BOM (\uFEFF) to guarantee Excel character encoding accuracy
    fileContent = '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rowsContent].join('\r\n');
    mimeType = 'text/csv;charset=utf-8;';
  } else {
    // JSON Export
    const jsonData = targetRows.map((row) => row.original);
    fileContent = JSON.stringify(jsonData, null, 2);
    mimeType = 'application/json;charset=utf-8;';
  }

  const blob = new Blob([fileContent], { type: mimeType });
  downloadBlob(blob, resolvedFilename);
}
