/**
 * Opportunity Routes
 * View and manage arbitrage opportunities
 */

import { Router } from 'express';
import { structuredLogger } from '../services/logger.js';
import { authMiddleware } from '../middleware/auth.js';
import { structuredLogger } from '../services/logger.js';
import { validateQuery, opportunityQuerySchema, type OpportunityQuery } from '../middleware/validation.js';
import { structuredLogger } from '../services/logger.js';
import { priceLimiter } from '../middleware/rate-limit.js';
import { structuredLogger } from '../services/logger.js';
import { arbitrageService } from '../services/arbitrage.js';
import { structuredLogger } from '../services/logger.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * GET /api/opportunities
 * Get current arbitrage opportunities
 */
router.get(
  '/',
  priceLimiter,
  validateQuery(opportunityQuerySchema),
  async (req, res) => {
    try {
      const { minProfitUsd, type } = req.query as OpportunityQuery;

      let opportunities = arbitrageService.getOpportunities();

      // Filter by minimum profit
      if (minProfitUsd !== undefined) {
        opportunities = opportunities.filter(
          (opp) => opp.netProfitUSD >= minProfitUsd
        );
      }

      // Filter by type
      if (type) {
        opportunities = opportunities.filter((opp) => opp.type === type);
      }

      res.json({
        success: true,
        data: {
          opportunities: opportunities.map((opp) => ({
            ...opp,
            buyPrice: opp.buyPrice.toString(),
            sellPrice: opp.sellPrice.toString(),
            requiredCapital: opp.requiredCapital.toString(),
            executionPath: opp.executionPath.map((step) => ({
              ...step,
              amountIn: step.amountIn.toString(),
              expectedAmountOut: step.expectedAmountOut.toString(),
            })),
          })),
          count: opportunities.length,
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      structuredLogger.error('opportunities', 'Get opportunities failed', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch opportunities',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * GET /api/opportunities/:id
 * Get a specific opportunity
 */
router.get('/:id', priceLimiter, async (req, res) => {
  try {
    const opportunity = arbitrageService.getOpportunity(req.params.id);

    if (!opportunity) {
      return res.status(404).json({
        success: false,
        error: 'Opportunity not found or expired',
        timestamp: Date.now(),
      });
    }

    res.json({
      success: true,
      data: {
        ...opportunity,
        buyPrice: opportunity.buyPrice.toString(),
        sellPrice: opportunity.sellPrice.toString(),
        requiredCapital: opportunity.requiredCapital.toString(),
        executionPath: opportunity.executionPath.map((step) => ({
          ...step,
          amountIn: step.amountIn.toString(),
          expectedAmountOut: step.expectedAmountOut.toString(),
        })),
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    structuredLogger.error('opportunities', 'Get opportunity failed', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch opportunity',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/opportunities/scan
 * Trigger a manual scan for opportunities
 */
router.post('/scan', priceLimiter, async (req, res) => {
  try {
    const opportunities = await arbitrageService.scanForOpportunities('ethereum');

    res.json({
      success: true,
      data: {
        found: opportunities.length,
        opportunities: opportunities.map((opp) => ({
          id: opp.id,
          type: opp.type,
          tokenPair: opp.tokenPair,
          netProfitUSD: opp.netProfitUSD,
          expiresAt: opp.expiresAt,
        })),
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    structuredLogger.error('opportunities', 'Scan opportunities failed', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to scan for opportunities',
      timestamp: Date.now(),
    });
  }
});

export default router;
