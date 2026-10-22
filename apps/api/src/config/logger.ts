/**
 * Structured logger. Never logs secrets or patient PII.
 */

import { env } from './env';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

function shouldLog(level: Level): boolean {
  const configured = (env.LOG_LEVEL ?? 'info') as Level;
  return LEVELS[level] >= LEVELS[configured];
}

function format(level: Level, message: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    return `${base} ${JSON.stringify(meta)}`;
  }
  return base;
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('debug')) console.debug(format('debug', message, meta));
  },
  info(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('info')) console.info(format('info', message, meta));
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('warn')) console.warn(format('warn', message, meta));
  },
  error(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('error')) console.error(format('error', message, meta));
  },
};
