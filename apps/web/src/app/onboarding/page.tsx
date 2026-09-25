'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Compass,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Layers,
  Database,
  ShieldCheck,
  FileCode,
  Truck,
  Flame,
  FileSpreadsheet,
} from 'lucide-react';
import { createProject, exploreDemoProject } from '@/lib/api-client';

const ROLES = [
  { id: 'CONSULTANT', label: 'SAP Functional Consultant', desc: 'Focus on business processes, OPD rules & SPRO customizing' },
  { id: 'DEVELOPER', label: 'ABAP / Cloud Developer', desc: 'Clean Core, RAP BOs, BAdIs, and custom code refactoring' },
  { id: 'ARCHITECT', label: 'Enterprise / Solution Architect', desc: 'Migration governance, API compatibility, and blast radius simulation' },
  { id: 'BASIS', label: 'SAP Basis & System Admin', desc: 'System refreshes, transport sequence, and BDLS parameters' },
  { id: 'SECURITY', label: 'IAM & Security Specialist', desc: 'Fiori catalogs, PFCG roles, S_START auth, and user decommission' },
  { id: 'EWM', label: 'EWM / MFS Warehouse Engineer', desc: 'MFS telegram logs, PLC loop synchronization, and buffer collisions' },
];

const DOMAINS = [
  { id: 'OUTPUT', label: 'Output Parameter Determination & Adobe Forms', icon: FileSpreadsheet },
  { id: 'CLEAN_CORE', label: 'Clean Core Extensibility & Custom Code Audit', icon: ShieldCheck },
  { id: 'MIGRATION', label: 'ECC 6.0 to S/4HANA Cloud CBC Migration', icon: Database },
  { id: 'INTEGRATION', label: 'API Change Guard & Change Pointer Coverage', icon: Layers },
  { id: 'RELEASE', label: 'Transport Dependency & Software Collections', icon: Truck },
  { id: 'MFS', label: 'Material Flow Systems Telegram Diagnostics', icon: Flame },
];

const RELEASES = [
  { id: 'S4H_2023', label: 'SAP S/4HANA 2023 (Private Cloud / On-Premise)' },
  { id: 'S4H_2022', label: 'SAP S/4HANA 2022' },
  { id: 'CLOUD_2502', label: 'SAP S/4HANA Cloud Public Edition 2502' },
  { id: 'ECC_608', label: 'SAP ECC 6.0 EHP8' },
];

