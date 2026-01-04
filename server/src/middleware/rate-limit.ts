/**
 * Rate Limiting Middleware
 * Protects API endpoints from abuse
 */

import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import type { AuthenticatedRequest } from './auth.js';

/**
 * Extract key for rate limiting
 * Uses wallet address if authenticated, otherwise IP
 */
function keyGenerator(req: Request): string {
  const authReq = req as AuthenticatedRequest;
  if (authReq.walletAddress) {
    return authReq.walletAddress.toLowerCase();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Standard rate limiter for most endpoints
 * 100 requests per minute
 */
export const standardLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests, please try again later',
    timestamp: Date.now(),
  },
});

/**
 * Auth rate limiter - stricter for auth endpoints
 * 10 requests per minute
 */
export const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again later',
    timestamp: Date.now(),
  },
});

/**
 * Trade execution rate limiter
 * 20 requests per minute
 */
export const tradeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many trade requests, please try again later',
    timestamp: Date.now(),
  },
});

/**
 * Price/quote rate limiter
 * 200 requests per minute (higher for price data)
 */
export const priceLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many price requests, please try again later',
    timestamp: Date.now(),
  },
});

/**
 * WebSocket connection rate limiter
 * 5 connections per minute
 */
export const wsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many WebSocket connection attempts',
    timestamp: Date.now(),
  },
});
