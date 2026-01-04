/**
 * Rate Limiting Middleware
 * Redis-backed rate limiting for distributed environments
 */

import rateLimit, { type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from './auth.js';
import { redisService } from '../services/redis.js';
import { structuredLogger } from '../services/logger.js';

/**
 * Redis-backed rate limit store
 * Provides distributed rate limiting across multiple server instances
 */
class RedisRateLimitStore {
  prefix: string;
  windowMs: number;

  constructor(prefix: string, windowMs: number) {
    this.prefix = prefix;
    this.windowMs = windowMs;
  }

  /**
   * Get the key for a given identifier
   */
  private getKey(key: string): string {
    const windowKey = Math.floor(Date.now() / this.windowMs).toString();
    return `${this.prefix}:${key}:${windowKey}`;
  }

  /**
   * Increment the rate limit counter
   */
  async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
    try {
      const fullKey = this.getKey(key);
      const windowSizeSeconds = Math.ceil(this.windowMs / 1000);

      const count = await redisService.incrementRateLimit(
        key,
        Math.floor(Date.now() / this.windowMs).toString(),
        windowSizeSeconds
      );

      const resetTime = new Date(
        Math.ceil(Date.now() / this.windowMs) * this.windowMs
      );

      return { totalHits: count, resetTime };
    } catch (error) {
      structuredLogger.error('system', 'Rate limit increment error', error as Error);
      // Fallback: allow the request if Redis fails
      return { totalHits: 0, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  /**
   * Decrement the rate limit counter (for successful retries)
   */
  async decrement(key: string): Promise<void> {
    // Not implemented - Redis INCR doesn't support atomic decrement with expiry
    // This is acceptable for rate limiting purposes
  }

  /**
   * Reset the rate limit for a key
   */
  async resetKey(key: string): Promise<void> {
    try {
      const windowKey = Math.floor(Date.now() / this.windowMs).toString();
      await redisService.resetRateLimit(key, windowKey);
    } catch (error) {
      structuredLogger.error('system', 'Rate limit reset error', error as Error);
    }
  }
}

/**
 * Extract key for rate limiting
 * Uses wallet address if authenticated, otherwise IP
 */
function keyGenerator(req: Request): string {
  const authReq = req as AuthenticatedRequest;
  if (authReq.walletAddress) {
    return `wallet:${authReq.walletAddress.toLowerCase()}`;
  }
  return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
}

/**
 * Create a rate limiter with Redis backend
 */
function createLimiter(options: {
  windowMs: number;
  max: number;
  prefix: string;
  message: string;
  skipFailedRequests?: boolean;
  skipSuccessfulRequests?: boolean;
}): ReturnType<typeof rateLimit> {
  const store = new RedisRateLimitStore(options.prefix, options.windowMs);

  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    skipFailedRequests: options.skipFailedRequests ?? false,
    skipSuccessfulRequests: options.skipSuccessfulRequests ?? false,
    handler: (req: Request, res: Response) => {
      structuredLogger.warning('risk', 'Rate limit exceeded', {
        key: keyGenerator(req),
        path: req.path,
        method: req.method,
      });

      res.status(429).json({
        success: false,
        error: options.message,
        timestamp: Date.now(),
        retryAfter: Math.ceil(options.windowMs / 1000),
      });
    },
    store: {
      increment: async (key: string) => {
        const result = await store.increment(key);
        return result;
      },
      decrement: async (key: string) => {
        await store.decrement(key);
      },
      resetKey: async (key: string) => {
        await store.resetKey(key);
      },
      init: () => {
        // No initialization needed
      },
    } as Options['store'],
  });
}

/**
 * Standard rate limiter for most endpoints
 * 100 requests per minute
 */
export const standardLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 100,
  prefix: 'rl:standard',
  message: 'Too many requests, please try again later',
});

/**
 * Auth rate limiter - stricter for auth endpoints
 * 10 requests per minute
 */
export const authLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 10,
  prefix: 'rl:auth',
  message: 'Too many authentication attempts, please try again later',
});

/**
 * Trade execution rate limiter
 * 20 requests per minute
 */
export const tradeLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 20,
  prefix: 'rl:trade',
  message: 'Too many trade requests, please try again later',
});

/**
 * Price/quote rate limiter
 * 200 requests per minute (higher for price data)
 */
export const priceLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 200,
  prefix: 'rl:price',
  message: 'Too many price requests, please try again later',
});

/**
 * WebSocket connection rate limiter
 * 5 connections per minute
 */
export const wsLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 5,
  prefix: 'rl:ws',
  message: 'Too many WebSocket connection attempts',
});

/**
 * Strict rate limiter for sensitive operations
 * 5 requests per minute
 */
export const strictLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 5,
  prefix: 'rl:strict',
  message: 'Rate limit exceeded for sensitive operation',
});

/**
 * Burst rate limiter for high-traffic endpoints
 * 1000 requests per minute
 */
export const burstLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 1000,
  prefix: 'rl:burst',
  message: 'Too many requests, please try again later',
});

/**
 * Sliding window rate limiter for API endpoints
 * 600 requests per hour with smaller windows
 */
export const hourlyLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 600,
  prefix: 'rl:hourly',
  message: 'Hourly rate limit exceeded, please try again later',
});

/**
 * Daily rate limiter for expensive operations
 * 100 requests per day
 */
export const dailyLimiter = createLimiter({
  windowMs: 24 * 60 * 60 * 1000,
  max: 100,
  prefix: 'rl:daily',
  message: 'Daily rate limit exceeded, please try again tomorrow',
});
