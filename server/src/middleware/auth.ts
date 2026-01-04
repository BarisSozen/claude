/**
 * Authentication Middleware
 * SIWE (Sign-In With Ethereum) authentication with Redis-backed sessions
 */

import type { Request, Response, NextFunction } from 'express';
import { SiweMessage } from 'siwe';
import { db, authNonces, users } from '../db/index.js';
import { eq, and, gt } from 'drizzle-orm';
import { generateNonce } from '../services/encryption.js';
import { redisService, type SessionData } from '../services/redis.js';
import { structuredLogger } from '../services/logger.js';
import type { Address } from '../../shared/schema.js';

// Extended Request type with wallet info
export interface AuthenticatedRequest extends Request {
  walletAddress: Address;
  userId: string;
}

// Nonce expiration time (5 minutes)
const NONCE_EXPIRY_MS = 5 * 60 * 1000;

// Session expiration time (24 hours)
const SESSION_EXPIRY_SECONDS = 24 * 60 * 60;

/**
 * Generate and store a nonce for a wallet address
 */
export async function createNonce(walletAddress: string): Promise<string> {
  const nonce = generateNonce();
  const expiresAt = new Date(Date.now() + NONCE_EXPIRY_MS);

  // Upsert nonce (replace if exists)
  await db
    .insert(authNonces)
    .values({
      walletAddress: walletAddress.toLowerCase(),
      nonce,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: authNonces.walletAddress,
      set: {
        nonce,
        expiresAt,
        createdAt: new Date(),
      },
    });

  structuredLogger.info('auth', 'Nonce created', {
    walletAddress: walletAddress.toLowerCase().slice(0, 10) + '...',
  });

  return nonce;
}

/**
 * Verify SIWE signature and create session
 */
export async function verifySiweSignature(
  message: string,
  signature: string
): Promise<{ valid: boolean; address?: Address; error?: string }> {
  try {
    const siweMessage = new SiweMessage(message);
    const fields = await siweMessage.verify({ signature });

    if (!fields.success) {
      structuredLogger.warning('auth', 'Invalid SIWE signature', {
        address: siweMessage.address?.slice(0, 10) + '...',
      });
      return { valid: false, error: 'Invalid signature' };
    }

    // Check nonce is valid and not expired
    const storedNonce = await db
      .select()
      .from(authNonces)
      .where(
        and(
          eq(authNonces.walletAddress, siweMessage.address.toLowerCase()),
          eq(authNonces.nonce, siweMessage.nonce),
          gt(authNonces.expiresAt, new Date())
        )
      )
      .limit(1);

    if (storedNonce.length === 0) {
      structuredLogger.warning('auth', 'Invalid or expired nonce', {
        address: siweMessage.address?.slice(0, 10) + '...',
      });
      return { valid: false, error: 'Invalid or expired nonce' };
    }

    // Delete used nonce
    await db
      .delete(authNonces)
      .where(eq(authNonces.walletAddress, siweMessage.address.toLowerCase()));

    structuredLogger.info('auth', 'SIWE verification successful', {
      address: siweMessage.address?.slice(0, 10) + '...',
    });

    return { valid: true, address: siweMessage.address as Address };
  } catch (error) {
    structuredLogger.error('auth', 'SIWE verification error', error as Error, {
      hasMessage: !!message,
      hasSignature: !!signature,
    });
    return { valid: false, error: 'Verification failed' };
  }
}

/**
 * Get or create user by wallet address
 */
export async function getOrCreateUser(walletAddress: Address): Promise<{ id: string; walletAddress: string }> {
  const normalizedAddress = walletAddress.toLowerCase();

  // Try to find existing user
  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.walletAddress, normalizedAddress))
    .limit(1);

  if (existingUser.length > 0) {
    // Update last seen
    await db
      .update(users)
      .set({ lastSeen: new Date() })
      .where(eq(users.id, existingUser[0].id));

    return { id: existingUser[0].id, walletAddress: existingUser[0].walletAddress };
  }

  // Create new user
  const newUser = await db
    .insert(users)
    .values({
      walletAddress: normalizedAddress,
      lastSeen: new Date(),
    })
    .returning();

  structuredLogger.info('auth', 'New user created', {
    userId: newUser[0].id,
    walletAddress: normalizedAddress.slice(0, 10) + '...',
  });

  return { id: newUser[0].id, walletAddress: newUser[0].walletAddress };
}

/**
 * Create a session for an authenticated user
 * Stores session in Redis for persistence across server restarts
 */
export async function createSession(userId: string, walletAddress: Address): Promise<string> {
  const token = generateNonce();
  const now = Date.now();

  const sessionData: SessionData = {
    userId,
    walletAddress,
    expiresAt: now + SESSION_EXPIRY_SECONDS * 1000,
    createdAt: now,
  };

  await redisService.setSession(token, sessionData, SESSION_EXPIRY_SECONDS);

  structuredLogger.info('auth', 'Session created', {
    userId,
    walletAddress: walletAddress.slice(0, 10) + '...',
    expiresIn: SESSION_EXPIRY_SECONDS,
  });

  return token;
}

/**
 * Validate session token against Redis store
 */
export async function validateSession(token: string): Promise<{ valid: boolean; userId?: string; walletAddress?: Address }> {
  try {
    const session = await redisService.getSession(token);

    if (!session) {
      return { valid: false };
    }

    if (session.expiresAt < Date.now()) {
      await redisService.deleteSession(token);
      return { valid: false };
    }

    return {
      valid: true,
      userId: session.userId,
      walletAddress: session.walletAddress as Address,
    };
  } catch (error) {
    structuredLogger.error('auth', 'Session validation error', error as Error);
    return { valid: false };
  }
}

/**
 * Delete session from Redis
 */
export async function deleteSession(token: string): Promise<void> {
  await redisService.deleteSession(token);
  structuredLogger.info('auth', 'Session deleted');
}

/**
 * Authentication middleware
 * Requires valid session token in Authorization header
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: 'Missing or invalid authorization header',
      timestamp: Date.now(),
    });
    return;
  }

  const token = authHeader.slice(7);

  // Use async validation
  validateSession(token)
    .then((session) => {
      if (!session.valid || !session.userId || !session.walletAddress) {
        res.status(401).json({
          success: false,
          error: 'Invalid or expired session',
          timestamp: Date.now(),
        });
        return;
      }

      // Attach user info to request
      (req as AuthenticatedRequest).userId = session.userId;
      (req as AuthenticatedRequest).walletAddress = session.walletAddress;

      next();
    })
    .catch((error) => {
      structuredLogger.error('auth', 'Auth middleware error', error as Error);
      res.status(500).json({
        success: false,
        error: 'Authentication error',
        timestamp: Date.now(),
      });
    });
}

/**
 * Optional auth middleware - doesn't require auth but attaches user if present
 */
export function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    validateSession(token)
      .then((session) => {
        if (session.valid && session.userId && session.walletAddress) {
          (req as AuthenticatedRequest).userId = session.userId;
          (req as AuthenticatedRequest).walletAddress = session.walletAddress;
        }
        next();
      })
      .catch(() => {
        next();
      });
  } else {
    next();
  }
}
