/**
 * Dynamic Gas Estimation Service
 * Real-time gas price estimation with EIP-1559 support
 * Includes priority fee optimization for MEV bundles
 */

import {
  createPublicClient,
  http,
  formatGwei,
  parseGwei,
  type Address,
  type Hex,
} from 'viem';
import { mainnet, arbitrum, base, polygon } from 'viem/chains';
import { getRpcUrl } from '../config/env.js';
import type { ChainId } from '../../shared/schema.js';

interface GasEstimate {
  baseFee: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  estimatedCostWei: bigint;
  estimatedCostUSD: number;
  confidence: 'low' | 'medium' | 'high';
}

interface GasPriceHistory {
  timestamp: number;
  baseFee: bigint;
  priorityFee: bigint;
}

// Gas limits for common operations
const GAS_LIMITS: Record<string, bigint> = {
  // Swaps
  'uniswap-v2-swap': 150000n,
  'uniswap-v3-swap': 180000n,
  'sushiswap-swap': 150000n,
  'curve-swap': 300000n,

  // Flash loans
  'aave-flash-loan': 500000n,
  'aave-flash-loan-callback': 800000n,

  // Approvals
  'erc20-approve': 50000n,

  // Multi-hop routes
  '2-hop-swap': 350000n,
  '3-hop-swap': 500000n,

  // Arbitrage bundles
  'cross-dex-arb': 400000n,
  'triangular-arb': 600000n,
  'flash-loan-arb': 1000000n,
};

class GasEstimatorService {
  private clients: Map<ChainId, ReturnType<typeof createPublicClient>> = new Map();
  private priceHistory: Map<ChainId, GasPriceHistory[]> = new Map();
  private maxHistorySize = 100;

  // ETH price cache (updated by price oracle)
  private ethPriceUSD = 2000;

  /**
   * Get public client for a chain
   */
  private getClient(chainId: ChainId) {
    let client = this.clients.get(chainId);

    if (!client) {
      const chains: Record<ChainId, typeof mainnet> = {
        ethereum: mainnet,
        arbitrum: arbitrum,
        base: base,
        polygon: polygon,
      };

      client = createPublicClient({
        chain: chains[chainId],
        transport: http(getRpcUrl(chainId)),
      });
      this.clients.set(chainId, client);
    }

    return client;
  }

  /**
   * Get current gas prices from the network
   */
  async getCurrentGasPrices(chainId: ChainId): Promise<{
    baseFee: bigint;
    priorityFee: bigint;
    gasPrice: bigint;
  }> {
    const client = this.getClient(chainId);

    try {
      // Get latest block for base fee
      const block = await client.getBlock({ blockTag: 'latest' });
      const baseFee = block.baseFeePerGas ?? 0n;

      // Get fee history for priority fee estimation
      const feeHistory = await client.getFeeHistory({
        blockCount: 10,
        rewardPercentiles: [25, 50, 75],
      });

      // Use median priority fee
      const priorityFees = feeHistory.reward
        ?.map(r => r[1]) // 50th percentile
        .filter((f): f is bigint => f !== undefined) ?? [];

      const medianPriorityFee = priorityFees.length > 0
        ? priorityFees.sort((a, b) => Number(a - b))[Math.floor(priorityFees.length / 2)]
        : parseGwei('2'); // Default 2 gwei

      // Record history
      this.recordGasPrice(chainId, baseFee, medianPriorityFee);

      return {
        baseFee,
        priorityFee: medianPriorityFee,
        gasPrice: baseFee + medianPriorityFee,
      };
    } catch (error) {
      // Fallback to legacy gas price
      const gasPrice = await client.getGasPrice();
      return {
        baseFee: gasPrice,
        priorityFee: 0n,
        gasPrice,
      };
    }
  }

