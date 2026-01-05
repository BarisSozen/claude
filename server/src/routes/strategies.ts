/**
 * Strategy Routes
 * CRUD operations and performance metrics for trading strategies
 */

import { Router } from 'express';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import {
  validateBody,
  validateQuery,
  validateParams,
  createStrategySchema,
  updateStrategySchema,
  strategyMetricsQuerySchema,
  uuidParamSchema,
  paginationSchema,
  type CreateStrategyInput,
  type UpdateStrategyInput,
  type StrategyMetricsQuery,
} from '../middleware/validation.js';
import { standardLimiter } from '../middleware/rate-limit.js';
import { db, strategies, strategySnapshots } from '../db/index.js';
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * GET /api/strategies
 * List all strategies
 */
router.get('/', standardLimiter, validateQuery(paginationSchema), async (req, res) => {
  try {
    const { page, limit } = req.query as { page: number; limit: number };

    const allStrategies = await db
      .select()
      .from(strategies)
      .orderBy(desc(strategies.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const totalResult = await db.select({ count: sql<number>`count(*)` }).from(strategies);

    res.json({
      success: true,
      data: {
        strategies: allStrategies,
        total: Number(totalResult[0]?.count ?? 0),
        page,
        limit,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Get strategies error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch strategies',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/strategies/:id
 * Get a specific strategy
 */
router.get('/:id', standardLimiter, validateParams(uuidParamSchema), async (req, res) => {
  try {
    const strategy = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, req.params.id))
      .limit(1);

    if (strategy.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Strategy not found',
        timestamp: Date.now(),
      });
    }

    res.json({
      success: true,
      data: strategy[0],
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Get strategy error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch strategy',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/strategies
 * Create a new strategy
 */
router.post('/', standardLimiter, validateBody(createStrategySchema), async (req, res) => {
  try {
    const input = req.body as CreateStrategyInput;

    const newStrategy = await db
      .insert(strategies)
      .values({
        name: input.name,
        type: input.type,
        description: input.description,
        enabled: input.enabled,
        config: input.config,
        riskLevel: input.riskLevel,
      })
      .returning();

    res.status(201).json({
      success: true,
      data: newStrategy[0],
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Create strategy error:', error);
    if ((error as Error).message?.includes('unique')) {
      return res.status(409).json({
        success: false,
        error: 'Strategy with this name already exists',
        timestamp: Date.now(),
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to create strategy',
      timestamp: Date.now(),
    });
  }
});

/**
 * PATCH /api/strategies/:id
 * Update a strategy
 */
router.patch(
  '/:id',
  standardLimiter,
  validateParams(uuidParamSchema),
  validateBody(updateStrategySchema),
  async (req, res) => {
    try {
      const input = req.body as UpdateStrategyInput;

      const updated = await db
        .update(strategies)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(strategies.id, req.params.id))
        .returning();

      if (updated.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Strategy not found',
          timestamp: Date.now(),
        });
      }

      res.json({
        success: true,
        data: updated[0],
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Update strategy error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update strategy',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * DELETE /api/strategies/:id
 * Delete a strategy
 */
router.delete('/:id', standardLimiter, validateParams(uuidParamSchema), async (req, res) => {
  try {
    const deleted = await db
      .delete(strategies)
      .where(eq(strategies.id, req.params.id))
      .returning();

    if (deleted.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Strategy not found',
        timestamp: Date.now(),
      });
    }

    // Return 204 No Content for successful DELETE
    res.status(204).send();
  } catch (error) {
    console.error('Delete strategy error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete strategy',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/strategies/metrics/summary
 * Get aggregated performance metrics across all strategies
 */
router.get(
  '/metrics/summary',
  standardLimiter,
  validateQuery(strategyMetricsQuerySchema),
  async (req, res) => {
    try {
      const { period, strategyId, startDate, endDate } = req.query as StrategyMetricsQuery;

      const dateRange = getDateRange(period, startDate, endDate);
      const conditions = [
        gte(strategySnapshots.snapshotDate, dateRange.start),
        lte(strategySnapshots.snapshotDate, dateRange.end),
      ];

      if (strategyId) {
        conditions.push(eq(strategySnapshots.strategyId, strategyId));
      }

      const metrics = await db
        .select({
          totalTrades: sql<string>`sum(${strategySnapshots.tradeCount})`,
          successfulTrades: sql<string>`sum(${strategySnapshots.successfulTrades})`,
          failedTrades: sql<string>`sum(${strategySnapshots.failedTrades})`,
          grossProfit: sql<string>`sum(${strategySnapshots.grossProfitUsd})`,
          gasSpent: sql<string>`sum(${strategySnapshots.gasSpentUsd})`,
          netProfit: sql<string>`sum(${strategySnapshots.netProfitUsd})`,
          totalVolume: sql<string>`sum(${strategySnapshots.volumeUsd})`,
          maxDrawdown: sql<string>`max(${strategySnapshots.maxDrawdownPercent})`,
        })
        .from(strategySnapshots)
        .where(and(...conditions));

      const result = metrics[0];
      const totalTrades = Number(result?.totalTrades ?? 0);
      const successfulTrades = Number(result?.successfulTrades ?? 0);

      res.json({
        success: true,
        data: {
          period,
          dateRange,
          metrics: {
            totalTrades,
            successfulTrades,
            failedTrades: Number(result?.failedTrades ?? 0),
            successRate: totalTrades > 0 ? (successfulTrades / totalTrades) * 100 : 0,
            grossProfitUsd: Number(result?.grossProfit ?? 0),
            gasSpentUsd: Number(result?.gasSpent ?? 0),
            netProfitUsd: Number(result?.netProfit ?? 0),
            totalVolumeUsd: Number(result?.totalVolume ?? 0),
            maxDrawdownPercent: Number(result?.maxDrawdown ?? 0),
          },
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Get metrics summary error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch metrics summary',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * GET /api/strategies/:id/metrics
 * Get performance metrics for a specific strategy
 */
router.get(
  '/:id/metrics',
  standardLimiter,
  validateParams(uuidParamSchema),
  validateQuery(strategyMetricsQuerySchema),
  async (req, res) => {
    try {
      const { period, startDate, endDate } = req.query as StrategyMetricsQuery;
      const strategyId = req.params.id;

      // Verify strategy exists
      const strategy = await db
        .select()
        .from(strategies)
        .where(eq(strategies.id, strategyId))
        .limit(1);

      if (strategy.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Strategy not found',
          timestamp: Date.now(),
        });
      }

      const dateRange = getDateRange(period, startDate, endDate);

      // Get daily snapshots for charting
      const snapshots = await db
        .select()
        .from(strategySnapshots)
        .where(
          and(
            eq(strategySnapshots.strategyId, strategyId),
            gte(strategySnapshots.snapshotDate, dateRange.start),
            lte(strategySnapshots.snapshotDate, dateRange.end)
          )
        )
        .orderBy(strategySnapshots.snapshotDate);

      // Calculate summary metrics
      const summary = snapshots.reduce(
        (acc, snap) => ({
          totalTrades: acc.totalTrades + Number(snap.tradeCount),
          successfulTrades: acc.successfulTrades + Number(snap.successfulTrades),
          failedTrades: acc.failedTrades + Number(snap.failedTrades),
          grossProfitUsd: acc.grossProfitUsd + Number(snap.grossProfitUsd),
          gasSpentUsd: acc.gasSpentUsd + Number(snap.gasSpentUsd),
          netProfitUsd: acc.netProfitUsd + Number(snap.netProfitUsd),
          volumeUsd: acc.volumeUsd + Number(snap.volumeUsd),
        }),
        {
          totalTrades: 0,
          successfulTrades: 0,
          failedTrades: 0,
          grossProfitUsd: 0,
          gasSpentUsd: 0,
          netProfitUsd: 0,
          volumeUsd: 0,
        }
      );

      // Calculate drawdown from cumulative values
      let maxDrawdown = 0;
      let peak = 0;
      for (const snap of snapshots) {
        const cumProfit = Number(snap.cumulativeProfitUsd);
        if (cumProfit > peak) {
          peak = cumProfit;
        }
        const drawdown = peak > 0 ? ((peak - cumProfit) / peak) * 100 : 0;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }

      res.json({
        success: true,
        data: {
          strategy: strategy[0],
          period,
          dateRange,
          summary: {
            ...summary,
            successRate:
              summary.totalTrades > 0
                ? (summary.successfulTrades / summary.totalTrades) * 100
                : 0,
            maxDrawdownPercent: maxDrawdown,
          },
          snapshots: snapshots.map((s) => ({
            date: s.snapshotDate,
            tradeCount: Number(s.tradeCount),
            netProfitUsd: Number(s.netProfitUsd),
            volumeUsd: Number(s.volumeUsd),
            successRate: Number(s.successRate),
            cumulativeProfitUsd: Number(s.cumulativeProfitUsd),
          })),
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Get strategy metrics error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch strategy metrics',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * Helper function to get date range based on period
 */
function getDateRange(
  period: string,
  startDate?: string,
  endDate?: string
): { start: Date; end: Date } {
  const end = endDate ? new Date(endDate) : new Date();
  let start: Date;

  if (startDate) {
    start = new Date(startDate);
  } else {
    switch (period) {
      case 'day':
        start = new Date(end);
        start.setDate(start.getDate() - 1);
        break;
      case 'week':
        start = new Date(end);
        start.setDate(start.getDate() - 7);
        break;
      case 'month':
        start = new Date(end);
        start.setMonth(start.getMonth() - 1);
        break;
      case 'year':
        start = new Date(end);
        start.setFullYear(start.getFullYear() - 1);
        break;
      case 'ytd':
        start = new Date(end.getFullYear(), 0, 1);
        break;
      case 'all':
      default:
        start = new Date('2020-01-01');
        break;
    }
  }

  return { start, end };
}

export default router;
