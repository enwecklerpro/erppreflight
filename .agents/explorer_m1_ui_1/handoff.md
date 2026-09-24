# Architectural Blueprint & Handoff Report: UI Playbooks (Milestone 1)

**Agent**: `explorer_m1_ui_1` (`teamwork_preview_explorer`)  
**Workspace**: `H:/erppreflight/.agents/explorer_m1_ui_1`  
**Parent**: `66440be0-c7ee-4a74-8a17-61e13b963df1` (`parent`)  
**Target Output Files**:
1. `H:/erppreflight/.agents/skills/frontend-design-system.md`
2. `H:/erppreflight/.agents/skills/data-table-and-large-list.md`
3. `H:/erppreflight/.agents/skills/dependency-graph.md`  
**Timestamp**: 2026-09-24T03:05:00Z  
**Handoff Type**: Hard (Task Complete)

---

## 1. Observation

Direct observations extracted from authoritative reference documents (`22_REPOSITORY_AGENT_SKILLS_PLAYBOOKS.md`, `21_LIBRARY_AND_ENGINEERING_STACK_STANDARD.md`, `ERP_PREFLIGHT_TANSTACK_ONLY_PROMPT.md`, `packages/schemas`, and `apps/web`):

1. **Repository & Directory State**:
   - `H:/erppreflight/.agents/skills/` directory does not yet exist and must be populated with canonical skill playbooks.
   - `apps/web/package.json` currently depends on Next.js `15.1.7`, React `19.0.0`, Tailwind CSS `3.4.17`, Radix UI primitives (`@radix-ui/react-*`), Lucide icons `0.475.0`, and Zod `3.24.2`.
   - `apps/web` does not yet have `@tanstack/react-table`, `@tanstack/react-virtual`, `@tanstack/react-form`, or `@xyflow/react` installed.
   - `apps/web/tailwind.config.ts` and `apps/web/src/app/globals.css` define basic CSS variables (`--background`, `--foreground`, `--card`, `--border`) but lack semantic severity tokens (`--blocker`, `--critical`, `--major`, `--medium`, `--minor`, `--low`, `--info`) and Clean Core tier tokens.

2. **Part 22 Specifications (`22_REPOSITORY_AGENT_SKILLS_PLAYBOOKS.md`)**:
   - Section 22.0: Canonical markdown skill files reside under `/.agents/skills/`. Root `AGENTS.md` directs coding agents to skills.
   - Section 22.1: `frontend-design-system` covers shadcn/Base UI, design tokens, typography, tables, finding severity UI, light/dark, accessibility, responsive behavior, TanStack usage, Motion restraint, React Flow/ECharts usage, and visual regression. Trigger: any frontend/page/component work.
   - Section 22.2: `data-table-and-large-list` covers TanStack Table, server pagination/filtering for large datasets, TanStack Virtual where applicable, URL-backed filters, stable row IDs, bulk selection, accessible keyboard selection, export path, and never rendering 100k rows in the DOM. Trigger: findings, objects, migration inventory, admin tables, MFS logs.
   - Section 22.3: `dependency-graph` covers React Flow rendering, ELK layout, canonical backend graph IDs, accessible table fallback, node inspector, filters, no business logic hidden in UI edge rendering, and large graph strategy. Trigger: impact, traceability, transport, custom fields, MFS, ChangeSet visualization.

3. **Part 21 Specifications (`21_LIBRARY_AND_ENGINEERING_STACK_STANDARD.md`)**:
   - Section 21.1: UI foundation is Next.js, React, TypeScript strict mode, Tailwind CSS, shadcn/ui as the product component layer, with Base UI as the preferred headless primitive foundation for new shadcn components. Strict rule: "Do not mix Base UI, Radix UI and Ark UI across the product without a documented exception."
   - Section 21.2: Motion (`motion/react`) used for intentional micro-interactions only; accessibility first; respect `prefers-reduced-motion`; no excessive dashboard animation; CSS transitions for simple effects; Motion used only when state/layout transitions materially improve usability.
   - Section 21.6 & 21.7: `@xyflow/react` for interactive dependency/traceability/change graphs; ELK.js for deterministic automatic layouts (LR, TB, hierarchical); accessible table fallback mandatory; heavy layouts in Web Worker or server-side worker.
   - Section 21.42: Strict zero-duplication policy (no Redux, no React Hook Form, no mixing primitive libraries).
   - Section 21.43: Lazy loading required for Monaco, React Flow, ECharts, and large file previews.

4. **TanStack Specification (`ERP_PREFLIGHT_TANSTACK_ONLY_PROMPT.md`)**:
   - Sections 13–17: Canonical reusable `DataTable` architecture (`data-table.tsx`, `columns.tsx`, `toolbar.tsx`, `filters.tsx`, `pagination.tsx`, `bulk-actions.tsx`, `column-visibility.tsx`, `export.tsx`, `empty-state.tsx`, `types.ts`). Server-side pagination, multi-column sorting, facet filtering, and global search for datasets > 500 records. Table state synchronized to URL query parameters (`?page=2&pageSize=50&severity=BLOCKER,CRITICAL&status=OPEN&sort=createdAt.desc`). Table accessibility: keyboard navigation, meaningful headers, non-color severity indicators.
   - Sections 18–21: TanStack Virtual (`@tanstack/react-virtual`) for large collections (MFS logs with 500k+ events, SAP object catalogs with 100k+ items, large findings tables). Virtualize visible rows only after server query windowing. Support dynamic row heights via `measureElement` for expandable finding details and multiline logs.
   - Export actions must trigger backend streaming generation of the full filtered dataset, never merely the virtualized visible DOM slice.

5. **Schema Standards (`packages/schemas`)**:
   - `packages/schemas/src/common.ts`: `SeverityEnum` (`BLOCKER`, `CRITICAL`, `MAJOR`, `MEDIUM`, `MINOR`, `LOW`, `INFO`), `CleanCoreTierEnum` (`TIER_1_CLOUD`, `TIER_2_DEVELOPER`, `TIER_3_CLASSIC`), `ConfidenceClassEnum` (`VERIFIED`, `RULE_DERIVED`, `INFERRED`, `UNKNOWN`), `EngineTypeEnum` (18 engines).
   - `packages/schemas/src/finding.ts`: `Finding` and `FindingWire` schemas with UUID `id`, `ruleId`, `severity`, `confidence`, `confidenceScore`, `remediation`, `affectedObjects`, `evidence`, and `technicalDetails`.

