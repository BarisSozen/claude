/**
 * Validation Middleware and Schemas
 * Zod schemas for all API inputs
 */

import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

// Common validation patterns
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const hexPattern = /^0x[a-fA-F0-9]*$/;
const uint256Pattern = /^\d+$/;

// Ethereum address schema
export const addressSchema = z.string().regex(addressPattern, 'Invalid Ethereum address');

// Chain ID schema
export const chainIdSchema = z.enum(['ethereum', 'arbitrum', 'base', 'polygon']);

// Delegation creation schema
export const createDelegationSchema = z.object({
  walletAddress: addressSchema,
  sessionKeyAddress: addressSchema,
  encryptedSessionKey: z.string().min(100, 'Encrypted key too short'),
  chainId: chainIdSchema,
  allowedProtocols: z.array(z.string().min(1)).min(1, 'At least one protocol required'),
  allowedTokens: z.array(addressSchema).min(1, 'At least one token required'),
  validUntil: z.string().datetime({ message: 'Invalid datetime format' }),
  limits: z.object({
    maxPerTrade: z.string().regex(uint256Pattern, 'Invalid max per trade'),
    maxDailyVolume: z.string().regex(uint256Pattern, 'Invalid max daily volume'),
    maxWeeklyVolume: z.string().regex(uint256Pattern, 'Invalid max weekly volume'),
    maxLeverage: z.string().regex(/^\d+(\.\d+)?$/, 'Invalid leverage').optional().default('1.0'),
  }),
});

// Update delegation schema
export const updateDelegationSchema = z.object({
  status: z.enum(['active', 'paused']).optional(),
  allowedProtocols: z.array(z.string().min(1)).min(1).optional(),
  allowedTokens: z.array(addressSchema).min(1).optional(),
  validUntil: z.string().datetime().optional(),
  limits: z.object({
    maxPerTrade: z.string().regex(uint256Pattern).optional(),
    maxDailyVolume: z.string().regex(uint256Pattern).optional(),
    maxWeeklyVolume: z.string().regex(uint256Pattern).optional(),
    maxLeverage: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  }).optional(),
});

// Trade execution schema
export const executeTradeSchema = z.object({
  delegationId: z.string().uuid('Invalid delegation ID'),
  protocol: z.string().min(1, 'Protocol required'),
  action: z.enum(['swap', 'lend', 'borrow', 'repay', 'flash_loan']),
  tokenIn: addressSchema.optional(),
  tokenOut: addressSchema.optional(),
  amountIn: z.string().regex(uint256Pattern, 'Invalid amount'),
  amountOutMin: z.string().regex(uint256Pattern).optional(),
  targetContract: addressSchema,
  callData: z.string().regex(hexPattern).optional(),
});

// SIWE verification schema
export const siweVerifySchema = z.object({
  message: z.string().min(1, 'Message required'),
  signature: z.string().regex(hexPattern, 'Invalid signature'),
});

// Nonce request schema
export const nonceRequestSchema = z.object({
  walletAddress: addressSchema,
});

// Query params schemas
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const tradeHistoryQuerySchema = paginationSchema.extend({
  status: z.enum(['pending', 'success', 'failed', 'reverted']).optional(),
  protocol: z.string().optional(),
  chainId: chainIdSchema.optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const opportunityQuerySchema = z.object({
  minProfitUsd: z.coerce.number().nonnegative().optional(),
  type: z.enum(['cross-exchange', 'triangular', 'cross-chain']).optional(),
  chainId: chainIdSchema.optional(),
});

// Executor config schema
export const executorConfigSchema = z.object({
  scanInterval: z.number().int().positive().max(60000).optional(),
  minProfitUSD: z.number().nonnegative().optional(),
  maxDailyTrades: z.number().int().positive().optional(),
  enabledStrategies: z.array(z.string()).optional(),
});

// Execute opportunity schema
export const executeOpportunitySchema = z.object({
  delegationId: z.string().uuid('Invalid delegation ID'),
  opportunityId: z.string().min(1, 'Opportunity ID is required'),
});

// Type exports
export type CreateDelegationInput = z.infer<typeof createDelegationSchema>;
export type UpdateDelegationInput = z.infer<typeof updateDelegationSchema>;
export type ExecuteTradeInput = z.infer<typeof executeTradeSchema>;
export type SiweVerifyInput = z.infer<typeof siweVerifySchema>;
export type NonceRequestInput = z.infer<typeof nonceRequestSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
export type TradeHistoryQuery = z.infer<typeof tradeHistoryQuerySchema>;
export type OpportunityQuery = z.infer<typeof opportunityQuerySchema>;
export type ExecutorConfigInput = z.infer<typeof executorConfigSchema>;
export type ExecuteOpportunityInput = z.infer<typeof executeOpportunitySchema>;

/**
 * Validation middleware factory
 * Validates request body against a Zod schema
 */
export function validateBody<T extends z.ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors,
        timestamp: Date.now(),
      });
    }

    req.body = result.data;
    next();
  };
}

