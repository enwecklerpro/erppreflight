import * as React from 'react';
import { render as rtlRender, type RenderOptions, type RenderResult } from '@testing-library/react';
import { I18nProvider } from '../i18n/client';
import type { Locale } from '../i18n/config';

export * from '@testing-library/react';

/**
 * Testing Library `render` with the i18n provider the root layout supplies in
 * the app. Defaults to English; pass `{ locale: 'de' }` to render German.
 */
export function render(ui: React.ReactElement, options: RenderOptions & { locale?: Locale } = {}): RenderResult {
  const { locale = 'en', wrapper: Inner, ...rest } = options;
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <I18nProvider locale={locale}>{Inner ? <Inner>{children}</Inner> : children}</I18nProvider>
  );
  return rtlRender(ui, { wrapper: Wrapper, ...rest });
}
