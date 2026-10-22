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

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient({
      log: ['error', 'warn'],
    });
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
