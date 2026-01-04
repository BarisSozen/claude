/**
 * Delegation Routes
 * Manage session key delegations
 */

import { Router } from 'express';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import {
  validateBody,
  validateParams,
  createDelegationSchema,
  updateDelegationSchema,
  uuidParamSchema,
} from '../middleware/validation.js';
import { standardLimiter } from '../middleware/rate-limit.js';
import { delegationService } from '../services/delegation.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * POST /api/delegations
 * Create a new delegation
 */
router.post(
  '/',
  standardLimiter,
  validateBody(createDelegationSchema),
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const delegation = await delegationService.create(authReq.userId, req.body);

      res.status(201).json({
        success: true,
        data: delegation,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Create delegation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create delegation',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * GET /api/delegations
 * Get all delegations for the authenticated user
 */
router.get('/', standardLimiter, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const delegations = await delegationService.getByUserId(authReq.userId);

    res.json({
      success: true,
      data: delegations,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Get delegations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch delegations',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/delegations/:id
 * Get a specific delegation
 */
router.get(
  '/:id',
  standardLimiter,
  validateParams(uuidParamSchema),
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const delegation = await delegationService.getById(req.params.id);

      if (!delegation) {
        return res.status(404).json({
          success: false,
          error: 'Delegation not found',
          timestamp: Date.now(),
        });
      }

      // Verify ownership
      if (delegation.userId !== authReq.userId) {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to view this delegation',
          timestamp: Date.now(),
        });
      }

      res.json({
        success: true,
        data: delegation,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Get delegation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch delegation',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * PATCH /api/delegations/:id
 * Update a delegation
 */
router.patch(
  '/:id',
  standardLimiter,
  validateParams(uuidParamSchema),
  validateBody(updateDelegationSchema),
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const delegation = await delegationService.update(
        req.params.id,
        authReq.userId,
        req.body
      );

      if (!delegation) {
        return res.status(404).json({
          success: false,
          error: 'Delegation not found or not authorized',
          timestamp: Date.now(),
        });
      }

      res.json({
        success: true,
        data: delegation,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Update delegation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update delegation',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * DELETE /api/delegations/:id
 * Revoke a delegation
 */
router.delete(
  '/:id',
  standardLimiter,
  validateParams(uuidParamSchema),
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const reason = req.body?.reason || 'User requested revocation';

      const success = await delegationService.revoke(
        req.params.id,
        authReq.userId,
        reason
      );

      if (!success) {
        return res.status(404).json({
          success: false,
          error: 'Delegation not found or not authorized',
          timestamp: Date.now(),
        });
      }

      res.json({
        success: true,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Revoke delegation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to revoke delegation',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * GET /api/delegations/:id/audit
 * Get audit history for a delegation
 */
router.get(
  '/:id/audit',
  standardLimiter,
  validateParams(uuidParamSchema),
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const delegation = await delegationService.getById(req.params.id);

      if (!delegation || delegation.userId !== authReq.userId) {
        return res.status(404).json({
          success: false,
          error: 'Delegation not found or not authorized',
          timestamp: Date.now(),
        });
      }

      const auditHistory = await delegationService.getAuditHistory(req.params.id);

      res.json({
        success: true,
        data: auditHistory,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Get audit history error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch audit history',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * POST /api/delegations/:id/pause
 * Pause a delegation
 */
router.post(
  '/:id/pause',
  standardLimiter,
  validateParams(uuidParamSchema),
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const delegation = await delegationService.update(
        req.params.id,
        authReq.userId,
        { status: 'paused' }
      );

      if (!delegation) {
        return res.status(404).json({
          success: false,
          error: 'Delegation not found or not authorized',
          timestamp: Date.now(),
        });
      }

      res.json({
        success: true,
        data: delegation,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Pause delegation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to pause delegation',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * POST /api/delegations/:id/resume
 * Resume a paused delegation
 */
router.post(
  '/:id/resume',
  standardLimiter,
  validateParams(uuidParamSchema),
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const delegation = await delegationService.update(
        req.params.id,
        authReq.userId,
        { status: 'active' }
      );

      if (!delegation) {
        return res.status(404).json({
          success: false,
          error: 'Delegation not found or not authorized',
          timestamp: Date.now(),
        });
      }

      res.json({
        success: true,
        data: delegation,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Resume delegation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to resume delegation',
        timestamp: Date.now(),
      });
    }
  }
);

export default router;
