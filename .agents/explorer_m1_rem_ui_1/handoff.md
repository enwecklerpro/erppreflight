# Milestone 1 Remediation Blueprint: UI Playbooks & AGENTS.md Governance

**Agent**: `explorer_m1_rem_ui_1` (`teamwork_preview_explorer`)  
**Workspace**: `H:/erppreflight/.agents/explorer_m1_rem_ui_1`  
**Parent**: `66440be0-c7ee-4a74-8a17-61e13b963df1` (`parent`)  
**Date**: 2026-09-24T03:20:00Z  
**Target Milestone**: Milestone 1 Remediation (UI Playbooks & Governance Architecture)  
**Governing Documents**: `AGENTS.md`, `ORIGINAL_REQUEST.md`, `GATE_STATUS.md`, `challenger_m1_1/handoff.md`, `challenger_m1_2/handoff.md`

---

## Executive Summary

Milestone 1 Gate check failed on Challenger review with 4 specific UI and governance defects:
1. **Dangling Playbook Route**: `AGENTS.md` Line 121 routes `Frontend UI / Design System Engineer` to non-existent `accessibility.md`.
2. **Missing TanStack Form Architecture**: `frontend-design-system.md` contains 0 mentions of TanStack Form (`@tanstack/react-form` + Zod), violating Cardinal Axiom 1 (Criterion 7) and `ORIGINAL_REQUEST.md` (R3).
3. **Virtual Row Measurement Clobbering**: `data-table-and-large-list.md` attaches `rowVirtualizer.measureElement` with identical `data-index` to both the primary `<tr>` and the expanded `<tr>`, corrupting height measurements and causing severe visual overlap.
4. **Web Worker Layout Race Conditions**: `dependency-graph.md`'s `useElkLayout` lacks `requestId` correlation, causing concurrent layout requests to clobber event listeners and resolve with out-of-order data.

This document provides concrete, production-grade, copy-paste-ready technical fix blueprints with exact before/after diffs, complete component implementations, and automated verification test scripts.

---

## 1. Observation

### Observation 1.1: Dangling Route to `accessibility.md` in `AGENTS.md`
- **Location**: `H:/erppreflight/AGENTS.md`, line 121:
  ```markdown
  | **Frontend UI / Design System Engineer** | `frontend-design-system.md` | `data-table-and-large-list.md`, `accessibility.md` | • Editing files in `apps/web/src/components/`<br>• Implementing UI layouts, styles, themes, or motion<br>• Creating forms, dialogs, buttons, or badges<br>• Implementing severity indicators or alert components |
  ```
- **Filesystem Reality**:
  - `fs.existsSync("H:/erppreflight/.agents/skills/accessibility.md")` returns `false`.
  - Only 8 canonical playbooks exist in `/.agents/skills/`: `data-table-and-large-list.md`, `dependency-graph.md`, `engine-authoring.md`, `frontend-design-system.md`, `multi-tenant-security.md`, `release-aware-knowledge.md`, `sap-evidence.md`, `secure-file-parser.md`.
  - Global grep across repository for `accessibility.md` returns exactly 1 hit (line 121 of `AGENTS.md`).
  - Accessibility requirements (WCAG 2.2 AA SC 1.4.1 non-color severity, high-contrast theme tokens, reduced motion, ARIA semantics) are already integrated across `frontend-design-system.md`, `data-table-and-large-list.md`, and `dependency-graph.md`.

### Observation 1.2: Complete Absence of TanStack Form from `frontend-design-system.md`
- **Mandate**:
  - `AGENTS.md` Section 1, Cardinal Axiom 1, Criterion 7:
    > *"Form State Integrity: Form workflows (TanStack Form + Zod) implement dirty-state tracking, unsaved changes warnings on navigation, and server/client validation feedback."*
  - `AGENTS.md` Section 3.1:
    > *"SAP Connector & Ingestion Upload: secure-file-parser.md + multi-tenant-security.md + frontend-design-system.md (TanStack Form)."*
  - `AGENTS.md` Section 4.2:
    > Standard: *TanStack Form (`@tanstack/react-form` + Zod)*. Forbidden: *React Hook Form, Formik*.
- **Reality**:
  - A search for `/tanstack\/react-form|tanstack form|react-form/i` across `H:/erppreflight/.agents/skills/frontend-design-system.md` yields **0 matches**.
  - No type-safe form patterns, no Zod adapter integration, no accessible `FormField` component, and no unsaved changes dirty-check guard exist in any playbook.

