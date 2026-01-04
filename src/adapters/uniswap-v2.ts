/**
 * UniswapV2 Pool Adapter
 * Adapter for UniswapV2-style constant product AMMs
 */

import { ethers } from 'ethers';
import {
  LiquidityDepth,
  PoolAdapter,
  PoolReserves,
  Token,
} from '../types';
import {
  getAmountOutConstantProduct,
  getAmountInConstantProduct,
  getSpotPriceFromReserves,
} from '../utils';

const UNISWAP_V2_PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

export interface UniswapV2AdapterConfig {
  provider: ethers.Provider;
  feeBps?: number;
}

/**
 * UniswapV2 Pool Adapter
 * Works with Uniswap V2, Sushiswap, and other constant product AMMs
 */
export class UniswapV2Adapter implements PoolAdapter {
  private provider: ethers.Provider;
  private feeBps: number;
  private tokenCache: Map<string, Token> = new Map();

  constructor(config: UniswapV2AdapterConfig) {
    this.provider = config.provider;
    this.feeBps = config.feeBps ?? 30; // 0.3% default fee
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
   * Get pool reserves
   */
  async getReserves(poolAddress: string): Promise<PoolReserves> {
    const pair = new ethers.Contract(poolAddress, UNISWAP_V2_PAIR_ABI, this.provider);

    const [reserves, token0Address, token1Address, block] = await Promise.all([
      pair.getReserves(),
      pair.token0(),
      pair.token1(),
      this.provider.getBlock('latest'),
    ]);

    const [token0, token1] = await Promise.all([
      this.getTokenInfo(token0Address),
      this.getTokenInfo(token1Address),
    ]);

    return {
      token0,
      token1,
      reserve0: BigInt(reserves.reserve0),
      reserve1: BigInt(reserves.reserve1),
      blockNumber: block?.number ?? 0,
      timestamp: block?.timestamp ?? Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Calculate output amount for given input
   */
  async getAmountOut(
    amountIn: bigint,
    tokenIn: string,
    tokenOut: string,
    poolAddress: string
  ): Promise<bigint> {
    const reserves = await this.getReserves(poolAddress);

    const isToken0In = tokenIn.toLowerCase() === reserves.token0.address.toLowerCase();
    const reserveIn = isToken0In ? reserves.reserve0 : reserves.reserve1;
    const reserveOut = isToken0In ? reserves.reserve1 : reserves.reserve0;

    return getAmountOutConstantProduct(amountIn, reserveIn, reserveOut, this.feeBps);
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
    const reserves = await this.getReserves(poolAddress);

    const isToken0In = tokenIn.toLowerCase() === reserves.token0.address.toLowerCase();
    const reserveIn = isToken0In ? reserves.reserve0 : reserves.reserve1;
    const reserveOut = isToken0In ? reserves.reserve1 : reserves.reserve0;

    return getAmountInConstantProduct(amountOut, reserveIn, reserveOut, this.feeBps);
  }

  /**
   * Get spot price
   */
  async getSpotPrice(
    tokenIn: string,
    tokenOut: string,
    poolAddress: string
  ): Promise<number> {
    const reserves = await this.getReserves(poolAddress);

    const isToken0In = tokenIn.toLowerCase() === reserves.token0.address.toLowerCase();

    if (isToken0In) {
      return getSpotPriceFromReserves(
        reserves.reserve0,
        reserves.reserve1,
        reserves.token0.decimals,
        reserves.token1.decimals
      );
    } else {
      return getSpotPriceFromReserves(
        reserves.reserve1,
        reserves.reserve0,
        reserves.token1.decimals,
        reserves.token0.decimals
      );
    }
  }

  /**
   * Get liquidity depth at various price levels
   */
  async getLiquidityDepth(
    tokenIn: string,
    tokenOut: string,
    poolAddress: string,
    priceLevels: number[]
  ): Promise<LiquidityDepth[]> {
    const reserves = await this.getReserves(poolAddress);

    const isToken0In = tokenIn.toLowerCase() === reserves.token0.address.toLowerCase();
    const reserveIn = isToken0In ? reserves.reserve0 : reserves.reserve1;
    const reserveOut = isToken0In ? reserves.reserve1 : reserves.reserve0;
    const decimalsIn = isToken0In ? reserves.token0.decimals : reserves.token1.decimals;
    const decimalsOut = isToken0In ? reserves.token1.decimals : reserves.token0.decimals;

    const spotPrice = getSpotPriceFromReserves(
      reserveIn,
      reserveOut,
      decimalsIn,
      decimalsOut
    );

    const depths: LiquidityDepth[] = [];
    let cumulativeLiquidity = 0n;

    for (const targetPrice of priceLevels.sort((a, b) => a - b)) {
      // For constant product: x * y = k
      // To move price from p0 to p1:
      // amount needed = sqrt(k/p1) - sqrt(k/p0) for one direction
      const k = reserveIn * reserveOut;
      const currentSqrtK = Math.sqrt(Number(k));

      // Simplified: liquidity at price level is approximated
      const priceRatio = targetPrice / spotPrice;
      const liquidityAtLevel = BigInt(
        Math.floor(Number(reserveOut) * Math.abs(1 - priceRatio))
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

export default UniswapV2Adapter;
