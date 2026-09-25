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
} from 'lucide-react';
import {
  fetchApiKeys,
  createApiKey,
  revokeApiKey,
  fetchWebhooks,
  createWebhook,
  removeWebhook,
  testWebhook,
  ApiKeyItem,
  WebhookItem,
} from '@/lib/api-client';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'keys' | 'webhooks'>('keys');

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

  useEffect(() => {
    loadKeys();
    loadWebhooks();
  }, []);

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
      </div>
    </div>
  );
}
