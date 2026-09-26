import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '../test/render';
import { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '../components/data-table/data-table';
import { FilterDef } from '../components/data-table/types';

interface TestRecord {
  id: string;
  title: string;
  severity: string;
  category: string;
  score: number;
}

const sampleData: TestRecord[] = [
  { id: 'rec-1', title: 'Direct DB Table Mutation', severity: 'BLOCKER', category: 'Clean Core', score: 95 },
  { id: 'rec-2', title: 'Missing OPD Condition Rule', severity: 'CRITICAL', category: 'Output', score: 85 },
  { id: 'rec-3', title: 'Deprecated BAPI Usage', severity: 'MAJOR', category: 'Integration', score: 70 },
  { id: 'rec-4', title: 'Unreleased CDS View Reference', severity: 'MEDIUM', category: 'Clean Core', score: 60 },
  { id: 'rec-5', title: 'Obsolete Field Symbol Pointer', severity: 'MINOR', category: 'Syntax', score: 40 },
];

const sampleColumns: ColumnDef<TestRecord>[] = [
  {
    id: 'select',
    header: ({ table }) => (
      <input
        type="checkbox"
        aria-label="Select all rows"
        checked={table.getIsAllPageRowsSelected()}
        onChange={(e) => table.toggleAllPageRowsSelected(e.target.checked)}
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        aria-label={`Select row ${row.original.id}`}
        checked={row.getIsSelected()}
        onChange={(e) => row.toggleSelected(e.target.checked)}
      />
    ),
  },
  {
    accessorKey: 'title',
    header: ({ column }) => (
      <button
        type="button"
        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      >
        Title {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : ''}
      </button>
    ),
    cell: (info) => info.getValue(),
  },
  {
    accessorKey: 'severity',
    header: 'Severity',
    cell: (info) => info.getValue(),
    filterFn: (row, id, filterValues: string[]) => {
      if (!filterValues || filterValues.length === 0) return true;
      return filterValues.includes(row.getValue(id));
    },
  },
  {
    accessorKey: 'score',
    header: ({ column }) => (
      <button
        type="button"
        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      >
        Score {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : ''}
      </button>
    ),
    cell: (info) => info.getValue(),
  },
];

const sampleFacetedFilters: FilterDef[] = [
  {
    id: 'severity',
    title: 'Severity',
    options: [
      { label: 'Blocker', value: 'BLOCKER' },
      { label: 'Critical', value: 'CRITICAL' },
      { label: 'Major', value: 'MAJOR' },
      { label: 'Medium', value: 'MEDIUM' },
      { label: 'Minor', value: 'MINOR' },
    ],
  },
];

describe('DataTable Enterprise Component', () => {
  beforeEach(() => {
    // Setup element dimension mocks for JSDOM virtualization calculations
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 620,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      value: 620,
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      value: 500000,
    });
    HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        width: 1200,
        height: 620,
        top: 0,
        left: 0,
        bottom: 620,
        right: 1200,
        x: 0,
        y: 0,
        toJSON: () => {},
      };
    };
  });

  describe('Multi-Column Sorting', () => {
    it('sorts rows in ascending and descending order when column header is clicked', () => {
      render(
        <DataTable
          columns={sampleColumns}
          data={sampleData}
          searchColumnId="title"
        />
      );

      const titleHeaderBtn = screen.getByRole('button', { name: /Title/i });

      // Click 1: Ascending
      fireEvent.click(titleHeaderBtn);
      let cells = screen.getAllByRole('row').slice(1); // skip header row
      expect(cells[0]).toHaveTextContent('Deprecated BAPI Usage');
      expect(cells[cells.length - 1]).toHaveTextContent('Unreleased CDS View Reference');

      // Click 2: Descending
      fireEvent.click(titleHeaderBtn);
      cells = screen.getAllByRole('row').slice(1);
      expect(cells[0]).toHaveTextContent('Unreleased CDS View Reference');
      expect(cells[cells.length - 1]).toHaveTextContent('Deprecated BAPI Usage');
    });

    it('supports multi-column sorting with secondary criteria', () => {
      const tieBreakerData: TestRecord[] = [
        { id: '1', title: 'Same Title', severity: 'BLOCKER', category: 'Clean Core', score: 10 },
        { id: '2', title: 'Same Title', severity: 'CRITICAL', category: 'Clean Core', score: 90 },
        { id: '3', title: 'Alpha', severity: 'MAJOR', category: 'Clean Core', score: 50 },
      ];

      render(
        <DataTable
          columns={sampleColumns}
          data={tieBreakerData}
          sorting={[
            { id: 'title', desc: false },
            { id: 'score', desc: true },
          ]}
        />
      );

      const rows = screen.getAllByRole('row').slice(1);
      // Row 1 is Alpha
      expect(rows[0]).toHaveTextContent('Alpha');
      // For 'Same Title', score 90 should precede score 10
      expect(rows[1]).toHaveTextContent('90');
      expect(rows[2]).toHaveTextContent('10');
    });
  });

  describe('Facet Filter Popovers', () => {
    it('opens facet filter popover and filters table rows upon selection', () => {
      render(
        <DataTable
          columns={sampleColumns}
          data={sampleData}
          facetedFilters={sampleFacetedFilters}
          searchColumnId="title"
        />
      );

      // Verify all 5 rows initially rendered
      expect(screen.getAllByRole('row').slice(1)).toHaveLength(5);

      // Click Severity filter trigger button
      const filterBtn = screen.getByRole('button', { name: /Filter by Severity/i });
      fireEvent.click(filterBtn);

      // Popover should be open
      const popover = screen.getByRole('dialog', { name: /Severity filter/i });
      expect(popover).toBeInTheDocument();

      // Select 'Critical' checkbox
      const criticalOption = within(popover).getByRole('checkbox', { name: /Critical/i });
      fireEvent.click(criticalOption);

      // Table should now be filtered to 1 row
      const remainingRows = screen.getAllByRole('row').slice(1);
      expect(remainingRows).toHaveLength(1);
      expect(remainingRows[0]).toHaveTextContent('Missing OPD Condition Rule');

      // Click "Clear filters" in popover
      const clearBtn = within(popover).getByRole('button', { name: /Clear filters/i });
      fireEvent.click(clearBtn);

      // All 5 rows should be restored
      expect(screen.getAllByRole('row').slice(1)).toHaveLength(5);
    });
  });

  describe('Row Selection & Bulk Actions', () => {
    it('selects individual rows and triggers bulk action bar display', () => {
      render(
        <DataTable
          columns={sampleColumns}
          data={sampleData}
          getRowId={(row) => row.id}
        />
      );

      // Initially no bulk actions bar
      expect(screen.queryByText('selected')).not.toBeInTheDocument();

      // Check first row's checkbox
      const firstRowCheckbox = screen.getByRole('checkbox', { name: /Select row rec-1/i });
      fireEvent.click(firstRowCheckbox);

      expect(firstRowCheckbox).toBeChecked();

      // Row should have aria-selected="true"
      const selectedRow = screen.getByRole('row', { selected: true });
      expect(selectedRow).toHaveTextContent('Direct DB Table Mutation');

      // Floating bulk actions bar should now appear with count 1
      expect(screen.getByText('selected')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Export CSV/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Clear selection/i })).toBeInTheDocument();
    });

    it('selects all page rows via header checkbox', () => {
      render(
        <DataTable
          columns={sampleColumns}
          data={sampleData}
          getRowId={(row) => row.id}
        />
      );

      const selectAllCheckbox = screen.getByRole('checkbox', { name: /Select all rows/i });
      fireEvent.click(selectAllCheckbox);

      const allRows = screen.getAllByRole('row').slice(1);
      for (const row of allRows) {
        expect(row).toHaveAttribute('aria-selected', 'true');
      }

      expect(screen.getByText('selected')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });

  describe('Search Input Sync (`searchColumnId` bridge to `globalFilter`)', () => {
    it('filters rows matching query and bridges searchColumnId to table filter state', () => {
      render(
        <DataTable
          columns={sampleColumns}
          data={sampleData}
          searchColumnId="title"
          searchPlaceholder="Search preflight findings..."
        />
      );

      const searchInput = screen.getByPlaceholderText('Search preflight findings...');

      // Type "BAPI"
      fireEvent.change(searchInput, { target: { value: 'BAPI' } });

      const filteredRows = screen.getAllByRole('row').slice(1);
      expect(filteredRows).toHaveLength(1);
      expect(filteredRows[0]).toHaveTextContent('Deprecated BAPI Usage');

      // Clear search via clear button
      const clearSearchBtn = screen.getByRole('button', { name: /Clear search/i });
      fireEvent.click(clearSearchBtn);

      expect(screen.getAllByRole('row').slice(1)).toHaveLength(5);
    });

    it('renders no results view when search matches zero items and allows resetting', () => {
      render(
        <DataTable
          columns={sampleColumns}
          data={sampleData}
          searchColumnId="title"
        />
      );

      const searchInput = screen.getByLabelText('Filter records');
      fireEvent.change(searchInput, { target: { value: 'NonexistentFindingQuery999' } });

      expect(screen.getByText(/No matching records/i)).toBeInTheDocument();

      // Reset filters button
      const resetBtn = screen.getByRole('button', { name: /Reset all filters/i });
      fireEvent.click(resetBtn);

      expect(screen.getAllByRole('row').slice(1)).toHaveLength(5);
    });
  });

  describe('Compound Row Virtualization (High-Volume Datasets)', () => {
    it('mounts virtualized rows and maintains a constant bounded DOM footprint across 10,000 items', () => {
      // Generate 10,000 realistic SAP findings
      const highVolumeData: TestRecord[] = Array.from({ length: 10000 }, (_, i) => ({
        id: `finding-${i}`,
        title: `SAP Clean Core Finding #${i} - Direct Access Violation`,
        severity: i % 5 === 0 ? 'BLOCKER' : i % 3 === 0 ? 'CRITICAL' : 'MEDIUM',
        category: 'Clean Core',
        score: (i % 100) + 1,
      }));

      const { container } = render(
        <DataTable
          columns={sampleColumns}
          data={highVolumeData}
          enableVirtualization={true}
          virtualHeight="620px"
          estimateRowHeight={() => 52}
          overscan={10}
          getRowId={(row) => row.id}
        />
      );

      // Verify table region exists and indicates 10,000 rows in accessibility aria-rowcount
      const tableElement = screen.getByRole('grid');
      expect(tableElement).toHaveAttribute('aria-rowcount', '10000');

      // In compound virtualization, each virtual row renders inside its own <tbody> with data-index
      const virtualTbodyElements = container.querySelectorAll('tbody[data-index]');

      // CRITICAL ASSERTION: The DOM footprint must be constant and bounded (~30 rows),
      // NEVER creating 10,000 DOM elements.
      expect(virtualTbodyElements.length).toBeGreaterThan(0);
      expect(virtualTbodyElements.length).toBeLessThan(60);

      // Verify that virtual items mount the expected initial indices (starting at 0)
      const firstTbody = virtualTbodyElements[0];
      expect(firstTbody).toHaveAttribute('data-index', '0');
      expect(firstTbody).toHaveTextContent('Finding #0');
    });
  });

  describe('Loading and Error States', () => {
    it('renders skeleton rows when isLoading is true', () => {
      const { container } = render(
        <DataTable
          columns={sampleColumns}
          data={[]}
          isLoading={true}
        />
      );

      const skeletonRows = container.querySelectorAll('tr.animate-pulse');
      expect(skeletonRows.length).toBe(8);
    });

    it('renders accessible error state and invokes onRetry callback', () => {
      const onRetryMock = vi.fn();

      render(
        <DataTable
          columns={sampleColumns}
          data={[]}
          isError={true}
          error={new Error('Failed to load analysis findings from Redis/Postgres')}
          onRetry={onRetryMock}
        />
      );

      expect(screen.getByText(/Could not load the table/i)).toBeInTheDocument();
      expect(screen.getByText(/Failed to load analysis findings/i)).toBeInTheDocument();

      const retryBtn = screen.getByRole('button', { name: /Try again/i });
      fireEvent.click(retryBtn);

      expect(onRetryMock).toHaveBeenCalledTimes(1);
    });
  });
});
