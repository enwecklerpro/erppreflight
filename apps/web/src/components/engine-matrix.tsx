'use client';

import React, { useState } from 'react';
import { ALL_18_ENGINES, EngineStatusItem } from '../lib/api-client';
import { CheckCircle2, Shield, Search, ExternalLink } from 'lucide-react';

export function EngineMatrix() {
  const [selectedDomain, setSelectedDomain] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const domains = [
    'ALL',
    'Output & Extensibility',
    'Migration & Clean Core',
    'Integration',
    'Release & Transport',
    'Operations',
    'Warehouse Automation',
  ];

  const filteredEngines = ALL_18_ENGINES.filter((eng) => {
    const matchesDomain =
      selectedDomain === 'ALL' || eng.domain === selectedDomain;
    const matchesSearch =
      eng.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      eng.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      eng.id.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesDomain && matchesSearch;
  });

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            18-Engine Operational Status Matrix
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Real-time readiness and deterministic rule inventory across SAP preflight domains
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search engines..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-3 py-1.5 text-xs bg-muted rounded-lg border border-transparent focus:border-primary focus:outline-none w-48"
            />
          </div>
        </div>
      </div>

      {/* Domain Filter Pills */}
      <div className="flex flex-wrap gap-1.5 mt-4">
        {domains.map((d) => (
          <button
            key={d}
            onClick={() => setSelectedDomain(d)}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              selectedDomain === d
                ? 'bg-primary text-white'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      {/* Grid of Engine Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
        {filteredEngines.map((eng) => (
          <div
            key={eng.id}
            className="border border-border/70 rounded-lg p-4 bg-background/50 hover:border-primary/50 transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[11px] font-semibold text-primary uppercase tracking-wider">
                    {eng.domain}
                  </span>
                  <h3 className="font-bold text-sm text-foreground mt-0.5">
                    {eng.name}
                  </h3>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300 rounded border border-green-200 dark:border-green-800">
                  <CheckCircle2 className="h-3 w-3" />
                  {eng.status}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                {eng.description}
              </p>
            </div>

            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50 text-xs">
              <span className="text-muted-foreground">
                <strong className="text-foreground">{eng.rulesCount}</strong> Rules Evaluated
              </span>
              <span className="font-mono text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">
                {eng.id}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
