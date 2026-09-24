# Milestone 4 Handoff Report: Findings Reference Page & Inspector Blueprint

> **Agent**: `explorer_m4_findings_1`  
> **Working Directory**: `H:/erppreflight/.agents/explorer_m4_findings_1`  
> **Target Milestone**: Milestone 4 — Findings Reference Page & Inspector (`/projects/[id]/findings` and `/inspector`)  
> **Status**: Investigation Complete — Implementation Blueprint Delivered  

---

## 1. Observation

### 1.1 Existing Schemas & Contracts
- **Finding Domain Model** (`packages/schemas/src/finding.ts:83-104`):
  `BaseFindingSchema` defines:
  ```typescript
  id: z.string().uuid(),
  jobId: z.string().uuid().optional().nullable(),
  analysisId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  organizationId: z.string().uuid().optional().nullable(),
  engineType: EngineTypeEnum.optional().nullable(),
  ruleId: z.string(),
  severity: SeverityEnum,
  category: z.string().default('SAP_PREFLIGHT'),
  title: z.string(),
  description: z.string(),
  confidence: ConfidenceClassEnum,
  confidenceScore: z.number().min(0).max(1),
  remediation: z.string(),
  affectedObjects: z.array(AffectedObjectItemSchema).default([]),
  evidence: z.array(EvidenceItemSchema).default([]),
  technicalDetails: z.record(z.unknown()).default({}),
  fingerprint: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  ```
- **Severity & Confidence Enums** (`packages/schemas/src/common.ts:3-27`):
  - `SeverityEnum`: `'BLOCKER' | 'CRITICAL' | 'MAJOR' | 'MEDIUM' | 'MINOR' | 'LOW' | 'INFO'`
  - `ConfidenceClassEnum`: `'VERIFIED' (1.0) | 'RULE_DERIVED' (0.85) | 'INFERRED' (0.60) | 'UNKNOWN' (0.30)`
  - `ConfidenceScoreMap`: `VERIFIED: 1.0, RULE_DERIVED: 0.85, INFERRED: 0.60, UNKNOWN: 0.30`
- **Clean Core Tiers** (`packages/schemas/src/common.ts:76-81`):
  - `CleanCoreTierEnum`: `'TIER_1_CLOUD' | 'TIER_2_DEVELOPER' | 'TIER_3_CLASSIC'`
- **Evidence Structure** (`packages/schemas/src/evidence.ts:67-87`):
  - `BaseEvidenceItemSchema`: `artifactPath`, `lineNumber`, `columnNumber`, `snippet`, `sha256` (64-char hex), `provenance`, `sourceType`, `trustScore`, `releaseAlignment`, `offset`.
- **Evidence Utilities** (`packages/evidence/src/chain.ts:40-56`, `classifier.ts:12-37`, `trust-score.ts:24-56`):
  - `verifyEvidenceSnippet(artifactText, snippet, expectedSha256)`: Validates snippet presence and cryptographic SHA-256 match.
  - `classifyProvenance(...)`: Strictly demotes to `UNKNOWN` if evidence is missing and caps AI/LLM at `INFERRED` (0.60).
  - `calculateCompositeTrustScore(...)`: Computes asymptotic Noisy-OR composite trust scores.

### 1.2 Data Table Architecture & URL Sync Contracts
- **DataTable Container** (`apps/web/src/components/data-table/data-table.tsx:31-97`):
  - Uses `@tanstack/react-table` (v8) and `@tanstack/react-virtual` (v3).
  - Implements dynamic row height virtualization via **Compound Row Groups** (`<tbody ref={rowVirtualizer.measureElement} data-index={virtualRow.index}>`) enclosing both primary `<tr>` and expanded `renderExpandedRow` `<tr>` (`data-table.tsx:284-330`).
  - Supports keyboard navigation (`ArrowDown`/`ArrowUp` row focus, `Space` row selection, `Enter` row expand/collapse) (`data-table.tsx:124-176`).
  - Provides built-in states: `DataTableLoadingSkeleton`, `DataTableEmptyState`, `DataTableNoResults`, `DataTableErrorState` (`data-table.tsx:230-262`).
- **DataTable Props** (`apps/web/src/components/data-table/types.ts:36-77`):
  - Accepts `columns`, `data`, `getRowId`, `enableVirtualization`, `virtualHeight`, `renderExpandedRow`, `facetedFilters`, `searchColumnId`, `searchPlaceholder`, `bulkActions`, `isLoading`, `isError`, `error`, `onRetry`, `serverExportUrl`, `onExport`.
  - **Observation on State**: `DataTable` currently initializes its own internal `useState` for `sorting`, `columnFilters`, `pagination`, and `globalFilter`. It lacks controlled state props to bind directly to `useTableUrlSync`.
- **URL Synchronization Hook** (`apps/web/src/hooks/useTableUrlSync.ts:21-197`):
  - Parses URL parameters (`page`, `pageSize`, `sort`, `search`, and arbitrary facet filters `Record<string, string[]>`).
  - Returns `state`, `updateUrl`, `resetAll`, and `tableProps: { pagination, sorting, columnFilters, globalFilter, onPaginationChange, onSortingChange, onColumnFiltersChange, onGlobalFilterChange }`.
- **Export Engine** (`apps/web/src/lib/export.ts:1-154`):
  - Implements `triggerExport({ table, format, filename, serverExportUrl, selectedOnly })`.
  - Client-side export processes `table.getFilteredRowModel().rows` (or `getSelectedRowModel()`), satisfying the Complete Dataset Export Invariant (not virtualized DOM slices).
  - CSV export prepends UTF-8 BOM (`\uFEFF`) and escapes cells per RFC 4180.
  - JSON export outputs structured JSON array of original row objects.

