/**
 * Redis Service
 * Provides Redis connection and session management for production use
 */

import { createClient, type RedisClientType } from 'redis';
import { config } from '../config/env.js';

export interface SessionData {
  userId: string;
  walletAddress: string;
  expiresAt: number;
  createdAt: number;
}

class RedisService {
  private client: RedisClientType | null = null;
  private isConnected: boolean = false;
  private connectionPromise: Promise<void> | null = null;

  // Key prefixes for different data types
  private readonly SESSION_PREFIX = 'session:';
  private readonly RATE_LIMIT_PREFIX = 'ratelimit:';
  private readonly CACHE_PREFIX = 'cache:';

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this._connect();
    return this.connectionPromise;
  }

  private async _connect(): Promise<void> {
    try {
      this.client = createClient({
        url: config.redis.url,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              console.error('[REDIS] Max reconnection attempts reached');
              return new Error('Max reconnection attempts reached');
            }
            return Math.min(retries * 100, 3000);
          },
        },
      });

      this.client.on('error', (err) => {
        console.error('[REDIS] Connection error:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        console.log('[REDIS] Connected');
        this.isConnected = true;
      });

      this.client.on('disconnect', () => {
        console.log('[REDIS] Disconnected');
        this.isConnected = false;
      });

      await this.client.connect();
    } catch (error) {
      console.error('[REDIS] Failed to connect:', error);
      this.connectionPromise = null;
      throw error;
    }
  }

  /**
   * Check if Redis is connected
   */
  isReady(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
      this.connectionPromise = null;
    }
  }

  /**
   * Get the Redis client (throws if not connected)
   */
  private getClient(): RedisClientType {
    if (!this.client || !this.isConnected) {
      throw new Error('Redis not connected');
    }
    return this.client;
  }

  // ============================================
  // Session Management
  // ============================================

  /**
   * Store a session in Redis
   */
  async setSession(token: string, session: SessionData, ttlSeconds: number): Promise<void> {
    const client = this.getClient();
    const key = this.SESSION_PREFIX + token;
    await client.set(key, JSON.stringify(session), { EX: ttlSeconds });
  }

  /**
   * Get a session from Redis
   */
  async getSession(token: string): Promise<SessionData | null> {
    const client = this.getClient();
    const key = this.SESSION_PREFIX + token;
    const data = await client.get(key);

    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data) as SessionData;
    } catch {
      return null;
    }
  }

  /**
   * Delete a session from Redis
   */
  async deleteSession(token: string): Promise<void> {
    const client = this.getClient();
    const key = this.SESSION_PREFIX + token;
    await client.del(key);
  }

  /**
   * Extend session TTL
   */
  async extendSession(token: string, ttlSeconds: number): Promise<boolean> {
    const client = this.getClient();
    const key = this.SESSION_PREFIX + token;
    const result = await client.expire(key, ttlSeconds);
    return result;
  }

  // ============================================
  // Rate Limiting
  // ============================================

  /**
   * Increment rate limit counter
   * Returns the current count
   */
  async incrementRateLimit(
    identifier: string,
    windowKey: string,
    windowSizeSeconds: number
  ): Promise<number> {
    const client = this.getClient();
    const key = `${this.RATE_LIMIT_PREFIX}${identifier}:${windowKey}`;

    const multi = client.multi();
    multi.incr(key);
    multi.expire(key, windowSizeSeconds);

    const results = await multi.exec();
    return (results[0] as number) || 1;
  }

  /**
   * Get current rate limit count
   */
  async getRateLimitCount(identifier: string, windowKey: string): Promise<number> {
    const client = this.getClient();
    const key = `${this.RATE_LIMIT_PREFIX}${identifier}:${windowKey}`;
    const count = await client.get(key);
    return count ? parseInt(count, 10) : 0;
  }

  /**
   * Reset rate limit for an identifier
   */
  async resetRateLimit(identifier: string, windowKey: string): Promise<void> {
    const client = this.getClient();
    const key = `${this.RATE_LIMIT_PREFIX}${identifier}:${windowKey}`;
    await client.del(key);
  }

  // ============================================
  // Generic Cache Operations
  // ============================================

  /**
   * Set a cached value
   */
  async setCache(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const client = this.getClient();
    const fullKey = this.CACHE_PREFIX + key;
    const options = ttlSeconds ? { EX: ttlSeconds } : {};
    await client.set(fullKey, JSON.stringify(value), options);
  }

  /**
   * Get a cached value
   */
  async getCache<T>(key: string): Promise<T | null> {
    const client = this.getClient();
    const fullKey = this.CACHE_PREFIX + key;
    const data = await client.get(fullKey);

    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  /**
   * Delete a cached value
   */
  async deleteCache(key: string): Promise<void> {
    const client = this.getClient();
    const fullKey = this.CACHE_PREFIX + key;
    await client.del(fullKey);
  }

  /**
   * Health check
   */
  async ping(): Promise<boolean> {
    try {
      const client = this.getClient();
      const result = await client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const redisService = new RedisService();
