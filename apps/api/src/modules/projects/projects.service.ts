import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ProjectsService {
  constructor(private readonly db: DatabaseService) {}

  async create(organizationId: string, userId: string, dto: CreateProjectDto) {
    const id = uuidv4();
    const slug = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50);

    const targetRelease = dto.targetRelease || 'S4H_2023';

    const res = await this.db.query(
      `INSERT INTO projects (id, organization_id, name, slug, description, target_release, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, organizationId, dto.name, `${slug}-${Date.now().toString().slice(-4)}`, dto.description || null, targetRelease, userId]
    );

    return res.rows[0];
  }

  async findAll(organizationId: string) {
    const res = await this.db.query(
      `SELECT p.*, COUNT(f.id)::int as total_findings
       FROM projects p
       LEFT JOIN findings f ON f.project_id = p.id
       WHERE p.organization_id = $1
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [organizationId]
    );
    return res.rows;
  }

  async findOne(organizationId: string, id: string) {
    const res = await this.db.query(
      'SELECT * FROM projects WHERE organization_id = $1 AND id = $2',
      [organizationId, id]
    );
    if (res.rows.length === 0) {
      throw new NotFoundException(`Project with ID '${id}' not found`);
    }
    return res.rows[0];
  }

  async update(organizationId: string, id: string, dto: UpdateProjectDto) {
    await this.findOne(organizationId, id); // Ensure exists

    const res = await this.db.query(
      `UPDATE projects
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           target_release = COALESCE($3, target_release),
           updated_at = NOW()
       WHERE organization_id = $4 AND id = $5
       RETURNING *`,
      [dto.name || null, dto.description || null, dto.targetRelease || null, organizationId, id]
    );
    return res.rows[0];
  }

  async remove(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    await this.db.query(
      'DELETE FROM projects WHERE organization_id = $1 AND id = $2',
      [organizationId, id]
    );
    return { success: true, deletedId: id };
  }
}
