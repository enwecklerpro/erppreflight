import * as React from 'react';
import { SapObjectType } from '@erppreflight/schemas';
import { useT } from '../../i18n/client';
import {
  FileCode2,
  Boxes,
  Workflow,
  Cpu,
  Database,
  Layers,
  Shield,
  Terminal,
  FileSpreadsheet,
  FileBox,
} from 'lucide-react';
import { ObjectTypeBadgeProps } from './types';

const TYPE_CONFIG: Record<
  SapObjectType,
  { label: string; icon: React.ComponentType<{ className?: string }>; colorClasses: string }
> = {
  PROG: {
    label: 'PROG',
    icon: FileCode2,
    colorClasses:
      'bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800',
  },
  CLAS: {
    label: 'CLAS',
    icon: Boxes,
    colorClasses:
      'bg-purple-50 text-purple-800 border-purple-300 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800',
  },
  INTF: {
    label: 'INTF',
    icon: Workflow,
    colorClasses:
      'bg-indigo-50 text-indigo-800 border-indigo-300 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800',
  },
  FUGR: {
    label: 'FUGR',
    icon: Cpu,
    colorClasses:
      'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
  },
  TABL: {
    label: 'TABL',
    icon: Database,
    colorClasses:
      'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  },
  CDS: {
    label: 'CDS',
    icon: Layers,
    colorClasses:
      'bg-violet-50 text-violet-800 border-violet-300 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800',
  },
  VIEW: {
    label: 'VIEW',
    icon: Database,
    colorClasses:
      'bg-teal-50 text-teal-800 border-teal-300 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800',
  },
  DTEL: {
    label: 'DTEL',
    icon: FileBox,
    colorClasses:
      'bg-slate-50 text-slate-800 border-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700',
  },
  DOMA: {
    label: 'DOMA',
    icon: FileBox,
    colorClasses:
      'bg-slate-50 text-slate-800 border-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700',
  },
  TRAN: {
    label: 'TRAN',
    icon: Terminal,
    colorClasses:
      'bg-pink-50 text-pink-800 border-pink-300 dark:bg-pink-950/40 dark:text-pink-300 dark:border-pink-800',
  },
  AUTH: {
    label: 'AUTH',
    icon: Shield,
    colorClasses:
      'bg-zinc-50 text-zinc-800 border-zinc-300 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-700',
  },
  DEVC: {
    label: 'DEVC',
    icon: Boxes,
    colorClasses:
      'bg-blue-50 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
  },
  FORM: {
    label: 'FORM',
    icon: FileSpreadsheet,
    colorClasses:
      'bg-orange-50 text-orange-800 border-orange-300 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800',
  },
  BADI: {
    label: 'BADI',
    icon: Workflow,
    colorClasses:
      'bg-cyan-50 text-cyan-800 border-cyan-300 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-800',
  },
  ENHO: {
    label: 'ENHO',
    icon: Workflow,
    colorClasses:
      'bg-yellow-50 text-yellow-800 border-yellow-300 dark:bg-yellow-950/40 dark:text-yellow-300 dark:border-yellow-800',
  },
  WSDL: {
    label: 'WSDL',
    icon: Cpu,
    colorClasses:
      'bg-lime-50 text-lime-800 border-lime-300 dark:bg-lime-950/40 dark:text-lime-300 dark:border-lime-800',
  },
};

export function ObjectTypeBadge({
  type,
  className = '',
  size = 'default',
  showIcon = true,
}: ObjectTypeBadgeProps) {
  const t = useT();
  const conf = TYPE_CONFIG[type] || {
    label: type,
    icon: FileCode2,
    colorClasses: 'bg-muted text-muted-foreground border-border',
  };
  const Icon = conf.icon;
  const isSm = size === 'sm';

  return (
    <span
      role="status"
      aria-label={t('app.objects.typeAria', { type: conf.label })}
      className={`inline-flex items-center gap-1 font-mono font-semibold border rounded select-none transition-colors ${
        isSm ? 'px-1.5 py-0.2 text-[10px]' : 'px-2 py-0.5 text-[11px]'
      } ${conf.colorClasses} ${className}`}
    >
      {showIcon && <Icon className={`${isSm ? 'size-2.5' : 'size-3'} shrink-0`} aria-hidden="true" />}
      <span>{conf.label}</span>
    </span>
  );
}
