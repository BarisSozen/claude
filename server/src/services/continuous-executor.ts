/**
 * Continuous Executor Service
 * Background scanner and executor for arbitrage opportunities
 */

import { arbitrageService } from './arbitrage.js';
import { riskManagerService } from './risk-manager.js';
import { delegationService } from './delegation.js';
import { config } from '../config/env.js';
import { structuredLogger } from './logger.js';
import type { ChainId, ArbitrageOpportunity, ExecutorStatus, ExecutorConfig } from '../../shared/schema.js';

interface ExecutorMetrics {
  totalScans: number;
  totalOpportunities: number;
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfitUSD: number;
  totalGasSpentUSD: number;
  startTime: Date;
}

type ExecutorCallback = (status: ExecutorStatus) => void;
type OpportunityCallback = (opportunity: ArbitrageOpportunity) => void;

class ContinuousExecutorService {
  private isRunning: boolean = false;
  private scanInterval: number;
  private minProfitUSD: number;
  private maxDailyTrades: number;
  private enabledStrategies: string[];
  private activeDelegationId: string | null = null;
  private lastScanTime: Date | null = null;
  private scanTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Metrics
  private metrics: ExecutorMetrics = {
    totalScans: 0,
    totalOpportunities: 0,
    totalTrades: 0,
    successfulTrades: 0,
    failedTrades: 0,
    totalProfitUSD: 0,
    totalGasSpentUSD: 0,
    startTime: new Date(),
  };

  // Daily limits
  private dailyTradeCount: number = 0;
  private dailyTradeResetTime: Date = new Date();

  // Callbacks
  private statusCallbacks: Set<ExecutorCallback> = new Set();
  private opportunityCallbacks: Set<OpportunityCallback> = new Set();

  constructor() {
    this.scanInterval = config.executor.scanIntervalMs;
    this.minProfitUSD = config.executor.minProfitUsd;
    this.maxDailyTrades = config.executor.maxDailyTrades;
    this.enabledStrategies = ['cross-exchange', 'triangular'];
  }

  /**
   * Start the executor
   */
  async start(delegationId?: string): Promise<void> {
    if (this.isRunning) {
      structuredLogger.info('executor', 'Already running');
      return;
    }

    // Validate delegation if provided
    if (delegationId) {
      const validation = await delegationService.validate(delegationId);
      if (!validation.valid) {
        throw new Error(`Invalid delegation: ${validation.reason}`);
      }
      this.activeDelegationId = delegationId;
    }

    this.isRunning = true;
    this.metrics.startTime = new Date();
    this.resetDailyCounters();

    structuredLogger.info('executor', 'Starting continuous executor');
    this.notifyStatusChange();

    // Start scan loop
    this.scanLoop();
  }

