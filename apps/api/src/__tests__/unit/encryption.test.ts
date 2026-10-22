import { encryptSecret, decryptSecret, maskSecret } from '../../utils/encryption';
import { env, envSchema } from '../../config/env';

describe('AES-256-GCM Encryption Service Suite', () => {
  const sampleToken = 'EAAG1234567890abcdefABCDEFtokenValue998877';

  it('encrypts plaintext into iv:authTag:ciphertext format', () => {
    const encrypted = encryptSecret(sampleToken);
    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.keyVersion).toBe('v1');

    const parts = encrypted.ciphertext.split(':');
    expect(parts).toHaveLength(3);
    const [ivHex, authTagHex, cipherHex] = parts;

    // IV is 12 bytes = 24 hex characters
    expect(ivHex).toHaveLength(24);
    // Auth tag is 16 bytes = 32 hex characters
    expect(authTagHex).toHaveLength(32);
    // Ciphertext must be non-empty
    expect(cipherHex.length).toBeGreaterThan(0);
  });

  it('decrypts encrypted payload back to the original plaintext', () => {
    const encrypted = encryptSecret(sampleToken);
    const decrypted = decryptSecret(encrypted.ciphertext, encrypted.keyVersion);
    expect(decrypted).toBe(sampleToken);
  });

  it('produces distinct ciphertexts for identical plaintext due to random IVs', () => {
    const enc1 = encryptSecret(sampleToken);
    const enc2 = encryptSecret(sampleToken);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);

    expect(decryptSecret(enc1.ciphertext)).toBe(sampleToken);
    expect(decryptSecret(enc2.ciphertext)).toBe(sampleToken);
  });

  it('rejects tampered ciphertext with an integrity error', () => {
    const encrypted = encryptSecret(sampleToken);
    const parts = encrypted.ciphertext.split(':');
    // Mutate the ciphertext portion
    const tamperedCipher = parts[2].slice(0, -2) + (parts[2].slice(-2) === 'aa' ? 'bb' : 'aa');
    const tamperedPayload = `${parts[0]}:${parts[1]}:${tamperedCipher}`;

    expect(() => {
      decryptSecret(tamperedPayload);
    }).toThrow(/Integrity check failed/);
  });

  it('rejects tampered authentication tag with an integrity error', () => {
    const encrypted = encryptSecret(sampleToken);
    const parts = encrypted.ciphertext.split(':');
    // Mutate the auth tag portion
    const tamperedTag = parts[1].slice(0, -2) + (parts[1].slice(-2) === '00' ? '11' : '00');
    const tamperedPayload = `${parts[0]}:${tamperedTag}:${parts[2]}`;

    expect(() => {
      decryptSecret(tamperedPayload);
    }).toThrow(/Integrity check failed/);
  });

  it('supports key rotation across key versions', () => {
    const encV1 = encryptSecret(sampleToken, 'v1');
    const encV2 = encryptSecret(sampleToken, 'v2');

    expect(encV1.keyVersion).toBe('v1');
    expect(encV2.keyVersion).toBe('v2');

    expect(decryptSecret(encV1.ciphertext, 'v1')).toBe(sampleToken);
    expect(decryptSecret(encV2.ciphertext, 'v2')).toBe(sampleToken);

    // Attempting to decrypt v1 payload with v2 key must fail integrity check
    expect(() => {
      decryptSecret(encV1.ciphertext, 'v2');
    }).toThrow(/Integrity check failed/);
  });

  it('masks sensitive tokens to show only last 4 characters without leaking secret', () => {
    expect(maskSecret(sampleToken)).toBe('••••••••8877');
    expect(maskSecret('short')).toBe('••••••••hort');
    expect(maskSecret('1234')).toBe('••••');
    expect(maskSecret('')).toBe('');
    expect(maskSecret(null)).toBe('');
  });

  describe('Key Stability & Fallback Compatibility', () => {
    it('reliably decrypts legacy ciphertext encrypted with fallback key derived from JWT_SECRET', () => {
      // Legacy fallback derivation used before dedicated key was introduced:
      // devSeed = JWT_SECRET || 'dental-ai-receptionist-dev-secret-salt'
      // key = sha256(`dev-integration-key:${devSeed}:v1`)
      const crypto = require('crypto');
      const devSeed = (env as any).JWT_SECRET || 'dental-ai-receptionist-dev-secret-salt';
      const fallbackKey = crypto.createHash('sha256').update(`dev-integration-key:${devSeed}:v1`).digest();

      const legacyPlaintext = 'EAAG_LEGACY_WHATSAPP_TOKEN_99998888';
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', fallbackKey, iv, { authTagLength: 16 });
      const enc = Buffer.concat([cipher.update(legacyPlaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      const legacyCiphertext = `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;

      // Decrypting legacy ciphertext must succeed transparently via fallback path
      const decrypted = decryptSecret(legacyCiphertext, 'v1');
      expect(decrypted).toBe(legacyPlaintext);
    });

    it('ensures stable encryption and decryption across simulated restarts with a configured key', () => {
      // Secret encrypted in "previous run"
      const encrypted = encryptSecret('EAAG_STABLE_TEST_TOKEN_12345');
      // Simulate reading back later / across processes
      const decrypted = decryptSecret(encrypted.ciphertext, encrypted.keyVersion);
      expect(decrypted).toBe('EAAG_STABLE_TEST_TOKEN_12345');
    });

    it('never leaks secret plaintext or key material in error messages upon decryption failure', () => {
      const sensitiveToken = 'SUPER_SECRET_TOKEN_DO_NOT_LEAK';
      const invalidPayload = '123456789012345678901234:12345678901234567890123456789012:deadbeef';

      try {
        decryptSecret(invalidPayload);
        throw new Error('Should have failed');
      } catch (err: any) {
        expect(err.message).not.toContain(sensitiveToken);
        const currentKey = env.INTEGRATION_ENCRYPTION_KEY;
        if (currentKey) {
          expect(err.message).not.toContain(currentKey);
        }
        expect(err.message).toMatch(/Integrity check failed/);
      }
    });

    it('rejects malformed payload formats safely', () => {
      expect(() => decryptSecret('')).toThrow(/non-empty string/);
      expect(() => decryptSecret('only-one-part')).toThrow(/Malformed encrypted payload format/);
      expect(() => decryptSecret('shortiv:0123456789abcdef0123456789abcdef:abc')).toThrow(/Invalid IV length/);
      expect(() => decryptSecret('0123456789abcdef01234567:shorttag:abc')).toThrow(/Invalid Auth Tag length/);
    });
  });

  describe('Configuration Schema & Key Validation', () => {
    const baseEnv = {
      DATABASE_URL: 'postgresql://postgres:pass@localhost:5432/testdb',
      JWT_SECRET: 'a_very_long_jwt_secret_that_is_at_least_32_characters_long',
      REFRESH_TOKEN_SECRET: 'another_very_long_secret_that_is_at_least_32_characters_long',
    };

    it('accepts valid 64-character hexadecimal INTEGRATION_ENCRYPTION_KEY', () => {
      const validHexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const parsed = envSchema.safeParse({
        ...baseEnv,
        INTEGRATION_ENCRYPTION_KEY: validHexKey,
      });

      expect(parsed.success).toBe(true);
    });

    it('rejects invalid short or malformed INTEGRATION_ENCRYPTION_KEY', () => {
      const parsedShort = envSchema.safeParse({
        ...baseEnv,
        INTEGRATION_ENCRYPTION_KEY: 'too-short-key',
      });

      expect(parsedShort.success).toBe(false);
      if (!parsedShort.success) {
        const keyError = parsedShort.error.errors.find((e: any) => e.path.includes('INTEGRATION_ENCRYPTION_KEY'));
        expect(keyError).toBeDefined();
        expect(keyError?.message).toContain('INTEGRATION_ENCRYPTION_KEY must be a 64-character hexadecimal string');
      }
    });
  });
});
