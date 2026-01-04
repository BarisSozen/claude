/**
 * RPC Provider Integration Tests
 * Tests multi-endpoint failover, retry logic, and health monitoring
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock viem
vi.mock('viem', () => ({
  createPublicClient: vi.fn().mockReturnValue({
    getBlockNumber: vi.fn().mockResolvedValue(BigInt(12345678)),
    getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')),
  }),
  http: vi.fn().mockReturnValue({}),
}));

vi.mock('viem/chains', () => ({
  mainnet: { id: 1, name: 'Ethereum' },
  arbitrum: { id: 42161, name: 'Arbitrum' },
  base: { id: 8453, name: 'Base' },
  polygon: { id: 137, name: 'Polygon' },
}));

vi.mock('../../config/env.js', () => ({
  config: {
    server: { nodeEnv: 'test' },
    rpc: {
      ethereum: 'https://eth.test.com',
      arbitrum: 'https://arb.test.com',
      base: undefined,
      polygon: undefined,
    },
  },
}));

vi.mock('../../services/logger.js', () => ({
  structuredLogger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('RPC Provider Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initialize with configured endpoints', async () => {
    const { rpcProvider } = await import('../../services/rpc-provider.js');

    const stats = rpcProvider.getStats('ethereum');
    expect(stats.endpoints.length).toBeGreaterThan(0);
    expect(stats.totalRequests).toBe(0);
  });

  it('should execute RPC calls successfully', async () => {
    const { rpcProvider } = await import('../../services/rpc-provider.js');
    const { createPublicClient } = await import('viem');

    const mockClient = {
      getBlockNumber: vi.fn().mockResolvedValue(BigInt(12345678)),
    };
    (createPublicClient as any).mockReturnValue(mockClient);

    const result = await rpcProvider.execute('ethereum', async (client) => {
      return client.getBlockNumber();
    });

    expect(result).toBe(BigInt(12345678));
  });

  it('should track request statistics', async () => {
    const { rpcProvider } = await import('../../services/rpc-provider.js');
    const { createPublicClient } = await import('viem');

    const mockClient = {
      getBlockNumber: vi.fn().mockResolvedValue(BigInt(12345678)),
    };
    (createPublicClient as any).mockReturnValue(mockClient);

    await rpcProvider.execute('ethereum', async (client) => {
      return client.getBlockNumber();
    });

    const stats = rpcProvider.getStats('ethereum');
    expect(stats.totalRequests).toBeGreaterThan(0);
    expect(stats.successfulRequests).toBeGreaterThan(0);
  });

  it('should retry on failure', async () => {
    const { rpcProvider } = await import('../../services/rpc-provider.js');
    const { createPublicClient } = await import('viem');

    let callCount = 0;
    const mockClient = {
      getBlockNumber: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 2) {
          throw new Error('Network error');
        }
        return BigInt(12345678);
      }),
    };
    (createPublicClient as any).mockReturnValue(mockClient);

    // Allow timers to pass for retry delays
    const promise = rpcProvider.execute('ethereum', async (client) => {
      return client.getBlockNumber();
    });

    // Fast-forward timers for retries
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toBe(BigInt(12345678));
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('should provide health statistics', async () => {
    const { rpcProvider } = await import('../../services/rpc-provider.js');

    const allStats = rpcProvider.getAllStats();

    expect(allStats.ethereum).toBeDefined();
    expect(allStats.arbitrum).toBeDefined();
    expect(allStats.base).toBeDefined();
    expect(allStats.polygon).toBeDefined();
  });

  it('should add custom endpoints', async () => {
    const { rpcProvider } = await import('../../services/rpc-provider.js');

    const initialStats = rpcProvider.getStats('ethereum');
    const initialCount = initialStats.endpoints.length;

    rpcProvider.addEndpoint('ethereum', 'https://custom-rpc.test.com', 0);

    const newStats = rpcProvider.getStats('ethereum');
    expect(newStats.endpoints.length).toBe(initialCount + 1);
  });
});
