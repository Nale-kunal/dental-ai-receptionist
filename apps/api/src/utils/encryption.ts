/**
 * Authenticated Encryption Service (AES-256-GCM)
 *
 * Provides authenticated encryption for clinic integration credentials (such as Meta WhatsApp
 * access tokens). The encryption key is strictly kept in memory / environment configuration,
 * completely decoupled from database ciphertext.
 *
 * Supports key rotation via keyVersion tags and automatic backward-compatible fallback decryption.
 */

import crypto from 'crypto';
import { env } from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH_BYTES = 16; // 128-bit authentication tag

/**
 * Resolves the primary 256-bit (32-byte) key for the given key version.
 */
function resolvePrimaryKey(keyVersion = 'v1'): Buffer {
  const configuredKey = env.INTEGRATION_ENCRYPTION_KEY;

  if (configuredKey) {
    if (/^[0-9a-fA-F]{64}$/.test(configuredKey)) {
      return Buffer.from(configuredKey, 'hex');
    }
    return crypto.createHash('sha256').update(`${configuredKey}:${keyVersion}`).digest();
  }

  return resolveFallbackKey(keyVersion);
}

/**
 * Resolves the legacy/dev fallback key derived deterministically from JWT_SECRET.
 * Used to preserve readability of ciphertext created before a dedicated key was provisioned.
 */
function resolveFallbackKey(keyVersion = 'v1'): Buffer {
  const devSeed = (env as any).JWT_SECRET || 'dental-ai-receptionist-dev-secret-salt';
  return crypto.createHash('sha256').update(`dev-integration-key:${devSeed}:${keyVersion}`).digest();
}

export interface EncryptedPayload {
  ciphertext: string;
  keyVersion: string;
}

/**
 * Encrypts a plaintext secret using AES-256-GCM with the primary encryption key.
 * Stored format: <iv_hex>:<auth_tag_hex>:<ciphertext_hex>
 */
export function encryptSecret(plaintext: string, keyVersion = 'v1'): EncryptedPayload {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Plaintext must be a non-empty string');
  }

  const key = resolvePrimaryKey(keyVersion);
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH_BYTES });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const formatted = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;

  return {
    ciphertext: formatted,
    keyVersion,
  };
}

/**
 * Internal helper to attempt deciphering with a candidate key.
 */
function tryDecipher(ciphertext: Buffer, iv: Buffer, authTag: Buffer, key: Buffer): string | null {
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH_BYTES });
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Decrypts an AES-256-GCM payload and verifies cryptographic integrity.
 * First tries the primary configured key; if that fails and a fallback key is available,
 * attempts fallback decryption to preserve compatibility with legacy ciphertext.
 * Throws if authentication tag does not match or payload is malformed.
 */
export function decryptSecret(payload: string, keyVersion = 'v1'): string {
  if (!payload || typeof payload !== 'string') {
    throw new Error('Encrypted payload must be a non-empty string');
  }

  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload format. Expected iv:authTag:ciphertext');
  }

  const [ivHex, authTagHex, cipherHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(cipherHex, 'hex');

  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error('Invalid IV length in encrypted payload');
  }
  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error('Invalid Auth Tag length in encrypted payload');
  }

  // 1. Attempt decryption with primary configured key
  const primaryKey = resolvePrimaryKey(keyVersion);
  const primaryResult = tryDecipher(ciphertext, iv, authTag, primaryKey);
  if (primaryResult !== null) {
    return primaryResult;
  }

  // 2. If configured key failed, attempt fallback key (legacy compatibility)
  if (env.INTEGRATION_ENCRYPTION_KEY) {
    const fallbackKey = resolveFallbackKey(keyVersion);
    const fallbackResult = tryDecipher(ciphertext, iv, authTag, fallbackKey);
    if (fallbackResult !== null) {
      return fallbackResult;
    }
  }

  throw new Error('Integrity check failed: ciphertext or authentication tag is invalid');
}

/**
 * Safely masks a secret string so it can be shown in logs or API responses without leaking the secret.
 * e.g. "EAAG..." -> "••••••••4321"
 */
export function maskSecret(secret?: string | null): string {
  if (!secret) return '';
  const trimmed = secret.trim();
  if (trimmed.length <= 4) return '••••';
  const lastFour = trimmed.slice(-4);
  return `••••••••${lastFour}`;
}
