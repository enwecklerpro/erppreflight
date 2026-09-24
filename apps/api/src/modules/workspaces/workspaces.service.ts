import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UpdateWorkspaceDto } from './dto/workspace.dto';

@Injectable()
export class WorkspacesService {
  constructor(private readonly db: DatabaseService) {}

  async getWorkspace(organizationId: string) {
    const res = await this.db.query(
      'SELECT id, name, slug, plan_tier, status, data_policy, created_at, updated_at FROM organizations WHERE id = $1',
      [organizationId],
      { bypassRls: true }
    );
    if (res.rows.length === 0) {
      throw new NotFoundException('Workspace not found');
    }
    return res.rows[0];
  }

  async updateWorkspace(organizationId: string, dto: UpdateWorkspaceDto) {
    const res = await this.db.query(
      `UPDATE organizations 
       SET name = $1, data_policy = COALESCE($2, data_policy), updated_at = NOW()
       WHERE id = $3
       RETURNING id, name, slug, plan_tier, status, data_policy, updated_at`,
      [dto.name, dto.dataPolicy ? JSON.stringify(dto.dataPolicy) : null, organizationId],
      { bypassRls: true }
    );
    if (res.rows.length === 0) {
      throw new NotFoundException('Workspace not found');
    }
    return res.rows[0];
  }

  async getMembers(organizationId: string) {
    const res = await this.db.query(
      `SELECT m.id, m.role, m.permissions, u.id as user_id, u.email, u.full_name, m.created_at
       FROM organization_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1`,
      [organizationId]
    );
    return res.rows;
  }
}
