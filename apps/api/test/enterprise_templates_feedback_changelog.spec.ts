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
    it('lists default feedback items with user vote state', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });
      const service = new FeedbackService(mockDb);

      const items = await service.listFeedback('user-1');
      expect(items.length).toBeGreaterThanOrEqual(4);
      expect(items.some((i) => i.title.includes('DCL Syntax Parser'))).toBe(true);
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
        expect.any(Array)
      );
    });

    it('toggles upvote and downvote on feedback item', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ id: 'fb-1', votes: 5, voters: JSON.stringify(['other-user']) }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const service = new FeedbackService(mockDb);
      const voteRes = await service.toggleVote('fb-1', 'user-1');

      expect(voteRes.hasVoted).toBe(true);
      expect(voteRes.votes).toBe(6);
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
