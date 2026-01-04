/**
 * LiquidityDepthAnalyzer Tests
 */

import { LiquidityDepthAnalyzer } from '../src/analyzer';
import { AbortReason, PoolAdapter, PoolReserves, LiquidityDepth, Token } from '../src/types';

// Mock adapter for testing
class MockAdapter implements PoolAdapter {
  private reserves: PoolReserves;
  private spotPrice: number;

  constructor(options: {
    reserve0: bigint;
    reserve1: bigint;
    spotPrice: number;
    timestamp?: number;
  }) {
    this.spotPrice = options.spotPrice;
    this.reserves = {
      token0: { address: '0xtoken0', symbol: 'TKN0', decimals: 18 },
      token1: { address: '0xtoken1', symbol: 'TKN1', decimals: 18 },
      reserve0: options.reserve0,
      reserve1: options.reserve1,
      blockNumber: 12345678,
      timestamp: options.timestamp ?? Math.floor(Date.now() / 1000),
    };
  }

  async getReserves(): Promise<PoolReserves> {
    return this.reserves;
  }

  async getAmountOut(amountIn: bigint): Promise<bigint> {
    // Simple constant product simulation
    const reserveIn = this.reserves.reserve0;
    const reserveOut = this.reserves.reserve1;
    const amountInWithFee = amountIn * 997n;
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * 1000n + amountInWithFee;
    return numerator / denominator;
  }

  async getAmountIn(amountOut: bigint): Promise<bigint> {
    const reserveIn = this.reserves.reserve0;
    const reserveOut = this.reserves.reserve1;
    const numerator = reserveIn * amountOut * 1000n;
    const denominator = (reserveOut - amountOut) * 997n;
    return numerator / denominator + 1n;
  }

  async getSpotPrice(): Promise<number> {
    return this.spotPrice;
  }

  async getLiquidityDepth(
    _tokenIn: string,
    _tokenOut: string,
    _poolAddress: string,
    priceLevels: number[]
  ): Promise<LiquidityDepth[]> {
    return priceLevels.map((price, i) => ({
      price,
      liquidity: BigInt(1000e18),
      cumulativeLiquidity: BigInt((i + 1) * 1000e18),
    }));
  }
}

