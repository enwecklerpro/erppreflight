'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useStore } from '@tanstack/react-form';
import { z } from 'zod';
import {
  Activity,
  Database,
  Eye,
  EyeOff,
  GitBranch,
  KeyRound,
  Lock,
  Plug,
  Plus,
  Power,
  ScrollText,
  Trash2,
  Unlock,
} from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSelect } from '@/components/form/form-inputs';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { vmsg } from '@/i18n/validation';
import {
  Connector,
  ConnectorTypeSpec,
  FieldSpec,
  ConnectionTest,
  createConnector,
  deleteConnector,
  fetchConnectorTypes,
  fetchConnectors,
  fetchMetadataSnapshot,
  fetchSyncLog,
  gitSnapshot,
  testConnector,
  updateConnector,
} from '@/lib/api/integrations';
import {
  Button,
  Card,
  CircuitBadge,
  ConfirmButton,
  HealthBadge,
  OutcomeBadge,
  PanelEmpty,
  PanelError,
  PanelLoading,
  StatusBadge,
  useIntegrationText,
} from './ui';

export const connectorKeys = {
  all: ['integrations', 'connectors'] as const,
  types: ['integrations', 'connector-types'] as const,
  syncLog: (id: string) => ['integrations', 'connectors', id, 'sync-log'] as const,
};

const SECRET_FIELD = /secret|password|token|apikey|personalaccesstoken/i;

