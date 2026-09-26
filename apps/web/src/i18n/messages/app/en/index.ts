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

export const appEn = {
  ui,
  validation,
  apiErrors,
  shell,
  dataTable,
  form,
};

export type AppMessages = typeof appEn;
