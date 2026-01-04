/**
 * Arbitrage Service
 * Finds and executes cross-DEX arbitrage opportunities
 */

import {
  formatUnits,
  parseUnits,
  type Address,
} from 'viem';
import { priceOracleService } from './price-oracle.js';
import { tradeExecutorService } from './trade-executor.js';
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

interface DexQuote {
  dex: string;
  amountOut: bigint;
  gasEstimate: bigint;
}

class ArbitrageService {
  private opportunities: Map<string, ArbitrageOpportunity> = new Map();
  private isScanning: boolean = false;
  private scanCallbacks: Set<(opp: ArbitrageOpportunity) => void> = new Set();

  /**
   * Get token decimals
   */
  private getTokenDecimals(tokenAddress: Address): number {
    return TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
  }

  /**
   * Find cross-exchange arbitrage opportunities
   */
  async findCrossExchangeArbitrage(
    chainId: ChainId,
    tokenA: Address,
    tokenB: Address,
    amount: bigint
  ): Promise<ArbitrageOpportunity | null> {
    const quotes: DexQuote[] = [];

    // Get quotes from each DEX
    for (const dex of DEXES) {
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
          continue;
        }

        if (amountOut > 0n) {
          quotes.push({
            dex,
            amountOut,
            gasEstimate: dex.startsWith('uniswap-v3') ? 150000n : 120000n,
          });
        }
      } catch (error) {
        // Skip failed quotes
        continue;
      }
    }

    if (quotes.length < 2) {
      return null;
    }

    // Sort by output amount
    quotes.sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1));

    const bestBuy = quotes[0]; // Highest output (best buy)
    const worstBuy = quotes[quotes.length - 1]; // Lowest output (worst buy)

    // Calculate profit opportunity
    // Buy on worst DEX (lower price), sell on best DEX (higher price)
    const profitBigInt = bestBuy.amountOut - worstBuy.amountOut;

    if (profitBigInt <= 0n) {
      return null;
    }

    // Convert to USD
    const tokenBDecimals = this.getTokenDecimals(tokenB);
    const profitNormalized = Number(formatUnits(profitBigInt, tokenBDecimals));

    // Estimate gas cost in USD
    const gasEstimate = bestBuy.gasEstimate + worstBuy.gasEstimate;
    const gasEstimateUSD = config.gas.mainnetEstimateUsd * 2; // Two swaps

    const netProfitUSD = profitNormalized - gasEstimateUSD;

    // Only return if profitable after gas
    if (netProfitUSD < config.executor.minProfitUsd) {
      return null;
    }

    const tokenADecimals = this.getTokenDecimals(tokenA);
    const requiredCapital = amount;
    const profitPercent = (profitNormalized / Number(formatUnits(amount, tokenADecimals))) * 100;

    const opportunity: ArbitrageOpportunity = {
      id: generateId(),
      type: 'cross-exchange',
      tokenPair: `${tokenA}/${tokenB}`,
      buyDex: worstBuy.dex,
      sellDex: bestBuy.dex,
      buyPrice: worstBuy.amountOut,
      sellPrice: bestBuy.amountOut,
      profitUSD: profitNormalized,
      profitPercent,
      requiredCapital,
      gasEstimateUSD,
      netProfitUSD,
      expiresAt: new Date(Date.now() + 30000), // 30 second expiry
      executionPath: [
        {
          dex: worstBuy.dex,
          action: 'buy',
          tokenIn: tokenA,
          tokenOut: tokenB,
          amountIn: amount,
          expectedAmountOut: worstBuy.amountOut,
        },
        {
          dex: bestBuy.dex,
          action: 'sell',
          tokenIn: tokenB,
          tokenOut: tokenA,
          amountIn: worstBuy.amountOut,
          expectedAmountOut: amount + profitBigInt,
        },
      ],
    };

    return opportunity;
  }

  /**
   * Find triangular arbitrage opportunities
   */
  async findTriangularArbitrage(
    chainId: ChainId,
    tokenA: Address,
    tokenB: Address,
    tokenC: Address,
    amount: bigint
  ): Promise<ArbitrageOpportunity | null> {
    try {
      // A -> B -> C -> A
      const quoteAB = await priceOracleService.getBestSwapRoute(chainId, tokenA, tokenB, amount);
      const quoteBC = await priceOracleService.getBestSwapRoute(chainId, tokenB, tokenC, quoteAB.amountOut);
      const quoteCA = await priceOracleService.getBestSwapRoute(chainId, tokenC, tokenA, quoteBC.amountOut);

      const finalAmount = quoteCA.amountOut;
      const profitBigInt = finalAmount > amount ? finalAmount - amount : 0n;

      if (profitBigInt === 0n) {
        return null;
      }

      const tokenADecimals = this.getTokenDecimals(tokenA);
      const profitNormalized = Number(formatUnits(profitBigInt, tokenADecimals));

      // Estimate gas for three swaps
      const gasEstimateUSD = config.gas.mainnetEstimateUsd * 3;
      const netProfitUSD = profitNormalized * config.prices.ethUsd - gasEstimateUSD;

      if (netProfitUSD < config.executor.minProfitUsd) {
        return null;
      }

      // Use formatUnits to avoid BigInt to Number precision loss
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
        profitUSD: netProfitUSD,
        profitPercent,
        requiredCapital: amount,
        gasEstimateUSD,
        netProfitUSD,
        expiresAt: new Date(Date.now() + 30000),
        executionPath: [
          {
            dex: quoteAB.route[0],
            action: 'swap',
            tokenIn: tokenA,
            tokenOut: tokenB,
            amountIn: amount,
            expectedAmountOut: quoteAB.amountOut,
          },
          {
            dex: quoteBC.route[0],
            action: 'swap',
            tokenIn: tokenB,
            tokenOut: tokenC,
            amountIn: quoteAB.amountOut,
            expectedAmountOut: quoteBC.amountOut,
          },
          {
            dex: quoteCA.route[0],
            action: 'swap',
            tokenIn: tokenC,
            tokenOut: tokenA,
            amountIn: quoteBC.amountOut,
            expectedAmountOut: quoteCA.amountOut,
          },
        ],
      };

      return opportunity;
    } catch (error) {
      console.error('Triangular arbitrage scan failed:', error);
      return null;
    }
  }

  /**
   * Scan for all arbitrage opportunities
   */
  async scanForOpportunities(chainId: ChainId = 'ethereum'): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];

    // Scan common trading pairs
    for (const pair of TRADING_PAIRS) {
      // Scan with 1 ETH equivalent
      const amount = parseUnits('1', 18);

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
        console.error(`Scan failed for ${pair.name}:`, error);
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
   * Execute an arbitrage opportunity
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

    // Execute each step
    // Note: In production, this should be done atomically using flash loans
    // or bundled transactions
    for (const step of opportunity.executionPath) {
      const result = await tradeExecutorService.executeUniswapV3Swap(
        delegationId,
        step.tokenIn,
        step.tokenOut,
        step.amountIn,
        (step.expectedAmountOut * 99n) / 100n, // 1% slippage tolerance
        3000 // Default to 0.3% fee
      );

      if (!result.success) {
        return result;
      }
    }

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
}

export const arbitrageService = new ArbitrageService();
