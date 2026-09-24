'use client';

import React from 'react';
import Link from 'next/link';
import {
  ShieldAlert,
  FileCheck2,
  Cpu,
  Layers,
  ArrowRight,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import { MetricsCard } from '../components/metrics-card';
import { EngineMatrix } from '../components/engine-matrix';

export default function ExecutiveDashboard() {
  return (
    <div className="space-y-8">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-blue-900 to-indigo-950 text-white rounded-2xl p-6 sm:p-8 shadow-md">
        <div className="max-w-3xl">
          <span className="text-xs uppercase font-bold tracking-wider text-blue-300">
            Astra Ultra Preflight Platform
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold mt-1">
            Executive Clean Core & Preflight Intelligence
          </h1>
          <p className="mt-3 text-sm text-blue-100 leading-relaxed">
            Deterministic preflight verification across 18 specialized operational engines.
            Continuous clean core governance, deprecation impact scanning, and upgrade readiness.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/projects"
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-sm"
            >
              Open Workspaces
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/inspector"
              className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 text-white text-xs font-semibold rounded-lg hover:bg-white/20 transition-colors backdrop-blur-sm"
            >
              Launch Findings Inspector
            </Link>
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <MetricsCard
          title="Clean Core Index"
          value="87.4%"
          change="+4.2%"
          isPositive={true}
          icon={TrendingUp}
          description="S/4HANA Tier 1 & 2 compliance ratio"
        />
        <MetricsCard
          title="Active Projects"
          value="2"
          change="S/4H 2023"
          isPositive={true}
          icon={Layers}
          description="Monitored customer migration workspaces"
        />
        <MetricsCard
          title="Blockers & Critical"
          value="3"
          change="-1"
          isPositive={true}
          icon={AlertTriangle}
          description="Requires immediate clean core remediation"
        />
        <MetricsCard
          title="Engines Operational"
          value="19 / 19"
          change="100%"
          isPositive={true}
          icon={Cpu}
          description="18 SAP Engines + MFS BlackBox ready"
        />
      </div>

      {/* 18-Engine Operational Status Matrix */}
      <EngineMatrix />
    </div>
  );
}
