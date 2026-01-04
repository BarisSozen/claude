/**
 * Curve Pool Adapter
 * Adapter for Curve's StableSwap AMM
 */

import { ethers } from 'ethers';
import {
  CurvePoolData,
  LiquidityDepth,
  PoolAdapter,
  PoolReserves,
  Token,
} from '../types';

const CURVE_POOL_ABI = [
  'function get_virtual_price() external view returns (uint256)',
  'function A() external view returns (uint256)',
  'function fee() external view returns (uint256)',
  'function coins(uint256 i) external view returns (address)',
  'function balances(uint256 i) external view returns (uint256)',
  'function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256)',
  'function get_dx(int128 i, int128 j, uint256 dy) external view returns (uint256)',
];

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

export interface CurveAdapterConfig {
  provider: ethers.Provider;
  numCoins?: number;
}

/**
 * Curve Pool Adapter
 * Optimized for stable pairs with low slippage
 */
export class CurveAdapter implements PoolAdapter {
  private provider: ethers.Provider;
  private numCoins: number;
  private tokenCache: Map<string, Token> = new Map();
  private coinIndexCache: Map<string, Map<string, number>> = new Map();

  constructor(config: CurveAdapterConfig) {
    this.provider = config.provider;
    this.numCoins = config.numCoins ?? 2;
  }

  /**
   * Get token info with caching
   */
  private async getTokenInfo(address: string): Promise<Token> {
    const cached = this.tokenCache.get(address.toLowerCase());
    if (cached) return cached;

    const contract = new ethers.Contract(address, ERC20_ABI, this.provider);
    const [decimals, symbol] = await Promise.all([
      contract.decimals(),
      contract.symbol(),
    ]);

    const token: Token = {
      address: address.toLowerCase(),
      decimals: Number(decimals),
      symbol,
    };

    this.tokenCache.set(address.toLowerCase(), token);
    return token;
  }

  /**
   * Get coin index for a token in a pool
   */
  private async getCoinIndex(poolAddress: string, tokenAddress: string): Promise<number> {
    const poolCache = this.coinIndexCache.get(poolAddress.toLowerCase()) ?? new Map();

    const cached = poolCache.get(tokenAddress.toLowerCase());
    if (cached !== undefined) return cached;

    const pool = new ethers.Contract(poolAddress, CURVE_POOL_ABI, this.provider);

    for (let i = 0; i < this.numCoins; i++) {
      try {
        const coinAddress = await pool.coins(i);
        if (coinAddress.toLowerCase() === tokenAddress.toLowerCase()) {
          poolCache.set(tokenAddress.toLowerCase(), i);
          this.coinIndexCache.set(poolAddress.toLowerCase(), poolCache);
          return i;
        }
      } catch {
        break;
      }
    }

    throw new Error(`Token ${tokenAddress} not found in pool ${poolAddress}`);
  }

