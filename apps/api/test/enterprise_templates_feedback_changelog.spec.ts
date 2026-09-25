import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplatesService, SYSTEM_TEMPLATES } from '../src/modules/templates/templates.service';
import { FeedbackService } from '../src/modules/feedback/feedback.service';
import { ChangelogService, CANONICAL_CHANGELOGS } from '../src/modules/changelog/changelog.service';
import { FeedbackType, FeedbackStatus } from '../src/modules/feedback/dto/feedback.dto';

describe('Enterprise Platform: Templates, Feedback & Changelog Services', () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
  });

  describe('TemplatesService', () => {
    it('returns system templates when database has no records', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });
      const service = new TemplatesService(mockDb);

      const templates = await service.listTemplates('org-123');
      expect(templates.length).toBeGreaterThanOrEqual(9);
      expect(templates.some((t) => t.slug === 'purchase-order-email-output')).toBe(true);
      expect(templates.some((t) => t.slug === 'mfs-incident-investigation')).toBe(true);
    });

    it('retrieves a template by slug', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });
      const service = new TemplatesService(mockDb);

      const template = await service.getTemplateById('ecc-to-public-cloud-assessment', 'org-123');
      expect(template).toBeDefined();
      expect(template.name).toBe('ECC → Public Cloud Migration Assessment');
      expect(template.engines).toContain('ECC2CLOUD_NAVIGATOR');
    });

    it('creates and persists a custom analysis template', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });
      const service = new TemplatesService(mockDb);

      const result = await service.createCustomTemplate('org-123', {
        name: 'Custom EWM Wave Check',
        description: 'Verifies warehouse wave release rules',
        targetDomain: 'Warehouse Automation',
        engines: ['MFS_BLACKBOX'],
        requiredInputs: ['Wave Release XML'],
      });

      expect(result.id).toBeDefined();
      expect(result.name).toBe('Custom EWM Wave Check');
      expect(result.slug).toBe('custom-ewm-wave-check');
      expect(result.isSystemTemplate).toBe(false);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO analysis_templates'),
        expect.any(Array)
      );
    });
  });

  describe('FeedbackService', () => {
    const ORG_A = '11111111-1111-4111-8111-111111111111';

    it('lists only the caller organization feedback (no global/mock fallback)', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'fb-1',
            organization_id: ORG_A,
            feedback_type: 'FEATURE_REQUEST',
            title: 'DCL Syntax Parser',
            description: 'x',
            status: 'UNDER_REVIEW',
            votes: 2,
            voters: ['user-1'],
          },
        ],
      });
      const service = new FeedbackService(mockDb);

      const items = await service.listFeedback(ORG_A, 'user-1');
      expect(items).toHaveLength(1);
      expect(items[0].hasVoted).toBe(true);
      const [sql, params, opts] = mockDb.query.mock.calls[0];
      expect(sql).toMatch(/WHERE organization_id = \$1/);
      expect(params).toEqual([ORG_A]);
      expect(opts).toEqual({ tenantId: ORG_A });
    });

    it('returns an empty list (not demo data) when the organization has no feedback', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });
      const service = new FeedbackService(mockDb);
      expect(await service.listFeedback(ORG_A, 'user-1')).toEqual([]);
    });

    it('creates a new feedback item', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });
      const service = new FeedbackService(mockDb);

      const item = await service.createFeedback('org-123', 'user-456', {
        title: 'Support CBC SSCUI Auto-Correction',
        description: 'Auto-generate SSCUI transport files for migrated SPRO records',
        feedbackType: FeedbackType.FEATURE_REQUEST,
        targetEngine: 'SPRO2CLOUD',
      });

      expect(item.id).toBeDefined();
      expect(item.title).toBe('Support CBC SSCUI Auto-Correction');
      expect(item.votes).toBe(1);
      expect(item.hasVoted).toBe(true);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO customer_feedback'),
        expect.any(Array),
        { tenantId: 'org-123' }
      );
    });

    it('toggles a vote atomically, scoped to the caller organization', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [{ votes: 6, has_voted: true }] });

      const service = new FeedbackService(mockDb);
      const voteRes = await service.toggleVote(ORG_A, 'fb-1', 'user-1');

      expect(voteRes).toEqual({ votes: 6, hasVoted: true });
      const [sql, params] = mockDb.query.mock.calls[0];
      expect(sql).toMatch(/WHERE id = \$1 AND organization_id = \$2/);
      expect(params).toEqual(['fb-1', ORG_A, 'user-1']);
    });

    it('rejects votes and status changes on feedback of another organization (404)', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });
      const service = new FeedbackService(mockDb);
      await expect(service.toggleVote(ORG_A, 'foreign-fb', 'user-1')).rejects.toThrow(/not found/);
      await expect(
        service.updateStatus(ORG_A, 'foreign-fb', { status: 'SHIPPED' as any })
      ).rejects.toThrow(/not found/);
    });
  });

  describe('ChangelogService', () => {
    it('returns canonical platform and knowledge changelogs', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });
      const service = new ChangelogService(mockDb);

      const list = await service.listChangelogs();
      expect(list.length).toBeGreaterThanOrEqual(3);
      expect(list.some((c) => c.category === 'PLATFORM')).toBe(true);
      expect(list.some((c) => c.category === 'KNOWLEDGE_SNAPSHOT')).toBe(true);
    });

    it('filters changelogs by category', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });
      const service = new ChangelogService(mockDb);

      const knowledgeUpdates = await service.listChangelogs('KNOWLEDGE_SNAPSHOT');
      expect(knowledgeUpdates.every((c) => c.category === 'KNOWLEDGE_SNAPSHOT')).toBe(true);
    });
  });
});