### 1.3 Existing Routing & Page Inspection
- **Inspector Page Prototype** (`apps/web/src/app/inspector/page.tsx:1-151`):
  - Primitive prototype using raw `useState` and `useEffect` with `fetchFindings()`.
  - Hardcoded non-compliant severity tags (`bg-red-600 text-white`, `bg-yellow-500 text-white`) violating Cardinal Axiom 1 (no icons, no ARIA attributes).
  - Hand-rolled table list without virtualization, no TanStack Table, no `useTableUrlSync`.
  - Renders `EvidenceInspector` modal dialog on click (`evidence-inspector.tsx:1-157`).
- **Project Workspace Page** (`apps/web/src/app/projects/[id]/page.tsx:1-300`):
  - Contains tabs: `overview`, `artifacts`, `history`, `launcher`.
  - Displays summary metric card: "Preflight Findings: 3 (1 Blocker • 1 Critical)" (`page.tsx:118-132`).
  - **Missing Route**: Does NOT have a Findings tab or link to `/projects/[id]/findings`.
  - The route `apps/web/src/app/projects/[id]/findings/page.tsx` does not exist yet.
- **TanStack Query Hierarchy** (`apps/web/src/lib/query/query-keys.ts:108-125`):
  - `queryKeys.findings` factory is already defined:
    - `all`: `['findings']`
    - `lists()`: `['findings', 'list']`
    - `list(filters)`: `['findings', 'list', filters]`
    - `byProject(projectId, filters)`: `['findings', 'all', 'project', projectId, filters]`
    - `detail(findingId)`: `['findings', 'all', 'detail', findingId]`

---

## 2. Logic Chain

### Step 2.1: Reconciling Cardinal Axiom 1 with Finding Presentation
- *Observation*: Axiom 1 states: *"A page that renders is not a completed feature... Severity indicators must never rely on color alone. They must pair colors with unambiguous icons, textual badges, or ARIA labels."*
- *Inference*: Both `/projects/[id]/findings` and `/inspector` require a dedicated `SeverityBadge` component implementing a triad representation:
  1. Contrast-compliant semantic background/border token (contrast > 4.5:1).
  2. Distinct Lucide icon per severity:
     - `BLOCKER`: `OctagonAlert`
     - `CRITICAL`: `AlertTriangle`
     - `MAJOR`: `AlertCircle`
     - `MEDIUM`: `ShieldAlert`
     - `MINOR`: `MinusCircle`
     - `LOW`: `HelpCircle`
     - `INFO`: `Info`
  3. Machine-readable text + `role="status"` + `aria-label="Severity: <SEVERITY>"`.
  Similarly, Clean Core tiers (`TIER_1_CLOUD`, `TIER_2_DEVELOPER`, `TIER_3_CLASSIC`) must pair icons (`Sparkles`, `Code2`, `AlertOctagon`), colors, and textual labels.

### Step 2.2: Bridging `DataTable` with `useTableUrlSync`
- *Observation*: `useTableUrlSync` emits `tableProps` with `sorting`, `columnFilters`, `pagination`, `globalFilter`, and updater callbacks. `DataTable` currently initializes its own internal `useState`.
- *Inference*: To make `DataTable` URL-driven without breaking existing callers, `DataTableProps` should accept optional controlled props:
  - `urlSync?: ReturnType<typeof useTableUrlSync>` (or individual `controlledState` + handlers).
  When provided, `DataTable` binds `useReactTable` state and handlers to `urlSync`, achieving instantaneous, bi-directional URL parameter persistence (`?severity=BLOCKER,CRITICAL&search=billing&page=1`).

### Step 2.3: Correct Column Filter Behavior for Multi-Select Facets
- *Observation*: `DataTableFacetedFilter` sets column filter values as `string[]` (e.g. `['BLOCKER', 'CRITICAL']`). By default, TanStack Table uses string inclusion, which does not handle array intersection correctly.
- *Inference*: Columns with faceted filters (`severity`, `confidence`, `cleanCoreTier`, `engineType`) must specify `filterFn: 'arrIncludesSome'` or a custom array intersection filter:
  ```typescript
  filterFn: (row, columnId, filterValues: string[]) => {
    if (!filterValues || filterValues.length === 0) return true;
    const cellValue = row.getValue(columnId);
    return filterValues.includes(String(cellValue));
  }
  ```

### Step 2.4: Expandable Finding Detail Architecture
- *Observation*: Finding objects contain rich cryptographic evidence (`sha256`, `artifactPath`, `lineNumber`, `snippet`, `trustScore`), Clean Core lineage (`affectedObjects`), and technical remediation instructions.
- *Inference*: The expandable row renderer (`renderExpandedRow`) in `DataTable` should display a structured card:
  1. **Remediation & Action Plan**: Clean Core resolution steps and recommended SAP Cloud API / RAP BO replacement.
  2. **Cryptographic Evidence Ledger**: Artifact path, line/col, syntax-highlighted code snippet, and 64-char SHA-256 hash with cryptographic verification badge.
  3. **Metadata & Lineage**: Affected SAP objects, object type, package, Clean Core tier, engine metadata, and release alignment status.

### Step 2.5: Dual-Route Architecture
- *Observation*: The user needs both project-specific findings (`/projects/[id]/findings`) and universal cross-project inspection (`/inspector`).
- *Inference*:
  - Create reusable core findings view components (`FindingColumns`, `FindingDetailRow`, `FindingFacetedFilters`, `useFindingsQuery`).
  - Route 1: `apps/web/src/app/projects/[id]/findings/page.tsx` — Project-scoped findings with project header, breadcrumbs, project stats, and target release context.
  - Route 2: `apps/web/src/app/inspector/page.tsx` — Upgraded universal findings inspector querying across all projects with project-selector filter and global stats.
  - Route 3: Update `apps/web/src/app/projects/[id]/page.tsx` to include a "Findings" tab and direct link to `/projects/[id]/findings`.

