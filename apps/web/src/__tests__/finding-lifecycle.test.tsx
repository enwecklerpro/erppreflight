import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { FindingStatusEnum } from '@erppreflight/schemas';
import { I18nProvider } from '../i18n/client';
import { createTranslator } from '../i18n/translate';
import { FindingStatusBadge } from '../components/findings/finding-status-badge';
import { findingLifecycleFilters, withLifecycleColumns } from '../components/findings/finding-lifecycle-columns';

vi.mock('next/navigation', () => ({ usePathname: () => '/projects/p/findings', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

describe('finding lifecycle UI', () => {
  it('status badges carry icon, text and an ARIA label for every status (never colour alone)', () => {
    for (const status of FindingStatusEnum.options) {
      const { unmount, container } = render(
        <I18nProvider locale="en">
          <FindingStatusBadge status={status} />
        </I18nProvider>
      );
      const badge = screen.getByRole('status');
      expect(badge.getAttribute('aria-label')).toMatch(/^Finding status: /);
      expect(badge.textContent?.trim().length).toBeGreaterThan(2);
      expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      unmount();
    }
  });

  it('localizes status labels (DE)', () => {
    render(
      <I18nProvider locale="de">
        <FindingStatusBadge status="ACCEPTED_RISK" />
      </I18nProvider>
    );
    expect(screen.getByRole('status').textContent).toContain('Risiko akzeptiert');
  });

  it('inserts status / owner / due columns after the title column and exposes server filters', () => {
    const t = createTranslator('en');
    const cols = withLifecycleColumns([{ id: 'select' }, { id: 'title' }, { id: 'severity' }] as never, t);
    expect(cols.map((c) => c.id)).toEqual(['select', 'title', 'status', 'assignee', 'due', 'severity']);
    const filters = findingLifecycleFilters(t);
    expect(filters.map((f) => f.id)).toEqual(['status', 'assignee', 'due']);
    expect(filters[0].options).toHaveLength(7);
    expect(filters[1].singleSelect).toBe(true);
  });
});
