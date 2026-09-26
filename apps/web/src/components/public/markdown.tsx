import React from 'react';
import Link from 'next/link';

/**
 * Minimal, safe Markdown renderer for knowledge articles.
 *
 * Supported: headings (#–####), paragraphs, unordered/ordered lists, fenced code
 * blocks, inline code, **bold**, *italic* / _italic_ and [links](url).
 * Everything is rendered as React elements — raw HTML in the source is shown as
 * text, never injected. Links are limited to site-relative paths and http(s) URLs.
 */

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'link'; href: string; external: boolean; children: InlineNode[] };

export type Block =
  | { type: 'heading'; level: 2 | 3 | 4; children: InlineNode[] }
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] }
  | { type: 'code'; language: string | null; value: string };

const INLINE_PATTERN =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s][^*\n]*\*)|(_[^_\s][^_\n]*_)/g;

/** Returns a safe href or null. Relative paths must be site-absolute ("/...") and not protocol-relative. */
export function sanitizeHref(href: string): { href: string; external: boolean } | null {
  const trimmed = href.trim();
  if (/^\/(?!\/)[^\s]*$/.test(trimmed)) return { href: trimmed, external: false };
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'https:' || url.protocol === 'http:') return { href: url.toString(), external: true };
  } catch {
    // not an absolute URL
  }
  return null;
}

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push({ type: 'text', value: text.slice(last, index) });
    const token = match[0];
    if (match[1]) {
      nodes.push({ type: 'code', value: token.slice(1, -1) });
    } else if (match[2]) {
      nodes.push({ type: 'strong', children: parseInline(token.slice(2, -2)) });
    } else if (match[3]) {
      const m = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
      const safe = sanitizeHref(m[2]);
      if (safe) {
        nodes.push({ type: 'link', href: safe.href, external: safe.external, children: parseInline(m[1]) });
      } else {
        nodes.push({ type: 'text', value: m[1] });
      }
    } else {
      nodes.push({ type: 'em', children: parseInline(token.slice(1, -1)) });
    }
    last = index + token.length;
  }
  if (last < text.length) nodes.push({ type: 'text', value: text.slice(last) });
  return nodes;
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map(parseInline) });
      list = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```\s*([\w-]+)?\s*$/);
    if (fence) {
      flushParagraph();
      flushList();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code', language: fence[1] ?? null, value: body.join('\n') });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(4, Math.max(2, heading[1].length)) as 2 | 3 | 4;
      blocks.push({ type: 'heading', level, children: parseInline(heading[2]) });
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      // continuation line of the previous list item
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

function renderInline(nodes: InlineNode[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.type) {
      case 'text':
        return <React.Fragment key={key}>{node.value}</React.Fragment>;
      case 'code':
        return (
          <code key={key} className="font-mono text-[0.9em] px-1 py-0.5 rounded bg-muted text-foreground">
            {node.value}
          </code>
        );
      case 'strong':
        return <strong key={key}>{renderInline(node.children, key)}</strong>;
      case 'em':
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case 'link':
        return node.external ? (
          <a key={key} href={node.href} rel="noopener noreferrer" className="text-primary underline underline-offset-2">
            {renderInline(node.children, key)}
          </a>
        ) : (
          <Link key={key} href={node.href} className="text-primary underline underline-offset-2">
            {renderInline(node.children, key)}
          </Link>
        );
    }
  });
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="space-y-4 text-[15px] leading-7 text-foreground">
      {blocks.map((block, i) => {
        const key = `b${i}`;
        switch (block.type) {
          case 'heading': {
            const Tag = `h${block.level}` as 'h2' | 'h3' | 'h4';
            const size = block.level === 2 ? 'text-xl mt-8' : block.level === 3 ? 'text-lg mt-6' : 'text-base mt-4';
            return (
              <Tag key={key} className={`${size} font-bold tracking-tight`}>
                {renderInline(block.children, key)}
              </Tag>
            );
          }
          case 'paragraph':
            return <p key={key}>{renderInline(block.children, key)}</p>;
          case 'list': {
            const ListTag = block.ordered ? 'ol' : 'ul';
            return (
              <ListTag key={key} className={`${block.ordered ? 'list-decimal' : 'list-disc'} pl-6 space-y-1.5`}>
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </ListTag>
            );
          }
          case 'code':
            return (
              <pre key={key} className="overflow-x-auto rounded-lg border border-border bg-muted p-4 text-sm">
                <code className="font-mono">{block.value}</code>
              </pre>
            );
        }
      })}
    </div>
  );
}
