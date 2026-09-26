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
};

export type AppMessages = typeof appEn;
