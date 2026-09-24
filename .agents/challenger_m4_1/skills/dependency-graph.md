# ERP Preflight Engineering Playbook: Interactive Dependency Graph & Impact Visualization

> **Playbook Identifier**: `dependency-graph`  
> **Authority**: Binding architectural playbook for all structural dependency graphs, transport lineage, custom field flows, and impact visualization.  
> **Governing Standards**: React Flow (`@xyflow/react` v12), ELK.js layout engine, Next.js 15+ App Router, WCAG 2.2 AA.  
> **Anchored Cardinal Axiom**: **Cardinal Axiom 1: *"A page that renders is not a completed feature."*** (Defined in `AGENTS.md` Section 1)  
> **Applicable Trigger**: Creating or modifying dependency viewers, impact analyzers, custom field propagation graphs, transport analyzers, API relationship diagrams, or MFS causal flow trees.

---

## 1. Metadata & Trigger Definition

- **Canonical File Path**: `/.agents/skills/dependency-graph.md`
- **Domain Scope**: Graph canvas rendering, deterministic hierarchical node positioning, Web Worker layout offloading, canonical backend entity IDs, custom node anatomy, node inspector drawers, accessible table fallbacks, and dynamic code-splitting.
- **Trigger Conditions**:
  - Creating or updating visual relationship graphs in `apps/web/src/components/dependency-graph/` or feature pages.
  - Using `@xyflow/react` or `elkjs` for node-edge diagrams.
  - Visualizing SAP object coupling (e.g. Table to CDS view to OData service to Fiori Elements app).
  - Visualizing transport request dependency chains (`DEVK900123 -> DEVK900124`).
  - Rendering MFS automated warehouse causal trees or What-If migration impact graphs.

### 1.1 Cardinal Axiom 1 Anchoring: Non-Blocking, Accessible Visualization
This playbook operationalizes **Cardinal Axiom 1** for complex relationship graphs. A graphical canvas alone is an incomplete prototype. A graph feature is complete **only** when:
- Heavy graph bundles (`@xyflow/react`, `elkjs`) are dynamically code-split with layout-preserving loading skeletons.
- Graph layout computation is offloaded to a Web Worker to ensure zero UI thread frame drops.
- Canvas nodes and inspectors display accessible, non-color severity indicators.
- A synchronized, keyboard-accessible table fallback (`DependencyTableFallback`) is provided to guarantee full WCAG 2.2 AA compliance for keyboard and screen-reader users.


---

## 2. Graph Canvas Architecture (`@xyflow/react` v12) & Dynamic Code-Splitting

### 2.1 Dynamic Loading Protocol
React Flow (`@xyflow/react`) and ELK.js (`elkjs`) are heavy client-side libraries (~300KB+ gzipped). They must be dynamically imported via Next.js `dynamic()` with `{ ssr: false }` to prevent SSR hydration mismatches and minimize the initial page bundle.

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

---

## 3. Deterministic Graph Layout via ELK.js & Web Worker Offloading

### 3.1 Web Worker Execution Requirement
Graphs with >200 nodes or >500 edges require substantial layout computation. Running ELK.js on the main thread causes UI frame drops and freezes user input. Offload ELK layout calculations to a dedicated Web Worker (`elk-layout.worker.ts`).

```typescript
// apps/web/src/components/dependency-graph/elk-layout.worker.ts
/// <reference lib="webworker" />

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

### 3.2 React Hook for Web Worker Layout

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

---

## 4. Canonical Backend Graph Identifiers (1:1 Entity Mapping)

### 4.1 ID Parity Standard
All node and edge identifiers must match backend domain keys exactly:
- **SAP Objects**: `R3TR_TABL_MARC`, `R3TR_CLAS_ZCL_INVOICE_FLOW`
- **Preflight Findings**: Finding UUID string (e.g. `123e4567-e89b-12d3-a456-426614174000`)
- **Transport Requests**: Transport key (e.g. `DEVK900123`)
- **Edges**: Deterministic composite `${sourceId}->${targetId}`

---

## 5. Custom Node Anatomy (SAP Objects, Findings, Transports)

```tsx
// apps/web/src/components/dependency-graph/sap-object-node.tsx
'use client';

import * as React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Database, Code2, AlertTriangle } from 'lucide-react';
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

---

