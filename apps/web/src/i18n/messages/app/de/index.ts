/**
 * Deutsches Wörterbuch der angemeldeten Anwendung (Namespace `app.*`).
 * Redaktionell übersetzt (Sie-Form, SAP-Fachbegriffe in ihrer üblichen Form).
 */
import type { AppMessages } from '../en';
import { ui } from './ui';
import { validation, apiErrors } from './validation';
import { shell } from './shell';
import { dataTable, form } from './dataTable';
import { auth } from './auth';
import { dashboard } from './dashboard';
import { engineMatrix } from './engineMatrix';
import { projects } from './projects';
import { settings } from './settings';
import { members } from './members';
import { security } from './security';
import { account } from './account';
import { commercial, billing } from './billing';
import { audit } from './audit';
import { retention } from './retention';
import { support } from './support';
import { admin } from './admin';
import { agentGate } from './agentGate';
import { matrix } from './matrix';
import { templates } from './templates';
import { landscapes } from './landscapes';
import { artifacts } from './artifacts';
import { sapNative } from './sapNative';
import { kg } from './kg';
import { notifications, inspector } from './notifications';
import { status, demo, changelog, trust, procurement, feedback, onboarding } from './platform';
import { objects } from './objects';
import { changesets } from './changesets';
import { traceability } from './traceability';
import { tenantAccess } from './tenantAccess';

export const appDe: AppMessages = {
  ui,
  validation,
  apiErrors,
  shell,
  dataTable,
  form,
  auth,
  dashboard,
  engineMatrix,
  projects,
  settings,
  members,
  security,
  account,
  commercial,
  billing,
  audit,
  retention,
  support,
  admin,
  agentGate,
  matrix,
  templates,
  landscapes,
  artifacts,
  sapNative,
  kg,
  notifications,
  inspector,
  status,
  demo,
  changelog,
  trust,
  procurement,
  feedback,
  onboarding,
  objects,
  changesets,
  traceability,
  tenantAccess,
};
