'use client';

import { useCallback } from 'react';
import { useMessages } from '@/i18n/client';

/** Localized label for an organization role code (falls back to the code). */
export function useRoleLabel(): (role: string) => string {
  const messages = useMessages();
  return useCallback(
    (role: string) => (messages.app.ui.orgRole as Record<string, string>)[role] ?? role,
    [messages]
  );
}
