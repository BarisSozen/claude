/**
 * Authentication Integration Tests
 * Tests SIWE authentication, session management, and Redis-backed sessions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before imports
vi.mock('../../config/env.js', () => ({
  config: {
    server: { nodeEnv: 'test', port: 3001, corsOrigin: '*' },
    database: { url: 'postgresql://test:test@localhost:5432/test' },
    redis: { url: 'redis://localhost:6379' },
    encryption: { key: Buffer.from('0'.repeat(64), 'hex') },
  },
}));

const mockSessions = new Map<string, { userId: string; walletAddress: string; expiresAt: number }>();

vi.mock('../../services/redis.js', () => ({
  redisService: {
    connect: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
    setSession: vi.fn().mockImplementation(async (token, data, ttl) => {
      mockSessions.set(token, { ...data, expiresAt: Date.now() + ttl * 1000 });
    }),
    getSession: vi.fn().mockImplementation(async (token) => {
      return mockSessions.get(token) || null;
    }),
    deleteSession: vi.fn().mockImplementation(async (token) => {
      mockSessions.delete(token);
    }),
    extendSession: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        returning: vi.fn().mockResolvedValue([{ id: 'user-123', walletAddress: '0x1234' }]),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
  users: {},
  authNonces: {},
}));

vi.mock('../../services/logger.js', () => ({
  structuredLogger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Authentication Service', () => {
  beforeEach(() => {
    mockSessions.clear();
    vi.clearAllMocks();
  });

  describe('Session Management', () => {
    it('should create a session in Redis', async () => {
      const { createSession } = await import('../../middleware/auth.js');

      const token = await createSession('user-123', '0x1234567890123456789012345678901234567890');

      expect(token).toBeDefined();
      expect(token.length).toBe(64); // 32 bytes hex encoded
      expect(mockSessions.has(token)).toBe(true);
    });

    it('should validate a valid session', async () => {
      const { createSession, validateSession } = await import('../../middleware/auth.js');

      const token = await createSession('user-123', '0x1234567890123456789012345678901234567890');
      const result = await validateSession(token);

      expect(result.valid).toBe(true);
      expect(result.userId).toBe('user-123');
      expect(result.walletAddress).toBe('0x1234567890123456789012345678901234567890');
    });

    it('should reject an invalid session', async () => {
      const { validateSession } = await import('../../middleware/auth.js');

      const result = await validateSession('invalid-token');

      expect(result.valid).toBe(false);
      expect(result.userId).toBeUndefined();
    });

    it('should delete a session', async () => {
      const { createSession, validateSession, deleteSession } = await import('../../middleware/auth.js');

      const token = await createSession('user-123', '0x1234567890123456789012345678901234567890');
      await deleteSession(token);

      const result = await validateSession(token);
      expect(result.valid).toBe(false);
    });
  });

  describe('Nonce Generation', () => {
    it('should create unique nonces', async () => {
      const { createNonce } = await import('../../middleware/auth.js');

      const nonce1 = await createNonce('0x1234567890123456789012345678901234567890');
      const nonce2 = await createNonce('0x1234567890123456789012345678901234567890');

      expect(nonce1).toBeDefined();
      expect(nonce2).toBeDefined();
      expect(nonce1).not.toBe(nonce2);
    });
  });
});

describe('Auth Middleware', () => {
  it('should reject requests without authorization header', async () => {
    const { authMiddleware } = await import('../../middleware/auth.js');

    const req = { headers: {} } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject requests with invalid Bearer token format', async () => {
    const { authMiddleware } = await import('../../middleware/auth.js');

    const req = { headers: { authorization: 'Basic abc123' } } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
