'use client';

import { useBatcher } from '@tanstack/react-pacer';
import { useCallback, useMemo } from 'react';

export interface UseBatchQueueOptions {
  maxSize?: number;
  wait?: number;
  onUnmount?: 'flush' | 'cancel';
}

export interface BatchQueueState {
  size: number;
  isPending: boolean;
  isEmpty: boolean;
  executionCount: number;
}

/**
 * Enterprise batch processing hook for high-frequency input collection.
 * Conforms to TanStack Prompt §28 & §35:
 * Batches bulk tag updates, finding triage assignments, or telemetry flushes.
 */
export function useBatchQueue<T>(
  onBatch: (items: T[]) => void | Promise<void>,
  options: UseBatchQueueOptions = {}
) {
  const { maxSize = 50, wait = 1000, onUnmount = 'flush' } = options;

  const batcher = useBatcher<T, BatchQueueState>(
    onBatch,
    {
      maxSize,
      wait,
      onUnmount: onUnmount === 'flush' ? (b) => b.flush() : (b) => b.cancel(),
    },
    (state) => ({
      size: state.size,
      isPending: state.isPending,
      isEmpty: state.isEmpty,
      executionCount: state.executionCount,
    })
  );

  const push = useCallback(
    (item: T) => {
      batcher.addItem(item);
    },
    [batcher]
  );

  const pushMany = useCallback(
    (items: T[]) => {
      for (const item of items) {
        batcher.addItem(item);
      }
    },
    [batcher]
  );

  const flush = useCallback(() => {
    batcher.flush();
  }, [batcher]);

  const clear = useCallback(() => {
    batcher.clear();
  }, [batcher]);

  const peek = useCallback((): T[] => {
    return batcher.peekAllItems();
  }, [batcher]);

  return useMemo(
    () => ({
      push,
      pushMany,
      flush,
      clear,
      peek,
      size: batcher.state.size ?? 0,
      isPending: batcher.state.isPending ?? false,
      isEmpty: batcher.state.isEmpty ?? true,
      executionCount: batcher.state.executionCount ?? 0,
    }),
    [push, pushMany, flush, clear, peek, batcher.state]
  );
}

export interface DelimitedParseOptions {
  uppercase?: boolean;
  deduplicate?: boolean;
  maxItems?: number;
  customDelimiterRegex?: RegExp;
}

/**
 * Dedicated parser for SAP enterprise bulk paste inputs:
 * Handles comma, semicolon, tab, and newline separated inputs.
 * Strips whitespace, removes empty entries, and handles deduplication.
 * Example inputs: "MARA, MARC; MARD \n VBAK" -> ["MARA", "MARC", "MARD", "VBAK"]
 */
export function parseBatchDelimitedInput(
  rawText: string,
  options: DelimitedParseOptions = {}
): string[] {
  const {
    uppercase = true,
    deduplicate = true,
    maxItems = 1000,
    customDelimiterRegex = /[\r\n,;\t]+/,
  } = options;

  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) return [];

  const rawTokens = rawText
    .split(customDelimiterRegex)
    .map((token) => token.trim())
    .filter(Boolean);

  const normalized = rawTokens.map((t) => (uppercase ? t.toUpperCase() : t));
  const result = deduplicate ? Array.from(new Set(normalized)) : normalized;

  return result.slice(0, maxItems);
}

export default useBatchQueue;