  /**
   * Get Curve pool data
   */
  async getCurvePoolData(poolAddress: string): Promise<CurvePoolData> {
    const pool = new ethers.Contract(poolAddress, CURVE_POOL_ABI, this.provider);

    const [A, fee, block] = await Promise.all([
      pool.A(),
      pool.fee(),
      this.provider.getBlock('latest'),
    ]);

    const tokens: Token[] = [];
    const balances: bigint[] = [];

    for (let i = 0; i < this.numCoins; i++) {
      try {
        const [coinAddress, balance] = await Promise.all([
          pool.coins(i),
          pool.balances(i),
        ]);
        const token = await this.getTokenInfo(coinAddress);
        tokens.push(token);
        balances.push(BigInt(balance));
      } catch {
        break;
      }
    }

    return {
      tokens,
      balances,
      amplificationCoefficient: BigInt(A),
      fee: Number(fee) / 1e10, // Curve fee is in 1e10
      blockNumber: block?.number ?? 0,
      timestamp: block?.timestamp ?? Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Get pool reserves (first two tokens for interface compatibility)
   */
  async getReserves(poolAddress: string): Promise<PoolReserves> {
    const data = await this.getCurvePoolData(poolAddress);

    if (data.tokens.length < 2) {
      throw new Error('Curve pool must have at least 2 tokens');
    }

    return {
      token0: data.tokens[0],
      token1: data.tokens[1],
      reserve0: data.balances[0],
      reserve1: data.balances[1],
      blockNumber: data.blockNumber,
      timestamp: data.timestamp,
    };
  }

  /**
   * Calculate output amount using Curve's get_dy
   */
  async getAmountOut(
    amountIn: bigint,
    tokenIn: string,
    tokenOut: string,
    poolAddress: string
  ): Promise<bigint> {
    const pool = new ethers.Contract(poolAddress, CURVE_POOL_ABI, this.provider);

    const [i, j] = await Promise.all([
      this.getCoinIndex(poolAddress, tokenIn),
      this.getCoinIndex(poolAddress, tokenOut),
    ]);

    try {
      const dy = await pool.get_dy(i, j, amountIn);
      return BigInt(dy);
    } catch {
      return 0n;
    }
  }

  /**
   * Calculate input amount using Curve's get_dx
   */
  async getAmountIn(
    amountOut: bigint,
    tokenIn: string,
    tokenOut: string,
    poolAddress: string
  ): Promise<bigint> {
    const pool = new ethers.Contract(poolAddress, CURVE_POOL_ABI, this.provider);

    const [i, j] = await Promise.all([
      this.getCoinIndex(poolAddress, tokenIn),
      this.getCoinIndex(poolAddress, tokenOut),
    ]);

    try {
      const dx = await pool.get_dx(i, j, amountOut);
      return BigInt(dx);
    } catch {
      // Fallback: binary search for input amount
      return this.binarySearchAmountIn(amountOut, tokenIn, tokenOut, poolAddress);
    }
  }

  /**
   * Binary search for input amount when get_dx is not available
   */
  private async binarySearchAmountIn(
    targetOutput: bigint,
    tokenIn: string,
    tokenOut: string,
    poolAddress: string
  ): Promise<bigint> {
    let low = 0n;
    let high = targetOutput * 2n; // Start with 2x output as upper bound
    const tolerance = targetOutput / 1000n; // 0.1% tolerance

    for (let i = 0; i < 256; i++) {
      const mid = (low + high) / 2n;
      const output = await this.getAmountOut(mid, tokenIn, tokenOut, poolAddress);

      if (output >= targetOutput - tolerance && output <= targetOutput + tolerance) {
        return mid;
      }

      if (output < targetOutput) {
        low = mid + 1n;
      } else {
        high = mid - 1n;
      }
    }

    return high;
  }

  /**
   * Get spot price (ratio of balances adjusted for decimals)
   * For stable pools, this is close to 1:1
   */
  async getSpotPrice(
    tokenIn: string,
    tokenOut: string,
    poolAddress: string
  ): Promise<number> {
    const data = await this.getCurvePoolData(poolAddress);

    const [i, j] = await Promise.all([
      this.getCoinIndex(poolAddress, tokenIn),
      this.getCoinIndex(poolAddress, tokenOut),
    ]);

    const balanceIn = Number(data.balances[i]) / Math.pow(10, data.tokens[i].decimals);
    const balanceOut = Number(data.balances[j]) / Math.pow(10, data.tokens[j].decimals);

    // For stable pools, spot price is approximately 1
    // More accurate would be to calculate derivative of StableSwap invariant
    // Using small trade to estimate
    const smallAmount = BigInt(Math.floor(Math.pow(10, data.tokens[i].decimals)));
    const smallOutput = await this.getAmountOut(smallAmount, tokenIn, tokenOut, poolAddress);

    const normalizedIn = Number(smallAmount) / Math.pow(10, data.tokens[i].decimals);
    const normalizedOut = Number(smallOutput) / Math.pow(10, data.tokens[j].decimals);

    return normalizedIn / normalizedOut;
  }

  /**
   * Get liquidity depth
   */
  async getLiquidityDepth(
    tokenIn: string,
    tokenOut: string,
    poolAddress: string,
    priceLevels: number[]
  ): Promise<LiquidityDepth[]> {
    const data = await this.getCurvePoolData(poolAddress);
    const spotPrice = await this.getSpotPrice(tokenIn, tokenOut, poolAddress);

    const j = await this.getCoinIndex(poolAddress, tokenOut);
    const tokenOutBalance = data.balances[j];

    const depths: LiquidityDepth[] = [];
    let cumulativeLiquidity = 0n;

    // Curve has very deep liquidity near spot price for stable pairs
    for (const targetPrice of priceLevels.sort((a, b) => a - b)) {
      const priceDeviation = Math.abs(targetPrice - spotPrice) / spotPrice;

      // Curve maintains deep liquidity even at price deviations
      // This is a simplified model; real depth depends on A parameter
      const depthFactor = Math.exp(-priceDeviation * Number(data.amplificationCoefficient) / 100);
      const liquidityAtLevel = BigInt(
        Math.floor(Number(tokenOutBalance) * depthFactor * priceDeviation)
      );

      cumulativeLiquidity += liquidityAtLevel;

      depths.push({
        price: targetPrice,
        liquidity: liquidityAtLevel,
        cumulativeLiquidity,
      });
    }

    return depths;
  }
}

export default CurveAdapter;
