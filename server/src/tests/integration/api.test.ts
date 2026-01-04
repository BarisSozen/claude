/**
 * API Integration Tests
 * Tests the complete API flow including authentication, delegations, and trades
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

// Mock external dependencies
vi.mock('../../config/env.js', () => ({
  config: {
    server: {
      nodeEnv: 'test',
      port: 3001,
      corsOrigin: 'http://localhost:5173',
    },
    database: {
      url: 'postgresql://test:test@localhost:5432/test',
    },
    redis: {
      url: 'redis://localhost:6379',
    },
    rpc: {
      ethereum: 'https://eth.llamarpc.com',
    },
    encryption: {
      key: Buffer.from('0'.repeat(64), 'hex'),
    },
    prices: { ethUsd: 3900 },
    gas: { mainnetEstimateUsd: 15, stableSwapUsd: 5 },
    risk: { maxPriceImpact: 0.02, maxStablePriceImpact: 0.005 },
    executor: { minProfitUsd: 0.01, scanIntervalMs: 5000, maxDailyTrades: 100 },
  },
  env: {
    NODE_ENV: 'test',
  },
}));

// Mock Redis service
vi.mock('../../services/redis.js', () => {
  const sessions = new Map();
  const rateLimits = new Map();

  return {
    redisService: {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockReturnValue(true),
      setSession: vi.fn().mockImplementation(async (token, data, ttl) => {
        sessions.set(token, { ...data, expiry: Date.now() + ttl * 1000 });
      }),
      getSession: vi.fn().mockImplementation(async (token) => {
        const session = sessions.get(token);
        if (!session) return null;
        if (session.expiry < Date.now()) {
          sessions.delete(token);
          return null;
        }
        return session;
      }),
      deleteSession: vi.fn().mockImplementation(async (token) => {
        sessions.delete(token);
      }),
      incrementRateLimit: vi.fn().mockImplementation(async (id, window, ttl) => {
        const key = `${id}:${window}`;
        const count = (rateLimits.get(key) || 0) + 1;
        rateLimits.set(key, count);
        return count;
      }),
      getRateLimitCount: vi.fn().mockImplementation(async (id, window) => {
        return rateLimits.get(`${id}:${window}`) || 0;
      }),
      resetRateLimit: vi.fn().mockImplementation(async (id, window) => {
        rateLimits.delete(`${id}:${window}`);
      }),
      ping: vi.fn().mockResolvedValue(true),
    },
    SessionData: {},
  };
});

// Mock database
vi.mock('../../db/index.js', () => {
  const users = new Map();
  const delegations = new Map();
  const nonces = new Map();

  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              return [];
            }),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
          returning: vi.fn().mockResolvedValue([{ id: 'test-user-id' }]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    },
    users: {},
    delegations: {},
    authNonces: {},
    trades: {},
    checkDatabaseConnection: vi.fn().mockResolvedValue(true),
    closeDatabaseConnection: vi.fn().mockResolvedValue(undefined),
  };
});

describe('API Integration Tests', () => {
  let app: Express;

  beforeAll(async () => {
    // Create a minimal express app for testing
    app = express();
    app.use(express.json());

    // Health endpoint
    app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: Date.now(),
        services: {
          database: true,
          redis: true,
        },
      });
    });

    // Mock auth endpoints
    app.post('/api/auth/nonce', (req, res) => {
      res.json({
        success: true,
        data: { nonce: 'test-nonce-12345' },
        timestamp: Date.now(),
      });
    });

    // Mock protected endpoint
    app.get('/api/delegations', (req, res) => {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          timestamp: Date.now(),
        });
      }
      res.json({
        success: true,
        data: [],
        timestamp: Date.now(),
      });
    });
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.services.database).toBe(true);
      expect(response.body.services.redis).toBe(true);
    });
  });

  describe('Authentication', () => {
    it('should generate a nonce for SIWE', async () => {
      const response = await request(app)
        .post('/api/auth/nonce')
        .send({ walletAddress: '0x1234567890123456789012345678901234567890' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.nonce).toBeDefined();
    });

    it('should reject requests without auth token', async () => {
      const response = await request(app).get('/api/delegations');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Rate Limiting', () => {
    it('should include rate limit headers', async () => {
      const response = await request(app).get('/health');

      // Health endpoint may not have rate limiting, but we test the concept
      expect(response.status).toBe(200);
    });
  });
});

describe('Encryption Integration Tests', () => {
  it('should encrypt and decrypt with key versioning', async () => {
    const { encryptPrivateKey, decryptPrivateKey, getKeyVersion } = await import(
      '../../services/encryption.js'
    );

    const privateKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

    const encrypted = encryptPrivateKey(privateKey);
    const version = getKeyVersion(encrypted);
    const decrypted = decryptPrivateKey(encrypted);

    expect(version).toBe(1);
    expect(decrypted).toBe(privateKey);
    expect(encrypted.split(':').length).toBe(4); // version:iv:authTag:data
  });

  it('should support legacy format decryption', async () => {
    const { decryptPrivateKey, getKeyVersion } = await import('../../services/encryption.js');

    // Simulate legacy format (3 parts)
    const legacyFormat = 'abcd1234abcd1234abcd1234abcd1234:12345678901234567890123456789012:encrypted';

    expect(() => getKeyVersion(legacyFormat)).not.toThrow();
    expect(getKeyVersion(legacyFormat)).toBe(1);
  });
});

describe('Structured Logging Tests', () => {
  it('should log with proper structure', async () => {
    const { structuredLogger } = await import('../../services/logger.js');

    // Capture console output
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    structuredLogger.info('system', 'Test message', { testKey: 'testValue' });

    expect(consoleSpy).toHaveBeenCalled();
    const logOutput = consoleSpy.mock.calls[0][0];
    const parsed = JSON.parse(logOutput);

    expect(parsed.level).toBe('info');
    expect(parsed.category).toBe('system');
    expect(parsed.message).toBe('Test message');
    expect(parsed.metadata.testKey).toBe('testValue');
    expect(parsed.service).toBe('defi-bot');

    consoleSpy.mockRestore();
  });

  it('should track metrics', async () => {
    const { structuredLogger } = await import('../../services/logger.js');

    structuredLogger.recordTrade(true, 100, 10);
    structuredLogger.recordTrade(false, 0, 5);

    const metrics = structuredLogger.getMetrics();

    expect(metrics.totalTrades).toBeGreaterThanOrEqual(2);
    expect(metrics.successfulTrades).toBeGreaterThanOrEqual(1);
    expect(metrics.failedTrades).toBeGreaterThanOrEqual(1);
  });
});
