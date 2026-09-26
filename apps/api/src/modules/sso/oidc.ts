import * as crypto from 'node:crypto';

/**
 * OpenID Connect helpers (authorization code flow + PKCE, RFC 7636; ID token
 * validation per OIDC Core §3.1.3.7) implemented on node:crypto — no SDK.
 */

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  id_token_signing_alg_values_supported?: string[];
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
}

export class OidcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcError';
  }
}

export function normalizeIssuer(issuer: string): string {
  return issuer.replace(/\/+$/, '');
}

export function validateDiscovery(doc: any, expectedIssuer: string): OidcDiscovery {
  if (!doc || typeof doc !== 'object') throw new OidcError('Discovery document is not JSON');
  for (const k of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    if (typeof doc[k] !== 'string' || !doc[k]) throw new OidcError(`Discovery document is missing ${k}`);
  }
  if (normalizeIssuer(doc.issuer) !== normalizeIssuer(expectedIssuer)) {
    throw new OidcError(`Discovery issuer ${doc.issuer} does not match configured issuer ${expectedIssuer}`);
  }
  if (Array.isArray(doc.code_challenge_methods_supported) && !doc.code_challenge_methods_supported.includes('S256')) {
    throw new OidcError('Identity provider does not support PKCE S256');
  }
  return {
    issuer: doc.issuer,
    authorization_endpoint: doc.authorization_endpoint,
    token_endpoint: doc.token_endpoint,
    jwks_uri: doc.jwks_uri,
    userinfo_endpoint: doc.userinfo_endpoint,
    id_token_signing_alg_values_supported: doc.id_token_signing_alg_values_supported,
    code_challenge_methods_supported: doc.code_challenge_methods_supported,
    token_endpoint_auth_methods_supported: doc.token_endpoint_auth_methods_supported,
  };
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthorizationUrl(
  discovery: OidcDiscovery,
  params: { clientId: string; redirectUri: string; scope: string; state: string; nonce: string; codeChallenge: string; loginHint?: string }
): string {
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', params.scope);
  url.searchParams.set('state', params.state);
  url.searchParams.set('nonce', params.nonce);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (params.loginHint) url.searchParams.set('login_hint', params.loginHint);
  return url.toString();
}

const ALGS: Record<string, { hash: string; kty: string; opts?: Partial<crypto.VerifyKeyObjectInput> }> = {
  RS256: { hash: 'sha256', kty: 'RSA' },
  RS384: { hash: 'sha384', kty: 'RSA' },
  RS512: { hash: 'sha512', kty: 'RSA' },
  PS256: { hash: 'sha256', kty: 'RSA', opts: { padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 } },
  ES256: { hash: 'sha256', kty: 'EC', opts: { dsaEncoding: 'ieee-p1363' } },
  ES384: { hash: 'sha384', kty: 'EC', opts: { dsaEncoding: 'ieee-p1363' } },
};

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  given_name?: string;
  family_name?: string;
  azp?: string;
  [k: string]: unknown;
}

export function verifyIdToken(
  idToken: string,
  jwks: { keys: any[] },
  expected: { issuer: string; audience: string; nonce: string; nowSec?: number; clockSkewSec?: number; allowedAlgs?: string[] }
): IdTokenClaims {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new OidcError('ID token is not a compact JWS');
  let header: any;
  let claims: IdTokenClaims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new OidcError('ID token header/payload is not valid JSON');
  }
  const alg = String(header.alg || '');
  const spec = ALGS[alg];
  if (!spec || (expected.allowedAlgs && !expected.allowedAlgs.includes(alg))) {
    throw new OidcError(`ID token algorithm ${alg || '(none)'} is not allowed`);
  }
  const candidates = (jwks?.keys || []).filter(
    (k: any) => k && k.kty === spec.kty && (!header.kid || k.kid === header.kid) && (!k.use || k.use === 'sig') && (!k.alg || k.alg === alg)
  );
  if (!candidates.length) throw new OidcError('No matching signing key in the IdP JWKS');
  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], 'base64url');
  const valid = candidates.some((jwk: any) => {
    try {
      const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      return crypto.verify(spec.hash, signingInput, { key, ...(spec.opts || {}) } as any, signature);
    } catch {
      return false;
    }
  });
  if (!valid) throw new OidcError('ID token signature is invalid');

  const now = expected.nowSec ?? Math.floor(Date.now() / 1000);
  const skew = expected.clockSkewSec ?? 60;
  if (normalizeIssuer(String(claims.iss || '')) !== normalizeIssuer(expected.issuer)) throw new OidcError('ID token issuer mismatch');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(expected.audience)) throw new OidcError('ID token audience mismatch');
  if (aud.length > 1 && claims.azp && claims.azp !== expected.audience) throw new OidcError('ID token azp mismatch');
  if (typeof claims.exp !== 'number' || claims.exp + skew < now) throw new OidcError('ID token has expired');
  if (typeof claims.iat !== 'number' || claims.iat - skew > now) throw new OidcError('ID token issued in the future');
  if (!claims.nonce || claims.nonce !== expected.nonce) throw new OidcError('ID token nonce mismatch (possible replay)');
  if (!claims.sub) throw new OidcError('ID token has no subject');
  return claims;
}