/**
 * Validation middleware for query params
 */
export function validateQuery<T extends z.ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid query parameters',
        details: result.error.flatten().fieldErrors,
        timestamp: Date.now(),
      });
    }

    // Type assertion needed: Zod validated data doesn't match Express's ParsedQs type
    // This is safe because we've validated the data with Zod
    req.query = result.data as unknown as typeof req.query;
    next();
  };
}

/**
 * Validation middleware for route params
 */
export function validateParams<T extends z.ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid route parameters',
        details: result.error.flatten().fieldErrors,
        timestamp: Date.now(),
      });
    }

    // Type assertion needed: Zod validated data doesn't match Express's ParamsDictionary
    // This is safe because we've validated the data with Zod
    req.params = result.data as unknown as typeof req.params;
    next();
  };
}

// Common param schemas
export const uuidParamSchema = z.object({
  id: z.string().uuid('Invalid ID format'),
});

export const addressParamSchema = z.object({
  address: addressSchema,
});

// ============================================
// Admin & Strategy Schemas
// ============================================

// Strategy type enum
export const strategyTypeSchema = z.enum([
  'cross-exchange',
  'triangular',
  'cross-chain',
  'flash-loan',
  'liquidation',
]);

// Risk level enum
export const riskLevelSchema = z.enum(['low', 'medium', 'high']);

// Create strategy schema
export const createStrategySchema = z.object({
  name: z.string().min(1).max(100),
  type: strategyTypeSchema,
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  config: z
    .object({
      minProfitUsd: z.number().nonnegative().optional(),
      maxGasUsd: z.number().nonnegative().optional(),
      maxSlippageBps: z.number().int().min(0).max(10000).optional(),
      allowedDexes: z.array(z.string()).optional(),
      allowedTokens: z.array(z.string()).optional(),
      allowedChains: z.array(z.string()).optional(),
    })
    .optional()
    .default({}),
  riskLevel: riskLevelSchema.default('medium'),
});

// Update strategy schema
export const updateStrategySchema = createStrategySchema.partial();

// Strategy metrics query schema
export const strategyMetricsQuerySchema = z.object({
  strategyId: z.string().uuid().optional(),
  period: z.enum(['day', 'week', 'month', 'year', 'ytd', 'all']).default('month'),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

// Admin token schema
export const createAdminTokenSchema = z.object({
  address: addressSchema,
  chainId: chainIdSchema,
  symbol: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  decimals: z.number().int().min(0).max(18),
  logoUrl: z.string().url().optional(),
  enabled: z.boolean().default(true),
});

export const updateAdminTokenSchema = createAdminTokenSchema.partial().omit({
  address: true,
  chainId: true,
});

// Admin protocol schema
export const protocolTypeSchema = z.enum(['dex', 'lending', 'aggregator', 'bridge']);

export const createAdminProtocolSchema = z.object({
  name: z.string().min(1).max(100),
  type: protocolTypeSchema,
  chainId: chainIdSchema,
  routerAddress: addressSchema.optional(),
  factoryAddress: addressSchema.optional(),
  enabled: z.boolean().default(true),
  config: z.record(z.unknown()).optional().default({}),
});

export const updateAdminProtocolSchema = createAdminProtocolSchema.partial();

// Admin chain schema
export const createAdminChainSchema = z.object({
  id: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  chainIdNumeric: z.number().int().positive(),
  rpcUrl: z.string().url().optional(),
  explorerUrl: z.string().url().optional(),
  nativeToken: z.string().min(1).max(10),
  enabled: z.boolean().default(true),
});

export const updateAdminChainSchema = createAdminChainSchema.partial().omit({
  id: true,
});

// Type exports for admin schemas
export type CreateStrategyInput = z.infer<typeof createStrategySchema>;
export type UpdateStrategyInput = z.infer<typeof updateStrategySchema>;
export type StrategyMetricsQuery = z.infer<typeof strategyMetricsQuerySchema>;
export type CreateAdminTokenInput = z.infer<typeof createAdminTokenSchema>;
export type UpdateAdminTokenInput = z.infer<typeof updateAdminTokenSchema>;
export type CreateAdminProtocolInput = z.infer<typeof createAdminProtocolSchema>;
export type UpdateAdminProtocolInput = z.infer<typeof updateAdminProtocolSchema>;
export type CreateAdminChainInput = z.infer<typeof createAdminChainSchema>;
export type UpdateAdminChainInput = z.infer<typeof updateAdminChainSchema>;
