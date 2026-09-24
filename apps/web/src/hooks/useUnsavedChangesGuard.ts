'use client';

import { useEffect, useCallback } from 'react';

export interface UseUnsavedChangesGuardOptions {
  isDirty: boolean;
  isSubmitting?: boolean;
  message?: string;
  onDiscard?: () => void;
}

/**
 * Hook warning users before navigating away when form is dirty.
 * Satisfies Cardinal Axiom 1, Criterion 7:
 * Intercepts both native browser reload/close events and Next.js App Router internal link clicks.
 */
export function useUnsavedChangesGuard({
  isDirty,
  isSubmitting = false,
  message = 'You have unsaved changes. Are you sure you want to discard them and leave?',
  onDiscard,
}: UseUnsavedChangesGuardOptions) {
  const shouldBlock = isDirty && !isSubmitting;

  // 1. Browser tab close / refresh interception
  useEffect(() => {
    if (!shouldBlock) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [shouldBlock, message]);

  // 2. Next.js App Router client-side link click interception
  useEffect(() => {
    if (!shouldBlock) return;

    const handleClickCapture = (event: MouseEvent) => {
      // Find closest anchor tag
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a');
      if (!anchor || !anchor.href) return;

      const targetUrl = new URL(anchor.href, window.location.href);
      const currentUrl = new URL(window.location.href);

      // Skip in-page anchor hash jumps or target="_blank"
      if (
        anchor.target === '_blank' ||
        (targetUrl.pathname === currentUrl.pathname &&
          targetUrl.search === currentUrl.search &&
          targetUrl.hash !== '')
      ) {
        return;
      }

      // Intercept navigation
      const confirmed = window.confirm(message);
      if (!confirmed) {
        event.preventDefault();
        event.stopPropagation();
      } else if (onDiscard) {
        onDiscard();
      }
    };

    // Capture click in capture phase before Next.js Link router handler executes
    document.addEventListener('click', handleClickCapture, true);
    return () => document.removeEventListener('click', handleClickCapture, true);
  }, [shouldBlock, message, onDiscard]);

  // 3. Browser History (back/forward) popstate listener
  useEffect(() => {
    if (!shouldBlock) return;

    const handlePopState = () => {
      const confirmed = window.confirm(message);
      if (!confirmed) {
        // Re-push current state to cancel back/forward navigation
        window.history.pushState(null, '', window.location.href);
      } else if (onDiscard) {
        onDiscard();
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [shouldBlock, message, onDiscard]);

  // 4. Imperative check helper for custom buttons (e.g. "Cancel", "Back")
  const confirmNavigation = useCallback((): boolean => {
    if (!shouldBlock) return true;
    const confirmed = window.confirm(message);
    if (confirmed && onDiscard) {
      onDiscard();
    }
    return confirmed;
  }, [shouldBlock, message, onDiscard]);

  return {
    shouldBlock,
    confirmNavigation,
  };
}

export default useUnsavedChangesGuard;