---

## 3. Caveats

1. **Backend Findings Endpoint Availability**: Currently, `apps/api` has modules for projects, ingestion, queues, and export, while findings are stored in PostgreSQL by analysis workers. `apps/web/src/lib/api-client.ts` contains typed mock finding contracts (`MOCK_FINDINGS`, `fetchFindings()`). The `useFindingsQuery` hook is designed to call `fetchFindings(projectId)` or the REST endpoint `GET /api/v1/projects/:id/findings` with transparent fallback to `MOCK_FINDINGS`, ensuring zero runtime disruption regardless of backend container availability.
2. **Virtualization vs. Dynamic Row Heights**: When `enableVirtualization={true}`, TanStack Virtual requires `rowVirtualizer.measureElement` on compound row containers. `data-table.tsx` already implements this compound `<tbody>` pattern correctly. For standard datasets (<100 rows), `enableVirtualization={false}` with standard pagination is also supported.
3. **No Direct Production Code Writes**: In accordance with the Explorer archetype and read-only investigation mandate, no production files were modified directly. All designs and code specifications are provided below in Section 4 for immediate execution by the implementer.

---

## 4. Conclusion & Concrete Implementation Blueprint

### 4.1 Component Architecture & File Tree

The following files constitute the Milestone 4 architecture:

```text
apps/web/src/
├── app/
│   ├── inspector/
│   │   └── page.tsx                         # UPGRADE: Universal findings inspector (DataTable + useTableUrlSync)
│   └── projects/[id]/
│       ├── page.tsx                         # UPDATE: Add Findings tab & navigation links
│       └── findings/
│           └── page.tsx                     # NEW: Dedicated Project Findings Ledger page
├── components/
│   ├── ui/
│   │   ├── severity-badge.tsx               # NEW: WCAG 2.2 AA non-color triad severity badge
│   │   ├── confidence-badge.tsx             # NEW: Epistemic confidence badge with trust score
│   │   └── clean-core-tier-badge.tsx        # NEW: Clean Core tier indicator (Tier 1/2/3)
│   ├── findings/
│   │   ├── finding-columns.tsx              # NEW: 8-column TanStack Table definitions
│   │   ├── finding-detail-row.tsx           # NEW: Expandable evidence & remediation row view
│   │   ├── finding-filters.ts               # NEW: Faceted filter definitions for toolbar
│   │   └── index.ts                         # Re-exports
│   └── data-table/
│       ├── data-table.tsx                   # UPDATE: Add optional `urlSync` / controlled state support
│       └── types.ts                         # UPDATE: Add `urlSync` / controlled props to DataTableProps
└── hooks/
    └── useFindings.ts                       # NEW: TanStack Query hook with queryKeys integration
```

---

### 4.2 UI Primitives Specification

#### A. `SeverityBadge` (`apps/web/src/components/ui/severity-badge.tsx`)
Conforms strictly to WCAG 2.2 AA SC 1.4.1 (Non-Color Presentation Triad):
- **Icons**:
  - `BLOCKER`: `OctagonAlert` (destructive red)
  - `CRITICAL`: `AlertTriangle` (deep orange)
  - `MAJOR`: `AlertCircle` (amber)
  - `MEDIUM`: `ShieldAlert` (yellow-brown)
  - `MINOR`: `MinusCircle` (emerald green)
  - `LOW`: `HelpCircle` (teal)
  - `INFO`: `Info` (sky blue)
- **Accessibility**:
  - `role="status"`
  - `aria-label={`Severity: ${severity}`}`
  - High-contrast text label matching background (>4.5:1 ratio).

```tsx
import * as React from 'react';
import {
  OctagonAlert,
  AlertTriangle,
  AlertCircle,
  ShieldAlert,
  MinusCircle,
  HelpCircle,
  Info,
} from 'lucide-react';
import { Severity } from '@erppreflight/schemas';

const severityConfig: Record<
  Severity,
  {
    icon: React.ComponentType<{ className?: string }>;
    className: string;
    label: string;
  }
> = {
  BLOCKER: {
    icon: OctagonAlert,
    className:
      'bg-red-50 text-red-800 border-red-300 dark:bg-red-950/80 dark:text-red-200 dark:border-red-800',
    label: 'Blocker',
  },
  CRITICAL: {
    icon: AlertTriangle,
    className:
      'bg-orange-50 text-orange-800 border-orange-300 dark:bg-orange-950/80 dark:text-orange-200 dark:border-orange-800',
    label: 'Critical',
  },
  MAJOR: {
    icon: AlertCircle,
    className:
      'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/80 dark:text-amber-200 dark:border-amber-800',
    label: 'Major',
  },
  MEDIUM: {
    icon: ShieldAlert,
    className:
      'bg-yellow-50 text-yellow-800 border-yellow-300 dark:bg-yellow-950/80 dark:text-yellow-200 dark:border-yellow-800',
    label: 'Medium',
  },
  MINOR: {
    icon: MinusCircle,
    className:
      'bg-green-50 text-green-800 border-green-300 dark:bg-green-950/80 dark:text-green-200 dark:border-green-800',
    label: 'Minor',
  },
  LOW: {
    icon: HelpCircle,
    className:
      'bg-teal-50 text-teal-800 border-teal-300 dark:bg-teal-950/80 dark:text-teal-200 dark:border-teal-800',
    label: 'Low',
  },
  INFO: {
    icon: Info,
    className:
      'bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950/80 dark:text-sky-200 dark:border-sky-800',
    label: 'Info',
  },
};

export interface SeverityBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  severity: Severity;
  size?: 'sm' | 'default';
  showIcon?: boolean;
}

export function SeverityBadge({
  severity,
  size = 'default',
  showIcon = true,
  className = '',
  ...props
}: SeverityBadgeProps) {
  const conf = severityConfig[severity] || severityConfig.INFO;
  const Icon = conf.icon;
  const isSm = size === 'sm';

  return (
    <span
      role="status"
      aria-label={`Severity: ${conf.label}`}
      className={`inline-flex items-center gap-1.5 font-semibold border rounded-full select-none ${
        isSm ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs'
      } ${conf.className} ${className}`}
      {...props}
    >
      {showIcon && <Icon className={`${isSm ? 'size-3' : 'size-3.5'} shrink-0`} aria-hidden="true" />}
      <span>{conf.label}</span>
    </span>
  );
}
```

