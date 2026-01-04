/**
 * Authentication Routes
 * SIWE (Sign-In With Ethereum) authentication
 */

import { Router } from 'express';
import {
  createNonce,
  verifySiweSignature,
  getOrCreateUser,
  createSession,
  deleteSession,
} from '../middleware/auth.js';
import {
  validateBody,
  nonceRequestSchema,
  siweVerifySchema,
} from '../middleware/validation.js';
import { authLimiter } from '../middleware/rate-limit.js';

const router = Router();

/**
 * POST /api/auth/nonce
 * Get a nonce for SIWE authentication
 */
router.post(
  '/nonce',
  authLimiter,
  validateBody(nonceRequestSchema),
  async (req, res) => {
    try {
      const { walletAddress } = req.body;
      const nonce = await createNonce(walletAddress);

      res.json({
        success: true,
        data: { nonce },
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Nonce generation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate nonce',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * POST /api/auth/verify
 * Verify SIWE signature and create session
 */
router.post(
  '/verify',
  authLimiter,
  validateBody(siweVerifySchema),
  async (req, res) => {
    try {
      const { message, signature } = req.body;

      // Verify signature
      const result = await verifySiweSignature(message, signature);

      if (!result.valid || !result.address) {
        return res.status(401).json({
          success: false,
          error: result.error || 'Invalid signature',
          timestamp: Date.now(),
        });
      }

      // Get or create user
      const user = await getOrCreateUser(result.address);

      // Create session
      const token = createSession(user.id, result.address);

      res.json({
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            walletAddress: user.walletAddress,
          },
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Verification error:', error);
      res.status(500).json({
        success: false,
        error: 'Verification failed',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * POST /api/auth/logout
 * Invalidate session
 */
router.post('/logout', (req, res) => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    deleteSession(token);
  }

  res.json({
    success: true,
    timestamp: Date.now(),
  });
});

export default router;
