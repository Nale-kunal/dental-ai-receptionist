/**
 * Prisma client singleton.
 * Reuses a single connection pool across the process.
 * Uses the DATABASE_URL from validated environment config.
 *
 * NOTE: This schema.prisma is a best-effort reconstruction from known historical data.
 * After the real DATABASE_URL is supplied, run `npm run db:inventory` to verify the
 * actual live schema and update this file accordingly.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../../config/logger';

let _prisma: PrismaClient | undefined;
let _overrideDatabaseUrl: string | undefined;

/**
 * Explicitly sets the database connection URL for PrismaClient.
 * Disconnects any existing client instance to ensure complete connection isolation.
 * Used by the test database guard to ensure Prisma and raw PostgreSQL clients
 * target the exact same validated isolated test database.
 */
export function setPrismaDatabaseUrl(url: string | undefined): void {
  if (_prisma) {
    _prisma.$disconnect().catch(() => {});
    _prisma = undefined;
  }
  _overrideDatabaseUrl = url;
}

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    const isTestEnv = process.env.NODE_ENV === 'test';

    if (isTestEnv) {
      const activeTestUrl = _overrideDatabaseUrl || process.env.TEST_DATABASE_URL;

      if (activeTestUrl) {
        const lower = activeTestUrl.toLowerCase();
        if (lower.includes('neon.tech') || lower.includes('ep-empty-salad-b3cw8xsj')) {
          throw new Error(
            'CRITICAL SECURITY ERROR: Refusing to initialize PrismaClient in test environment with a production Neon database URL.'
          );
        }

        _prisma = new PrismaClient({
          datasources: {
            db: {
              url: activeTestUrl,
            },
          },
          log: ['error', 'warn'],
        });
      } else {
        // In test mode without an active isolated test database,
        // instantiate PrismaClient strictly bound to an unreachable local mock address.
        // This ensures unit tests can spy on/mock Prisma methods without ever connecting to Neon.
        _prisma = new PrismaClient({
          datasources: {
            db: {
              url: 'postgresql://guard-disabled:safe@127.0.0.1:5432/unit_test_mock_db',
            },
          },
          log: ['error', 'warn'],
        });
      }
    } else {
      _prisma = new PrismaClient({
        log: ['error', 'warn'],
      });
    }
  }

  return _prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_, key) {
    return (getPrisma() as any)[key];
  },
});

export async function connectDatabase(): Promise<void> {
  const client = getPrisma();
  await client.$connect();
  logger.info('Database connected');
}

export async function disconnectDatabase(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect();
    logger.info('Database disconnected');
  }
}

/**
 * Execute a raw database function that returns the standard JSONB envelope:
 *   { ok, code, message, data }
 *
 * This preserves compatibility with all existing api.* functions.
 */
export async function callDbFunction<T = any>(
  fnCall: string,
  params: unknown[] = []
): Promise<{ ok: boolean; code?: string; message?: string; data?: T | null }> {
  const result = await getPrisma().$queryRawUnsafe<any[]>(
    fnCall,
    ...params
  );

  if (!result || result.length === 0) {
    return { ok: false, code: 'DB_FAILURE', message: 'No result from database function', data: null };
  }

  const row = result[0];
  const val = row.result ?? (row[Object.keys(row)[0]]);
  if (typeof val === 'object' && val !== null && 'ok' in val) {
    return val;
  }
  return { ok: true, code: 'OK', data: val };
}
