'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Ban, CheckCircle2, Clock, Cpu, FolderSearch, KeyRound, ShieldCheck, Upload } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSelect } from '@/components/form/form-inputs';
import {
  AgentDevice,
  createDeviceJob,
  fetchDeviceJobs,
  fetchDevices,
  issueEnrollmentToken,
  revokeDevice,
  updateDevicePolicy,
} from '@/lib/api/integrations';
import { Button, Card, ConfirmButton, OneTimeSecret, OutcomeBadge, PanelEmpty, PanelError, PanelLoading, StatusBadge, errorMessage, formatDate, relative } from './ui';

const keys = {
  devices: ['integrations', 'agents'] as const,
  jobs: (id: string) => ['integrations', 'agents', id, 'jobs'] as const,
};

const STALE_MS = 5 * 60_000;

const JobSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SCAN_DIRECTORY'), target: z.string().trim().min(1, 'Directory is required').startsWith('/', 'Use an absolute path inside the agent’s allowed scan roots') }),
  z.object({ type: z.literal('PROBE_URL'), target: z.string().trim().url('Enter an http(s) URL') }),
]);

function JobForm({ device }: { device: AgentDevice }) {
  const qc = useQueryClient();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const create = useMutation({
    mutationFn: (v: z.infer<typeof JobSchema>) =>
      createDeviceJob(device.id, v.type === 'SCAN_DIRECTORY' ? { type: 'SCAN_DIRECTORY', payload: { directory: v.target } } : { type: 'PROBE_URL', payload: { url: v.target } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.jobs(device.id) }),
    onError: (e) => setServerError(errorMessage(e)),
  });
  const form = useForm({
    defaultValues: { type: 'SCAN_DIRECTORY', target: '' } as { type: 'SCAN_DIRECTORY' | 'PROBE_URL'; target: string },
    validators: { onSubmit: JobSchema as any },
    onSubmit: async ({ value, formApi }) => {
      setServerError(null);
      await create.mutateAsync(value as z.infer<typeof JobSchema>);
      formApi.reset();
    },
  });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="grid grid-cols-1 sm:grid-cols-[10rem_1fr_auto] gap-2 items-end"
      aria-label={`Queue a signed job for ${device.name}`}
    >
      <form.Field
        name="type"
        children={(f) => (
          <FormField id={`job-type-${device.id}`} name="type" label="Job">
            <FormSelect value={f.state.value} onChange={(e) => f.handleChange(e.target.value as any)} options={[{ value: 'SCAN_DIRECTORY', label: 'Scan directory' }, { value: 'PROBE_URL', label: 'Probe SAP URL' }]} />
          </FormField>
        )}
      />
      <form.Field
        name="target"
        children={(f) => (
          <FormField id={`job-target-${device.id}`} name="target" label="Target" error={f.state.meta.errors as any}>
            <FormInput isMono value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} placeholder="/data/exports  or  https://sap-prd.corp:44300" />
          </FormField>
        )}
      />
      <form.Subscribe selector={(s) => s.isSubmitting} children={(busy) => <Button type="submit" busy={busy}>Queue signed job</Button>} />
      {serverError && <p role="alert" className="sm:col-span-3 text-xs text-destructive">{serverError}</p>}
    </form>
  );
}

function Jobs({ device }: { device: AgentDevice }) {
  const q = useQuery({ queryKey: keys.jobs(device.id), queryFn: () => fetchDeviceJobs(device.id), refetchInterval: 10_000 });
  if (q.isLoading) return <PanelLoading rows={1} label="Loading jobs" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} what="jobs" />;
  if (!q.data?.length) return <p className="text-xs text-muted-foreground">No jobs yet.</p>;
  return (
    <ul className="space-y-1 text-xs">
      {q.data.slice(0, 10).map((j) => (
        <li key={j.id} className="flex flex-wrap items-center gap-2 border-t border-border pt-1">
          <span className="font-mono">{j.type}</span>
          <OutcomeBadge outcome={j.status === 'COMPLETED' ? 'SUCCESS' : j.status === 'REJECTED' ? 'BLOCKED' : j.status === 'DISPATCHED' || j.status === 'QUEUED' ? 'PENDING' : j.status} />
          <span className="text-muted-foreground">{formatDate(j.createdAt)}</span>
          {j.result?.summary && (
            <span className="text-muted-foreground">
              {j.result.summary.files} file(s), {j.result.summary.secretsRedacted} secret(s) redacted locally
              {Array.isArray(j.result.ingested) && j.result.ingested.length > 0 && `, ${j.result.ingested.length} uploaded`}
            </span>
          )}
          {j.result?.probe && <span className="text-muted-foreground">reachable: {String(j.result.probe.isReachable)} · HTTP {j.result.probe.statusCode ?? '—'}</span>}
          {j.error && <span className="text-destructive">{j.error}</span>}
        </li>
      ))}
    </ul>
  );
}

