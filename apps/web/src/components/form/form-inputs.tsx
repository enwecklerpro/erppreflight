'use client';

import * as React from 'react';
import { AlertTriangle, ArrowRight, ChevronDown } from 'lucide-react';
import { cn, useFormField, formatFieldError } from './form-field';

// --- FormInput ---
export interface FormInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  isMono?: boolean;
}

/**
 * Styled input component that automatically consumes FormFieldContext when nested inside FormField.
 */
export const FormInput = React.forwardRef<HTMLInputElement, FormInputProps>(
  ({ className, type = 'text', leftIcon, rightIcon, isMono = false, ...props }, ref) => {
    const fieldContext = useFormField();

    const id = props.id || fieldContext?.id;
    const name = props.name || fieldContext?.name;
    const ariaInvalid = props['aria-invalid'] ?? fieldContext?.['aria-invalid'];
    const ariaDescribedby = props['aria-describedby'] ?? fieldContext?.['aria-describedby'];
    const ariaRequired = props['aria-required'] ?? fieldContext?.['aria-required'];
    const disabled = props.disabled ?? fieldContext?.disabled;

    return (
      <div className="relative flex items-center w-full">
        {leftIcon && (
          <div className="absolute left-3 flex items-center pointer-events-none text-muted-foreground">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          id={id}
          name={name}
          type={type}
          disabled={disabled}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedby}
          aria-required={ariaRequired}
          className={cn(
            'flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-xs transition-colors',
            'placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary',
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted/50',
            ariaInvalid && 'border-destructive focus:ring-destructive focus:border-destructive',
            leftIcon && 'pl-9',
            rightIcon && 'pr-9',
            isMono && 'font-mono text-xs tracking-wider',
            className
          )}
          {...props}
        />
        {rightIcon && (
          <div className="absolute right-3 flex items-center pointer-events-none text-muted-foreground">
            {rightIcon}
          </div>
        )}
      </div>
    );
  }
);
FormInput.displayName = 'FormInput';

// --- FormTextarea ---
export interface FormTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  maxCharacters?: number;
  isMono?: boolean;
}

/**
 * Styled accessible textarea with optional character counter and FormFieldContext integration.
 */
export const FormTextarea = React.forwardRef<HTMLTextAreaElement, FormTextareaProps>(
  ({ className, maxCharacters, isMono = false, value, onChange, ...props }, ref) => {
    const fieldContext = useFormField();

    const id = props.id || fieldContext?.id;
    const name = props.name || fieldContext?.name;
    const ariaInvalid = props['aria-invalid'] ?? fieldContext?.['aria-invalid'];
    const ariaDescribedby = props['aria-describedby'] ?? fieldContext?.['aria-describedby'];
    const ariaRequired = props['aria-required'] ?? fieldContext?.['aria-required'];
    const disabled = props.disabled ?? fieldContext?.disabled;

    const currentLength = typeof value === 'string' ? value.length : 0;

    return (
      <div className="w-full space-y-1">
        <textarea
          ref={ref}
          id={id}
          name={name}
          value={value}
          onChange={onChange}
          disabled={disabled}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedby}
          aria-required={ariaRequired}
          maxLength={maxCharacters}
          className={cn(
            'flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs transition-colors',
            'placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary',
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted/50',
            ariaInvalid && 'border-destructive focus:ring-destructive focus:border-destructive',
            isMono && 'font-mono text-xs leading-relaxed',
            className
          )}
          {...props}
        />
        {maxCharacters && (
          <div
            aria-live="polite"
            className="flex justify-end text-[11px] text-muted-foreground font-mono"
          >
            <span className={cn(currentLength >= maxCharacters && 'text-destructive font-semibold')}>
              {currentLength}
            </span>
            <span>/{maxCharacters}</span>
          </div>
        )}
      </div>
    );
  }
);
FormTextarea.displayName = 'FormTextarea';

// --- FormSelect ---
export interface FormSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface FormSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options?: FormSelectOption[];
  placeholder?: string;
}

/**
 * Accessible select dropdown component with custom arrow and FormFieldContext integration.
 */
