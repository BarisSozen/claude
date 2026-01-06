/**
 * Risk Management Service
 * Price impact validation, liquidity checks, slippage protection, emergency controls
 */

import { formatUnits, type Address } from 'viem';
import { priceOracleService } from './price-oracle.js';
import { delegationService } from './delegation.js';
import { config } from '../config/env.js';
import type { ChainId, SwapQuote, TradeParams } from '../../shared/schema.js';
import { TOKEN_DECIMALS } from '../../shared/schema.js';

// Circuit breaker thresholds
interface CircuitBreakerConfig {
  maxLossPerHour: number;      // Max USD loss per hour
  maxLossPerDay: number;       // Max USD loss per day
  maxConsecutiveLosses: number; // Max consecutive losing trades
  maxSlippagePercent: number;  // Max slippage before abort
}

// Trade risk assessment
interface RiskAssessment {
  approved: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  warnings: string[];
  blockers: string[];
  priceImpact: number;
  liquidityRatio: number;
  estimatedSlippage: number;
}

class RiskManagerService {
  private circuitBreakerConfig: CircuitBreakerConfig = {
    maxLossPerHour: 100,      // $100 max loss per hour
    maxLossPerDay: 500,       // $500 max loss per day
    maxConsecutiveLosses: 3,  // Pause after 3 consecutive losses
    maxSlippagePercent: 1.5,  // 1.5% max slippage (reduced from 5%)
  };

  // Trading state
  private tradingPaused: boolean = false;
  private pausedStrategies: Set<string> = new Set();
  private hourlyLoss: number = 0;
  private dailyLoss: number = 0;
  private consecutiveLosses: number = 0;
  private lastHourReset: Date = new Date();
  private lastDayReset: Date = new Date();

  /**
   * Validate price impact for a trade
   */
  async validatePriceImpact(
    quote: SwapQuote,
    maxImpact?: number
  ): Promise<{ valid: boolean; reason?: string }> {
    const effectiveMax = maxImpact ?? config.risk.maxPriceImpact;

    if (quote.priceImpact > effectiveMax) {
      return {
        valid: false,
        reason: `Price impact ${(quote.priceImpact * 100).toFixed(2)}% exceeds max ${(effectiveMax * 100).toFixed(2)}%`,
      };
    }

    return { valid: true };
  }

  /**
   * Validate liquidity for a trade
   */
  async validateLiquidity(
    chainId: ChainId,
    tokenAddress: Address,
    tradeSize: bigint,
    minLiquidityRatio: number = 0.01
  ): Promise<{ valid: boolean; poolLiquidity?: bigint; reason?: string }> {
    try {
      // Get a quote for the trade size to estimate pool depth
      const quote = await priceOracleService.getBestSwapRoute(
        chainId,
        tokenAddress,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address, // USDC
        tradeSize
      );

      // If price impact is too high, liquidity is insufficient
      if (quote.priceImpact > minLiquidityRatio * 10) {
        return {
          valid: false,
          reason: `Insufficient liquidity: ${(quote.priceImpact * 100).toFixed(2)}% price impact`,
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        reason: 'Failed to validate liquidity',
      };
    }
  }

  /**
   * Calculate minimum output with slippage protection
   */
  calculateMinOutput(expectedOutput: bigint, slippageTolerance: number): bigint {
    const slippageBps = BigInt(Math.floor(slippageTolerance * 10000));
    return (expectedOutput * (10000n - slippageBps)) / 10000n;
  }

  /**
   * Get transaction deadline
   */
  getDeadline(minutes: number = 5): bigint {
    return BigInt(Math.floor(Date.now() / 1000) + minutes * 60);
  }

  /**
   * Assess risk for a trade
   */
  async assessTradeRisk(
    chainId: ChainId,
    params: TradeParams
  ): Promise<RiskAssessment> {
    const warnings: string[] = [];
    const blockers: string[] = [];

    // Check if trading is paused
    if (this.tradingPaused) {
      blockers.push('Trading is currently paused');
    }

    // Check circuit breaker
    if (this.isCircuitBreakerTriggered()) {
      blockers.push('Circuit breaker triggered');
    }

    // Validate delegation
    const validation = await delegationService.validate(params.delegationId);
    if (!validation.valid) {
      blockers.push(validation.reason || 'Invalid delegation');
    }

    // Get swap quote if possible
    let priceImpact = 0;
    let estimatedSlippage = 0;

    if (params.tokenIn && params.tokenOut) {
      try {
        const quote = await priceOracleService.getBestSwapRoute(
          chainId,
          params.tokenIn,
          params.tokenOut,
          params.amountIn
        );

        priceImpact = quote.priceImpact;
        estimatedSlippage = priceImpact;

        // Check price impact
        const maxImpact = priceOracleService.getMaxPriceImpact(
          params.tokenIn,
          params.tokenOut
        );

        if (priceImpact > maxImpact) {
          blockers.push(
            `Price impact ${(priceImpact * 100).toFixed(2)}% exceeds max ${(maxImpact * 100).toFixed(2)}%`
          );
        } else if (priceImpact > maxImpact * 0.7) {
          warnings.push(
            `Price impact ${(priceImpact * 100).toFixed(2)}% approaching max`
          );
        }

        // Check slippage
        if (estimatedSlippage > this.circuitBreakerConfig.maxSlippagePercent / 100) {
          blockers.push(
            `Estimated slippage ${(estimatedSlippage * 100).toFixed(2)}% exceeds max`
          );
        }
      } catch (error) {
        warnings.push('Could not fetch price quote');
      }
    }

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'critical';

    if (blockers.length > 0) {
      riskLevel = 'critical';
    } else if (priceImpact > 0.01 || warnings.length > 1) {
      riskLevel = 'high';
    } else if (priceImpact > 0.005 || warnings.length > 0) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'low';
    }

    return {
      approved: blockers.length === 0,
      riskLevel,
      warnings,
      blockers,
      priceImpact,
      liquidityRatio: 0, // Would need to calculate
      estimatedSlippage,
    };
  }

