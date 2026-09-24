import jwt, { SignOptions } from 'jsonwebtoken';

export interface AuthTokenPayload {
  sub: string; // userId (UUID)
  email: string;
  organizationId: string; // tenantId (UUID)
  role: string;
  systemRole?: string;
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
