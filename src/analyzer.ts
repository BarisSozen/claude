/**
 * Liquidity Depth Analyzer
 * Core analyzer for DEX liquidity, slippage estimation, and trade execution decisions
 */

import {
  AbortReason,
  AnalyzerConfig,
  DEFAULT_CONFIG,
  LiquidityDepth,
  PoolAdapter,
  PoolReserves,
  RouteAnalysis,
  RouteSegment,
  SlippageAnalysis,
  Token,
  TradeAnalysis,
} from './types';

import { Config } from './config';

import {
  calculatePriceImpactBps,
  calculateMinOutput,
  calculateEffectivePrice,
  calculateDepthMultiplier,
  isDataStale,
  estimateConfidence,
} from './utils';

/**
 * LiquidityDepthAnalyzer
 *
 * Analyzes DEX liquidity depth, estimates slippage, and determines
 * whether trades should execute based on configurable thresholds.
 *
 * Core Principle: Never execute without knowing:
 * 1. How much liquidity exists
 * 2. How far price will move
 * 3. Whether profit survives slippage
 */
export class LiquidityDepthAnalyzer {
  private config: Config;
  private adapters: Map<string, PoolAdapter> = new Map();

  constructor(config?: Partial<AnalyzerConfig>) {
    this.config = new Config(config);
  }

  /**
   * Register a pool adapter for a specific pool type or address
   */
  registerAdapter(identifier: string, adapter: PoolAdapter): void {
    this.adapters.set(identifier.toLowerCase(), adapter);
  }

  /**
   * Get adapter for a pool
   */
  getAdapter(identifier: string): PoolAdapter | undefined {
    return this.adapters.get(identifier.toLowerCase());
  }

