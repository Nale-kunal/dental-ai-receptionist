/**
 * testDatabaseGuard.ts
 *
 * Strict safety guard for database integration tests.
 * Enforces that tests can NEVER connect to or mutate production Neon PostgreSQL.
 *
 * Policy:
 * 1. Integration tests MUST use an explicitly configured TEST_DATABASE_URL.
 * 2. They MUST NEVER fall back to DATABASE_URL or .env when TEST_DATABASE_URL is missing.
 * 3. Any connection target containing 'neon.tech', 'ep-empty-salad-b3cw8xsj', or matching
 *    the production DATABASE_URL host is strictly blocked and rejected.
 * 4. URLs are fully parsed and normalized (including PostgreSQL default port 5432,
 *    hostname casing, and database path).
 * 5. Prisma and raw PostgreSQL clients (Pool/Client) are guaranteed to use the exact same
 *    validated isolated test database.
 * 6. In test runs where integration tests are explicitly requested (e.g. npm run test:integration),
 *    the suite fails closed with a non-zero exit code if a safe isolated database is unavailable.
 */

import { Pool, Client } from 'pg';
import { setPrismaDatabaseUrl } from '../../database/prisma/client';

// Preserve initial ambient environment URLs to guarantee that even after
// ambient DATABASE_URL is neutralized to dummy in tests, any test URL matching
// the original production target is strictly blocked.
const initialAmbientDatabaseUrl = process.env.DATABASE_URL;
const initialAmbientDirectUrl = process.env.DIRECT_URL;

export interface NormalizedPostgresUrl {
  raw: string;
  protocol: string;
  host: string;
  port: number;
  database: string;
  user?: string;
}

/**
 * Parses and normalizes a PostgreSQL connection URL.
 * Strictly handles:
 * - Protocol normalization (postgres:// vs postgresql://)
 * - Hostname lowercasing and percent-decoding
 * - Default PostgreSQL port of 5432 when omitted or specified explicitly
 * - Database path normalization (lowercase, percent-decoded, stripped of leading slash and query params)
 */