  /**
   * Stop the executor
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.scanTimeoutId) {
      clearTimeout(this.scanTimeoutId);
      this.scanTimeoutId = null;
    }

    structuredLogger.info('executor', 'Stopped');
    this.notifyStatusChange();
  }

  /**
   * Main scan loop
   */
  private async scanLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.executeScanCycle();
      } catch (error) {
        structuredLogger.error('executor', 'Scan cycle error', error as Error);
      }

      // Wait for next scan
      await this.sleep(this.scanInterval);
    }
  }

  /**
   * Execute a single scan cycle
   */
  private async executeScanCycle(): Promise<void> {
    // Check if trading is allowed
    if (riskManagerService.isCircuitBreakerTriggered()) {
      structuredLogger.info('executor', 'Circuit breaker active, skipping scan');
      return;
    }

    // Check daily trade limit
    this.resetDailyCountersIfNeeded();
    if (this.dailyTradeCount >= this.maxDailyTrades) {
      structuredLogger.info('executor', 'Daily trade limit reached, skipping scan');
      return;
    }

    // Scan for opportunities
    this.metrics.totalScans++;
    this.lastScanTime = new Date();

    const opportunities = await arbitrageService.scanForOpportunities('ethereum');
    this.metrics.totalOpportunities += opportunities.length;

    // Filter by profit threshold and enabled strategies
    const viableOpportunities = opportunities.filter(
      (opp) =>
        opp.netProfitUSD >= this.minProfitUSD &&
        this.enabledStrategies.includes(opp.type)
    );

    // Notify about opportunities
    for (const opp of viableOpportunities) {
      this.notifyOpportunity(opp);
    }

    // Execute best opportunity if we have a delegation
    if (viableOpportunities.length > 0 && this.activeDelegationId) {
      const best = viableOpportunities[0]; // Already sorted by profit
      await this.executeOpportunity(best);
    }

    this.notifyStatusChange();
  }

  /**
   * Execute an opportunity
   */
  private async executeOpportunity(opportunity: ArbitrageOpportunity): Promise<void> {
    if (!this.activeDelegationId) {
      structuredLogger.info('executor', 'No active delegation, skipping execution');
      return;
    }

    // Assess risk
    const riskAssessment = await riskManagerService.assessTradeRisk(
      'ethereum',
      {
        delegationId: this.activeDelegationId,
        protocol: opportunity.buyDex,
        action: 'swap',
        tokenIn: opportunity.executionPath[0]?.tokenIn,
        tokenOut: opportunity.executionPath[0]?.tokenOut,
        amountIn: opportunity.requiredCapital,
        targetContract: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      }
    );

    if (!riskAssessment.approved) {
      structuredLogger.info('executor', 'Trade rejected', { blockers: riskAssessment.blockers });
      return;
    }

    structuredLogger.info('executor', 'Executing opportunity', { opportunityId: opportunity.id });
    this.metrics.totalTrades++;
    this.dailyTradeCount++;

    try {
      const result = await arbitrageService.executeOpportunity(
        this.activeDelegationId,
        opportunity.id
      );

      if (result.success) {
        this.metrics.successfulTrades++;
        this.metrics.totalProfitUSD += opportunity.netProfitUSD;
        riskManagerService.recordTradeResult(opportunity.netProfitUSD);
        structuredLogger.info('executor', 'Trade successful', { profit: opportunity.netProfitUSD });
      } else {
        this.metrics.failedTrades++;
        riskManagerService.recordTradeResult(-opportunity.gasEstimateUSD);
        structuredLogger.warn('executor', 'Trade failed', { error: result.error });
      }
    } catch (error) {
      this.metrics.failedTrades++;
      structuredLogger.error('executor', 'Execution error', error as Error);
    }
  }

  /**
   * Get current status
   */
  getStatus(): ExecutorStatus {
    return {
      isRunning: this.isRunning,
      dailyTradeCount: this.dailyTradeCount,
      totalProfitToday: this.metrics.totalProfitUSD,
      lastScanTime: this.lastScanTime,
      config: {
        scanInterval: this.scanInterval,
        minProfitUSD: this.minProfitUSD,
        maxDailyTrades: this.maxDailyTrades,
        enabledStrategies: this.enabledStrategies,
      },
    };
  }

  /**
   * Get detailed metrics
   */
  getMetrics(): ExecutorMetrics & { uptime: number } {
    return {
      ...this.metrics,
      uptime: Date.now() - this.metrics.startTime.getTime(),
    };
  }

  /**
   * Update executor configuration
   */
  updateConfig(newConfig: Partial<ExecutorConfig>): void {
    if (newConfig.scanInterval !== undefined) {
      this.scanInterval = newConfig.scanInterval;
    }
    if (newConfig.minProfitUSD !== undefined) {
      this.minProfitUSD = newConfig.minProfitUSD;
    }
    if (newConfig.maxDailyTrades !== undefined) {
      this.maxDailyTrades = newConfig.maxDailyTrades;
    }
    if (newConfig.enabledStrategies !== undefined) {
      this.enabledStrategies = newConfig.enabledStrategies;
    }

    this.notifyStatusChange();
  }

  /**
   * Set active delegation
   */
  async setActiveDelegation(delegationId: string | null): Promise<boolean> {
    if (delegationId) {
      const validation = await delegationService.validate(delegationId);
      if (!validation.valid) {
        return false;
      }
    }

    this.activeDelegationId = delegationId;
    return true;
  }

  /**
   * Subscribe to status changes
   */
  onStatusChange(callback: ExecutorCallback): () => void {
    this.statusCallbacks.add(callback);
    return () => this.statusCallbacks.delete(callback);
  }

  /**
   * Subscribe to opportunity events
   */
  onOpportunity(callback: OpportunityCallback): () => void {
    this.opportunityCallbacks.add(callback);
    return () => this.opportunityCallbacks.delete(callback);
  }

  /**
   * Notify status change
   */
  private notifyStatusChange(): void {
    const status = this.getStatus();
    for (const callback of this.statusCallbacks) {
      try {
        callback(status);
      } catch (error) {
        structuredLogger.error('executor', 'Status callback error', error as Error);
      }
    }
  }

  /**
   * Notify opportunity found
   */
  private notifyOpportunity(opportunity: ArbitrageOpportunity): void {
    for (const callback of this.opportunityCallbacks) {
      try {
        callback(opportunity);
      } catch (error) {
        structuredLogger.error('executor', 'Opportunity callback error', error as Error);
      }
    }
  }

  /**
   * Reset daily counters if needed
   */
  private resetDailyCountersIfNeeded(): void {
    const now = new Date();
    const dayDiff =
      (now.getTime() - this.dailyTradeResetTime.getTime()) / (1000 * 60 * 60 * 24);

    if (dayDiff >= 1) {
      this.resetDailyCounters();
    }
  }

  /**
   * Reset daily counters
   */
  private resetDailyCounters(): void {
    this.dailyTradeCount = 0;
    this.dailyTradeResetTime = new Date();
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.scanTimeoutId = setTimeout(resolve, ms);
    });
  }
}

export const continuousExecutorService = new ContinuousExecutorService();
