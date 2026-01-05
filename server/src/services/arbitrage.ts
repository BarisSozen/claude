/**
 * Arbitrage Service
 * Finds and executes cross-DEX arbitrage opportunities
 * With atomic execution, MEV protection, and optimal position sizing
 */

import {
  formatUnits,
  parseUnits,
  type Address,
} from 'viem';
import { priceOracleService } from './price-oracle.js';
import { tradeExecutorService } from './trade-executor.js';
import { mevProtectionService, type BundleTransaction } from './mev-protection.js';
import { positionSizingService } from './position-sizing.js';
import { gasEstimatorService } from './gas-estimator.js';
import { chainlinkOracleService } from './chainlink-oracle.js';
import { db, arbitrageOpportunities } from '../db/index.js';
import { eq, and, gt, lt } from 'drizzle-orm';
import { config } from '../config/env.js';
import { generateId } from './encryption.js';
import type {
  ChainId,
  ArbitrageOpportunity,
  ArbitrageType,
  ExecutionStep,
  TradeResult,
} from '../../shared/schema.js';
import { TOKEN_DECIMALS } from '../../shared/schema.js';

// Common trading pairs to scan
const TRADING_PAIRS: Array<{ tokenA: Address; tokenB: Address; name: string }> = [
  {
    tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address, // WETH
    tokenB: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address, // USDC
    name: 'WETH/USDC',
  },
  {
    tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address, // WETH
    tokenB: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address, // USDT
    name: 'WETH/USDT',
  },
  {
    tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address, // WETH
    tokenB: '0x6B175474E89094C44Da98b954EedeAC495271d0F' as Address, // DAI
    name: 'WETH/DAI',
  },
  {
    tokenA: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' as Address, // WBTC
    tokenB: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address, // WETH
    name: 'WBTC/WETH',
  },
];

// DEXes to compare
const DEXES = ['uniswap-v3-500', 'uniswap-v3-3000', 'uniswap-v3-10000', 'sushiswap'];

// Triangular arbitrage paths
const TRIANGULAR_PATHS: Array<{ tokenA: Address; tokenB: Address; tokenC: Address; name: string }> = [
  {
    tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address, // WETH
    tokenB: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address, // USDC
    tokenC: '0x6B175474E89094C44Da98b954EedeAC495271d0F' as Address, // DAI
    name: 'WETH/USDC/DAI',
  },
  {
    tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address, // WETH
    tokenB: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' as Address, // WBTC
    tokenC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address, // USDC
    name: 'WETH/WBTC/USDC',
  },
];

interface DexQuote {
  dex: string;
  amountOut: bigint;
  gasEstimate: bigint;
  timestamp: number;
}

interface ParallelQuoteResult {
  quotes: DexQuote[];
  maxTimestampDiff: number;
  isValid: boolean;
}

class ArbitrageService {
  private opportunities: Map<string, ArbitrageOpportunity> = new Map();
  private isScanning: boolean = false;
  private scanCallbacks: Set<(opp: ArbitrageOpportunity) => void> = new Set();

  // Configuration
  private maxSlippagePercent = 1.5; // 1.5% max slippage (reduced from 5%)
  private maxQuoteAgeSec = 2; // Quotes must be within 2 seconds
  private opportunityExpirySec = 12; // ~1 block (reduced from 30s)
  private minProfitMultiplier = 2; // Profit must be 2x gas cost

  /**
   * Get token decimals
   */
  private getTokenDecimals(tokenAddress: Address): number {
    return TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
  }

