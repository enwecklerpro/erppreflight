import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface UpdateOrganizationDto {
  name?: string;
  dataPolicy?: Record<string, unknown>;
}

@Injectable()
export class OrganizationsService {
  constructor(private readonly db: DatabaseService) {}

  async getCurrentOrganization(organizationId: string) {
    const res = await this.db.query(
      `SELECT id, name, slug, plan_tier, status, data_policy, created_at, updated_at
       FROM organizations
       WHERE id = $1`,
      [organizationId],
      { bypassRls: true }
    );

    if (res.rows.length === 0) {
      throw new NotFoundException(`Organization '${organizationId}' not found.`);
    }

    return res.rows[0];
  }

  async getUserOrganizations(userId: string) {
    const res = await this.db.query(
      `SELECT o.id, o.name, o.slug, o.plan_tier, o.status, m.role, o.created_at
       FROM organizations o
       JOIN organization_members m ON m.organization_id = o.id
       WHERE m.user_id = $1
       ORDER BY o.created_at ASC`,
      [userId],
      { bypassRls: true }
    );

    return res.rows;
  }

  async getMembers(organizationId: string) {
    const res = await this.db.query(
      `SELECT m.id, m.role, m.permissions, u.id as user_id, u.email, u.full_name, m.created_at
       FROM organization_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1
       ORDER BY m.created_at ASC`,
      [organizationId]
    );

    return res.rows;
  }

  async updateCurrentOrganization(
    organizationId: string,
    dto: UpdateOrganizationDto
  ) {
    const res = await this.db.query(
      `UPDATE organizations
       SET name = COALESCE($1, name),
           data_policy = COALESCE($2, data_policy),
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, name, slug, plan_tier, status, data_policy, updated_at`,
      [
        dto.name || null,
        dto.dataPolicy ? JSON.stringify(dto.dataPolicy) : null,
        organizationId,
      ],
      { bypassRls: true }
    );

    if (res.rows.length === 0) {
      throw new NotFoundException(`Organization '${organizationId}' not found.`);
    }

    return res.rows[0];
  }
}
