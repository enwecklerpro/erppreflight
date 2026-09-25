'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ThumbsUp,
  MessageSquare,
  Plus,
  Filter,
  CheckCircle2,
  Clock,
  Sparkles,
  Search,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import {
  fetchFeedbackItems,
  createFeedbackItem,
  voteOnFeedbackItem,
  CustomerFeedbackItem,
} from '../../lib/api-client';

export default function FeedbackPage() {
  const queryClient = useQueryClient();
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [feedbackType, setFeedbackType] = useState<'FEATURE_REQUEST' | 'GAP_VOTE'>('FEATURE_REQUEST');
  const [targetEngine, setTargetEngine] = useState('');

  const { data: feedbackList = [], isLoading } = useQuery({
    queryKey: ['feedback'],
    queryFn: fetchFeedbackItems,
  });

  const voteMutation = useMutation({
    mutationFn: voteOnFeedbackItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feedback'] });
    },
  });

  const createMutation = useMutation({
    mutationFn: createFeedbackItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feedback'] });
      setIsSubmitModalOpen(false);
      setTitle('');
      setDescription('');
    },
  });

  const statuses = ['ALL', 'UNDER_REVIEW', 'PLANNED', 'IN_PROGRESS', 'SHIPPED'];

  const filteredItems = feedbackList.filter((item) => {
    const matchesStatus = selectedStatus === 'ALL' || item.status === selectedStatus;
    const matchesSearch =
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.targetEngine && item.targetEngine.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description) return;

    createMutation.mutate({
      title,
      description,
      feedbackType,
      targetEngine: targetEngine || undefined,
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SHIPPED':
        return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800';
      case 'IN_PROGRESS':
        return 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-blue-300 dark:border-blue-800';
      case 'PLANNED':
        return 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300 border-purple-300 dark:border-purple-800';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase font-bold tracking-wider text-primary px-2 py-0.5 bg-primary/10 rounded">
              Part 14.50 Feedback Loop
            </span>
            <span className="text-xs text-muted-foreground font-mono">Customer-Driven Roadmap</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-1">
            Feature Requests & SAP Gap Voting
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Vote on upcoming preflight capabilities, suggest SAP transition rule additions, or propose new engine checks.
          </p>
        </div>
        <div>
          <button
            onClick={() => setIsSubmitModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-blue-600 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>Submit Request</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search proposals, engines..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {statuses.map((st) => (
            <button
              key={st}
              onClick={() => setSelectedStatus(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                selectedStatus === st
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {st === 'ALL' ? 'All Requests' : st.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="space-y-4">
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-xl border border-border bg-card p-6 animate-pulse" />
            ))}
          </div>
        )}

        {filteredItems.map((item) => (
          <div
            key={item.id}
            className="rounded-xl border border-border bg-card p-5 flex items-start gap-4 hover:border-primary/50 transition-all shadow-sm"
          >
            {/* Vote button */}
            <button
              onClick={() => voteMutation.mutate(item.id)}
              className={`flex flex-col items-center justify-center h-14 w-12 rounded-lg border transition-all shrink-0 ${
                item.hasVoted
                  ? 'bg-primary text-white border-primary shadow-sm'
                  : 'bg-muted/50 border-border text-foreground hover:bg-muted hover:border-primary/50'
              }`}
              title="Vote for this request"
            >
              <ThumbsUp className="h-4 w-4" />
              <span className="text-xs font-bold mt-1">{item.votes}</span>
            </button>

            {/* Content */}
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${getStatusBadge(
                    item.status
                  )}`}
                >
                  {item.status.replace(/_/g, ' ')}
                </span>
                {item.targetEngine && (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground border border-border">
                    {item.targetEngine}
                  </span>
                )}
                <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                  {item.feedbackType.replace(/_/g, ' ')}
                </span>
              </div>

              <h3 className="text-base font-bold text-foreground">{item.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Submit Modal */}
      {isSubmitModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <form
            onSubmit={handleCreateSubmit}
            className="bg-card border border-border rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4"
          >
            <div className="space-y-1">
              <span className="text-xs uppercase font-bold text-primary">Product Feedback</span>
              <h2 className="text-xl font-bold text-foreground">Submit Feature or Rule Proposal</h2>
              <p className="text-xs text-muted-foreground">
                Your request will be reviewed by the ERP Preflight engineering and SAP architecture team.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-foreground block mb-1">Proposal Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. S/4HANA Public Cloud 2608 Tax Determination Support"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="font-semibold text-foreground block mb-1">Category</label>
                <select
                  value={feedbackType}
                  onChange={(e: any) => setFeedbackType(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                >
                  <option value="FEATURE_REQUEST">Feature Request</option>
                  <option value="GAP_VOTE">SAP Gap / Mapping Vote</option>
                  <option value="ACCURACY_DISPUTE">Accuracy Dispute</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-foreground block mb-1">Target Engine (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. CLEAN_CORE_OBJECT_GUARD or OPD_GUARD"
                  value={targetEngine}
                  onChange={(e) => setTargetEngine(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono"
                />
              </div>

              <div>
                <label className="font-semibold text-foreground block mb-1">Detailed Description & Use Case</label>
                <textarea
                  required
                  rows={3}
                  placeholder="Describe the business problem, SAP release version, and why this preflight check is critical..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
              <button
                type="button"
                onClick={() => setIsSubmitModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-blue-600 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Submitting...' : 'Submit Proposal'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
