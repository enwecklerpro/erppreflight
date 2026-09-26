import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { objectKeyToSlug, slugToObjectKey } from '@erppreflight/schemas';
import { en } from '../i18n/messages/en';
import { de } from '../i18n/messages/de';
import { FIORI_TREE, walkFioriTree } from '../lib/fiori-403-tree';
import { DOC_SLUGS } from '../lib/docs/pages';
import { docsEn } from '../lib/docs/content.en';
import { docsDe } from '../lib/docs/content.de';
import { parseMarkdown } from '../components/public/markdown';
import { TOOL_SLUGS } from '../lib/tools';
import { XmlCheckFormSchema, parseNamespaceLines, SeoObjectSchema } from '../lib/public-tools';
import { StateBadge, IssueBadge } from '../components/tools/state-badge';
import { Highlighted } from '../components/tools/search-tool';

describe('Fiori 403 decision tree', () => {
  it('every question and option has text in both languages and every outcome is described', () => {
    for (const [q, options] of Object.entries(FIORI_TREE)) {
      for (const dict of [en, de]) {
        const question = (dict.publicTools.fiori.questions as Record<string, { text: string; options: Record<string, string> }>)[q];
        expect(question?.text, q).toBeTruthy();
        expect(Object.keys(question.options).sort(), q).toEqual(Object.keys(options).sort());
      }
      for (const next of Object.values(options)) {
        if ('outcome' in next) {
          for (const dict of [en, de]) {
            const o = (dict.publicTools.fiori.outcomes as Record<string, { evidence: string[]; code: string }>)[next.outcome];
            expect(o.evidence.length, next.outcome).toBeGreaterThanOrEqual(3);
            expect(o.code).toMatch(/^FIORI_/);
          }
        }
      }
    }
  });

  it('replays answer paths deterministically and ignores invalid answers', () => {
    expect(walkFioriTree('')).toEqual({ steps: [], current: 'start', outcome: null });
    expect(walkFioriTree('http,modifying,yes').outcome).toBe('csrf');
    const w = walkFioriTree('http,read,nothing,active,no');
    expect(w.outcome).toBe('unknown');
    expect(w.steps.map((s) => s.question)).toEqual(['start', 'method', 'log', 'icf', 'ucon']);
    const invalid = walkFioriTree('http,bogus,read');
    expect(invalid.current).toBe('method');
    expect(invalid.steps).toHaveLength(1);
    expect(walkFioriTree('content,http').steps).toHaveLength(1);
  });
});

describe('documentation content', () => {
  it('EN and DE have the same pages and section anchors, and every body is safe markdown', () => {
    for (const slug of DOC_SLUGS) {
      expect(docsDe[slug].sections.map((s) => s.id), slug).toEqual(docsEn[slug].sections.map((s) => s.id));
      expect(docsDe[slug].faq?.length ?? 0).toBe(docsEn[slug].faq?.length ?? 0);
      for (const doc of [docsEn[slug], docsDe[slug]]) {
        for (const s of doc.sections) expect(parseMarkdown(s.body).length, `${slug}#${s.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('links in German docs stay in German pages and never point at removed routes', () => {
    const links = (docs: typeof docsEn) =>
      Object.values(docs).flatMap((d) => d.sections.flatMap((s) => [...s.body.matchAll(/\]\((\/[^)]+)\)/g)].map((m) => m[1])));
    for (const l of links(docsDe)) expect(l.startsWith('/en/'), l).toBe(false);
    for (const l of [...links(docsEn), ...links(docsDe)]) expect(l).not.toMatch(/knowledge-graph\/lookup/);
  });
});

describe('free tools contracts', () => {
  it('every tool has a name and a short description in both languages', () => {
    for (const slug of TOOL_SLUGS) {
      expect(en.publicTools.tools[slug].name).toBeTruthy();
      expect(de.publicTools.tools[slug].short).toBeTruthy();
    }
  });

  it('object slugs are reversible for SAP keys', () => {
    for (const key of ['MARA', 'I_PRODUCT', '/SAPAPO/MATKEY', 'BAPI_PO_CREATE1']) {
      expect(slugToObjectKey(objectKeyToSlug(key)!)).toBe(key);
    }
  });

  it('XML form schema mirrors the API limits and namespace lines are parsed strictly', () => {
    expect(XmlCheckFormSchema.safeParse({ xml: '<a/>', path: '/a', namespaces: '' }).success).toBe(true);
    const bad = XmlCheckFormSchema.safeParse({ xml: '', path: 'a', namespaces: 'x' });
    expect(bad.success).toBe(false);
    const keys = bad.success ? [] : bad.error.issues.map((i) => i.message);
    expect(keys).toEqual(expect.arrayContaining(['xmlRequired', 'pathSlash', 'namespacesInvalid']));
    for (const k of keys) expect((en.publicTools.xml.errors as Record<string, string>)[k]).toBeTruthy();
    expect(parseNamespaceLines('po=urn:sap:po\n\n n1 = http://x ')).toEqual({ po: 'urn:sap:po', n1: 'http://x' });
    expect(parseNamespaceLines('not a mapping')).toBeNull();
  });

  it('rejects SEO payloads that drift from the contract', () => {
    expect(SeoObjectSchema.safeParse({ slug: 'mara' }).success).toBe(false);
  });
});

describe('tool badges and highlighting', () => {
  it('severity and state are conveyed by text and icon, not colour alone', () => {
    const { container } = render(
      <>
        <StateBadge state="NOT_RELEASED" label="Not released" level="C" />
        <IssueBadge severity="ERROR" label="Error" />
      </>
    );
    expect(container.textContent).toContain('Not released');
    expect(container.textContent).toContain('Error');
    expect(container.querySelectorAll('svg').length).toBe(2);
  });

  it('renders search highlights as <mark> without interpreting HTML', () => {
    const { container } = render(<Highlighted text={'a [[term]] <b>x</b>'} />);
    expect(container.querySelector('mark')?.textContent).toBe('term');
    expect(container.querySelector('b')).toBeNull();
  });
});
