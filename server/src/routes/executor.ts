/**
 * Executor Routes
 * Manage the continuous executor
 */

import { Router } from 'express';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { validateBody, executorConfigSchema } from '../middleware/validation.js';
import { standardLimiter } from '../middleware/rate-limit.js';
import { continuousExecutorService } from '../services/continuous-executor.js';
import { delegationService } from '../services/delegation.js';
import { riskManagerService } from '../services/risk-manager.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * GET /api/executor/status
 * Get executor status
 */
router.get('/status', standardLimiter, async (req, res) => {
  try {
    const status = continuousExecutorService.getStatus();
    const metrics = continuousExecutorService.getMetrics();
    const riskStatus = riskManagerService.getRiskStatus();

    res.json({
      success: true,
      data: {
        executor: status,
        metrics,
        risk: riskStatus,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Get executor status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get executor status',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/executor/start
 * Start the executor
 */
router.post('/start', standardLimiter, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { delegationId } = req.body;

    // Verify delegation if provided
    if (delegationId) {
      const delegation = await delegationService.getById(delegationId);

      if (!delegation || delegation.userId !== authReq.userId) {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to use this delegation',
          timestamp: Date.now(),
        });
      }
    }

    await continuousExecutorService.start(delegationId);

    res.json({
      success: true,
      data: {
        status: 'started',
        executor: continuousExecutorService.getStatus(),
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Start executor error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start executor',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/executor/stop
 * Stop the executor
 */
router.post('/stop', standardLimiter, async (req, res) => {
  try {
    continuousExecutorService.stop();

    res.json({
      success: true,
      data: {
        status: 'stopped',
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Stop executor error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stop executor',
      timestamp: Date.now(),
    });
  }
});

/**
 * PATCH /api/executor/config
 * Update executor configuration
 */
router.patch(
  '/config',
  standardLimiter,
  validateBody(executorConfigSchema),
  async (req, res) => {
    try {
      continuousExecutorService.updateConfig(req.body);

      res.json({
        success: true,
        data: {
          config: continuousExecutorService.getStatus().config,
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Update executor config error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update config',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * POST /api/executor/delegation
 * Set active delegation for executor
 */
router.post('/delegation', standardLimiter, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { delegationId } = req.body;

    if (delegationId) {
      const delegation = await delegationService.getById(delegationId);

      if (!delegation || delegation.userId !== authReq.userId) {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to use this delegation',
          timestamp: Date.now(),
        });
      }
    }

    const success = await continuousExecutorService.setActiveDelegation(
      delegationId || null
    );

    if (!success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid delegation',
        timestamp: Date.now(),
      });
    }

    res.json({
      success: true,
      data: {
        activeDelegationId: delegationId || null,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Set delegation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set delegation',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/executor/metrics
 * Get detailed executor metrics
 */
router.get('/metrics', standardLimiter, async (req, res) => {
  try {
    const metrics = continuousExecutorService.getMetrics();

    res.json({
      success: true,
      data: metrics,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Get metrics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get metrics',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/executor/risk/pause
 * Pause trading (emergency)
 */
router.post('/risk/pause', standardLimiter, async (req, res) => {
  try {
    const reason = req.body?.reason || 'User requested pause';
    riskManagerService.pauseTrading(reason);

    res.json({
      success: true,
      data: {
        tradingPaused: true,
        reason,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Pause trading error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to pause trading',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/executor/risk/resume
 * Resume trading
 */
router.post('/risk/resume', standardLimiter, async (req, res) => {
  try {
    riskManagerService.resumeTrading();

    res.json({
      success: true,
      data: {
        tradingPaused: false,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Resume trading error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resume trading',
      timestamp: Date.now(),
    });
  }
});

export default router;