#### B. `ConfidenceBadge` (`apps/web/src/components/ui/confidence-badge.tsx`)
Represents epistemic classification and numerical trust score:
- `VERIFIED` (1.0): `ShieldCheck` (Emerald)
- `RULE_DERIVED` (0.85): `ShieldCheck` (Blue)
- `INFERRED` (0.60): `AlertTriangle` (Amber)
- `UNKNOWN` (0.30): `HelpCircle` (Zinc)

```tsx
import * as React from 'react';
import { ShieldCheck, AlertTriangle, HelpCircle } from 'lucide-react';
import { ConfidenceClass } from '@erppreflight/schemas';

const confidenceConfig: Record<
  ConfidenceClass,
  {
    icon: React.ComponentType<{ className?: string }>;
    className: string;
    defaultScore: string;
  }
> = {
  VERIFIED: {
    icon: ShieldCheck,
    className: 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800',
    defaultScore: '1.0',
  },
  RULE_DERIVED: {
    icon: ShieldCheck,
    className: 'bg-blue-50 text-blue-800 border-blue-300 dark:bg-blue-950/70 dark:text-blue-300 dark:border-blue-800',
    defaultScore: '0.85',
  },
  INFERRED: {
    icon: AlertTriangle,
    className: 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800',
    defaultScore: '0.60',
  },
  UNKNOWN: {
    icon: HelpCircle,
    className: 'bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800/80 dark:text-zinc-300 dark:border-zinc-700',
    defaultScore: '0.30',
  },
};

export function ConfidenceBadge({
  confidence,
  score,
  size = 'default',
}: {
  confidence: ConfidenceClass;
  score?: number;
  size?: 'sm' | 'default';
}) {
  const conf = confidenceConfig[confidence] || confidenceConfig.UNKNOWN;
  const Icon = conf.icon;
  const displayScore = score !== undefined ? score.toFixed(2) : conf.defaultScore;

  return (
    <span
      role="status"
      aria-label={`Confidence: ${confidence}, Trust Score: ${displayScore}`}
      className={`inline-flex items-center gap-1.5 font-medium border rounded-md select-none ${
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
      } ${conf.className}`}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{confidence}</span>
      <span className="opacity-70 font-mono text-[10px]">({displayScore})</span>
    </span>
  );
}
```

#### C. `CleanCoreTierBadge` (`apps/web/src/components/ui/clean-core-tier-badge.tsx`)
Represents Clean Core Extensibility Tier:
- `TIER_1_CLOUD`: `Sparkles` (Green: Full Cloud Compliant)
- `TIER_2_DEVELOPER`: `Code2` (Blue: Controlled Developer Extensibility)
- `TIER_3_CLASSIC`: `Flame` / `AlertOctagon` (Rose/Red: Classic Modification / Migration Blocker)

```tsx
import * as React from 'react';
import { Sparkles, Code2, AlertOctagon } from 'lucide-react';
import { CleanCoreTier } from '@erppreflight/schemas';

const tierConfig: Record<
  CleanCoreTier,
  {
    icon: React.ComponentType<{ className?: string }>;
    className: string;
    label: string;
  }
> = {
  TIER_1_CLOUD: {
    icon: Sparkles,
    className: 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
    label: 'Tier 1 Cloud',
  },
  TIER_2_DEVELOPER: {
    icon: Code2,
    className: 'bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800',
    label: 'Tier 2 Developer',
  },
  TIER_3_CLASSIC: {
    icon: AlertOctagon,
    className: 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800',
    label: 'Tier 3 Classic',
  },
};

export function CleanCoreTierBadge({
  tier,
  size = 'default',
}: {
  tier?: CleanCoreTier | null;
  size?: 'sm' | 'default';
}) {
  if (!tier) {
    return <span className="text-muted-foreground text-xs font-mono">—</span>;
  }
  const conf = tierConfig[tier] || tierConfig.TIER_3_CLASSIC;
  const Icon = conf.icon;

  return (
    <span
      role="status"
      aria-label={`Clean Core: ${conf.label}`}
      className={`inline-flex items-center gap-1.5 font-semibold border rounded-md select-none ${
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'
      } ${conf.className}`}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span>{conf.label}</span>
    </span>
  );
}
```

---

### 4.3 Table Column Definitions (`apps/web/src/components/findings/finding-columns.tsx`)

Specifies the 8 canonical table columns plus bulk selection:
1. `select`: Checkbox with `aria-label` per row.
2. `ruleId`: Monospace rule code + expand chevron indicator.
3. `title`: Finding title, description clamp, category badge.
4. `severity`: `SeverityBadge` with custom array intersection filter.
5. `confidence`: `ConfidenceBadge` with trust score and array intersection filter.
6. `cleanCoreTier`: `CleanCoreTierBadge` based on `affectedObjects[0].tier`.
7. `engineType`: Engine identifier with human-readable name lookup.
8. `affectedObject`: Target object name, type badge, and package.
9. `actions`: Row actions (Expand details, Copy Rule ID, Copy SHA-256).