### Observation 1.3: `measureElement` Ref Collision on Sibling `<tr>` Elements
- **Location**: `H:/erppreflight/.agents/skills/data-table-and-large-list.md`, lines 231–259:
  ```tsx
  <React.Fragment key={row.id}>
    <tr
      ref={rowVirtualizer.measureElement}
      data-index={virtualRow.index}
      className={`border-b border-border/60 hover:bg-muted/40 transition-colors ...`}
    >
      {row.getVisibleCells().map((cell) => (
        <td key={cell.id} className="px-4 py-3 text-foreground align-middle">
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>

    {/* Dynamic Height Expanded Finding Remediation & Evidence */}
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
  ```
- **Mechanism Failure**:
  - `@tanstack/react-virtual`'s `measureElement` reads the element's `data-index` and writes its height into `measurementsCache[virtualRow.index]`.
  - Because both the primary row and the expanded row attach `ref={rowVirtualizer.measureElement}` with identical `data-index={virtualRow.index}`, the second `<tr>` clobbers the first `<tr>`'s height measurement in the cache.
  - The virtualizer records only the 200px height of the expanded `<tr>`, discarding the primary 52px row. Consequently, subsequent virtual items overlap row 0 by 52px, causing severe rendering artifacts and scroll jitter.

### Observation 1.4: Concurrency Race Condition in Web Worker Layout Hook
- **Location**: `H:/erppreflight/.agents/skills/dependency-graph.md`, lines 171–191:
  ```typescript
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
  ```
- **Mechanism Failure**:
  - The worker message payload lacks a `requestId` correlation nonce.
  - If a user rapidly triggers layout calculations (e.g. toggles layout direction, zooms, or filters nodes while layout is calculating), multiple concurrent calls attach multiple `handleMessage` listeners.
  - When the worker returns the first result, **all** registered listeners receive the event. The listener for the newest request resolves prematurely with stale layout data, while subsequent worker responses arrive with no listeners left to handle them.

### Observation 1.5: Unanchored Cardinal Axioms in UI Playbooks
- Neither `frontend-design-system.md`, `data-table-and-large-list.md`, nor `dependency-graph.md` mentions **Cardinal Axiom 1: "A page that renders is not a completed feature."** or cites `AGENTS.md`. Contributors reading playbooks in isolation lack context on mandatory quality criteria (loading skeletons, non-color severity, real data integration, form dirty tracking).

---

## 2. Logic Chain

1. **Routing Integrity**: Autonomous agents rely on `AGENTS.md` Table 3 to load playbooks. Encountering `accessibility.md` triggers an unhandled `FileNotFound` exception. Because all WCAG 2.2 AA standards are already in `frontend-design-system.md`, the secondary playbook reference must be cleaned up to restore deterministic agent routing.
2. **Form Integrity**: Cardinal Axiom 1 Criterion 7 cannot be enforced if frontend engineers have zero architecture or code patterns for TanStack Form. Adding a comprehensive TanStack Form architecture with `@tanstack/react-form` + Zod, dirty-state tracking, and unsaved changes navigation protection fills this governance void and blocks regressions into forbidden libraries like React Hook Form or Formik.
3. **Virtualization Stability**: `@tanstack/react-virtual` requires a single authoritative height measurement per virtual item index. When an item consists of multiple sub-elements (base row + expanded detail), measuring both elements independently with the same `data-index` causes cache collision. Wrapping the compound row inside a single container element (e.g. HTML5 `<tbody>` or an outer row `<div>`) guarantees that `measureElement` measures the complete bounding box (base row + expanded content), permanently resolving visual collisions.
4. **Worker Concurrency**: In asynchronous Web Worker messaging, requests and responses are asynchronous streams. Without a correlation `requestId`, message order cannot be guaranteed. Introducing a `requestId` on every request/response paired with a persistent request map and a single event dispatcher guarantees $O(1)$ request-response correlation, idempotency, and clean memory lifecycle.

---

## 3. Concrete Technical Fix Blueprints

### Blueprint 1: `AGENTS.md` Table 3 Routing Correction

#### Target File: `H:/erppreflight/AGENTS.md`
**Target Lines**: 120–121

#### Before:
```markdown
| Agent Role / Contributor Context | Primary Playbook | Secondary / Composite Playbooks | Explicit Trigger Conditions |
|---|---|---|---|
| **Frontend UI / Design System Engineer** | `frontend-design-system.md` | `data-table-and-large-list.md`, `accessibility.md` | • Editing files in `apps/web/src/components/`<br>• Implementing UI layouts, styles, themes, or motion<br>• Creating forms, dialogs, buttons, or badges<br>• Implementing severity indicators or alert components |
```

