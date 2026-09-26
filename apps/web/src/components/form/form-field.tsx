'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useT, useTranslateMessage } from '../../i18n/client';

/**
 * Utility for merging Tailwind CSS classes safely with clsx.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Standard Schema v1 Issue format returned by Zod and TanStack Form 1.x
 */
export interface StandardSchemaIssue {
  message: string;
  path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
  code?: string;
  [key: string]: unknown;
}

export type FormFieldError =
  | string
  | StandardSchemaIssue
  | null
  | undefined
  | Array<string | StandardSchemaIssue | null | undefined>;

/**
 * Extracts a human-readable string error from any TanStack Form / Standard Schema error format.
 */
export function formatFieldError(error: FormFieldError): string | null {
  if (!error) return null;
  if (Array.isArray(error)) {
    for (const item of error) {
      const formatted = formatFieldError(item);
      if (formatted) return formatted;
    }
    return null;
  }
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}

/**
 * Accessibility props injected into form inputs by FormField
 */
export interface InjectedFieldProps {
  id: string;
  name?: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
  'aria-required': boolean;
  disabled?: boolean;
}

/**
 * Context provided by FormField to child inputs
 */
export interface FormFieldContextValue extends InjectedFieldProps {
  error: string | null;
}

export const FormFieldContext = React.createContext<FormFieldContextValue | null>(null);

export function useFormField() {
  const context = React.useContext(FormFieldContext);
  return context;
}

export interface FormFieldProps {
  id?: string;
  name?: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  error?: FormFieldError;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  children:
    | React.ReactNode
    | ((props: InjectedFieldProps) => React.ReactNode);
}

/**
 * Accessible FormField primitive conforming to WCAG 2.2 AA and Cardinal Axiom 1.
 * Provides programmatic association of label, description, aria-invalid, aria-describedby,
 * and field error alert container.
 */
export function FormField({
  id: explicitId,
  name,
  label,
  description,
  error,
  required = false,
  disabled = false,
  className,
  children,
}: FormFieldProps) {
  const generatedId = React.useId();
  const id = explicitId || name || `field-${generatedId}`;

  const t = useT();
  const translateMessage = useTranslateMessage();
  const rawError = formatFieldError(error);
  const errorMessage = rawError ? translateMessage(rawError) : null;
  const hasError = Boolean(errorMessage);

  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = hasError ? `${id}-error` : undefined;

  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  const injectedProps: InjectedFieldProps = {
    id,
    name,
    'aria-invalid': hasError,
    'aria-describedby': describedBy,
    'aria-required': required,
    disabled,
  };

  const contextValue: FormFieldContextValue = {
    ...injectedProps,
    error: errorMessage,
  };

  return (
    <FormFieldContext.Provider value={contextValue}>
      <div className={cn('space-y-1.5', className)}>
        <div className="flex items-center justify-between">
          <label
            htmlFor={id}
            className={cn(
              'block text-sm font-medium text-foreground select-none',
              disabled && 'opacity-60 cursor-not-allowed'
            )}
          >
            {label}
            {required && (
              <span
                className="text-destructive font-bold ml-1"
                aria-hidden="true"
                title={t('app.ui.requiredField')}
              >
                *
              </span>
            )}
          </label>
        </div>

        {description && (
          <p id={descriptionId} className="text-xs text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}

        <div className="relative">
          {typeof children === 'function' ? children(injectedProps) : children}
        </div>

        {hasError && (
          <div
            id={errorId}
            role="alert"
            aria-live="polite"
            className="flex items-start gap-1.5 text-xs font-medium text-destructive mt-1.5 animate-in fade-in-50 duration-150"
          >
            <AlertCircle className="size-3.5 shrink-0 mt-0.5 text-destructive" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>
    </FormFieldContext.Provider>
  );
}
FormField.displayName = 'FormField';

export default FormField;
