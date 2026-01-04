/**
 * Authentication Middleware
 * SIWE (Sign-In With Ethereum) authentication
 */

import type { Request, Response, NextFunction } from 'express';
import { SiweMessage } from 'siwe';
import { db, authNonces, users } from '../db/index.js';
import { eq, and, gt } from 'drizzle-orm';
import { generateNonce } from '../services/encryption.js';
import type { Address } from '../../shared/schema.js';

// Extended Request type with wallet info
export interface AuthenticatedRequest extends Request {
  walletAddress: Address;
  userId: string;
}

// Nonce expiration time (5 minutes)
const NONCE_EXPIRY_MS = 5 * 60 * 1000;

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
      return { valid: false, error: 'Invalid or expired nonce' };
    }

    // Delete used nonce
    await db
      .delete(authNonces)
      .where(eq(authNonces.walletAddress, siweMessage.address.toLowerCase()));

    return { valid: true, address: siweMessage.address as Address };
  } catch (error) {
    console.error('SIWE verification error:', error);
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

  return { id: newUser[0].id, walletAddress: newUser[0].walletAddress };
}

/**
 * In-memory session store (use Redis in production)
 * Maps session token to user data
 */
const sessions = new Map<string, { userId: string; walletAddress: Address; expiresAt: Date }>();

// Session expiration time (24 hours)
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Create a session for an authenticated user
 */
export function createSession(userId: string, walletAddress: Address): string {
  const token = generateNonce();
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MS);

  sessions.set(token, { userId, walletAddress, expiresAt });

  return token;
}

/**
 * Validate session token
 */
export function validateSession(token: string): { valid: boolean; userId?: string; walletAddress?: Address } {
  const session = sessions.get(token);

  if (!session) {
    return { valid: false };
  }

  if (session.expiresAt < new Date()) {
    sessions.delete(token);
    return { valid: false };
  }

  return { valid: true, userId: session.userId, walletAddress: session.walletAddress };
}

/**
 * Delete session
 */
export function deleteSession(token: string): void {
  sessions.delete(token);
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
  const session = validateSession(token);

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
    const session = validateSession(token);

    if (session.valid && session.userId && session.walletAddress) {
      (req as AuthenticatedRequest).userId = session.userId;
      (req as AuthenticatedRequest).walletAddress = session.walletAddress;
    }
  }

  next();
}

/**
 * Cleanup expired sessions (run periodically)
 */
export function cleanupSessions(): void {
  const now = new Date();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt < now) {
      sessions.delete(token);
    }
  }
}

// Run cleanup every hour
setInterval(cleanupSessions, 60 * 60 * 1000);