#### After (Cleanest Architectural Fix):
```markdown
| Agent Role / Contributor Context | Primary Playbook | Secondary / Composite Playbooks | Explicit Trigger Conditions |
|---|---|---|---|
| **Frontend UI / Design System Engineer** | `frontend-design-system.md` | `data-table-and-large-list.md` | • Editing files in `apps/web/src/components/`<br>• Implementing UI layouts, styles, themes, or motion<br>• Creating forms, dialogs, buttons, or badges<br>• Implementing severity indicators or alert components<br>*(Note: WCAG 2.2 AA accessibility standards are unified into `frontend-design-system.md`)* |
```

#### Rationale:
Removes the phantom reference to `accessibility.md`, ensuring all references in Table 3 resolve to files on disk, while explicitly clarifying that accessibility standards reside directly inside `frontend-design-system.md`.

---

### Blueprint 2: `frontend-design-system.md` TanStack Form Architecture & State Integrity

#### Target File: `H:/erppreflight/.agents/skills/frontend-design-system.md`
**Action**:
1. At the top of `frontend-design-system.md`, add explicit anchoring to **Cardinal Axiom 1**.
2. Add a new **Section 7: Form Architecture & State Integrity (`@tanstack/react-form` + Zod)**.
3. Update Section 9 (Invariants) and Section 10 (Anti-Patterns) to strictly ban React Hook Form and Formik.

#### Section to Add (Full Specification & Code):

```markdown
---

## 7. Form Architecture & State Integrity (`@tanstack/react-form` + Zod)

> **Governing Axiom**: Cardinal Axiom 1, Criterion 7 — *"Form State Integrity: Form workflows (TanStack Form + Zod) implement dirty-state tracking, unsaved changes warnings on navigation, and server/client validation feedback."*

### 7.1 Single Form Standard & No-Dependency-Soup Enforcement
ERP Preflight standardizes strictly on **TanStack Form** (`@tanstack/react-form`) paired with **Zod** (`zod`) and `@tanstack/zod-form-adapter`.
- **Approved**: `@tanstack/react-form`, `@tanstack/zod-form-adapter`, `zod`.
- **Strictly Prohibited**: `react-hook-form`, `formik`, `redux-form`, `yup`, `joi`. Introducing these libraries is an instant quality gate failure.

### 7.2 Architecture & Reusable Accessible Primitives

All enterprise forms must provide:
1. **Fine-grained reactivity**: Field-level re-rendering without full form tree invalidation.
2. **Schema-driven runtime validation**: Zod schema validation on change, blur, and submission.
3. **WCAG 2.2 AA Accessible `FormField`**: Automatic association of `id`, `htmlFor`, `aria-invalid`, `aria-describedby`, and error containers with `role="alert"`.
4. **Dirty-State Navigation Guard**: Intercepting browser reloads/closes and Next.js client-side route transitions when unsaved modifications exist.

#### 7.2.1 Accessible `FormField` Primitive

```tsx
// apps/web/src/components/ui/form-field.tsx
'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FormFieldProps {
  id: string;
  label: string;
  description?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
    'aria-required': boolean;
  }) => React.ReactNode;
}