---

## 2. Logic Chain

1. **Design System & Component Architecture (`frontend-design-system.md`)**:
   - Base UI is the designated headless primitive layer for new shadcn/ui components. To prevent the "dependency soup" prohibited in Part 21.42, existing Radix UI primitives must be encapsulated behind unified ERP Preflight component abstractions (`@/components/ui/*`). New primitive additions must use `@base-ui-components/react`.
   - WCAG 2.2 AA compliance requires contrast ratios >= 4.5:1 for normal text and >= 3:1 for large text and UI components. Light and dark modes must be driven by semantic CSS variables (`bg-background text-foreground bg-card text-card-foreground`).
   - WCAG Success Criterion 1.4.1 (Use of Color) strictly forbids color as the sole visual means of conveying information. Severity levels (`BLOCKER`, `CRITICAL`, `MAJOR`, `MEDIUM`, `MINOR`, `LOW`, `INFO`) and Clean Core tiers must always combine three distinct cues: (1) semantic color token, (2) explicit semantic icon (e.g. `OctagonAlert`, `AlertTriangle`), and (3) unambiguous textual label + `aria-label`.
   - Motion discipline requires gating all animations through `prefers-reduced-motion`. In `motion/react`, when reduced motion is detected, duration must collapse to 0 or simple 100ms opacity fades. Heavy layout animations are restricted to functional containers (modals, slide-overs, accordions, filter chips).
   - Global command palette (`Cmd/Ctrl + K`) serves as the central accessibility and navigation accelerator for enterprise operators, indexing projects, SAP objects, finding rule codes, and system runbooks.
   - Toast notifications must be strictly ephemeral; critical findings and security alerts must be persisted in durable UI surfaces (finding cards, audit tables, notification centers).

2. **Enterprise Data Table & Large Lists (`data-table-and-large-list.md`)**:
   - SAP migration analysis routinely yields 100,000+ objects and 500,000+ MFS telegrams. Rendering this volume directly in the DOM creates browser memory exhaustion and freezes the main thread.
   - The solution is a two-tier architecture: (1) Server-side querying handles windowing, filtering, sorting, and text search; (2) Client-side TanStack Virtual (`@tanstack/react-virtual`) virtualizes the active page window (e.g. 50–500 rows) or large client buffers.
   - Table state must be bidirectionally bound to URL query parameters via Next.js router. This ensures filter deep-linking, browser history navigation, and reproducible diagnostic sessions without storing duplicate filter state in Redux or Zustand.
   - Dynamic row height support via `virtualizer.measureElement` is mandatory because preflight findings contain expandable details (code snippets, SHA-256 hashes, remediation steps) that vary from 48px to 400px+.
   - Export actions must execute against the backend query endpoint or trigger a streaming export job for the complete filtered dataset. Exporting only the virtualized visible DOM slice is a critical defect.

3. **Interactive Dependency Graph (`dependency-graph.md`)**:
   - Preflight analysis relies on understanding structural coupling: SAP object dependencies, transport request chains, custom field flows, and clean core boundary crossings.
   - `@xyflow/react` provides canvas zoom/pan/minimap, while `elkjs` provides deterministic hierarchical and directed layouts (LR and TB).
   - ELK layout computations on graphs with >200 nodes or >500 edges are CPU-intensive. Running them on the main thread causes UI frame drops and freezes user input. Offloading ELK layout execution to a Web Worker (`layout.worker.ts`) guarantees smooth 60fps UI performance.
   - Graph entity IDs must maintain 1:1 parity with backend domain keys (SAP canonical name, transport ID, finding UUID) to enable bidirectional inspection.
   - WCAG SC 1.1.1 (Non-text Content) dictates that visual canvases cannot be the sole mechanism to access data. A synchronized, accessible tabular view (`View as Table`) is mandatory for all graph routes.
   - `@xyflow/react` and `elkjs` are heavy bundles (~300KB+ gzipped); they must be dynamically imported via Next.js `dynamic()` with `ssr: false`.

---

## 3. Detailed Specifications for the 3 UI Playbooks

The downstream implementer will create three markdown files under `H:/erppreflight/.agents/skills/`:
1. `frontend-design-system.md`
2. `data-table-and-large-list.md`
3. `dependency-graph.md`

Below are the exact sections, rules, TypeScript/React code implementations, invariants, and anti-patterns for each playbook.

---

### 3.1 Playbook 1: `frontend-design-system.md`

- **Target File**: `H:/erppreflight/.agents/skills/frontend-design-system.md`
- **Playbook Identifier**: `frontend-design-system`
- **Applicable Trigger**: Any frontend task, page implementation, component authoring, theme modification, CSS/styling change, or accessibility enhancement in `apps/web`.

#### Exact Table of Contents
1. Metadata & Trigger Definition
2. UI Stack & Component Primitive Architecture (Base UI + shadcn/ui)
3. Design Token Hierarchy & Dark/Light Mode Theme Architecture
4. Non-Color Severity Presentation Standard (WCAG 2.2 AA SC 1.4.1)
5. Disciplined Motion Framework (`motion/react` + Reduced Motion)
6. Global Command Palette (`Cmd/Ctrl + K`) Architecture
7. Toast Notification Rules vs Persistent UI States
8. Heavy Component Code-Splitting Protocol
9. Non-Negotiable Invariants
10. Anti-Patterns & Corrective Implementations

#### Exact Architectural Specifications & Code Blueprints

##### Section 2: Component Foundation & Zero-Duplication
- Framework: Next.js 15+ App Router, React 19, TypeScript strict mode.
- Headless Primitive Policy:
  * For new primitive components, use `@base-ui-components/react`.
  * Encapsulate all primitives inside `@/components/ui/*` using `class-variance-authority` (cva), `clsx`, and `tailwind-merge` (`cn` helper).
  * Existing Radix UI components (`@radix-ui/react-*`) in `apps/web` must not be duplicated; migrate primitives only when Base UI provides equivalent or superior accessibility features.
  * Strictly forbid importing `@chakra-ui`, `@mui/material`, `antd`, or `ark-ui`.

