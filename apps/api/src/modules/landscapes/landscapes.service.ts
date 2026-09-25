import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateLandscapeDto } from './dto/landscape.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LandscapesService {
  private readonly logger = new Logger(LandscapesService.name);

  constructor(private readonly db: DatabaseService) {}

  async create(organizationId: string, dto: CreateLandscapeDto) {
    const id = uuidv4();
    const res = await this.db.query(
      `INSERT INTO landscapes (
        id, organization_id, system_id, product, edition, release, environment, url, business_role, criticality
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        id,
        organizationId,
        dto.systemId,
        dto.product,
        dto.edition,
        dto.release,
        dto.environment,
        dto.url || null,
        dto.businessRole || 'Core ERP Node',
        dto.criticality || 'HIGH',
      ]
    );
    return res.rows[0];
  }

  async findAll(organizationId: string) {
    let res = await this.db.query(
      `SELECT * FROM landscapes WHERE organization_id = $1 ORDER BY environment ASC, system_id ASC`,
      [organizationId]
    );

    // Auto-seed default landscape if empty
    if (!res.rows?.length) {
      await this.create(organizationId, {
        systemId: 'S4H_DEV_100',
        product: 'SAP S/4HANA',
        edition: 'Private Cloud',
        release: '2023',
        environment: 'DEV',
        url: 'https://s4h-dev.internal:44300',
        businessRole: 'Development & Custom Code Authoring',
        criticality: 'MEDIUM',
      });
      await this.create(organizationId, {
        systemId: 'S4H_QA_200',
        product: 'SAP S/4HANA',
        edition: 'Private Cloud',
        release: '2023',
        environment: 'QA',
        url: 'https://s4h-qa.internal:44300',
        businessRole: 'Preflight Regression & Integration Testing',
        criticality: 'HIGH',
      });
      await this.create(organizationId, {
        systemId: 'S4H_PRD_400',
        product: 'SAP S/4HANA',
        edition: 'Private Cloud',
        release: '2023',
        environment: 'PROD',
        url: 'https://s4h-prd.corp.internal:44300',
        businessRole: 'Live Production Core ERP',
        criticality: 'CRITICAL',
      });

      res = await this.db.query(
        `SELECT * FROM landscapes WHERE organization_id = $1 ORDER BY environment ASC, system_id ASC`,
        [organizationId]
      );
    }

    return res.rows;
  }

  async remove(organizationId: string, id: string) {
    const res = await this.db.query(
      `DELETE FROM landscapes WHERE organization_id = $1 AND id = $2 RETURNING id`,
      [organizationId, id]
    );
    if (!res.rows?.length) {
      throw new NotFoundException(`Landscape with ID '${id}' not found`);
    }
    return { success: true, deletedId: id };
  }
}
