/**
 * English dictionary for the authenticated application (namespace `app.*`).
 * One file per page/feature; the German counterparts live in `../de/` with the
 * same file names and are typed against these objects, so missing or extra keys
 * are compile errors. Human-written, reviewed copy only (Part 02 §2.7).
 */
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
import { integrations } from './integrations';
import { findings } from './findings';
import { notificationText } from './notificationText';
import { apiErrorCodes } from './apiErrorCodes';
import { lab } from './lab';
import { workspace } from './workspace';

export const appEn = {
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
  integrations,
  findings,
  workspace,
  lab,
  apiErrorCodes,
  notificationText,
};

export type AppMessages = typeof appEn;
