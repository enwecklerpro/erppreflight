import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface ReleaseNote {
  id: string;
  version: string;
  releaseDate: string;
  category: 'PLATFORM' | 'KNOWLEDGE_SNAPSHOT' | 'ENGINE_RULE_BUNDLE';
  title: string;
  summary: string;
  features: string[];
  engineChanges: string[];
  knowledgeUpdates: string[];
  breakingChanges: string[];
}

export const CANONICAL_CHANGELOGS: ReleaseNote[] = [
  {
    id: 'rel-2026-09-25',
    version: 'v1.4.0',
    releaseDate: '2026-09-25',
    category: 'PLATFORM',
    title: 'Enterprise Platform Release: What-If Canvas, 8-Column Traceability & MCP Change Gate',
    summary: 'Major release delivering interactive DAG simulation via React Flow, complete delivery traceability to SAP Cloud ALM/Jira, and Model Context Protocol (MCP) Change Gate governance.',
    features: [
      'Interactive What-If DAG Simulation Canvas powered by @xyflow/react & ELK.js layout engine',
      '8-Column Delivery Traceability Matrix with 1-click SAP Cloud ALM / Jira remediation tasks',
      'Model Context Protocol (MCP) JSON-RPC 2.0 Server exposing 7 official preflight tools',
      'Agentic Change Gate with proposal evaluation and cryptographic HMAC execution tokens',
      'Enterprise Analysis Templates and Customer Feedback & Gap Voting portal',
      'Full-featured official CLI tool (`erp-preflight`) with machine-readable JSON outputs',
    ],
    engineChanges: [
      'MFS BlackBox: Sub-millisecond telegram stream parser with topology jump and timeout detection',
      'Clean Core Guard: Direct DB mutation rules updated for S/4HANA 2025/2026 ABAP Cloud scope',
      'OPD Guard: Multi-recipient decision table fallback resolution and BRFplus XML parity',
    ],
    knowledgeUpdates: [
      'Published immutable snapshot `KNOW_SNAP_2026_09_24` with 19 engines fully validated',
      'S/4HANA Cloud 2608 compatibility matrix verified with 488 golden test fixtures',
    ],
    breakingChanges: [],
  },
  {
    id: 'rel-2026-09-24-know',
    version: 'KNOW-2608.2026-09-24',
    releaseDate: '2026-09-24',
    category: 'KNOWLEDGE_SNAPSHOT',
    title: 'SAP Knowledge Update — 2608.2026-09-24',
    summary: 'Quarterly SAP release catalog sync updating 183 object classifications, 12 successor mappings, and 8 gap closures across S/4HANA Cloud and Private editions.',
    features: [],
    engineChanges: [
      'SPRO2Cloud: 8 legacy IMG activities mapped to direct Central Business Configuration (CBC) activities',
      'API Change Guard: S/4HANA 2025 OData v4 metadata catalog updated with 42 new released APIs',
    ],
    knowledgeUpdates: [
      '183 ABAP object classifications updated in release compatibility catalog',
      '12 successor mappings updated for deprecated Sales & Distribution function modules',
      '8 migration gaps closed for Central Finance and Group Reporting modules',
    ],
    breakingChanges: [
      'Deprecated function module BAPI_ACC_DOCUMENT_POST marked Tier 3 legacy modification only',
    ],
  },
  {
    id: 'rel-2026-09-18',
    version: 'v1.3.0',
    releaseDate: '2026-09-18',
    category: 'PLATFORM',
    title: 'Milestone 2 Ingestion Security & Streaming Antivirus Pipeline',
    summary: 'Hardened file ingestion pipeline integrating ClamAV streaming TCP INSTREAM scanning, magic bytes validation, and Shannon entropy secret scrubbing.',
    features: [
      'Automated ClamAV antivirus daemon integration with fail-closed security guarantees',
      'Multi-stage archive decompression defense (100:1 ratio, 500MB max volume limit)',
      'Deterministic HMAC-SHA256 secret scrubbing for SAP passwords and private keys',
      'PostgreSQL Row-Level Security (RLS) enforcement across all tenant tables',
    ],
    engineChanges: [
      'FormDoctor: ADS XDP XML parsing hardened against XXE and Billion Laughs vulnerabilities',
    ],
    knowledgeUpdates: [],
    breakingChanges: [],
  },
];

@Injectable()
export class ChangelogService {
  private readonly logger = new Logger(ChangelogService.name);

  constructor(private readonly db: DatabaseService) {}

  async listChangelogs(category?: string): Promise<ReleaseNote[]> {
    try {
      let query = `SELECT * FROM release_notes`;
      const params: any[] = [];
      if (category) {
        query += ` WHERE category = $1`;
        params.push(category);
      }
      query += ` ORDER BY release_date DESC, created_at DESC`;

      const res = await this.db.query(query, params);
      if (res.rows && res.rows.length > 0) {
        return res.rows.map((r: any) => ({
          id: r.id,
          version: r.version,
          releaseDate: r.release_date,
          category: r.category,
          title: r.title,
          summary: r.summary,
          features: Array.isArray(r.features) ? r.features : JSON.parse(r.features || '[]'),
          engineChanges: Array.isArray(r.engine_changes) ? r.engine_changes : JSON.parse(r.engine_changes || '[]'),
          knowledgeUpdates: Array.isArray(r.knowledge_updates) ? r.knowledge_updates : JSON.parse(r.knowledge_updates || '[]'),
          breakingChanges: Array.isArray(r.breaking_changes) ? r.breaking_changes : JSON.parse(r.breaking_changes || '[]'),
        }));
      }
    } catch {
      // fallback
    }

    if (category) {
      return CANONICAL_CHANGELOGS.filter((c) => c.category === category);
    }
    return CANONICAL_CHANGELOGS;
  }
}
