'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Eye, Loader2 } from 'lucide-react';
import { FormField, FormInput, FormSelect } from '@/components/form';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { ApiError } from '@/lib/api/custom-instance';
import {
  CreateWatchFormSchema,
  createWatch,
  fetchCatalog,
  kgKeys,
  type CreateWatchForm,
} from '@/lib/knowledge-graph';

const TYPE_OPTIONS = [
  { value: 'GAP', label: 'Gap — tell me when it becomes available' },
  { value: 'API', label: 'API — tell me about deprecations' },
  { value: 'SUCCESSOR_MAPPING', label: 'Successor mapping — tell me when the successor changes' },
  { value: 'OBJECT', label: 'Any release change of this object' },
];

/** Release watch creation (TanStack Form + Zod, dirty tracking, server errors). */
export function CreateWatchForm({ objectId, objectKey, defaultType }: { objectId: string; objectKey: string; defaultType: CreateWatchForm['watchType'] }) {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const catalog = useQuery({ queryKey: kgKeys.catalog, queryFn: ({ signal }) => fetchCatalog(signal), staleTime: 300_000 });

  const releaseOptions = [
    { value: '', label: 'All releases with a recorded state' },
    ...(catalog.data?.products.flatMap((p) =>
      p.editions.flatMap((e) => e.releases.map((r) => ({ value: r.id, label: `${e.name} — ${r.label}` })))
    ) ?? []),
  ];

  const mutation = useMutation({
    mutationFn: (value: CreateWatchForm) => createWatch({ objectId, ...value }),
    onSuccess: (w) => {
      setCreated(w.label);
      form.reset();
      void qc.invalidateQueries({ queryKey: kgKeys.watches });
    },
    onError: (err) => setServerError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not create the watch'),
  });

  const form = useForm({
    defaultValues: { watchType: defaultType, releaseId: '', label: '', notes: '' } as CreateWatchForm,
    validators: { onChange: CreateWatchFormSchema, onSubmit: CreateWatchFormSchema },
    onSubmit: async ({ value }) => {
      setServerError(null);
      setCreated(null);
      await mutation.mutateAsync(value).catch(() => undefined);
    },
  });

  return (
    <form.Subscribe
      selector={(s) => ({ isDirty: s.isDirty, isSubmitting: s.isSubmitting, canSubmit: s.canSubmit })}
      children={({ isDirty, isSubmitting, canSubmit }) => (
        <DirtyGuard isDirty={isDirty} isSubmitting={isSubmitting}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void form.handleSubmit();
            }}
            noValidate
            className="space-y-3 rounded-xl border border-border bg-card p-4"
            aria-labelledby="watch-form-title"
          >
            <h2 id="watch-form-title" className="flex items-center gap-1.5 text-sm font-semibold">
              <Eye className="size-4" aria-hidden="true" /> Watch {objectKey}
            </h2>
            {serverError ? (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                {serverError}
              </p>
            ) : null}
            {created ? (
              <p role="status" className="flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                <CheckCircle2 className="size-3.5" aria-hidden="true" /> Watching: {created}.{' '}
                <Link href="/knowledge-graph/watches" className="underline">
                  Manage watches
                </Link>
              </p>
            ) : null}
            <form.Field
              name="watchType"
              children={(field) => (
                <FormField id="watch-type" name={field.name} label="What should we watch for?" required error={field.state.meta.errors as any}>
                  <FormSelect
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value as CreateWatchForm['watchType'])}
                    onBlur={field.handleBlur}
                    options={TYPE_OPTIONS}
                  />
                </FormField>
              )}
            />
            <form.Field
              name="releaseId"
              children={(field) => (
                <FormField
                  id="watch-release"
                  name={field.name}
                  label="Release"
                  description={catalog.isError ? 'Release catalog unavailable — the watch will cover all releases.' : undefined}
                  error={field.state.meta.errors as any}
                >
                  <FormSelect
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    options={releaseOptions}
                    disabled={catalog.isLoading}
                  />
                </FormField>
              )}
            />
            <form.Field
              name="label"
              children={(field) => (
                <FormField id="watch-label" name={field.name} label="Label (optional)" error={field.state.meta.errors as any}>
                  <FormInput
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder={`e.g. ${objectKey} for the 2025 upgrade`}
                  />
                </FormField>
              )}
            />
            <button
              type="submit"
              disabled={!canSubmit || isSubmitting || mutation.isPending}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {mutation.isPending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
              {mutation.isPending ? 'Creating watch…' : 'Create release watch'}
            </button>
          </form>
        </DirtyGuard>
      )}
    />
  );
}

function DirtyGuard({ isDirty, isSubmitting, children }: { isDirty: boolean; isSubmitting: boolean; children: React.ReactNode }) {
  useUnsavedChangesGuard({ isDirty, isSubmitting });
  return <>{children}</>;
}