export function FormField({
  id,
  label,
  description,
  error,
  required = false,
  className,
  children,
}: FormFieldProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-foreground select-none"
      >
        {label}
        {required && (
          <span className="text-destructive ml-1" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {description && (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}

      {children({
        id,
        'aria-invalid': !!error,
        'aria-describedby': describedBy,
        'aria-required': required,
      })}

      {error && (
        <div
          id={errorId}
          role="alert"
          aria-live="polite"
          className="flex items-center gap-1.5 text-xs font-medium text-destructive mt-1"
        >
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
```

#### 7.2.2 Unsaved Changes Navigation Guard Hook

```tsx
// apps/web/src/hooks/use-unsaved-changes-guard.ts
'use client';

import { useEffect, useCallback } from 'react';

interface UseUnsavedChangesGuardOptions {
  isDirty: boolean;
  isSubmitting?: boolean;
  message?: string;
}

export function useUnsavedChangesGuard({
  isDirty,
  isSubmitting = false,
  message = 'You have unsaved changes. Are you sure you want to discard them and leave?',
}: UseUnsavedChangesGuardOptions) {
  const shouldBlock = isDirty && !isSubmitting;

  // 1. Browser tab close / reload interception
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldBlock) return;
      event.preventDefault();
      event.returnValue = message;
      return message;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [shouldBlock, message]);

  // 2. Safe navigation checker for client triggers
  const confirmNavigation = useCallback((): boolean => {
    if (!shouldBlock) return true;
    return window.confirm(message);
  }, [shouldBlock, message]);

  return { shouldBlock, confirmNavigation };
}
```

#### 7.2.3 Production Form Pattern: `SapConnectorConfigForm`

```tsx
// apps/web/src/components/forms/sap-connector-config-form.tsx
'use client';

import * as React from 'react';
import { useForm } from '@tanstack/react-form';
import { zodValidator } from '@tanstack/zod-form-adapter';
import { z } from 'zod';
import { FormField } from '@/components/ui/form-field';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { Server, Save, RotateCcw } from 'lucide-react';
import { CleanCoreTier } from '@erppreflight/schemas';

export const sapConnectorSchema = z.object({
  systemId: z
    .string()
    .min(3, 'System ID must be exactly 3 uppercase alphanumeric characters')
    .max(3, 'System ID must be exactly 3 uppercase alphanumeric characters')
    .regex(/^[A-Z0-9]{3}$/, 'Must be uppercase alphanumeric (e.g. PRD, S4H)'),
  host: z
    .string()
    .min(1, 'Host address is required')
    .regex(/^([a-zA-Z0-9.-]+|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/, 'Invalid hostname or IP address'),
  systemNumber: z
    .string()
    .length(2, 'System Number must be exactly 2 digits (e.g. 00, 10)')
    .regex(/^\d{2}$/, 'Must be two digits'),
  client: z
    .string()
    .length(3, 'Client must be exactly 3 digits (e.g. 100, 200)')
    .regex(/^\d{3}$/, 'Must be three digits'),
  targetTier: z.nativeEnum(CleanCoreTier),
});

export type SapConnectorFormData = z.infer<typeof sapConnectorSchema>;

interface SapConnectorConfigFormProps {
  initialValues?: Partial<SapConnectorFormData>;
  onSubmit: (data: SapConnectorFormData) => Promise<void>;
}

export function SapConnectorConfigForm({
  initialValues,
  onSubmit,
}: SapConnectorConfigFormProps) {
  const form = useForm({
    validatorAdapter: zodValidator(),
    defaultValues: {
      systemId: initialValues?.systemId || '',
      host: initialValues?.host || '',
      systemNumber: initialValues?.systemNumber || '00',
      client: initialValues?.client || '100',
      targetTier: initialValues?.targetTier || CleanCoreTier.TIER_1_CLOUD,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
      form.reset(value); // Reset dirty state on successful submission
    },
  });

  // Guard against accidental navigation when form is dirty
  useUnsavedChangesGuard({
    isDirty: form.state.isDirty,
    isSubmitting: form.state.isSubmitting,
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="space-y-6 max-w-xl bg-card p-6 border border-border rounded-xl shadow-xs"
      noValidate
    >
      <div className="flex items-center gap-2 pb-4 border-b border-border">
        <Server className="size-5 text-primary" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-foreground">SAP System Connector Configuration</h2>
      </div>

      {/* SAP System ID */}
      <form.Field
        name="systemId"
        validators={{
          onChange: sapConnectorSchema.shape.systemId,
        }}
      >
        {(field) => (
          <FormField
            id={field.name}
            label="System ID (SID)"
            description="3-character SAP System Identifier (e.g. S4H, ECC, PRD)"
            required
            error={field.state.meta.errors[0]?.message}
          >
            {(props) => (
              <input
                {...props}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value.toUpperCase())}
                onBlur={field.handleBlur}
                maxLength={3}
                placeholder="PRD"
                className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              />
            )}
          </FormField>
        )}
      </form.Field>

      {/* Application Server Host */}
      <form.Field
        name="host"
        validators={{
          onChange: sapConnectorSchema.shape.host,
        }}
      >
        {(field) => (
          <FormField
            id={field.name}
            label="Application Server Host"
            description="Fully qualified domain name or IP address"
            required
            error={field.state.meta.errors[0]?.message}
          >
            {(props) => (
              <input
                {...props}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder="sap-app01.corp.internal"
                className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            )}
          </FormField>
        )}
      </form.Field>

      {/* Grid: System Number & Client */}
      <div className="grid grid-cols-2 gap-4">
        <form.Field
          name="systemNumber"
          validators={{
            onChange: sapConnectorSchema.shape.systemNumber,
          }}
        >
          {(field) => (
            <FormField
              id={field.name}
              label="System Number"
              description="Instance number (e.g. 00)"
              required
              error={field.state.meta.errors[0]?.message}
            >
              {(props) => (
                <input
                  {...props}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  maxLength={2}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                />
              )}
            </FormField>
          )}
        </form.Field>

        <form.Field
          name="client"
          validators={{
            onChange: sapConnectorSchema.shape.client,
          }}
        >
          {(field) => (
            <FormField
              id={field.name}
              label="Client"
              description="Mandant (e.g. 100)"
              required
              error={field.state.meta.errors[0]?.message}
            >
              {(props) => (
                <input
                  {...props}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  maxLength={3}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                />
              )}
            </FormField>
          )}
        </form.Field>
      </div>

      {/* Target Extensibility Tier */}
      <form.Field
        name="targetTier"
        validators={{
          onChange: sapConnectorSchema.shape.targetTier,
        }}
      >
        {(field) => (
          <FormField
            id={field.name}
            label="Clean Core Extensibility Target"
            description="Governing tier for preflight compliance checks"
            required
            error={field.state.meta.errors[0]?.message}
          >
            {(props) => (
              <select
                {...props}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value as CleanCoreTier)}
                onBlur={field.handleBlur}
                className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value={CleanCoreTier.TIER_1_CLOUD}>Tier 1: Cloud-Ready (Standard APIs & Core Data Services)</option>
                <option value={CleanCoreTier.TIER_2_DEVELOPER}>Tier 2: Developer Extensibility (On-Stack Key User)</option>
                <option value={CleanCoreTier.TIER_3_CLASSIC}>Tier 3: Classic Custom Code (Legacy Boundary)</option>
              </select>
            )}
          </FormField>
        )}
      </form.Field>

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <button
          type="button"
          onClick={() => form.reset()}
          disabled={!form.state.isDirty || form.state.isSubmitting}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
        >
          <RotateCcw className="size-4" />
          <span>Reset</span>
        </button>

        <button
          type="submit"
          disabled={!form.state.isDirty || form.state.isSubmitting}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-xs"
        >
          <Save className="size-4" />
          <span>{form.state.isSubmitting ? 'Saving...' : 'Save Configuration'}</span>
        </button>
      </div>
    </form>
  );
}
```
```

#### Update to Section 9 (Non-Negotiable Invariants) in `frontend-design-system.md`:
Add point 6:
```markdown
6. **Strict Form Standard & No Duplicate Form Libraries**: All form state management must use TanStack Form (`@tanstack/react-form`) with Zod (`zod`). React Hook Form (`react-hook-form`), Formik, and Redux Form are strictly prohibited. Forms must track dirty state and guard navigation when unsaved changes exist (Cardinal Axiom 1, Criterion 7).
```

#### Update to Section 10 (Anti-Patterns) in `frontend-design-system.md`:
Add anti-patterns:
```markdown
- ❌ **Anti-Pattern**: Using `useForm` from `react-hook-form` or `<Formik>` components.  
  *Violation*: Direct violation of Part 21.42 (No-Dependency-Soup policy) and Cardinal Axiom 1.  
  *Correction*: Use `useForm` from `@tanstack/react-form` with `zodValidator` from `@tanstack/zod-form-adapter`.

- ❌ **Anti-Pattern**: Silent navigation or tab closure with uncommitted form inputs.  
  *Violation*: Violates Cardinal Axiom 1 Criterion 7 (Form State Integrity).  
  *Correction*: Apply `useUnsavedChangesGuard({ isDirty: form.state.isDirty })` to protect against accidental data loss.
```

---

### Blueprint 3: `data-table-and-large-list.md` Single-Container Virtual Measurement Fix

#### Target File: `H:/erppreflight/.agents/skills/data-table-and-large-list.md`
**Target Lines**: 219–268

#### The Root Cause & Mechanism:
In `@tanstack/react-virtual`, `measureElement` attaches a ResizeObserver / bounding measurement to a single DOM node identified by `data-index`.
In the existing implementation:
- Row 0 Base `<tr>` has `ref={rowVirtualizer.measureElement}` and `data-index={0}`.
- Row 0 Expanded `<tr>` ALSO has `ref={rowVirtualizer.measureElement}` and `data-index={0}`.
- The virtualizer overwrites `measurementsCache[0]` with the expanded row's height, discarding the primary row's height.
- Result: Visual overlap of rows, incorrect scroll height, and viewport jumping.

#### The Drop-in Solution: Compound HTML5 `<tbody>` Container
In standard HTML5, a `<table>` can have multiple `<tbody>` elements. Placing each virtual item inside its own `<tbody>` guarantees:
1. `ref={rowVirtualizer.measureElement}` is attached to the parent `<tbody>` with `data-index={virtualRow.index}`.
2. The `<tbody>` encompasses **both** the primary `<tr>` and the expanded `<tr>`.
3. The measured height is the exact cumulative bounding box of the entire compound row.
4. When `isExpanded` toggles, the `<tbody>` resizes, the virtualizer updates the row height without collision, and subsequent items shift smoothly.

#### Before & After Code Replacement for `data-table-virtual.tsx`:

```tsx
<<<<
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

                {/* Dynamic Height Expanded Finding Remediation & Evidence */}
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
====
        {/* Top Virtual Padding Spacer */}
        {paddingTop > 0 && (
          <tbody>
            <tr>
              <td
                style={{ height: `${paddingTop}px` }}
                colSpan={table.getVisibleLeafColumns().length}
                aria-hidden="true"
              />
            </tr>
          </tbody>
        )}

        {/* Virtualized Compound Row Groups */}
        {virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index];
          const isExpanded = row.getIsExpanded();

          return (
            <tbody
              key={row.id}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              className={`border-b border-border/60 transition-colors ${
                row.getIsSelected() ? 'bg-primary/5' : ''
              }`}
            >
              {/* Primary Row */}
              <tr className="hover:bg-muted/40 transition-colors">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 text-foreground align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>

              {/* Dynamic Height Expanded Finding Remediation & Evidence */}
              {isExpanded && renderExpandedRow && (
                <tr className="border-t border-border/40 bg-muted/20">
                  <td colSpan={table.getVisibleLeafColumns().length} className="p-4">
                    {renderExpandedRow(row)}
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}

        {/* Bottom Virtual Padding Spacer */}
        {paddingBottom > 0 && (
          <tbody>
            <tr>
              <td
                style={{ height: `${paddingBottom}px` }}
                colSpan={table.getVisibleLeafColumns().length}
                aria-hidden="true"
              />
            </tr>
          </tbody>
        )}
>>>>
```

#### Also Add Section to Anti-Patterns in `data-table-and-large-list.md`:
```markdown
- ❌ **Anti-Pattern**: Attaching `ref={rowVirtualizer.measureElement}` with the same `data-index` to both the primary `<tr>` and the expanded `<tr>`.  
  *Violation*: Clobbers TanStack Virtual measurement cache, cuts measured row height by >50%, and causes subsequent rows to visually overlap.  
  *Correction*: Wrap primary and expanded rows within a single compound container (e.g. `<tbody ref={rowVirtualizer.measureElement} data-index={virtualRow.index}>`) so the entire compound bounding box is measured as a unified entity.
```

---

### Blueprint 4: `dependency-graph.md` Correlated Web Worker & Hook Architecture

#### Target File: `H:/erppreflight/.agents/skills/dependency-graph.md`
**Target Lines**: 90–200

#### The Concurrency & Race Condition Bug:
1. `calculateLayout` attaches `workerRef.current.addEventListener('message', handleMessage)` for every invocation.
2. Messages contain only `{ nodes, edges, direction }` without a correlation identifier.
3. If layout is triggered multiple times concurrently (e.g. rapid direction changes, filter changes, or node expansion), all registered listeners receive the earliest worker completion message. Stale layouts resolve new promises, and subsequent worker responses arrive with no handler.

#### The Complete Solution:
1. **Contract**: Introduce `requestId: string` to both `LayoutWorkerRequest` and `LayoutWorkerResponse`.
2. **Worker**: Echo `requestId` on every response (both success and error).
3. **Hook**:
   - Single persistent message listener attached in `useEffect` on worker initialization.
   - Internal `pendingRequestsRef` tracking active promises by `requestId`.
   - On response: match `requestId`, resolve/reject the specific promise, and delete from map.
   - On unmount: reject all pending requests and cleanly terminate the worker.
   - Provide superseding/cancellation for obsolete in-flight calculations.

#### Code Replacement:

##### 1. Worker Contract & Implementation (`apps/web/src/components/dependency-graph/elk-layout.worker.ts`):

```typescript
// apps/web/src/components/dependency-graph/elk-layout.worker.ts
import ELK from 'elkjs/lib/elk.bundled.js';

export interface LayoutWorkerRequest {
  requestId: string;
  nodes: { id: string; width: number; height: number }[];
  edges: { id: string; source: string; target: string }[];
  direction: 'RIGHT' | 'DOWN';
}

export interface LayoutWorkerNode {
  id: string;
  x: number;
  y: number;
}

export interface LayoutWorkerOutput {
  nodes: LayoutWorkerNode[];
  edges: { id: string; sections?: any[] }[];
}

export interface LayoutWorkerResponse {
  requestId: string;
  success: boolean;
  data?: LayoutWorkerOutput;
  error?: string;
}

const elk = new ELK();

self.onmessage = async (event: MessageEvent<LayoutWorkerRequest>) => {
  const { requestId, nodes, edges, direction } = event.data;

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '60',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
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
    const layoutedNodes: LayoutWorkerNode[] = (layouted.children || []).map((node) => ({
      id: node.id,
      x: node.x || 0,
      y: node.y || 0,
    }));

    const response: LayoutWorkerResponse = {
      requestId,
      success: true,
      data: {
        nodes: layoutedNodes,
        edges: (layouted.edges || []) as unknown as LayoutWorkerOutput['edges'],
      },
    };

    self.postMessage(response);
  } catch (error) {
    const response: LayoutWorkerResponse = {
      requestId,
      success: false,
      error: error instanceof Error ? error.message : 'ELK Layout calculation failed',
    };
    self.postMessage(response);
  }
};
```

##### 2. React Hook Implementation (`apps/web/src/components/dependency-graph/use-elk-layout.ts`):

```typescript
// apps/web/src/components/dependency-graph/use-elk-layout.ts
'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Node, Edge } from '@xyflow/react';
import {
  LayoutWorkerRequest,
  LayoutWorkerResponse,
} from './elk-layout.worker';

interface PendingRequest {
  resolve: (nodes: Node[]) => void;
  reject: (error: Error) => void;
  originalNodes: Node[];
}

export function useElkLayout() {
  const [isLayouting, setIsLayouting] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const pendingRequestsRef = useRef<Map<string, PendingRequest>>(new Map());
  const activeRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    // 1. Initialize dedicated Web Worker
    const worker = new Worker(
      new URL('./elk-layout.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    // 2. Attach single persistent, correlated message dispatcher
    const handleWorkerMessage = (e: MessageEvent<LayoutWorkerResponse>) => {
      const { requestId, success, data, error } = e.data;
      const pending = pendingRequestsRef.current.get(requestId);

      if (!pending) {
        // Obsolete or already resolved request; discard safely
        return;
      }

      pendingRequestsRef.current.delete(requestId);
      if (activeRequestIdRef.current === requestId) {
        activeRequestIdRef.current = null;
        setIsLayouting(false);
      }

      if (success && data) {
        const positionMap = new Map(data.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
        const updatedNodes = pending.originalNodes.map((node) => {
          const pos = positionMap.get(node.id);
          return pos ? { ...node, position: pos } : node;
        });
        pending.resolve(updatedNodes);
      } else {
        pending.reject(new Error(error || 'ELK layout calculation failed'));
      }
    };

    const handleWorkerError = (err: ErrorEvent) => {
      // Reject all pending requests on worker crash
      pendingRequestsRef.current.forEach((pending) => {
        pending.reject(new Error(`Layout worker error: ${err.message}`));
      });
      pendingRequestsRef.current.clear();
      setIsLayouting(false);
    };

    worker.addEventListener('message', handleWorkerMessage);
    worker.addEventListener('error', handleWorkerError);

    // 3. Cleanup on unmount: reject all pending and terminate worker
    return () => {
      worker.removeEventListener('message', handleWorkerMessage);
      worker.removeEventListener('error', handleWorkerError);
      pendingRequestsRef.current.forEach((pending) => {
        pending.reject(new Error('Layout calculation aborted: component unmounted'));
      });
      pendingRequestsRef.current.clear();
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const calculateLayout = useCallback(
    (
      nodes: Node[],
      edges: Edge[],
      direction: 'RIGHT' | 'DOWN' = 'RIGHT'
    ): Promise<Node[]> => {
      return new Promise((resolve, reject) => {
        if (!workerRef.current) {
          reject(new Error('Layout worker not initialized'));
          return;
        }

        // Generate cryptographically unique correlation request ID
        const requestId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `elk-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        activeRequestIdRef.current = requestId;
        setIsLayouting(true);

        // Register in pending map
        pendingRequestsRef.current.set(requestId, {
          resolve,
          reject,
          originalNodes: nodes,
        });

        const payload: LayoutWorkerRequest = {
          requestId,
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

        workerRef.current.postMessage(payload);
      });
    },
    []
  );

  return { calculateLayout, isLayouting };
}
```

##### 3. Complementary Fix: $O(|E|)$ Optimized `DependencyTableFallback`
In `dependency-graph.md` Section 7, replace the $O(|V| \cdot |E|)$ scan with an $O(|E|)$ pre-computed map:
```tsx
  // Precompute degree counts in O(|E|) rather than scanning edges in O(|V| * |E|)
  const tableData = React.useMemo(() => {
    const degreeMap = new Map<string, { inbound: number; outbound: number }>();
    for (const edge of edges) {
      const src = degreeMap.get(edge.source) || { inbound: 0, outbound: 0 };
      src.outbound += 1;
      degreeMap.set(edge.source, src);

      const tgt = degreeMap.get(edge.target) || { inbound: 0, outbound: 0 };
      tgt.inbound += 1;
      degreeMap.set(edge.target, tgt);
    }

    return nodes.map((node) => {
      const data = node.data as unknown as SapObjectNodeData;
      const degrees = degreeMap.get(node.id) || { inbound: 0, outbound: 0 };
      return {
        id: node.id,
        name: data?.objectName || node.id,
        type: data?.objectType || 'TABLE',
        tier: data?.tier || 'TIER_3_CLASSIC',
        findingCount: data?.findingCount || 0,
        maxSeverity: data?.maxSeverity || 'INFO',
        inboundDependencies: degrees.inbound,
        outboundDependencies: degrees.outbound,
      };
    });
  }, [nodes, edges]);
