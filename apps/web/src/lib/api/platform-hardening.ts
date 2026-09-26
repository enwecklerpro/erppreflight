import { z } from 'zod';
import { SeverityEnum, type Finding } from '@erppreflight/schemas';
import { customInstance } from './custom-instance';

/**
 * Typed client for the notification language (users.preferred_locale) and the
 * finding deep link target (`/projects/:id/findings?finding=:findingId`).
 * Every response is validated with Zod at runtime.
 */

export const NotificationLocaleSchema = z.object({
  locale: z.enum(['en', 'de']),
  explicit: z.boolean(),
});
export type NotificationLocaleState = z.infer<typeof NotificationLocaleSchema>;

export const notificationLocaleKey = ['notifications', 'locale'] as const;

export async function fetchNotificationLocale(signal?: AbortSignal): Promise<NotificationLocaleState> {
  return NotificationLocaleSchema.parse(await customInstance<unknown>('/notifications/locale', { signal }));
}

export async function saveNotificationLocale(locale: 'en' | 'de'): Promise<NotificationLocaleState> {
  return NotificationLocaleSchema.parse(
    await customInstance<unknown>('/notifications/locale', { method: 'PUT', body: JSON.stringify({ locale }) })
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `finding` search parameter of a notification deep link, when it is a UUID. */
export function focusedFindingId(value: string | null | undefined): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

/** Minimum contract of GET /findings/:id the focused view relies on (other fields pass through). */
export const FocusedFindingSchema = z
  .object({
    id: z.string().regex(UUID_RE),
    projectId: z.string(),
    ruleId: z.string(),
    title: z.string(),
    severity: SeverityEnum,
    evidence: z.array(z.object({ artifactPath: z.string().nullable().optional() }).passthrough()).default([]),
  })
  .passthrough();

export const focusedFindingKey = (findingId: string) => ['findings', 'focused', findingId] as const;

export async function fetchFocusedFinding(findingId: string, signal?: AbortSignal): Promise<Finding> {
  const data = FocusedFindingSchema.parse(await customInstance<unknown>(`/findings/${encodeURIComponent(findingId)}`, { signal }));
  return data as unknown as Finding;
}
