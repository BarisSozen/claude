/**
 * RPC Provider Service
 * Multi-endpoint RPC provider with automatic failover, retry logic, and health monitoring
 */

import { createPublicClient, http, type PublicClient, type HttpTransport, type Chain } from 'viem';
import { mainnet, arbitrum, base, polygon } from 'viem/chains';
import { config } from '../config/env.js';
import { structuredLogger } from './logger.js';
import type { ChainId } from '../../shared/schema.js';

interface RpcEndpoint {
  url: string;
  priority: number;
  healthy: boolean;
  lastCheck: Date;
  failureCount: number;
  avgLatency: number;
  latencyHistory: number[];
}

interface ProviderStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalLatency: number;
  failovers: number;
}

// Chain configurations
const CHAIN_CONFIG: Record<ChainId, Chain> = {
  ethereum: mainnet,
  arbitrum: arbitrum,
  base: base,
  polygon: polygon,
};

// Default public RPC endpoints as fallbacks
const DEFAULT_ENDPOINTS: Record<ChainId, string[]> = {
  ethereum: [
    'https://eth.llamarpc.com',
    'https://rpc.ankr.com/eth',
    'https://ethereum.publicnode.com',
  ],
  arbitrum: [
    'https://arb1.arbitrum.io/rpc',
    'https://rpc.ankr.com/arbitrum',
    'https://arbitrum.publicnode.com',
  ],
  base: [
    'https://mainnet.base.org',
    'https://rpc.ankr.com/base',
    'https://base.publicnode.com',
  ],
  polygon: [
    'https://polygon-rpc.com',
    'https://rpc.ankr.com/polygon',
    'https://polygon.publicnode.com',
  ],
};