  /**
   * Estimate gas for a specific operation
   */
  async estimateGas(
    chainId: ChainId,
    operation: string,
    params?: {
      to?: Address;
      data?: Hex;
      value?: bigint;
      from?: Address;
    }
  ): Promise<GasEstimate> {
    const client = this.getClient(chainId);
    const { baseFee, priorityFee } = await this.getCurrentGasPrices(chainId);

    // Get gas limit from predefined or estimate
    let gasLimit: bigint;

    if (GAS_LIMITS[operation]) {
      gasLimit = GAS_LIMITS[operation];
    } else if (params?.to && params?.data) {
      try {
        gasLimit = await client.estimateGas({
          to: params.to,
          data: params.data,
          value: params.value,
          account: params.from,
        });
        // Add 20% buffer
        gasLimit = (gasLimit * 120n) / 100n;
      } catch {
        // Default fallback
        gasLimit = 200000n;
      }
    } else {
      gasLimit = 200000n;
    }

    // Calculate fees with buffer
    const maxPriorityFeePerGas = (priorityFee * 120n) / 100n; // 20% buffer
    const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas; // 2x base fee + priority

    // Estimate cost
    const estimatedCostWei = gasLimit * (baseFee + maxPriorityFeePerGas);
    const estimatedCostUSD = Number(estimatedCostWei) / 1e18 * this.ethPriceUSD;

    // Determine confidence based on network conditions
    const confidence = this.assessConfidence(chainId, baseFee);

    return {
      baseFee,
      maxPriorityFeePerGas,
      maxFeePerGas,
      gasLimit,
      estimatedCostWei,
      estimatedCostUSD,
      confidence,
    };
  }

  /**
   * Estimate gas cost in USD for an operation
   */
  async estimateCostUSD(chainId: ChainId, operation: string): Promise<number> {
    const estimate = await this.estimateGas(chainId, operation);
    return estimate.estimatedCostUSD;
  }

  /**
   * Get optimal gas parameters for MEV bundles
   * Higher priority fees for faster inclusion
   */
  async getMevGasParams(
    chainId: ChainId,
    expectedProfitWei: bigint,
    gasLimit: bigint
  ): Promise<{
    maxPriorityFeePerGas: bigint;
    maxFeePerGas: bigint;
    bribeAmount: bigint;
  }> {
    const { baseFee } = await this.getCurrentGasPrices(chainId);

    // Calculate optimal bribe: 70% of profit goes to miner
    const bribePercent = 70n;
    const totalBribe = (expectedProfitWei * bribePercent) / 100n;

    // Calculate priority fee from bribe
    const maxPriorityFeePerGas = gasLimit > 0n ? totalBribe / gasLimit : parseGwei('50');

    // Ensure minimum priority fee (10 gwei for MEV)
    const minMevPriorityFee = parseGwei('10');
    const effectivePriorityFee = maxPriorityFeePerGas > minMevPriorityFee
      ? maxPriorityFeePerGas
      : minMevPriorityFee;

    // Max fee includes significant buffer for base fee spikes
    const maxFeePerGas = baseFee * 3n + effectivePriorityFee;

    return {
      maxPriorityFeePerGas: effectivePriorityFee,
      maxFeePerGas,
      bribeAmount: effectivePriorityFee * gasLimit,
    };
  }

  /**
   * Check if current gas prices are favorable
   */
  async isGasFavorable(chainId: ChainId, maxGasGwei: number = 50): Promise<boolean> {
    const { baseFee } = await this.getCurrentGasPrices(chainId);
    return baseFee <= parseGwei(maxGasGwei.toString());
  }

  /**
   * Get gas price trend
   */
  getGasTrend(chainId: ChainId): 'rising' | 'falling' | 'stable' {
    const history = this.priceHistory.get(chainId) ?? [];

    if (history.length < 5) {
      return 'stable';
    }

    const recent = history.slice(-5);
    const older = history.slice(-10, -5);

    if (older.length === 0) {
      return 'stable';
    }

    const recentAvg = recent.reduce((sum, h) => sum + Number(h.baseFee), 0) / recent.length;
    const olderAvg = older.reduce((sum, h) => sum + Number(h.baseFee), 0) / older.length;

    const changePercent = ((recentAvg - olderAvg) / olderAvg) * 100;

    if (changePercent > 10) return 'rising';
    if (changePercent < -10) return 'falling';
    return 'stable';
  }

  /**
   * Wait for gas to drop below threshold
   */
  async waitForLowGas(
    chainId: ChainId,
    maxGasGwei: number,
    timeoutMs: number = 300000 // 5 minutes
  ): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const isFavorable = await this.isGasFavorable(chainId, maxGasGwei);

