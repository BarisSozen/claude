/**
 * Position Sizing Service
 * Implements Kelly Criterion and risk-adjusted position sizing
 * for optimal capital allocation in DeFi arbitrage
 */

import { formatUnits, parseUnits, type Address } from 'viem';
import { config } from '../config/env.js';

interface TradeHistory {
  timestamp: Date;
  profitUSD: number;
  gasSpentUSD: number;
  success: boolean;
  strategyType: string;
}

interface PositionSizeResult {
  optimalSizeUSD: number;
  optimalSizeWei: bigint;
  kellyFraction: number;
  adjustedKelly: number;
  confidence: number;
  reasoning: string[];
}

interface StrategyStats {
  winRate: number;
  avgWin: number;
  avgLoss: number;
  winLossRatio: number;
  sharpeRatio: number;
  maxDrawdown: number;
  totalTrades: number;
}

class PositionSizingService {
  private tradeHistory: TradeHistory[] = [];
  private maxHistorySize = 1000;
  private minTradesForStats = 20;

  // Kelly fraction multiplier (use fractional Kelly for safety)
  // 0.25 = quarter Kelly, industry standard for volatile markets
  private kellyMultiplier = 0.25;

  // Maximum position size as % of available capital
  private maxPositionPercent = 0.05; // 5% max per trade

  // Minimum position size in USD
  private minPositionUSD = 100;

  // Maximum position size in USD
  private maxPositionUSD = 10000;

