'use client';

import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Languages, Loader2 } from 'lucide-react';
import { QueryErrorState } from '@/components/knowledge-graph/kg-nav';
import { useErrorText, useT } from '@/i18n/client';
import {
  fetchNotificationLocale,
  notificationLocaleKey,
  saveNotificationLocale,
  type NotificationLocaleState,
} from '@/lib/api/platform-hardening';

const OPTIONS = ['en', 'de'] as const;

/**
 * Language of the caller's notifications (in-app texts + e-mails about assigned
 * findings). A single choice that is saved immediately, like the UI language switch.
 */
export function NotificationLanguage() {
  const t = useT();
  const errText = useErrorText();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: notificationLocaleKey, queryFn: ({ signal }) => fetchNotificationLocale(signal) });
  const save = useMutation({
    mutationFn: (locale: 'en' | 'de') => saveNotificationLocale(locale),
    onSuccess: (data: NotificationLocaleState) => qc.setQueryData(notificationLocaleKey, data),
  });

  if (query.isLoading) {
    return <div className="h-24 animate-pulse rounded-xl bg-muted/50 motion-reduce:animate-none" aria-busy="true" />;
  }
  if (query.isError || !query.data) {
    return (
      <QueryErrorState
        error={query.error}
        onRetry={() => query.refetch()}
        title={t('app.platformHardening.notificationLanguage.loadFailed')}
      />
    );
  }
  const current = save.isPending && save.variables ? save.variables : query.data.locale;

  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="notification-language-title">
      <h2 id="notification-language-title" className="inline-flex items-center gap-1.5 text-sm font-semibold">
        <Languages className="size-4" aria-hidden="true" /> {t('app.platformHardening.notificationLanguage.title')}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{t('app.platformHardening.notificationLanguage.hint')}</p>
      <fieldset className="mt-3" disabled={save.isPending}>
        <legend className="sr-only">{t('app.platformHardening.notificationLanguage.groupLabel')}</legend>
        <div className="flex flex-wrap gap-2">
          {OPTIONS.map((locale) => (
            <label
              key={locale}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                current === locale ? 'border-primary bg-primary/10 font-semibold' : 'border-border'
              }`}
            >
              <input
                type="radio"
                name="notification-language"
                value={locale}
                lang={locale}
                data-testid={`notification-locale-${locale}`}
                checked={current === locale}
                onChange={() => save.mutate(locale)}
              />
              {t(`app.platformHardening.notificationLanguage.${locale}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="mt-2 min-h-4 text-xs text-muted-foreground" aria-live="polite">
        {save.isPending ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {t('app.platformHardening.notificationLanguage.saving')}
          </span>
        ) : save.isSuccess ? (
          <span className="inline-flex items-center gap-1 text-foreground">
            <CheckCircle2 className="size-3" aria-hidden="true" /> {t('app.platformHardening.notificationLanguage.saved')}
          </span>
        ) : !query.data.explicit ? (
          t('app.platformHardening.notificationLanguage.defaultNote')
        ) : null}
      </p>
      {save.isError ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {errText(save.error, t('app.platformHardening.notificationLanguage.saveFailed'))}
        </p>
      ) : null}
    </section>
  );
}