export function parseAndNormalizePostgresUrl(rawUrl?: string): NormalizedPostgresUrl | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    let urlToParse = trimmed;
    if (urlToParse.startsWith('postgres://')) {
      urlToParse = 'postgresql://' + urlToParse.slice('postgres://'.length);
    }
    const parsed = new URL(urlToParse);

    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      return null;
    }

    let host = parsed.hostname.toLowerCase();
    try {
      host = decodeURIComponent(host);
    } catch {
      // Best-effort decode
    }
    if (!host) return null;

    // PostgreSQL default port is 5432
    const port = parsed.port ? parseInt(parsed.port, 10) : 5432;
    if (isNaN(port) || port <= 0 || port > 65535) return null;

    // Extract database name from pathname (stripping leading slashes and query strings)
    let rawDb = parsed.pathname.replace(/^\/+/, '').split('?')[0];
    try {
      rawDb = decodeURIComponent(rawDb);
    } catch {
      // Best-effort decode
    }
    const database = rawDb.toLowerCase();
    if (!database) return null;

    return {
      raw: trimmed,
      protocol: 'postgresql:',
      host,
      port,
      database,
      user: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Determines whether two database connection strings resolve to the exact same database target,
 * taking default port 5432, hostname lowercasing, and database name into account.
 */
export function isSameDatabaseTarget(urlA?: string, urlB?: string): boolean {
  if (!urlA || !urlB) return false;
  const normA = parseAndNormalizePostgresUrl(urlA);
  const normB = parseAndNormalizePostgresUrl(urlB);

  if (!normA || !normB) {
    // If URL parsing fails, fall back to case-insensitive trimmed string equality
    return urlA.trim().toLowerCase() === urlB.trim().toLowerCase();
  }

  return normA.host === normB.host && normA.port === normB.port && normA.database === normB.database;
}

export interface TestDbSafetyCheck {
  isSafe: boolean;
  reason: string;
  connectionString?: string;
  normalized?: NormalizedPostgresUrl;
}

export function validateTestDatabaseSafety(candidateUrl?: string): TestDbSafetyCheck {
  const rawTestUrl = candidateUrl !== undefined ? candidateUrl.trim() : process.env.TEST_DATABASE_URL?.trim();

  // 1. Must be explicitly provided
  if (!rawTestUrl) {
    return {
      isSafe: false,
      reason: 'TEST_DATABASE_URL is not configured. Database integration tests require an isolated test database.',
    };
  }

  // 2. Parse and normalize connection URL
  const normTest = parseAndNormalizePostgresUrl(rawTestUrl);
  if (!normTest) {
    return {
      isSafe: false,
      reason: 'REJECTED: TEST_DATABASE_URL is malformed or missing a valid host/database path.',
    };
  }

  // 3. Detect and reject production Neon hosts and project identifiers (including percent-encoded variants)
  let lowerUrl = rawTestUrl.toLowerCase();
  try {
    lowerUrl = decodeURIComponent(lowerUrl);
  } catch {
    // Best-effort decode
  }

  const FORBIDDEN_HOST_PATTERNS = [
    'neon.tech',
    'ep-empty-salad-b3cw8xsj',
    'c-4.ap-southeast-1.aws.neon.tech',
  ];

  for (const pattern of FORBIDDEN_HOST_PATTERNS) {
    if (normTest.host.includes(pattern) || lowerUrl.includes(pattern)) {
      return {
        isSafe: false,
        reason: `REJECTED: TEST_DATABASE_URL points to forbidden host or provider (${pattern}). Tests must NEVER run against production Neon.`,
      };
    }
  }

  // 4. Reject explicit production database name indicators
  const FORBIDDEN_DB_NAMES = [
    'neondb',
    'production_clinic',
    'clinic_prod_db',
    'production',
    'prod',
  ];

  for (const dbName of FORBIDDEN_DB_NAMES) {
    if (normTest.database === dbName || normTest.database.startsWith(dbName + '_') || normTest.database.endsWith('_' + dbName)) {
      return {
        isSafe: false,
        reason: `REJECTED: TEST_DATABASE_URL contains forbidden production database name (${normTest.database}).`,
      };
    }
  }

  // 5. Ensure it does not resolve to the application DATABASE_URL or DIRECT_URL target
  const prodUrls = [
    initialAmbientDatabaseUrl,
    initialAmbientDirectUrl,
    process.env.DATABASE_URL,
    process.env.DIRECT_URL,
  ].filter(Boolean) as string[];

  for (const prodUrl of prodUrls) {
    if (isSameDatabaseTarget(rawTestUrl, prodUrl)) {
      return {
        isSafe: false,
        reason: 'REJECTED: TEST_DATABASE_URL resolves to the same host, port, and database as the application production DATABASE_URL / DIRECT_URL. Isolated test database required.',
      };
    }
  }

  return {
    isSafe: true,
    reason: 'Safe isolated test database',
    connectionString: normTest.raw,
    normalized: normTest,
  };
}

const safetyCheck = validateTestDatabaseSafety();

// Determine whether database integration tests were explicitly requested
export function isIntegrationRunRequested(): boolean {
  return (
    process.env.npm_lifecycle_event === 'test:integration' ||
    process.env.REQUIRE_ISOLATED_DB === 'true' ||
    process.argv.some((arg) => arg.includes('integration'))
  );
}

// Synchronize environment and Prisma datasource
if (safetyCheck.isSafe && safetyCheck.connectionString) {
  // Direct Prisma and raw PostgreSQL to the exact same validated test database URL
  process.env.DATABASE_URL = safetyCheck.connectionString;
  process.env.DIRECT_URL = safetyCheck.connectionString;
  setPrismaDatabaseUrl(safetyCheck.connectionString);
} else {
  // If unsafe or unconfigured in test runs, unconditionally neutralize ambient DATABASE_URL & DIRECT_URL
  if (process.env.NODE_ENV === 'test') {
    process.env.DATABASE_URL = 'postgresql://test-safety-guard:disabled@127.0.0.1:5432/unconfigured_test_db';
    delete process.env.DIRECT_URL;
    setPrismaDatabaseUrl(undefined);
  }

  if (!safetyCheck.isSafe && !isIntegrationRunRequested()) {
    // eslint-disable-next-line no-console
    console.log(
      '\n================================================================================\n' +
      '  [TEST DATABASE GUARD] Database integration test safety status:\n' +
      `  ${safetyCheck.reason}\n` +
      '  Per strict production safety rules, tests will NEVER run against production Neon.\n' +
      '  To run integration tests, point TEST_DATABASE_URL to an isolated test database.\n' +
      '================================================================================\n'
    );
  }
}

/**
 * Conditional describe block:
 * - If verified safe test DB: executes tests normally.
 * - If integration run was explicitly requested but safe DB is unavailable: fails closed with an error.
 * - If integration run was not requested (e.g. running unit tests): cleanly skips.
 */
export const describeIsolatedDb = (title: string, fn: () => void) => {
  if (safetyCheck.isSafe) {
    return describe(title, fn);
  }

  if (isIntegrationRunRequested()) {
    return describe(title, () => {
      it('FAIL CLOSED: Safe isolated test database is required for integration tests', () => {
        throw new Error(
          `CRITICAL TEST INFRASTRUCTURE FAILURE: Integration tests were explicitly requested, but a safe isolated test database is not available.\n` +
          `Safety check failure reason: ${safetyCheck.reason}\n` +
          `To run database integration tests, configure TEST_DATABASE_URL to point to a dedicated, non-production test database (e.g. postgresql://postgres:postgres@localhost:5432/dental_test).`
        );
      });
    });
  }

  return describe.skip(title, fn);
};

/**
 * Returns a new Pool connected to the validated test database.
 * Throws immediately if called when no safe test database is configured.
 */
export function getSafeTestDatabasePool(): Pool {
  if (!safetyCheck.isSafe || !safetyCheck.connectionString) {
    throw new Error(`Cannot create database pool: ${safetyCheck.reason}`);
  }
  return new Pool({ connectionString: safetyCheck.connectionString });
}

/**
 * Returns a new Client connected to the validated test database.
 * Throws immediately if called when no safe test database is configured.
 */
export function getSafeTestDatabaseClient(): Client {
  if (!safetyCheck.isSafe || !safetyCheck.connectionString) {
    throw new Error(`Cannot create database client: ${safetyCheck.reason}`);
  }
  return new Client({ connectionString: safetyCheck.connectionString });
}

export function isIsolatedTestDatabaseAvailable(): boolean {
  return safetyCheck.isSafe;
}