describe('LiquidityDepthAnalyzer', () => {
  let analyzer: LiquidityDepthAnalyzer;
  const token0: Token = { address: '0xtoken0', symbol: 'TKN0', decimals: 18 };
  const token1: Token = { address: '0xtoken1', symbol: 'TKN1', decimals: 18 };

  beforeEach(() => {
    analyzer = new LiquidityDepthAnalyzer({
      maxPriceImpactBps: 50,
      maxSlippageBps: 100,
      minDepthMultiplier: 3,
      maxDataAgeSec: 12,
      minProfitBps: 10,
    });
  });

  describe('configuration', () => {
    it('should use default config when none provided', () => {
      const defaultAnalyzer = new LiquidityDepthAnalyzer();
      const config = defaultAnalyzer.getConfig();
      expect(config.maxPriceImpactBps).toBe(50);
      expect(config.maxSlippageBps).toBe(100);
    });

    it('should allow config updates', () => {
      analyzer.updateConfig({ maxPriceImpactBps: 100 });
      expect(analyzer.getConfig().maxPriceImpactBps).toBe(100);
    });
  });

  describe('adapter registration', () => {
    it('should register and retrieve adapters', () => {
      const adapter = new MockAdapter({
        reserve0: BigInt(100e18),
        reserve1: BigInt(100e18),
        spotPrice: 1,
      });

      analyzer.registerAdapter('test', adapter);
      expect(analyzer.getAdapter('test')).toBe(adapter);
      expect(analyzer.getAdapter('TEST')).toBe(adapter); // Case insensitive
    });

    it('should return undefined for unregistered adapters', () => {
      expect(analyzer.getAdapter('nonexistent')).toBeUndefined();
    });
  });

  describe('analyzeTrade', () => {
    it('should abort when no adapter registered', async () => {
      const result = await analyzer.analyzeTrade({
        poolAddress: '0xpool',
        adapterKey: 'unregistered',
        tokenIn: token0,
        tokenOut: token1,
        amountIn: BigInt(1e18),
      });

      expect(result.shouldExecute).toBe(false);
      expect(result.abortReason).toBe(AbortReason.NO_POOL);
    });

    it('should abort when data is stale', async () => {
      const staleAdapter = new MockAdapter({
        reserve0: BigInt(1000e18),
        reserve1: BigInt(1000e18),
        spotPrice: 1,
        timestamp: Math.floor(Date.now() / 1000) - 60, // 60 seconds ago
      });

      analyzer.registerAdapter('stale', staleAdapter);

      const result = await analyzer.analyzeTrade({
        poolAddress: '0xpool',
        adapterKey: 'stale',
        tokenIn: token0,
        tokenOut: token1,
        amountIn: BigInt(1e18),
      });

      expect(result.shouldExecute).toBe(false);
      expect(result.abortReason).toBe(AbortReason.STALE_DATA);
    });

    it('should abort when depth is insufficient', async () => {
      const shallowAdapter = new MockAdapter({
        reserve0: BigInt(10e18), // Only 10 tokens
        reserve1: BigInt(10e18),
        spotPrice: 1,
      });

      analyzer.registerAdapter('shallow', shallowAdapter);

      const result = await analyzer.analyzeTrade({
        poolAddress: '0xpool',
        adapterKey: 'shallow',
        tokenIn: token0,
        tokenOut: token1,
        amountIn: BigInt(5e18), // Trading 5 tokens with only 10 in pool (2x < 3x required)
      });

      expect(result.shouldExecute).toBe(false);
      expect(result.abortReason).toBe(AbortReason.LOW_DEPTH);
    });

    it('should approve trade with sufficient liquidity', async () => {
      const deepAdapter = new MockAdapter({
        reserve0: BigInt(1000e18),
        reserve1: BigInt(1000e18),
        spotPrice: 1,
      });

      analyzer.registerAdapter('deep', deepAdapter);

      const result = await analyzer.analyzeTrade({
        poolAddress: '0xpool',
        adapterKey: 'deep',
        tokenIn: token0,
        tokenOut: token1,
        amountIn: BigInt(1e18), // Small trade relative to pool
      });

      expect(result.shouldExecute).toBe(true);
      expect(result.depthMultiplier).toBeGreaterThan(3);
      expect(result.confidence).toBeGreaterThan(0);
    });
  });

  describe('quickViabilityCheck', () => {
    it('should return viable for deep pool', async () => {
      const adapter = new MockAdapter({
        reserve0: BigInt(1000e18),
        reserve1: BigInt(1000e18),
        spotPrice: 1,
      });

      analyzer.registerAdapter('test', adapter);

      const result = await analyzer.quickViabilityCheck({
        poolAddress: '0xpool',
        adapterKey: 'test',
        tradeSize: BigInt(10e18),
      });

      expect(result.viable).toBe(true);
    });

    it('should return not viable for shallow pool', async () => {
      const adapter = new MockAdapter({
        reserve0: BigInt(10e18),
        reserve1: BigInt(10e18),
        spotPrice: 1,
      });

      analyzer.registerAdapter('test', adapter);

      const result = await analyzer.quickViabilityCheck({
        poolAddress: '0xpool',
        adapterKey: 'test',
        tradeSize: BigInt(10e18),
      });

      expect(result.viable).toBe(false);
      expect(result.reason).toContain('depth');
    });
  });

  describe('analyzeRoute', () => {
    it('should handle empty route', async () => {
      const result = await analyzer.analyzeRoute({
        segments: [],
        adapterKeys: [],
        amountIn: BigInt(1e18),
      });

      expect(result.shouldExecute).toBe(false);
      expect(result.abortReason).toBe(AbortReason.NO_POOL);
    });

    it('should analyze single-hop route', async () => {
      const adapter = new MockAdapter({
        reserve0: BigInt(1000e18),
        reserve1: BigInt(1000e18),
        spotPrice: 1,
      });

      analyzer.registerAdapter('test', adapter);

      const result = await analyzer.analyzeRoute({
        segments: [
          {
            poolAddress: '0xpool',
            poolType: 0 as any,
            tokenIn: token0,
            tokenOut: token1,
          },
        ],
        adapterKeys: ['test'],
        amountIn: BigInt(1e18),
      });

      expect(result.shouldExecute).toBe(true);
      expect(result.expectedOutput).toBeGreaterThan(0n);
    });
  });

  describe('getLiquidityDepthAnalysis', () => {
    it('should return depth at price levels', async () => {
      const adapter = new MockAdapter({
        reserve0: BigInt(1000e18),
        reserve1: BigInt(1000e18),
        spotPrice: 1,
      });

      analyzer.registerAdapter('test', adapter);

      const depths = await analyzer.getLiquidityDepthAnalysis({
        poolAddress: '0xpool',
        adapterKey: 'test',
        tokenIn: '0xtoken0',
        tokenOut: '0xtoken1',
      });

      expect(depths.length).toBeGreaterThan(0);
      expect(depths[0].price).toBeDefined();
      expect(depths[0].liquidity).toBeDefined();
    });

    it('should return empty array for missing adapter', async () => {
      const depths = await analyzer.getLiquidityDepthAnalysis({
        poolAddress: '0xpool',
        adapterKey: 'missing',
        tokenIn: '0xtoken0',
        tokenOut: '0xtoken1',
      });

      expect(depths).toEqual([]);
    });
  });
});
