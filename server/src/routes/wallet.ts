/**
 * Wallet Routes
 * Wallet balance and monitoring
 */

import { Router } from 'express';
import { structuredLogger } from '../services/logger.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { structuredLogger } from '../services/logger.js';
import { validateParams, validateQuery, addressParamSchema, chainIdSchema } from '../middleware/validation.js';
import { structuredLogger } from '../services/logger.js';
import { standardLimiter, priceLimiter } from '../middleware/rate-limit.js';
import { structuredLogger } from '../services/logger.js';
import { walletService } from '../services/wallet.js';
import { structuredLogger } from '../services/logger.js';
import { priceOracleService } from '../services/price-oracle.js';
import { structuredLogger } from '../services/logger.js';
import type { Address, ChainId } from '../../shared/schema.js';
import { structuredLogger } from '../services/logger.js';
import { z } from 'zod';
import { structuredLogger } from '../services/logger.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

const chainQuerySchema = z.object({
  chainId: chainIdSchema.optional().default('ethereum'),
});

/**
 * GET /api/wallet/balance
 * Get wallet balances for authenticated user
 */
router.get(
  '/balance',
  priceLimiter,
  validateQuery(chainQuerySchema),
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const { chainId } = req.query as { chainId: ChainId };

      const balance = await walletService.getBalance(
        authReq.walletAddress,
        chainId
      );

      res.json({
        success: true,
        data: {
          ...balance,
          tokens: balance.tokens.map((t) => ({
            ...t,
            balance: t.balance.toString(),
          })),
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      structuredLogger.error('wallet', 'Get balance failed', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch balance',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * GET /api/wallet/balance/all
 * Get wallet balances across all chains
 */
router.get('/balance/all', priceLimiter, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;

    const balances = await walletService.getAllBalances(authReq.walletAddress);

    res.json({
      success: true,
      data: {
        balances: balances.map((b) => ({
          ...b,
          tokens: b.tokens.map((t) => ({
            ...t,
            balance: t.balance.toString(),
          })),
        })),
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    structuredLogger.error('wallet', 'Get all balances failed', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch balances',
      timestamp: Date.now(),
    });
  }
});

/**
 * POST /api/wallet/balance/refresh
 * Refresh wallet balances
 */
router.post(
  '/balance/refresh',
  standardLimiter,
  validateQuery(chainQuerySchema),
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const { chainId } = req.query as { chainId: ChainId };

      const balance = await walletService.refreshBalances(
        authReq.walletAddress,
        chainId
      );

      res.json({
        success: true,
        data: {
          ...balance,
          tokens: balance.tokens.map((t) => ({
            ...t,
            balance: t.balance.toString(),
          })),
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      structuredLogger.error('wallet', 'Refresh balance failed', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to refresh balance',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * GET /api/wallet/price/:tokenAddress
 * Get token price
 */
router.get(
  '/price/:tokenAddress',
  priceLimiter,
  async (req, res) => {
    try {
      const { tokenAddress } = req.params;
      const { chainId = 'ethereum' } = req.query as { chainId?: ChainId };

      // Validate address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid token address',
          timestamp: Date.now(),
        });
      }

      const price = await priceOracleService.getBestPrice(
        chainId,
        tokenAddress as Address,
        BigInt('1000000000000000000') // 1 token
      );

      res.json({
        success: true,
        data: {
          ...price,
          priceInETH: price.priceInETH.toString(),
          liquidity: price.liquidity.toString(),
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      structuredLogger.error('wallet', 'Get price failed', error as Error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch price',
        timestamp: Date.now(),
      });
    }
  }
);

/**
 * GET /api/wallet/quote
 * Get swap quote
 */
router.get('/quote', priceLimiter, async (req, res) => {
  try {
    const { tokenIn, tokenOut, amountIn, chainId = 'ethereum' } = req.query as {
      tokenIn?: string;
      tokenOut?: string;
      amountIn?: string;
      chainId?: ChainId;
    };

    if (!tokenIn || !tokenOut || !amountIn) {
      return res.status(400).json({
        success: false,
        error: 'tokenIn, tokenOut, and amountIn are required',
        timestamp: Date.now(),
      });
    }

    // Validate addresses
    if (!/^0x[a-fA-F0-9]{40}$/.test(tokenIn) || !/^0x[a-fA-F0-9]{40}$/.test(tokenOut)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid token addresses',
        timestamp: Date.now(),
      });
    }

    const quote = await priceOracleService.getBestSwapRoute(
      chainId,
      tokenIn as Address,
      tokenOut as Address,
      BigInt(amountIn)
    );

    res.json({
      success: true,
      data: {
        ...quote,
        amountIn: quote.amountIn.toString(),
        amountOut: quote.amountOut.toString(),
        gasEstimate: quote.gasEstimate.toString(),
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    structuredLogger.error('wallet', 'Get quote failed', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch quote',
      timestamp: Date.now(),
    });
  }
});

/**
 * GET /api/wallet/eth-price
 * Get current ETH price in USD
 */
router.get('/eth-price', priceLimiter, async (req, res) => {
  try {
    const { chainId = 'ethereum' } = req.query as { chainId?: ChainId };

    const price = await priceOracleService.getEthPriceUSD(chainId);

    res.json({
      success: true,
      data: {
        chainId,
        priceUSD: price,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    structuredLogger.error('wallet', 'Get ETH price failed', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch ETH price',
      timestamp: Date.now(),
    });
  }
});

export default router;
