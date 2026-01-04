/**
 * Trade Routes
 * Execute and monitor trades
 */

import { Router } from 'express';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import {
  validateBody,
  validateQuery,
  validateParams,
  executeTradeSchema,
  tradeHistoryQuerySchema,
  uuidParamSchema,
} from '../middleware/validation.js';
import { tradeLimiter, standardLimiter } from '../middleware/rate-limit.js';
import { tradeExecutorService } from '../services/trade-executor.js';
import { delegationService } from '../services/delegation.js';
import { arbitrageService } from '../services/arbitrage.js';
import { riskManagerService } from '../services/risk-manager.js';
import { db, trades } from '../db/index.js';
import { eq, and, desc } from 'drizzle-orm';
import type { ChainId } from '../../shared/schema.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * POST /api/trades/execute
 * Execute a trade
 */
router.post(
  '/execute',
  tradeLimiter,
  validateBody(executeTradeSchema),
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;

      // Verify delegation ownership
      const delegation = await delegationService.getById(req.body.delegationId);

      if (!delegation) {
        return res.status(404).json({
          success: false,
          error: 'Delegation not found',
          timestamp: Date.now(),
        });
      }

      if (delegation.userId !== authReq.userId) {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to use this delegation',
          timestamp: Date.now(),
        });
      }

      // Assess risk
      const riskAssessment = await riskManagerService.assessTradeRisk(
        delegation.chainId as ChainId,
        {
          ...req.body,
          amountIn: BigInt(req.body.amountIn),
          amountOutMin: req.body.amountOutMin ? BigInt(req.body.amountOutMin) : undefined,
        }
      );

      if (!riskAssessment.approved) {
        return res.status(400).json({
          success: false,
          error: 'Trade rejected by risk assessment',
          details: {
            blockers: riskAssessment.blockers,
            warnings: riskAssessment.warnings,
          },
          timestamp: Date.now(),
        });
      }

      // Execute trade
      const result = await tradeExecutorService.executeTrade({
        ...req.body,
        amountIn: BigInt(req.body.amountIn),
        amountOutMin: req.body.amountOutMin ? BigInt(req.body.amountOutMin) : undefined,
      });

      if (result.success) {
        res.json({
          success: true,
          data: {
            txHash: result.txHash,
            gasUsed: result.gasUsed?.toString(),
          },
          timestamp: Date.now(),
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      console.error('Execute trade error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to execute trade',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * GET /api/trades/history
 * Get trade history
 */
router.get(
  '/history',
  standardLimiter,
  validateQuery(tradeHistoryQuerySchema),
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const { page, limit, status, protocol, chainId } = req.query as any;

      // Get user's delegations
      const delegations = await delegationService.getByUserId(authReq.userId);
      const delegationIds = delegations.map((d) => d.id);

      if (delegationIds.length === 0) {
        return res.json({
          success: true,
          data: {
            trades: [],
            total: 0,
            page,
            limit,
          },
          timestamp: Date.now(),
        });
      }

      // Build query - simplified for now
      const tradeHistory = await db
        .select()
        .from(trades)
        .where(eq(trades.delegationId, delegationIds[0])) // Simplified
        .orderBy(desc(trades.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      res.json({
        success: true,
        data: {
          trades: tradeHistory,
          total: tradeHistory.length,
          page,
          limit,
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Get trade history error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch trade history',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * GET /api/trades/:id
 * Get a specific trade
 */
router.get(
  '/:id',
  standardLimiter,
  validateParams(uuidParamSchema),
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;

      const trade = await db
        .select()
        .from(trades)
        .where(eq(trades.id, req.params.id))
        .limit(1);

      if (trade.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Trade not found',
          timestamp: Date.now(),
        });
      }

      // Verify ownership through delegation
      const delegation = await delegationService.getById(trade[0].delegationId);

      if (!delegation || delegation.userId !== authReq.userId) {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to view this trade',
          timestamp: Date.now(),
        });
      }

      res.json({
        success: true,
        data: trade[0],
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Get trade error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch trade',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * POST /api/trades/execute-opportunity
 * Execute an arbitrage opportunity
 */
router.post(
  '/execute-opportunity',
  tradeLimiter,
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const { delegationId, opportunityId } = req.body;

      if (!delegationId || !opportunityId) {
        return res.status(400).json({
          success: false,
          error: 'delegationId and opportunityId are required',
          timestamp: Date.now(),
        });
      }

      // Verify delegation ownership
      const delegation = await delegationService.getById(delegationId);

      if (!delegation || delegation.userId !== authReq.userId) {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to use this delegation',
          timestamp: Date.now(),
        });
      }

      // Execute opportunity
      const result = await arbitrageService.executeOpportunity(
        delegationId,
        opportunityId
      );

      if (result.success) {
        res.json({
          success: true,
          data: {
            txHash: result.txHash,
          },
          timestamp: Date.now(),
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      console.error('Execute opportunity error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to execute opportunity',
        timestamp: Date.now(),
      });
    }
  }
);

export default router;
