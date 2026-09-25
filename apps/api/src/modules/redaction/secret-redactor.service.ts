import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';

export interface RedactionItem {
  category: string;
  mask: string;
  lineNumber: number;
  columnStart: number;
  columnEnd: number;
  detectionMethod: 'REGEX' | 'SHANNON_ENTROPY' | 'BLOCK_REGEX';
}

export interface RedactionResult {
  sanitizedText: string;
  redactionsCount: number;
  redactedCategories: string[];
  sha256Original: string;
  sha256Sanitized: string;
  redactions: RedactionItem[];
}

interface PatternDef {
  category: string;
  regex: RegExp;
  replacer: (match: string, ...groups: any[]) => { secret: string; template: string } | null;
}

@Injectable()
export class SecretRedactorService {
  private readonly masterKey: string;

  private static readonly ALLOWLIST = new Set<string>([
    // Core ERP Tables
    'MARA', 'MARC', 'MARD', 'VBAK', 'VBAP', 'VBEP', 'VBKD', 'VBRK', 'VBRP',
    'BKPF', 'BSEG', 'BSIS', 'BSAS', 'BSIK', 'BSAK', 'BSID', 'BSAD',
    'KNA1', 'KNB1', 'KNVV', 'LFA1', 'LFB1', 'LFM1', 'EKKO', 'EKPO', 'EKET',
    'EKKN', 'MKPF', 'MSEG', 'ACDOCA', 'FAGLFLEXA',

    // Workflow, Change Pointers & Transports
    'SWWWIHEAD', 'SWWLOGHIST', 'SWW_WI2OBJ', 'SWETYPV', 'SWZAI', 'E070', 'E071',
    'E071K', 'E070A', 'E07T', 'BD61', 'BD50', 'BD52', 'BDCP', 'BDCPS', 'BDCP2',
    'CDHDR', 'CDPOS', 'TBD62', 'TBDA2', 'BDLS', 'EDIDC', 'EDID4',

    // DDIC & System Configuration
    'DD02L', 'DD02T', 'DD03L', 'DD04L', 'DD04T', 'DD08L', 'USR02', 'USR04',
    'UST04', 'TBTCO', 'TBTCP', 'RFCDES', 'T000', 'T001', 'T001W', 'T003',
    'T005', 'TCURR', 'TVKO', 'TVAK', 'TVAP', 'TADIR', 'PROGDIR', 'TRDIR',
    'TFDIR', 'ENLFDIR', 'D010INC', 'D010TAB', 'ST03N', 'USMM',

    // Authorizations & Security
    'AGR_1251', 'AGR_AGRS', 'AGR_USERS', 'AGR_DEFINE', 'AGR_FLAGS', 'AGR_TCODES',
    'USOBT', 'USOBX', 'USOBHASH', 'S_START', 'S_SERVICE',

    // Financial & Account Determination
    'T030', 'T030K', 'VKOA', 'OBYC', 'FBKP',

    // ABAP Syntax & Structural Keywords
    'SELECT', 'WHERE', 'INTO', 'TABLE', 'APPEND', 'ASSIGN', 'FIELD-SYMBOLS',
    'CLASS-METHODS', 'ENDCLASS', 'ENDMETHOD', 'DATA', 'TYPES', 'CONSTANTS',
    'PUBLIC', 'SECTION', 'PROTECTED', 'PRIVATE',

    // MIME & Content Types
    'APPLICATION/JSON', 'APPLICATION/XML', 'TEXT/PLAIN', 'TEXT/CSV',
  ]);

  private static readonly UUID_REGEX =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  private static readonly SAP_NAMESPACE_REGEX = /^\/[A-Z0-9_]{2,10}\/[A-Z0-9_]+$/i;
  private static readonly SAP_ARCH_PREFIX_REGEX =
    /^(I_|C_|R_|P_|E_|CL_|IF_|CX_|ZCL_|ZIF_|ZCX_|BAPI_)[A-Z0-9_]+$/i;