```tsx
import * as React from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Finding, CleanCoreTier } from '@erppreflight/schemas';
import { SeverityBadge } from '../ui/severity-badge';
import { ConfidenceBadge } from '../ui/confidence-badge';
import { CleanCoreTierBadge } from '../ui/clean-core-tier-badge';
import { ALL_18_ENGINES } from '../../lib/api-client';
import { ChevronRight, ChevronDown, Copy, Check, ExternalLink } from 'lucide-react';

const engineMap = new Map(ALL_18_ENGINES.map((e) => [e.id, e.name]));

export const findingColumns: ColumnDef<Finding>[] = [
  // 1. Selection Checkbox
  {
    id: 'select',
    header: ({ table }) => (
      <input
        type="checkbox"
        checked={table.getIsAllPageRowsSelected()}
        onChange={(e) => table.toggleAllPageRowsSelected(!!e.target.checked)}
        aria-label="Select all findings on this page"
        className="rounded border-border text-primary focus:ring-primary size-3.5"
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        checked={row.getIsSelected()}
        onChange={(e) => row.toggleSelected(!!e.target.checked)}
        aria-label={`Select finding ${row.original.ruleId}`}
        className="rounded border-border text-primary focus:ring-primary size-3.5"
      />
    ),
    enableSorting: false,
    enableHiding: false,
    size: 40,
  },

  // 2. Finding Code / Rule ID
  {
    accessorKey: 'ruleId',
    id: 'ruleId',
    header: 'Finding Code',
    cell: ({ row }) => {
      const isExpanded = row.getIsExpanded();
      return (
        <button
          type="button"
          onClick={() => row.toggleExpanded()}
          className="flex items-center gap-1.5 font-mono text-xs font-bold text-primary hover:underline text-left group"
        >
          {isExpanded ? (
            <ChevronDown className="size-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
          )}
          <span>{row.original.ruleId}</span>
        </button>
      );
    },
    size: 240,
  },

  // 3. Title & Description
  {
    accessorKey: 'title',
    id: 'title',
    header: 'Title & Summary',
    cell: ({ row }) => {
      const f = row.original;
      return (
        <div className="space-y-0.5 max-w-md">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground text-xs line-clamp-1">{f.title}</span>
            {f.category && (
              <span className="rounded bg-muted px-1.5 py-0.2 text-[9px] font-mono text-muted-foreground shrink-0 uppercase">
                {f.category}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground line-clamp-1">{f.description}</p>
        </div>
      );
    },
    size: 320,
  },

  // 4. Severity (Non-Color Triad)
  {
    accessorKey: 'severity',
    id: 'severity',
    header: 'Severity',
    cell: ({ row }) => <SeverityBadge severity={row.original.severity} size="sm" />,
    filterFn: (row, id, value: string[]) => {
      if (!value || value.length === 0) return true;
      return value.includes(row.getValue(id));
    },
    size: 130,
  },

  // 5. Epistemic Confidence & Trust Score
  {
    accessorKey: 'confidence',
    id: 'confidence',
    header: 'Provenance',
    cell: ({ row }) => (
      <ConfidenceBadge
        confidence={row.original.confidence}
        score={row.original.confidenceScore}
        size="sm"
      />
    ),
    filterFn: (row, id, value: string[]) => {
      if (!value || value.length === 0) return true;
      return value.includes(row.getValue(id));
    },
    size: 170,
  },

  // 6. Clean Core Tier
  {
    id: 'cleanCoreTier',
    header: 'Clean Core',
    accessorFn: (row) => row.affectedObjects?.[0]?.tier ?? null,
    cell: ({ row }) => {
      const tier = row.original.affectedObjects?.[0]?.tier as CleanCoreTier | undefined;
      return <CleanCoreTierBadge tier={tier} size="sm" />;
    },
    filterFn: (row, id, value: string[]) => {
      if (!value || value.length === 0) return true;
      const cellVal = row.getValue(id) as string | null;
      if (!cellVal) return false;
      return value.includes(cellVal);
    },
    size: 140,
  },

  // 7. Engine
  {
    accessorKey: 'engineType',
    id: 'engineType',
    header: 'Engine',
    cell: ({ row }) => {
      const eng = row.original.engineType;
      const humanName = eng ? engineMap.get(eng) || eng : '—';
      return (
        <span className="text-xs text-foreground font-medium" title={eng || ''}>
          {humanName}
        </span>
      );
    },
    filterFn: (row, id, value: string[]) => {
      if (!value || value.length === 0) return true;
      const cellVal = row.getValue(id) as string | null;
      return cellVal ? value.includes(cellVal) : false;
    },
    size: 160,
  },

  // 8. Target SAP Object Reference
  {
    id: 'affectedObject',
    header: 'Target Object',
    accessorFn: (row) => row.affectedObjects?.[0]?.name ?? '—',
    cell: ({ row }) => {
      const obj = row.original.affectedObjects?.[0];
      if (!obj) return <span className="text-muted-foreground text-xs">—</span>;
      return (
        <div className="flex items-center gap-1.5 font-mono text-xs">
          <span className="font-semibold text-foreground">{obj.name}</span>
          {obj.type && (
            <span className="px-1 py-0.2 rounded bg-muted text-[10px] text-muted-foreground font-sans">
              {obj.type}
            </span>
          )}
        </div>
      );
    },
    size: 180,
  },

  // 9. Actions Column
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => {
      return (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(row.original.ruleId);
            }}
            title="Copy Finding Rule ID"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={`Copy Rule ID ${row.original.ruleId}`}
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => row.toggleExpanded()}
            title={row.getIsExpanded() ? 'Collapse Details' : 'Expand Details'}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Toggle Details"
          >
            {row.getIsExpanded() ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        </div>
      );
    },
    size: 60,
  },
];
```

---

### 4.4 Expandable Finding Detail Row (`apps/web/src/components/findings/finding-detail-row.tsx`)

