import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SapImportService } from '../src/modules/sap-import/sap-import.service';
import { DatabaseService } from '../src/modules/database/database.service';

describe('SapImportService (Part 15.11 - 15.13 Specification Compliance)', () => {
  let service: SapImportService;
  let dbMock: any;

  beforeEach(() => {
    dbMock = {
      query: vi.fn(),
    };
    service = new SapImportService(dbMock as unknown as DatabaseService);
  });

  const tenantId = '00000000-0000-0000-0000-000000000001';
  const projectId = '00000000-0000-0000-0000-000000000002';
  const userId = '00000000-0000-0000-0000-000000000003';
  const analysisId = '00000000-0000-0000-0000-000000000004';

  it('1. Imports ATC findings from XML and updates SAP Object Catalog', async () => {
    // 1. check for existing analysis -> return mock analysis
    dbMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM analyses')) {
        return { rows: [{ id: analysisId }] };
      }
      if (sql.includes('SELECT id FROM findings')) {
        return { rows: [] }; // No existing duplicates
      }
      return { rows: [] };
    });

    const xml = `
      <ATC_RESULTS>
        <FINDING>
          <OBJECT_NAME>ZCL_PAYMENT_PROCESSOR</OBJECT_NAME>
          <OBJECT_TYPE>CLAS</OBJECT_TYPE>
          <PACKAGE>ZFIN</PACKAGE>
          <CHECK_ID>DB_MUTATION_CHECK</CHECK_ID>
          <PRIORITY>1</PRIORITY>
          <MESSAGE>Direct insert into table BKPF forbidden</MESSAGE>
          <LINE>142</LINE>
          <COLUMN>5</COLUMN>
          <SNIPPET>INSERT INTO bkpf VALUES @ls_header.</SNIPPET>
        </FINDING>
      </ATC_RESULTS>
    `;

    const res = await service.importAtc(tenantId, projectId, userId, {
      rawContent: xml,
      format: 'XML',
    });

    expect(res.success).toBe(true);
    expect(res.totalParsed).toBe(1);
    expect(res.objectsImported).toBe(1);
    expect(res.findingsCreated).toBe(1);
    expect(res.baselinedCount).toBe(0);

    // Verify sap_objects insert
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO sap_objects'),
      expect.arrayContaining([tenantId, projectId, 'ZCL_PAYMENT_PROCESSOR', 'CLAS', 'ZFIN', 'TIER_3_CLASSIC'])
    );

    // Verify findings insert
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO findings'),
      expect.arrayContaining([tenantId, projectId, analysisId, 'ATC_DB_MUTATION_CHECK', 'BLOCKER'])
    );
  });

  it('2. Supports ATC Baseline & Suppression Awareness (Part 15.13)', async () => {
    dbMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM analyses')) {
        return { rows: [{ id: analysisId }] };
      }
      if (sql.includes('SELECT id FROM findings')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const json = JSON.stringify({
      results: [
        {
          objectName: 'ZSD_LEGACY_REPORT',
          objectType: 'PROG',
          package: 'ZSD',
          checkId: 'SYNTAX_CHECK',
          priority: 3,
          message: 'Obsolete statement WRITE used',
          line: 55,
          suppressed: true, // Baselined
        },
      ],
    });

    const res = await service.importAtc(tenantId, projectId, userId, {
      rawContent: json,
      format: 'JSON',
    });

    expect(res.success).toBe(true);
    expect(res.totalParsed).toBe(1);
    expect(res.findingsCreated).toBe(1);
    expect(res.baselinedCount).toBe(1);
    expect(res.activeFindings).toBe(0);
  });

  it('3. Deduplicates identical findings across repeated ATC imports', async () => {
    dbMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM analyses')) {
        return { rows: [{ id: analysisId }] };
      }
      if (sql.includes('SELECT id FROM findings')) {
        // Return existing finding to simulate duplicate detection
        return { rows: [{ id: 'existing-finding-uuid' }] };
      }
      return { rows: [] };
    });

    const csv = `OBJECT,TYPE,PKG,CHECK,PRIORITY,MSG,LINE\nZMM_PO,TABL,ZMM,CHECK_TABLE,2,Missing index,10`;
    const res = await service.importAtc(tenantId, projectId, userId, {
      rawContent: csv,
      format: 'CSV',
    });

    expect(res.success).toBe(true);
    expect(res.totalParsed).toBe(1);
    expect(res.objectsImported).toBe(1);
    expect(res.findingsCreated).toBe(0); // Not created again!
  });

  it('4. Imports SAP Readiness Check Simplification Items (Part 15.11)', async () => {
    dbMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM analyses')) {
        return { rows: [{ id: analysisId }] };
      }
      if (sql.includes('SELECT id FROM findings')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const readinessPayload = JSON.stringify({
      sourceSystem: 'PRD',
      targetRelease: 'S4H_2023',
      analysisId: 'RC-2026-EU-01',
      simplificationItems: [
        {
          id: 'SI25',
          title: 'Business Partner / Customer-Vendor Integration (CVI)',
          description: 'CVI synchronization required prior to conversion.',
          status: 'BLOCKING',
          note: 'SAP Note 2265093',
        },
        {
          id: 'SI01',
          title: 'Material Number Field Length Extension',
          description: 'Compatibility review for 40-character material numbers.',
          status: 'ACTION_REQUIRED',
          criticality: 'HIGH',
          note: 'SAP Note 2267140',
        },
      ],
    });

    const res = await service.importReadinessCheck(tenantId, projectId, userId, {
      rawContent: readinessPayload,
    });

    expect(res.success).toBe(true);
    expect(res.sourceSystem).toBe('PRD');
    expect(res.targetRelease).toBe('S4H_2023');
    expect(res.simplificationItemsCount).toBe(2);
    expect(res.criticalIssuesCount).toBe(2);
    expect(res.findingsCreated).toBe(2);

    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO findings'),
      expect.arrayContaining([tenantId, projectId, analysisId, 'READINESS_SI_SI25', 'CRITICAL'])
    );
  });

  it('5. Imports Fiori App Recommendations profile (Part 15.14)', async () => {
    const csv = `TCODE,FIORI_ID,TITLE,USAGE,CRITICALITY\nVA01,F0842A,Create Sales Orders,15420,CRITICAL\nME21N,F0843,Create Purchase Order,8920,HIGH`;

    const res = await service.importFioriUsage(tenantId, projectId, userId, {
      rawContent: csv,
    });

    expect(res.success).toBe(true);
    expect(res.recordsProcessed).toBe(2);
    expect(res.recommendations[0].legacyTCode).toBe('VA01');
    expect(res.recommendations[0].fioriAppId).toBe('F0842A');
  });
});