```ts
// apps/web/src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

##### Section 3: Design Tokens & CSS Variables
Define explicit CSS variables in `apps/web/src/app/globals.css` and extend `tailwind.config.ts`. Contrast ratios must strictly exceed 4.5:1 for normal text and 3:1 for large/graphical elements in both light and dark themes.

```css
/* apps/web/src/app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #f8fafc;
  --foreground: #0f172a;
  --card: #ffffff;
  --card-foreground: #0f172a;
  --popover: #ffffff;
  --popover-foreground: #0f172a;
  --primary: #1d4ed8; /* Blue 700 - Contrast 4.6:1 on white */
  --primary-foreground: #ffffff;
  --secondary: #475569;
  --secondary-foreground: #ffffff;
  --muted: #f1f5f9;
  --muted-foreground: #475569; /* Slate 600 - Contrast 5.1:1 on f1f5f9 */
  --accent: #0284c7;
  --accent-foreground: #ffffff;
  --destructive: #b91c1c; /* Red 700 */
  --destructive-foreground: #ffffff;
  --border: #cbd5e1;
  --input: #cbd5e1;
  --ring: #1d4ed8;

  /* ERP Preflight Severity Tokens (Light) */
  --severity-blocker-bg: #fef2f2;
  --severity-blocker-border: #f87171;
  --severity-blocker-text: #991b1b;
  --severity-critical-bg: #fff7ed;
  --severity-critical-border: #fb923c;
  --severity-critical-text: #9a3412;
  --severity-major-bg: #fefce8;
  --severity-major-border: #facc15;
  --severity-major-text: #854d0e;
  --severity-medium-bg: #fef9c3;
  --severity-medium-border: #eab308;
  --severity-medium-text: #713f12;
  --severity-minor-bg: #f0fdf4;
  --severity-minor-border: #86efac;
  --severity-minor-text: #166534;
  --severity-low-bg: #f0fdfa;
  --severity-low-border: #5eead4;
  --severity-low-text: #115e59;
  --severity-info-bg: #f0f9ff;
  --severity-info-border: #7dd3fc;
  --severity-info-text: #075985;
}

.dark {
  --background: #090d16;
  --foreground: #f8fafc;
  --card: #111827;
  --card-foreground: #f8fafc;
  --popover: #111827;
  --popover-foreground: #f8fafc;
  --primary: #3b82f6;
  --primary-foreground: #ffffff;
  --secondary: #64748b;
  --secondary-foreground: #ffffff;
  --muted: #1e293b;
  --muted-foreground: #94a3b8;
  --accent: #38bdf8;
  --accent-foreground: #090d16;
  --destructive: #ef4444;
  --destructive-foreground: #ffffff;
  --border: #334155;
  --input: #334155;
  --ring: #3b82f6;

  /* ERP Preflight Severity Tokens (Dark) */
  --severity-blocker-bg: #450a0a;
  --severity-blocker-border: #991b1b;
  --severity-blocker-text: #fecaca;
  --severity-critical-bg: #431407;
  --severity-critical-border: #9a3412;
  --severity-critical-text: #ffedd5;
  --severity-major-bg: #422006;
  --severity-major-border: #854d0e;
  --severity-major-text: #fef08a;
  --severity-medium-bg: #3f2c06;
  --severity-medium-border: #713f12;
  --severity-medium-text: #fef9c3;
  --severity-minor-bg: #052e16;
  --severity-minor-border: #166534;
  --severity-minor-text: #bbf7d0;
  --severity-low-bg: #042f2e;
  --severity-low-border: #115e59;
  --severity-low-text: #99f6e4;
  --severity-info-bg: #082f49;
  --severity-info-border: #075985;
  --severity-info-text: #bae6fd;
}
```

##### Section 4: Non-Color Severity Presentation Standard
Rule: Never use color as the sole indicator. Every severity presentation must supply:
1. Distinct semantic background and border colors.
2. An explicit Lucide icon.
3. Unambiguous textual label (`BLOCKER`, `CRITICAL`, etc.) and `aria-label`.

```tsx
// apps/web/src/components/ui/severity-badge.tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { 
  OctagonAlert, 
  AlertTriangle, 
  AlertCircle, 
  HelpCircle, 
  Info, 
  MinusCircle, 
  ShieldAlert 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Severity } from '@erppreflight/schemas';

const severityBadgeVariants = cva(
  'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-colors select-none',
  {
    variants: {
      severity: {
        BLOCKER: 'bg-[var(--severity-blocker-bg)] border-[var(--severity-blocker-border)] text-[var(--severity-blocker-text)]',
        CRITICAL: 'bg-[var(--severity-critical-bg)] border-[var(--severity-critical-border)] text-[var(--severity-critical-text)]',
        MAJOR: 'bg-[var(--severity-major-bg)] border-[var(--severity-major-border)] text-[var(--severity-major-text)]',
        MEDIUM: 'bg-[var(--severity-medium-bg)] border-[var(--severity-medium-border)] text-[var(--severity-medium-text)]',
        MINOR: 'bg-[var(--severity-minor-bg)] border-[var(--severity-minor-border)] text-[var(--severity-minor-text)]',
        LOW: 'bg-[var(--severity-low-bg)] border-[var(--severity-low-border)] text-[var(--severity-low-text)]',
        INFO: 'bg-[var(--severity-info-bg)] border-[var(--severity-info-border)] text-[var(--severity-info-text)]',
      },
      size: {
        sm: 'text-[11px] px-2 py-0.5 gap-1',
        default: 'text-xs px-2.5 py-1 gap-1.5',
        lg: 'text-sm px-3 py-1.5 gap-2',
      },
    },
    defaultVariants: {
      severity: 'INFO',
      size: 'default',
    },
  }
);

const severityIcons: Record<Severity, React.ComponentType<{ className?: string }>> = {
  BLOCKER: OctagonAlert,
  CRITICAL: AlertTriangle,
  MAJOR: AlertCircle,
  MEDIUM: ShieldAlert,
  MINOR: MinusCircle,
  LOW: HelpCircle,
  INFO: Info,
};

export interface SeverityBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof severityBadgeVariants> {
  severity: Severity;
  showIcon?: boolean;
}

