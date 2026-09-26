import { Injectable, NotFoundException } from '@nestjs/common';
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

function parseVoters(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Tenant-scoped customer feedback. Every read and write is constrained to the
 * caller's membership-verified organization, both explicitly (WHERE
 * organization_id) and through the customer_feedback RLS policy (migration 010).
 */
@Injectable()
export class FeedbackService {
  constructor(private readonly db: DatabaseService) {}

  async listFeedback(organizationId: string, userId?: string): Promise<FeedbackItem[]> {
    const res = await this.db.query(
      `SELECT * FROM customer_feedback
       WHERE organization_id = $1
       ORDER BY votes DESC, created_at DESC
       LIMIT 50`,
      [organizationId],
      { tenantId: organizationId }
    );
    return (res.rows || []).map((r: any) => {
      const voters = parseVoters(r.voters);
      return {
        id: r.id,
        organizationId: r.organization_id,
        projectId: r.project_id ?? undefined,
        findingId: r.finding_id ?? undefined,
        feedbackType: r.feedback_type,
        title: r.title,
        description: r.description,
        status: r.status,
        votes: r.votes,
        targetEngine: r.target_engine ?? undefined,
        submittedBy: r.submitted_by ?? undefined,
        hasVoted: userId ? voters.includes(userId) : false,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }

  async createFeedback(
    organizationId: string,
    userId: string,
    dto: CreateFeedbackDto
  ): Promise<FeedbackItem> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const feedbackType = dto.feedbackType || FeedbackType.FEATURE_REQUEST;

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
        feedbackType,
        dto.title,
        dto.description,
        JSON.stringify([userId]),
        dto.targetEngine || null,
        userId,
      ],
      { tenantId: organizationId }
    );

    return {
      id,
      organizationId,
      projectId: dto.projectId,
      findingId: dto.findingId,
      feedbackType,
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

  /** Atomically toggles the caller's vote on a feedback item of their own organization. */
  async toggleVote(
    organizationId: string,
    feedbackId: string,
    userId: string
  ): Promise<{ votes: number; hasVoted: boolean }> {
    const res = await this.db.query(
      `UPDATE customer_feedback
       SET voters = CASE WHEN voters ? $3::text THEN voters - $3::text ELSE voters || to_jsonb($3::text) END,
           votes = CASE WHEN voters ? $3::text THEN GREATEST(votes - 1, 0) ELSE votes + 1 END,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING votes, (voters ? $3::text) AS has_voted`,
      [feedbackId, organizationId, userId],
      { tenantId: organizationId }
    );
    const row = res.rows?.[0];
    if (!row) {
      throw new NotFoundException(`Feedback with ID '${feedbackId}' not found`);
    }
    return { votes: Number(row.votes), hasVoted: Boolean(row.has_voted) };
  }

  /** Status triage (restricted to SUPER_ADMIN at the controller). */
  async updateStatus(
    organizationId: string,
    feedbackId: string,
    dto: UpdateFeedbackStatusDto
  ): Promise<{ id: string; status: string }> {
    const res = await this.db.query(
      `UPDATE customer_feedback SET status = $1, updated_at = NOW()
       WHERE id = $2 AND organization_id = $3
       RETURNING id, status`,
      [dto.status, feedbackId, organizationId],
      { tenantId: organizationId }
    );
    if (!res.rows?.length) {
      throw new NotFoundException(`Feedback with ID '${feedbackId}' not found`);
    }
    return res.rows[0];
  }
}
