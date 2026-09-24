/**
 * Empirical Adversarial Challenge & Stress-Testing Suite for Redaction & Entropy (TypeScript Runtime).
 * Directly tests NestJS SecretRedactorService against all requirement dimensions:
 * 1. Candidate tokens across lengths 16, 20, 22, 24, 32, 64 (Hex, Alphanumeric, Base64).
 * 2. Quoted RFC passwords with semicolons, commas, spaces, hashes.
 * 3. SAProuter connection strings (with /S/3299, multi-hop, /P/, terminal).
 * 4. SAP technical objects & DDIC (MARA, BKPF, SWWWIHEAD, ZCUSTOM_TABLE_01, /COMPANY/..., I_PRODUCT...).
 * 5. Boundary conditions, sub-threshold tokens, low-entropy repetitions.
 * 6. End-to-end redaction pipeline integration and deterministic mask verification.
 */

import { describe, it, expect } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { SecretRedactorService } from '../src/modules/redaction/secret-redactor.service';

describe('Empirical Challenger Suite: Redaction & Entropy Stress Harness (TypeScript)', () => {
  const config = new ConfigService({
    MASTER_ENCRYPTION_KEY: 'adversarial-challenge-master-key-32chars',
  });
  const redactor = new SecretRedactorService(config);
  const tenantId = 'c1111111-1111-1111-1111-111111111111';

  // ============================================================================
  // 1. CANDIDATE TOKENS ACROSS LENGTHS 16, 20, 22, 24, 32, 64 (Hex, Alnum, Base64)
  // ============================================================================
  describe('1. Candidate Tokens Across Lengths and Types', () => {
    const candidateVectors = [
      // Length 16
      { name: 'hex_16', token: '4f9b8c2e1d0a3f5b', len: 16, isCandidate: true },
      { name: 'alnum_16', token: 'k9Z1mP4vL8wQ2xR7', len: 16, isCandidate: true },
      { name: 'base64_16', token: 'u7V/k9LmP2wQ4xR1', len: 16, isCandidate: true },

      // Length 20
      { name: 'hex_20', token: '4f9b8c2e1d0a3f5b7c8e', len: 20, isCandidate: true },
      { name: 'alnum_unique_20', token: 'abcdefghijklmnopqrst', len: 20, isCandidate: true },
      { name: 'alnum_crypto_20', token: 'k9Z1mP4vL8wQ2xR7jA3b', len: 20, isCandidate: true },
      { name: 'base64_20', token: 'c2VjcmV0L3Rva2VuKzEy', len: 20, isCandidate: true },

      // Length 22
      { name: 'hex_22', token: '4f9b8c2e1d0a3f5b7c8e9d', len: 22, isCandidate: true },
      { name: 'alnum_unique_22', token: 'abcdefghijklmnopqrstuv', len: 22, isCandidate: true },
      { name: 'alnum_crypto_22', token: 'k9Z1mP4vL8wQ2xR7jA3bC5', len: 22, isCandidate: true },
      { name: 'base64_22', token: 'YWJjL2RlZjEya2xtbm9wK3', len: 22, isCandidate: true },

      // Length 24
      { name: 'hex_24', token: '4f9b8c2e1d0a3f5b7c8e9d0a', len: 24, isCandidate: true },
      { name: 'alnum_unique_24', token: 'abcdefghijklmnopqrstuvwx', len: 24, isCandidate: true },
      { name: 'alnum_crypto_24', token: 'k9Z1mP4vL8wQ2xR7jA3bC5dE', len: 24, isCandidate: true },
      { name: 'base64_24', token: 'ZXhwZWN0L3NlY3JldCsyNHh5', len: 24, isCandidate: true },

      // Length 32
      { name: 'hex_32', token: '4f9b8c2e1d0a3f5b7c8e9d0a1b2c3d4e', len: 32, isCandidate: true },
      { name: 'alnum_32', token: 'k9Z1mP4vL8wQ2xR7jA3bC5dEfG8hI0jK', len: 32, isCandidate: true },
      { name: 'base64_32', token: 'dGVzdC9zZWNyZXQvdG9rZW4rMzJfYnl0', len: 32, isCandidate: true },

      // Length 64
      { name: 'hex_64', token: '4f9b8c2e1d0a3f5b7c8e9d0a1b2c3d4e4f9b8c2e1d0a3f5b7c8e9d0a1b2c3d4e', len: 64, isCandidate: true },
      { name: 'alnum_64', token: 'k9Z1mP4vL8wQ2xR7jA3bC5dEfG8hI0jK1mP4vL8wQ2xR7jA3bC5dEfG8hI0jKabC', len: 64, isCandidate: true },
      { name: 'base64_64', token: 'dGVzdC9zZWNyZXQvdG9rZW4rMzJfYnl0ZXNfZm9yX2FkdmVyc2FyaWFsX3ZhbGlk', len: 64, isCandidate: true },
    ];

    it.each(candidateVectors)(
      'accurately detects candidate token $name (L=$len)',
      ({ name, token, len, isCandidate }) => {
        expect(token.length).toBe(len);
        const actual = redactor.isCandidateToken(token);
        expect(actual).toBe(isCandidate);
      }
    );

    it.each(candidateVectors)(
      'redacts candidate token $name embedded in code context',
      ({ token }) => {
        const rawCode = `const authSecret = '${token}';\nlet header = "Bearer " + authSecret;`;
        const res = redactor.redact(rawCode, tenantId);

        expect(res.sanitizedText).not.toContain(token);
        expect(res.sanitizedText).toContain('[REDACTED:SECRET:');
        expect(res.redactionsCount).toBeGreaterThanOrEqual(1);
      }
    );

    it('detects randomized high-entropy secrets across all specified lengths (300 vectors)', () => {
      const hexChars = '0123456789abcdef';
      const alnumChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

      function generateHighEntropy(chars: string, length: number): string {
        const pool = chars.split('');
        let result = '';
        for (let i = 0; i < length; i++) {
          if (pool.length > 0) {
            const idx = Math.floor(Math.random() * pool.length);
            result += pool.splice(idx, 1)[0];
          } else {
            // Refill pool for balanced sampling to ensure high entropy
            const refill = chars.split('');
            const idx = Math.floor(Math.random() * refill.length);
            result += refill.splice(idx, 1)[0];
          }
        }
        return result;
      }

      const lengths = [16, 20, 22, 24, 32, 64];
      let passed = 0;
      for (const len of lengths) {
        for (let i = 0; i < 25; i++) {
          const hexToken = generateHighEntropy(hexChars, len);
          expect(redactor.isCandidateToken(hexToken)).toBe(true);
          passed++;

          const alnumToken = generateHighEntropy(alnumChars, len);
          expect(redactor.isCandidateToken(alnumToken)).toBe(true);
          passed++;
        }
      }
      expect(passed).toBe(300);
    });
  });

  // ============================================================================
  // 2. QUOTED SAP RFC PASSWORDS WITH SEMICOLONS, COMMAS, SPACES
  // ============================================================================
  describe('2. Quoted RFC Passwords with Semicolons, Commas, Spaces', () => {
    it('completely redacts quoted rfc_password with semicolons and hashes without tail leaks', () => {
      const input = 'rfc_password = "Secret;Complex;Pass#123"';
      const res = redactor.redact(input, tenantId);

      expect(res.sanitizedText).not.toContain('Secret;Complex;Pass#123');
      expect(res.sanitizedText).not.toContain(';Complex;Pass#123');
      expect(res.sanitizedText).not.toContain('Pass#123');
      expect(res.sanitizedText).toContain('[REDACTED:SECRET:');
      expect(res.sanitizedText).toMatch(/rfc_password\s*=\s*"\[REDACTED:SECRET:[a-f0-9]{64}\]"/);
    });

    it('completely redacts RFC connection strings with quoted PASSWD containing delimiters and spaces', () => {
      const input = 'ASHOST=sapdev;PASSWD="my;complex,pwd 123";USER=BWUSER';
      const res = redactor.redact(input, tenantId);

      expect(res.sanitizedText).not.toContain('my;complex,pwd 123');
      expect(res.sanitizedText).not.toContain(';complex,pwd 123');
      expect(res.sanitizedText).not.toContain('pwd 123');
      expect(res.sanitizedText).toContain('[REDACTED:SECRET:');
      expect(res.sanitizedText).toMatch(/PASSWD="\[REDACTED:SECRET:[a-f0-9]{64}\]"/);
    });

    it('redacts single-quoted RFC passwords with embedded semicolons and commas', () => {
      const input = "ASHOST=sapdev;PASSWD='Secret;Single,Quoted 456#';CLIENT=100";
      const res = redactor.redact(input, tenantId);

      expect(res.sanitizedText).not.toContain('Secret;Single,Quoted 456#');
      expect(res.sanitizedText).not.toContain(';Single,Quoted 456#');
      expect(res.sanitizedText).toContain('[REDACTED:SECRET:');
      expect(res.sanitizedText).toMatch(/PASSWD='\[REDACTED:SECRET:[a-f0-9]{64}\]'/);
    });

    it('redacts unquoted RFC passwords stopping at semicolon', () => {
      const input = 'ASHOST=sapdev;PASSWD=SuperSecret2026!;USER=BWUSER';
      const res = redactor.redact(input, tenantId);

      expect(res.sanitizedText).not.toContain('SuperSecret2026!');
      expect(res.sanitizedText).toContain('[REDACTED:SECRET:');
      expect(res.sanitizedText).toContain('PASSWD=[REDACTED:SECRET:');
    });

    it('preserves key name integrity when password value is pass or password', () => {
      const input = 'password = "pass"';
      const res = redactor.redact(input, tenantId);

      expect(res.sanitizedText).toMatch(/^password\s*=\s*"\[REDACTED:SECRET:[a-f0-9]{64}\]"/);
      expect(res.sanitizedText).toContain('password');
    });

    it('handles all RFC key casing variants', () => {
      const variants = [
        'PWD="Secret123;abc"',
        'pwd="Secret123;abc"',
        'Passwd="Secret123;abc"',
        'PASSWD="Secret123;abc"',
        'rfc_pass="Secret123;abc"',
        'RFC_PASS="Secret123;abc"',
        'rfc_password="Secret123;abc"',
      ];
      for (const v of variants) {
        const res = redactor.redact(v, tenantId);
        expect(res.sanitizedText).not.toContain('Secret123;abc');
        expect(res.sanitizedText).toContain('[REDACTED:SECRET:');
      }
    });
  });

  // ============================================================================
  // 3. SAPROUTER STRINGS (PORT /S/3299, MULTI-HOP, /P/, TERMINAL)
  // ============================================================================
  describe('3. SAProuter Connection Strings', () => {
    it('redacts router string with port /S/3299 and target destination', () => {
      const routerStr = '/H/router.corp/S/3299/W/SecretRouterPassword/H/target.corp/S/3200';
      const res = redactor.redact(routerStr, tenantId);

      expect(res.sanitizedText).not.toContain('SecretRouterPassword');
      expect(res.sanitizedText).toContain('/H/router.corp/S/3299/W/[REDACTED:SECRET:');
      expect(res.sanitizedText).toContain('/H/target.corp/S/3200');
    });

    it('redacts multi-hop SAProuter string masking all hop passwords', () => {
      const multiHop = '/H/r1/S/3299/W/p1/H/r2/S/3299/W/p2/H/dest';
      const res = redactor.redact(multiHop, tenantId);

      expect(res.sanitizedText).not.toContain('p1');
      expect(res.sanitizedText).not.toContain('p2');
      expect(res.sanitizedText).toContain('/H/r1/S/3299/W/[REDACTED:SECRET:');
      expect(res.sanitizedText).toContain('/H/r2/S/3299/W/[REDACTED:SECRET:');
      expect(res.sanitizedText).toContain('/H/dest');
    });

    it('redacts three-hop SAProuter connection route', () => {
      const threeHop = '/H/r1/W/p1/H/r2/W/p2/H/r3/W/p3/H/app';
      const res = redactor.redact(threeHop, tenantId);

      expect(res.sanitizedText).not.toContain('p1');
      expect(res.sanitizedText).not.toContain('p2');
      expect(res.sanitizedText).not.toContain('p3');
      expect(res.sanitizedText).toContain('/H/app');
    });

    it('redacts legacy /P/ destination password', () => {
      const pRouter = '/H/router/S/3299/P/DestSecretPass/H/target';
      const res = redactor.redact(pRouter, tenantId);

      expect(res.sanitizedText).not.toContain('DestSecretPass');
      expect(res.sanitizedText).toContain('/H/router/S/3299/P/[REDACTED:SECRET:');
      expect(res.sanitizedText).toContain('/H/target');
    });

    it('redacts terminal SAProuter password with no trailing hop', () => {
      const termRouter = '/H/router.corp/S/3299/W/TerminalPass';
      const res = redactor.redact(termRouter, tenantId);

      expect(res.sanitizedText).not.toContain('TerminalPass');
      expect(res.sanitizedText).toContain('/H/router.corp/S/3299/W/[REDACTED:SECRET:');
    });

    it('redacts port-only prefix /S/3299/W/router_secret/H/dest', () => {
      const sRouter = '/S/3299/W/router_secret/H/dest';
      const res = redactor.redact(sRouter, tenantId);

      expect(res.sanitizedText).not.toContain('router_secret');
      expect(res.sanitizedText).toContain('/S/3299/W/[REDACTED:SECRET:');
      expect(res.sanitizedText).toContain('/H/dest');
    });

    it('does not redact web URLs containing /W/', () => {
      const url = 'https://example.com/W/index.html';
      const res = redactor.redact(url, tenantId);

      expect(res.sanitizedText).toBe(url);
      expect(res.redactionsCount).toBe(0);
    });
  });

  // ============================================================================
  // 4. SAP TECHNICAL OBJECTS & DDIC PRESERVATION (CONFIRM 0 FALSE POSITIVES)
  // ============================================================================
  describe('4. SAP Technical Objects & DDIC Preservation (Confirm 0 False Positives)', () => {
    const mandatorySapObjects = [
      'MARA',
      'BKPF',
      'SWWWIHEAD',
      'ZCUSTOM_TABLE_01',
      '/COMPANY/ERP_MIGRATION_TOOL',
      'I_PRODUCT_SALES_DELIVERY',
    ];

    const additionalSapObjects = [
      'BSEG',
      'ACDOCA',
      'C_SALESORDERITEMQUERY',
      'CL_REST_HTTP_CLIENT_FACTORY',
      'ZCL_PREFLIGHT_CONTROLLER_V2',
      'ZCX_CUSTOM_EXCEPTION_HANDLER',
      'BAPI_USER_GET_DETAIL',
      '/SDF/RBE_METRIC_COLLECTOR',
      '/UI5/SAP_LIB_CORE',
      '/SCWM/MFS_TELEGRAM_QUEUE',
    ];

    const allObjects = [...mandatorySapObjects, ...additionalSapObjects];

    it.each(allObjects)(
      'isCandidateToken returns false for SAP object %s',
      (sapObj) => {
        expect(redactor.isCandidateToken(sapObj)).toBe(false);
      }
    );

    it.each(allObjects)(
      'redact leaves SAP object %s unredacted in code context',
      (sapObj) => {
        const codeSnippet = `SELECT SINGLE * FROM ${sapObj} INTO @DATA(ls_record) WHERE obj_key = 'TEST'.`;
        const res = redactor.redact(codeSnippet, tenantId);

        expect(res.sanitizedText).toContain(sapObj);
        expect(res.redactionsCount).toBe(0);
        expect(res.sanitizedText).not.toContain('[REDACTED:');
      }
    );

    it('does not redact complex ABAP SQL keywords, symbols, and standard tables', () => {
      const abapCode = `
        SELECT * FROM BKPF INNER JOIN BSEG ON BKPF~BELNR = BSEG~BELNR
        WHERE BKPF~BUKRS = '1000' INTO TABLE @DATA(lt_bseg).
        ASSIGN COMPONENT 'DMBTR' OF STRUCTURE <fs_line> TO FIELD-SYMBOLS(<fs_val>).
      `;
      const res = redactor.redact(abapCode, tenantId);

      expect(res.sanitizedText).toContain('BKPF');
      expect(res.sanitizedText).toContain('BSEG');
      expect(res.sanitizedText).toContain('SELECT');
      expect(res.sanitizedText).toContain('FIELD-SYMBOLS');
      expect(res.sanitizedText).toContain('<fs_val>');
      expect(res.redactionsCount).toBe(0);
    });

    it('does not redact standard UUIDs', () => {
      const sampleUuid = 'c1234567-89ab-cdef-0123-456789abcdef';
      const res = redactor.redact(`session_id: ${sampleUuid}`, tenantId);

      expect(res.sanitizedText).toContain(sampleUuid);
      expect(res.redactionsCount).toBe(0);
    });
  });

  // ============================================================================
  // 5. SUB-THRESHOLD & BOUNDARY STRESS TESTS
  // ============================================================================
  describe('5. Sub-Threshold and Boundary Stress Tests', () => {
    it('does not flag sub-threshold tokens with length 15', () => {
      const shortUnique = 'abcdefghijklmno'; // len 15
      expect(shortUnique.length).toBe(15);
      expect(redactor.isCandidateToken(shortUnique)).toBe(false);
    });

    it('does not flag repetitive low-entropy tokens', () => {
      expect(redactor.isCandidateToken('a'.repeat(16))).toBe(false);
      expect(redactor.isCandidateToken('ab'.repeat(8))).toBe(false);
      expect(redactor.isCandidateToken('a'.repeat(32))).toBe(false);
      expect(redactor.isCandidateToken('1234'.repeat(8))).toBe(false); // hex repeat H=2.0 < 3.2
    });
  });
});