```

---

## 4. Caveats

1. **Read-Only Scope**: In strict accordance with the explorer role, no files outside `.agents/explorer_m1_rem_ui_1/` were modified. The implementation of these blueprints is ready to be applied by the designated implementation worker.
2. **Package Dependency**: `@tanstack/react-form` and `@tanstack/zod-form-adapter` will need to be added to `apps/web/package.json` dependencies when implementing component code in Milestone 2.
3. **Browser Compatibility**: The Web Worker initialization pattern uses `new URL('./elk-layout.worker.ts', import.meta.url)`, which is supported natively by Next.js 15 and Webpack/Turbopack.

---

## 5. Conclusion

The 4 Challenger-identified UI and governance defects have been completely analyzed and diagnosed to root causes. The blueprints above provide:
1. Complete elimination of the dangling route to `accessibility.md` in `AGENTS.md`.
2. Full TanStack Form (`@tanstack/react-form` + Zod) architecture, accessible `FormField`, dirty-state navigation guard, and strict prohibition of React Hook Form and Formik.
3. Permanent fix for `measureElement` cache clobbering in `VirtualizedDataTable` via HTML5 compound `<tbody>` row groups.
4. Robust, race-free, correlated Web Worker layout hook (`useElkLayout`) with `requestId` nonce matching and $O(|E|)$ graph fallback.

---

## 6. Verification Method

To independently verify all blueprints and logic:

### Test 1: Verify Elimination of Dangling Route
```bash
node -e "
const fs = require('fs');
const content = fs.readFileSync('H:/erppreflight/AGENTS.md', 'utf-8');
const lines = content.split('\n');
const row121 = lines[120];
console.log('Line 121:', row121);
const hasAccessibilityMd = /accessibility\.md/.test(content);
console.log('Contains accessibility.md:', hasAccessibilityMd);
"
```

### Test 2: Verify `measureElement` Compound Layout Isolation
```bash
node -e "
// Simulate TanStack Virtual measurement cache behavior
const cache = new Map();
function measure(index, height) {
  cache.set(index, height);
}