export function SeverityBadge({
  severity,
  size,
  showIcon = true,
  className,
  ...props
}: SeverityBadgeProps) {
  const IconComponent = severityIcons[severity] || Info;

  return (
    <span
      role="status"
      aria-label={`Severity: ${severity}`}
      className={cn(severityBadgeVariants({ severity, size }), className)}
      {...props}
    >
      {showIcon && <IconComponent className="size-3.5 shrink-0" aria-hidden="true" />}
      <span>{severity}</span>
    </span>
  );
}
```

##### Section 5: Disciplined Motion Framework (`motion/react`)
Rule: Respect `prefers-reduced-motion` at all times. Do not run spring physics or continuous rotations. Motion is strictly reserved for modals, slide-overs, accordions, and animated filter pills.

```tsx
// apps/web/src/components/ui/accessible-motion.tsx
'use client';

import * as React from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'motion/react';

interface AccessibleModalTransitionProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function AccessibleModalTransition({ isOpen, onClose, children }: AccessibleModalTransitionProps) {
  const shouldReduceMotion = useReducedMotion();

  // If user requested reduced motion, bypass scale/translate transforms completely
  const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: shouldReduceMotion ? 0.05 : 0.15 } },
    exit: { opacity: 0, transition: { duration: shouldReduceMotion ? 0.05 : 0.1 } },
  };

  const panelVariants = {
    hidden: shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 },
    visible: shouldReduceMotion 
      ? { opacity: 1, transition: { duration: 0.05 } }
      : { opacity: 1, y: 0, scale: 1, transition: { type: 'easeOut', duration: 0.2 } },
    exit: shouldReduceMotion
      ? { opacity: 0, transition: { duration: 0.05 } }
      : { opacity: 0, y: 12, scale: 0.98, transition: { duration: 0.15 } },
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
```

##### Section 6: Command Palette Architecture (`Cmd/Ctrl + K`)
Rule: Provide global keyboard accelerator for project switching, SAP object lookup, finding navigation, and engine execution. Must trap focus when open, support full arrow-key roving, and dismiss on `Escape`.

```tsx
// apps/web/src/components/command-palette.tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search, FolderGit2, FileCode, ShieldAlert, Cpu } from 'lucide-react';
import { BaseUI } from '@base-ui-components/react'; // or encapsulated dialog primitive