      if (isFavorable) {
        return true;
      }

      // Wait 12 seconds (roughly 1 block)
      await new Promise(resolve => setTimeout(resolve, 12000));
    }

    return false;
  }

  /**
   * Calculate total gas cost for multi-step arbitrage
   */
  async estimateArbitrageCost(
    chainId: ChainId,
    steps: string[]
  ): Promise<{
    totalGasLimit: bigint;
    totalCostWei: bigint;
    totalCostUSD: number;
    breakdown: Array<{ operation: string; gasLimit: bigint; costUSD: number }>;
  }> {
    const { baseFee, priorityFee } = await this.getCurrentGasPrices(chainId);
    const gasPrice = baseFee + priorityFee;

    const breakdown: Array<{ operation: string; gasLimit: bigint; costUSD: number }> = [];
    let totalGasLimit = 0n;

    for (const step of steps) {
      const gasLimit = GAS_LIMITS[step] ?? 200000n;
      const costWei = gasLimit * gasPrice;
      const costUSD = Number(costWei) / 1e18 * this.ethPriceUSD;

      breakdown.push({ operation: step, gasLimit, costUSD });
      totalGasLimit += gasLimit;
    }

    const totalCostWei = totalGasLimit * gasPrice;
    const totalCostUSD = Number(totalCostWei) / 1e18 * this.ethPriceUSD;

    return {
      totalGasLimit,
      totalCostWei,
      totalCostUSD,
      breakdown,
    };
  }

  /**
   * Update ETH price for USD calculations
   */
  setEthPrice(priceUSD: number): void {
    this.ethPriceUSD = priceUSD;
  }

  /**
   * Record gas price to history
   */
  private recordGasPrice(chainId: ChainId, baseFee: bigint, priorityFee: bigint): void {
    let history = this.priceHistory.get(chainId);

    if (!history) {
      history = [];
      this.priceHistory.set(chainId, history);
    }

    history.push({
      timestamp: Date.now(),
      baseFee,
      priorityFee,
    });

    // Trim history
    if (history.length > this.maxHistorySize) {
      this.priceHistory.set(chainId, history.slice(-this.maxHistorySize));
    }
  }

  /**
   * Assess confidence in gas estimate
   */
  private assessConfidence(chainId: ChainId, currentBaseFee: bigint): 'low' | 'medium' | 'high' {
    const trend = this.getGasTrend(chainId);

    if (trend === 'rising') {
      return 'low'; // Gas is rising, estimate may be low
    }

    if (trend === 'falling') {
      return 'high'; // Gas is falling, estimate should be sufficient
    }

    // Check volatility
    const history = this.priceHistory.get(chainId) ?? [];

    if (history.length < 5) {
      return 'medium';
    }

    const recent = history.slice(-5);
    const fees = recent.map(h => Number(h.baseFee));
    const mean = fees.reduce((a, b) => a + b, 0) / fees.length;
    const variance = fees.reduce((sum, f) => sum + Math.pow(f - mean, 2), 0) / fees.length;
    const volatility = Math.sqrt(variance) / mean;

    if (volatility > 0.2) {
      return 'low'; // High volatility
    }

    if (volatility < 0.05) {
      return 'high'; // Low volatility
    }

    return 'medium';
  }

  /**
   * Get gas statistics
   */
  getGasStats(chainId: ChainId): {
    avgBaseFee: bigint;
    minBaseFee: bigint;
    maxBaseFee: bigint;
    dataPoints: number;
  } {
    const history = this.priceHistory.get(chainId) ?? [];

    if (history.length === 0) {
      return {
        avgBaseFee: 0n,
        minBaseFee: 0n,
        maxBaseFee: 0n,
        dataPoints: 0,
      };
    }

    const fees = history.map(h => h.baseFee);
    const sum = fees.reduce((a, b) => a + b, 0n);

    return {
      avgBaseFee: sum / BigInt(fees.length),
      minBaseFee: fees.reduce((min, f) => f < min ? f : min, fees[0]),
      maxBaseFee: fees.reduce((max, f) => f > max ? f : max, fees[0]),
      dataPoints: history.length,
    };
  }
}

export const gasEstimatorService = new GasEstimatorService();
export type { GasEstimate };
