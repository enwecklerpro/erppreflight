'use client';

import * as React from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, FileUp, Loader2, RotateCcw, SearchCheck, XCircle } from 'lucide-react';
import { useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/translate';
import { FormField, FormInput, FormTextarea } from '@/components/form';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { ApiError } from '@/lib/api/custom-instance';
import {
  XML_CHECK_MAX_CHARS,
  XmlCheckFormSchema,
  parseNamespaceLines,
  postXmlCheck,
  type XmlCheckForm,
  type XmlCheckResult,
} from '@/lib/public-tools';
import { IssueBadge } from './state-badge';
import { ToolError } from './client-common';

function DirtyGuard({ isDirty, isSubmitting, message }: { isDirty: boolean; isSubmitting: boolean; message: string }) {
  useUnsavedChangesGuard({ isDirty, isSubmitting, message });
  return null;
}

function Result({ result }: { result: XmlCheckResult }) {
  const t = useT();
  if (!result.wellFormed) {
    return (
      <div role="status" className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100" data-testid="xml-result" data-exists="false">
        <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">{t('publicTools.xml.notWellFormed')}</p>
          <p className="mt-1 font-mono text-xs">{result.error}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="xml-result" data-exists={String(result.exists)}>
      <div
        role="status"
        className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${
          result.exists
            ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100'
            : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
        }`}
      >
        {result.exists ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
        <p className="font-semibold">
          {result.exists ? t('publicTools.xml.exists', { count: result.matchCount }) : t('publicTools.xml.missing')}{' '}
          <span className="font-mono font-normal">{result.path}</span>
        </p>
      </div>

      {result.matches.length > 0 ? (
        <ul className="space-y-2">
          {result.matches.map((m) => (
            <li key={`${m.path}-${m.line}-${m.column}`} className="rounded-lg border border-border bg-card p-3 text-xs">
              <p className="font-mono font-semibold break-all">{m.path}</p>
              <dl className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-[max-content_1fr]">
                <dt className="text-muted-foreground">{t('publicTools.xml.value')}</dt>
                <dd className="font-mono break-all" data-testid="xml-value">
                  {m.value ?? <span className="italic text-muted-foreground">{t('publicTools.xml.empty')}</span>}
                  {m.valueTruncated ? <span className="ml-1 text-muted-foreground">({t('publicTools.xml.truncated')})</span> : null}
                </dd>
                <dt className="text-muted-foreground">{t('publicTools.xml.namespace')}</dt>
                <dd className="font-mono break-all">{m.namespaceUri ?? t('publicTools.xml.noNamespace')}</dd>
                <dt className="text-muted-foreground">·</dt>
                <dd>
                  {t('publicTools.xml.location', { line: m.line, column: m.column })}
                  {m.childElementCount > 0 ? ` · ${t('publicTools.xml.children', { count: m.childElementCount })}` : ''}
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      ) : null}

      {result.issues.length > 0 ? (
        <section aria-labelledby="xml-issues-title" className="space-y-1.5">
          <h3 id="xml-issues-title" className="text-sm font-semibold">
            {t('publicTools.xml.issues')}
          </h3>
          <ul className="space-y-1.5" data-testid="xml-issues">
            {result.issues.map((i) => (
              <li key={`${i.code}-${i.step ?? ''}`} className="flex flex-wrap items-start gap-2 text-xs">
                <IssueBadge severity={i.severity} label={t(`publicTools.xml.severity.${i.severity}` as MessageKey)} />
                <span className="font-mono text-muted-foreground">{i.code}</span>
                <span className="basis-full sm:basis-auto sm:flex-1">{i.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.document ? (
        <section className="rounded-lg border border-border bg-muted/30 p-3 text-xs" aria-label={t('publicTools.xml.document')}>
          <p>
            <strong>{t('publicTools.xml.root')}:</strong> <span className="font-mono">{result.document.rootLocalName}</span>
            {result.document.rootNamespaceUri ? <span className="font-mono text-muted-foreground"> ({result.document.rootNamespaceUri})</span> : null} ·{' '}
            {t('publicTools.xml.elements', { count: result.document.elementCount, depth: result.document.maxDepth })}
          </p>
          {result.document.namespaces.length > 0 ? (
            <p className="mt-1">
              <strong>{t('publicTools.xml.declared')}:</strong>{' '}
              {result.document.namespaces.map((n) => (
                <span key={`${n.prefix}-${n.uri}-${n.line}`} className="mr-2 font-mono">
                  {n.prefix || '(default)'}={n.uri}
                </span>
              ))}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/**
 * Basic form XML field checker: TanStack Form + Zod (client), the API re-validates
 * and the analysis service parses with defusedxml in memory. Nothing is stored.
 */
export function XmlFieldCheckerTool() {
  const t = useT();
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<unknown>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: (v: XmlCheckForm) =>
      postXmlCheck({ xml: v.xml, path: v.path.trim(), namespaces: parseNamespaceLines(v.namespaces) ?? undefined }),
    onMutate: () => setServerError(null),
    onError: (err) => setServerError(err),
  });

  const form = useForm({
    defaultValues: { xml: '', path: '', namespaces: '' } as XmlCheckForm,
    validators: { onChange: XmlCheckFormSchema, onSubmit: XmlCheckFormSchema },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(value).catch(() => undefined);
    },
  });

  const msg = (errors: unknown[]) => {
    const first = errors.find(Boolean) as { message?: string } | string | undefined;
    const key = typeof first === 'string' ? first : first?.message;
    return key ? t(`publicTools.xml.errors.${key}` as MessageKey) : undefined;
  };

  const loadFile = async (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    if (file.size > XML_CHECK_MAX_CHARS * 4) {
      setFileError(t('publicTools.xml.fileTooLarge'));
      return;
    }
    try {
      const text = await file.text();
      if (text.length > XML_CHECK_MAX_CHARS) {
        setFileError(t('publicTools.xml.fileTooLarge'));
        return;
      }
      form.setFieldValue('xml', text);
    } catch {
      setFileError(t('publicTools.xml.fileUnreadable'));
    }
  };

  const badRequest = serverError instanceof ApiError && serverError.statusCode === 400;

  return (
    <section className="space-y-5" aria-label={t('publicTools.tools.xml-field-checker.name')}>
      <form.Subscribe selector={(s) => ({ isDirty: s.isDirty, isSubmitting: s.isSubmitting })}>
        {({ isDirty, isSubmitting }) => <DirtyGuard isDirty={isDirty} isSubmitting={isSubmitting} message={t('publicTools.xml.unsaved')} />}
      </form.Subscribe>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
        noValidate
        className="space-y-4 rounded-xl border border-border bg-card p-4"
        data-testid="xml-form"
      >
        <form.Field name="xml">
          {(field) => (
            <FormField
              id="xml-doc"
              name={field.name}
              label={t('publicTools.xml.xmlLabel')}
              description={t('publicTools.xml.xmlHelp')}
              required
              error={field.state.meta.isTouched ? msg(field.state.meta.errors) : undefined}
            >
              <FormTextarea
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                rows={10}
                isMono
                spellCheck={false}
                maxCharacters={XML_CHECK_MAX_CHARS}
                placeholder={'<?xml version="1.0"?>\n<data>…</data>'}
              />
            </FormField>
          )}
        </form.Field>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".xml,.xdp,.xsd,.wsdl,text/xml,application/xml"
            className="sr-only"
            id="xml-file"
            onChange={(e) => void loadFile(e.target.files?.[0])}
            data-testid="xml-file"
          />
          <label
            htmlFor="xml-file"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted focus-within:ring-2 focus-within:ring-primary"
          >
            <FileUp className="size-3.5" aria-hidden="true" /> {t('publicTools.xml.upload')}
          </label>
          {fileError ? (
            <p role="alert" className="text-xs text-destructive">
              {fileError}
            </p>
          ) : null}
        </div>
        <form.Field name="path">
          {(field) => (
            <FormField
              id="xml-path"
              name={field.name}
              label={t('publicTools.xml.pathLabel')}
              description={t('publicTools.xml.pathHelp')}
              required
              error={field.state.meta.isTouched ? msg(field.state.meta.errors) : undefined}
            >
              <FormInput
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                isMono
                autoComplete="off"
                spellCheck={false}
                placeholder={t('publicTools.xml.pathPlaceholder')}
              />
            </FormField>
          )}
        </form.Field>
        <form.Field name="namespaces">
          {(field) => (
            <FormField
              id="xml-ns"
              name={field.name}
              label={t('publicTools.xml.nsLabel')}
              description={t('publicTools.xml.nsHelp')}
              error={field.state.meta.isTouched ? msg(field.state.meta.errors) : undefined}
            >
              <FormTextarea
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                rows={2}
                isMono
                spellCheck={false}
                placeholder="po=urn:sap:po"
              />
            </FormField>
          )}
        </form.Field>
        {badRequest && serverError instanceof Error ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive" data-testid="xml-server-error">
            {serverError.message}
          </p>
        ) : null}
        <form.Subscribe selector={(s) => ({ canSubmit: s.canSubmit, isSubmitting: s.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={!canSubmit || isSubmitting || mutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                data-testid="xml-submit"
              >
                {mutation.isPending ? (
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <SearchCheck className="size-4" aria-hidden="true" />
                )}
                {mutation.isPending ? t('publicTools.xml.checking') : t('publicTools.xml.submit')}
              </button>
              <button
                type="button"
                onClick={() => {
                  form.reset();
                  mutation.reset();
                  setServerError(null);
                  setFileError(null);
                  if (fileInput.current) fileInput.current.value = '';
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted"
              >
                <RotateCcw className="size-4" aria-hidden="true" /> {t('publicTools.xml.reset')}
              </button>
            </div>
          )}
        </form.Subscribe>
        <p className="text-[11px] text-muted-foreground">{t('publicTools.xml.privacy')}</p>
      </form>
      <div aria-live="polite">
        {mutation.isPending ? (
          <div className="h-24 animate-pulse rounded-xl border border-border bg-muted/40 motion-reduce:animate-none" aria-busy="true" />
        ) : serverError && !badRequest ? (
          <ToolError error={serverError} onRetry={() => void form.handleSubmit()} />
        ) : mutation.data ? (
          <Result result={mutation.data} />
        ) : null}
      </div>
    </section>
  );
}