  /**
   * Update analyzer configuration
   */
  updateConfig(overrides: Partial<AnalyzerConfig>): void {
    this.config.update(overrides);
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<AnalyzerConfig> {
    return this.config.getConfig();
  }

  /**
   * Analyze a single-pool trade
   */
  async analyzeTrade(params: {
    poolAddress: string;
    adapterKey: string;
    tokenIn: Token;
    tokenOut: Token;
    amountIn: bigint;
    expectedProfit?: bigint;
  }): Promise<TradeAnalysis> {
    const { poolAddress, adapterKey, tokenIn, tokenOut, amountIn, expectedProfit } = params;

    const adapter = this.getAdapter(adapterKey);
    if (!adapter) {
      return this.createAbortResult(
        AbortReason.NO_POOL,
        `No adapter registered for: ${adapterKey}`
      );
    }

    // Get pool reserves
    let reserves: PoolReserves;
    try {
      reserves = await adapter.getReserves(poolAddress);
    } catch {
      return this.createAbortResult(
        AbortReason.NO_POOL,
        `Failed to fetch reserves for pool: ${poolAddress}`
      );
    }

    // Check data freshness
    if (isDataStale(reserves.timestamp, this.config.maxDataAgeSec)) {
      return this.createAbortResult(
        AbortReason.STALE_DATA,
        `Pool data is ${Math.floor(Date.now() / 1000) - reserves.timestamp}s old, max allowed: ${this.config.maxDataAgeSec}s`
      );
    }

    // Calculate liquidity depth
    const isToken0In = tokenIn.address.toLowerCase() === reserves.token0.address.toLowerCase();
    const liquidityDepth = isToken0In ? reserves.reserve1 : reserves.reserve0;

    // Check minimum depth
    const depthMultiplier = calculateDepthMultiplier(liquidityDepth, amountIn);
    if (depthMultiplier < this.config.minDepthMultiplier) {
      return this.createAbortResult(
        AbortReason.LOW_DEPTH,
        `Depth multiplier ${depthMultiplier.toFixed(2)}x < required ${this.config.minDepthMultiplier}x`
      );
    }

    // Get spot price and expected output
    const spotPrice = await adapter.getSpotPrice(tokenIn.address, tokenOut.address, poolAddress);
    const expectedOutput = await adapter.getAmountOut(amountIn, tokenIn.address, tokenOut.address, poolAddress);

    if (expectedOutput === 0n) {
      return this.createAbortResult(
        AbortReason.INSUFFICIENT_OUTPUT,
        'Expected output is zero'
      );
    }

    // Calculate price impact
    const priceImpactBps = calculatePriceImpactBps(
      amountIn,
      expectedOutput,
      spotPrice,
      tokenIn.decimals,
      tokenOut.decimals
    );

    if (priceImpactBps > this.config.maxPriceImpactBps) {
      return this.createAbortResult(
        AbortReason.HIGH_PRICE_IMPACT,
        `Price impact ${priceImpactBps}bps > max ${this.config.maxPriceImpactBps}bps`
      );
    }

    // Calculate slippage analysis
    const slippageAnalysis = this.calculateSlippageAnalysis(
      amountIn,
      expectedOutput,
      spotPrice,
      priceImpactBps,
      tokenIn.decimals,
      tokenOut.decimals
    );

    // Check if slippage is acceptable
    if (slippageAnalysis.slippageBps > this.config.maxSlippageBps) {
      return this.createAbortResult(
        AbortReason.HIGH_PRICE_IMPACT,
        `Slippage ${slippageAnalysis.slippageBps}bps > max ${this.config.maxSlippageBps}bps`
      );
    }

    // Check profit threshold for MEV trades
    let estimatedProfit: bigint | undefined;
    if (expectedProfit !== undefined) {
      const profitAfterImpact = expectedProfit - (expectedProfit * BigInt(priceImpactBps) / 10000n);
      estimatedProfit = profitAfterImpact;

      const profitBps = Number(expectedProfit * 10000n / amountIn);
      const netProfitBps = profitBps - priceImpactBps;

      if (netProfitBps < this.config.minProfitBps) {
        return this.createAbortResult(
          AbortReason.LOW_PROFIT,
          `Net profit ${netProfitBps}bps < min ${this.config.minProfitBps}bps after slippage`
        );
      }
    }

    // Calculate effective price
    const effectivePrice = calculateEffectivePrice(
      amountIn,
      expectedOutput,
      tokenIn.decimals,
      tokenOut.decimals
    );

    // Calculate confidence score
    const dataAgeSec = Math.floor(Date.now() / 1000) - reserves.timestamp;
    const confidence = estimateConfidence({
      depthMultiplier,
      priceImpactBps,
      dataAgeSec,
      maxDataAgeSec: this.config.maxDataAgeSec,
    });

    return {
      shouldExecute: true,
      slippage: slippageAnalysis,
      liquidityDepth,
      depthMultiplier,
      effectivePrice,
      spotPrice,
      estimatedProfit,
      confidence,
    };
  }

  /**
   * Analyze a multi-hop route
   */
  async analyzeRoute(params: {
    segments: RouteSegment[];
    adapterKeys: string[];
    amountIn: bigint;
    expectedProfit?: bigint;
  }): Promise<RouteAnalysis> {
    const { segments, adapterKeys, amountIn } = params;

    if (segments.length === 0) {
      return {
        segments: [],
        totalPriceImpactBps: 0,
        totalSlippageBps: 0,
        expectedOutput: 0n,
        minOutput: 0n,
        shouldExecute: false,
        abortReason: AbortReason.NO_POOL,
      };
    }

    let currentAmount = amountIn;
    let totalPriceImpactBps = 0;
    let totalSlippageBps = 0;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const adapterKey = adapterKeys[i];

      const adapter = this.getAdapter(adapterKey);
      if (!adapter) {
        return {
          segments,
          totalPriceImpactBps,
          totalSlippageBps,
          expectedOutput: 0n,
          minOutput: 0n,
          shouldExecute: false,
          abortReason: AbortReason.NO_POOL,
        };
      }

      const spotPrice = await adapter.getSpotPrice(
        segment.tokenIn.address,
        segment.tokenOut.address,
        segment.poolAddress
      );

      const output = await adapter.getAmountOut(
        currentAmount,
        segment.tokenIn.address,
        segment.tokenOut.address,
        segment.poolAddress
      );

      if (output === 0n) {
        return {
          segments,
          totalPriceImpactBps,
          totalSlippageBps,
          expectedOutput: 0n,
          minOutput: 0n,
          shouldExecute: false,
          abortReason: AbortReason.INSUFFICIENT_OUTPUT,
        };
      }

      const priceImpact = calculatePriceImpactBps(
        currentAmount,
        output,
        spotPrice,
        segment.tokenIn.decimals,
        segment.tokenOut.decimals
      );

      totalPriceImpactBps += priceImpact;
      totalSlippageBps += priceImpact; // Slippage accumulates similar to impact in multi-hop

      currentAmount = output;
    }

    // Check total impact
    if (totalPriceImpactBps > this.config.maxPriceImpactBps * segments.length) {
      return {
        segments,
        totalPriceImpactBps,
        totalSlippageBps,
        expectedOutput: currentAmount,
        minOutput: calculateMinOutput(currentAmount, this.config.maxSlippageBps),
        shouldExecute: false,
        abortReason: AbortReason.HIGH_PRICE_IMPACT,
      };
    }

    return {
      segments,
      totalPriceImpactBps,
      totalSlippageBps,
      expectedOutput: currentAmount,
      minOutput: calculateMinOutput(currentAmount, this.config.maxSlippageBps),
      shouldExecute: true,
    };
  }

