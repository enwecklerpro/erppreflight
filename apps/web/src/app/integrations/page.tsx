'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Cable, Cpu, Handshake, ListChecks, ShieldCheck, Webhook } from 'lucide-react';
import { ConnectorsPanel } from '@/components/integrations/connectors-panel';
import { WorkItemsPanel } from '@/components/integrations/work-items-panel';
import { WebhooksPanel } from '@/components/integrations/webhooks-panel';
import { AgentsPanel } from '@/components/integrations/agents-panel';
import { IdentityPanel } from '@/components/integrations/identity-panel';
import { PartnersPanel } from '@/components/integrations/partners-panel';

const TABS = [
  { id: 'connectors', label: 'Connectors', icon: Cable, Panel: ConnectorsPanel },
  { id: 'work-items', label: 'Work items', icon: ListChecks, Panel: WorkItemsPanel },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook, Panel: WebhooksPanel },
  { id: 'agents', label: 'Local agents', icon: Cpu, Panel: AgentsPanel },
  { id: 'identity', label: 'SSO & SCIM', icon: ShieldCheck, Panel: IdentityPanel },
  { id: 'partners', label: 'Partners', icon: Handshake, Panel: PartnersPanel },
] as const;

type TabId = (typeof TABS)[number]['id'];

function IntegrationsView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get('tab');
  const active: TabId = (TABS.find((t) => t.id === requested)?.id ?? 'connectors') as TabId;
  const tabRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});

  const select = (id: TabId, focus = false) => {
    const next = new URLSearchParams(params.toString());
    next.set('tab', id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    if (focus) tabRefs.current[id]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = TABS.findIndex((t) => t.id === active);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = (idx + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
      select(TABS[n].id, true);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      select(TABS[e.key === 'Home' ? 0 : TABS.length - 1].id, true);
    }
  };

  const ActivePanel = TABS.find((t) => t.id === active)!.Panel;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Integrations</h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-3xl">
          Connect SAP and delivery systems, run the on-premise agent, configure enterprise sign-in and partner access. Everything here is
          tenant-scoped, audited and read-only unless you explicitly allow a registered write action.
        </p>
      </header>
      <div role="tablist" aria-label="Integration areas" className="flex gap-1 overflow-x-auto border-b border-border" onKeyDown={onKeyDown}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(t.id)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                selected ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`}>
        <ActivePanel />
      </div>
    </div>
  );
}

export default function IntegrationsPage() {
  return (
    <React.Suspense fallback={<div role="status" className="h-40 rounded-xl bg-muted/50 motion-safe:animate-pulse" aria-label="Loading integrations" />}>
      <IntegrationsView />
    </React.Suspense>
  );
}