## 6. Selected Node Inspector Slide-Over & Interactive Filtering

### 6.1 Inspector Slide-Over
Selecting any node opens a contextual drawer displaying:
1. **Object Identity & Tier**: Full SAP canonical path, object type, Clean Core tier, and package.
2. **Coupling Metrics**: Complete list of inbound dependencies (callers) and outbound dependencies (callees) with one-click "Focus Subgraph" actions.
3. **Associated Findings**: All active preflight findings targeting this object with direct remediation links.
4. **Actions**: "Isolate Connected Component", "Run Impact Simulation", "Copy Object Identifier".

### 6.2 Canvas Toolbar Controls
- **Layout Direction**: Toggle between `Left-to-Right` and `Top-to-Bottom`.
- **Tier Filters**: Checkbox toggles for `Tier 1 (Cloud)`, `Tier 2 (Developer)`, `Tier 3 (Classic)`.
- **Severity Highlight**: Highlight paths containing `BLOCKER` or `CRITICAL` findings.
- **Node Search**: Input field with auto-pan and zoom to matched node.
- **View Controls**: `Fit View`, `Reset Zoom`, and `Toggle Minimap`.

---

## 7. Accessible Synchronized Table Fallback (WCAG SC 1.1.1)

### 7.1 Non-Text Content Equivalence
In compliance with WCAG Success Criterion 1.1.1, a visual graph canvas cannot be the sole mechanism to inspect relationships. Every graph view must include an accessible tabular view accessible via a prominent toggle: `[ Graph View | Table View ]`.

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
        inbound: degrees.inbound,
        outbound: degrees.outbound,
        inboundDependencies: degrees.inbound,
        outboundDependencies: degrees.outbound,
        findingCount: data?.findingCount || 0,
        maxSeverity: data?.maxSeverity || 'INFO',
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

---

## 8. Non-Negotiable Invariants

1. **No Edge Business Logic**: Edge components must remain pure visual conduits. Severity calculations, Clean Core validations, or graph traversals must never execute inside node or edge render functions.
2. **Mandatory Accessible Fallback**: Every visual graph feature must provide a synchronized table fallback (`DependencyTableFallback`).
3. **Web Worker Layout**: ELK layouts exceeding 200 nodes must execute in a Web Worker to avoid freezing the browser main thread.
4. **Code-Splitting**: React Flow and ELK.js must be loaded dynamically with `ssr: false`.
5. **Canonical ID Matching**: Node and edge IDs must strictly match backend SAP object names, finding UUIDs, or transport keys.

### 8.1 Strictly Forbidden Competing Libraries (Part 21.42 & AGENTS.md §4.2)
Graph visualization must strictly adhere to the single-library standard:
- ❌ **Graph Canvas**: `cytoscape`, `vis-network`, `vis.js`, `mxgraph`, `d3-graphviz`, `gojs`, `jointjs` (Standard: `@xyflow/react` v12).
- ❌ **Graph Layout**: `dagre` (unmaintained), `d3-force` for primary structural layout, `viz.js` (Standard: `elkjs` via Web Worker).
- ❌ **Chart Frameworks in Nodes**: Embedding `chart.js` or `recharts` inside custom nodes (Standard: SVG primitives or modular `echarts`).
- ❌ **State Management**: Storing graph selection or expansion state in Redux (Standard: URL query parameters `?selectedNode=` and local component state).

---

## 9. Anti-Patterns & Corrective Implementations

- ❌ **Anti-Pattern**: Running `elk.layout()` synchronously on the React rendering thread for a 1,500-node graph.  
  *Violation*: Freezes the browser for 2–4 seconds and causes dropped animation frames.  
  *Correction*: Execute layout in `elk-layout.worker.ts` via the `useElkLayout` hook.

- ❌ **Anti-Pattern**: Calculating whether an edge represents a "Clean Core Violation" inside the SVG path drawing code.  
  *Violation*: Distributes business logic into UI presentation layers and breaks tabular export parity.  
  *Correction*: Compute compliance server-side and pass violation flags in edge metadata.

- ❌ **Anti-Pattern**: Offering only a visual canvas without a tabular view.  
  *Violation*: Fails WCAG 2.2 AA accessibility requirements for screen-reader and keyboard-only users.  
  *Correction*: Provide a dual-view toggle with `DependencyTableFallback`.