  /**
   * Quick check if a trade is viable without full analysis
   */
  async quickViabilityCheck(params: {
    poolAddress: string;
    adapterKey: string;
    tradeSize: bigint;
  }): Promise<{ viable: boolean; reason?: string }> {
    const { poolAddress, adapterKey, tradeSize } = params;

    const adapter = this.getAdapter(adapterKey);
    if (!adapter) {
      return { viable: false, reason: 'No adapter available' };
    }

    try {
      const reserves = await adapter.getReserves(poolAddress);
      const minReserve = reserves.reserve0 < reserves.reserve1 ? reserves.reserve0 : reserves.reserve1;
      const depthMultiplier = calculateDepthMultiplier(minReserve, tradeSize);

      if (depthMultiplier < this.config.minDepthMultiplier) {
        return { viable: false, reason: `Insufficient depth: ${depthMultiplier.toFixed(2)}x` };
      }

      if (isDataStale(reserves.timestamp, this.config.maxDataAgeSec)) {
        return { viable: false, reason: 'Stale pool data' };
      }

      return { viable: true };
    } catch {
      return { viable: false, reason: 'Failed to fetch pool data' };
    }
  }

  /**
   * Calculate slippage analysis for a trade
   */
  private calculateSlippageAnalysis(
    amountIn: bigint,
    expectedOutput: bigint,
    spotPrice: number,
    priceImpactBps: number,
    decimalsIn: number,
    decimalsOut: number
  ): SlippageAnalysis {
    // Calculate theoretical output at spot price
    const normalizedIn = Number(amountIn) / Math.pow(10, decimalsIn);
    const theoreticalOutput = BigInt(
      Math.floor(normalizedIn / spotPrice * Math.pow(10, decimalsOut))
    );

    // Slippage from theoretical
    const slippageBps = theoreticalOutput > 0n
      ? Number((theoreticalOutput - expectedOutput) * 10000n / theoreticalOutput)
      : priceImpactBps;

    // Minimum output with tolerance
    const minOutput = calculateMinOutput(expectedOutput, this.config.maxSlippageBps);

    return {
      expectedOutput: theoreticalOutput,
      minOutput,
      estimatedOutput: expectedOutput,
      priceImpactBps,
      slippageBps: Math.max(0, slippageBps),
    };
  }

  /**
   * Create an abort result
   */
  private createAbortResult(reason: AbortReason, message: string): TradeAnalysis {
    return {
      shouldExecute: false,
      abortReason: reason,
      abortMessage: message,
      slippage: {
        expectedOutput: 0n,
        minOutput: 0n,
        estimatedOutput: 0n,
        priceImpactBps: 0,
        slippageBps: 0,
      },
      liquidityDepth: 0n,
      depthMultiplier: 0,
      effectivePrice: 0,
      spotPrice: 0,
      confidence: 0,
    };
  }

  /**
   * Get liquidity depth analysis for a pool
   */
  async getLiquidityDepthAnalysis(params: {
    poolAddress: string;
    adapterKey: string;
    tokenIn: string;
    tokenOut: string;
    priceLevels?: number[];
  }): Promise<LiquidityDepth[]> {
    const { poolAddress, adapterKey, tokenIn, tokenOut } = params;

    const adapter = this.getAdapter(adapterKey);
    if (!adapter) {
      return [];
    }

    const spotPrice = await adapter.getSpotPrice(tokenIn, tokenOut, poolAddress);

    // Default price levels: ±0.5%, ±1%, ±2%, ±5%
    const priceLevels = params.priceLevels ?? [
      spotPrice * 0.995,
      spotPrice * 0.99,
      spotPrice * 0.98,
      spotPrice * 0.95,
      spotPrice * 1.005,
      spotPrice * 1.01,
      spotPrice * 1.02,
      spotPrice * 1.05,
    ].sort((a, b) => a - b);

    return adapter.getLiquidityDepth(tokenIn, tokenOut, poolAddress, priceLevels);
  }
}

export default LiquidityDepthAnalyzer;
