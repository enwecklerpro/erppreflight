import jwt, { SignOptions } from 'jsonwebtoken';

export interface AuthTokenPayload {
  sub: string; // userId (UUID)
  email: string;
  organizationId: string; // tenantId (UUID)
  role: string;
  systemRole?: string;
  /** users.token_version at issuance; a mismatch means the session was revoked. */
  tv?: number;
  /** Unique token id, used for single-session logout (revoked_sessions). */
  jti?: string;
  /** Absent for access tokens; 'mfa_challenge' tokens are never accepted as sessions. */
  typ?: string;
  iat?: number;
  exp?: number;
}

export function signAuthToken(
  payload: AuthTokenPayload,
  secret: string,
  expiresIn: string | number = '7d'
): string {
  const options: SignOptions = {
    expiresIn: expiresIn as any,
  };
  return jwt.sign(payload, secret, options);
}

export function verifyAuthToken(token: string, secret: string): AuthTokenPayload {
  return jwt.verify(token, secret) as AuthTokenPayload;
}