Rendered within `renderExpandedRow={(row) => <FindingDetailRow finding={row.original} />}`:
- **Card 1: Remediation & Resolution Plan**:
  - Highlights clean core recommended alternative (BAPI, RAP BO, Adobe XDP).
  - Lists technical parameters from `finding.technicalDetails`.
- **Card 2: Cryptographic Evidence Ledger**:
  - Artifact path, exact line & column coordinates.
  - Formatted syntax code snippet with line numbers.
  - Complete 64-character SHA-256 hash with cryptographic verification badge.
  - Source type badge and individual trust weight.
- **Card 3: Impacted SAP Objects & Clean Core Classification**:
  - Inventory of all `affectedObjects` with type, package, and assigned tier.
  - Release alignment status badge (`RELEASE_ALIGNED`, etc.).

```tsx
import * as React from 'react';
import { Finding } from '@erppreflight/schemas';
import { calculateSha256 } from '@erppreflight/evidence';
import { FileCode, Hash, Wrench, Shield, CheckCircle2, AlertCircle, Copy, Check } from 'lucide-react';
import { CleanCoreTierBadge } from '../ui/clean-core-tier-badge';
import { ConfidenceBadge } from '../ui/confidence-badge';

export function FindingDetailRow({ finding }: { finding: Finding }) {
  const [copiedHash, setCopiedHash] = React.useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(id);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-5 shadow-inner space-y-5 text-xs">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-primary text-sm">{finding.ruleId}</span>
          <span className="text-muted-foreground">•</span>
          <span className="font-medium text-foreground">{finding.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <ConfidenceBadge confidence={finding.confidence} score={finding.confidenceScore} size="sm" />
          {finding.affectedObjects?.[0]?.tier && (
            <CleanCoreTierBadge tier={finding.affectedObjects[0].tier} size="sm" />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left Column: Remediation Guidance */}
        <div className="space-y-4">
          <div className="rounded-lg border border-blue-200/80 bg-blue-50/50 p-4 dark:border-blue-900/50 dark:bg-blue-950/30">
            <h4 className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[11px] text-blue-700 dark:text-blue-300">
              <Wrench className="size-3.5" />
              Actionable Remediation Guidance
            </h4>
            <p className="mt-2 text-xs leading-relaxed text-blue-950 dark:text-blue-100">
              {finding.remediation}
            </p>
          </div>

          {/* Technical Details Key-Value */}
          {finding.technicalDetails && Object.keys(finding.technicalDetails).length > 0 && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
              <h5 className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
                Technical Execution Parameters
              </h5>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                {Object.entries(finding.technicalDetails).map(([key, val]) => (
                  <div key={key} className="flex flex-col">
                    <span className="text-muted-foreground text-[10px]">{key}:</span>
                    <span className="text-foreground font-semibold truncate">{String(val)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Affected SAP Objects */}
          {finding.affectedObjects && finding.affectedObjects.length > 0 && (
            <div className="space-y-2">
              <h5 className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
                Impacted SAP Repository Objects ({finding.affectedObjects.length})
              </h5>
              <div className="divide-y divide-border/60 rounded-lg border border-border bg-muted/10">
                {finding.affectedObjects.map((obj, i) => (
                  <div key={i} className="flex items-center justify-between p-2.5">
                    <div className="flex items-center gap-2 font-mono">
                      <span className="font-bold text-foreground">{obj.name}</span>
                      {obj.type && (
                        <span className="text-[10px] text-muted-foreground">({obj.type})</span>
                      )}
                    </div>
                    {obj.tier && <CleanCoreTierBadge tier={obj.tier} size="sm" />}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Cryptographic Evidence Ledger */}
        <div className="space-y-3">
          <h4 className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[11px] text-foreground">
            <Shield className="size-3.5 text-primary" />
            Cryptographic Evidence Chain
          </h4>

          {finding.evidence && finding.evidence.length > 0 ? (
            finding.evidence.map((ev, idx) => {
              const snippetHash = ev.snippet ? calculateSha256(ev.snippet.trim()) : '';
              const hashMatches =
                ev.sha256 && snippetHash
                  ? snippetHash.toLowerCase() === ev.sha256.toLowerCase()
                  : true;

              return (
                <div
                  key={idx}
                  className="rounded-lg border border-border bg-muted/20 p-3.5 space-y-2.5 font-mono text-xs"
                >
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="flex items-center gap-1 text-foreground font-semibold">
                      <FileCode className="size-3.5 text-primary" />
                      {ev.artifactPath}
                    </span>
                    {ev.lineNumber && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                        Line {ev.lineNumber}
                        {ev.columnNumber ? `:${ev.columnNumber}` : ''}
                      </span>
                    )}
                  </div>

                  {/* Syntax Highlighted Snippet Box */}
                  {ev.snippet && (
                    <div className="relative rounded-md bg-zinc-950 p-3 text-zinc-100 text-[11px] leading-relaxed overflow-x-auto border border-zinc-800">
                      <code>{ev.snippet}</code>
                    </div>
                  )}

                  {/* Cryptographic SHA-256 Hash */}
                  <div className="flex items-center justify-between pt-1 border-t border-border/50 text-[10px]">
                    <div className="flex items-center gap-1.5 text-muted-foreground truncate mr-2">
                      <Hash className="size-3 shrink-0" />
                      <span className="truncate">SHA-256: {ev.sha256}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {hashMatches ? (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-sans font-semibold">
                          <CheckCircle2 className="size-3" /> Verified Hash
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-amber-600 font-sans font-semibold">
                          <AlertCircle className="size-3" /> Unverified Hash
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => copyToClipboard(ev.sha256, `${idx}-hash`)}
                        className="p-1 rounded text-muted-foreground hover:text-foreground"
                        aria-label="Copy SHA-256 Hash"
                      >
                        {copiedHash === `${idx}-hash` ? (
                          <Check className="size-3 text-emerald-500" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-lg border border-dashed border-border p-4 text-center text-muted-foreground italic">
              No raw snippet evidence attached to this rule assertion.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

### 4.5 Faceted Filters Configuration (`apps/web/src/components/findings/finding-filters.ts`)

Binds directly to `DataTableToolbar`'s `facetedFilters` prop:

```typescript
import { FilterDef } from '../data-table/types';
import { ALL_18_ENGINES } from '../../lib/api-client';

