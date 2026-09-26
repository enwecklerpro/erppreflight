/**
 * Operator (legal entity) details for imprint, privacy policy and structured data.
 *
 * Values come ONLY from environment variables (documented in .env.coolify.example).
 * Nothing is invented: when the required fields are missing, pages show an explicit
 * "operator details not configured" notice.
 *
 * The variables are read with a computed key on the server, so values set at
 * container runtime are honoured as well as values present at build time.
 */
export interface LegalOperator {
  companyName: string | null;
  address: string[];
  representative: string | null;
  register: string | null;
  vatId: string | null;
  email: string | null;
  phone: string | null;
  responsiblePerson: string | null;
  /** Operator-maintained subprocessor list (NEXT_PUBLIC_LEGAL_SUBPROCESSORS). */
  subprocessors: { name: string; purpose: string; region: string }[];
  configured: boolean;
}

export const LEGAL_ENV_KEYS = {
  companyName: 'COMPANY_NAME',
  address: 'ADDRESS',
  representative: 'REPRESENTATIVE',
  register: 'REGISTER',
  vatId: 'VAT_ID',
  email: 'EMAIL',
  phone: 'PHONE',
  responsiblePerson: 'RESPONSIBLE_PERSON',
  /** Entries separated by "|", fields by ";": "Name;Purpose;Region|Name;Purpose;Region" */
  subprocessors: 'SUBPROCESSORS',
} as const;

function parseSubprocessors(raw: string | null): LegalOperator['subprocessors'] {
  if (!raw) return [];
  return raw
    .split('|')
    .map((entry) => entry.split(';').map((f) => f.trim()))
    .filter((f) => f[0])
    .map(([name, purpose = '', region = '']) => ({ name, purpose, region }));
}

function readEnv(suffix: string, env: Record<string, string | undefined>): string | null {
  const key = ['NEXT_PUBLIC_LEGAL', suffix].join('_');
  const value = env[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function readLegalOperator(env: Record<string, string | undefined> = process.env): LegalOperator {
  const companyName = readEnv(LEGAL_ENV_KEYS.companyName, env);
  const rawAddress = readEnv(LEGAL_ENV_KEYS.address, env);
  // Address lines are separated by "|" or literal "\n" in the env value.
  const address = rawAddress
    ? rawAddress
        .split(/\||\\n|\n/)
        .map((l) => l.trim())
        .filter(Boolean)
    : [];
  const email = readEnv(LEGAL_ENV_KEYS.email, env);
  return {
    companyName,
    address,
    representative: readEnv(LEGAL_ENV_KEYS.representative, env),
    register: readEnv(LEGAL_ENV_KEYS.register, env),
    vatId: readEnv(LEGAL_ENV_KEYS.vatId, env),
    email,
    phone: readEnv(LEGAL_ENV_KEYS.phone, env),
    responsiblePerson: readEnv(LEGAL_ENV_KEYS.responsiblePerson, env),
    subprocessors: parseSubprocessors(readEnv(LEGAL_ENV_KEYS.subprocessors, env)),
    configured: Boolean(companyName && address.length > 0 && email),
  };
}