/** Technical field names from the connector registry, e.g. `baseUrl` → `Base Url`. */
function humanize(name: string) {
  return name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

/** Client-side Zod schema derived from the server registry (server validates strictly again). */
export function buildFieldSchema(fields: FieldSpec[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    let s: z.ZodTypeAny = z.string();
    if (/url$/i.test(f.name)) s = z.string().url(vmsg('app.integrations.connectors.urlInvalid'));
    if (f.kind === 'enum' && f.options) s = z.enum(f.options as [string, ...string[]]);
    shape[f.name] = f.required
      ? (s as z.ZodString).min?.(1, vmsg('app.integrations.connectors.fieldRequired', { field: humanize(f.name) })) ?? s
      : z.union([s, z.literal('')]);
  }
  return z.object(shape);
}

function AddConnectorForm({ types, onDone }: { types: ConnectorTypeSpec[]; onDone: () => void }) {
  const { t, errorText } = useIntegrationText();
  const queryClient = useQueryClient();
  const creatable = types.filter((ct) => !ct.systemManaged);
  const [type, setType] = React.useState(creatable[0]?.type ?? '');
  const spec = creatable.find((ct) => ct.type === type);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [showSecrets, setShowSecrets] = React.useState(false);

  const mutation = useMutation({
    mutationFn: createConnector,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectorKeys.all });
      onDone();
    },
    onError: (err) => setServerError(errorText(err)),
  });

  const initialValues = React.useMemo(() => {
    const v: Record<string, string> = { name: '', accessMode: 'READ_ONLY' };
    for (const f of [...(spec?.configFields ?? []), ...(spec?.credentialFields ?? [])]) {
      v[`${f.name}`] = f.defaultValue !== undefined ? String(f.defaultValue) : '';
    }
    return v;
  }, [spec]);

  const form = useForm({
    defaultValues: initialValues,
    validators: {
      onSubmit: ({ value }) => {
        if (!spec) return vmsg('app.integrations.connectors.selectType');
        const errors: Record<string, string> = {};
        if (!value.name || value.name.trim().length < 2) errors.name = vmsg('app.integrations.connectors.nameMin');
        const schema = buildFieldSchema([...spec.configFields, ...spec.credentialFields]);
        const parsed = schema.safeParse(value);
        if (!parsed.success) for (const i of parsed.error.issues) errors[String(i.path[0])] = i.message;
        return Object.keys(errors).length ? { fields: errors } : undefined;
      },
    },
    onSubmit: async ({ value }) => {
      if (!spec) return;
      setServerError(null);
      const pick = (fields: FieldSpec[]) =>
        Object.fromEntries(
          fields
            .filter((f) => value[f.name] !== undefined && value[f.name] !== '')
            .map((f) => [f.name, f.kind === 'number' ? Number(value[f.name]) : value[f.name]])
        );
      const credentials = pick(spec.credentialFields);
      await mutation.mutateAsync({
        type: spec.type,
        name: value.name.trim(),
        config: pick(spec.configFields),
        credentials: Object.keys(credentials).length ? credentials : undefined,
        accessMode: value.accessMode,
      });
    },
  });

  React.useEffect(() => {
    form.reset(initialValues);
  }, [initialValues, form]);

  const isDirty = useStore(form.store, (s) => s.isDirty);
  const isSubmitting = useStore(form.store, (s) => s.isSubmitting);
  useUnsavedChangesGuard({ isDirty, isSubmitting });

  const renderField = (f: FieldSpec, secret: boolean) => (
    <form.Field
      key={f.name}
      name={f.name}
      children={(field) => (
        <FormField id={`conn-${f.name}`} name={f.name} label={humanize(f.name)} required={f.required} error={field.state.meta.errors as any}>
          {f.kind === 'enum' ? (
            <FormSelect value={field.state.value ?? ''} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} options={(f.options ?? []).map((o) => ({ value: o, label: o }))} />
          ) : (
            <FormInput
              type={secret && !showSecrets ? 'password' : f.kind === 'number' ? 'number' : 'text'}
              autoComplete={secret ? 'new-password' : 'off'}
              isMono={secret || /url/i.test(f.name)}
              value={field.state.value ?? ''}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
            />
          )}
        </FormField>
      )}
    />
  );

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="space-y-4 rounded-lg border border-border p-4 bg-background"
      aria-label={t('app.integrations.connectors.formLabel')}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField id="conn-type" name="type" label={t('app.integrations.connectors.type')} required>
          <FormSelect value={type} onChange={(e) => setType(e.target.value)} options={creatable.map((ct) => ({ value: ct.type, label: ct.displayName }))} />
        </FormField>
        <form.Field
          name="name"
          children={(field) => (
            <FormField id="conn-name" name="name" label={t('app.integrations.connectors.name')} required error={field.state.meta.errors as any}>
              <FormInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} placeholder={t('app.integrations.connectors.namePlaceholder')} />
            </FormField>
          )}
        />
      </div>

      {spec && (
        <div className="rounded-lg bg-muted/50 dark:bg-muted-dark/40 p-3 text-xs space-y-2">
          <p className="text-muted-foreground">{spec.description}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <p className="font-semibold text-foreground">{t('app.integrations.connectors.permissions')}</p>
              <ul className="mt-1 space-y-0.5">
                {spec.scopes.map((s) => (
                  <li key={s.scope} className="flex items-start gap-1.5">
                    {s.access === 'WRITE' ? (
                      <Unlock className="size-3 mt-0.5 text-amber-600" aria-label={t('app.integrations.connectors.scopeWrite')} />
                    ) : (
                      <Lock className="size-3 mt-0.5 text-emerald-600" aria-label={t('app.integrations.connectors.scopeRead')} />
                    )}
                    <span>
                      <code className="font-mono">{s.scope}</code> — {s.why}
                      {s.optional && ` ${t('app.integrations.connectors.optional')}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground">{t('app.integrations.connectors.cannotAccess')}</p>
              <ul className="mt-1 list-disc pl-4">
                {spec.cannotAccess.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {spec && spec.configFields.length > 0 && (
        <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <legend className="text-xs font-semibold text-foreground mb-1">{t('app.integrations.connectors.configuration')}</legend>
          {spec.configFields.map((f) => renderField(f, false))}
        </fieldset>
      )}
      {spec && spec.credentialFields.length > 0 && (
        <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <legend className="text-xs font-semibold text-foreground mb-1 flex items-center gap-2">
            <KeyRound className="size-3.5" aria-hidden="true" /> {t('app.integrations.connectors.credentials')}
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setShowSecrets((v) => !v)}
              aria-label={showSecrets ? t('app.integrations.connectors.hideSecrets') : t('app.integrations.connectors.showSecrets')}
            >
              {showSecrets ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </legend>
          {spec.credentialFields.map((f) => renderField(f, SECRET_FIELD.test(f.name)))}
        </fieldset>
      )}
      {spec && spec.writeActions.length > 0 && (
        <form.Field
          name="accessMode"
          children={(field) => (
            <FormField id="conn-access" name="accessMode" label={t('app.integrations.connectors.accessMode')} description={t('app.integrations.connectors.accessModeHint')}>
              <FormSelect
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                options={[
                  { value: 'READ_ONLY', label: t('app.integrations.connectors.readOnlyRecommended') },
                  {
                    value: 'READ_WRITE',
                    label: t('app.integrations.connectors.readWriteOption', { actions: spec.writeActions.map((w) => w.action).join(', ') }),
                  },
                ]}
              />
            </FormField>
          )}
        />
      )}

      {serverError && (
        <p role="alert" className="text-xs text-destructive">
          {serverError}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" busy={isSubmitting || mutation.isPending}>
          <Plus className="size-3.5" aria-hidden="true" /> {t('app.integrations.connectors.save')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('app.integrations.common.cancel')}
        </Button>
      </div>
    </form>
  );
}

function SyncLog({ id }: { id: string }) {
  const { t, formatDate } = useIntegrationText();
  const q = useQuery({ queryKey: connectorKeys.syncLog(id), queryFn: () => fetchSyncLog(id) });
  if (q.isLoading) return <PanelLoading rows={2} label={t('app.integrations.connectors.syncLog.loading')} />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} what={t('app.integrations.connectors.syncLog.what')} />;
  if (!q.data?.length) return <p className="text-xs text-muted-foreground">{t('app.integrations.connectors.syncLog.empty')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">{t('app.integrations.connectors.syncLog.caption')}</caption>
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1 pr-3 font-medium">{t('app.integrations.connectors.syncLog.when')}</th>
            <th className="py-1 pr-3 font-medium">{t('app.integrations.connectors.syncLog.operation')}</th>
            <th className="py-1 pr-3 font-medium">{t('app.integrations.connectors.syncLog.outcome')}</th>
            <th className="py-1 pr-3 font-medium">{t('app.integrations.connectors.syncLog.duration')}</th>
            <th className="py-1 font-medium">{t('app.integrations.connectors.syncLog.detail')}</th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((e) => (
            <tr key={e.id} className="border-t border-border align-top">
              <td className="py-1 pr-3 whitespace-nowrap">{formatDate(e.createdAt)}</td>
              <td className="py-1 pr-3 font-mono">{e.operation}</td>
              <td className="py-1 pr-3">
                <OutcomeBadge outcome={e.outcome} />
              </td>
              <td className="py-1 pr-3">{e.durationMs != null ? t('app.integrations.connectors.syncLog.ms', { ms: e.durationMs }) : '—'}</td>
              <td className="py-1 text-muted-foreground break-words max-w-md">{e.error ?? e.objectRef ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConnectorRow({ c, types }: { c: Connector; types: ConnectorTypeSpec[] }) {
  const { t, errorText, relative } = useIntegrationText();
  const queryClient = useQueryClient();
  const spec = types.find((ct) => ct.type === c.type);
  const [open, setOpen] = React.useState(false);
  const [lastTest, setLastTest] = React.useState<ConnectionTest | null>(null);
  const [actionResult, setActionResult] = React.useState<string | null>(null);
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: connectorKeys.all });
    queryClient.invalidateQueries({ queryKey: connectorKeys.syncLog(c.id) });
  };
  const test = useMutation({ mutationFn: () => testConnector(c.id), onSuccess: (r) => { setLastTest(r); invalidate(); } });
  const toggle = useMutation({ mutationFn: () => updateConnector(c.id, { status: c.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }), onSuccess: invalidate });
  const grantWrite = useMutation({
    mutationFn: () => updateConnector(c.id, c.accessMode === 'READ_ONLY' ? { accessMode: 'READ_WRITE', confirmWriteAccess: true } : { accessMode: 'READ_ONLY' }),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: () => deleteConnector(c.id), onSuccess: invalidate });
  const metadata = useMutation({
    mutationFn: () => (c.type === 'GIT' ? gitSnapshot(c.id) : fetchMetadataSnapshot(c.id)),
    onSuccess: (r) => {
      setActionResult(
        c.type === 'GIT'
          ? t('app.integrations.connectors.gitSnapshot', {
              commit: String(r.commit).slice(0, 12),
              files: String(r.totalFiles),
              abap: String(r.abapFiles),
              types: JSON.stringify(r.objectTypes),
            })
          : t('app.integrations.connectors.baselineStored', {
              protocol: String(r.protocolVersion),
              sha: String(r.contentSha256).slice(0, 12),
              summary: JSON.stringify(r.summary),
            }) + (r.changedSincePrevious ? t('app.integrations.connectors.baselineChanged') : '')
      );
      invalidate();
    },
    onError: (e) => setActionResult(errorText(e)),
  });
  const mutationError = [test, toggle, grantWrite, remove].find((m) => m.isError)?.error;

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-col lg:flex-row lg:items-center gap-2 justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{c.name}</p>
          <p className="text-xs text-muted-foreground">
            {spec?.displayName ?? c.type} · {t('app.integrations.connectors.lastSuccess', { when: relative(c.health.lastSuccessAt) })} ·{' '}
            {t('app.integrations.connectors.lastFailure', { when: relative(c.health.lastFailureAt) })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <HealthBadge status={c.status === 'DISABLED' ? 'UNKNOWN' : c.health.status} />
          <CircuitBadge state={c.health.circuitState} />
          {c.accessMode === 'READ_WRITE' ? (
            <StatusBadge tone="warn" icon={Unlock} label={t('app.integrations.connectors.readWrite')} />
          ) : (
            <StatusBadge tone="ok" icon={Lock} label={t('app.integrations.connectors.readOnly')} />
          )}
          {c.status === 'DISABLED' && <StatusBadge tone="neutral" icon={Power} label={t('app.integrations.common.disabled')} />}
          {c.credentialsRotationDue && <StatusBadge tone="warn" icon={KeyRound} label={t('app.integrations.connectors.rotationDue')} />}
        </div>
      </div>
      {c.health.lastError && c.health.status !== 'HEALTHY' && (
        <p className="mt-1 text-xs text-destructive break-words">{t('app.integrations.connectors.lastError', { error: c.health.lastError })}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button variant="secondary" onClick={() => test.mutate()} busy={test.isPending} disabled={c.status !== 'ACTIVE'}>
          <Activity className="size-3.5" aria-hidden="true" /> {t('app.integrations.connectors.test')}
        </Button>
        {(c.type === 'ODATA' || c.type === 'HTTP_OPENAPI' || c.type === 'GIT') && (
          <Button variant="secondary" onClick={() => metadata.mutate()} busy={metadata.isPending} disabled={c.status !== 'ACTIVE'}>
            {c.type === 'GIT' ? <GitBranch className="size-3.5" aria-hidden="true" /> : <Database className="size-3.5" aria-hidden="true" />}
            {c.type === 'GIT' ? t('app.integrations.connectors.snapshotBranch') : t('app.integrations.connectors.fetchBaseline')}
          </Button>
        )}
        <Button variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <ScrollText className="size-3.5" aria-hidden="true" />{' '}
          {open ? t('app.integrations.connectors.hideCallLog') : t('app.integrations.connectors.showCallLog')}
        </Button>
        {spec && spec.writeActions.length > 0 && !spec.systemManaged && (
          c.accessMode === 'READ_ONLY' ? (
            <ConfirmButton
              label={<><Unlock className="size-3.5" aria-hidden="true" /> {t('app.integrations.connectors.allowWrites')}</>}
              confirmLabel={t('app.integrations.connectors.confirmAllowWrites', { count: spec.writeActions.length })}
              variant="primary"
              onConfirm={() => grantWrite.mutate()}
              busy={grantWrite.isPending}
            />
          ) : (
            <Button variant="secondary" onClick={() => grantWrite.mutate()} busy={grantWrite.isPending}>
              <Lock className="size-3.5" aria-hidden="true" /> {t('app.integrations.connectors.makeReadOnly')}
            </Button>
          )
        )}
        {c.type !== 'LOCAL_AGENT' && (
          <>
            <Button variant="ghost" onClick={() => toggle.mutate()} busy={toggle.isPending}>
              <Power className="size-3.5" aria-hidden="true" />{' '}
              {c.status === 'ACTIVE' ? t('app.integrations.common.disable') : t('app.integrations.common.enable')}
            </Button>
            <ConfirmButton
              label={<><Trash2 className="size-3.5" aria-hidden="true" /> {t('app.integrations.common.delete')}</>}
              confirmLabel={t('app.integrations.connectors.deleteConfirm')}
              onConfirm={() => remove.mutate()}
              busy={remove.isPending}
            />
          </>
        )}
      </div>
      {mutationError != null && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {errorText(mutationError)}
        </p>
      )}
      {lastTest && (
        <div role="status" className={`mt-2 rounded-md border p-2 text-xs ${lastTest.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-destructive/30 bg-destructive/5'}`}>
          <p className="font-semibold">
            {lastTest.ok
              ? t('app.integrations.connectors.connectionOk', { message: lastTest.message })
              : t('app.integrations.connectors.connectionFailed', { message: lastTest.message })}
          </p>
          {lastTest.ok && lastTest.capabilities && (
            <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <p className="font-medium">{t('app.integrations.connectors.canRead')}</p>
                <ul className="list-disc pl-4">{(lastTest.capabilities.readable ?? []).map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
              <div>
                <p className="font-medium">{t('app.integrations.connectors.cannotAccess')}</p>
                <ul className="list-disc pl-4">{(lastTest.capabilities.notAccessible ?? []).map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            </div>
          )}
        </div>
      )}
      {actionResult && <p role="status" className="mt-2 text-xs text-muted-foreground break-words">{actionResult}</p>}
      {open && (
        <div className="mt-3">
          <SyncLog id={c.id} />
        </div>
      )}
    </li>
  );
}

export function ConnectorsPanel() {
  const { t } = useIntegrationText();
  const types = useQuery({ queryKey: connectorKeys.types, queryFn: fetchConnectorTypes, staleTime: 5 * 60_000 });
  const connectors = useQuery({ queryKey: connectorKeys.all, queryFn: fetchConnectors });
  const [adding, setAdding] = React.useState(false);

  return (
    <Card
      title={t('app.integrations.connectors.title')}
      description={t('app.integrations.connectors.description')}
      actions={
        !adding && (
          <Button onClick={() => setAdding(true)} disabled={!types.data}>
            <Plus className="size-3.5" aria-hidden="true" /> {t('app.integrations.connectors.add')}
          </Button>
        )
      }
    >
      {adding && types.data && (
        <div className="mb-4">
          <AddConnectorForm types={types.data} onDone={() => setAdding(false)} />
        </div>
      )}
      {connectors.isLoading || types.isLoading ? (
        <PanelLoading label={t('app.integrations.connectors.loading')} />
      ) : connectors.isError || types.isError ? (
        <PanelError error={connectors.error ?? types.error} onRetry={() => { connectors.refetch(); types.refetch(); }} what={t('app.integrations.connectors.what')} />
      ) : !connectors.data?.length ? (
        <PanelEmpty
          icon={Plug}
          title={t('app.integrations.connectors.emptyTitle')}
          body={t('app.integrations.connectors.emptyBody')}
          action={<Button onClick={() => setAdding(true)}><Plus className="size-3.5" aria-hidden="true" /> {t('app.integrations.connectors.addFirst')}</Button>}
        />
      ) : (
        <ul className="space-y-2">
          {connectors.data.map((c) => (
            <ConnectorRow key={c.id} c={c} types={types.data ?? []} />
          ))}
        </ul>
      )}
    </Card>
  );
}
