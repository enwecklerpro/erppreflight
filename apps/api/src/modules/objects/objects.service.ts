import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { QueryObjectsDto, CreateSapObjectDto } from './dto/object.dto';

export interface SapObjectEntity {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  object_type: string;
  description: string;
  package: string;
  software_component: string;
  clean_core_tier: string;
  modification_status: string;
  complexity: any;
  finding_summary: any;
  dependencies: any[];
  last_changed_by: string;
  last_changed_at: string;
  transport_request: string | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class ObjectsService {
  private readonly logger = new Logger(ObjectsService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Seed enterprise SAP object catalog for a project if empty.
   */
  private async ensureSeedObjects(organizationId: string, projectId: string): Promise<void> {
    const existing = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM sap_objects WHERE organization_id = $1 AND project_id = $2`,
      [organizationId, projectId]
    );

    if (parseInt(existing.rows?.[0]?.count || '0', 10) > 0) {
      return;
    }

    this.logger.log(`Seeding initial enterprise SAP object catalog for project ${projectId}...`);

    const seedData = [
      {
        name: 'Z_I_SalesOrderEnhanced',
        type: 'CDS',
        desc: 'Core Data Services entity extending standard I_SalesOrder with key-user custom fields',
        pkg: 'Z_SALES_ORDER',
        tier: 'TIER_1_CLOUD',
        status: 'CUSTOM_Z',
        complexity: { score: 28, level: 'LOW', linesOfCode: 85, statementsCount: 22, cyclomaticComplexity: 2 },
        findingSummary: {
          totalCount: 0,
          blockerCount: 0,
          criticalCount: 0,
          majorCount: 0,
          minorCount: 0,
          infoCount: 0,
          findings: [],
        },
        dependencies: [
          {
            targetName: 'I_SalesOrder',
            targetType: 'CDS',
            direction: 'OUTBOUND',
            dependencyType: 'CDS_ASSOCIATION',
            releaseContract: 'RELEASED_C1',
            cleanCoreTier: 'TIER_1_CLOUD',
            isCleanCoreHazard: false,
          },
        ],
        transport: 'TRK900142',
      },
      {
        name: 'ZCL_PURCHASE_ORDER_ENGINE',
        type: 'CLAS',
        desc: 'ABAP OO business class managing purchase order validation and approval workflow triggers',
        pkg: 'Z_MM_PURCHASING',
        tier: 'TIER_2_DEVELOPER',
        status: 'CUSTOM_Z',
        complexity: { score: 62, level: 'HIGH', linesOfCode: 420, statementsCount: 115, cyclomaticComplexity: 14 },
        findingSummary: {
          totalCount: 1,
          blockerCount: 0,
          criticalCount: 1,
          majorCount: 0,
          minorCount: 0,
          infoCount: 0,
          findings: [
            {
              id: 'a0000000-0000-0000-0000-000000000001',
              ruleId: 'CLEAN_CORE_TIER2_UNRELEASED_API_USAGE',
              severity: 'CRITICAL',
              title: 'Class calls unreleased classic function module BAPI_PO_GETDETAIL',
              remediation: 'Refactor to released successor CDS view I_PurchaseOrderAPI01 or RAP BO',
            },
          ],
        },
        dependencies: [
          {
            targetName: 'BAPI_PO_GETDETAIL',
            targetType: 'FUGR',
            direction: 'OUTBOUND',
            dependencyType: 'FUNCTION_CALL',
            releaseContract: 'NOT_RELEASED',
            cleanCoreTier: 'TIER_3_CLASSIC',
            isCleanCoreHazard: true,
            recommendedSuccessor: 'I_PurchaseOrderAPI01',
          },
        ],
        transport: 'TRK900145',
      },
      {
        name: 'ZR_BILLING_OUTPUT_DISPATCH',
        type: 'PROG',
        desc: 'Legacy ABAP dispatch report mutating standard financial table BKPF directly',
        pkg: 'Z_FIN_ACDOCA',
        tier: 'TIER_3_CLASSIC',
        status: 'CUSTOM_Z',
        complexity: { score: 85, level: 'VERY_HIGH', linesOfCode: 1250, statementsCount: 380, cyclomaticComplexity: 29 },
        findingSummary: {
          totalCount: 2,
          blockerCount: 1,
          criticalCount: 1,
          majorCount: 0,
          minorCount: 0,
          infoCount: 0,
          findings: [
            {
              id: 'a0000000-0000-0000-0000-000000000002',
              ruleId: 'CLEAN_CORE_TIER3_DIRECT_DB_MUTATION',
              severity: 'BLOCKER',
              title: 'Direct Open SQL UPDATE into standard financial document header BKPF',
              remediation: 'Replace with Accounting Document Post RAP BO or BAdI BADI_ACC_DOCUMENT',
            },
          ],
        },
        dependencies: [
          {
            targetName: 'BKPF',
            targetType: 'TABL',
            direction: 'OUTBOUND',
            dependencyType: 'DIRECT_SQL',
            releaseContract: 'NOT_RELEASED',
            cleanCoreTier: 'TIER_3_CLASSIC',
            isCleanCoreHazard: true,
            recommendedSuccessor: 'I_JournalEntryTP',
          },
        ],
        transport: 'TRK900108',
      },
      {
        name: 'ZFORM_INVOICE_PDF',
        type: 'FORM',
        desc: 'Adobe Document Services (ADS) LiveCycle XDP form template for billing invoices',
        pkg: 'Z_SALES_ORDER',
        tier: 'TIER_1_CLOUD',
        status: 'CUSTOM_Z',
        complexity: { score: 45, level: 'MEDIUM', linesOfCode: 310, statementsCount: 65, cyclomaticComplexity: 5 },
        findingSummary: {
          totalCount: 1,
          blockerCount: 0,
          criticalCount: 0,
          majorCount: 1,
          minorCount: 0,
          infoCount: 0,
          findings: [
            {
              id: 'a0000000-0000-0000-0000-000000000003',
              ruleId: 'ADS_FORM_DATA_BINDING_BROKEN',
              severity: 'MAJOR',
              title: 'Context element CustomerTaxId disconnected from schema provider',
              remediation: 'Rebind CustomerTaxId to interface node KNA1-STCEG',
            },
          ],
        },
        dependencies: [
          {
            targetName: 'Z_I_SalesOrderEnhanced',
            targetType: 'CDS',
            direction: 'INBOUND',
            dependencyType: 'TABLE_REFERENCE',
            releaseContract: 'RELEASED_C1',
            cleanCoreTier: 'TIER_1_CLOUD',
            isCleanCoreHazard: false,
          },
        ],
        transport: 'TRK900142',
      },
      {
        name: 'ZINV_HEADER_CUSTOM',
        type: 'TABL',
        desc: 'Custom transparent database table storing regional e-invoicing compliance metadata',
        pkg: 'Z_FIN_ACDOCA',
        tier: 'TIER_1_CLOUD',
        status: 'CUSTOM_Z',
        complexity: { score: 12, level: 'LOW', linesOfCode: 45, statementsCount: 15, cyclomaticComplexity: 1 },
        findingSummary: {
          totalCount: 0,
          blockerCount: 0,
          criticalCount: 0,
          majorCount: 0,
          minorCount: 0,
          infoCount: 0,
          findings: [],
        },
        dependencies: [],
        transport: 'TRK900099',
      },
      {
        name: 'ZBADI_OUTPUT_DETERMINATION',
        type: 'BADI',
        desc: 'Cloud BAdI implementation for custom email routing based on customer sales group',
        pkg: 'Z_CLEAN_CORE',
        tier: 'TIER_1_CLOUD',
        status: 'CUSTOM_Z',
        complexity: { score: 32, level: 'LOW', linesOfCode: 140, statementsCount: 42, cyclomaticComplexity: 4 },
        findingSummary: {
          totalCount: 0,
          blockerCount: 0,
          criticalCount: 0,
          majorCount: 0,
          minorCount: 0,
          infoCount: 0,
          findings: [],
        },
        dependencies: [
          {
            targetName: 'IF_OUTPUT_DETERMINATION_BADI',
            targetType: 'INTF',
            direction: 'OUTBOUND',
            dependencyType: 'BADI_CALL',
            releaseContract: 'RELEASED_C1',
            cleanCoreTier: 'TIER_1_CLOUD',
            isCleanCoreHazard: false,
          },
        ],
        transport: 'TRK900150',
      },
      {
        name: 'Z_MFS_PLC_BUFFER_ROUTER',
        type: 'CLAS',
        desc: 'SAP EWM Material Flow Systems telegram processor resolving high-bay conveyor routing',
        pkg: 'Z_EWM_MFS',
        tier: 'TIER_2_DEVELOPER',
        status: 'CUSTOM_Z',
        complexity: { score: 74, level: 'HIGH', linesOfCode: 890, statementsCount: 240, cyclomaticComplexity: 19 },
        findingSummary: {
          totalCount: 1,
          blockerCount: 0,
          criticalCount: 1,
          majorCount: 0,
          minorCount: 0,
          infoCount: 0,
          findings: [
            {
              id: 'a0000000-0000-0000-0000-000000000004',
              ruleId: 'MFS_TELEGRAM_COLLISION_HAZARD',
              severity: 'CRITICAL',
              title: 'High-bay loop sequence missing handshake confirmation for segment CP04',
              remediation: 'Introduce telegram acknowledgment wait state before dispatching next move task',
            },
          ],
        },
        dependencies: [],
        transport: 'TRK900160',
      },
    ];

    for (const obj of seedData) {
      await this.db.query(
        `INSERT INTO sap_objects (
          organization_id, project_id, name, object_type, description, package,
          software_component, clean_core_tier, modification_status, complexity,
          finding_summary, dependencies, transport_request, last_changed_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          organizationId,
          projectId,
          obj.name,
          obj.type,
          obj.desc,
          obj.pkg,
          'ZCUSTOM',
          obj.tier,
          obj.status,
          JSON.stringify(obj.complexity),
          JSON.stringify(obj.findingSummary),
          JSON.stringify(obj.dependencies),
          obj.transport,
          'SYSTEM_MIGRATION_AUDITOR',
        ]
      );
    }
  }