import { useMutation } from '@tanstack/react-query';

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedRole, setSelectedRole] = useState(ROLES[0].id);
  const [selectedDomain, setSelectedDomain] = useState(DOMAINS[0].id);
  const [selectedRelease, setSelectedRelease] = useState(RELEASES[0].id);
  const [projectName, setProjectName] = useState('My First S/4HANA Preflight');

  const createProjectMutation = useMutation({
    mutationFn: createProject,
    onSuccess: (created) => {
      router.push(`/projects/${created.id}`);
    },
    onError: (err) => {
      console.error(err);
    }
  });

  const exploreDemoMutation = useMutation({
    mutationFn: exploreDemoProject,
    onSuccess: (demo) => {
      router.push(`/projects/${demo.project.id}`);
    },
    onError: (err) => {
      console.error(err);
    }
  });

  const loading = createProjectMutation.isPending || exploreDemoMutation.isPending;

  async function handleComplete() {
    createProjectMutation.mutate({
      name: projectName,
      description: `Configured during onboarding for ${selectedRole} focusing on ${selectedDomain}`,
      targetRelease: selectedRelease,
    });
  }

  async function handleExploreDemo() {
    exploreDemoMutation.mutate();
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto w-full">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-4 border border-emerald-500/20">
            <Compass className="w-3.5 h-3.5" />
            First-Run Guided Onboarding
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Welcome to ERP Preflight
          </h1>
          <p className="mt-3 text-slate-400 text-base">
            Know what will break before production does. Let us configure your tailored preflight environment.
          </p>
        </div>

        {/* Stepper Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl">
          {/* Step Indicator */}
          <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-800">
            <div className={`flex items-center gap-2 text-sm font-semibold ${step >= 1 ? 'text-emerald-400' : 'text-slate-500'}`}>
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs ${step >= 1 ? 'bg-emerald-500/20 border border-emerald-500' : 'bg-slate-800'}`}>1</span>
              Role
            </div>
            <div className={`h-0.5 flex-1 mx-4 ${step >= 2 ? 'bg-emerald-500' : 'bg-slate-800'}`} />
            <div className={`flex items-center gap-2 text-sm font-semibold ${step >= 2 ? 'text-emerald-400' : 'text-slate-500'}`}>
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs ${step >= 2 ? 'bg-emerald-500/20 border border-emerald-500' : 'bg-slate-800'}`}>2</span>
              Focus Area
            </div>
            <div className={`h-0.5 flex-1 mx-4 ${step >= 3 ? 'bg-emerald-500' : 'bg-slate-800'}`} />
            <div className={`flex items-center gap-2 text-sm font-semibold ${step >= 3 ? 'text-emerald-400' : 'text-slate-500'}`}>
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs ${step >= 3 ? 'bg-emerald-500/20 border border-emerald-500' : 'bg-slate-800'}`}>3</span>
              Target SAP Scope
            </div>
          </div>

          {/* Step 1: Role Selection */}
          {step === 1 && (
            <div>
              <h2 className="text-xl font-bold text-white mb-2">What best describes your primary responsibility?</h2>
              <p className="text-slate-400 text-sm mb-6">We will adapt the analysis engines and diagnostic depth to your role.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
                {ROLES.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedRole(r.id)}
                    className={`text-left p-4 rounded-xl border transition-all ${
                      selectedRole === r.id
                        ? 'bg-emerald-500/10 border-emerald-500 ring-1 ring-emerald-500 text-white'
                        : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm">{r.label}</span>
                      {selectedRole === r.id && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                    </div>
                    <p className="text-xs text-slate-400">{r.desc}</p>
                  </button>
                ))}
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-500/20 transition-colors"
                >
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Domain Focus */}
          {step === 2 && (
            <div>
              <h2 className="text-xl font-bold text-white mb-2">What transformation domain are you currently evaluating?</h2>
              <p className="text-slate-400 text-sm mb-6">Select your primary workstream for initial preflight routing.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
                {DOMAINS.map((d) => {
                  const Icon = d.icon;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setSelectedDomain(d.id)}
                      className={`text-left p-4 rounded-xl border flex items-start gap-3 transition-all ${
                        selectedDomain === d.id
                          ? 'bg-emerald-500/10 border-emerald-500 ring-1 ring-emerald-500 text-white'
                          : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <Icon className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <span className="font-semibold text-sm block">{d.label}</span>
                      </div>
                      {selectedDomain === d.id && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2.5 rounded-lg text-slate-400 hover:text-white text-sm font-semibold"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-500/20 transition-colors"
                >
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Target Release & Launch */}
          {step === 3 && (
            <div>
              <h2 className="text-xl font-bold text-white mb-2">Specify your target SAP Release & Workspace name</h2>
              <p className="text-slate-400 text-sm mb-6">All preflight rules evaluate deterministically against this release scope.</p>

              <div className="space-y-4 mb-8">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-2">Project Workspace Name</label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-2">Target SAP Release Scope</label>
                  <div className="space-y-2">
                    {RELEASES.map((rel) => (
                      <label
                        key={rel.id}
                        className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-all ${
                          selectedRelease === rel.id
                            ? 'bg-emerald-500/10 border-emerald-500 text-white'
                            : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <span className="text-sm font-medium">{rel.label}</span>
                        <input
                          type="radio"
                          name="targetRelease"
                          value={rel.id}
                          checked={selectedRelease === rel.id}
                          onChange={() => setSelectedRelease(rel.id)}
                          className="accent-emerald-500"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleExploreDemo}
                  disabled={loading}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 font-semibold text-sm transition-colors"
                >
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  Explore Demo Project (Synthetic Data)
                </button>
                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="px-4 py-2.5 rounded-lg text-slate-400 hover:text-white text-sm font-semibold"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleComplete}
                    disabled={loading || !projectName.trim()}
                    className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-500/20 transition-colors disabled:opacity-50"
                  >
                    {loading ? 'Configuring...' : 'Launch Workspace'}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
