/**
 * Deutsches Wörterbuch der angemeldeten Anwendung (Namespace `app.*`).
 * Redaktionell übersetzt (Sie-Form, SAP-Fachbegriffe in ihrer üblichen Form).
 */
import type { AppMessages } from '../en';
import { ui } from './ui';
import { validation, apiErrors } from './validation';
import { shell } from './shell';
import { dataTable, form } from './dataTable';

export const appDe: AppMessages = {
  ui,
  validation,
  apiErrors,
  shell,
  dataTable,
  form,
};
