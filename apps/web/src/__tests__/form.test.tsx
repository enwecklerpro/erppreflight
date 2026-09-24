import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { z } from 'zod';
import { useForm } from '@tanstack/react-form';
import { FormField, formatFieldError } from '../components/form/form-field';
import {
  FormInput,
  FormTextarea,
  FormSelect,
  FormCheckbox,
  FormSummaryErrors,
} from '../components/form/form-inputs';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';

describe('TanStack Form + Zod Validation & Accessible Form Primitives', () => {
  describe('Standard Schema v1 Error Extraction (formatFieldError)', () => {
    it('extracts plain string errors directly', () => {
      expect(formatFieldError('System ID is required')).toBe('System ID is required');
    });

    it('extracts Standard Schema v1 issue objects with message property', () => {
      const issue = {
        message: 'Must be a 3-character SAP System ID (e.g. PRD)',
        code: 'custom',
        path: ['systemId'],
      };
      expect(formatFieldError(issue)).toBe('Must be a 3-character SAP System ID (e.g. PRD)');
    });

    it('extracts first valid issue from nested or array errors', () => {
      const arrayErrors = [null, undefined, { message: 'Target release must be 2023 or newer' }, 'Secondary error'];
      expect(formatFieldError(arrayErrors)).toBe('Target release must be 2023 or newer');
    });

    it('returns null for empty, null, or undefined errors', () => {
      expect(formatFieldError(null)).toBeNull();
      expect(formatFieldError(undefined)).toBeNull();
      expect(formatFieldError([null, undefined])).toBeNull();
    });
  });

  describe('FormField Accessible Layout & Non-Color Severity Presentation', () => {
    it('associates label, description, and inputs via WCAG 2.2 AA ARIA attributes', () => {
      render(
        <FormField
          id="system-sid"
          label="SAP System ID"
          description="Three-character SAP system identification code"
          required
        >
          <FormInput placeholder="e.g. PRD" />
        </FormField>
      );

      const label = screen.getByText('SAP System ID');
      const input = screen.getByPlaceholderText('e.g. PRD');
      const description = screen.getByText('Three-character SAP system identification code');

      expect(label).toHaveAttribute('for', 'system-sid');
      expect(input).toHaveAttribute('id', 'system-sid');
      expect(input).toHaveAttribute('aria-required', 'true');
      expect(input).toHaveAttribute('aria-invalid', 'false');
      expect(input).toHaveAttribute('aria-describedby', 'system-sid-description');
      expect(description).toHaveAttribute('id', 'system-sid-description');

      // Required asterisk representation
      expect(screen.getByTitle('Required field')).toHaveTextContent('*');
    });

    it('renders accessible error alert with AlertCircle icon and updates aria-describedby', () => {
      render(
        <FormField
          id="client-num"
          label="SAP Client Number"
          error={{ message: 'Client must be exactly 3 numeric digits (e.g. 100)' }}
        >
          <FormInput />
        </FormField>
      );

      const input = screen.getByLabelText('SAP Client Number');
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAttribute('aria-describedby', 'client-num-error');

      // Alert container
      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('aria-live', 'polite');
      expect(alert).toHaveTextContent('Client must be exactly 3 numeric digits (e.g. 100)');

      // SVG warning icon rendered with aria-hidden
      const icon = alert.querySelector('svg');
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('Form Inputs Integration (Textarea, Select, Checkbox)', () => {
    it('renders accessible textarea with character count indicator', () => {
      render(
        <FormField id="notes" label="Analysis Notes">
          <FormTextarea maxCharacters={200} value="Initial note" onChange={() => {}} />
        </FormField>
      );

      const textarea = screen.getByLabelText('Analysis Notes');
      expect(textarea).toHaveAttribute('id', 'notes');
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('/200')).toBeInTheDocument();
    });

    it('renders accessible select with options and chevron icon', () => {
      render(
        <FormField id="env-type" label="System Environment">
          <FormSelect
            options={[
              { value: 'DEV', label: 'Development' },
              { value: 'QAS', label: 'Quality Assurance' },
              { value: 'PRD', label: 'Production' },
            ]}
          />
        </FormField>
      );

      const select = screen.getByLabelText('System Environment');
      expect(select).toHaveAttribute('id', 'env-type');
      expect(screen.getByRole('combobox')).toHaveTextContent('Development');
    });

    it('renders accessible checkbox with label and description', () => {
      render(
        <FormField id="strict-mode" label="">
          <FormCheckbox
            id="strict-mode"
            label="Enforce Clean Core Tier 1"
            description="Strictly reject any direct database or classic modifications"
          />
        </FormField>
      );

      const checkbox = screen.getByRole('checkbox', { name: /Enforce Clean Core Tier 1/i });
      expect(checkbox).not.toBeChecked();
      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();
    });

    it('renders top-level FormSummaryErrors banner with focus navigation', () => {
      render(
        <div>
          <FormSummaryErrors
            errors={[
              { fieldId: 'field-1', label: 'System ID', error: 'System ID is missing' },
              { fieldId: 'field-2', label: 'Environment', error: 'Select valid environment' },
            ]}
          />
          <input id="field-1" data-testid="field-1" />
          <input id="field-2" data-testid="field-2" />
        </div>
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/System ID is missing/i)).toBeInTheDocument();

      const field1Btn = screen.getByRole('button', { name: /System ID:/i });
      fireEvent.click(field1Btn);
      expect(document.activeElement).toBe(screen.getByTestId('field-1'));
    });
  });

  describe('@tanstack/react-form + Zod Schema Validation Workflow', () => {
    const projectSchema = z.object({
      name: z.string().min(3, 'Project name must be at least 3 characters'),
      targetRelease: z.enum(['S4HANA_2022', 'S4HANA_2023', 'S4HANA_CLOUD'], {
        errorMap: () => ({ message: 'Please select a supported SAP target release' }),
      }),
    });

    function TestProjectForm({ onSubmitSuccess }: { onSubmitSuccess: (vals: any) => void }) {
      const form = useForm({
        defaultValues: {
          name: '',
          targetRelease: '' as any,
        },
        validators: {
          onChange: projectSchema,
        },
        onSubmit: async ({ value }) => {
          onSubmitSuccess(value);
        },
      });

      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
          <form.Field
            name="name"
            children={(field) => (
              <FormField
                id="proj-name"
                label="Project Name"
                error={field.state.meta.errors as any}
              >
                <FormInput
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Enter project name"
                />
              </FormField>
            )}
          />

          <form.Field
            name="targetRelease"
            children={(field) => (
              <FormField
                id="target-release"
                label="Target SAP Release"
                error={field.state.meta.errors as any}
              >
                <FormSelect
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value as any)}
                  options={[
                    { value: '', label: '-- Select Release --' },
                    { value: 'S4HANA_2022', label: 'SAP S/4HANA 2022' },
                    { value: 'S4HANA_2023', label: 'SAP S/4HANA 2023' },
                    { value: 'S4HANA_CLOUD', label: 'SAP S/4HANA Cloud Public Edition' },
                  ]}
                />
              </FormField>
            )}
          />

          <button type="submit">Create Workspace</button>
        </form>
      );
    }

    it('displays validation errors and prevents invalid submission', async () => {
      const onSubmit = vi.fn();
      render(<TestProjectForm onSubmitSuccess={onSubmit} />);

      const nameInput = screen.getByPlaceholderText('Enter project name');
      const submitBtn = screen.getByRole('button', { name: /Create Workspace/i });

      // Enter 1 character (invalid: min 3)
      fireEvent.change(nameInput, { target: { value: 'AB' } });

      await waitFor(() => {
        expect(screen.getByText('Project name must be at least 3 characters')).toBeInTheDocument();
      });

      // Submit form
      fireEvent.click(submitBtn);

      // Submission must not be invoked
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('submits form payload when all fields pass Zod schema validation', async () => {
      const onSubmit = vi.fn();
      render(<TestProjectForm onSubmitSuccess={onSubmit} />);

      const nameInput = screen.getByPlaceholderText('Enter project name');
      const releaseSelect = screen.getByRole('combobox');
      const submitBtn = screen.getByRole('button', { name: /Create Workspace/i });

      // Valid values
      fireEvent.change(nameInput, { target: { value: 'Migration Delta 2026' } });
      fireEvent.change(releaseSelect, { target: { value: 'S4HANA_2023' } });

      await waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });

      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith({
          name: 'Migration Delta 2026',
          targetRelease: 'S4HANA_2023',
        });
      });
    });
  });

  describe('useUnsavedChangesGuard Navigation Interception', () => {
    function GuardTester({
      isDirty,
      isSubmitting = false,
      onDiscard,
    }: {
      isDirty: boolean;
      isSubmitting?: boolean;
      onDiscard?: () => void;
    }) {
      const { shouldBlock, confirmNavigation } = useUnsavedChangesGuard({
        isDirty,
        isSubmitting,
        message: 'Discard unsaved changes?',
        onDiscard,
      });

      return (
        <div>
          <span data-testid="should-block">{String(shouldBlock)}</span>
          <button type="button" onClick={() => confirmNavigation()}>
            Manual Navigate
          </button>
          <a href="/target-page" onClick={(e) => e.preventDefault()}>
            Internal Link
          </a>
        </div>
      );
    }

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('indicates shouldBlock=true when dirty and not submitting', () => {
      render(<GuardTester isDirty={true} isSubmitting={false} />);
      expect(screen.getByTestId('should-block')).toHaveTextContent('true');
    });

    it('indicates shouldBlock=false when clean or submitting', () => {
      const { rerender } = render(<GuardTester isDirty={false} isSubmitting={false} />);
      expect(screen.getByTestId('should-block')).toHaveTextContent('false');

      rerender(<GuardTester isDirty={true} isSubmitting={true} />);
      expect(screen.getByTestId('should-block')).toHaveTextContent('false');
    });

    it('intercepts internal anchor click when dirty and blocks when user cancels', () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const onDiscard = vi.fn();

      render(<GuardTester isDirty={true} onDiscard={onDiscard} />);

      const link = screen.getByRole('link', { name: /Internal Link/i });
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(event);

      expect(confirmSpy).toHaveBeenCalledWith('Discard unsaved changes?');
      expect(event.defaultPrevented).toBe(true);
      expect(onDiscard).not.toHaveBeenCalled();
    });

    it('allows navigation and invokes onDiscard when user confirms prompt', () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const onDiscard = vi.fn();

      render(<GuardTester isDirty={true} onDiscard={onDiscard} />);

      const link = screen.getByRole('link', { name: /Internal Link/i });
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(event);

      expect(confirmSpy).toHaveBeenCalledWith('Discard unsaved changes?');
      expect(onDiscard).toHaveBeenCalledTimes(1);
    });

    it('imperatively confirms navigation via confirmNavigation() helper', () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const onDiscard = vi.fn();

      render(<GuardTester isDirty={true} onDiscard={onDiscard} />);

      const btn = screen.getByRole('button', { name: /Manual Navigate/i });
      fireEvent.click(btn);

      expect(confirmSpy).toHaveBeenCalledWith('Discard unsaved changes?');
      expect(onDiscard).toHaveBeenCalledTimes(1);
    });
  });
});
