'use client';

import { useThrottledCallback as useTanStackThrottledCallback } from '@tanstack/react-pacer';
import { useMemo } from 'react';

export interface UseThrottledCallbackOptions {
  wait?: number;
  leading?: boolean;
  trailing?: boolean;
}

/**
 * Enterprise throttled callback hook with a 500ms default window.
 * Conforms to TanStack Prompt §30:
 * "Rate-Limited Client Actions: throttle preview generation, graph re-layout, search suggestions, analysis simulation preview."
 *
 * @param fn The callback function to throttle
 * @param optionsOrWait Wait time in milliseconds (default: 500) or config object
 * @returns Stable throttled callback executing at most once per wait window
 */
export function useThrottledCallback<TFn extends (...args: any[]) => any>(
  fn: TFn,
  optionsOrWait: number | UseThrottledCallbackOptions = 500
): (...args: Parameters<TFn>) => void {
  const options = useMemo(() => {
    if (typeof optionsOrWait === 'number') {
      return { wait: optionsOrWait };
    }
    return {
      wait: optionsOrWait.wait ?? 500,
      leading: optionsOrWait.leading ?? true,
      trailing: optionsOrWait.trailing ?? true,
    };
  }, [optionsOrWait]);

  return useTanStackThrottledCallback(fn, options);
}

export default useThrottledCallback;
