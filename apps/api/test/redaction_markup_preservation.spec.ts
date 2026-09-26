import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { SecretRedactorService } from '../src/modules/redaction/secret-redactor.service';

// Regression: the entropy scanner treated closing tags such as `/COND_BillingType`
// and e-mail recipients as secrets, corrupting every uploaded SAP XML artifact.
describe('Secret redaction preserves markup structure', () => {
  const redactor = new SecretRedactorService(
    new ConfigService({ MASTER_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }),
  );
  const tenant = '00000000-0000-0000-0000-000000000001';

  it('leaves a secret-free OPD decision table XML byte-identical', () => {
    const xml = readFileSync(join(__dirname, '../../../tests/fixtures/known_bad_billing_opd.xml'), 'utf8');
    const result = redactor.redact(xml, tenant);
    expect(result.redactionsCount).toBe(0);
    expect(result.sanitizedText).toBe(xml);
  });

  it('does not mask long element names or e-mail recipients', () => {
    const xml = '<COND_SalesOrganization>1000</COND_SalesOrganization><RESULT>billing@customer45.com</RESULT>';
    expect(redactor.redact(xml, tenant).sanitizedText).toBe(xml);
  });

  it('still masks high-entropy values inside elements', () => {
    const xml = '<ApiToken>sk_live_9fQ2xLp7ZbR4tYv1mNc8</ApiToken>';
    const result = redactor.redact(xml, tenant);
    expect(result.sanitizedText).not.toContain('sk_live_9fQ2xLp7ZbR4tYv1mNc8');
    expect(result.sanitizedText).toMatch(/^<ApiToken>\[REDACTED:SECRET:[0-9a-f]{64}\]<\/ApiToken>$/);
  });
});
