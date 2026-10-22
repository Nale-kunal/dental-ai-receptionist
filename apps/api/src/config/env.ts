/**
 * Environment configuration with strict validation.
 * The application will refuse to start if required variables are missing.
 * No secrets are logged or exposed.
 */

import { z } from 'zod';
import fs from 'fs';
import path from 'path';

function loadEnvFile() {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'apps/api/.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../.env'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}
loadEnvFile();

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  // Database — required
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().optional(),

  // Auth — required
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  REFRESH_TOKEN_SECRET: z.string().min(32, 'REFRESH_TOKEN_SECRET must be at least 32 characters'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),

  // CORS
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174,http://localhost:5175,http://127.0.0.1:5173,http://127.0.0.1:5174'),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Email — optional
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // Integration Security Key (AES-256-GCM encryption for stored provider credentials)
  INTEGRATION_ENCRYPTION_KEY: z
    .string()
    .refine(
      (val) => !val || /^[0-9a-fA-F]{64}$/.test(val) || val.length >= 32,
      {
        message: 'INTEGRATION_ENCRYPTION_KEY must be a 64-character hexadecimal string (32 bytes) or at least 32 characters long',
      }
    )
    .optional(),

  // WhatsApp — optional, server-side only
  META_WHATSAPP_TOKEN: z.string().optional(),
  META_PHONE_NUMBER_ID: z.string().optional(),
  META_WABA_ID: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),

  // Machine-to-Machine Internal Service Key for n8n / external webhook dispatch
  INTERNAL_SERVICE_KEY: z.string().min(16, 'INTERNAL_SERVICE_KEY must be at least 16 characters').optional(),

  // App URL
  APP_URL: z.string().url().default('http://localhost:5173'),
});

type Env = z.infer<typeof envSchema>;

let _env: Env;

export function getEnv(): Env {
  if (_env) return _env;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');

    console.error(
      '❌ Environment configuration error. The application cannot start.\n' +
      'Missing or invalid environment variables:\n' +
      errors +
      '\n\nCopy apps/api/.env.example to apps/api/.env and fill in the required values.\n'
    );
    process.exit(1);
  }

  // Enforce INTEGRATION_ENCRYPTION_KEY in production
  if (result.data.NODE_ENV === 'production' && !result.data.INTEGRATION_ENCRYPTION_KEY) {
    console.error(
      '❌ Environment configuration error. The application cannot start.\n' +
      'Missing required environment variable: INTEGRATION_ENCRYPTION_KEY\n' +
      'In production, a 64-character hexadecimal key (32 bytes) is required for AES-256-GCM encryption.\n'
    );
    process.exit(1);
  }

  _env = result.data;
  return _env;
}

export const env = new Proxy({} as Env, {
  get(_, key: string) {
    return getEnv()[key as keyof Env];
  },
});

export function isEmailConfigured(): boolean {
  const e = getEnv();
  return Boolean(e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASS);
}

export function isWhatsAppConfigured(): boolean {
  const e = getEnv();
  return Boolean(e.META_WHATSAPP_TOKEN && e.META_PHONE_NUMBER_ID);
}
