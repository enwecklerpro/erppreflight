import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { generateOpaqueToken, hashOpaqueToken, isWellFormedOpaqueToken } from './crypto/opaque-token';

export type ActionTokenPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';

export interface ActionTokenRow {
  id: string;
  user_id: string;
  email: string;
  expires_at: Date;
}

type Queryable = Pick<PoolClient, 'query'> | null;

/**
 * Persistence for single-use, expiring, hashed action tokens (user_action_tokens).
 * - Only SHA-256 digests are stored.
 * - Issuing a new token supersedes (consumes) every open token of the same purpose.
 * - Consumption is a single conditional UPDATE, so concurrent use succeeds at most once.
 */
@Injectable()
export class ActionTokenStore {
  constructor(private readonly db: DatabaseService) {}

  private run(client: Queryable, text: string, params: unknown[]) {
    return client ? client.query(text, params) : this.db.query(text, params, { bypassRls: true });
  }

  async countRecent(userId: string, purpose: ActionTokenPurpose, windowMinutes: number): Promise<number> {
    const res = await this.run(
      null,
      `SELECT COUNT(*)::int AS n FROM user_action_tokens
       WHERE user_id = $1 AND purpose = $2 AND created_at > NOW() - ($3::int * INTERVAL '1 minute')`,
      [userId, purpose, windowMinutes]
    );
    return Number(res.rows[0]?.n ?? 0);
  }

  async issue(params: {
    userId: string;
    purpose: ActionTokenPurpose;
    email: string;
    ttlMinutes: number;
    ip?: string | null;
  }): Promise<{ token: string; expiresAt: Date }> {
    await this.run(
      null,
      `UPDATE user_action_tokens SET consumed_at = NOW()
       WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [params.userId, params.purpose]
    );
    const { token, hash } = generateOpaqueToken();
    const res = await this.run(
      null,
      `INSERT INTO user_action_tokens (user_id, purpose, token_hash, email, expires_at, requested_ip)
       VALUES ($1, $2, $3, $4, NOW() + ($5::int * INTERVAL '1 minute'), $6)
       RETURNING expires_at`,
      [params.userId, params.purpose, hash, params.email.toLowerCase(), params.ttlMinutes, params.ip?.slice(0, 64) || null]
    );
    return { token, expiresAt: new Date(res.rows[0].expires_at) };
  }

  /** Looks up an open (unconsumed, unexpired) token without consuming it. */
  async peek(token: string, purpose: ActionTokenPurpose): Promise<ActionTokenRow | null> {
    if (!isWellFormedOpaqueToken(token)) return null;
    const res = await this.run(
      null,
      `SELECT id, user_id, email, expires_at FROM user_action_tokens
       WHERE token_hash = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > NOW()`,
      [hashOpaqueToken(token), purpose]
    );
    return (res.rows[0] as ActionTokenRow) || null;
  }

  /** Atomically consumes an open token; returns null when invalid, used or expired. */
  async consume(token: string, purpose: ActionTokenPurpose, client: Queryable = null): Promise<ActionTokenRow | null> {
    if (!isWellFormedOpaqueToken(token)) return null;
    const res = await this.run(
      client,
      `UPDATE user_action_tokens SET consumed_at = NOW()
       WHERE token_hash = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > NOW()
       RETURNING id, user_id, email, expires_at`,
      [hashOpaqueToken(token), purpose]
    );
    return (res.rows[0] as ActionTokenRow) || null;
  }

  async revokeAll(userId: string, purpose: ActionTokenPurpose, client: Queryable = null): Promise<void> {
    await this.run(
      client,
      `UPDATE user_action_tokens SET consumed_at = NOW()
       WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [userId, purpose]
    );
  }
}