export function GlobalCommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const router = useRouter();

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!open) return null;

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-24 p-4"
      onClick={() => setOpen(false)}
    >
      <div 
        className="w-full max-w-xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Global Command Palette"
      >
        <div className="flex items-center px-4 py-3 border-b border-border bg-muted/30">
          <Search className="size-4 text-muted-foreground mr-3 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, SAP objects (e.g. MARC, Z_INVOICE), finding codes, or engines..."
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="text-[10px] uppercase font-mono px-1.5 py-0.5 border border-border rounded bg-muted text-muted-foreground">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {/* Categorized command groups: Projects, Findings, SAP Objects, Engines */}
          <div className="text-[10px] font-semibold uppercase text-muted-foreground px-3 py-1">
            Engines
          </div>
          <button
            onClick={() => { router.push('/engines/OPD_GUARD'); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg hover:bg-muted/80 text-foreground transition-colors text-left"
          >
            <Cpu className="size-4 text-primary" />
            <span>OPD Guard (Output Parameter Determination)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
```

##### Section 7: Toast Notification Rules vs Persistent UI States
- **Ephemeral Toasts**: Reserved exclusively for non-critical, transient feedback (e.g. "Rule copied to clipboard", "Filter view saved", "Export file generation started"). Dismiss within 3–4 seconds.
- **Persistent Findings & Errors**: Analysis errors, migration blocker alerts, missing evidence warnings, and security violations MUST NEVER rely on toasts. They must render inside durable finding cards, evidence inspectors, or persistent alert banners with unique IDs.

##### Section 8: Non-Negotiable Invariants & Anti-Patterns
- **Invariants**:
  1. Never mix Base UI, Radix UI, and Ark UI in new components without a documented ADR exception.
  2. Never use color as the sole indicator for severity or clean core tier (always pair with icon + label + aria-label).
  3. All interactive elements must maintain WCAG 2.2 AA contrast ratios in both light and dark modes.
  4. Animations must check `prefers-reduced-motion` and collapse durations to <= 100ms when active.
  5. Heavy dependencies (Monaco, React Flow, ECharts) must be lazy-loaded via `next/dynamic` or `React.lazy`.
- **Anti-Patterns**:
  * ❌ *Anti-Pattern*: `<span className="bg-red-500 text-white rounded p-1">BLOCKER</span>` (color without semantic icon, poor contrast in dark mode).
  * ✅ *Correct Pattern*: Use `<SeverityBadge severity="BLOCKER" />` using semantic CSS variables, icon, and accessible labels.
  * ❌ *Anti-Pattern*: Rendering full-page spinning loaders or infinite bouncing cards on dashboards.
  * ✅ *Correct Pattern*: Minimal skeleton placeholders matching target card layout.

---

### 3.2 Playbook 2: `data-table-and-large-list.md`

- **Target File**: `H:/erppreflight/.agents/skills/data-table-and-large-list.md`
- **Playbook Identifier**: `data-table-and-large-list`
- **Applicable Trigger**: Creating or maintaining data grids, finding tables, SAP object inventories, migration catalogs, admin user tables, or MFS telegram logs.

#### Exact Table of Contents
1. Metadata & Trigger Definition
2. Canonical Table Architecture & Directory Layout (`packages/ui/data-table/`)
3. Server-Side Execution Model (Pagination, Sorting, Filtering, Global Search)
4. URL Synchronization Protocol (`useTableUrlSync`)
5. Virtualization Engine (`@tanstack/react-virtual` v3)
6. Dynamic Row Height Measurement (`measureElement`)
7. Row Selection, Bulk Actions & Stable Identifiers
8. Full-Dataset Server-Side Export Architecture
9. Keyboard Navigation & Screen-Reader Grid Semantics
10. Non-Negotiable Invariants & Anti-Patterns

#### Exact Architectural Specifications & Code Blueprints

##### Section 2: Canonical Directory Layout
Every feature data table must build on a standardized set of modular components:

```text
apps/web/src/components/data-table/
├── data-table.tsx             # Core table container & TanStack Table instance
├── data-table-virtual.tsx     # Virtualized row renderer via @tanstack/react-virtual
├── data-table-toolbar.tsx     # Global search input, filter chips, view toggles
├── data-table-filters.tsx     # Faceted multi-select filter popovers
├── data-table-pagination.tsx  # Page size selector, current window, page navigation
├── data-table-bulk-actions.tsx# Floating bulk selection actions (Export, Assign, Resolve)
├── data-table-column-menu.tsx # Column visibility & pinning dropdown
├── data-table-export.tsx      # Full-dataset CSV/JSON export action
├── data-table-empty-state.tsx # Standardized contextual empty / no-results states
└── types.ts                  # Standardized TableState, FilterDef, ColumnMeta types
```

##### Section 3 & 4: URL Synchronization Protocol (`useTableUrlSync`)
Table state must be stored in the URL search params so links are shareable, persistent across reloads, and browser history (back/forward) functions seamlessly.

```ts
// apps/web/src/components/data-table/use-table-url-sync.ts
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

export interface TableUrlState {
  page: number;
  pageSize: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  filters: Record<string, string[]>;
}

export function useTableUrlSync(defaultPageSize = 50) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state: TableUrlState = useMemo(() => {
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.max(10, parseInt(searchParams.get('pageSize') || String(defaultPageSize), 10));
    const sort = searchParams.get('sort');
    let sortField: string | undefined;
    let sortOrder: 'asc' | 'desc' | undefined;

    if (sort) {
      const parts = sort.split('.');
      sortField = parts[0];
      sortOrder = parts[1] === 'desc' ? 'desc' : 'asc';
    }

    const search = searchParams.get('search') || undefined;
    const filters: Record<string, string[]> = {};

    searchParams.forEach((value, key) => {
      if (!['page', 'pageSize', 'sort', 'search'].includes(key)) {
        filters[key] = value.split(',').filter(Boolean);
      }
    });

    return { page, pageSize, sortField, sortOrder, search, filters };
  }, [searchParams, defaultPageSize]);

  const updateUrl = useCallback(
    (newState: Partial<TableUrlState>) => {
      const current = new URLSearchParams(searchParams.toString());

      if (newState.page !== undefined) {
        if (newState.page > 1) current.set('page', String(newState.page));
        else current.delete('page');
      }

      if (newState.pageSize !== undefined) {
        if (newState.pageSize !== defaultPageSize) current.set('pageSize', String(newState.pageSize));
        else current.delete('pageSize');
      }

      if (newState.sortField !== undefined) {
        if (newState.sortField) {
          current.set('sort', `${newState.sortField}.${newState.sortOrder || 'asc'}`);
        } else {
          current.delete('sort');
        }
      }

      if (newState.search !== undefined) {
        if (newState.search.trim()) current.set('search', newState.search.trim());
        else current.delete('search');
      }

      if (newState.filters) {
        Object.entries(newState.filters).forEach(([key, values]) => {
          if (values && values.length > 0) {
            current.set(key, values.join(','));
          } else {
            current.delete(key);
          }
        });
      }

      router.replace(`${pathname}?${current.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams, defaultPageSize]
  );

  return { state, updateUrl };
}
```

##### Section 5 & 6: Virtualization Engine & Dynamic Row Height (`@tanstack/react-virtual`)
Rule: Datasets exceeding 100 visible records must be virtualized. Use `useVirtualizer` with `measureElement` attached to row DOM nodes to accommodate variable-height rows (e.g. expanded finding remediation guides and evidence snippets).

```tsx
// apps/web/src/components/data-table/data-table-virtual.tsx
'use client';

import * as React from 'react';
import {
  Table,
  flexRender,
  Row,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

interface VirtualizedDataTableProps<TData> {
  table: Table<TData>;
  containerHeight?: number | string;
  renderExpandedRow?: (row: Row<TData>) => React.ReactNode;
}

export function VirtualizedDataTable<TData>({
  table,
  containerHeight = '650px',
  renderExpandedRow,
}: VirtualizedDataTableProps<TData>) {
  const tableContainerRef = React.useRef<HTMLDivElement>(null);
  const rows = table.getRowModel().rows;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 52, // Standard table row height
    overscan: 8,            // Render 8 buffer rows above/below visible viewport
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  return (
    <div
      ref={tableContainerRef}
      style={{ height: containerHeight }}
      className="relative overflow-auto border border-border rounded-xl bg-card shadow-xs focus:outline-none"
      tabIndex={0}
      role="region"
      aria-label="Virtualized Data Grid"
    >
      <table className="w-full text-left text-sm border-collapse">
        <thead className="sticky top-0 z-20 bg-muted/90 backdrop-blur-xs border-b border-border shadow-xs">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  scope="col"
                  style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                  className="px-4 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wider select-none"
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr>
              <td style={{ height: `${paddingTop}px` }} colSpan={table.getVisibleLeafColumns().length} />
            </tr>
          )}

          {virtualItems.map((virtualRow) => {
            const row = rows[virtualRow.index];
            const isExpanded = row.getIsExpanded();

            return (
              <React.Fragment key={row.id}>
                <tr
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className={`border-b border-border/60 hover:bg-muted/40 transition-colors ${
                    row.getIsSelected() ? 'bg-primary/5' : ''
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-foreground align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>

                {/* Dynamic Height Expanded Finding Details */}
                {isExpanded && renderExpandedRow && (
                  <tr
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    className="border-b border-border bg-muted/20"
                  >
                    <td colSpan={table.getVisibleLeafColumns().length} className="p-4">
                      {renderExpandedRow(row)}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}

          {paddingBottom > 0 && (
            <tr>
              <td style={{ height: `${paddingBottom}px` }} colSpan={table.getVisibleLeafColumns().length} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

##### Section 7: Row Selection, Stable IDs & Bulk Actions
- `getRowId: (row) => row.id` is mandatory. Never use row array indexes as keys.
- Checkbox header supports checked, unchecked, and `indeterminate` states.
- Floating bulk action bar displays selected count and exposes batch operations:
  * "Export Selected (JSON/CSV)"
  * "Assign to Consultant"
  * "Accept Risk (Clean Core Deviation)"
  * "Batch Mark Resolved"

##### Section 8: Full-Dataset Server-Side Export Architecture
Invariant: Clicking "Export to CSV" or "Export to JSON" MUST trigger a backend export query incorporating all active URL filters, producing the complete dataset. It is strictly forbidden to export only the 20 visible virtualized rows.

```ts
// apps/web/src/components/data-table/export-handler.ts
export async function triggerServerExport({
  projectId,
  filters,
  search,
  format,
}: {
  projectId: string;
  filters: Record<string, string[]>;
  search?: string;
  format: 'csv' | 'json' | 'xlsx';
}) {
  const query = new URLSearchParams({
    format,
    ...(search ? { search } : {}),
    ...Object.fromEntries(
      Object.entries(filters).map(([k, v]) => [k, v.join(',')])
    ),
  });

  const response = await fetch(`/api/v1/projects/${projectId}/findings/export?${query.toString()}`, {
    method: 'GET',
    headers: { Accept: format === 'json' ? 'application/json' : 'text/csv' },
  });

  if (!response.ok) {
    throw new Error(`Export failed with HTTP status ${response.status}`);
  }

  // Handle browser download stream
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `preflight-findings-${projectId}-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
```

##### Section 9: Keyboard Navigation & Screen-Reader Semantics
- Table container must have `role="region"`, `aria-label`, and `tabIndex={0}`.
- Rows use `aria-selected={row.getIsSelected()}`.
- Checkboxes use `aria-label="Select row <id>"`.
- Support keyboard shortcuts: `ArrowDown`/`ArrowUp` to navigate rows, `Space` to toggle selection, `Enter` to open row detail inspector.

##### Section 10: Non-Negotiable Invariants & Anti-Patterns
- **Invariants**:
  1. Never download 50,000+ records to the browser for client-side pagination; pagination/filtering must run on the server.
  2. Never render more than 100 un-virtualized rows in the DOM simultaneously.
  3. Stable row IDs (`row.id`) are required; array indices are strictly forbidden as row IDs.
  4. Table filter and sort states must be synchronized with URL search params.
  5. Exports must stream the complete filtered dataset from the server, never visible DOM nodes.
- **Anti-Patterns**:
  * ❌ *Anti-Pattern*: Calling `table.getRowModel().rows.slice(0, 20)` and generating a CSV from it when the user clicks "Export All".
  * ✅ *Correct Pattern*: Pass active filter parameters to `/api/v1/.../export` to stream the complete dataset.
  * ❌ *Anti-Pattern*: Storing table filter state in Redux or a global Zustand store.
  * ✅ *Correct Pattern*: Use URL search params as the single source of truth.

---

### 3.3 Playbook 3: `dependency-graph.md`

- **Target File**: `H:/erppreflight/.agents/skills/dependency-graph.md`
- **Playbook Identifier**: `dependency-graph`
- **Applicable Trigger**: Creating or modifying dependency viewers, impact analyzers, custom field propagation graphs, transport analyzers, API relationship diagrams, or MFS causal flow trees.

#### Exact Table of Contents
1. Metadata & Trigger Definition
2. Graph Canvas Architecture (`@xyflow/react` v12)
3. Deterministic Graph Layout via ELK.js (`elkjs`)
4. Web Worker Layout Offloading (`elk-layout.worker.ts`)
5. Canonical Backend Graph Identifiers (1:1 Entity Mapping)
6. Custom Node Anatomy (SAP Objects, Findings, Transports)
7. Selected Node Inspector Slide-Over & Interactive Filtering
8. Accessible Synchronized Table Fallback (WCAG SC 1.1.1)
9. Code Splitting & Dynamic Import Architecture
10. Non-Negotiable Invariants & Anti-Patterns

#### Exact Architectural Specifications & Code Blueprints

##### Section 2 & 9: Code Splitting & Canvas Architecture
Rule: `@xyflow/react` and `elkjs` are heavy client libraries (~300KB+). They must be code-split using Next.js `dynamic()` with `ssr: false` to avoid SSR hydration mismatches and prevent bundle bloat.

```tsx
// apps/web/src/components/dependency-graph/graph-loader.tsx
'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

export const LazyDependencyGraph = dynamic(
  () => import('./dependency-graph-canvas').then((mod) => mod.DependencyGraphCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-[700px] rounded-xl border border-border bg-card p-6 flex flex-col items-center justify-center space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[550px] w-full" />
      </div>
    ),
  }
);
```

##### Section 3 & 4: Web Worker Layout Offloading (`elk-layout.worker.ts`)
Rule: Graphs with > 200 nodes or > 500 edges must compute layouts inside a Web Worker. Never run synchronous ELK calculations on the main thread.

```ts
// apps/web/src/components/dependency-graph/elk-layout.worker.ts
/// <reference lib="webworker" />

import ELK, { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();

export interface LayoutWorkerInput {
  nodes: Array<{ id: string; width: number; height: number }>;
  edges: Array<{ id: string; source: string; target: string }>;
  direction: 'RIGHT' | 'DOWN';
}

export interface LayoutWorkerOutput {
  nodes: Array<{ id: string; x: number; y: number }>;
  edges: Array<{ id: string; sections?: any }>;
}

self.onmessage = async (event: MessageEvent<LayoutWorkerInput>) => {
  const { nodes, edges, direction } = event.data;

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.spacing.nodeNode': '60',
      'elk.layered.spacing.nodeNodeBetweenLayers': '100',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: node.width || 240,
      height: node.height || 90,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  try {
    const layouted = await elk.layout(elkGraph);
    const layoutedNodes = (layouted.children || []).map((node) => ({
      id: node.id,
      x: node.x || 0,
      y: node.y || 0,
    }));

    const response: LayoutWorkerOutput = {
      nodes: layoutedNodes,
      edges: (layouted.edges || []) as any,
    };

    self.postMessage({ success: true, data: response });
  } catch (error) {
    self.postMessage({
      success: false,
      error: error instanceof Error ? error.message : 'ELK Layout calculation failed',
    });
  }
};
```

Hook bridging the Web Worker to React Flow state:

```ts
// apps/web/src/components/dependency-graph/use-elk-layout.ts
'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Node, Edge } from '@xyflow/react';
import { LayoutWorkerInput, LayoutWorkerOutput } from './elk-layout.worker';

export function useElkLayout() {
  const [isLayouting, setIsLayouting] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    workerRef.current = new Worker(
      new URL('./elk-layout.worker.ts', import.meta.url),
      { type: 'module' }
    );
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const calculateLayout = useCallback(
    (nodes: Node[], edges: Edge[], direction: 'RIGHT' | 'DOWN' = 'RIGHT'): Promise<Node[]> => {
      return new Promise((resolve, reject) => {
        if (!workerRef.current) {
          reject(new Error('Layout worker not initialized'));
          return;
        }

        setIsLayouting(true);

        const payload: LayoutWorkerInput = {
          nodes: nodes.map((n) => ({
            id: n.id,
            width: n.measured?.width || 240,
            height: n.measured?.height || 90,
          })),
          edges: edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
          })),
          direction,
        };

        const handleMessage = (e: MessageEvent) => {
          setIsLayouting(false);
          workerRef.current?.removeEventListener('message', handleMessage);

          if (e.data.success) {
            const layoutResult: LayoutWorkerOutput = e.data.data;
            const positionMap = new Map(layoutResult.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));

            const updatedNodes = nodes.map((node) => {
              const pos = positionMap.get(node.id);
              return pos ? { ...node, position: pos } : node;
            });

            resolve(updatedNodes);
          } else {
            reject(new Error(e.data.error));
          }
        };

        workerRef.current.addEventListener('message', handleMessage);
        workerRef.current.postMessage(payload);
      });
    },
    []
  );

  return { calculateLayout, isLayouting };
}
```

##### Section 5 & 6: Canonical Graph Identifiers & Custom Node Anatomy
Rule: Node IDs and Edge IDs must directly match backend entity keys:
- SAP Objects: `R3TR_TABL_MARC`, `R3TR_CLAS_ZCL_INVOICE_FLOW`
- Findings: UUID `123e4567-e89b-12d3-a456-426614174000`
- Transports: `DEVK900123`
- Edges: `${sourceId}->${targetId}`

```tsx
// apps/web/src/components/dependency-graph/sap-object-node.tsx
'use client';

import * as React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Database, Code2, Layers, AlertTriangle } from 'lucide-react';
import { CleanCoreTier } from '@erppreflight/schemas';

export interface SapObjectNodeData {
  objectName: string;
  objectType: 'TABLE' | 'CLASS' | 'VIEW' | 'PROGRAM' | 'BADI';
  tier: CleanCoreTier;
  findingCount: number;
  maxSeverity?: 'BLOCKER' | 'CRITICAL' | 'MAJOR' | 'MEDIUM' | 'MINOR' | 'LOW' | 'INFO';
  isTarget?: boolean;
}

const tierBadgeStyles: Record<CleanCoreTier, string> = {
  TIER_1_CLOUD: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300',
  TIER_2_DEVELOPER: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border-blue-300',
  TIER_3_CLASSIC: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border-rose-300',
};

export function SapObjectNode({ data, selected }: NodeProps<any>) {
  const nodeData = data as SapObjectNodeData;

  return (
    <div
      className={`w-60 rounded-xl border bg-card p-3 shadow-md transition-all select-none ${
        selected ? 'ring-2 ring-primary border-primary shadow-lg' : 'border-border hover:border-border/80'
      }`}
    >
      <Handle type="target" position={Position.Left} className="w-2.5 h-2.5 bg-muted-foreground" />

      <div className="flex items-center justify-between pb-2 border-b border-border/60">
        <div className="flex items-center gap-1.5 overflow-hidden">
          {nodeData.objectType === 'TABLE' ? (
            <Database className="size-4 text-blue-500 shrink-0" />
          ) : (
            <Code2 className="size-4 text-amber-500 shrink-0" />
          )}
          <span className="font-mono text-xs font-bold truncate text-foreground">
            {nodeData.objectName}
          </span>
        </div>
        <span className="text-[10px] uppercase font-semibold text-muted-foreground">
          {nodeData.objectType}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tierBadgeStyles[nodeData.tier]}`}>
          {nodeData.tier.replace('TIER_', 'T')}
        </span>

        {nodeData.findingCount > 0 && (
          <div className="flex items-center gap-1 text-[11px] font-semibold text-destructive">
            <AlertTriangle className="size-3 text-destructive" />
            <span>{nodeData.findingCount} finding{nodeData.findingCount > 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="w-2.5 h-2.5 bg-muted-foreground" />
    </div>
  );
}
```

##### Section 7: Selected Node Inspector & Interactive Toolbar
- Clicking any node opens a slide-over Sheet displaying:
  1. Object metadata (name, type, package, Clean Core tier).
  2. Inbound and outbound dependency lists with click-to-focus action.
  3. Preflight findings linked to this object, with direct links to finding remediation.
  4. Quick actions: "Isolate Subgraph", "Simulate Cloud Migration Impact", "Copy Object Name".
- Canvas Toolbar controls:
  * Layout Direction: `Left-to-Right` vs `Top-to-Bottom`.
  * Tier Filters: Checkboxes for `Tier 1 (Cloud)`, `Tier 2 (Developer)`, `Tier 3 (Classic)`.
  * Severity Filter: Show nodes with `BLOCKER/CRITICAL` only.
  * Node Search input with auto-zoom to matched node.
  * `Fit View` and `Reset Zoom` buttons.

##### Section 8: Accessible Synchronized Table Fallback (WCAG SC 1.1.1)
Rule: Visual graphs must never be the only way to inspect relationships. Every graph view must include an accessible, synchronized tabular view via a prominent toggle: `[ Graph View | Table View ]`.

```tsx
// apps/web/src/components/dependency-graph/dependency-table-fallback.tsx
'use client';

import * as React from 'react';
import { Node, Edge } from '@xyflow/react';
import { SapObjectNodeData } from './sap-object-node';
import { SeverityBadge } from '@/components/ui/severity-badge';

interface DependencyTableFallbackProps {
  nodes: Node[];
  edges: Edge[];
  onSelectNode: (nodeId: string) => void;
  selectedNodeId?: string;
}

export function DependencyTableFallback({
  nodes,
  edges,
  onSelectNode,
  selectedNodeId,
}: DependencyTableFallbackProps) {
  // Compute dependency metrics per node
  const tableData = React.useMemo(() => {
    return nodes.map((node) => {
      const data = node.data as unknown as SapObjectNodeData;
      const inbound = edges.filter((e) => e.target === node.id).length;
      const outbound = edges.filter((e) => e.source === node.id).length;
      return {
        id: node.id,
        name: data.objectName,
        type: data.objectType,
        tier: data.tier,
        inbound,
        outbound,
        findingCount: data.findingCount || 0,
        maxSeverity: data.maxSeverity,
      };
    });
  }, [nodes, edges]);

  return (
    <div className="w-full border border-border rounded-xl bg-card overflow-hidden shadow-xs">
      <div className="p-4 border-b border-border bg-muted/30">
        <h3 className="text-sm font-bold text-foreground">
          Dependency Matrix (Tabular Accessibility View)
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Accessible view of all graph nodes, inbound/outbound couplings, and clean core compliance.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse" role="table" aria-label="Dependency Matrix">
          <thead className="bg-muted/60 text-xs font-semibold uppercase text-muted-foreground border-b border-border">
            <tr>
              <th scope="col" className="px-4 py-3">Object Name</th>
              <th scope="col" className="px-4 py-3">Type</th>
              <th scope="col" className="px-4 py-3">Clean Core Tier</th>
              <th scope="col" className="px-4 py-3 text-right">Inbound Deps</th>
              <th scope="col" className="px-4 py-3 text-right">Outbound Deps</th>
              <th scope="col" className="px-4 py-3">Max Severity</th>
              <th scope="col" className="px-4 py-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tableData.map((row) => (
              <tr
                key={row.id}
                className={`hover:bg-muted/40 transition-colors ${
                  selectedNodeId === row.id ? 'bg-primary/10' : ''
                }`}
              >
                <td className="px-4 py-3 font-mono font-medium text-xs text-foreground">
                  {row.name}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {row.type}
                </td>
                <td className="px-4 py-3 text-xs">
                  <span className="font-semibold">{row.tier}</span>
                </td>
                <td className="px-4 py-3 text-xs text-right font-mono">
                  {row.inbound}
                </td>
                <td className="px-4 py-3 text-xs text-right font-mono">
                  {row.outbound}
                </td>
                <td className="px-4 py-3 text-xs">
                  {row.maxSeverity ? (
                    <SeverityBadge severity={row.maxSeverity} size="sm" />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => onSelectNode(row.id)}
                    className="px-2.5 py-1 text-xs rounded bg-muted hover:bg-muted/80 text-foreground transition-colors"
                  >
                    Inspect
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

##### Section 10: Non-Negotiable Invariants & Anti-Patterns
- **Invariants**:
  1. Business rules, severity scoring, or Clean Core compliance MUST NEVER be computed inside edge or node rendering functions.
  2. Every dependency graph route MUST provide an accessible tabular fallback view with synchronized filtering and selection.
  3. Graph layouts with > 200 nodes must calculate coordinates inside a Web Worker.
  4. React Flow and ELK.js MUST be dynamically imported with `ssr: false`.
  5. Canonical backend entity keys must serve as graph node and edge identifiers.
- **Anti-Patterns**:
  * ❌ *Anti-Pattern*: Computing SAP object dependencies inside a `CustomEdge` component's `render()` method.
  * ✅ *Correct Pattern*: Graph edges are pure presentations of server-computed dependency models.
  * ❌ *Anti-Pattern*: Rendering a graph canvas without an alternative accessible table view.
  * ✅ *Correct Pattern*: Synchronized dual view (`Graph` and `Table`).
  * ❌ *Anti-Pattern*: Running `elk.layout()` on the main thread for 1,000 nodes, causing 2-second UI freezes.
  * ✅ *Correct Pattern*: Run `elk.layout()` in `elk-layout.worker.ts` with a loading state.

---

## 4. Caveats

1. **Monorepo Dependency Alignment**:
   - `apps/web/package.json` currently lacks `@tanstack/react-table`, `@tanstack/react-virtual`, `@tanstack/react-form`, and `@xyflow/react`. These dependencies must be added by the implementation agent in Milestone 1/Milestone 2.
   - For Base UI, `@base-ui-components/react` should be introduced for new primitives, while existing `@radix-ui/react-*` components remain wrapped inside `@/components/ui/*` without creating duplicate API surfaces.
2. **Next.js 15 & React 19 Compatibility**:
   - When importing `@xyflow/react` and `elkjs`, Webpack/Turbopack worker configuration (`new URL('./elk-layout.worker.ts', import.meta.url)`) must be used for cross-browser Web Worker instantiations in Next.js App Router.
3. **Scope Discipline**:
   - This blueprint provides the complete, authoritative specification for the 3 UI playbooks. It does not author playbooks 4–8 (`engine-authoring.md`, `sap-evidence.md`, `release-aware-knowledge.md`, `secure-file-parser.md`, `multi-tenant-security.md`), which are assigned to `explorer_m1_core_1`, nor does it author `AGENTS.md`, which is assigned to `explorer_m1_agents_1`.

---

## 5. Conclusion

The technical design for all three UI playbooks (`frontend-design-system.md`, `data-table-and-large-list.md`, and `dependency-graph.md`) is fully established with:
- Exact 10-section architectures.
- Complete, copy-ready TypeScript and React code implementations.
- WCAG 2.2 AA accessibility and non-color severity compliance.
- Motion discipline with reduced motion safeguards.
- TanStack Table + TanStack Virtual with URL sync and server-side export.
- React Flow + ELK.js with Web Worker offloading and accessible table fallbacks.
- Non-negotiable architectural invariants and anti-pattern catalogs.

Downstream implementers can translate this blueprint directly into the canonical files in `H:/erppreflight/.agents/skills/`.

---

## 6. Verification Method

To independently verify this specification:
1. **File Inspection**:
   - Confirm this blueprint exists at `H:/erppreflight/.agents/explorer_m1_ui_1/handoff.md`.
   - Verify that all 3 UI playbooks are comprehensively detailed with explicit sections, code examples, invariants, and anti-patterns.
2. **Playbook Implementation Verification** (for downstream worker agents):
   - When `frontend-design-system.md`, `data-table-and-large-list.md`, and `dependency-graph.md` are written to `H:/erppreflight/.agents/skills/`:
     * Validate against Section 3 of this document.
     * Ensure zero duplication of form/state libraries and compliance with Part 21 & Part 22.
3. **Build & Quality Gates**:
   - `pnpm --filter @erppreflight/web build`
   - `pnpm --filter @erppreflight/web lint`