function DeviceItem({ d }: { d: AgentDevice }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.devices });
  const revoke = useMutation({ mutationFn: () => revokeDevice(d.id), onSuccess: invalidate });
  const policy = useMutation({ mutationFn: (upload: boolean) => updateDevicePolicy(d.id, upload), onSuccess: invalidate });
  const stale = !d.lastSeenAt || Date.now() - new Date(d.lastSeenAt).getTime() > STALE_MS;
  return (
    <li className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{d.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {d.hostname ?? 'unknown host'} · v{d.agentVersion ?? '?'} · {d.platform ?? ''} · key <span className="font-mono">{d.publicKeyFingerprint.slice(0, 16)}…</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {d.status === 'REVOKED' ? (
            <StatusBadge tone="bad" icon={Ban} label="Revoked" />
          ) : stale ? (
            <StatusBadge tone="warn" icon={Clock} label={`Last seen ${relative(d.lastSeenAt)}`} />
          ) : (
            <StatusBadge tone="ok" icon={CheckCircle2} label={`Online · ${relative(d.lastSeenAt)}`} />
          )}
          <StatusBadge tone="ok" icon={ShieldCheck} label="Local redaction on" />
          {d.egressPolicy.uploadRawFiles ? <StatusBadge tone="warn" icon={Upload} label="Uploads redacted files" /> : <StatusBadge tone="info" icon={FolderSearch} label="Manifest only" />}
        </div>
      </div>
      {d.status === 'ACTIVE' && (
        <>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="secondary" onClick={() => policy.mutate(!d.egressPolicy.uploadRawFiles)} busy={policy.isPending}>
              {d.egressPolicy.uploadRawFiles ? 'Stop uploading files' : 'Allow redacted file uploads'}
            </Button>
            <ConfirmButton label={<><Ban className="size-3.5" aria-hidden="true" /> Revoke device</>} confirmLabel="Revoke now" onConfirm={() => revoke.mutate()} busy={revoke.isPending} />
          </div>
          <JobForm device={d} />
        </>
      )}
      {(revoke.isError || policy.isError) && <p role="alert" className="text-xs text-destructive">{errorMessage(revoke.error ?? policy.error)}</p>}
      <Jobs device={d} />
    </li>
  );
}

export function AgentsPanel() {
  const q = useQuery({ queryKey: keys.devices, queryFn: fetchDevices, refetchInterval: 30_000 });
  const [token, setToken] = React.useState<{ value: string; expiresAt: string } | null>(null);
  const issue = useMutation({
    mutationFn: () => issueEnrollmentToken('web', 60),
    onSuccess: (r) => setToken({ value: r.enrollmentToken, expiresAt: r.expiresAt }),
  });
  const apiOrigin = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/api\/v1\/?$/, '') || 'https://api.example.com';
  return (
    <Card
      title="Local agents"
      description="Outbound-only on-premise agents with an Ed25519 device identity. Jobs are signed by ERP Preflight and verified by the agent; secrets are redacted on the device before anything leaves the network."
      actions={
        <Button onClick={() => issue.mutate()} busy={issue.isPending}>
          <KeyRound className="size-3.5" aria-hidden="true" /> Issue enrollment token
        </Button>
      }
    >
      {issue.isError && <p role="alert" className="mb-2 text-xs text-destructive">{errorMessage(issue.error)}</p>}
      {token && (
        <div className="mb-3 space-y-2">
          <OneTimeSecret label={`Single-use enrollment token (expires ${formatDate(token.expiresAt)})`} value={token.value} onDismiss={() => setToken(null)} />
          <pre className="overflow-x-auto rounded-md bg-muted/60 dark:bg-muted-dark/60 p-2 text-[11px] font-mono">{`docker run --rm -v erppf-agent:/var/lib/erppreflight erppreflight/local-agent enroll ${apiOrigin} <TOKEN> --name plant-01
docker run -d --read-only -v erppf-agent:/var/lib/erppreflight -v /srv/sap/exports:/data/exports:ro \\
  -e ERP_PREFLIGHT_AGENT_SCAN_ROOTS=/data/exports erppreflight/local-agent daemon`}</pre>
        </div>
      )}
      {q.isLoading ? (
        <PanelLoading label="Loading devices" />
      ) : q.isError ? (
        <PanelError error={q.error} onRetry={() => q.refetch()} what="devices" />
      ) : !q.data?.length ? (
        <PanelEmpty icon={Cpu} title="No agents enrolled" body="Issue an enrollment token and run the agent container inside your network. It only makes outbound HTTPS calls." />
      ) : (
        <ul className="space-y-2">
          {q.data.map((d) => (
            <DeviceItem key={d.id} d={d} />
          ))}
        </ul>
      )}
    </Card>
  );
}