  /**
   * Record trade result for circuit breaker
   */
  recordTradeResult(profitUSD: number): void {
    this.resetPeriodicalCounters();

    if (profitUSD < 0) {
      this.hourlyLoss += Math.abs(profitUSD);
      this.dailyLoss += Math.abs(profitUSD);
      this.consecutiveLosses++;
    } else {
      this.consecutiveLosses = 0;
    }

    // Check circuit breaker
    if (this.isCircuitBreakerTriggered()) {
      this.pauseTrading('Circuit breaker triggered');
    }
  }

  /**
   * Check if circuit breaker should trigger
   */
  isCircuitBreakerTriggered(): boolean {
    this.resetPeriodicalCounters();

    return (
      this.hourlyLoss >= this.circuitBreakerConfig.maxLossPerHour ||
      this.dailyLoss >= this.circuitBreakerConfig.maxLossPerDay ||
      this.consecutiveLosses >= this.circuitBreakerConfig.maxConsecutiveLosses
    );
  }

  /**
   * Reset hourly/daily counters if needed
   */
  private resetPeriodicalCounters(): void {
    const now = new Date();

    // Reset hourly
    const hourDiff = (now.getTime() - this.lastHourReset.getTime()) / (1000 * 60 * 60);
    if (hourDiff >= 1) {
      this.hourlyLoss = 0;
      this.lastHourReset = now;
    }

    // Reset daily
    const dayDiff = (now.getTime() - this.lastDayReset.getTime()) / (1000 * 60 * 60 * 24);
    if (dayDiff >= 1) {
      this.dailyLoss = 0;
      this.lastDayReset = now;
    }
  }

  /**
   * Pause all trading
   */
  pauseTrading(reason: string): void {
    this.tradingPaused = true;
    console.warn(`[RISK] Trading paused: ${reason}`);
  }

  /**
   * Resume trading
   */
  resumeTrading(): void {
    this.tradingPaused = false;
    this.consecutiveLosses = 0;
    console.info('[RISK] Trading resumed');
  }

  /**
   * Pause a specific strategy
   */
  pauseStrategy(strategyId: string): void {
    this.pausedStrategies.add(strategyId);
    console.warn(`[RISK] Strategy paused: ${strategyId}`);
  }

  /**
   * Resume a specific strategy
   */
  resumeStrategy(strategyId: string): void {
    this.pausedStrategies.delete(strategyId);
    console.info(`[RISK] Strategy resumed: ${strategyId}`);
  }

  /**
   * Check if a strategy is paused
   */
  isStrategyPaused(strategyId: string): boolean {
    return this.pausedStrategies.has(strategyId) || this.tradingPaused;
  }

  /**
   * Get current risk status
   */
  getRiskStatus(): {
    tradingPaused: boolean;
    circuitBreakerActive: boolean;
    hourlyLoss: number;
    dailyLoss: number;
    consecutiveLosses: number;
    pausedStrategies: string[];
  } {
    return {
      tradingPaused: this.tradingPaused,
      circuitBreakerActive: this.isCircuitBreakerTriggered(),
      hourlyLoss: this.hourlyLoss,
      dailyLoss: this.dailyLoss,
      consecutiveLosses: this.consecutiveLosses,
      pausedStrategies: Array.from(this.pausedStrategies),
    };
  }

  /**
   * Update circuit breaker config
   */
  updateCircuitBreakerConfig(config: Partial<CircuitBreakerConfig>): void {
    this.circuitBreakerConfig = {
      ...this.circuitBreakerConfig,
      ...config,
    };
  }

  /**
   * Emergency stop - revoke all delegations for a wallet
   */
  async emergencyStop(walletAddress: Address): Promise<number> {
    this.pauseTrading('Emergency stop triggered');
    return delegationService.revokeAllForWallet(walletAddress);
  }
}

export const riskManagerService = new RiskManagerService();
