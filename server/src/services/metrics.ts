/**
 * Prometheus Metrics Service
 * Exposes application metrics in Prometheus format
 */

import { structuredLogger } from './logger.js';
import { redisService } from './redis.js';
import { rpcProvider } from './rpc-provider.js';
import { checkDatabaseConnection } from '../db/index.js';

// Metric types
interface Counter {
  name: string;
  help: string;
  labels: string[];
  values: Map<string, number>;
}

interface Gauge {
  name: string;
  help: string;
  labels: string[];
  values: Map<string, number>;
}

interface Histogram {
  name: string;
  help: string;
  labels: string[];
  buckets: number[];
  values: Map<string, { sum: number; count: number; buckets: number[] }>;
}

class MetricsService {
  private counters: Map<string, Counter> = new Map();
  private gauges: Map<string, Gauge> = new Map();
  private histograms: Map<string, Histogram> = new Map();

  constructor() {
    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    // HTTP metrics
    this.registerCounter('http_requests_total', 'Total HTTP requests', ['method', 'path', 'status']);
    this.registerHistogram('http_request_duration_seconds', 'HTTP request duration', ['method', 'path'], [0.01, 0.05, 0.1, 0.5, 1, 5]);

    // Trade metrics
    this.registerCounter('trades_total', 'Total trades executed', ['status', 'chain', 'protocol']);
    this.registerCounter('trades_profit_usd_total', 'Total profit in USD', ['chain']);
    this.registerCounter('trades_gas_usd_total', 'Total gas spent in USD', ['chain']);

    // Opportunity metrics
    this.registerCounter('opportunities_detected_total', 'Total opportunities detected', ['type', 'chain']);
    this.registerCounter('opportunities_executed_total', 'Total opportunities executed', ['type', 'chain']);
    this.registerGauge('opportunities_pending', 'Current pending opportunities', ['type']);

    // Session metrics
    this.registerGauge('sessions_active', 'Active sessions', []);
    this.registerCounter('sessions_created_total', 'Total sessions created', []);

    // RPC metrics
    this.registerCounter('rpc_requests_total', 'Total RPC requests', ['chain', 'status']);
    this.registerHistogram('rpc_request_duration_seconds', 'RPC request duration', ['chain'], [0.1, 0.5, 1, 2, 5, 10]);
    this.registerGauge('rpc_endpoint_healthy', 'RPC endpoint health status', ['chain', 'endpoint']);

    // Rate limiting metrics
    this.registerCounter('rate_limit_exceeded_total', 'Rate limit exceeded count', ['endpoint', 'identifier_type']);

    // Service health metrics
    this.registerGauge('service_health', 'Service health status (1=healthy, 0=unhealthy)', ['service']);
    this.registerGauge('uptime_seconds', 'Service uptime in seconds', []);

    // WebSocket metrics
    this.registerGauge('websocket_connections', 'Active WebSocket connections', []);
    this.registerCounter('websocket_messages_total', 'Total WebSocket messages', ['direction']);

    // Database metrics
    this.registerGauge('database_pool_size', 'Database connection pool size', ['status']);
    this.registerCounter('database_queries_total', 'Total database queries', ['operation']);
  }

  private registerCounter(name: string, help: string, labels: string[]): void {
    this.counters.set(name, { name, help, labels, values: new Map() });
  }

  private registerGauge(name: string, help: string, labels: string[]): void {
    this.gauges.set(name, { name, help, labels, values: new Map() });
  }

  private registerHistogram(name: string, help: string, labels: string[], buckets: number[]): void {
    this.histograms.set(name, { name, help, labels, buckets, values: new Map() });
  }

  private getLabelKey(labels: Record<string, string>): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  /**
   * Increment a counter
   */
  incCounter(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    const counter = this.counters.get(name);
    if (!counter) return;

    const key = this.getLabelKey(labels);
    const current = counter.values.get(key) || 0;
    counter.values.set(key, current + value);
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const gauge = this.gauges.get(name);
    if (!gauge) return;

    const key = this.getLabelKey(labels);
    gauge.values.set(key, value);
  }

  /**
   * Observe a histogram value
   */
  observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const histogram = this.histograms.get(name);
    if (!histogram) return;

    const key = this.getLabelKey(labels);
    const existing = histogram.values.get(key) || {
      sum: 0,
      count: 0,
      buckets: new Array(histogram.buckets.length).fill(0),
    };

    existing.sum += value;
    existing.count += 1;

    for (let i = 0; i < histogram.buckets.length; i++) {
      if (value <= histogram.buckets[i]) {
        existing.buckets[i] += 1;
      }
    }

