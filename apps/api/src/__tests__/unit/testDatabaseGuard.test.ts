/**
 * testDatabaseGuard.test.ts
 *
 * Unit tests verifying that the test database safety guard strictly blocks
 * any tests from connecting to or mutating production databases (Neon).
 */

import {
  validateTestDatabaseSafety,
  getSafeTestDatabasePool,
  getSafeTestDatabaseClient,
  isIsolatedTestDatabaseAvailable,
  parseAndNormalizePostgresUrl,
  isSameDatabaseTarget,
} from '../helpers/testDatabaseGuard';
import { getPrisma, setPrismaDatabaseUrl } from '../../database/prisma/client';

describe('Test Database Safety Guard (Unit)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('parseAndNormalizePostgresUrl & isSameDatabaseTarget', () => {
    it('normalizes postgres: to postgresql: and lowercases host & database', () => {
      const norm = parseAndNormalizePostgresUrl('postgres://User:Pass@DB.Example.COM:5432/MyDentalDB?sslmode=require');
      expect(norm).not.toBeNull();
      expect(norm!.host).toBe('db.example.com');
      expect(norm!.port).toBe(5432);
      expect(norm!.database).toBe('mydentaldb');
    });

    it('assigns default port 5432 when port is omitted', () => {
      const norm = parseAndNormalizePostgresUrl('postgresql://user:pass@db.example.com/mydb');
      expect(norm).not.toBeNull();
      expect(norm!.port).toBe(5432);
    });

    it('correctly matches connection targets when one specifies default port 5432 and the other omits it', () => {
      const urlWithPort = 'postgresql://user:pass@db.custom.net:5432/dental_prod';
      const urlWithoutPort = 'postgres://user:pass@db.custom.net/dental_prod';
      expect(isSameDatabaseTarget(urlWithPort, urlWithoutPort)).toBe(true);
    });

    it('rejects malformed URLs as null', () => {
      expect(parseAndNormalizePostgresUrl('not-a-valid-url')).toBeNull();
      expect(parseAndNormalizePostgresUrl('http://example.com/db')).toBeNull();
      expect(parseAndNormalizePostgresUrl('postgresql://host-with-no-db/')).toBeNull();
    });
  });

  describe('validateTestDatabaseSafety', () => {
    it('rejects undefined connection string', () => {
      const result = validateTestDatabaseSafety(undefined);
      expect(result.isSafe).toBe(false);
      expect(result.reason).toContain('TEST_DATABASE_URL is not configured');
    });

    it('rejects empty or whitespace connection string', () => {
      const result = validateTestDatabaseSafety('   ');
      expect(result.isSafe).toBe(false);
      expect(result.reason).toContain('TEST_DATABASE_URL is not configured');
    });

    it('rejects malformed test database URL', () => {
      const result = validateTestDatabaseSafety('invalid-protocol://local:5432/db');
      expect(result.isSafe).toBe(false);
      expect(result.reason).toContain('REJECTED: TEST_DATABASE_URL is malformed');
    });

    it('strictly rejects any connection string containing neon.tech', () => {
      const urls = [
        'postgres://user:pass@ep-empty-salad-b3cw8xsj.us-east-2.aws.neon.tech/neondb',
        'postgresql://admin:secret@subdomain.neon.tech/mydb?sslmode=require',
        'postgres://app:token@pg.neon.tech:5432/db',
      ];

      for (const url of urls) {
        const result = validateTestDatabaseSafety(url);
        expect(result.isSafe).toBe(false);
        expect(result.reason).toMatch(/forbidden host or provider|neon\.tech/i);
      }
    });

    it('strictly rejects any connection string containing the production Neon project identifier ep-empty-salad-b3cw8xsj', () => {
      const url = 'postgres://user:secret@ep-empty-salad-b3cw8xsj.internal-proxy:5432/db';
      const result = validateTestDatabaseSafety(url);
      expect(result.isSafe).toBe(false);
      expect(result.reason).toContain('ep-empty-salad-b3cw8xsj');
    });

    it('strictly rejects when TEST_DATABASE_URL matches DATABASE_URL, even with default port omission', () => {
      // Production URL specifies explicit :5432
      process.env.DATABASE_URL = 'postgresql://localuser:localpass@127.0.0.1:5432/same_db';
      // Test URL omits :5432
      const result = validateTestDatabaseSafety('postgres://localuser:localpass@127.0.0.1/same_db');
      expect(result.isSafe).toBe(false);
      expect(result.reason).toContain('resolves to the same host, port, and database as the application production DATABASE_URL');
    });

    it('strictly rejects connection strings with production indicators', () => {
      const urls = [
        'postgresql://user:pass@localhost:5432/production_clinic',
        'postgresql://user:pass@localhost:5432/neondb',
        'postgresql://user:pass@localhost:5432/clinic_prod_db',
      ];

      for (const url of urls) {
        const result = validateTestDatabaseSafety(url);
        expect(result.isSafe).toBe(false);
        expect(result.reason).toMatch(/forbidden production database name/i);
      }
    });

    it('strictly rejects URL-encoded production host indicators and project IDs', () => {
      const urls = [
        'postgres://user:secret@ep%2Dempty%2Dsalad%2Db3cw8xsj.internal-proxy:5432/test_db',
        'postgresql://user:pass@subdomain.%6Eeon.tech:5432/test_db',
      ];

      for (const url of urls) {
        const result = validateTestDatabaseSafety(url);
        expect(result.isSafe).toBe(false);
        expect(result.reason).toMatch(/forbidden host or provider|neon\.tech|ep-empty-salad-b3cw8xsj/i);
      }
    });

    it('strictly rejects URL-encoded production database names', () => {
      const urls = [
        'postgresql://user:pass@localhost:5432/neon%64b',
        'postgresql://user:pass@localhost:5432/production%5Fclinic',
        'postgresql://user:pass@localhost:5432/clinic%5Fprod%5Fdb',
      ];

      for (const url of urls) {
        const result = validateTestDatabaseSafety(url);
        expect(result.isSafe).toBe(false);
        expect(result.reason).toMatch(/forbidden production database name/i);
      }
    });

    it('strictly rejects equivalent targets with differing query parameters or URL encodings', () => {
      process.env.DATABASE_URL = 'postgresql://admin:secret@127.0.0.1:5432/dental_core?sslmode=require';

      // Test candidate targets same database with different query parameters and percent-encoding
      const candidateWithDifferentParams = 'postgresql://otheruser:otherpass@127.0.0.1:5432/dental%5Fcore?connect_timeout=10';
      const result = validateTestDatabaseSafety(candidateWithDifferentParams);
      expect(result.isSafe).toBe(false);
      expect(result.reason).toContain('resolves to the same host, port, and database as the application production DATABASE_URL');
    });

    it('accepts valid, isolated local test database URLs', () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/dev_db';

      const validUrls = [
        'postgresql://postgres:postgres@localhost:5432/dental_test_db',
        'postgresql://testuser:testpass@127.0.0.1:5433/isolated_test_suite',
        'postgres://ci_runner:password@test-postgres:5432/test_harness_db',
      ];

      for (const url of validUrls) {
        const result = validateTestDatabaseSafety(url);
        expect(result.isSafe).toBe(true);
        expect(result.reason).toBe('Safe isolated test database');
      }
    });
  });

  describe('Pool and Client accessors', () => {
    it('throws an informative error if getSafeTestDatabasePool is called when unsafe', () => {
      delete process.env.TEST_DATABASE_URL;
      expect(() => getSafeTestDatabasePool()).toThrow(
        /Cannot create database pool: TEST_DATABASE_URL is not configured/
      );
    });

    it('throws an informative error if getSafeTestDatabaseClient is called when unsafe', () => {
      delete process.env.TEST_DATABASE_URL;
      expect(() => getSafeTestDatabaseClient()).toThrow(
        /Cannot create database client: TEST_DATABASE_URL is not configured/
      );
    });

    it('isIsolatedTestDatabaseAvailable returns false when TEST_DATABASE_URL is unset', () => {
      delete process.env.TEST_DATABASE_URL;
      expect(isIsolatedTestDatabaseAvailable()).toBe(false);
    });
  });

  describe('Prisma Test Isolation & Production Prevention', () => {
    it('instantiates PrismaClient bound to unreachable dummy host when TEST_DATABASE_URL is absent', () => {
      setPrismaDatabaseUrl(undefined);
      delete process.env.TEST_DATABASE_URL;

      const client = getPrisma();
      expect(client).toBeDefined();
    });

    it('throws a critical security error if getPrisma() is configured with a Neon URL', () => {
      setPrismaDatabaseUrl('postgresql://user:pass@ep-empty-salad-b3cw8xsj.neon.tech/neondb');

      expect(() => getPrisma()).toThrow(
        /CRITICAL SECURITY ERROR: Refusing to initialize PrismaClient in test environment with a production Neon database URL/
      );

      // Clean up override after test
      setPrismaDatabaseUrl(undefined);
    });
  });
});
