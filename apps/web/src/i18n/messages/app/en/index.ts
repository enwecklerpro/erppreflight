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
};

export type AppMessages = typeof appEn;
