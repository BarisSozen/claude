/**
 * UniswapV3 Pool Adapter
 * Adapter for UniswapV3 concentrated liquidity AMM
 */

import { ethers } from 'ethers';
import {
  LiquidityDepth,
  PoolAdapter,
  PoolReserves,
  Token,
  V3PoolData,
} from '../types';

const UNISWAP_V3_POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
  'function tickSpacing() external view returns (int24)',
  'function ticks(int24 tick) external view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)',
];

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

// Q96 for fixed point math
const Q96 = 2n ** 96n;

export interface UniswapV3AdapterConfig {
  provider: ethers.Provider;
}

/**
 * UniswapV3 Pool Adapter
 * Handles concentrated liquidity positions
 */
export class UniswapV3Adapter implements PoolAdapter {
  private provider: ethers.Provider;
  private tokenCache: Map<string, Token> = new Map();
  private poolDataCache: Map<string, V3PoolData> = new Map();

  constructor(config: UniswapV3AdapterConfig) {
    this.provider = config.provider;
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
   * Get V3 pool data
   */
  async getV3PoolData(poolAddress: string): Promise<V3PoolData> {
    const pool = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, this.provider);

    const [slot0, liquidity, token0Address, token1Address, fee, tickSpacing, block] = await Promise.all([
      pool.slot0(),
      pool.liquidity(),
      pool.token0(),
      pool.token1(),
      pool.fee(),
      pool.tickSpacing(),
      this.provider.getBlock('latest'),
    ]);

    const [token0, token1] = await Promise.all([
      this.getTokenInfo(token0Address),
      this.getTokenInfo(token1Address),
    ]);

    // Calculate virtual reserves from sqrtPriceX96 and liquidity
    const sqrtPriceX96 = BigInt(slot0.sqrtPriceX96);
    const L = BigInt(liquidity);

    // reserve0 = L / sqrtPrice, reserve1 = L * sqrtPrice
    const reserve0 = L * Q96 / sqrtPriceX96;
    const reserve1 = L * sqrtPriceX96 / Q96;

    return {
      token0,
      token1,
      reserve0,
      reserve1,
      blockNumber: block?.number ?? 0,
      timestamp: block?.timestamp ?? Math.floor(Date.now() / 1000),
      sqrtPriceX96,
      liquidity: L,
      tick: Number(slot0.tick),
      fee: Number(fee),
      tickSpacing: Number(tickSpacing),
    };
  }

  /**
   * Get pool reserves (virtual reserves for V3)
   */
  async getReserves(poolAddress: string): Promise<PoolReserves> {
    const data = await this.getV3PoolData(poolAddress);
    return {
      token0: data.token0,
      token1: data.token1,
      reserve0: data.reserve0,
      reserve1: data.reserve1,
      blockNumber: data.blockNumber,
      timestamp: data.timestamp,
    };
  }

  /**
   * Calculate output amount for given input
   * Uses simplified V3 math assuming infinite liquidity in current tick range
   */
  async getAmountOut(
    amountIn: bigint,
    tokenIn: string,
    tokenOut: string,
    poolAddress: string
  ): Promise<bigint> {
    const data = await this.getV3PoolData(poolAddress);

    const isToken0In = tokenIn.toLowerCase() === data.token0.address.toLowerCase();
    const feeBps = data.fee / 100; // Convert from 1e6 to bps

    // Fee deduction
    const amountInAfterFee = amountIn * (10000n - BigInt(feeBps)) / 10000n;

    if (isToken0In) {
      // Swapping token0 for token1
      // Using x * y = k approximation for the current liquidity
      // More accurate would be tick-by-tick simulation
      const sqrtPriceX96 = data.sqrtPriceX96;
      const L = data.liquidity;

      // New sqrt price after swap: L / (L / sqrtPrice + amountIn)
      const sqrtPriceOld = sqrtPriceX96;
      const denominator = L * Q96 / sqrtPriceOld + amountInAfterFee;
      const sqrtPriceNew = L * Q96 / denominator;

      // Amount out = L * (sqrtPriceOld - sqrtPriceNew) / Q96
      const amountOut = L * (sqrtPriceOld - sqrtPriceNew) / Q96;
      return amountOut > 0n ? amountOut : 0n;
    } else {
      // Swapping token1 for token0
      const sqrtPriceOld = data.sqrtPriceX96;
      const L = data.liquidity;

      // New sqrt price: sqrtPrice + amountIn * Q96 / L
      const sqrtPriceDelta = amountInAfterFee * Q96 / L;
      const sqrtPriceNew = sqrtPriceOld + sqrtPriceDelta;

      // Amount out = L * (1/sqrtPriceOld - 1/sqrtPriceNew)
      // = L * Q96 * (sqrtPriceNew - sqrtPriceOld) / (sqrtPriceOld * sqrtPriceNew)
      const amountOut = L * Q96 * sqrtPriceDelta / (sqrtPriceOld * sqrtPriceNew / Q96);
      return amountOut > 0n ? amountOut : 0n;
    }
  }

