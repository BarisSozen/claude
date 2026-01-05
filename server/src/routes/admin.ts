/**
 * Admin Routes
 * CRUD operations for tokens, protocols, and chains configuration
 */

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  validateBody,
  validateQuery,
  validateParams,
  createAdminTokenSchema,
  updateAdminTokenSchema,
  createAdminProtocolSchema,
  updateAdminProtocolSchema,
  createAdminChainSchema,
  updateAdminChainSchema,
  uuidParamSchema,
  paginationSchema,
  chainIdSchema,
  type CreateAdminTokenInput,
  type UpdateAdminTokenInput,
  type CreateAdminProtocolInput,
  type UpdateAdminProtocolInput,
  type CreateAdminChainInput,
  type UpdateAdminChainInput,
} from '../middleware/validation.js';
import { standardLimiter } from '../middleware/rate-limit.js';
import { db, adminTokens, adminProtocols, adminChains } from '../db/index.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { z } from 'zod';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// ============================================
// Token Routes
// ============================================

const tokenQuerySchema = paginationSchema.extend({
  chainId: chainIdSchema.optional(),
  enabled: z.coerce.boolean().optional(),
});

/**
 * GET /api/admin/tokens
 * List all configured tokens
 */
router.get('/tokens', standardLimiter, validateQuery(tokenQuerySchema), async (req, res) => {
  try {
    const { page, limit, chainId, enabled } = req.query as {
      page: number;
      limit: number;
      chainId?: string;
      enabled?: boolean;
    };

    const conditions = [];
    if (chainId) conditions.push(eq(adminTokens.chainId, chainId));
    if (enabled !== undefined) conditions.push(eq(adminTokens.enabled, enabled));

    const tokens = await db
      .select()
      .from(adminTokens)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(adminTokens.symbol)
      .limit(limit)
      .offset((page - 1) * limit);

    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(adminTokens)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    res.json({
      success: true,
      data: {
        tokens,
        total: Number(totalResult[0]?.count ?? 0),
        page,
        limit,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Get tokens error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tokens',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/admin/tokens/:id
 * Get a specific token
 */
router.get('/tokens/:id', standardLimiter, validateParams(uuidParamSchema), async (req, res) => {
  try {
    const token = await db
      .select()
      .from(adminTokens)
      .where(eq(adminTokens.id, req.params.id))
      .limit(1);

    if (token.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Token not found',
        timestamp: Date.now(),
      });
    }

    res.json({
      success: true,
      data: token[0],
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Get token error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch token',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/admin/tokens
 * Create a new token
 */
router.post('/tokens', standardLimiter, validateBody(createAdminTokenSchema), async (req, res) => {
  try {
    const input = req.body as CreateAdminTokenInput;

    // Check for existing token with same address and chain
    const existing = await db
      .select()
      .from(adminTokens)
      .where(
        and(
          eq(adminTokens.address, input.address.toLowerCase()),
          eq(adminTokens.chainId, input.chainId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Token already exists for this chain',
        timestamp: Date.now(),
      });
    }

    const newToken = await db
      .insert(adminTokens)
      .values({
        address: input.address.toLowerCase(),
        chainId: input.chainId,
        symbol: input.symbol.toUpperCase(),
        name: input.name,
        decimals: input.decimals.toString(),
        logoUrl: input.logoUrl,
        enabled: input.enabled,
      })
      .returning();

    res.status(201).json({
      success: true,
      data: newToken[0],
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Create token error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create token',
      timestamp: Date.now(),
    });
  }
});

/**
 * PATCH /api/admin/tokens/:id
 * Update a token
 */
router.patch(
  '/tokens/:id',
  standardLimiter,
  validateParams(uuidParamSchema),
  validateBody(updateAdminTokenSchema),
  async (req, res) => {
    try {
      const input = req.body as UpdateAdminTokenInput;

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.symbol) updateData.symbol = input.symbol.toUpperCase();
      if (input.name) updateData.name = input.name;
      if (input.decimals !== undefined) updateData.decimals = input.decimals.toString();
      if (input.logoUrl !== undefined) updateData.logoUrl = input.logoUrl;
      if (input.enabled !== undefined) updateData.enabled = input.enabled;

      const updated = await db
        .update(adminTokens)
        .set(updateData)
        .where(eq(adminTokens.id, req.params.id))
        .returning();

      if (updated.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Token not found',
          timestamp: Date.now(),
        });
      }

      res.json({
        success: true,
        data: updated[0],
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Update token error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update token',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * DELETE /api/admin/tokens/:id
 * Delete a token
 */
router.delete('/tokens/:id', standardLimiter, validateParams(uuidParamSchema), async (req, res) => {
  try {
    const deleted = await db
      .delete(adminTokens)
      .where(eq(adminTokens.id, req.params.id))
      .returning();

    if (deleted.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Token not found',
        timestamp: Date.now(),
      });
    }

    // Return 204 No Content for successful DELETE
    res.status(204).send();
  } catch (error) {
    console.error('Delete token error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete token',
      timestamp: Date.now(),
    });
  }
});

// ============================================
// Protocol Routes
// ============================================

const protocolQuerySchema = paginationSchema.extend({
  chainId: chainIdSchema.optional(),
  type: z.enum(['dex', 'lending', 'aggregator', 'bridge']).optional(),
  enabled: z.coerce.boolean().optional(),
});

/**
 * GET /api/admin/protocols
 * List all configured protocols
 */
router.get('/protocols', standardLimiter, validateQuery(protocolQuerySchema), async (req, res) => {
  try {
    const { page, limit, chainId, type, enabled } = req.query as {
      page: number;
      limit: number;
      chainId?: string;
      type?: string;
      enabled?: boolean;
    };

    const conditions = [];
    if (chainId) conditions.push(eq(adminProtocols.chainId, chainId));
    if (type) conditions.push(eq(adminProtocols.type, type as 'dex' | 'lending' | 'aggregator' | 'bridge'));
    if (enabled !== undefined) conditions.push(eq(adminProtocols.enabled, enabled));

    const protocols = await db
      .select()
      .from(adminProtocols)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(adminProtocols.name)
      .limit(limit)
      .offset((page - 1) * limit);

    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(adminProtocols)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    res.json({
      success: true,
      data: {
        protocols,
        total: Number(totalResult[0]?.count ?? 0),
        page,
        limit,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Get protocols error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch protocols',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/admin/protocols/:id
 * Get a specific protocol
 */
router.get(
  '/protocols/:id',
  standardLimiter,
  validateParams(uuidParamSchema),
  async (req, res) => {
    try {
      const protocol = await db
        .select()
        .from(adminProtocols)
        .where(eq(adminProtocols.id, req.params.id))
        .limit(1);

      if (protocol.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Protocol not found',
          timestamp: Date.now(),
        });
      }

      res.json({
        success: true,
        data: protocol[0],
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Get protocol error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch protocol',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * POST /api/admin/protocols
 * Create a new protocol
 */
router.post(
  '/protocols',
  standardLimiter,
  validateBody(createAdminProtocolSchema),
  async (req, res) => {
    try {
      const input = req.body as CreateAdminProtocolInput;

      const newProtocol = await db
        .insert(adminProtocols)
        .values({
          name: input.name,
          type: input.type,
          chainId: input.chainId,
          routerAddress: input.routerAddress?.toLowerCase(),
          factoryAddress: input.factoryAddress?.toLowerCase(),
          enabled: input.enabled,
          config: input.config,
        })
        .returning();

      res.status(201).json({
        success: true,
        data: newProtocol[0],
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Create protocol error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create protocol',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * PATCH /api/admin/protocols/:id
 * Update a protocol
 */
router.patch(
  '/protocols/:id',
  standardLimiter,
  validateParams(uuidParamSchema),
  validateBody(updateAdminProtocolSchema),
  async (req, res) => {
    try {
      const input = req.body as UpdateAdminProtocolInput;

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name) updateData.name = input.name;
      if (input.type) updateData.type = input.type;
      if (input.chainId) updateData.chainId = input.chainId;
      if (input.routerAddress !== undefined) updateData.routerAddress = input.routerAddress?.toLowerCase();
      if (input.factoryAddress !== undefined) updateData.factoryAddress = input.factoryAddress?.toLowerCase();
      if (input.enabled !== undefined) updateData.enabled = input.enabled;
      if (input.config) updateData.config = input.config;

      const updated = await db
        .update(adminProtocols)
        .set(updateData)
        .where(eq(adminProtocols.id, req.params.id))
        .returning();

      if (updated.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Protocol not found',
          timestamp: Date.now(),
        });
      }

      res.json({
        success: true,
        data: updated[0],
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Update protocol error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update protocol',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * DELETE /api/admin/protocols/:id
 * Delete a protocol
 */
router.delete(
  '/protocols/:id',
  standardLimiter,
  validateParams(uuidParamSchema),
  async (req, res) => {
    try {
      const deleted = await db
        .delete(adminProtocols)
        .where(eq(adminProtocols.id, req.params.id))
        .returning();

      if (deleted.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Protocol not found',
          timestamp: Date.now(),
        });
      }

      // Return 204 No Content for successful DELETE
      res.status(204).send();
    } catch (error) {
      console.error('Delete protocol error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete protocol',
        timestamp: Date.now(),
      });
    }
  }
);

// ============================================
// Chain Routes
// ============================================

const chainIdParamSchema = z.object({
  id: z.string().min(1).max(20),
});

/**
 * GET /api/admin/chains
 * List all configured chains
 */
router.get('/chains', standardLimiter, validateQuery(paginationSchema), async (req, res) => {
  try {
    const { page, limit } = req.query as { page: number; limit: number };

    const chains = await db
      .select()
      .from(adminChains)
      .orderBy(adminChains.name)
      .limit(limit)
      .offset((page - 1) * limit);

    const totalResult = await db.select({ count: sql<number>`count(*)` }).from(adminChains);

    res.json({
      success: true,
      data: {
        chains,
        total: Number(totalResult[0]?.count ?? 0),
        page,
        limit,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Get chains error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chains',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/admin/chains/:id
 * Get a specific chain
 */
router.get('/chains/:id', standardLimiter, validateParams(chainIdParamSchema), async (req, res) => {
  try {
    const chain = await db
      .select()
      .from(adminChains)
      .where(eq(adminChains.id, req.params.id))
      .limit(1);

    if (chain.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Chain not found',
        timestamp: Date.now(),
      });
    }

    res.json({
      success: true,
      data: chain[0],
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Get chain error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chain',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/admin/chains
 * Create a new chain
 */
router.post('/chains', standardLimiter, validateBody(createAdminChainSchema), async (req, res) => {
  try {
    const input = req.body as CreateAdminChainInput;

    // Check for existing chain with same id
    const existing = await db
      .select()
      .from(adminChains)
      .where(eq(adminChains.id, input.id))
      .limit(1);

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Chain with this ID already exists',
        timestamp: Date.now(),
      });
    }

    const newChain = await db
      .insert(adminChains)
      .values({
        id: input.id,
        name: input.name,
        chainIdNumeric: input.chainIdNumeric.toString(),
        rpcUrl: input.rpcUrl,
        explorerUrl: input.explorerUrl,
        nativeToken: input.nativeToken.toUpperCase(),
        enabled: input.enabled,
      })
      .returning();

    res.status(201).json({
      success: true,
      data: newChain[0],
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Create chain error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create chain',
      timestamp: Date.now(),
    });
  }
});

/**
 * PATCH /api/admin/chains/:id
 * Update a chain
 */
router.patch(
  '/chains/:id',
  standardLimiter,
  validateParams(chainIdParamSchema),
  validateBody(updateAdminChainSchema),
  async (req, res) => {
    try {
      const input = req.body as UpdateAdminChainInput;

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name) updateData.name = input.name;
      if (input.chainIdNumeric !== undefined) updateData.chainIdNumeric = input.chainIdNumeric.toString();
      if (input.rpcUrl !== undefined) updateData.rpcUrl = input.rpcUrl;
      if (input.explorerUrl !== undefined) updateData.explorerUrl = input.explorerUrl;
      if (input.nativeToken) updateData.nativeToken = input.nativeToken.toUpperCase();
      if (input.enabled !== undefined) updateData.enabled = input.enabled;

      const updated = await db
        .update(adminChains)
        .set(updateData)
        .where(eq(adminChains.id, req.params.id))
        .returning();

      if (updated.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Chain not found',
          timestamp: Date.now(),
        });
      }

      res.json({
        success: true,
        data: updated[0],
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Update chain error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update chain',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * DELETE /api/admin/chains/:id
 * Delete a chain
 */
router.delete(
  '/chains/:id',
  standardLimiter,
  validateParams(chainIdParamSchema),
  async (req, res) => {
    try {
      const deleted = await db
        .delete(adminChains)
        .where(eq(adminChains.id, req.params.id))
        .returning();

      if (deleted.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Chain not found',
          timestamp: Date.now(),
        });
      }

      // Return 204 No Content for successful DELETE
      res.status(204).send();
    } catch (error) {
      console.error('Delete chain error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete chain',
        timestamp: Date.now(),
      });
    }
  }
);

export default router;
