/**
 * Execution Logger Service
 * Structured logging with categories
 */

import { db, priceHistory } from '../db/index.js';
import type { ChainId } from '../../shared/schema.js';

type LogLevel = 'info' | 'warning' | 'error' | 'success' | 'debug';
type LogCategory = 'system' | 'opportunity' | 'execution' | 'price' | 'error' | 'risk' | 'auth';

interface ExecutionLog {
  id: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

interface Metrics {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfitUSD: number;
  totalGasSpentUSD: number;
  uptime: number;
  lastScanTime: Date | null;
  opportunitiesFound: number;
  opportunitiesExecuted: number;
}

class ExecutionLoggerService {
  private logs: ExecutionLog[] = [];
  private maxLogs: number = 1000;
  private logId: number = 0;

  // Metrics tracking
  private metrics: Metrics = {
    totalTrades: 0,
    successfulTrades: 0,
    failedTrades: 0,
    totalProfitUSD: 0,
    totalGasSpentUSD: 0,
    uptime: Date.now(),
    lastScanTime: null,
    opportunitiesFound: 0,
    opportunitiesExecuted: 0,
  };

  /**
   * Log an info message
   */
  info(category: LogCategory, message: string, metadata?: Record<string, unknown>): void {
    this.log('info', category, message, metadata);
  }

  /**
   * Log a warning message
   */
  warning(category: LogCategory, message: string, metadata?: Record<string, unknown>): void {
    this.log('warning', category, message, metadata);
  }

  /**
   * Log an error message
   */
  error(
    category: LogCategory,
    message: string,
    error?: Error,
    metadata?: Record<string, unknown>
  ): void {
    this.log('error', category, message, {
      ...metadata,
      error: error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : undefined,
    });
  }

  /**
   * Log a success message
   */
  success(category: LogCategory, message: string, metadata?: Record<string, unknown>): void {
    this.log('success', category, message, metadata);
  }

  /**
   * Log a debug message
   */
  debug(category: LogCategory, message: string, metadata?: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'development') {
      this.log('debug', category, message, metadata);
    }
  }

  /**
   * Internal log method
   */
  private log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    metadata?: Record<string, unknown>
  ): void {
    const logEntry: ExecutionLog = {
      id: `log_${++this.logId}`,
      level,
      category,
      message,
      metadata,
      timestamp: new Date(),
    };

    this.logs.unshift(logEntry);

    // Trim old logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    // Console output
    const prefix = `[${level.toUpperCase()}][${category}]`;
    const consoleMsg = `${prefix} ${message}`;

    switch (level) {
      case 'error':
        console.error(consoleMsg, metadata);
        break;
      case 'warning':
        console.warn(consoleMsg, metadata);
        break;
      case 'debug':
        console.debug(consoleMsg, metadata);
        break;
      default:
        console.log(consoleMsg, metadata ? metadata : '');
    }
  }

  /**
   * Get recent logs
   */
  getRecentLogs(limit: number = 100, category?: LogCategory): ExecutionLog[] {
    let logs = this.logs;

    if (category) {
      logs = logs.filter((log) => log.category === category);
    }

    return logs.slice(0, limit);
  }

  /**
   * Get logs by level
   */
  getLogsByLevel(level: LogLevel, limit: number = 100): ExecutionLog[] {
    return this.logs.filter((log) => log.level === level).slice(0, limit);
  }

  /**
   * Record trade execution
   */
  recordTrade(success: boolean, profitUSD: number, gasUSD: number): void {
    this.metrics.totalTrades++;

    if (success) {
      this.metrics.successfulTrades++;
      this.metrics.totalProfitUSD += profitUSD;
    } else {
      this.metrics.failedTrades++;
    }

    this.metrics.totalGasSpentUSD += gasUSD;
  }

  /**
   * Record opportunity found
   */
  recordOpportunity(executed: boolean): void {
    this.metrics.opportunitiesFound++;

    if (executed) {
      this.metrics.opportunitiesExecuted++;
    }
  }

  /**
   * Update last scan time
   */
  updateScanTime(): void {
    this.metrics.lastScanTime = new Date();
  }

  /**
   * Get current metrics
   */
  getMetrics(): Metrics & { successRate: number; netProfitUSD: number } {
    const successRate =
      this.metrics.totalTrades > 0
        ? (this.metrics.successfulTrades / this.metrics.totalTrades) * 100
        : 0;

    const netProfitUSD = this.metrics.totalProfitUSD - this.metrics.totalGasSpentUSD;

    return {
      ...this.metrics,
      uptime: Date.now() - this.metrics.uptime,
      successRate,
      netProfitUSD,
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalTrades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      totalProfitUSD: 0,
      totalGasSpentUSD: 0,
      uptime: Date.now(),
      lastScanTime: null,
      opportunitiesFound: 0,
      opportunitiesExecuted: 0,
    };
  }

  /**
   * Clear logs
   */
  clearLogs(): void {
    this.logs = [];
    this.logId = 0;
  }

  /**
   * Store price history to database
   */
  async storePriceHistory(
    chain: ChainId,
    tokenAddress: string,
    priceUsd: number,
    dex?: string,
    liquidity?: bigint
  ): Promise<void> {
    try {
      await db.insert(priceHistory).values({
        time: new Date(),
        chain,
        tokenAddress: tokenAddress.toLowerCase(),
        priceUsd: priceUsd.toString(),
        dex,
        liquidity: liquidity?.toString(),
      });
    } catch (error) {
      this.error('system', 'Failed to store price history', error as Error);
    }
  }
}

export const executionLogger = new ExecutionLoggerService();
