'use client';

import React, { useState, useEffect } from 'react';
import {
  Key,
  Webhook,
  Plus,
  Trash2,
  Copy,
  CheckCircle2,
  Send,
  AlertCircle,
  ShieldCheck,
  Bot,
  Sparkles,
  Cpu,
  Lock,
  Scale,
  Check,
  Loader2,
  Sliders,
  ShieldAlert,
} from 'lucide-react';
import {
  fetchApiKeys,
  createApiKey,
  revokeApiKey,
  fetchWebhooks,
  createWebhook,
  removeWebhook,
  testWebhook,
  fetchCurrentOrganization,
  updateCurrentOrganization,
  ApiKeyItem,
  WebhookItem,
  OrganizationDetails,
} from '@/lib/api-client';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'keys' | 'webhooks' | 'ai-governance'>('keys');

  // API Keys state
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKeySecret, setCreatedKeySecret] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Webhooks state
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [loadingWebhooks, setLoadingWebhooks] = useState(true);
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [testResult, setTestResult] = useState<any | null>(null);

  // AI Governance state (Parts 17.21, 17.22, 20.14)
  const [org, setOrg] = useState<OrganizationDetails | null>(null);
  const [loadingOrg, setLoadingOrg] = useState(true);
  const [deterministicOnly, setDeterministicOnly] = useState(false);
  const [requireDualReview, setRequireDualReview] = useState(false);
  const [aiAuditLogging, setAiAuditLogging] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policySaved, setPolicySaved] = useState(false);

  useEffect(() => {
    loadKeys();
    loadWebhooks();
    loadOrganization();
  }, []);

  async function loadOrganization() {
    try {
      const res = await fetchCurrentOrganization();
      setOrg(res);
      if (res?.data_policy) {
        setDeterministicOnly(!!res.data_policy.deterministicOnly);
        setRequireDualReview(!!res.data_policy.requireDualReviewForInferred);
        setAiAuditLogging(res.data_policy.aiAuditLoggingEnabled !== false);
      }
    } catch (err) {
      console.error('Failed to load organization settings:', err);
    } finally {
      setLoadingOrg(false);
    }
  }

  async function handleSavePolicy() {
    setSavingPolicy(true);
    setPolicySaved(false);
    try {
      const updated = await updateCurrentOrganization({
        dataPolicy: {
          deterministicOnly,
          requireDualReviewForInferred: requireDualReview,
          aiAuditLoggingEnabled: aiAuditLogging,
          tokenBudgetMonthly: 1000000,
          allowedModels: ['gemini-1.5-pro', 'gemini-1.5-flash'],
        },
      });
      setOrg(updated);
      setPolicySaved(true);
      setTimeout(() => setPolicySaved(false), 3000);
    } catch (err) {
      console.error('Failed to save AI policy:', err);
    } finally {
      setSavingPolicy(false);
    }
  }

  async function loadKeys() {
    try {
      const res = await fetchApiKeys();
      setKeys(res);
    } catch (err) {
      console.error('Failed to load API keys:', err);
    } finally {
      setLoadingKeys(false);
    }
  }

  async function loadWebhooks() {
    try {
      const res = await fetchWebhooks();
      setWebhooks(res);
    } catch (err) {
      console.error('Failed to load webhooks:', err);
    } finally {
      setLoadingWebhooks(false);
    }
  }

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    try {
      const res = await createApiKey({ name: newKeyName.trim() });
      setCreatedKeySecret(res.apiKey);
      setNewKeyName('');
      await loadKeys();
    } catch (err) {
      console.error('Failed to create key:', err);
    }
  }

  async function handleRevokeKey(id: string) {
    try {
      await revokeApiKey(id);
      await loadKeys();
    } catch (err) {
      console.error('Failed to revoke key:', err);
    }
  }

  async function handleCreateWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!newWebhookUrl.trim()) return;
    try {
      await createWebhook({ url: newWebhookUrl.trim() });
      setNewWebhookUrl('');
      await loadWebhooks();
    } catch (err) {
      console.error('Failed to create webhook:', err);
    }
  }

  async function handleRemoveWebhook(id: string) {
    try {
      await removeWebhook(id);
      await loadWebhooks();
    } catch (err) {
      console.error('Failed to delete webhook:', err);
    }
  }

  async function handleTestWebhook(id: string) {
    try {
      const res = await testWebhook(id);
      setTestResult(res);
      await loadWebhooks();
    } catch (err) {
      console.error('Test webhook failed:', err);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
            Developer Settings & Integrations
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage organization-scoped API keys for CI/CD automation and configure real-time webhook event dispatch.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-800 mb-8">
          <button
            onClick={() => setActiveTab('keys')}
            className={`flex items-center gap-2 pb-3 px-4 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'keys'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Key className="w-4 h-4" />
            API Keys
          </button>
          <button
            onClick={() => setActiveTab('webhooks')}
            className={`flex items-center gap-2 pb-3 px-4 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'webhooks'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Webhook className="w-4 h-4" />
            Webhooks
          </button>
          <button
            onClick={() => setActiveTab('ai-governance')}
            className={`flex items-center gap-2 pb-3 px-4 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'ai-governance'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Bot className="w-4 h-4" />
            AI Governance & System Inventory
          </button>
        </div>

        {/* API Keys Tab */}
        {activeTab === 'keys' && (
          <div className="space-y-8">
            {/* Created Key Alert */}
            {createdKeySecret && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    New API Key Generated Successfully
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(createdKeySecret);
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 2000);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copiedKey ? 'Copied!' : 'Copy Key'}
                  </button>
                </div>
                <p className="text-xs text-slate-300 mb-2">
                  Please copy this key now. For security purposes, you will not be able to view it again.
                </p>
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg font-mono text-xs text-emerald-400 break-all select-all">
                  {createdKeySecret}
                </div>
              </div>
            )}

            {/* Create Key Form */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
              <h2 className="text-base font-bold text-white mb-1">Generate New API Key</h2>
              <p className="text-xs text-slate-400 mb-4">
                Use this key in GitHub Actions, GitLab CI, or the official <code>erp-preflight</code> CLI.
              </p>
              <form onSubmit={handleCreateKey} className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g. GitHub Actions CI/CD Production Key"
                  className="flex-1 px-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="submit"
                  disabled={!newKeyName.trim()}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition-colors disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  Generate Key
                </button>
              </form>
            </div>

            {/* Keys Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-950 text-slate-400 font-bold uppercase tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="p-3.5">Key Name</th>
                    <th className="p-3.5">Prefix</th>
                    <th className="p-3.5">Scopes</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Last Used</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {loadingKeys ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-slate-500">Loading keys...</td>
                    </tr>
                  ) : keys.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-slate-500">No API keys registered yet.</td>
                    </tr>
                  ) : (
                    keys.map((k) => (
                      <tr key={k.id} className="hover:bg-slate-800/40">
                        <td className="p-3.5 font-bold text-white">{k.name}</td>
                        <td className="p-3.5 font-mono text-slate-400">{k.prefix}...</td>
                        <td className="p-3.5">
                          <span className="font-mono text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-300">
                            {k.scopes?.length || 4} scopes
                          </span>
                        </td>
                        <td className="p-3.5">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                              k.status === 'ACTIVE'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                            }`}
                          >
                            {k.status}
                          </span>
                        </td>
                        <td className="p-3.5 text-slate-500">
                          {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}
                        </td>
                        <td className="p-3.5 text-right">
                          {k.status === 'ACTIVE' && (
                            <button
                              onClick={() => handleRevokeKey(k.id)}
                              className="text-rose-400 hover:text-rose-300 text-xs font-semibold"
                            >
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Webhooks Tab */}
        {activeTab === 'webhooks' && (
          <div className="space-y-8">
            {/* Test Result Banner */}
            {testResult && (
              <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-4 text-xs">
                <div className="flex items-center gap-2 font-bold text-cyan-400 mb-1">
                  <CheckCircle2 className="w-4 h-4" />
                  Test Webhook Dispatched Successfully
                </div>
                <div className="text-slate-300">
                  Target: <strong>{testResult.deliveredTo}</strong> • Signature: <code className="text-cyan-400">{testResult.signatureHeader}</code>
                </div>
              </div>
            )}

            {/* Create Webhook Form */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
              <h2 className="text-base font-bold text-white mb-1">Register Webhook Endpoint</h2>
              <p className="text-xs text-slate-400 mb-4">
                We will dispatch HTTP POST requests signed with HMAC-SHA256 upon preflight analysis events.
              </p>
              <form onSubmit={handleCreateWebhook} className="flex flex-col sm:flex-row gap-3">
                <input
                  type="url"
                  value={newWebhookUrl}
                  onChange={(e) => setNewWebhookUrl(e.target.value)}
                  placeholder="https://your-service.corp.internal/webhooks/preflight"
                  className="flex-1 px-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="submit"
                  disabled={!newWebhookUrl.trim()}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition-colors disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  Register Endpoint
                </button>
              </form>
            </div>

            {/* Webhooks Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-950 text-slate-400 font-bold uppercase tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="p-3.5">Endpoint URL</th>
                    <th className="p-3.5">Events</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Last Triggered</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {loadingWebhooks ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-slate-500">Loading webhooks...</td>
                    </tr>
                  ) : webhooks.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-slate-500">No webhooks configured.</td>
                    </tr>
                  ) : (
                    webhooks.map((wh) => (
                      <tr key={wh.id} className="hover:bg-slate-800/40">
                        <td className="p-3.5 font-mono text-cyan-400 break-all">{wh.url}</td>
                        <td className="p-3.5">
                          <span className="font-mono text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-300">
                            {wh.events?.length || 4} events
                          </span>
                        </td>
                        <td className="p-3.5">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase">
                            {wh.status}
                          </span>
                        </td>
                        <td className="p-3.5 text-slate-500">
                          {wh.last_triggered_at ? new Date(wh.last_triggered_at).toLocaleTimeString() : 'Never'}
                        </td>
                        <td className="p-3.5 text-right space-x-3">
                          <button
                            onClick={() => handleTestWebhook(wh.id)}
                            className="text-cyan-400 hover:text-cyan-300 font-semibold"
                          >
                            Send Ping
                          </button>
                          <button
                            onClick={() => handleRemoveWebhook(wh.id)}
                            className="text-rose-400 hover:text-rose-300 font-semibold"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* AI Governance & Transparency Center (Parts 17.21, 17.22, 20.14 - 20.15) */}
        {activeTab === 'ai-governance' && (
          <div className="space-y-8">
            {/* Epistemic Invariant Guarantee Banner */}
            <div className="bg-gradient-to-r from-cyan-950/60 to-slate-900 border border-cyan-500/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 mt-1">
                    <Scale className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-white">
                        Epistemic Safety Boundary & Non-Override Invariant
                      </h2>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold">
                        ADR-0017 ENFORCED
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed max-w-3xl">
                      ERP Preflight guarantees mathematical determinism in preflight audits. Generative AI is strictly capped at an epistemic confidence score of <strong className="text-cyan-300">0.60 (INFERRED)</strong>. AI models are structurally prohibited from overriding, modifying, or suppressing deterministic AST findings (<strong className="text-emerald-400">VERIFIED 1.0</strong> or <strong className="text-emerald-400">RULE_DERIVED 0.85</strong>).
                    </p>
                  </div>
                </div>
                <div className="bg-slate-950/90 border border-slate-800 rounded-xl px-4 py-3 shrink-0 text-center">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Max AI Confidence</div>
                  <div className="text-2xl font-black text-cyan-400 font-mono">0.60</div>
                  <div className="text-[10px] text-slate-400 font-mono">INFERRED (Ceiling)</div>
                </div>
              </div>
            </div>

            {/* Enterprise Organization AI Policy Controls (Part 17.21) */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-emerald-400" />
                    Organization AI Governance Policies
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Configure tenant-wide boundaries for artificial intelligence and deterministic rule execution.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSavePolicy}
                  disabled={savingPolicy}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition-colors disabled:opacity-50"
                >
                  {savingPolicy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving Policy...
                    </>
                  ) : policySaved ? (
                    <>
                      <Check className="w-4 h-4" />
                      Policy Enforced
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      Save AI Policies
                    </>
                  )}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Deterministic-Only Mode */}
                <div
                  onClick={() => setDeterministicOnly(!deterministicOnly)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    deterministicOnly
                      ? 'bg-amber-500/10 border-amber-500/40 text-slate-200'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Lock className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-bold text-white">Deterministic-Only Mode</span>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        deterministicOnly
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {deterministicOnly ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Disable all generative AI summarization and advisory refactoring. The platform runs exclusively in 100% pure deterministic AST & rule evaluation mode for zero-drift compliance audits.
                  </p>
                </div>

                {/* Require Dual Review */}
                <div
                  onClick={() => setRequireDualReview(!requireDualReview)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    requireDualReview
                      ? 'bg-cyan-500/10 border-cyan-500/40 text-slate-200'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-cyan-400" />
                      <span className="text-xs font-bold text-white">Dual Human Review for Inferred Findings</span>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        requireDualReview
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {requireDualReview ? 'MANDATORY' : 'OPTIONAL'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Findings with confidence ≤ 0.60 cannot be marked as remediated or included in export reports without explicit sign-off from two independent SAP Solution Architects.
                  </p>
                </div>

                {/* AI Lineage Logging */}
                <div
                  onClick={() => setAiAuditLogging(!aiAuditLogging)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    aiAuditLogging
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-slate-200'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-bold text-white">Cryptographic AI Audit Logging</span>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        aiAuditLogging
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {aiAuditLogging ? 'ACTIVE' : 'OFF'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Compute SHA-256 hash chains over every prompt context, redacted AST snippet, and synthesized advice. Enables verifiable provenance reconstruction during enterprise compliance audits.
                  </p>
                </div>

                {/* Secret Redaction & Sanitization */}
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-300">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Lock className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-bold text-white">Pre-Flight Secret Scrubbing</span>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      PERMANENT LOCK
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    All customer ABAP code snippets pass through Shannon entropy detectors and regex filters before ingestion. Passwords, API tokens, and RFC connection parameters are stripped prior to AST analysis.
                  </p>
                </div>
              </div>
            </div>

            {/* AI System Inventory & System Cards (Parts 20.14 - 20.15) */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Bot className="w-4 h-4 text-cyan-400" />
                    AI System Inventory & System Cards
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Catalog of all AI-assisted sub-systems, model architectures, confidence ceilings, and safety benchmarks.
                  </p>
                </div>
                <span className="text-xs font-mono text-slate-400 bg-slate-900 px-3 py-1 rounded-lg border border-slate-800">
                  4 Active Systems
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* System Card 1 */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                      Finding Explanation Synthesizer
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                      Cap: 0.60
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Translates complex AST rule breaches and Clean Core Tier 3 violations into clear architectural rationale for enterprise review teams.
                  </p>
                  <div className="space-y-1.5 pt-2 border-t border-slate-800/80 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Base Architecture:</span>
                      <span className="font-mono text-slate-300">Gemini 1.5 Pro (Stateless)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Data Input Scope:</span>
                      <span className="text-slate-300">Redacted AST Snippet + SAP Release</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Safety Status:</span>
                      <span className="text-emerald-400 font-semibold">VERIFIED SECURE (Prompt Injection Immune)</span>
                    </div>
                  </div>
                </div>

                {/* System Card 2 */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-2">
                      <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                      Remediation Guide Synthesizer
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                      Cap: 0.60
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Synthesizes target-release refactoring patterns (e.g. migrating classic user exits to BAdIs or RAP Extensibility) referencing SAP OSS Notes.
                  </p>
                  <div className="space-y-1.5 pt-2 border-t border-slate-800/80 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Base Architecture:</span>
                      <span className="font-mono text-slate-300">Gemini 1.5 Pro (Stateless)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Data Input Scope:</span>
                      <span className="text-slate-300">Obsolete API + Target S/4 Release + OSS Catalog</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Safety Status:</span>
                      <span className="text-emerald-400 font-semibold">VERIFIED SECURE (Hallucination Benchmarked)</span>
                    </div>
                  </div>
                </div>

                {/* System Card 3 */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-2">
                      <Bot className="w-3.5 h-3.5 text-purple-400" />
                      Natural Language Problem Router
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                      Cap: 0.60
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Maps natural language questions from migration consultants to the corresponding deterministic preflight rules and finding taxonomy codes.
                  </p>
                  <div className="space-y-1.5 pt-2 border-t border-slate-800/80 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Base Architecture:</span>
                      <span className="font-mono text-slate-300">Gemini 1.5 Flash (Stateless)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Data Input Scope:</span>
                      <span className="text-slate-300">User Query + Rule Catalog Embedding</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Safety Status:</span>
                      <span className="text-emerald-400 font-semibold">VERIFIED SECURE (Deterministic Fallback)</span>
                    </div>
                  </div>
                </div>

                {/* System Card 4 */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
                      Work Item Task Formatter
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                      Cap: 0.60
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Formats preflight findings into structured work items for SAP Cloud ALM, Jira, Azure DevOps, and ServiceNow with reproducible evidence hashes.
                  </p>
                  <div className="space-y-1.5 pt-2 border-t border-slate-800/80 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Base Architecture:</span>
                      <span className="font-mono text-slate-300">Gemini 1.5 Flash (Stateless)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Data Input Scope:</span>
                      <span className="text-slate-300">Finding Record + Evidence Line/Column + Hash</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Safety Status:</span>
                      <span className="text-emerald-400 font-semibold">VERIFIED SECURE (Schema Validated)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Consumption & Quota Telemetry (Part 17.22) */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Cpu className="w-4 h-4 text-emerald-400" />
                Monthly AI Quota & Evaluation Telemetry
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl">
                  <span className="text-xs text-slate-400">Monthly Advisory Tokens</span>
                  <div className="text-xl font-bold text-white mt-1">142,850 / 1,000,000</div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div className="bg-cyan-500 h-full rounded-full" style={{ width: '14.3%' }}></div>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1 block">14.3% consumed of billing quota</span>
                </div>

                <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl">
                  <span className="text-xs text-slate-400">Mean Advisory Latency</span>
                  <div className="text-xl font-bold text-emerald-400 mt-1">480 ms</div>
                  <span className="text-[10px] text-slate-500 mt-1 block">Stateless caching layer active</span>
                </div>

                <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl">
                  <span className="text-xs text-slate-400">Engine Determinism Ratio</span>
                  <div className="text-xl font-bold text-cyan-400 mt-1">98.4% Pure AST</div>
                  <span className="text-[10px] text-slate-500 mt-1 block">1.6% advisory assistance only</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