  /**
   * Find all SAP objects for a project workspace with filtering, pagination, and facets.
   */
  async findAll(organizationId: string, projectId: string, query: QueryObjectsDto) {
    await this.ensureSeedObjects(organizationId, projectId);

    const conditions: string[] = ['organization_id = $1', 'project_id = $2'];
    const params: any[] = [organizationId, projectId];
    let paramIdx = 3;

    if (query.search?.trim()) {
      conditions.push(`(name ILIKE $${paramIdx} OR description ILIKE $${paramIdx})`);
      params.push(`%${query.search.trim()}%`);
      paramIdx++;
    }

    if (query.objectType?.trim()) {
      const types = query.objectType.split(',').map((t) => t.trim());
      conditions.push(`object_type = ANY($${paramIdx})`);
      params.push(types);
      paramIdx++;
    }

    if (query.cleanCoreTier?.trim()) {
      const tiers = query.cleanCoreTier.split(',').map((t) => t.trim());
      conditions.push(`clean_core_tier = ANY($${paramIdx})`);
      params.push(tiers);
      paramIdx++;
    }

    if (query.package?.trim()) {
      const pkgs = query.package.split(',').map((p) => p.trim());
      conditions.push(`package = ANY($${paramIdx})`);
      params.push(pkgs);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    // 1. Total & Filtered Counts
    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM sap_objects WHERE ${whereClause}`,
      params
    );
    const totalCount = parseInt(countResult.rows?.[0]?.count || '0', 10);

    // 2. Pagination & Sorting
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 50;
    const offset = (page - 1) * pageSize;

    const allowedSortFields: Record<string, string> = {
      name: 'name',
      objectType: 'object_type',
      package: 'package',
      cleanCoreTier: 'clean_core_tier',
      createdAt: 'created_at',
      lastChangedAt: 'last_changed_at',
    };
    const sortCol = allowedSortFields[query.sortField || 'name'] || 'name';
    const sortDir = query.sortOrder === 'desc' ? 'DESC' : 'ASC';

    const itemsQuery = `
      SELECT * FROM sap_objects
      WHERE ${whereClause}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;
    const itemsParams = [...params, pageSize, offset];
    const itemsResult = await this.db.query<SapObjectEntity>(itemsQuery, itemsParams);
    const items = itemsResult.rows || [];

    // 3. Aggregate Facets for Filtering
    const allObjectsResult = await this.db.query<SapObjectEntity>(
      `SELECT object_type, clean_core_tier, package, finding_summary FROM sap_objects WHERE organization_id = $1 AND project_id = $2`,
      [organizationId, projectId]
    );
    const allObjects = allObjectsResult.rows || [];

    const typeCounts: Record<string, number> = {};
    const tierCounts: Record<string, number> = {};
    const packageCounts: Record<string, number> = {};
    let withFindingsCount = 0;
    let cleanCount = 0;

    for (const obj of allObjects) {
      typeCounts[obj.object_type] = (typeCounts[obj.object_type] || 0) + 1;
      tierCounts[obj.clean_core_tier] = (tierCounts[obj.clean_core_tier] || 0) + 1;
      packageCounts[obj.package] = (packageCounts[obj.package] || 0) + 1;

      const summary = typeof obj.finding_summary === 'string' ? JSON.parse(obj.finding_summary) : obj.finding_summary;
      if (summary?.totalCount > 0) {
        withFindingsCount++;
      } else {
        cleanCount++;
      }
    }

    return {
      items: items.map((i) => this.mapToDomain(i)),
      totalCount,
      page,
      pageSize,
      totalPages: Math.ceil(totalCount / pageSize),
      facets: {
        typeCounts,
        tierCounts,
        packageCounts,
        findingsStatusCounts: {
          withFindings: withFindingsCount,
          clean: cleanCount,
        },
      },
    };
  }

  /**
   * Find single SAP object with deep dependencies.
   */
  async findOne(organizationId: string, projectId: string, id: string) {
    const res = await this.db.query<SapObjectEntity>(
      `SELECT * FROM sap_objects WHERE organization_id = $1 AND project_id = $2 AND id = $3`,
      [organizationId, projectId, id]
    );

    if (!res.rows || res.rows.length === 0) {
      throw new NotFoundException(`SAP Object with ID '${id}' not found`);
    }

    return this.mapToDomain(res.rows[0]);
  }

  /**
   * Create / register a new SAP technical object.
   */
  async create(organizationId: string, projectId: string, dto: CreateSapObjectDto) {
    const res = await this.db.query<SapObjectEntity>(
      `INSERT INTO sap_objects (
        organization_id, project_id, name, object_type, description, package,
        software_component, clean_core_tier, modification_status, complexity,
        dependencies, transport_request
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        organizationId,
        projectId,
        dto.name,
        dto.objectType,
        dto.description || '',
        dto.package || '$TMP',
        dto.softwareComponent || 'ZCUSTOM',
        dto.cleanCoreTier || 'TIER_1_CLOUD',
        dto.modificationStatus || 'CUSTOM_Z',
        JSON.stringify(dto.complexity || { score: 15, level: 'LOW', linesOfCode: 100, statementsCount: 25, cyclomaticComplexity: 2 }),
        JSON.stringify(dto.dependencies || []),
        dto.transportRequest || null,
      ]
    );

    return this.mapToDomain(res.rows[0]);
  }

  private mapToDomain(entity: SapObjectEntity) {
    return {
      id: entity.id,
      projectId: entity.project_id,
      organizationId: entity.organization_id,
      name: entity.name,
      objectType: entity.object_type,
      description: entity.description,
      package: entity.package,
      softwareComponent: entity.software_component,
      cleanCoreTier: entity.clean_core_tier,
      modificationStatus: entity.modification_status,
      complexity: typeof entity.complexity === 'string' ? JSON.parse(entity.complexity) : entity.complexity,
      findingSummary: typeof entity.finding_summary === 'string' ? JSON.parse(entity.finding_summary) : entity.finding_summary,
      dependencies: typeof entity.dependencies === 'string' ? JSON.parse(entity.dependencies) : entity.dependencies,
      lastChangedBy: entity.last_changed_by,
      lastChangedAt: entity.last_changed_at,
      transportRequest: entity.transport_request,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at,
    };
  }
}
