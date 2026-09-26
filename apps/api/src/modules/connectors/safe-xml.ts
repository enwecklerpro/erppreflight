/**
 * Minimal, defused, non-validating XML parser for connector metadata documents
 * (OData EDMX $metadata). Hardening mirrors `defusedxml` semantics:
 *  - any DOCTYPE / ENTITY declaration is rejected (no DTDs, no external or
 *    parameter entities, no entity expansion → no XXE / billion laughs);
 *  - only the five predefined entities and numeric character references are decoded;
 *  - input size, element count, attribute count and nesting depth are bounded.
 * It is deliberately small: it only needs to read well-formed service metadata.
 */

export interface XmlElement {
  name: string; // qualified name as written (prefix:local)
  local: string; // local name
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
  line: number;
}

export class UnsafeXmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeXmlError';
  }
}

export interface SafeXmlLimits {
  maxBytes: number;
  maxElements: number;
  maxDepth: number;
  maxAttributes: number;
}

const DEFAULT_LIMITS: SafeXmlLimits = {
  maxBytes: 20 * 1024 * 1024,
  maxElements: 500_000,
  maxDepth: 64,
  maxAttributes: 256,
};

const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]*);/g, (_m, ref: string) => {
    if (ref.startsWith('#x')) return String.fromCodePoint(parseInt(ref.slice(2), 16));
    if (ref.startsWith('#')) return String.fromCodePoint(parseInt(ref.slice(1), 10));
    const v = PREDEFINED[ref];
    if (v === undefined) throw new UnsafeXmlError(`Undeclared entity reference &${ref}; rejected`);
    return v;
  });
}

const localName = (qname: string) => (qname.includes(':') ? qname.slice(qname.indexOf(':') + 1) : qname);

export function parseSafeXml(input: string | Buffer, limits: Partial<SafeXmlLimits> = {}): XmlElement {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  if (buf.length > lim.maxBytes) throw new UnsafeXmlError(`XML document exceeds ${lim.maxBytes} bytes`);
  let xml = buf.toString('utf8');
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);

  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new UnsafeXmlError('DTD / entity declarations are not allowed');
  }

  const root: XmlElement = { name: '#document', local: '#document', attrs: {}, children: [], text: '', line: 1 };
  const stack: XmlElement[] = [root];
  let elements = 0;
  let i = 0;
  let line = 1;
  const n = xml.length;

  const advanceLines = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (xml.charCodeAt(k) === 10) line++;
  };

  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      const tail = xml.slice(i);
      if (tail.trim()) stack[stack.length - 1].text += decodeEntities(tail);
      break;
    }
    if (lt > i) {
      const text = xml.slice(i, lt);
      if (stack.length > 1) stack[stack.length - 1].text += decodeEntities(text);
      advanceLines(i, lt);
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end === -1) throw new UnsafeXmlError('Unterminated processing instruction');
      advanceLines(lt, end);
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end === -1) throw new UnsafeXmlError('Unterminated comment');
      advanceLines(lt, end);
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end === -1) throw new UnsafeXmlError('Unterminated CDATA section');
      stack[stack.length - 1].text += xml.slice(lt + 9, end);
      advanceLines(lt, end);
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      throw new UnsafeXmlError('Markup declarations are not allowed');
    }
    // Find end of tag, honouring quoted attribute values.
    let j = lt + 1;
    let quote: string | null = null;
    while (j < n) {
      const c = xml[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
      j++;
    }
    if (j >= n) throw new UnsafeXmlError('Unterminated tag');
    const raw = xml.slice(lt + 1, j);
    const tagLine = line;
    advanceLines(lt, j);
    i = j + 1;

    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      const open = stack.pop();
      if (!open || open.name !== name || stack.length === 0) {
        throw new UnsafeXmlError(`Mismatched closing tag </${name}> at line ${tagLine}`);
      }
      continue;
    }

    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = body.match(/^([A-Za-z_][\w.:-]*)/);
    if (!nameMatch) throw new UnsafeXmlError(`Invalid tag at line ${tagLine}`);
    const name = nameMatch[1];
    const attrs: Record<string, string> = {};
    const attrRe = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    let count = 0;
    const rest = body.slice(name.length);
    while ((m = attrRe.exec(rest)) !== null) {
      if (++count > lim.maxAttributes) throw new UnsafeXmlError('Too many attributes');
      attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
    }
    if (++elements > lim.maxElements) throw new UnsafeXmlError('Too many elements');
    const el: XmlElement = { name, local: localName(name), attrs, children: [], text: '', line: tagLine };
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) {
      stack.push(el);
      if (stack.length - 1 > lim.maxDepth) throw new UnsafeXmlError('XML nesting too deep');
    }
  }
  if (stack.length !== 1) throw new UnsafeXmlError(`Unclosed element <${stack[stack.length - 1].name}>`);
  const docRoot = root.children[0];
  if (!docRoot || root.children.length !== 1) throw new UnsafeXmlError('XML document must have exactly one root element');
  return docRoot;
}

export function childrenByLocal(el: XmlElement, local: string): XmlElement[] {
  return el.children.filter((c) => c.local === local);
}

export function findAll(el: XmlElement, local: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of el.children) {
    if (c.local === local) out.push(c);
    findAll(c, local, out);
  }
  return out;
}