    histogram.values.set(key, existing);
  }

  /**
   * Record HTTP request metrics
   */
  recordHttpRequest(method: string, path: string, status: number, durationMs: number): void {
    const normalizedPath = this.normalizePath(path);
    this.incCounter('http_requests_total', { method, path: normalizedPath, status: status.toString() });
    this.observeHistogram('http_request_duration_seconds', durationMs / 1000, { method, path: normalizedPath });
  }

  /**
   * Normalize path for metrics (remove UUIDs, etc.)
   */
  private normalizePath(path: string): string {
    return path
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
      .replace(/0x[a-fA-F0-9]{40}/g, ':address')
      .replace(/\/\d+/g, '/:num');
  }

  /**
   * Record trade metrics
   */
  recordTrade(success: boolean, chain: string, protocol: string, profitUsd: number, gasUsd: number): void {
    this.incCounter('trades_total', { status: success ? 'success' : 'failed', chain, protocol });
    if (success) {
      this.incCounter('trades_profit_usd_total', { chain }, profitUsd);
    }
    this.incCounter('trades_gas_usd_total', { chain }, gasUsd);
  }

  /**
   * Record opportunity metrics
   */
  recordOpportunity(type: string, chain: string, executed: boolean): void {
    this.incCounter('opportunities_detected_total', { type, chain });
    if (executed) {
      this.incCounter('opportunities_executed_total', { type, chain });
    }
  }

  /**
   * Update service health metrics
   */
  async updateHealthMetrics(): Promise<void> {
    // Database health
    const dbHealthy = await checkDatabaseConnection();
    this.setGauge('service_health', dbHealthy ? 1 : 0, { service: 'database' });

    // Redis health
    const redisHealthy = await redisService.ping();
    this.setGauge('service_health', redisHealthy ? 1 : 0, { service: 'redis' });

    // RPC health
    const rpcStats = rpcProvider.getAllStats();
    for (const [chain, stats] of Object.entries(rpcStats)) {
      for (const endpoint of stats.endpoints) {
        this.setGauge('rpc_endpoint_healthy', endpoint.healthy ? 1 : 0, {
          chain,
          endpoint: endpoint.url,
        });
      }
    }

    // Uptime
    const uptimeSeconds = process.uptime();
    this.setGauge('uptime_seconds', uptimeSeconds);
  }

  /**
   * Generate Prometheus format output
   */
  async getMetrics(): Promise<string> {
    await this.updateHealthMetrics();

    const lines: string[] = [];

    // Output counters
    for (const [name, counter] of this.counters) {
      lines.push(`# HELP ${name} ${counter.help}`);
      lines.push(`# TYPE ${name} counter`);
      for (const [labels, value] of counter.values) {
        const labelStr = labels ? `{${labels}}` : '';
        lines.push(`${name}${labelStr} ${value}`);
      }
    }

    // Output gauges
    for (const [name, gauge] of this.gauges) {
      lines.push(`# HELP ${name} ${gauge.help}`);
      lines.push(`# TYPE ${name} gauge`);
      for (const [labels, value] of gauge.values) {
        const labelStr = labels ? `{${labels}}` : '';
        lines.push(`${name}${labelStr} ${value}`);
      }
    }

    // Output histograms
    for (const [name, histogram] of this.histograms) {
      lines.push(`# HELP ${name} ${histogram.help}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const [labels, data] of histogram.values) {
        const labelPrefix = labels ? `${labels},` : '';
        for (let i = 0; i < histogram.buckets.length; i++) {
          const le = histogram.buckets[i];
          lines.push(`${name}_bucket{${labelPrefix}le="${le}"} ${data.buckets[i]}`);
        }
        lines.push(`${name}_bucket{${labelPrefix}le="+Inf"} ${data.count}`);
        lines.push(`${name}_sum{${labels}} ${data.sum}`);
        lines.push(`${name}_count{${labels}} ${data.count}`);
      }
    }

    // Add logger metrics
    const loggerMetrics = structuredLogger.getMetrics();
    lines.push(`# HELP defi_bot_total_trades Total trades from logger`);
    lines.push(`# TYPE defi_bot_total_trades counter`);
    lines.push(`defi_bot_total_trades ${loggerMetrics.totalTrades}`);
    lines.push(`defi_bot_successful_trades ${loggerMetrics.successfulTrades}`);
    lines.push(`defi_bot_failed_trades ${loggerMetrics.failedTrades}`);
    lines.push(`defi_bot_net_profit_usd ${loggerMetrics.netProfitUSD}`);
    lines.push(`defi_bot_success_rate ${loggerMetrics.successRate}`);

    return lines.join('\n');
  }

  /**
   * Get metrics as JSON (for API)
   */
  async getMetricsJson(): Promise<Record<string, unknown>> {
    await this.updateHealthMetrics();

    const loggerMetrics = structuredLogger.getMetrics();
    const rpcStats = rpcProvider.getAllStats();

    return {
      trades: {
        total: loggerMetrics.totalTrades,
        successful: loggerMetrics.successfulTrades,
        failed: loggerMetrics.failedTrades,
        successRate: loggerMetrics.successRate,
        netProfitUSD: loggerMetrics.netProfitUSD,
        totalProfitUSD: loggerMetrics.totalProfitUSD,
        totalGasSpentUSD: loggerMetrics.totalGasSpentUSD,
      },
      opportunities: {
        found: loggerMetrics.opportunitiesFound,
        executed: loggerMetrics.opportunitiesExecuted,
      },
      uptime: process.uptime(),
      lastScanTime: loggerMetrics.lastScanTime,
      rpc: rpcStats,
    };
  }
}

// Export singleton instance
export const metricsService = new MetricsService();