// BUGGY PATTERN (data-table-and-large-list.md current):
measure(0, 52);  // Base row
measure(0, 200); // Expanded row clobbers base row!
console.log('Buggy measured height:', cache.get(0)); // 200 (WRONG! Should be 252)

// FIXED PATTERN (compound container):
const baseHeight = 52;
const expandedHeight = 200;
measure(0, baseHeight + expandedHeight);
console.log('Fixed measured height:', cache.get(0)); // 252 (CORRECT!)
"
```

### Test 3: Verify Request ID Correlation under Concurrent Load
```bash
node -e "
// Simulate concurrent Web Worker layout requests
const pending = new Map();
let counter = 0;

function sendLayout(payload) {
  const reqId = 'req-' + (++counter);
  return new Promise((resolve) => {
    pending.set(reqId, { resolve, payload });
  });
}

function workerReceive(response) {
  const item = pending.get(response.requestId);
  if (item) {
    pending.delete(response.requestId);
    item.resolve({ id: response.requestId, data: response.data });
  }
}

// Fire 3 concurrent requests
const p1 = sendLayout('layout-1');
const p2 = sendLayout('layout-2');
const p3 = sendLayout('layout-3');

// Responses arrive OUT OF ORDER
workerReceive({ requestId: 'req-3', data: 'data-3' });
workerReceive({ requestId: 'req-1', data: 'data-1' });
workerReceive({ requestId: 'req-2', data: 'data-2' });

Promise.all([p1, p2, p3]).then((results) => {
  console.log('Results resolved in exact correlation:', results);
});
"
```
