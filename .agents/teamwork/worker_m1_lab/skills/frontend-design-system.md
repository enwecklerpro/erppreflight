# ERP Preflight Engineering Playbook: Frontend Design System & Component Architecture

> **Playbook Identifier**: `frontend-design-system`  
> **Authority**: Binding architectural playbook for `apps/web` and all UI package authoring.  
> **Governing Standards**: WCAG 2.2 AA, Next.js 15+ App Router, React 19, Tailwind CSS, shadcn/ui on Base UI primitives.  
> **Anchored Cardinal Axiom**: **Cardinal Axiom 1: *"A page that renders is not a completed feature."*** (Defined in `AGENTS.md` Section 1)  
> **Applicable Trigger**: Any frontend task, page implementation, component authoring, theme modification, CSS/styling change, or accessibility enhancement in `apps/web`.

---

## 1. Metadata & Trigger Definition

- **Canonical File Path**: `/.agents/skills/frontend-design-system.md`
- **Domain Scope**: User interface primitives, design tokens, responsive typography, visual severity encodings, motion constraints, command palettes, notification persistence, and lazy-loading boundaries.
- **Trigger Conditions**:
  - Authoring or modifying any React component in `apps/web/src/components/` or `apps/web/src/app/`.
  - Creating or modifying design tokens in `tailwind.config.ts` or `apps/web/src/app/globals.css`.
  - Designing visual status indicators, Clean Core tier badges, or finding severity badges.
  - Adding animations, micro-interactions, modal transitions, or slide-overs.
  - Configuring code-splitting for third-party canvas or editor libraries (e.g. Monaco, React Flow, ECharts).

### 1.1 Cardinal Axiom 1 Anchoring: UI & Feature Completeness
This playbook directly enforces **Cardinal Axiom 1** from `AGENTS.md` Section 1. A user interface that renders visual elements is an incomplete prototype. A frontend feature is considered complete **only** when all 7 criteria are met:
1. **Real Data & Server State**: Integrated with TanStack Query fetching from backend endpoints or typed mock contracts (via Orval). No hardcoded client-side dummy arrays.
2. **Runtime Schema Validation**: All external inputs, form submissions, and API payloads validated via Zod 4 schemas.
3. **Error Boundaries & Resilience**: Comprehensive contextual error states, query retry policies, and user-actionable retry triggers.
4. **Loading & Empty States**: Polished loading skeletons (matching exact content layout without layout shifts) and informative empty states with clear CTAs.
5. **Accessible Severity Representation**: Severity indicators (`BLOCKER`, `CRITICAL`, `MAJOR`, `MEDIUM`, `MINOR`, `LOW`, `INFO`) must **never** rely on color alone; they must pair color with textual badges and icons.
6. **Interaction & Motion Discipline**: WCAG 2.2 AA keyboard accessible, fully responsive across desktop/mobile, and compliant with `prefers-reduced-motion`.
7. **Form State Integrity**: Form workflows (TanStack Form + Zod) implement dirty-state tracking, unsaved changes warnings on navigation, and server/client validation feedback.


---

## 2. UI Stack & Component Primitive Architecture (Base UI + shadcn/ui)

### 2.1 Headless Primitive Policy & Zero-Duplication
ERP Preflight standardizes on **Base UI** (`@base-ui-components/react`) as the preferred headless primitive layer for new shadcn/ui components. To eliminate dependency soup and maintain a lean bundle footprint:
1. **Unified Abstraction Layer**: All UI primitives must be encapsulated inside `apps/web/src/components/ui/*`. Application code imports exclusively from `@/components/ui/*`, never directly from third-party primitive libraries.
2. **Encapsulation Helpers**: Every component utilizes `class-variance-authority` (cva), `clsx`, and `tailwind-merge` via the canonical `cn` utility.
3. **Migration Discipline**: Existing Radix UI primitives (`@radix-ui/react-*`) in `apps/web` must not be duplicated. Migrate components to Base UI only when Base UI provides equivalent or superior accessibility features.
4. **Strictly Prohibited Libraries**: Direct imports of `@chakra-ui`, `@mui/material`, `antd`, or `ark-ui` are strictly forbidden without an accepted Architecture Decision Record (ADR).