  /**
   * Fetch quotes from all DEXes in parallel with timestamp validation
   */
  private async getParallelQuotes(
    chainId: ChainId,
    tokenA: Address,
    tokenB: Address,
    amount: bigint
  ): Promise<ParallelQuoteResult> {
    const quotePromises = DEXES.map(async (dex): Promise<DexQuote | null> => {
      const timestamp = Date.now();
      try {
        let amountOut: bigint;

        if (dex.startsWith('uniswap-v3')) {
          const fee = parseInt(dex.split('-')[2], 10);
          amountOut = await priceOracleService.getUniswapV3Quote(
            chainId,
            tokenA,
            tokenB,
            amount,
            fee
          );
        } else if (dex === 'sushiswap') {
          amountOut = await priceOracleService.getSushiswapQuote(
            chainId,
            tokenA,
            tokenB,
            amount
          );
        } else {
          return null;
        }

        if (amountOut <= 0n) {
          return null;
        }

        // Get dynamic gas estimate
        const gasEstimate = await gasEstimatorService.estimateGas(
          chainId,
          dex.startsWith('uniswap-v3') ? 'uniswap-v3-swap' : 'sushiswap-swap'
        );

        return {
          dex,
          amountOut,
          gasEstimate: gasEstimate.gasLimit,
          timestamp,
        };
      } catch {
        return null;
      }
    });

    const results = await Promise.all(quotePromises);
    const quotes = results.filter((q): q is DexQuote => q !== null);

    if (quotes.length < 2) {
      return { quotes, maxTimestampDiff: 0, isValid: false };
    }

    // Calculate timestamp difference
    const timestamps = quotes.map(q => q.timestamp);
    const maxTimestampDiff = (Math.max(...timestamps) - Math.min(...timestamps)) / 1000;

    // Validate quotes are fresh enough
    const isValid = maxTimestampDiff <= this.maxQuoteAgeSec;

    return { quotes, maxTimestampDiff, isValid };
  }