class RpcProviderService {
  private endpoints: Map<ChainId, RpcEndpoint[]> = new Map();
  private clients: Map<string, PublicClient> = new Map();
  private stats: Map<ChainId, ProviderStats> = new Map();

  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 1000;
  private readonly HEALTH_CHECK_INTERVAL_MS = 30000;
  private readonly FAILURE_THRESHOLD = 5;
  private readonly LATENCY_HISTORY_SIZE = 10;

  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeEndpoints();
    this.startHealthChecks();
  }

  private initializeEndpoints(): void {
    const chainConfigs: { chain: ChainId; envUrl: string | undefined }[] = [
      { chain: 'ethereum', envUrl: config.rpc.ethereum },
      { chain: 'arbitrum', envUrl: config.rpc.arbitrum },
      { chain: 'base', envUrl: config.rpc.base },
      { chain: 'polygon', envUrl: config.rpc.polygon },
    ];

    for (const { chain, envUrl } of chainConfigs) {
      const endpoints: RpcEndpoint[] = [];

      // Add configured endpoint with highest priority
      if (envUrl) {
        endpoints.push({
          url: envUrl,
          priority: 1,
          healthy: true,
          lastCheck: new Date(),
          failureCount: 0,
          avgLatency: 0,
          latencyHistory: [],
        });
      }

      // Add default fallback endpoints
      const defaults = DEFAULT_ENDPOINTS[chain] || [];
      for (let i = 0; i < defaults.length; i++) {
        endpoints.push({
          url: defaults[i],
          priority: i + 2,
          healthy: true,
          lastCheck: new Date(),
          failureCount: 0,
          avgLatency: 0,
          latencyHistory: [],
        });
      }

      this.endpoints.set(chain, endpoints);
      this.stats.set(chain, {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalLatency: 0,
        failovers: 0,
      });
    }
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks().catch((err) => {
        structuredLogger.error('system', 'Health check error', err as Error);
      });
    }, this.HEALTH_CHECK_INTERVAL_MS);

    // Run initial health check
    this.runHealthChecks().catch((err) => {
      structuredLogger.error('system', 'Initial health check error', err as Error);
    });
  }

  private async runHealthChecks(): Promise<void> {
    for (const [chain, endpoints] of this.endpoints.entries()) {
      for (const endpoint of endpoints) {
        try {
          const start = Date.now();
          const client = this.getOrCreateClient(chain, endpoint.url);

          await client.getBlockNumber();
          const latency = Date.now() - start;

          endpoint.healthy = true;
          endpoint.failureCount = 0;
          endpoint.lastCheck = new Date();
          this.updateLatency(endpoint, latency);
        } catch {
          endpoint.failureCount++;
          endpoint.lastCheck = new Date();

          if (endpoint.failureCount >= this.FAILURE_THRESHOLD) {
            endpoint.healthy = false;
            structuredLogger.warning('system', `RPC endpoint marked unhealthy: ${chain}`, {
              url: this.maskUrl(endpoint.url),
              failureCount: endpoint.failureCount,
            });
          }
        }
      }
    }
  }

  private updateLatency(endpoint: RpcEndpoint, latency: number): void {
    endpoint.latencyHistory.push(latency);
    if (endpoint.latencyHistory.length > this.LATENCY_HISTORY_SIZE) {
      endpoint.latencyHistory.shift();
    }
    endpoint.avgLatency =
      endpoint.latencyHistory.reduce((a, b) => a + b, 0) / endpoint.latencyHistory.length;
  }

  private getOrCreateClient(chain: ChainId, url: string): PublicClient {
    const key = `${chain}:${url}`;

    if (!this.clients.has(key)) {
      const chainConfig = CHAIN_CONFIG[chain];
      const client = createPublicClient({
        chain: chainConfig,
        transport: http(url, {
          timeout: 30000,
          retryCount: 0, // We handle retries ourselves
        }),
      });
      this.clients.set(key, client as PublicClient);
    }

    return this.clients.get(key)!;
  }

  private maskUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.pathname.length > 10) {
        return `${parsed.protocol}//${parsed.host}/${parsed.pathname.slice(0, 8)}...`;
      }
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return url.slice(0, 30) + '...';
    }
  }

  /**
   * Get the best available endpoint for a chain
   */
  private getBestEndpoint(chain: ChainId): RpcEndpoint | null {
    const endpoints = this.endpoints.get(chain) || [];

    // Filter healthy endpoints and sort by priority, then latency
    const healthyEndpoints = endpoints
      .filter((e) => e.healthy)
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return a.avgLatency - b.avgLatency;
      });

    if (healthyEndpoints.length === 0) {
      // Fall back to any endpoint if all are unhealthy
      return endpoints[0] || null;
    }

    return healthyEndpoints[0];
  }

  /**
   * Get a public client for a chain with automatic failover
   */
  async getClient(chain: ChainId): Promise<PublicClient> {
    const endpoint = this.getBestEndpoint(chain);

    if (!endpoint) {
      throw new Error(`No RPC endpoints available for ${chain}`);
    }

    return this.getOrCreateClient(chain, endpoint.url);
  }

  /**
   * Execute an RPC call with automatic retry and failover
   */
  async execute<T>(
    chain: ChainId,
    operation: (client: PublicClient) => Promise<T>
  ): Promise<T> {
    const endpoints = this.endpoints.get(chain) || [];
    const stats = this.stats.get(chain)!;

    // Sort endpoints by health and priority
    const sortedEndpoints = [...endpoints].sort((a, b) => {
      if (a.healthy !== b.healthy) {
        return a.healthy ? -1 : 1;
      }
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.avgLatency - b.avgLatency;
    });

    let lastError: Error | null = null;

    for (const endpoint of sortedEndpoints) {
      for (let retry = 0; retry < this.MAX_RETRIES; retry++) {
        try {
          const client = this.getOrCreateClient(chain, endpoint.url);
          const start = Date.now();

          stats.totalRequests++;
          const result = await operation(client);

          const latency = Date.now() - start;
          stats.successfulRequests++;
          stats.totalLatency += latency;
          this.updateLatency(endpoint, latency);

          // Reset failure count on success
          endpoint.failureCount = 0;
          endpoint.healthy = true;

          return result;
        } catch (error) {
          lastError = error as Error;
          endpoint.failureCount++;

          structuredLogger.warning('system', `RPC call failed, retrying`, {
            chain,
            url: this.maskUrl(endpoint.url),
            retry: retry + 1,
            maxRetries: this.MAX_RETRIES,
            error: (error as Error).message,
          });

          // Wait before retry with exponential backoff
          if (retry < this.MAX_RETRIES - 1) {
            await this.sleep(this.RETRY_DELAY_MS * Math.pow(2, retry));
          }
        }
      }

      // Mark endpoint as unhealthy after max retries
      if (endpoint.failureCount >= this.FAILURE_THRESHOLD) {
        endpoint.healthy = false;
      }

      // Failover to next endpoint
      stats.failovers++;
      structuredLogger.info('system', `Failing over to next RPC endpoint`, {
        chain,
        failedUrl: this.maskUrl(endpoint.url),
      });
    }

    stats.failedRequests++;
    throw new Error(`All RPC endpoints failed for ${chain}: ${lastError?.message}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get stats for a chain
   */
  getStats(chain: ChainId): ProviderStats & { endpoints: { url: string; healthy: boolean; avgLatency: number }[] } {
    const stats = this.stats.get(chain) || {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatency: 0,
      failovers: 0,
    };

    const endpoints = (this.endpoints.get(chain) || []).map((e) => ({
      url: this.maskUrl(e.url),
      healthy: e.healthy,
      avgLatency: Math.round(e.avgLatency),
    }));

    return { ...stats, endpoints };
  }

  /**
   * Get all stats
   */
  getAllStats(): Record<ChainId, ReturnType<typeof this.getStats>> {
    const result: Partial<Record<ChainId, ReturnType<typeof this.getStats>>> = {};

    for (const chain of ['ethereum', 'arbitrum', 'base', 'polygon'] as ChainId[]) {
      result[chain] = this.getStats(chain);
    }

    return result as Record<ChainId, ReturnType<typeof this.getStats>>;
  }

  /**
   * Manually mark an endpoint as unhealthy
   */
  markUnhealthy(chain: ChainId, url: string): void {
    const endpoints = this.endpoints.get(chain) || [];
    const endpoint = endpoints.find((e) => e.url === url);

    if (endpoint) {
      endpoint.healthy = false;
      endpoint.failureCount = this.FAILURE_THRESHOLD;
    }
  }

  /**
   * Add a custom endpoint
   */
  addEndpoint(chain: ChainId, url: string, priority: number = 1): void {
    const endpoints = this.endpoints.get(chain) || [];

    if (!endpoints.find((e) => e.url === url)) {
      endpoints.unshift({
        url,
        priority,
        healthy: true,
        lastCheck: new Date(),
        failureCount: 0,
        avgLatency: 0,
        latencyHistory: [],
      });

      this.endpoints.set(chain, endpoints);

      structuredLogger.info('system', `Added RPC endpoint`, {
        chain,
        url: this.maskUrl(url),
        priority,
      });
    }
  }

  /**
   * Shutdown the service
   */
  shutdown(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }
}

// Export singleton instance
export const rpcProvider = new RpcProviderService();