  /**
   * Calculate input amount for desired output
   */
  async getAmountIn(
    amountOut: bigint,
    tokenIn: string,
    tokenOut: string,
    poolAddress: string
  ): Promise<bigint> {
    const data = await this.getV3PoolData(poolAddress);

    const isToken0In = tokenIn.toLowerCase() === data.token0.address.toLowerCase();
    const feeBps = data.fee / 100;

    // Simplified inverse calculation
    const L = data.liquidity;
    const sqrtPriceX96 = data.sqrtPriceX96;

    let amountIn: bigint;

    if (isToken0In) {
      // Need to provide token0 to get token1
      // Approximate using constant product at current liquidity
      const reserve0 = L * Q96 / sqrtPriceX96;
      const reserve1 = L * sqrtPriceX96 / Q96;

      if (amountOut >= reserve1) return 0n;

      amountIn = reserve0 * amountOut / (reserve1 - amountOut) + 1n;
    } else {
      // Need to provide token1 to get token0
      const reserve0 = L * Q96 / sqrtPriceX96;
      const reserve1 = L * sqrtPriceX96 / Q96;

      if (amountOut >= reserve0) return 0n;

      amountIn = reserve1 * amountOut / (reserve0 - amountOut) + 1n;
    }

    // Add fee
    return amountIn * 10000n / (10000n - BigInt(feeBps)) + 1n;
  }

  /**
   * Get spot price from sqrtPriceX96
   */
  async getSpotPrice(
    tokenIn: string,
    tokenOut: string,
    poolAddress: string
  ): Promise<number> {
    const data = await this.getV3PoolData(poolAddress);

    const isToken0In = tokenIn.toLowerCase() === data.token0.address.toLowerCase();

    // Price = (sqrtPriceX96 / 2^96)^2 = sqrtPriceX96^2 / 2^192
    const sqrtPrice = Number(data.sqrtPriceX96) / Number(Q96);
    const price = sqrtPrice * sqrtPrice;

    // Adjust for decimals
    const decimalAdjustment = Math.pow(10, data.token0.decimals - data.token1.decimals);
    const adjustedPrice = price * decimalAdjustment;

    // Price is token1/token0, so invert if needed
    return isToken0In ? adjustedPrice : 1 / adjustedPrice;
  }

  /**
   * Get liquidity depth at various price levels
   * For V3, this requires iterating through ticks
   */
  async getLiquidityDepth(
    tokenIn: string,
    tokenOut: string,
    poolAddress: string,
    priceLevels: number[]
  ): Promise<LiquidityDepth[]> {
    const data = await this.getV3PoolData(poolAddress);
    const spotPrice = await this.getSpotPrice(tokenIn, tokenOut, poolAddress);

    // For simplified implementation, use virtual reserves
    // Full implementation would iterate through ticks
    const depths: LiquidityDepth[] = [];
    let cumulativeLiquidity = 0n;

    const isToken0In = tokenIn.toLowerCase() === data.token0.address.toLowerCase();
    const relevantReserve = isToken0In ? data.reserve1 : data.reserve0;

    for (const targetPrice of priceLevels.sort((a, b) => a - b)) {
      const priceRatio = Math.abs(targetPrice - spotPrice) / spotPrice;

      // Approximate liquidity available at this price level
      // In reality, this depends on tick distribution
      const liquidityAtLevel = BigInt(
        Math.floor(Number(relevantReserve) * priceRatio)
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

  /**
   * Convert tick to price
   */
  tickToPrice(tick: number, decimals0: number, decimals1: number): number {
    const price = Math.pow(1.0001, tick);
    return price * Math.pow(10, decimals0 - decimals1);
  }

  /**
   * Convert price to tick
   */
  priceToTick(price: number, decimals0: number, decimals1: number): number {
    const adjustedPrice = price / Math.pow(10, decimals0 - decimals1);
    return Math.floor(Math.log(adjustedPrice) / Math.log(1.0001));
  }
}

export default UniswapV3Adapter;
