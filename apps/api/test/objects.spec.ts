import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectsService } from '../src/modules/objects/objects.service';
import { ObjectsController } from '../src/modules/objects/objects.controller';
import { NotFoundException } from '@nestjs/common';

describe('ObjectsModule — SAP Object Catalog & Clean Core Inventory (Part 14.35)', () => {
  let mockDb: any;
  let service: ObjectsService;
  let controller: ObjectsController;

  const orgId = '11111111-1111-1111-1111-111111111111';
  const projectId = '22222222-2222-2222-2222-222222222222';
  const objectId = '33333333-3333-3333-3333-333333333333';

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    service = new ObjectsService(mockDb);
    controller = new ObjectsController(service);
  });

  describe('ObjectsService.findAll', () => {
    it('auto-seeds enterprise SAP objects when project catalog is empty', async () => {
      // 1. Initial count check returns 0
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // ensureSeedObjects count check
        // Multiple INSERTs for seed objects...
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        // 2. Filtered count
        .mockResolvedValueOnce({ rows: [{ count: '7' }] })
        // 3. Items query
        .mockResolvedValueOnce({
          rows: [
            {
              id: objectId,
              organization_id: orgId,
              project_id: projectId,
              name: 'Z_I_SalesOrderEnhanced',
              object_type: 'CDS',
              description: 'Core Data Services entity',
              package: 'Z_SALES_ORDER',
              software_component: 'ZCUSTOM',
              clean_core_tier: 'TIER_1_CLOUD',
              modification_status: 'CUSTOM_Z',
              complexity: { score: 28, level: 'LOW' },
              finding_summary: { totalCount: 0, findings: [] },
              dependencies: [],
              last_changed_by: 'DEVELOPER',
              last_changed_at: new Date().toISOString(),
              transport_request: 'TRK900142',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        })
        // 4. Facets query
        .mockResolvedValueOnce({
          rows: [
            {
              object_type: 'CDS',
              clean_core_tier: 'TIER_1_CLOUD',
              package: 'Z_SALES_ORDER',
              finding_summary: { totalCount: 0 },
            },
          ],
        });

      const result = await service.findAll(orgId, projectId, {
        page: 1,
        pageSize: 50,
      });

      expect(result).toBeDefined();
      expect(result.items.length).toBe(1);
      expect(result.items[0].name).toBe('Z_I_SalesOrderEnhanced');
      expect(result.items[0].cleanCoreTier).toBe('TIER_1_CLOUD');
      expect(result.totalCount).toBe(7);
      expect(result.facets.typeCounts['CDS']).toBe(1);
      expect(result.facets.tierCounts['TIER_1_CLOUD']).toBe(1);
      expect(result.facets.findingsStatusCounts.clean).toBe(1);
    });

    it('filters by objectType and cleanCoreTier', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ count: '7' }] }) // already seeded
        .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // filtered count
        .mockResolvedValueOnce({
          rows: [
            {
              id: objectId,
              organization_id: orgId,
              project_id: projectId,
              name: 'ZR_BILLING_OUTPUT_DISPATCH',
              object_type: 'PROG',
              description: 'Legacy report',
              package: 'Z_FIN_ACDOCA',
              software_component: 'ZCUSTOM',
              clean_core_tier: 'TIER_3_CLASSIC',
              modification_status: 'CUSTOM_Z',
              complexity: { score: 85, level: 'VERY_HIGH' },
              finding_summary: { totalCount: 2, blockerCount: 1, findings: [] },
              dependencies: [],
              last_changed_by: 'DEVELOPER',
              last_changed_at: new Date().toISOString(),
              transport_request: 'TRK900108',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              object_type: 'PROG',
              clean_core_tier: 'TIER_3_CLASSIC',
              package: 'Z_FIN_ACDOCA',
              finding_summary: { totalCount: 2 },
            },
          ],
        });

      const result = await service.findAll(orgId, projectId, {
        objectType: 'PROG',
        cleanCoreTier: 'TIER_3_CLASSIC',
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].objectType).toBe('PROG');
      expect(result.items[0].cleanCoreTier).toBe('TIER_3_CLASSIC');
      expect(result.facets.findingsStatusCounts.withFindings).toBe(1);
    });
  });

  describe('ObjectsService.findOne', () => {
    it('returns an existing SAP object', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: objectId,
            organization_id: orgId,
            project_id: projectId,
            name: 'ZCL_PURCHASE_ORDER_ENGINE',
            object_type: 'CLAS',
            description: 'Class managing PO validation',
            package: 'Z_MM_PURCHASING',
            software_component: 'ZCUSTOM',
            clean_core_tier: 'TIER_2_DEVELOPER',
            modification_status: 'CUSTOM_Z',
            complexity: { score: 62, level: 'HIGH' },
            finding_summary: { totalCount: 1, criticalCount: 1, findings: [] },
            dependencies: [
              {
                targetName: 'BAPI_PO_GETDETAIL',
                targetType: 'FUGR',
                direction: 'OUTBOUND',
                isCleanCoreHazard: true,
              },
            ],
            last_changed_by: 'DEVELOPER',
            last_changed_at: new Date().toISOString(),
            transport_request: 'TRK900145',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });

      const obj = await service.findOne(orgId, projectId, objectId);

      expect(obj).toBeDefined();
      expect(obj.id).toBe(objectId);
      expect(obj.name).toBe('ZCL_PURCHASE_ORDER_ENGINE');
      expect(obj.dependencies.length).toBe(1);
      expect(obj.dependencies[0].targetName).toBe('BAPI_PO_GETDETAIL');
    });

    it('throws NotFoundException when object does not exist', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.findOne(orgId, projectId, 'non-existent-id')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('ObjectsService.create', () => {
    it('inserts and returns newly created SAP object', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: objectId,
            organization_id: orgId,
            project_id: projectId,
            name: 'Z_NEW_BADI_IMPL',
            object_type: 'BADI',
            description: 'New cloud BAdI',
            package: 'Z_CLEAN_CORE',
            software_component: 'ZCUSTOM',
            clean_core_tier: 'TIER_1_CLOUD',
            modification_status: 'CUSTOM_Z',
            complexity: { score: 15, level: 'LOW' },
            finding_summary: { totalCount: 0, findings: [] },
            dependencies: [],
            last_changed_by: 'DEVELOPER',
            last_changed_at: new Date().toISOString(),
            transport_request: 'TRK900999',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });

      const created = await service.create(orgId, projectId, {
        name: 'Z_NEW_BADI_IMPL',
        objectType: 'BADI',
        description: 'New cloud BAdI',
        package: 'Z_CLEAN_CORE',
        cleanCoreTier: 'TIER_1_CLOUD',
        transportRequest: 'TRK900999',
      });

      expect(created).toBeDefined();
      expect(created.name).toBe('Z_NEW_BADI_IMPL');
      expect(created.cleanCoreTier).toBe('TIER_1_CLOUD');
    });
  });

  describe('ObjectsController', () => {
    it('delegates findAll with req.user.organizationId', async () => {
      const spy = vi.spyOn(service, 'findAll').mockResolvedValueOnce({
        items: [],
        totalCount: 0,
        page: 1,
        pageSize: 50,
        totalPages: 0,
        facets: {
          typeCounts: {},
          tierCounts: {},
          packageCounts: {},
          findingsStatusCounts: { withFindings: 0, clean: 0 },
        },
      });

      const req = { user: { organizationId: orgId } };
      await controller.findAll(req, projectId, { search: 'sales' });

      expect(spy).toHaveBeenCalledWith(orgId, projectId, { search: 'sales' });
    });
  });
});
