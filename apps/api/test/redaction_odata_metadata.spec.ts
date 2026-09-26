/**
 * The secret redactor must keep OData $metadata (EDMX) structurally intact: API Change Guard compares
 * EDMX baselines and candidates after ingestion, and masking qualified model identifiers
 * (`EntityType="API_SALES_ORDER_SRV.A_SalesOrderItemType"`) — worse, swallowing the closing quote —
 * turned valid $metadata into malformed XML. Secrets in other attributes are still masked.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SecretRedactorService } from '../src/modules/redaction/secret-redactor.service';

const ORG = 'b2222222-2222-4222-8222-222222222222';
const redactor = new SecretRedactorService({ get: (_k: string, d: string) => d } as any);
const fixtures = path.resolve(__dirname, '../../../services/analysis-python/tests/fixtures/domain3');

describe('SecretRedactorService keeps OData $metadata intact', () => {
  it.each(['api_edmx_structure_baseline.xml', 'api_edmx_structure_candidate.xml', 'api_odata_edmx_baseline.xml', 'api_odata_edmx_candidate.xml'])(
    'does not mask model identifiers in %s',
    (file) => {
      const text = fs.readFileSync(path.join(fixtures, file), 'utf-8');
      const res = redactor.redact(text, ORG);
      expect(res.redactionsCount).toBe(0);
      expect(res.sanitizedText).toBe(text);
    }
  );

  it('still masks a high-entropy value in a non-structural attribute without swallowing the closing quote', () => {
    const secret = 'Zq8vR2xLp9TfW3yKmB7nCd4HsJ6gAe1U';
    const xml = `<Destination Name="API_SALES_ORDER_SRV.A_SalesOrderType" Token="${secret}"/>`;
    const res = redactor.redact(xml, ORG);
    expect(res.sanitizedText).not.toContain(secret);
    expect(res.sanitizedText).toContain('Name="API_SALES_ORDER_SRV.A_SalesOrderType"');
    expect(res.sanitizedText).toMatch(/Token="\[REDACTED:SECRET:[0-9a-f]{64}\]"\/>$/);
  });

  it('a structural attribute name does not whitelist a non-identifier value', () => {
    const secret = 'dGhpcyBpcyBhIHNlY3JldCB0b2tlbiB2YWx1ZQ==';
    const res = redactor.redact(`<X Name="${secret}"/>`, ORG);
    expect(res.sanitizedText).not.toContain(secret);
  });

  it.each([
    '<Credential Name="svc" Target="__S__"/>',
    '<cfg Path="__S__"/>',
    '<Property Name="__S__" />',
    '<k Type="__S__"/>',
  ])('outside OData metadata, identifier-like secrets in structural attribute names stay masked: %s', (tpl) => {
    const secret = 'Zq8vR2xLp9TfW3yKmB7nCd4HsJ6gAe1U';
    const res = redactor.redact(tpl.replace('__S__', secret), ORG);
    expect(res.sanitizedText).not.toContain(secret);
    expect(res.redactedCategories).toContain('HIGH_ENTROPY_TOKEN');
  });

  it('keeps masking password attributes', () => {
    const res = redactor.redact('<Conn password="S3cr3t-Value-For-Test!" />', ORG);
    expect(res.sanitizedText).not.toContain('S3cr3t-Value-For-Test!');
  });
});
