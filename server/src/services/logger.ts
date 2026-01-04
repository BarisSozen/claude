/**
 * Structured Logging Service
 * Production-ready JSON logging with correlation IDs and external integration support
 */

import { db, priceHistory } from '../db/index.js';
import { config } from '../config/env.js';
import type { ChainId } from '../../shared/schema.js';
import * as fs from 'fs';
import * as path from 'path';

type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'success';
type LogCategory = 'system' | 'opportunity' | 'execution' | 'price' | 'error' | 'risk' | 'auth' | 'http' | 'websocket' | 'database';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  success: 1,
  warning: 2,
  error: 3,
};

interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  service: string;
  environment: string;
  version: string;
  metadata?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  http?: {
    method?: string;
    path?: string;
    statusCode?: number;
    duration?: number;
    userAgent?: string;
    ip?: string;
  };
  user?: {
    id?: string;
    walletAddress?: string;
  };
}

interface LogTransport {
  name: string;
  write(entry: StructuredLogEntry): void | Promise<void>;
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

/**
 * Console transport - outputs to stdout/stderr
 */
class ConsoleTransport implements LogTransport {
  name = 'console';

  write(entry: StructuredLogEntry): void {
    const output = JSON.stringify(entry);

    if (entry.level === 'error') {
      console.error(output);
    } else if (entry.level === 'warning') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }
}

/**
 * File transport - writes to rotating log files
 */
class FileTransport implements LogTransport {
  name = 'file';
  private logDir: string;
  private currentDate: string = '';
  private writeStream: fs.WriteStream | null = null;

  constructor(logDir: string = '/var/log/defi-bot') {
    this.logDir = logDir;
    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch {
      // Fall back to local logs directory
      this.logDir = './logs';
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    }
  }

  private getLogFile(): string {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.logDir, `app-${date}.log`);
  }

  private getStream(): fs.WriteStream {
    const date = new Date().toISOString().split('T')[0];

    if (this.currentDate !== date || !this.writeStream) {
      if (this.writeStream) {
        this.writeStream.end();
      }
      this.currentDate = date;
      this.writeStream = fs.createWriteStream(this.getLogFile(), { flags: 'a' });
    }

    return this.writeStream;
  }

  write(entry: StructuredLogEntry): void {
    try {
      const stream = this.getStream();
      stream.write(JSON.stringify(entry) + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  close(): void {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
  }
}

/**
 * HTTP transport - sends logs to external service (ELK, Datadog, etc.)
 */
class HttpTransport implements LogTransport {
  name = 'http';
  private endpoint: string;
  private apiKey: string;
  private buffer: StructuredLogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 100;
  private readonly FLUSH_INTERVAL_MS = 5000;

  constructor(endpoint: string, apiKey: string) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.startFlushInterval();
  }

  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.flush().catch(console.error);
    }, this.FLUSH_INTERVAL_MS);
  }

  write(entry: StructuredLogEntry): void {
    this.buffer.push(entry);

    if (this.buffer.length >= this.BATCH_SIZE) {
      this.flush().catch(console.error);
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const entries = this.buffer.splice(0, this.BATCH_SIZE);

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ logs: entries }),
      });
    } catch (error) {
      // Re-add to buffer on failure (with limit to prevent memory issues)
      if (this.buffer.length < 10000) {
        this.buffer.unshift(...entries);
      }
    }
  }

  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush().catch(console.error);
  }
}

/**
 * Structured Logger Service
 */
class StructuredLoggerService {
  private transports: LogTransport[] = [];
  private minLevel: LogLevel = 'info';
  private correlationId: string | null = null;
  private readonly SERVICE_NAME = 'defi-bot';
  private readonly VERSION = '1.0.0';

  // In-memory buffer for recent logs (for API access)
  private recentLogs: StructuredLogEntry[] = [];
  private maxRecentLogs: number = 1000;

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

  constructor() {
    this.setupTransports();
  }

  private setupTransports(): void {
    // Always add console transport
    this.transports.push(new ConsoleTransport());

    // Add file transport in production
    if (config.server.nodeEnv === 'production') {
      this.transports.push(new FileTransport());
      this.minLevel = 'info';
    } else {
      this.minLevel = 'debug';
    }

    // Add HTTP transport if configured
    const logEndpoint = process.env.LOG_ENDPOINT;
    const logApiKey = process.env.LOG_API_KEY;
    if (logEndpoint && logApiKey) {
      this.transports.push(new HttpTransport(logEndpoint, logApiKey));
    }
  }