  private static readonly PRIVATE_KEY_PATTERN =
    /-----BEGIN (?:[A-Z ]+)?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z ]+)?PRIVATE KEY(?: BLOCK)?-----/g;

  private static readonly PATTERN_DEFS: PatternDef[] = [
    {
      category: 'BEARER_TOKEN',
      regex: /\b(bearer\s+)([a-zA-Z0-9_\-\.=]{16,})\b/gi,
      replacer: (m, p1, p2) => (p2.startsWith('[REDACTED:') ? null : { secret: p2, template: `${p1}__MASK__` }),
    },
    {
      category: 'JWT',
      regex: /\b(eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_\-]{10,})\b/g,
      replacer: (m, p1) => (p1.startsWith('[REDACTED:') ? null : { secret: p1, template: '__MASK__' }),
    },
    {
      category: 'AWS_KEY',
      regex: /\b((?:AKIA|ASIA|AROA|AIPA|AGPA|AIDA)[A-Z0-9]{16})\b/g,
      replacer: (m, p1) => (p1.startsWith('[REDACTED:') ? null : { secret: p1, template: '__MASK__' }),
    },
    {
      category: 'OPENAI_KEY',
      regex: /\b(sk-(?:proj-)?[a-zA-Z0-9_-]{32,})\b/g,
      replacer: (m, p1) => (p1.startsWith('[REDACTED:') ? null : { secret: p1, template: '__MASK__' }),
    },
    {
      category: 'GITHUB_TOKEN',
      regex: /\b(gh[pousr]_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82})\b/g,
      replacer: (m, p1) => (p1.startsWith('[REDACTED:') ? null : { secret: p1, template: '__MASK__' }),
    },
    {
      category: 'SAP_RFC_PASSWORD',
      regex: /\b(rfc_pass(?:word)?|passwd|password|pwd)(\s*[:=]\s*)(?:"([^"]*)"|'([^']*)'|([^\s;,]+))/gi,
      replacer: (m, k, eq, qDouble, qSingle, unquoted) => {
        const sec = qDouble !== undefined ? qDouble : (qSingle !== undefined ? qSingle : unquoted);
        if (!sec || sec.startsWith('[REDACTED:')) return null;
        const q = qDouble !== undefined ? '"' : (qSingle !== undefined ? "'" : '');
        return { secret: sec, template: `${k}${eq}${q}__MASK__${q}` };
      },
    },
    {
      category: 'SAP_RFC_PARAMS',
      regex: /\b(ASHOST|GWHOST|SYSNR|CLIENT|USER|PASSWD|RFC_USER|RFC_PASS)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s;,]+))/gi,
      replacer: (m, k, eq, qDouble, qSingle, unquoted) => {
        const sec = qDouble !== undefined ? qDouble : (qSingle !== undefined ? qSingle : unquoted);
        if (!sec || sec.startsWith('[REDACTED:')) return null;
        const q = qDouble !== undefined ? '"' : (qSingle !== undefined ? "'" : '');
        return { secret: sec, template: `${k}${eq}${q}__MASK__${q}` };
      },
    },
    {
      category: 'SAPROUTER_PASS',
      regex: /((?:\/(?:H|S)\/[^\/\s"';]+)+\/[WP]\/)([^\/\s"';]+)/gi,
      replacer: (m, prefix, sec) => {
        if (!sec || sec.startsWith('[REDACTED:')) return null;
        return { secret: sec, template: `${prefix}__MASK__` };
      },
    },
    {
      category: 'API_KEY_GENERIC',
      regex: /\b(api[_-]?key|secret[_-]?key|client[_-]?secret)(\s*[:=]\s*['"]?)([a-zA-Z0-9_\-\.]{16,})(['"]?)/gi,
      replacer: (m, k, eq, sec, q) => (sec.startsWith('[REDACTED:') ? null : { secret: sec, template: `${k}${eq}__MASK__${q}` }),
    },
  ];

  constructor(private readonly config: ConfigService) {
    this.masterKey = this.config.get<string>(
      'MASTER_ENCRYPTION_KEY',
      'erppreflight-default-master-key-32-chars-minimum-abcdef'
    );
  }

  public getTenantKey(tenantId: string): Buffer {
    return crypto
      .createHmac('sha256', Buffer.from(this.masterKey, 'utf-8'))
      .update(tenantId)
      .digest();
  }

  public computeMask(secret: string, tenantId: string): string {
    const tenantKey = this.getTenantKey(tenantId);
    const hash = crypto.createHmac('sha256', tenantKey).update(secret).digest('hex');
    return `[REDACTED:SECRET:${hash}]`;
  }

  public calculateEntropy(str: string): number {
    const len = str.length;
    if (len === 0) return 0;
    const freqs = new Map<string, number>();
    for (let i = 0; i < len; i++) {
      const c = str[i];
      freqs.set(c, (freqs.get(c) || 0) + 1);
    }
    let entropy = 0;
    for (const count of freqs.values()) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  public isCandidateToken(token: string): boolean {
    const clean = token.replace(/^['"`,;:()\[\]{}.<>]+|['"`,;:()\[\]{}.<>]+$/g, '');
    const len = clean.length;
    if (len < 16) return false;

    // 1. Static allowlist & structural UUID exclusion
    if (SecretRedactorService.ALLOWLIST.has(clean.toUpperCase())) return false;
    if (SecretRedactorService.UUID_REGEX.test(clean)) return false;

    // 2. SAP namespace preservation (/COMPANY/..., /SDF/...)
    if (SecretRedactorService.SAP_NAMESPACE_REGEX.test(clean)) return false;

    const entropy = this.calculateEntropy(clean);
    const isHex = /^[0-9a-fA-F]+$/.test(clean);

    // 3. Hex-calibrated scanner (MD5/SHA/API hashes)
    if (isHex) {
      if (len >= 32 && entropy >= 3.20) return true;
      if (len >= 16 && entropy >= 3.00) return true;
      return false;
    }

    // 4. Preserve ABAP architectural names if entropy is within natural language bounds (H < 4.10)
    if (SecretRedactorService.SAP_ARCH_PREFIX_REGEX.test(clean) && entropy < 4.10) {
      return false;
    }

    // 5. Length-calibrated entropy scanner for Alphanumeric & Base64 secrets
    // Smooth progression: 16-23: 3.80 | 24-31: 4.00 | >= 32: 4.30
    if (len >= 16 && len <= 23 && entropy >= 3.80) return true;
    if (len >= 24 && len <= 31 && entropy >= 4.00) return true;
    if (len >= 32 && entropy >= 4.30) return true;

    return false;
  }

  public redact(text: string, tenantId: string): RedactionResult {
    const originalHash = crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
    const redactions: RedactionItem[] = [];
    const categories = new Set<string>();

    // 1. Multi-line Private Keys
    let sanitized = text;
    const privateKeyRegex = new RegExp(SecretRedactorService.PRIVATE_KEY_PATTERN);
    let pkMatch: RegExpExecArray | null;
    while ((pkMatch = privateKeyRegex.exec(text)) !== null) {
      const secret = pkMatch[0];
      const mask = this.computeMask(secret, tenantId);
      categories.add('PRIVATE_KEY');
      const linesBefore = text.slice(0, pkMatch.index).split('\n');
      const lineNo = linesBefore.length;
      const colStart = linesBefore[linesBefore.length - 1].length;
      redactions.push({
        category: 'PRIVATE_KEY',
        mask,
        lineNumber: lineNo,
        columnStart: colStart,
        columnEnd: colStart + secret.length,
        detectionMethod: 'BLOCK_REGEX',
      });
    }

    sanitized = sanitized.replace(SecretRedactorService.PRIVATE_KEY_PATTERN, (m) =>
      this.computeMask(m, tenantId)
    );

    // 2. Line by line processing
    const lines = sanitized.split('\n');
    const newLines: string[] = [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      let line = lines[lineIdx];

      // Regex pattern checks
      for (const patternDef of SecretRedactorService.PATTERN_DEFS) {
        line = line.replace(patternDef.regex, (fullMatch, ...args) => {
          const res = patternDef.replacer(fullMatch, ...args);
          if (!res) return fullMatch;
          const mask = this.computeMask(res.secret, tenantId);
          categories.add(patternDef.category);
          redactions.push({
            category: patternDef.category,
            mask,
            lineNumber: lineIdx + 1,
            columnStart: line.indexOf(fullMatch),
            columnEnd: line.indexOf(fullMatch) + fullMatch.length,
            detectionMethod: 'REGEX',
          });
          return res.template.replace('__MASK__', mask);
        });
      }

      // 3. Shannon Entropy token checks
      const alreadyRedactedHashes = new Set<string>();
      const existingMaskMatches = line.matchAll(/\[REDACTED:SECRET:([0-9a-fA-F]{64})\]/g);
      for (const m of existingMaskMatches) {
        alreadyRedactedHashes.add(m[1]);
      }

      const tokens = line.split(/(\[REDACTED:SECRET:[0-9a-fA-F]{64}\]|\s+|=|,|;|:|\(|\)|\[|\]|<|>)/);
      const rebuiltTokens: string[] = [];

      let previousToken = '';
      for (const t of tokens) {
        const cleanT = t.replace(/^['"`,;:()\[\]{}.<>]+|['"`,;:()\[\]{}.<>]+$/g, '');
        // Markup element names (`<Name`, `</Name`) and e-mail addresses are structure/PII,
        // not credentials; masking them corrupted XML artifacts before analysis.
        const isMarkupName = previousToken === '<' && /^\/?[A-Za-z_][\w.:-]*$/.test(t);
        const isEmail = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(cleanT);
        if (t !== '') previousToken = t;
        if (
          !isMarkupName &&
          !isEmail &&
          this.isCandidateToken(cleanT) &&
          !cleanT.startsWith('[REDACTED:') &&
          !alreadyRedactedHashes.has(cleanT) &&
          !t.includes('[REDACTED:')
        ) {
          const mask = this.computeMask(cleanT, tenantId);
          categories.add('HIGH_ENTROPY_TOKEN');
          redactions.push({
            category: 'HIGH_ENTROPY_TOKEN',
            mask,
            lineNumber: lineIdx + 1,
            columnStart: line.indexOf(cleanT),
            columnEnd: line.indexOf(cleanT) + cleanT.length,
            detectionMethod: 'SHANNON_ENTROPY',
          });
          rebuiltTokens.push(t.replace(cleanT, mask));
        } else {
          rebuiltTokens.push(t);
        }
      }

      newLines.push(rebuiltTokens.join(''));
    }

    const finalSanitized = newLines.join('\n');
    const sanitizedHash = crypto
      .createHash('sha256')
      .update(finalSanitized, 'utf-8')
      .digest('hex');

    return {
      sanitizedText: finalSanitized,
      redactionsCount: redactions.length,
      redactedCategories: Array.from(categories).sort(),
      sha256Original: originalHash,
      sha256Sanitized: sanitizedHash,
      redactions,
    };
  }
}
