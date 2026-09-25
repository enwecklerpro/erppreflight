import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateApiKeyDto } from './dto/api-key.dto';
import * as crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(private readonly db: DatabaseService) {}

  async create(organizationId: string, userId: string, dto: CreateApiKeyDto) {
    const id = uuidv4();
    const rawSecret = crypto.randomBytes(24).toString('hex');
    const fullKey = `erppf_live_${rawSecret}`;
    const prefix = fullKey.slice(0, 15);
    const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex');

    const scopes = dto.scopes || [
      'projects:read',
      'analysis:run',
      'analysis:read',
      'reports:read',
    ];

    await this.db.query(
      `INSERT INTO api_keys (
        id, organization_id, name, prefix, key_hash, scopes, expires_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        organizationId,
        dto.name,
        prefix,
        keyHash,
        JSON.stringify(scopes),
        dto.expiresAt ? new Date(dto.expiresAt) : null,
        userId,
      ]
    );

    return {
      id,
      name: dto.name,
      apiKey: fullKey, // Only shown once upon creation!
      prefix,
      scopes,
      expiresAt: dto.expiresAt || null,
      createdAt: new Date().toISOString(),
    };
  }

  async findAll(organizationId: string) {
    const res = await this.db.query(
      `SELECT id, name, prefix, scopes, expires_at, last_used_at, status, created_at
       FROM api_keys
       WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [organizationId]
    );
    return res.rows;
  }

  async revoke(organizationId: string, id: string) {
    const res = await this.db.query(
      `UPDATE api_keys
       SET status = 'REVOKED'
       WHERE organization_id = $1 AND id = $2
       RETURNING id, status`,
      [organizationId, id]
    );
    if (!res.rows?.length) {
      throw new NotFoundException(`API Key with ID '${id}' not found`);
    }
    return { success: true, revokedId: id };
  }

  async validateKey(rawApiKey: string) {
    const keyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');
    const res = await this.db.query(
      `SELECT * FROM api_keys WHERE key_hash = $1 AND status = 'ACTIVE'`,
      [keyHash],
      { bypassRls: true }
    );
    if (!res.rows?.length) {
      return null;
    }
    const keyRecord = res.rows[0];

    // Check expiration
    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      return null;
    }

    // Update last_used_at asynchronously
    this.db.query(
      `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
      [keyRecord.id],
      { bypassRls: true }
    ).catch((err) => this.logger.error(`Failed to update key last_used_at: ${err.message}`));

    return keyRecord;
  }
}
