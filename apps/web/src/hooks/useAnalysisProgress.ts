'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AnalysisProgress } from '@erppreflight/schemas';
import { fetchAnalysisProgress, orchestrationKeys, streamAnalysisProgress } from '@/lib/api/analysis-orchestration';

const POLL_MS = 3000;

/**
 * Stage progress of one analysis (Part 03 §3.8): server-sent events streamed with
 * the bearer token, with a TanStack Query poll fallback that takes over when the
 * stream cannot be opened or drops. The query cache stays the single source of
 * truth; the stream only writes snapshots into it.
 */
export function useAnalysisProgress(analysisId: string | null | undefined) {
  const queryClient = useQueryClient();
  const [transport, setTransport] = useState<'sse' | 'poll'>('sse');
  const lastEventId = useRef<string | null>(null);
  const key = orchestrationKeys.progress(analysisId ?? 'none');

  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchAnalysisProgress(analysisId as string, signal),
    enabled: Boolean(analysisId),
    retry: 2,
    refetchInterval: (q) => {
      const data = q.state.data as AnalysisProgress | undefined;
      if (data?.terminal) return false;
      return transport === 'poll' ? POLL_MS : false;
    },
  });

  const terminal = query.data?.terminal ?? false;

  useEffect(() => {
    if (!analysisId || terminal || transport !== 'sse') return;
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        lastEventId.current = await streamAnalysisProgress(
          analysisId,
          {
            onSnapshot: (snapshot) => queryClient.setQueryData(orchestrationKeys.progress(analysisId), snapshot),
            onEnd: () => void queryClient.invalidateQueries({ queryKey: orchestrationKeys.progress(analysisId) }),
          },
          controller.signal,
          lastEventId.current
        );
        if (!cancelled) {
          // Stream closed without a terminal snapshot (proxy timeout, server reconnect hint): poll instead.
          const current = queryClient.getQueryData<AnalysisProgress>(orchestrationKeys.progress(analysisId));
          if (!current?.terminal) setTransport('poll');
        }
      } catch {
        if (!cancelled) setTransport('poll');
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [analysisId, terminal, transport, queryClient]);

  return { ...query, transport };
}
