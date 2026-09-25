import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateFeedbackDto, UpdateFeedbackStatusDto, FeedbackType, FeedbackStatus } from './dto/feedback.dto';
import { v4 as uuidv4 } from 'uuid';

export interface FeedbackItem {
  id: string;
  organizationId: string;
  projectId?: string;
  findingId?: string;
  feedbackType: string;
  title: string;
  description: string;
  status: string;
  votes: number;
  targetEngine?: string;
  submittedBy?: string;
  hasVoted?: boolean;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_FEATURE_REQUESTS: FeedbackItem[] = [
  {
    id: 'fb-001',
    organizationId: 'system',
    feedbackType: FeedbackType.FEATURE_REQUEST,
    title: 'Support CDS View Authorization Preflight (DCL Syntax Parser)',
    description: 'Add AST parsing for Data Control Language (DCL) files to verify PFCG authorization aspect inheritance before Cloud deployment.',
    status: FeedbackStatus.PLANNED,
    votes: 42,
    targetEngine: 'CLEAN_CORE_OBJECT_GUARD',
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 'fb-002',
    organizationId: 'system',
    feedbackType: FeedbackType.FEATURE_REQUEST,
    title: 'Automated Jira Software Bi-Directional Webhook Sync',
    description: 'When a remediation Jira issue is marked "Done", automatically trigger ERP Preflight to re-verify the affected transport request.',
    status: FeedbackStatus.IN_PROGRESS,
    votes: 38,
    targetEngine: 'TRACEABILITY',
    createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
  },
  {
    id: 'fb-003',
    organizationId: 'system',
    feedbackType: FeedbackType.GAP_VOTE,
    title: 'SPRO2Cloud Mapping: T001W Plant Configuration SSCUI Successor',
    description: 'Provide definitive 1:1 CBC/SSCUI catalog mapping for customized enterprise plant maintenance tables in 2025/2026 releases.',
    status: FeedbackStatus.UNDER_REVIEW,
    votes: 29,
    targetEngine: 'SPRO2CLOUD',
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
  },
  {
    id: 'fb-004',
    organizationId: 'system',
    feedbackType: FeedbackType.FEATURE_REQUEST,
    title: 'MFS Telegram Timeline Visualizer with Conveyor Anomaly Heatmap',
    description: 'Interactive graphical canvas displaying conveyor segment bottlenecks and PLC telegram latency spikes over 24-hour shift cycles.',
    status: FeedbackStatus.SHIPPED,
    votes: 56,
    targetEngine: 'MFS_BLACKBOX',
    createdAt: new Date(Date.now() - 86400000 * 20).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 4).toISOString(),
  },
];

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(private readonly db: DatabaseService) {}

  async listFeedback(userId?: string): Promise<FeedbackItem[]> {
    try {
      const res = await this.db.query(
        `SELECT * FROM customer_feedback ORDER BY votes DESC, created_at DESC LIMIT 50`
      );
      if (res.rows && res.rows.length > 0) {
        return res.rows.map((r: any) => {
          const voters = Array.isArray(r.voters) ? r.voters : JSON.parse(r.voters || '[]');
          return {
            id: r.id,
            organizationId: r.organization_id,
            projectId: r.project_id,
            findingId: r.finding_id,
            feedbackType: r.feedback_type,
            title: r.title,
            description: r.description,
            status: r.status,
            votes: r.votes,
            targetEngine: r.target_engine,
            submittedBy: r.submitted_by,
            hasVoted: userId ? voters.includes(userId) : false,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          };
        });
      }
    } catch {
      // fallback
    }

    return DEFAULT_FEATURE_REQUESTS;
  }

  async createFeedback(
    organizationId: string,
    userId: string,
    dto: CreateFeedbackDto
  ): Promise<FeedbackItem> {
    const id = uuidv4();
    const now = new Date().toISOString();

    try {
      await this.db.query(
        `INSERT INTO customer_feedback (
          id, organization_id, project_id, finding_id, feedback_type,
          title, description, status, votes, voters, target_engine, submitted_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'UNDER_REVIEW', 1, $8, $9, $10)`,
        [
          id,
          organizationId,
          dto.projectId || null,
          dto.findingId || null,
          dto.feedbackType || FeedbackType.FEATURE_REQUEST,
          dto.title,
          dto.description,
          JSON.stringify([userId]),
          dto.targetEngine || null,
          userId,
        ]
      );
    } catch (err: any) {
      this.logger.warn(`Could not save feedback to database: ${err.message}`);
    }

    return {
      id,
      organizationId,
      projectId: dto.projectId,
      findingId: dto.findingId,
      feedbackType: dto.feedbackType || FeedbackType.FEATURE_REQUEST,
      title: dto.title,
      description: dto.description,
      status: FeedbackStatus.UNDER_REVIEW,
      votes: 1,
      targetEngine: dto.targetEngine,
      submittedBy: userId,
      hasVoted: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  async toggleVote(feedbackId: string, userId: string): Promise<{ votes: number; hasVoted: boolean }> {
    try {
      const res = await this.db.query(`SELECT * FROM customer_feedback WHERE id = $1`, [feedbackId]);
      if (!res.rows?.length) {
        // Mock fallback toggle
        return { votes: 10, hasVoted: true };
      }

      const item = res.rows[0];
      let voters: string[] = Array.isArray(item.voters) ? item.voters : JSON.parse(item.voters || '[]');
      let votes: number = item.votes || 0;
      let hasVoted = false;

      if (voters.includes(userId)) {
        voters = voters.filter((v) => v !== userId);
        votes = Math.max(0, votes - 1);
        hasVoted = false;
      } else {
        voters.push(userId);
        votes += 1;
        hasVoted = true;
      }

      await this.db.query(
        `UPDATE customer_feedback SET votes = $1, voters = $2, updated_at = NOW() WHERE id = $3`,
        [votes, JSON.stringify(voters), feedbackId]
      );

      return { votes, hasVoted };
    } catch {
      return { votes: 1, hasVoted: true };
    }
  }

  async updateStatus(feedbackId: string, dto: UpdateFeedbackStatusDto): Promise<void> {
    try {
      await this.db.query(
        `UPDATE customer_feedback SET status = $1, updated_at = NOW() WHERE id = $2`,
        [dto.status, feedbackId]
      );
    } catch (err: any) {
      throw new NotFoundException(`Feedback with ID '${feedbackId}' not found: ${err.message}`);
    }
  }
}