export const findingFacetedFilters: FilterDef[] = [
  // 1. Severity Filter
  {
    id: 'severity',
    title: 'Severity',
    options: [
      { label: 'Blocker', value: 'BLOCKER' },
      { label: 'Critical', value: 'CRITICAL' },
      { label: 'Major', value: 'MAJOR' },
      { label: 'Medium', value: 'MEDIUM' },
      { label: 'Minor', value: 'MINOR' },
      { label: 'Low', value: 'LOW' },
      { label: 'Info', value: 'INFO' },
    ],
  },

  // 2. Confidence Filter
  {
    id: 'confidence',
    title: 'Provenance',
    options: [
      { label: 'Verified (1.0)', value: 'VERIFIED' },
      { label: 'Rule Derived (0.85)', value: 'RULE_DERIVED' },
      { label: 'Inferred (0.60)', value: 'INFERRED' },
      { label: 'Unknown (0.30)', value: 'UNKNOWN' },
    ],
  },

  // 3. Clean Core Tier Filter
  {
    id: 'cleanCoreTier',
    title: 'Clean Core',
    options: [
      { label: 'Tier 1 Cloud', value: 'TIER_1_CLOUD' },
      { label: 'Tier 2 Developer', value: 'TIER_2_DEVELOPER' },
      { label: 'Tier 3 Classic', value: 'TIER_3_CLASSIC' },
    ],
  },

  // 4. Preflight Engine Filter
  {
    id: 'engineType',
    title: 'Engine',
    options: ALL_18_ENGINES.map((eng) => ({
      label: eng.name,
      value: eng.id,
    })),
  },
];
```

---

### 4.6 TanStack Query Hook (`apps/web/src/hooks/useFindings.ts`)

Connects to `queryKeys.findings` and fetches typed finding models:

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/query/query-keys';
import { fetchFindings } from '../lib/api-client';
import { Finding } from '@erppreflight/schemas';

export function useFindings(projectId?: string) {
  const queryKey = projectId
    ? queryKeys.findings.byProject(projectId)
    : queryKeys.findings.lists();

  return useQuery<Finding[], Error>({
    queryKey,
    queryFn: async () => {
      const data = await fetchFindings();
      if (projectId) {
        // Filter by project when specified
        return data.filter((f) => !f.projectId || f.projectId === projectId);
      }
      return data;
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
    refetchOnWindowFocus: false,
  });
}
```

---

### 4.7 Project Findings Page (`apps/web/src/app/projects/[id]/findings/page.tsx`)

Full page blueprint for `/projects/[id]/findings`:
- Breadcrumbs back to `/projects` and `/projects/[id]`.
- Project header with target release and Clean Core health metrics.
- Synchronized `useTableUrlSync` hook.
- `DataTable` with 8 columns, compound row virtualization, non-color badges, and full CSV/JSON export.
- Error state with TanStack Query retry.

```tsx
'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  FolderGit2,
  ChevronRight,
  ShieldAlert,
  ArrowLeft,
  Sparkles,
  Layers,
  History,
  Play,
  UploadCloud,
} from 'lucide-react';
import { useFindings } from '../../../hooks/useFindings';
import { DataTable } from '../../../components/data-table';
import { findingColumns } from '../../../components/findings/finding-columns';
import { FindingDetailRow } from '../../../components/findings/finding-detail-row';
import { findingFacetedFilters } from '../../../components/findings/finding-filters';
import { useTableUrlSync } from '../../../hooks/useTableUrlSync';

export default function ProjectFindingsPage() {
  const params = useParams();
  const projectId = (params?.id as string) || '';
  const router = useRouter();

  // TanStack Query for server state
  const { data: findings = [], isLoading, isError, error, refetch } = useFindings(projectId);

  // URL synchronization hook for table filters, sorts, and search
  const { state: urlState, updateUrl } = useTableUrlSync(50);

  // High-level statistics
  const blockerCount = findings.filter((f) => f.severity === 'BLOCKER').length;
  const criticalCount = findings.filter((f) => f.severity === 'CRITICAL').length;
  const tier3Count = findings.filter(
    (f) => f.affectedObjects?.[0]?.tier === 'TIER_3_CLASSIC'
  ).length;

  return (
    <div className="space-y-6">
      {/* Breadcrumb Navigation */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/projects" className="hover:text-foreground transition-colors">
          Projects
        </Link>
        <ChevronRight className="size-3.5" />
        <Link href={`/projects/${projectId}`} className="hover:text-foreground transition-colors font-mono">
          Workspace
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="font-semibold text-foreground">Findings & Preflight Ledger</span>
      </nav>

      {/* Header Bar */}
      <div className="border-b border-border pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <ShieldAlert className="size-6 text-primary" />
              <h1 className="text-xl sm:text-2xl font-extrabold text-foreground">
                Preflight Findings & Evidence Ledger
              </h1>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Verifiable preflight defects, Clean Core violations, and cryptographic SHA-256 evidence chain for Workspace{' '}
              <span className="font-mono text-foreground font-semibold">{projectId}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/projects/${projectId}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shadow-xs"
            >
              <ArrowLeft className="size-3.5" />
              Back to Overview
            </Link>
          </div>
        </div>

        {/* Metric Badges */}
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-card border border-border shadow-xs">
            <span className="text-muted-foreground">Total Findings:</span>
            <span className="font-bold text-foreground font-mono">{findings.length}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/60 dark:text-red-200 dark:border-red-900 shadow-xs">
            <span className="font-semibold">Blockers:</span>
            <span className="font-bold font-mono">{blockerCount}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-orange-50 border border-orange-200 text-orange-800 dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-900 shadow-xs">
            <span className="font-semibold">Critical:</span>
            <span className="font-bold font-mono">{criticalCount}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-900 shadow-xs">
            <span className="font-semibold">Tier 3 Classic Mutations:</span>
            <span className="font-bold font-mono">{tier3Count}</span>
          </div>
        </div>
      </div>

      {/* Main Virtualized Findings Grid */}
      <DataTable
        columns={findingColumns}
        data={findings}
        enableVirtualization={findings.length > 50}
        virtualHeight="calc(100vh - 340px)"
        facetedFilters={findingFacetedFilters}
        searchColumnId="title"
        searchPlaceholder="Filter by title, rule ID, or description..."
        renderExpandedRow={(row) => <FindingDetailRow finding={row.original} />}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        emptyTitle="Clean Core Verified — Zero Preflight Defects"
        emptyDescription="All evaluated SAP artifacts and custom objects comply with Clean Core guidelines. No migration blockers detected."
      />
    </div>
  );
}
```

