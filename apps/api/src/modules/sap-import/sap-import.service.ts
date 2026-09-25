import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ImportAtcDto, ImportReadinessDto, ImportFioriUsageDto } from './dto/sap-import.dto';
import * as crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class SapImportService {
  private readonly logger = new Logger(SapImportService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Helper: Ensure an analysis record exists to hold imported findings.
   */
  private async getOrCreateImportAnalysis(
    organizationId: string,
    projectId: string,
    engineName: string,
    userId: string
  ): Promise<string> {
    const existing = await this.db.query(
      `SELECT id FROM analyses
       WHERE organization_id = $1 AND project_id = $2 AND status = 'COMPLETED'
       ORDER BY created_at DESC LIMIT 1`,
      [organizationId, projectId]
    );

    if (existing.rows && existing.rows.length > 0) {
      return existing.rows[0].id;
    }

    const analysisId = uuidv4();
    await this.db.query(
      `INSERT INTO analyses (
        id, organization_id, project_id, status, is_baseline, engine_types, target_release, triggered_by
      ) VALUES ($1, $2, $3, 'COMPLETED', false, $4, 'S4H_2023', $5)`,
      [analysisId, organizationId, projectId, JSON.stringify([engineName]), userId]
    );
    return analysisId;
  }

  /**
   * Part 15.12 & 15.13: ATC / Custom Code Analysis Importer
   */
  async importAtc(
    organizationId: string,
    projectId: string,
    userId: string,
    dto: ImportAtcDto
  ) {
    if (!dto.rawContent || !dto.rawContent.trim()) {
      throw new BadRequestException('ATC content payload cannot be empty');
    }

    const analysisId = await this.getOrCreateImportAnalysis(
      organizationId,
      projectId,
      'SAP_ATC_IMPORTER',
      userId
    );

    const parsedFindings: Array<{
      objectName: string;
      objectType: string;
      packageName: string;
      checkId: string;
      priority: number;
      message: string;
      line: number;
      column: number;
      isSuppressed: boolean;
      snippet: string;
    }> = [];

    const content = dto.rawContent.trim();

    // 1. Try parsing JSON format
    if (content.startsWith('{') || content.startsWith('[')) {
      try {
        const json = JSON.parse(content);
        const items = Array.isArray(json) ? json : json.findings || json.results || [];
        for (const it of items) {
          parsedFindings.push({
            objectName: it.objectName || it.obj_name || it.object || 'ZCUSTOM_OBJ',
            objectType: it.objectType || it.obj_type || 'CLAS',
            packageName: it.packageName || it.package || '$TMP',
            checkId: it.checkId || it.test || it.check || 'ATC_SYNTAX_CHECK',
            priority: Number(it.priority || it.prio || 2),
            message: it.message || it.description || it.text || 'ATC Finding',
            line: Number(it.line || it.line_no || 1),
            column: Number(it.column || it.col || 1),
            isSuppressed: Boolean(it.suppressed || it.isSuppressed || it.exempted),
            snippet: it.snippet || it.codeSnippet || '',
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to parse ATC as JSON: ${(err as Error).message}`);
      }
    }

    // 2. Try parsing XML format (<FINDING> or <CHECK_RESULT>)
    if (parsedFindings.length === 0 && (content.includes('<') && content.includes('>'))) {
      const findingRegex = /<(?:FINDING|CHECK_RESULT)[\s\S]*?<\/(?:FINDING|CHECK_RESULT)>/gi;
      let match: RegExpExecArray | null;
      while ((match = findingRegex.exec(content)) !== null) {
        const block = match[0];
        const getTag = (tag: string) => {
          const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
          return m ? m[1].trim() : '';
        };

        const objName = getTag('OBJECT_NAME') || getTag('OBJ_NAME') || getTag('NAME') || 'ZSAP_CUSTOM';
        const objType = getTag('OBJECT_TYPE') || getTag('OBJ_TYPE') || 'PROG';
        const pkg = getTag('PACKAGE') || getTag('DEVCLASS') || '$TMP';
        const check = getTag('CHECK_ID') || getTag('TEST') || 'ATC_GENERIC_CHECK';
        const prio = parseInt(getTag('PRIORITY') || '2', 10);
        const msg = getTag('MESSAGE') || getTag('TEXT') || getTag('TITLE') || 'ATC Check Finding';
        const line = parseInt(getTag('LINE') || '1', 10);
        const col = parseInt(getTag('COLUMN') || '1', 10);
        const suppressed = /<SUPPRESSED>\s*(true|1|X)\s*<\/SUPPRESSED>/i.test(block) ||
                           /<STATUS>\s*(EXEMPTED|SUPPRESSED)\s*<\/STATUS>/i.test(block);
        const snippet = getTag('SNIPPET') || getTag('CODE');

        parsedFindings.push({
          objectName: objName,
          objectType: objType,
          packageName: pkg,
          checkId: check,
          priority: isNaN(prio) ? 2 : prio,
          message: msg,
          line: isNaN(line) ? 1 : line,
          column: isNaN(col) ? 1 : col,
          isSuppressed: suppressed,
          snippet,
        });
      }
    }

    // 3. Try parsing CSV format if still empty
    if (parsedFindings.length === 0) {
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
        if (cols.length >= 4) {
          parsedFindings.push({
            objectName: cols[0],
            objectType: cols[1] || 'CLAS',
            packageName: cols[2] || '$TMP',
            checkId: cols[3] || 'ATC_SYNTAX_CHECK',
            priority: parseInt(cols[4] || '2', 10) || 2,
            message: cols[5] || 'ATC Check Finding',
            line: parseInt(cols[6] || '1', 10) || 1,
            column: 1,
            isSuppressed: (cols[7] || '').toUpperCase() === 'TRUE',
            snippet: cols[8] || '',
          });
        }
      }
    }

    let objectsImported = 0;
    let findingsCreated = 0;
    let baselinedCount = 0;

    for (const f of parsedFindings) {
      // Map priority to severity
      let severity = 'MAJOR';
      if (f.priority === 1) {
        severity = /direct\s+insert|mutation|unreleased/i.test(f.message) ? 'BLOCKER' : 'CRITICAL';
      } else if (f.priority === 2) {
        severity = 'MAJOR';
      } else if (f.priority >= 3) {
        severity = 'MINOR';
      }

      // Upsert SAP Object
      const tier = severity === 'BLOCKER' || severity === 'CRITICAL' ? 'TIER_3_CLASSIC' : 'TIER_2_DEVELOPER';
      await this.db.query(
        `INSERT INTO sap_objects (
          organization_id, project_id, name, object_type, package, clean_core_tier, description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING`,
        [
          organizationId,
          projectId,
          f.objectName,
          f.objectType,
          f.packageName,
          tier,
          `Imported via ATC analysis (${f.checkId})`,
        ]
      );
      objectsImported++;

      // Compute deterministic fingerprint
      const ruleId = f.checkId.startsWith('ATC_') ? f.checkId : `ATC_${f.checkId}`;
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${projectId}:${ruleId}:${f.objectName}:${f.line}`)
        .digest('hex');

      // Check if finding already exists (Part 15.12 deduplication)
      const existingFinding = await this.db.query(
        `SELECT id FROM findings WHERE organization_id = $1 AND project_id = $2 AND fingerprint = $3`,
        [organizationId, projectId, fingerprint]
      );

      let findingId: string;
      if (existingFinding.rows && existingFinding.rows.length > 0) {
        findingId = existingFinding.rows[0].id;
      } else {
        findingId = uuidv4();
        await this.db.query(
          `INSERT INTO findings (
            id, organization_id, project_id, analysis_id, engine, rule_id, severity, category,
            title, description, confidence_class, confidence_score, remediation, affected_objects,
            technical_details, fingerprint
          ) VALUES ($1, $2, $3, $4, 'ATC_IMPORT', $5, $6, 'Clean Core & ATC', $7, $8, 'VERIFIED', 0.950, $9, $10, $11, $12)`,
          [
            findingId,
            organizationId,
            projectId,
            analysisId,
            ruleId,
            severity,
            `ATC: ${f.message}`,
            `ATC check '${f.checkId}' violation detected in ${f.objectName} (line ${f.line}).`,
            `Refactor ${f.objectName} according to official SAP Clean Core extensibility guidelines.`,
            JSON.stringify([{ name: f.objectName, type: f.objectType, tier }]),
            JSON.stringify({
              atcCheck: f.checkId,
              priority: f.priority,
              isSuppressed: f.isSuppressed,
              line: f.line,
              column: f.column,
            }),
            fingerprint,
          ]
        );
        findingsCreated++;

        if (f.isSuppressed) {
          baselinedCount++;
        }

        // Insert Evidence
        const snippetText = f.snippet || `Source ${f.objectName}:${f.line} [${f.checkId}]`;
        const evidenceHash = crypto.createHash('sha256').update(snippetText).digest('hex');

        await this.db.query(
          `INSERT INTO evidence (
            organization_id, finding_id, artifact_path, line_number, column_number, snippet,
            sha256, provenance, source_title, trust_score
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'VERIFIED', 'ATC Check Export', 0.950)`,
          [
            organizationId,
            findingId,
            `${f.packageName}/${f.objectName}`,
            f.line,
            f.column,
            snippetText,
            evidenceHash,
          ]
        );
      }
    }

    return {
      success: true,
      analysisId,
      totalParsed: parsedFindings.length,
      objectsImported,
      findingsCreated,
      baselinedCount,
      activeFindings: findingsCreated - baselinedCount,
    };
  }

  /**
   * Part 15.11: SAP Readiness Check Importer
   */
  async importReadinessCheck(
    organizationId: string,
    projectId: string,
    userId: string,
    dto: ImportReadinessDto
  ) {
    if (!dto.rawContent || !dto.rawContent.trim()) {
      throw new BadRequestException('SAP Readiness Check content payload cannot be empty');
    }

    let json: any;
    try {
      json = JSON.parse(dto.rawContent.trim());
    } catch {
      throw new BadRequestException('Invalid JSON format for SAP Readiness Check payload');
    }

    const analysisId = await this.getOrCreateImportAnalysis(
      organizationId,
      projectId,
      'SAP_READINESS_IMPORTER',
      userId
    );

    const sourceSystem = json.sourceSystem || json.systemId || 'PRD';
    const targetRelease = json.targetRelease || dto.targetRelease || 'S4H_2023';
    const sourceAnalysisId = json.analysisId || dto.sourceAnalysisId || `RC-${Date.now()}`;

    const simplificationItems = json.simplificationItems || json.simplificationItemChecks || [];
    const customCodeSummary = json.customCodeAnalysis || json.customCode || {};
    const financialDataQuality = json.financialDataQuality || json.financeChecks || [];

    let findingsCreated = 0;
    let criticalIssuesCount = 0;

    // Process Simplification Items
    for (const item of simplificationItems) {
      const isCritical =
        item.status === 'BLOCKING' ||
        item.status === 'ACTION_REQUIRED' ||
        item.criticality === 'HIGH' ||
        item.critical === true;

      const severity = isCritical ? 'CRITICAL' : 'MAJOR';
      if (isCritical) criticalIssuesCount++;

      const ruleId = `READINESS_SI_${item.id || item.itemNumber || item.number || 'ITEM'}`;
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${projectId}:READINESS:${ruleId}`)
        .digest('hex');

      const existing = await this.db.query(
        `SELECT id FROM findings WHERE organization_id = $1 AND project_id = $2 AND fingerprint = $3`,
        [organizationId, projectId, fingerprint]
      );

      if (!existing.rows || existing.rows.length === 0) {
        const findingId = uuidv4();
        const title = item.title || item.name || `Simplification Item ${ruleId}`;
        const desc = item.description || `Simplification item ${ruleId} requires migration preparation for ${targetRelease}.`;
        const note = item.note || item.sapNote || 'SAP Note 2502552';

        await this.db.query(
          `INSERT INTO findings (
            id, organization_id, project_id, analysis_id, engine, rule_id, severity, category,
            title, description, confidence_class, confidence_score, remediation, affected_objects,
            technical_details, fingerprint
          ) VALUES ($1, $2, $3, $4, 'SAP_READINESS_CHECK', $5, $6, 'Simplification Items', $7, $8, 'VERIFIED', 1.000, $9, $10, $11, $12)`,
          [
            findingId,
            organizationId,
            projectId,
            analysisId,
            ruleId,
            severity,
            title,
            desc,
            `Execute migration activity according to ${note}.`,
            JSON.stringify(item.affectedObjects || [{ name: `SI_${item.id || 'ITEM'}`, type: 'SIMPLIFICATION_ITEM', tier: 'TIER_1_CLOUD' }]),
            JSON.stringify({
              sourceSystem,
              targetRelease,
              sourceAnalysisId,
              status: item.status,
              sapNote: note,
            }),
            fingerprint,
          ]
        );
        findingsCreated++;

        // Add Evidence
        const snippetText = `Readiness Check ${sourceAnalysisId}: ${title} [${note}]`;
        const evidenceHash = crypto.createHash('sha256').update(snippetText).digest('hex');

        await this.db.query(
          `INSERT INTO evidence (
            organization_id, finding_id, artifact_path, line_number, column_number, snippet,
            sha256, provenance, source_title, trust_score
          ) VALUES ($1, $2, $3, 1, 1, $4, $5, 'VERIFIED', 'SAP Readiness Check 2.0', 1.000)`,
          [
            organizationId,
            findingId,
            `readiness_check/${sourceAnalysisId}.json`,
            snippetText,
            evidenceHash,
          ]
        );
      }
    }

    return {
      success: true,
      analysisId,
      sourceSystem,
      targetRelease,
      sourceAnalysisId,
      simplificationItemsCount: simplificationItems.length,
      findingsCreated,
      criticalIssuesCount,
      customCodeSummary,
    };
  }

  /**
   * Part 15.14: Fiori App Recommendations Importer
   */
  async importFioriUsage(
    organizationId: string,
    projectId: string,
    userId: string,
    dto: ImportFioriUsageDto
  ) {
    if (!dto.rawContent || !dto.rawContent.trim()) {
      throw new BadRequestException('Fiori usage content cannot be empty');
    }

    const lines = dto.rawContent.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
    const recommendations: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
      if (cols.length >= 3) {
        recommendations.push({
          legacyTCode: cols[0],
          fioriAppId: cols[1],
          fioriAppTitle: cols[2],
          usageCount: parseInt(cols[3] || '100', 10),
          businessCriticality: cols[4] || 'HIGH',
        });
      }
    }

    return {
      success: true,
      recordsProcessed: recommendations.length,
      recommendations,
    };
  }
}