  /**
   * Find cross-exchange arbitrage opportunities
   * Corrected logic: Buy low, sell high across exchanges
   */
  async findCrossExchangeArbitrage(
    chainId: ChainId,
    tokenA: Address,
    tokenB: Address,
    amount: bigint
  ): Promise<ArbitrageOpportunity | null> {
    // Get parallel quotes with timestamp validation
    const { quotes, isValid, maxTimestampDiff } = await this.getParallelQuotes(
      chainId,
      tokenA,
      tokenB,
      amount
    );

    if (!isValid || quotes.length < 2) {
      return null;
    }

    // Sort by output amount (descending)
    quotes.sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1));

    const bestOutput = quotes[0]; // Best rate for A->B
    const worstOutput = quotes[quotes.length - 1]; // Worst rate for A->B

    // For cross-exchange arb, we need to:
    // 1. Swap A->B on DEX with best rate (get most B)
    // 2. Swap B->A on DEX with worst rate (where B is worth more A)

    // Get reverse quotes (B->A) in parallel
    const reverseQuotePromises = DEXES.map(async (dex): Promise<DexQuote | null> => {
      const timestamp = Date.now();
      try {
        let amountOut: bigint;

        if (dex.startsWith('uniswap-v3')) {
          const fee = parseInt(dex.split('-')[2], 10);
          amountOut = await priceOracleService.getUniswapV3Quote(
            chainId,
            tokenB,
            tokenA,
            bestOutput.amountOut, // Use best output from first leg
            fee
          );
        } else if (dex === 'sushiswap') {
          amountOut = await priceOracleService.getSushiswapQuote(
            chainId,
            tokenB,
            tokenA,
            bestOutput.amountOut
          );
        } else {
          return null;
        }

        if (amountOut <= 0n) {
          return null;
        }

        const gasEstimate = await gasEstimatorService.estimateGas(
          chainId,
          dex.startsWith('uniswap-v3') ? 'uniswap-v3-swap' : 'sushiswap-swap'
        );

        return {
          dex,
          amountOut,
          gasEstimate: gasEstimate.gasLimit,
          timestamp,
        };
      } catch {
        return null;
      }
    });

    const reverseResults = await Promise.all(reverseQuotePromises);
    const reverseQuotes = reverseResults.filter((q): q is DexQuote => q !== null);

    if (reverseQuotes.length === 0) {
      return null;
    }

    // Find best reverse quote
    reverseQuotes.sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1));
    const bestReverse = reverseQuotes[0];

    // Calculate profit: final amount - initial amount
    const profitBigInt = bestReverse.amountOut > amount
      ? bestReverse.amountOut - amount
      : 0n;

    if (profitBigInt <= 0n) {
      return null;
    }

    // Validate against Chainlink price
    const priceValidation = await chainlinkOracleService.validatePrice(
      chainId,
      tokenA,
      Number(formatUnits(bestOutput.amountOut, this.getTokenDecimals(tokenB))) /
        Number(formatUnits(amount, this.getTokenDecimals(tokenA))),
      5 // 5% max deviation from Chainlink
    );

    if (!priceValidation.isValid) {
      console.warn(`Price manipulation detected: ${priceValidation.deviation.toFixed(2)}% deviation`);
      return null;
    }

    // Calculate gas cost with dynamic estimation
    const gasEstimate = await gasEstimatorService.estimateArbitrageCost(chainId, [
      'uniswap-v3-swap',
      'uniswap-v3-swap',
    ]);

    const tokenADecimals = this.getTokenDecimals(tokenA);
    const profitNormalized = Number(formatUnits(profitBigInt, tokenADecimals));

    // Get current ETH price for USD conversion
    const ethPrice = await chainlinkOracleService.getEthPrice(chainId);
    const profitUSD = profitNormalized * ethPrice;
    const gasEstimateUSD = gasEstimate.totalCostUSD;
    const netProfitUSD = profitUSD - gasEstimateUSD;

    // Ensure profit covers gas with buffer
    if (netProfitUSD < gasEstimateUSD * this.minProfitMultiplier) {
      return null;
    }

    const profitPercent = (profitNormalized / Number(formatUnits(amount, tokenADecimals))) * 100;

    // Calculate minimum output with slippage protection
    const minOutputLeg1 = this.calculateMinOutput(bestOutput.amountOut);
    const minOutputLeg2 = this.calculateMinOutput(bestReverse.amountOut);

    const opportunity: ArbitrageOpportunity = {
      id: generateId(),
      type: 'cross-exchange',
      tokenPair: `${tokenA}/${tokenB}`,
      buyDex: bestOutput.dex,
      sellDex: bestReverse.dex,
      buyPrice: bestOutput.amountOut,
      sellPrice: bestReverse.amountOut,
      profitUSD,
      profitPercent,
      requiredCapital: amount,
      gasEstimateUSD,
      netProfitUSD,
      expiresAt: new Date(Date.now() + this.opportunityExpirySec * 1000),
      executionPath: [
        {
          dex: bestOutput.dex,
          action: 'swap',
          tokenIn: tokenA,
          tokenOut: tokenB,
          amountIn: amount,
          expectedAmountOut: bestOutput.amountOut,
          minAmountOut: minOutputLeg1,
        },
        {
          dex: bestReverse.dex,
          action: 'swap',
          tokenIn: tokenB,
          tokenOut: tokenA,
          amountIn: bestOutput.amountOut,
          expectedAmountOut: bestReverse.amountOut,
          minAmountOut: minOutputLeg2,
        },
      ],
      metadata: {
        quoteTimestampDiff: maxTimestampDiff,
        chainlinkValidation: priceValidation,
        gasEstimateBreakdown: gasEstimate.breakdown,
      },
    };

    return opportunity;
  }

  /**
   * Find triangular arbitrage opportunities with parallel quotes
   */
  async findTriangularArbitrage(
    chainId: ChainId,
    tokenA: Address,
    tokenB: Address,
    tokenC: Address,
    amount: bigint
  ): Promise<ArbitrageOpportunity | null> {
    try {
      // Fetch all three legs in parallel with timestamps
      const timestamp = Date.now();

      const [quoteAB, quoteBC, quoteCA_placeholder] = await Promise.all([
        priceOracleService.getBestSwapRoute(chainId, tokenA, tokenB, amount),
        // For BC and CA, we need to estimate based on expected outputs
        // This is a simplification - in production use iterative refinement
        priceOracleService.getBestSwapRoute(chainId, tokenB, tokenC, amount), // Will re-query
        Promise.resolve(null), // Placeholder
      ]);

      const quoteFetchTime = Date.now() - timestamp;

      // If quotes took too long, prices may have moved
      if (quoteFetchTime > this.maxQuoteAgeSec * 1000) {
        return null;
      }

      // Get actual BC quote with AB output
      const actualQuoteBC = await priceOracleService.getBestSwapRoute(
        chainId,
        tokenB,
        tokenC,
        quoteAB.amountOut
      );

      // Get CA quote with BC output
      const quoteCA = await priceOracleService.getBestSwapRoute(
        chainId,
        tokenC,
        tokenA,
        actualQuoteBC.amountOut
      );

      const finalAmount = quoteCA.amountOut;
      const profitBigInt = finalAmount > amount ? finalAmount - amount : 0n;

      if (profitBigInt === 0n) {
        return null;
      }

      const tokenADecimals = this.getTokenDecimals(tokenA);
      const profitNormalized = Number(formatUnits(profitBigInt, tokenADecimals));

      // Get gas estimate for triangular arb (3 swaps)
      const gasEstimate = await gasEstimatorService.estimateArbitrageCost(chainId, [
        'uniswap-v3-swap',
        'uniswap-v3-swap',
        'uniswap-v3-swap',
      ]);

      // Get ETH price for USD conversion
      const ethPrice = await chainlinkOracleService.getEthPrice(chainId);
      const profitUSD = profitNormalized * ethPrice;
      const gasEstimateUSD = gasEstimate.totalCostUSD;
      const netProfitUSD = profitUSD - gasEstimateUSD;

      if (netProfitUSD < gasEstimateUSD * this.minProfitMultiplier) {
        return null;
      }

      const amountNormalized = Number(formatUnits(amount, tokenADecimals));
      const profitPercent = (profitNormalized / amountNormalized) * 100;

      const opportunity: ArbitrageOpportunity = {
        id: generateId(),
        type: 'triangular',
        tokenPair: `${tokenA}/${tokenB}/${tokenC}`,
        buyDex: quoteAB.route[0],
        sellDex: quoteCA.route[0],
        buyPrice: quoteAB.amountOut,
        sellPrice: quoteCA.amountOut,
        profitUSD,
        profitPercent,
        requiredCapital: amount,
        gasEstimateUSD,
        netProfitUSD,
        expiresAt: new Date(Date.now() + this.opportunityExpirySec * 1000),
        executionPath: [
          {
            dex: quoteAB.route[0],
            action: 'swap',
            tokenIn: tokenA,
            tokenOut: tokenB,
            amountIn: amount,
            expectedAmountOut: quoteAB.amountOut,
            minAmountOut: this.calculateMinOutput(quoteAB.amountOut),
          },
          {
            dex: actualQuoteBC.route[0],
            action: 'swap',
            tokenIn: tokenB,
            tokenOut: tokenC,
            amountIn: quoteAB.amountOut,
            expectedAmountOut: actualQuoteBC.amountOut,
            minAmountOut: this.calculateMinOutput(actualQuoteBC.amountOut),
          },
          {
            dex: quoteCA.route[0],
            action: 'swap',
            tokenIn: tokenC,
            tokenOut: tokenA,
            amountIn: actualQuoteBC.amountOut,
            expectedAmountOut: quoteCA.amountOut,
            minAmountOut: this.calculateMinOutput(quoteCA.amountOut),
          },
        ],
        metadata: {
          quoteFetchTimeMs: quoteFetchTime,
          gasEstimateBreakdown: gasEstimate.breakdown,
        },
      };

      return opportunity;
    } catch (error) {
      console.error('Triangular arbitrage scan failed:', error);
      return null;
    }
  }

  /**
   * Calculate minimum output with slippage protection
   */
  private calculateMinOutput(expectedOutput: bigint): bigint {
    const slippageBps = BigInt(Math.floor(this.maxSlippagePercent * 100));
    return (expectedOutput * (10000n - slippageBps)) / 10000n;
  }

  /**
   * Scan for all arbitrage opportunities with optimal position sizing
   */
  async scanForOpportunities(
    chainId: ChainId = 'ethereum',
    availableCapitalWei?: bigint
  ): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];

    // Scan cross-exchange opportunities
    for (const pair of TRADING_PAIRS) {
      // Use position sizing service for optimal trade size
      const amount = availableCapitalWei
        ? positionSizingService.getQuickSize('cross-exchange', availableCapitalWei)
        : parseUnits('1', 18); // Default 1 ETH if no capital specified

      try {
        const opp = await this.findCrossExchangeArbitrage(
          chainId,
          pair.tokenA,
          pair.tokenB,
          amount
        );

        if (opp) {
          opportunities.push(opp);
          this.opportunities.set(opp.id, opp);
          this.notifyOpportunity(opp);
        }
      } catch (error) {
        console.error(`Cross-exchange scan failed for ${pair.name}:`, error);
      }
    }

    // Scan triangular opportunities
    for (const path of TRIANGULAR_PATHS) {
      const amount = availableCapitalWei
        ? positionSizingService.getQuickSize('triangular', availableCapitalWei)
        : parseUnits('1', 18);

      try {
        const opp = await this.findTriangularArbitrage(
          chainId,
          path.tokenA,
          path.tokenB,
          path.tokenC,
          amount
        );

        if (opp) {
          opportunities.push(opp);
          this.opportunities.set(opp.id, opp);
          this.notifyOpportunity(opp);
        }
      } catch (error) {
        console.error(`Triangular scan failed for ${path.name}:`, error);
      }
    }

    return opportunities;
  }

  /**
   * Get current opportunities
   */
  getOpportunities(): ArbitrageOpportunity[] {
    const now = new Date();
    const valid: ArbitrageOpportunity[] = [];

    for (const [id, opp] of this.opportunities) {
      if (opp.expiresAt > now) {
        valid.push(opp);
      } else {
        this.opportunities.delete(id);
      }
    }

    return valid.sort((a, b) => b.netProfitUSD - a.netProfitUSD);
  }

  /**
   * Get opportunity by ID
   */
  getOpportunity(id: string): ArbitrageOpportunity | undefined {
    const opp = this.opportunities.get(id);

    if (opp && opp.expiresAt > new Date()) {
      return opp;
    }

    return undefined;
  }

  /**
   * Execute an arbitrage opportunity atomically via Flashbots
   */
  async executeOpportunity(
    delegationId: string,
    opportunityId: string
  ): Promise<TradeResult> {
    const opportunity = this.getOpportunity(opportunityId);

    if (!opportunity) {
      return { success: false, error: 'Opportunity not found or expired' };
    }

    // Remove from available opportunities
    this.opportunities.delete(opportunityId);

    // Record opportunity as being executed
    await db.insert(arbitrageOpportunities).values({
      type: opportunity.type,
      tokenPair: opportunity.tokenPair,
      buyDex: opportunity.buyDex,
      sellDex: opportunity.sellDex,
      buyPrice: opportunity.buyPrice.toString(),
      sellPrice: opportunity.sellPrice.toString(),
      profitUsd: opportunity.profitUSD.toString(),
      profitPercent: opportunity.profitPercent.toString(),
      requiredCapital: opportunity.requiredCapital.toString(),
      gasEstimateUsd: opportunity.gasEstimateUSD.toString(),
      netProfitUsd: opportunity.netProfitUSD.toString(),
      executionPath: opportunity.executionPath,
      status: 'pending',
      expiresAt: opportunity.expiresAt,
    });

    // Check if MEV protection is configured
    if (mevProtectionService.isConfigured()) {
      return this.executeViaFlashbots(delegationId, opportunity);
    } else {
      // Fallback to sequential execution (not recommended for production)
      return this.executeSequentially(delegationId, opportunity);
    }
  }

  /**
   * Execute opportunity via Flashbots bundle (atomic)
   */
  private async executeViaFlashbots(
    delegationId: string,
    opportunity: ArbitrageOpportunity
  ): Promise<TradeResult> {
    try {
      // Build transaction bundle
      const transactions: BundleTransaction[] = [];

      for (const step of opportunity.executionPath) {
        // Build swap transaction
        const tx = await tradeExecutorService.buildSwapTransaction(
          delegationId,
          step.tokenIn,
          step.tokenOut,
          step.amountIn,
          step.minAmountOut ?? this.calculateMinOutput(step.expectedAmountOut),
          step.dex
        );

        if (!tx.success || !tx.transaction) {
          return { success: false, error: `Failed to build transaction for step: ${tx.error}` };
        }

        transactions.push(tx.transaction);
      }

      // Get optimal gas params based on expected profit
      const gasParams = await gasEstimatorService.getMevGasParams(
        'ethereum',
        opportunity.requiredCapital * BigInt(Math.floor(opportunity.profitPercent * 100)) / 10000n,
        400000n // Estimated total gas
      );

      // Apply gas params to transactions
      for (const tx of transactions) {
        tx.maxPriorityFeePerGas = gasParams.maxPriorityFeePerGas;
        tx.maxFeePerGas = gasParams.maxFeePerGas;
      }

      // Get current block
      const currentBlock = await tradeExecutorService.getCurrentBlock('ethereum');

      // Submit bundle targeting next block
      const result = await mevProtectionService.submitBundle({
        transactions,
        targetBlock: currentBlock + 1n,
        maxTimestamp: Math.floor(Date.now() / 1000) + 120, // 2 minute deadline
      });

      if (!result.success) {
        // Record trade result for position sizing
        positionSizingService.recordTrade({
          timestamp: new Date(),
          profitUSD: -opportunity.gasEstimateUSD,
          gasSpentUSD: opportunity.gasEstimateUSD,
          success: false,
          strategyType: opportunity.type,
        });

        return { success: false, error: result.error };
      }

      // Record successful trade
      positionSizingService.recordTrade({
        timestamp: new Date(),
        profitUSD: opportunity.netProfitUSD,
        gasSpentUSD: opportunity.gasEstimateUSD,
        success: true,
        strategyType: opportunity.type,
      });

      return {
        success: true,
        bundleHash: result.bundleHash,
        simulationResult: result.simulationResult,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Flashbots execution failed',
      };
    }
  }

  /**
   * Execute opportunity sequentially (fallback, not recommended)
   */
  private async executeSequentially(
    delegationId: string,
    opportunity: ArbitrageOpportunity
  ): Promise<TradeResult> {
    console.warn('Executing without MEV protection - vulnerable to sandwich attacks');

    for (const step of opportunity.executionPath) {
      const result = await tradeExecutorService.executeUniswapV3Swap(
        delegationId,
        step.tokenIn,
        step.tokenOut,
        step.amountIn,
        step.minAmountOut ?? this.calculateMinOutput(step.expectedAmountOut),
        3000 // Default to 0.3% fee
      );

      if (!result.success) {
        positionSizingService.recordTrade({
          timestamp: new Date(),
          profitUSD: -opportunity.gasEstimateUSD,
          gasSpentUSD: opportunity.gasEstimateUSD,
          success: false,
          strategyType: opportunity.type,
        });

        return result;
      }
    }

    positionSizingService.recordTrade({
      timestamp: new Date(),
      profitUSD: opportunity.netProfitUSD,
      gasSpentUSD: opportunity.gasEstimateUSD,
      success: true,
      strategyType: opportunity.type,
    });

    return { success: true };
  }

  /**
   * Subscribe to new opportunities
   */
  onOpportunityFound(callback: (opp: ArbitrageOpportunity) => void): () => void {
    this.scanCallbacks.add(callback);
    return () => this.scanCallbacks.delete(callback);
  }

  /**
   * Notify subscribers of new opportunity
   */
  private notifyOpportunity(opp: ArbitrageOpportunity): void {
    for (const callback of this.scanCallbacks) {
      try {
        callback(opp);
      } catch (error) {
        console.error('Opportunity callback error:', error);
      }
    }
  }

  /**
   * Clear expired opportunities
   */
  cleanupExpired(): void {
    const now = new Date();

    for (const [id, opp] of this.opportunities) {
      if (opp.expiresAt <= now) {
        this.opportunities.delete(id);
      }
    }
  }

  /**
   * Update configuration
   */
  updateConfig(params: {
    maxSlippagePercent?: number;
    maxQuoteAgeSec?: number;
    opportunityExpirySec?: number;
    minProfitMultiplier?: number;
  }): void {
    if (params.maxSlippagePercent !== undefined) {
      this.maxSlippagePercent = Math.max(0.1, Math.min(5, params.maxSlippagePercent));
    }
    if (params.maxQuoteAgeSec !== undefined) {
      this.maxQuoteAgeSec = Math.max(1, Math.min(10, params.maxQuoteAgeSec));
    }
    if (params.opportunityExpirySec !== undefined) {
      this.opportunityExpirySec = Math.max(5, Math.min(60, params.opportunityExpirySec));
    }
    if (params.minProfitMultiplier !== undefined) {
      this.minProfitMultiplier = Math.max(1.5, Math.min(5, params.minProfitMultiplier));
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): {
    maxSlippagePercent: number;
    maxQuoteAgeSec: number;
    opportunityExpirySec: number;
    minProfitMultiplier: number;
  } {
    return {
      maxSlippagePercent: this.maxSlippagePercent,
      maxQuoteAgeSec: this.maxQuoteAgeSec,
      opportunityExpirySec: this.opportunityExpirySec,
      minProfitMultiplier: this.minProfitMultiplier,
    };
  }
}

export const arbitrageService = new ArbitrageService();