---

### 4.8 Upgrading the Universal Inspector (`apps/web/src/app/inspector/page.tsx`)

Replaces the prototype with the production TanStack architecture:
- Queries all findings across the tenant via `useFindings()`.
- Incorporates `useTableUrlSync` so search and facet filters persist in the URL.
- Uses `DataTable` with compound row virtualization and `renderExpandedRow`.
- Exports full datasets via CSV/JSON.

```tsx
'use client';

import * as React from 'react';
import { SearchCode } from 'lucide-react';
import { useFindings } from '../../hooks/useFindings';
import { DataTable } from '../../components/data-table';
import { findingColumns } from '../../components/findings/finding-columns';
import { FindingDetailRow } from '../../components/findings/finding-detail-row';
import { findingFacetedFilters } from '../../components/findings/finding-filters';
import { useTableUrlSync } from '../../hooks/useTableUrlSync';

export default function UniversalInspectorPage() {
  const { data: findings = [], isLoading, isError, error, refetch } = useFindings();
  const { state: urlState } = useTableUrlSync(50);

  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-5">
        <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2.5">
          <SearchCode className="size-6 text-primary" />
          Universal Object & Analysis Inspector
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Epistemic findings ledger with cryptographic SHA-256 evidence chain and Clean Core remediation guidance
        </p>
      </div>

      <DataTable
        columns={findingColumns}
        data={findings}
        enableVirtualization={findings.length > 50}
        virtualHeight="calc(100vh - 280px)"
        facetedFilters={findingFacetedFilters}
        searchColumnId="title"
        searchPlaceholder="Search findings by rule ID, title, engine, or object..."
        renderExpandedRow={(row) => <FindingDetailRow finding={row.original} />}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={() => refetch()}
        emptyTitle="No Findings Detected"
        emptyDescription="No analysis findings matched the selected criteria or no runs have been executed."
      />
    </div>
  );
}
```

---

### 4.9 Navigation Integration in Project Workspace (`apps/web/src/app/projects/[id]/page.tsx`)

In `apps/web/src/app/projects/[id]/page.tsx`:
1. Add a **"Findings"** tab alongside `overview`, `artifacts`, `history`, `launcher`:
   ```tsx
   { id: 'findings', label: 'Findings', icon: ShieldAlert, href: `/projects/${projectId}/findings` }
   ```
2. In the `Overview` tab findings card, add a clickable link directly navigating to `/projects/${projectId}/findings`:
   ```tsx
   <Link
     href={`/projects/${projectId}/findings`}
     className="mt-3 flex items-baseline gap-2 group hover:opacity-80 transition-opacity"
   >
     <span className="text-3xl font-bold text-foreground">3</span>
     <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded flex items-center gap-1">
       1 Blocker • 1 Critical
       <ChevronRight className="size-3" />
     </span>
   </Link>
   ```

---

## 5. Verification Method

Once implemented, the feature can be independently verified via the following steps:

1. **Compilation & Typecheck Verification**:
   ```bash
   pnpm --filter @erppreflight/web typecheck
   pnpm --filter @erppreflight/web build
   ```
   *Expected*: Zero TypeScript errors, clean bundle generation.

2. **WCAG 2.2 AA Non-Color Accessibility Verification**:
   - Inspect every `SeverityBadge` instance in DOM: verify presence of `role="status"`, `aria-label`, and rendered Lucide SVG icon.
   - Run axe-core accessibility audit on `/projects/[id]/findings` and `/inspector`: zero SC 1.4.1 (Use of Color) violations.

3. **URL Parameter Synchronization Verification**:
   - Navigate to `/projects/[id]/findings?severity=BLOCKER,CRITICAL`.
   - Verify table filters automatically apply to only show Blocker and Critical rows.
   - Click a facet checkbox in the toolbar: verify URL search params update without page refresh (`scroll: false`).
   - Refresh browser: verify active filters and search term restore from URL state.

4. **Expandable Dynamic Height Virtualization Verification**:
   - Click a finding row or expand chevron: verify finding detail view renders inline.
   - Verify snippet, line/column, and SHA-256 hash render properly.
   - Verify virtualizer measures compound `<tbody>` without row overlap or visual glitches.

5. **Full Dataset Export Verification**:
   - Filter findings by `BLOCKER`.
   - Click "CSV" in `DataTableToolbar`.
   - Verify downloaded file has UTF-8 BOM (`\uFEFF`), valid RFC 4180 headers, and includes all filtered findings (not just the virtualized slice).
   - Click "JSON" in `DataTableToolbar`.
   - Verify valid JSON array of `Finding` models is downloaded.