### 2.2 Canonical Class Name Utility

```typescript
// apps/web/src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

### 2.3 Base UI Primitive Wrapping Pattern

```tsx
// apps/web/src/components/ui/dialog.tsx
'use client';

import * as React from 'react';
import { Dialog as BaseDialog } from '@base-ui-components/react/dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogPortal = BaseDialog.Portal;
export const DialogClose = BaseDialog.Close;

export const DialogBackdrop = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Backdrop>
>(({ className, ...props }, ref) => (
  <BaseDialog.Backdrop
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/60 backdrop-blur-xs transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
      className
    )}
    {...props}
  />
));
DialogBackdrop.displayName = 'DialogBackdrop';

export const DialogPopup = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Popup>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogBackdrop />
    <BaseDialog.Popup
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-2xl transition-all duration-150 focus:outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0',
        className
      )}
      {...props}
    >
      {children}
      <BaseDialog.Close
        className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
        aria-label="Close"
      >
        <X className="size-4" />
      </BaseDialog.Close>
    </BaseDialog.Popup>
  </DialogPortal>
));
DialogPopup.displayName = 'DialogPopup';
```

---

## 3. Design Token Hierarchy & Dark/Light Mode Theme Architecture

### 3.1 CSS Custom Properties (`globals.css`)
Contrast ratios must strictly exceed **4.5:1** for standard body text and **3:1** for graphical elements, form borders, and large text across both light and dark themes.

```css
/* apps/web/src/app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
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
    --muted-foreground: #475569; /* Slate 600 - Contrast 5.1:1 on #f1f5f9 */
    --accent: #0284c7;
    --accent-foreground: #ffffff;
    --destructive: #b91c1c; /* Red 700 */
    --destructive-foreground: #ffffff;
    --border: #cbd5e1;
    --input: #cbd5e1;
    --ring: #1d4ed8;

    /* ERP Preflight Severity Tokens (Light Theme) */
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

    /* Clean Core Tier Tokens (Light Theme) */
    --tier-1-bg: #ecfdf5;
    --tier-1-border: #6ee7b7;
    --tier-1-text: #065f46;
    --tier-2-bg: #eff6ff;
    --tier-2-border: #93c5fd;
    --tier-2-text: #1e40af;
    --tier-3-bg: #fff1f2;
    --tier-3-border: #fda4af;
    --tier-3-text: #9f1239;
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

    /* ERP Preflight Severity Tokens (Dark Theme) */
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

    /* Clean Core Tier Tokens (Dark Theme) */
    --tier-1-bg: #022c22;
    --tier-1-border: #047857;
    --tier-1-text: #a7f3d0;
    --tier-2-bg: #172554;
    --tier-2-border: #1d4ed8;
    --tier-2-text: #bfdbfe;
    --tier-3-bg: #4c0519;
    --tier-3-border: #be123c;
    --tier-3-text: #fecdd3;
  }
}
```

---

## 4. Non-Color Severity Presentation Standard (WCAG 2.2 AA SC 1.4.1)

### 4.1 Triad Representation Requirement
In compliance with WCAG Success Criterion 1.4.1 (Use of Color), color must **never** be used as the sole visual means of conveying information, indicating an action, prompting a response, or distinguishing a visual element. Every severity and clean core indicator must provide three synchronized visual cues:
1. **Semantic Color**: Distinct background and border tokens.
2. **Distinct Icon**: Explicit Lucide icon representing severity weight.
3. **Explicit Text Label & ARIA Attribute**: Machine-readable text label and `aria-label`.

### 4.2 Production Implementation: `SeverityBadge`

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
  ShieldAlert,
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

---

## 5. Disciplined Motion Framework (`motion/react` + Reduced Motion)

### 5.1 Motion Restraint Rules
1. **Zero Decorative Motion**: Do not implement continuous rotations, bouncing cards, looping banners, or complex multi-stage landing page springs on dashboards.
2. **Intentional Feedback Only**: Motion is permitted exclusively for functional transitions: dialog enter/exit, sheet slide-overs, accordion expansions, and dynamic filter pill additions.
3. **Reduced Motion Compliance**: Always use `useReducedMotion()`. When `true`, disable translation/scale transforms and collapse transition durations to `<= 50ms`.

### 5.2 Accessible Modal Transition Component

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
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
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

---

## 6. Global Command Palette (`Cmd/Ctrl + K`) Architecture

### 6.1 Keyboard Navigation & Accessibility Standard
The command palette provides keyboard shortcuts for enterprise operators navigating projects, SAP objects, finding rule codes, and system runbooks:
- Traps focus within dialog when opened.
- Closes instantly upon pressing `Escape` or clicking the backdrop.
- Full arrow-key roving navigation with `Enter` triggering navigation.

```tsx
// apps/web/src/components/command-palette.tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search, Cpu, FolderGit2, AlertTriangle, Layers } from 'lucide-react';

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
          <div className="text-[10px] font-semibold uppercase text-muted-foreground px-3 py-1">
            Preflight Engines
          </div>
          <button
            onClick={() => { router.push('/engines/OPD_GUARD'); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg hover:bg-muted/80 text-foreground transition-colors text-left"
          >
            <Cpu className="size-4 text-primary" />
            <span>OPD Guard (Output Parameter Determination)</span>
          </button>
          <button
            onClick={() => { router.push('/engines/CLEAN_CORE_OBJECT_GUARD'); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg hover:bg-muted/80 text-foreground transition-colors text-left"
          >
            <Layers className="size-4 text-primary" />
            <span>Clean Core Object Guard</span>
          </button>
        </div>
      </div>
    </div>
  );
}
```

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

---

## 8. Toast Notification Rules vs Persistent UI States

### 8.1 Ephemeral Toasts
- **Definition**: Transient feedback confirming an asynchronous action that succeeded or was triggered.
- **Allowed Use Cases**: "Rule bundle published", "Finding link copied to clipboard", "Export generation started", "Filter view saved".
- **Dismissal**: Must auto-dismiss within 3 to 4 seconds and remain dismissible via keyboard.

### 8.2 Durable Alerts & Finding Surfaces
- **Definition**: Informational states critical to enterprise risk, preflight audit findings, or operational blockers.
- **Mandatory Durable UI**: Migration blockers (`BLOCKER`, `CRITICAL`), missing SAP evidence alerts, tenant authorization errors, and ingestion quarantine notifications **MUST NEVER** rely on toasts. They must render inside durable finding cards, evidence tables, or persistent page banners with unique IDs.

---

## 9. Heavy Component Code-Splitting Protocol

Libraries with large bundle weights must be lazily loaded via `next/dynamic` with `ssr: false`:
1. **Interactive Graph Canvases** (`@xyflow/react`, `elkjs`): ~300KB+ gzipped.
2. **Code Editors** (`@monaco-editor/react`): ~2MB bundle.
3. **Complex Visualizations** (`echarts`): ~400KB bundle.

```tsx
// apps/web/src/components/heavy-component-boundary.tsx
'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

export const LazyDependencyGraph = dynamic(
  () => import('@/components/dependency-graph/dependency-graph-canvas').then((m) => m.DependencyGraphCanvas),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[600px] w-full rounded-xl border border-border" />,
  }
);
```

---

## 10. Non-Negotiable Invariants

1. **No Mixed UI Primitives**: Never import Chakra UI, Ant Design, MUI, or Ark UI. Use Base UI for new components and encapsulate within `@/components/ui/*`.
2. **WCAG 2.2 AA Contrast**: Contrast ratios must meet or exceed 4.5:1 for standard text and 3:1 for graphical elements across both light and dark themes.
3. **Non-Color Severity Rule**: Severity or Clean Core tiers must never be indicated by color alone. Every badge, row, or marker must include color + icon + text label + ARIA label.
4. **Motion Restraint**: All CSS/Motion animations must respect `prefers-reduced-motion` and collapse durations to `<= 50ms`.
5. **No Ephemeral Risk Alerts**: Critical findings and migration blockers must never rely on ephemeral toast notifications.
6. **Strict Form Standard & No Duplicate Form Libraries**: All form state management must use TanStack Form (`@tanstack/react-form`) with Zod (`zod`). React Hook Form (`react-hook-form`), Formik, and Redux Form are strictly prohibited. Forms must track dirty state and guard navigation when unsaved changes exist (Cardinal Axiom 1, Criterion 7).

### 10.1 Strictly Forbidden Competing Libraries (Part 21.42 & AGENTS.md §4.2)
To prevent bundle bloat, state synchronization failures, and dependency conflicts, the following libraries are strictly prohibited in `apps/web`:
- ❌ **Form Management**: `react-hook-form`, `formik` (Standard: `@tanstack/react-form` + `zod`).
- ❌ **Client State Management**: `redux`, `@reduxjs/toolkit`, `mobx`, `recoil`, `jotai` (Standard: URL Search Params + React state / scoped Zustand).
- ❌ **Server State & Caching**: `swr`, `@reduxjs/toolkit/query`, `apollo-client` (Standard: `@tanstack/react-query`).
- ❌ **UI Primitives**: `@chakra-ui/*`, `@mui/*`, `antd`, `@ark-ui/*`, raw `@radix-ui/react-*` for new components (Standard: Base UI `@base-ui-components/react` + shadcn/ui).
- ❌ **Application Routing**: `@tanstack/react-router`, `tanstack/start` (Standard: Next.js 15 App Router).
- ❌ **Animation**: `gsap`, `animejs`, legacy uncurated `framer-motion` (Standard: `motion/react` with reduced-motion discipline).
- ❌ **Schema Validation**: `joi`, `yup`, `validator` (Standard: `zod` 4).

---

## 11. Anti-Patterns & Corrective Implementations

- ❌ **Anti-Pattern**: `<span className="bg-red-500 text-white rounded p-1">BLOCKER</span>`  
  *Violation*: Relies solely on color; lacks semantic token, icon, and ARIA label; fails dark mode contrast.  
  *Correction*: `<SeverityBadge severity="BLOCKER" />` using semantic CSS variables, icon, and accessible labels.

- ❌ **Anti-Pattern**: `<div style={{ animation: 'spin 1s infinite' }} />`  
  *Violation*: Continuous motion ignoring user's vestibular safety preferences.  
  *Correction*: Use static skeletons or minimal opacity fades gated by `useReducedMotion()`.

- ❌ **Anti-Pattern**: Importing `@xyflow/react` directly in a server-rendered page header without dynamic import.  
  *Violation*: Causes SSR hydration mismatch and inflates initial page bundle by >300KB.  
  *Correction*: Use `next/dynamic` with `{ ssr: false }` and a placeholder skeleton.

- ❌ **Anti-Pattern**: Using `useForm` from `react-hook-form` or `<Formik>` components.  
  *Violation*: Direct violation of Part 21.42 (No-Dependency-Soup policy) and Cardinal Axiom 1.  
  *Correction*: Use `useForm` from `@tanstack/react-form` with `zodValidator` from `@tanstack/zod-form-adapter`.

- ❌ **Anti-Pattern**: Silent navigation or tab closure with uncommitted form inputs.  
  *Violation*: Violates Cardinal Axiom 1 Criterion 7 (Form State Integrity).  
  *Correction*: Apply `useUnsavedChangesGuard({ isDirty: form.state.isDirty })` to protect against accidental data loss.