  /**
   * Set correlation ID for request tracing
   */
  setCorrelationId(id: string): void {
    this.correlationId = id;
  }

  /**
   * Clear correlation ID
   */
  clearCorrelationId(): void {
    this.correlationId = null;
  }

  /**
   * Create a child logger with specific correlation ID
   */
  child(correlationId: string): StructuredLoggerService {
    const childLogger = Object.create(this);
    childLogger.correlationId = correlationId;
    return childLogger;
  }

  /**
   * Log a debug message
   */
  debug(category: LogCategory, message: string, metadata?: Record<string, unknown>): void {
    this.log('debug', category, message, metadata);
  }

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
    error?: Error | null,
    metadata?: Record<string, unknown>
  ): void {
    this.log('error', category, message, metadata, error || undefined);
  }

  /**
   * Log a success message
   */
  success(category: LogCategory, message: string, metadata?: Record<string, unknown>): void {
    this.log('success', category, message, metadata);
  }

  /**
   * Log HTTP request
   */
  http(
    method: string,
    path: string,
    statusCode: number,
    duration: number,
    metadata?: Record<string, unknown>
  ): void {
    this.log('info', 'http', `${method} ${path} ${statusCode}`, {
      ...metadata,
      http: { method, path, statusCode, duration },
    });
  }

  /**
   * Internal log method
   */
  private log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    metadata?: Record<string, unknown>,
    error?: Error
  ): void {
    // Check log level
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      service: this.SERVICE_NAME,
      environment: config.server.nodeEnv,
      version: this.VERSION,
    };

    if (this.correlationId) {
      entry.correlationId = this.correlationId;
    }

    if (metadata) {
      // Extract special fields
      if (metadata.http) {
        entry.http = metadata.http as StructuredLogEntry['http'];
        delete metadata.http;
      }
      if (metadata.user) {
        entry.user = metadata.user as StructuredLogEntry['user'];
        delete metadata.user;
      }
      if (metadata.traceId) {
        entry.traceId = metadata.traceId as string;
        delete metadata.traceId;
      }
      if (metadata.spanId) {
        entry.spanId = metadata.spanId as string;
        delete metadata.spanId;
      }

      if (Object.keys(metadata).length > 0) {
        entry.metadata = metadata;
      }
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as NodeJS.ErrnoException).code,
      };
    }

    // Store in recent logs buffer
    this.recentLogs.unshift(entry);
    if (this.recentLogs.length > this.maxRecentLogs) {
      this.recentLogs = this.recentLogs.slice(0, this.maxRecentLogs);
    }

    // Write to all transports
    for (const transport of this.transports) {
      try {
        transport.write(entry);
      } catch (err) {
        console.error(`Failed to write to ${transport.name} transport:`, err);
      }
    }
  }

  /**
   * Get recent logs (for API)
   */
  getRecentLogs(limit: number = 100, category?: LogCategory, level?: LogLevel): StructuredLogEntry[] {
    let logs = this.recentLogs;

    if (category) {
      logs = logs.filter((log) => log.category === category);
    }

    if (level) {
      logs = logs.filter((log) => log.level === level);
    }

    return logs.slice(0, limit);
  }

  /**
   * Get logs by level
   */
  getLogsByLevel(level: LogLevel, limit: number = 100): StructuredLogEntry[] {
    return this.recentLogs.filter((log) => log.level === level).slice(0, limit);
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

    this.info('execution', 'Trade recorded', {
      success,
      profitUSD,
      gasUSD,
      totalTrades: this.metrics.totalTrades,
    });
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
    this.recentLogs = [];
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
      this.error('database', 'Failed to store price history', error as Error);
    }
  }

  /**
   * Shutdown - flush all transports
   */
  async shutdown(): Promise<void> {
    for (const transport of this.transports) {
      if ('stop' in transport && typeof transport.stop === 'function') {
        transport.stop();
      }
      if ('close' in transport && typeof transport.close === 'function') {
        transport.close();
      }
    }
  }
}

// Export singleton instance
export const structuredLogger = new StructuredLoggerService();

// Export legacy name for backwards compatibility
export const executionLogger = structuredLogger;
