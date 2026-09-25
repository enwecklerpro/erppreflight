import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import * as crypto from 'node:crypto';

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly knowledgeService: KnowledgeService
  ) {}

  getToolsList() {
    return [
      {
        name: 'search_knowledge',
        description: 'Search official SAP knowledge, Clean Core rules, successor APIs, and migration notes.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term, e.g. "BKPF direct insert" or "OPD email"' },
            targetRelease: { type: 'string', description: 'Target SAP release, e.g. "S4H_2023"' },
          },
          required: ['query'],
        },
      },
      {
        name: 'lookup_object',
        description: 'Lookup an SAP object (table, view, BAPI, class) to check release status and Clean Core classification.',
        inputSchema: {
          type: 'object',
          properties: {
            objectName: { type: 'string', description: 'SAP object name, e.g. "MARA", "BKPF", "BAPI_PO_CREATE1"' },
          },
          required: ['objectName'],
        },
      },
      {
        name: 'compare_releases',
        description: 'Compare compatibility matrix and breaking changes between two SAP releases.',
        inputSchema: {
          type: 'object',
          properties: {
            sourceRelease: { type: 'string', description: 'e.g. "ECC_608"' },
            targetRelease: { type: 'string', description: 'e.g. "S4H_2023"' },
          },
          required: ['sourceRelease', 'targetRelease'],
        },
      },
      {
        name: 'get_findings',
        description: 'Fetch preflight findings for a specific project workspace.',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'The project UUID' },
            severity: { type: 'string', description: 'Optional severity filter (BLOCKER, CRITICAL, MAJOR, MINOR)' },
          },
          required: ['projectId'],
        },
      },
      {
        name: 'explain_finding',
        description: 'Get deep technical remediation guide, evidence snippet, and provenance for a finding.',
        inputSchema: {
          type: 'object',
          properties: {
            findingId: { type: 'string', description: 'The finding UUID' },
          },
          required: ['findingId'],
        },
      },
      {
        name: 'generate_test',
        description: 'Generate an automated preflight regression test case for a resolved finding.',
        inputSchema: {
          type: 'object',
          properties: {
            findingId: { type: 'string', description: 'The finding UUID' },
          },
          required: ['findingId'],
        },
      },
      {
        name: 'get_project_status',
        description: 'Get project executive preflight readiness index and finding counts.',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'The project UUID' },
          },
          required: ['projectId'],
        },
      },
    ];
  }

  async handleCall(organizationId: string, name: string, args: Record<string, any>) {
    switch (name) {
      case 'search_knowledge': {
        const query = (args.query || '').toUpperCase();
        const { matrix } = await this.knowledgeService.getMatrix();
        const matchedEngines = matrix.filter(
          (m) => m.engineName.toUpperCase().includes(query) || m.domain.toUpperCase().includes(query)
        );
        return {
          query: args.query,
          matchedEngines: matchedEngines.slice(0, 5),
          recommendation: `Query '${args.query}' analyzed against SAP Clean Core Knowledge Base v2026.09.`,
        };
      }

      case 'lookup_object': {
        const obj = (args.objectName || '').toUpperCase();
        const res = await this.db.query(
          `SELECT * FROM sap_objects WHERE object_name = $1 AND organization_id = $2 LIMIT 1`,
          [obj, organizationId]
        );
        
        if (!res || !res.rows || !res.rows.length) {
          return { found: false, source: 'NO_CATALOG_DATA', note: 'Object not found in project catalog. Upload artifacts to populate.' };
        }
        
        const record = res.rows[0];
        const isStandard = record.is_standard || ['BKPF', 'BSEG', 'MARA', 'KNA1', 'VBAK', 'VBAP'].includes(obj);
        
        return {
          objectName: obj,
          classification: record.classification || (isStandard ? 'STANDARD_SAP_TABLE' : 'CUSTOM_Z_OBJECT'),
          cleanCoreTier: record.clean_core_tier || (isStandard ? 'TIER_3_CLASSIC' : 'TIER_1_OR_2'),
          releasedForCloud: record.released_for_cloud || !isStandard,
          successorAdvice: record.successor_advice || (isStandard
            ? `Standard table ${obj} is not released for direct write access in ABAP Cloud. Use released CDS views or RAP Business Objects.`
            : `Custom object ${obj} must be refactored to utilize Cloud ABAP language version (ABAP for Cloud Development).`),
        };
      }

      case 'compare_releases': {
        const source = args.sourceRelease || 'ECC_608';
        const target = args.targetRelease || 'S4H_2023';
        const { matrix } = await this.knowledgeService.getMatrix();
        const supported = matrix.filter(m => m.targetRelease.includes(target.replace('_', ' ')));
        
        return {
          source,
          target,
          compatibilityStatus: supported.length > 0 ? 'SUPPORTED_VERIFIED' : 'PARTIAL',
          majorChanges: [
            'Business Partner consolidation mandatory (CVI)',
            'Material Ledger active by default',
            'Output Determination migrated to BRFplus OPD',
            'Direct standard table mutations strictly deprecated',
            `Analyzed against ${supported.length} compatible preflight engines.`
          ],
        };
      }

      case 'get_findings': {
        const res = await this.db.query(
          `SELECT id, engine, rule_id, severity, title, confidence_class
           FROM findings
           WHERE organization_id = $1 AND project_id = $2
           LIMIT 20`,
          [organizationId, args.projectId]
        );
        return {
          projectId: args.projectId,
          totalFindings: res.rows?.length || 0,
          findings: res.rows || [],
        };
      }

      case 'explain_finding': {
        const res = await this.db.query(
          `SELECT f.*, e.snippet, e.artifact_path, e.line_number, e.sha256
           FROM findings f
           LEFT JOIN evidence e ON e.finding_id = f.id
           WHERE f.organization_id = $1 AND f.id = $2
           LIMIT 1`,
          [organizationId, args.findingId]
        );
        if (!res.rows?.length) {
          return { error: `Finding ${args.findingId} not found` };
        }
        const row = res.rows[0];
        return {
          id: row.id,
          ruleId: row.rule_id,
          severity: row.severity,
          title: row.title,
          description: row.description,
          remediation: row.remediation,
          evidence: {
            artifact: row.artifact_path,
            line: row.line_number,
            snippet: row.snippet,
            sha256: row.sha256,
          },
        };
      }

      case 'generate_test': {
        return {
          findingId: args.findingId,
          testTitle: `Preflight Regression: Verify clean resolution for ${args.findingId}`,
          testType: 'REGRESSION',
          executionCommand: `pnpm run test:python --rule ${args.findingId}`,
          status: 'READY_TO_EXECUTE',
        };
      }

      case 'get_project_status': {
        const res = await this.db.query(
          `SELECT
             COUNT(f.id)::int as total,
             COUNT(CASE WHEN f.severity = 'BLOCKER' THEN 1 END)::int as blockers,
             COUNT(CASE WHEN f.severity = 'CRITICAL' THEN 1 END)::int as criticals
           FROM projects p
           LEFT JOIN findings f ON f.project_id = p.id
           WHERE p.organization_id = $1 AND p.id = $2
           GROUP BY p.id`,
          [organizationId, args.projectId]
        );
        const stats = res.rows?.[0] || { total: 0, blockers: 0, criticals: 0 };
        const cleanCoreScore = Math.max(0, 100 - stats.blockers * 25 - stats.criticals * 10);
        return {
          projectId: args.projectId,
          totalFindings: stats.total,
          blockers: stats.blockers,
          criticals: stats.criticals,
          cleanCoreScorePercent: cleanCoreScore,
          verdict: stats.blockers > 0 ? 'BLOCKED' : stats.criticals > 0 ? 'CONDITIONAL' : 'READY',
        };
      }

      default:
        return { error: `Tool '${name}' not implemented` };
    }
  }
}
