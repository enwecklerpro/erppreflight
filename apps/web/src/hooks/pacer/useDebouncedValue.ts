'use client';

import { useDebouncedValue as useTanStackDebouncedValue } from '@tanstack/react-pacer';
import type { ReactDebouncer } from '@tanstack/react-pacer';
import { useMemo } from 'react';

export interface UseDebouncedValueOptions {
  wait?: number;
  leading?: boolean;
}

/**
 * Enterprise debounced search hook with a 300ms default window.
 * Conforms to TanStack Prompt §29:
 * "Search Debouncing: User types MARA -> Pacer waits appropriate debounce window (300ms) -> Query executes once."
 *
 * @param value The raw input state to debounce
 * @param optionsOrWait Wait time in milliseconds (default: 300) or config object
 * @returns Tuple of [debouncedValue, debouncerInstance]
 */
export function useDebouncedValue<T>(
  value: T,
  optionsOrWait: number | UseDebouncedValueOptions = 300
): [T, ReactDebouncer<React.Dispatch<React.SetStateAction<T>>, any>] {
  const options = useMemo(() => {
    if (typeof optionsOrWait === 'number') {
      return { wait: optionsOrWait };
    }
    return {
      wait: optionsOrWait.wait ?? 300,
      leading: optionsOrWait.leading ?? false,
    };
  }, [optionsOrWait]);

  return useTanStackDebouncedValue(value, options);
}

/**
 * Simplified convenience hook for debounced search strings with loading indicator support.
 */
export function useDebouncedSearch(searchTerm: string, delay = 300) {
  const [debouncedValue, debouncer] = useDebouncedValue(searchTerm, delay);

  return {
    debouncedValue,
    isPending: debouncer.state.isPending,
    cancel: debouncer.cancel,
    flush: debouncer.flush,
  };
}

export default useDebouncedValue;