  /**
   * Record a trade result for position sizing calculations
   */
  recordTrade(trade: TradeHistory): void {
    this.tradeHistory.push(trade);

    // Trim history if too large
    if (this.tradeHistory.length > this.maxHistorySize) {
      this.tradeHistory = this.tradeHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Calculate Kelly Criterion fraction
   * Kelly = (p * b - q) / b
   * where:
   *   p = probability of winning
   *   q = probability of losing (1 - p)
   *   b = win/loss ratio (avg win / avg loss)
   */
  calculateKellyFraction(stats: StrategyStats): number {
    const { winRate, winLossRatio } = stats;

    if (winLossRatio <= 0 || winRate <= 0) {
      return 0;
    }

    const p = winRate;
    const q = 1 - p;
    const b = winLossRatio;

    // Kelly formula
    const kelly = (p * b - q) / b;

    // Clamp to reasonable range
    return Math.max(0, Math.min(1, kelly));
  }

  /**
   * Calculate half-life of mean reversion for strategy timing
   * Uses exponential decay model
   */
  calculateHalfLife(returns: number[]): number {
    if (returns.length < 10) {
      return Infinity; // Not enough data
    }

    // Simple autocorrelation-based estimate
    let sumXY = 0;
    let sumX2 = 0;

    for (let i = 1; i < returns.length; i++) {
      sumXY += returns[i - 1] * returns[i];
      sumX2 += returns[i - 1] * returns[i - 1];
    }

    const lambda = sumX2 !== 0 ? sumXY / sumX2 : 0;

    if (lambda <= 0 || lambda >= 1) {
      return Infinity;
    }

    // Half-life = -ln(2) / ln(lambda)
    return -Math.log(2) / Math.log(lambda);
  }

  /**
   * Calculate Sharpe Ratio (annualized)
   * Sharpe = sqrt(252) * mean(returns) / std(returns)
   */
  calculateSharpeRatio(returns: number[]): number {
    if (returns.length < 2) {
      return 0;
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const std = Math.sqrt(variance);

    if (std === 0) {
      return mean > 0 ? Infinity : 0;
    }

    // Annualize assuming ~4 trades per hour, 24 hours, 365 days
    const annualizationFactor = Math.sqrt(4 * 24 * 365);

    return annualizationFactor * mean / std;
  }

  /**
   * Get strategy statistics from trade history
   */
  getStrategyStats(strategyType?: string): StrategyStats {
    const trades = strategyType
      ? this.tradeHistory.filter(t => t.strategyType === strategyType)
      : this.tradeHistory;

    if (trades.length === 0) {
      return {
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        winLossRatio: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        totalTrades: 0,
      };
    }

    const wins = trades.filter(t => t.profitUSD > 0);
    const losses = trades.filter(t => t.profitUSD <= 0);

    const winRate = trades.length > 0 ? wins.length / trades.length : 0;

    const avgWin = wins.length > 0
      ? wins.reduce((sum, t) => sum + t.profitUSD, 0) / wins.length
      : 0;

    const avgLoss = losses.length > 0
      ? Math.abs(losses.reduce((sum, t) => sum + t.profitUSD, 0) / losses.length)
      : 1; // Avoid division by zero

    const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

    // Calculate returns for Sharpe
    const returns = trades.map(t => t.profitUSD);
    const sharpeRatio = this.calculateSharpeRatio(returns);

    // Calculate max drawdown
    let peak = 0;
    let maxDrawdown = 0;
    let cumulative = 0;

    for (const trade of trades) {
      cumulative += trade.profitUSD;
      if (cumulative > peak) {
        peak = cumulative;
      }
      const drawdown = peak > 0 ? (peak - cumulative) / peak : 0;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return {
      winRate,
      avgWin,
      avgLoss,
      winLossRatio,
      sharpeRatio,
      maxDrawdown,
      totalTrades: trades.length,
    };
  }

  /**
   * Calculate optimal position size for an opportunity
   */
  calculateOptimalSize(params: {
    strategyType: string;
    availableCapitalUSD: number;
    expectedProfitUSD: number;
    gasEstimateUSD: number;
    priceImpactPercent: number;
    liquidityDepthUSD: number;
  }): PositionSizeResult {
    const reasoning: string[] = [];

    // Get strategy statistics
    const stats = this.getStrategyStats(params.strategyType);
    reasoning.push(`Strategy stats: ${stats.totalTrades} trades, ${(stats.winRate * 100).toFixed(1)}% win rate`);

    // Calculate base Kelly fraction
    let kellyFraction = 0;

    if (stats.totalTrades >= this.minTradesForStats) {
      kellyFraction = this.calculateKellyFraction(stats);
      reasoning.push(`Raw Kelly fraction: ${(kellyFraction * 100).toFixed(2)}%`);
    } else {
      // Use conservative estimate for new strategies
      kellyFraction = 0.02; // 2% default
      reasoning.push(`Insufficient history (${stats.totalTrades}/${this.minTradesForStats}), using conservative 2%`);
    }

    // Apply Kelly multiplier (fractional Kelly)
    const adjustedKelly = kellyFraction * this.kellyMultiplier;
    reasoning.push(`Adjusted Kelly (${this.kellyMultiplier}x): ${(adjustedKelly * 100).toFixed(2)}%`);

    // Calculate base position size
    let optimalSizeUSD = params.availableCapitalUSD * adjustedKelly;

    // Adjust for price impact - reduce size if impact is high
    if (params.priceImpactPercent > 0.5) {
      const impactAdjustment = Math.max(0.5, 1 - params.priceImpactPercent / 5);
      optimalSizeUSD *= impactAdjustment;
      reasoning.push(`Price impact adjustment (${params.priceImpactPercent.toFixed(2)}%): ${(impactAdjustment * 100).toFixed(0)}%`);
    }

    // Adjust for liquidity depth - don't exceed 10% of available liquidity
    const maxLiquiditySize = params.liquidityDepthUSD * 0.1;
    if (optimalSizeUSD > maxLiquiditySize) {
      optimalSizeUSD = maxLiquiditySize;
      reasoning.push(`Liquidity cap: limited to 10% of ${params.liquidityDepthUSD.toFixed(0)} USD depth`);
    }

    // Adjust for expected profit - ensure gas is covered with buffer
    const minProfitableSize = (params.gasEstimateUSD * 3) / (params.expectedProfitUSD / params.availableCapitalUSD);
    if (optimalSizeUSD < minProfitableSize) {
      optimalSizeUSD = minProfitableSize;
      reasoning.push(`Minimum profitable size: ${minProfitableSize.toFixed(2)} USD`);
    }

    // Apply hard caps
    optimalSizeUSD = Math.max(this.minPositionUSD, optimalSizeUSD);
    optimalSizeUSD = Math.min(this.maxPositionUSD, optimalSizeUSD);
    optimalSizeUSD = Math.min(params.availableCapitalUSD * this.maxPositionPercent, optimalSizeUSD);

    reasoning.push(`Final position size: ${optimalSizeUSD.toFixed(2)} USD`);

    // Calculate confidence based on data quality
    const confidence = Math.min(1, stats.totalTrades / (this.minTradesForStats * 2));

    // Convert to Wei (assuming ETH pricing)
    const ethPriceUSD = config.prices?.ethUsd ?? 2000;
    const optimalSizeETH = optimalSizeUSD / ethPriceUSD;
    const optimalSizeWei = parseUnits(optimalSizeETH.toFixed(18), 18);

    return {
      optimalSizeUSD,
      optimalSizeWei,
      kellyFraction,
      adjustedKelly,
      confidence,
      reasoning,
    };
  }

  /**
   * Calculate position size based on volatility
   * Uses inverse volatility weighting
   */
  calculateVolatilityAdjustedSize(
    baseSize: bigint,
    recentVolatility: number,
    targetVolatility: number = 0.02 // 2% target vol
  ): bigint {
    if (recentVolatility <= 0) {
      return baseSize;
    }

    // Inverse volatility scaling
    const volMultiplier = Math.min(2, Math.max(0.25, targetVolatility / recentVolatility));

    return BigInt(Math.floor(Number(baseSize) * volMultiplier));
  }

  /**
   * Get recommended position size for quick decisions
   */
  getQuickSize(
    strategyType: string,
    availableCapitalWei: bigint
  ): bigint {
    const stats = this.getStrategyStats(strategyType);

    // Quick sizing based on win rate
    let fraction: number;

    if (stats.totalTrades < this.minTradesForStats) {
      fraction = 0.01; // 1% for new strategies
    } else if (stats.winRate > 0.7) {
      fraction = 0.03; // 3% for high win rate
    } else if (stats.winRate > 0.5) {
      fraction = 0.02; // 2% for moderate win rate
    } else {
      fraction = 0.01; // 1% for low win rate
    }

    // Apply fractional Kelly
    fraction *= this.kellyMultiplier;

    return BigInt(Math.floor(Number(availableCapitalWei) * fraction));
  }

  /**
   * Update configuration
   */
  updateConfig(params: {
    kellyMultiplier?: number;
    maxPositionPercent?: number;
    minPositionUSD?: number;
    maxPositionUSD?: number;
  }): void {
    if (params.kellyMultiplier !== undefined) {
      this.kellyMultiplier = Math.max(0.1, Math.min(1, params.kellyMultiplier));
    }
    if (params.maxPositionPercent !== undefined) {
      this.maxPositionPercent = Math.max(0.01, Math.min(0.2, params.maxPositionPercent));
    }
    if (params.minPositionUSD !== undefined) {
      this.minPositionUSD = Math.max(10, params.minPositionUSD);
    }
    if (params.maxPositionUSD !== undefined) {
      this.maxPositionUSD = Math.max(this.minPositionUSD, params.maxPositionUSD);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): {
    kellyMultiplier: number;
    maxPositionPercent: number;
    minPositionUSD: number;
    maxPositionUSD: number;
  } {
    return {
      kellyMultiplier: this.kellyMultiplier,
      maxPositionPercent: this.maxPositionPercent,
      minPositionUSD: this.minPositionUSD,
      maxPositionUSD: this.maxPositionUSD,
    };
  }

  /**
   * Clear trade history
   */
  clearHistory(): void {
    this.tradeHistory = [];
  }

  /**
   * Export trade history for analysis
   */
  exportHistory(): TradeHistory[] {
    return [...this.tradeHistory];
  }

  /**
   * Import trade history
   */
  importHistory(history: TradeHistory[]): void {
    this.tradeHistory = history.slice(-this.maxHistorySize);
  }
}

export const positionSizingService = new PositionSizingService();
export type { TradeHistory, PositionSizeResult, StrategyStats };