export const FormSelect = React.forwardRef<HTMLSelectElement, FormSelectProps>(
  ({ className, options, placeholder, children, ...props }, ref) => {
    const fieldContext = useFormField();

    const id = props.id || fieldContext?.id;
    const name = props.name || fieldContext?.name;
    const ariaInvalid = props['aria-invalid'] ?? fieldContext?.['aria-invalid'];
    const ariaDescribedby = props['aria-describedby'] ?? fieldContext?.['aria-describedby'];
    const ariaRequired = props['aria-required'] ?? fieldContext?.['aria-required'];
    const disabled = props.disabled ?? fieldContext?.disabled;

    return (
      <div className="relative flex items-center w-full">
        <select
          ref={ref}
          id={id}
          name={name}
          disabled={disabled}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedby}
          aria-required={ariaRequired}
          className={cn(
            'flex h-9 w-full appearance-none rounded-lg border border-input bg-background px-3 py-1.5 pr-8 text-sm text-foreground shadow-xs transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary',
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted/50',
            ariaInvalid && 'border-destructive focus:ring-destructive focus:border-destructive',
            className
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options
            ? options.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </option>
              ))
            : children}
        </select>
        <ChevronDown
          className="absolute right-2.5 size-4 pointer-events-none text-muted-foreground"
          aria-hidden="true"
        />
      </div>
    );
  }
);
FormSelect.displayName = 'FormSelect';

// --- FormCheckbox ---
export interface FormCheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode;
  description?: React.ReactNode;
}

/**
 * Accessible checkbox component with integrated label, description, and focus ring.
 */
export const FormCheckbox = React.forwardRef<HTMLInputElement, FormCheckboxProps>(
  ({ className, label, description, ...props }, ref) => {
    const fieldContext = useFormField();

    const id = props.id || fieldContext?.id;
    const name = props.name || fieldContext?.name;
    const ariaInvalid = props['aria-invalid'] ?? fieldContext?.['aria-invalid'];
    const ariaDescribedby = props['aria-describedby'] ?? fieldContext?.['aria-describedby'];
    const disabled = props.disabled ?? fieldContext?.disabled;

    return (
      <div className="flex items-start gap-2.5">
        <input
          ref={ref}
          id={id}
          name={name}
          type="checkbox"
          disabled={disabled}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedby}
          className={cn(
            'size-4 mt-0.5 rounded border border-input text-primary shadow-xs',
            'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            ariaInvalid && 'border-destructive focus:ring-destructive',
            className
          )}
          {...props}
        />
        {(label || description) && (
          <div className="grid gap-0.5 leading-none">
            {label && (
              <label
                htmlFor={id}
                className={cn(
                  'text-sm font-medium text-foreground select-none cursor-pointer',
                  disabled && 'opacity-60 cursor-not-allowed'
                )}
              >
                {label}
              </label>
            )}
            {description && (
              <p className="text-xs text-muted-foreground leading-normal">
                {description}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }
);
FormCheckbox.displayName = 'FormCheckbox';

// --- FormSummaryErrors ---
export interface FormSummaryErrorsProps {
  errors: Array<{ fieldId: string; label: string; error: unknown }>;
  className?: string;
  title?: string;
}

/**
 * Top-level form error summary banner meeting TanStack Prompt §25 & WCAG 2.2 AA.
 * Focuses corresponding input on item click and announces errors to screen readers.
 */
export function FormSummaryErrors({
  errors,
  className,
  title = 'Please correct the following errors before submitting:',
}: FormSummaryErrorsProps) {
  const activeErrors = errors
    .map((item) => ({
      fieldId: item.fieldId,
      label: item.label,
      message: formatFieldError(item.error as any),
    }))
    .filter((item): item is { fieldId: string; label: string; message: string } =>
      Boolean(item.message)
    );

  if (activeErrors.length === 0) return null;

  const handleFocusField = (fieldId: string) => {
    const element = document.getElementById(fieldId);
    if (element) {
      element.focus();
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div
      role="alert"
      aria-atomic="true"
      className={cn(
        'rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-foreground shadow-xs animate-in fade-in-50 duration-200',
        className
      )}
    >
      <div className="flex items-center gap-2 text-destructive font-semibold text-sm mb-2">
        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
        <span>{title}</span>
      </div>
      <ul className="space-y-1.5 pl-6 list-disc text-xs text-foreground/90">
        {activeErrors.map(({ fieldId, label, message }) => (
          <li key={fieldId}>
            <button
              type="button"
              onClick={() => handleFocusField(fieldId)}
              className="group inline-flex items-center gap-1 text-left text-destructive hover:underline focus:outline-none focus:ring-1 focus:ring-primary rounded-xs"
            >
              <span className="font-medium text-foreground">{label}:</span>
              <span>{message}</span>
              <ArrowRight
                className="size-3 opacity-0 group-hover:opacity-100 transition-opacity"
                aria-hidden="true"
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
