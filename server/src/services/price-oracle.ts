/**
 * Price Oracle Service
 * Multi-source price aggregation from DEXes
 */

import {
  createPublicClient,
  http,
  formatUnits,
  parseUnits,
  type Address,
  type PublicClient,
} from 'viem';
import { mainnet, arbitrum, base, polygon } from 'viem/chains';
import { getRpcUrl, config } from '../config/env.js';
import type { ChainId, TokenPrice, SwapQuote } from '../../shared/schema.js';
import { TOKEN_DECIMALS, PROTOCOL_ADDRESSES } from '../../shared/schema.js';

// Uniswap V3 Quoter ABI (minimal)
const QUOTER_ABI = [
  {
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ],
    name: 'quoteExactInputSingle',
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// Uniswap V2 Router ABI (minimal)
const UNISWAP_V2_ABI = [
  {
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    name: 'getAmountsOut',
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Curve pool ABI (minimal)
const CURVE_POOL_ABI = [
  {
    inputs: [
      { name: 'i', type: 'int128' },
      { name: 'j', type: 'int128' },
      { name: 'dx', type: 'uint256' },
    ],
    name: 'get_dy',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Chain configs
const CHAIN_CONFIGS = {
  ethereum: mainnet,
  arbitrum: arbitrum,
  base: base,
  polygon: polygon,
};

// Common fee tiers for Uniswap V3
const FEE_TIERS = [500, 3000, 10000]; // 0.05%, 0.3%, 1%

// Stablecoin addresses
const STABLECOINS: Set<string> = new Set([
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
]);

interface DexQuote {
  dex: string;
  amountOut: bigint;
  fee?: number;
  gasEstimate: bigint;
}

class PriceOracleService {
  private clients: Map<ChainId, PublicClient> = new Map();
  private priceCache: Map<string, TokenPrice> = new Map();
  private priceCallbacks: Map<string, Set<(price: TokenPrice) => void>> = new Map();

  /**
   * Get or create public client for a chain
   */
  private getClient(chainId: ChainId): PublicClient {
    let client = this.clients.get(chainId);

    if (!client) {
      const chain = CHAIN_CONFIGS[chainId];
      client = createPublicClient({
        chain,
        transport: http(getRpcUrl(chainId)),
      });
      this.clients.set(chainId, client);
    }

    return client;
  }

  /**
   * Get token decimals
   */
  private getTokenDecimals(tokenAddress: Address): number {
    return TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
  }

  /**
   * Get Uniswap V3 quote
   */
  async getUniswapV3Quote(
    chainId: ChainId,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    fee: number = 3000
  ): Promise<bigint> {
    const client = this.getClient(chainId);
    const quoter = PROTOCOL_ADDRESSES[chainId]?.uniswapV3Quoter;

    if (!quoter) {
      throw new Error(`Uniswap V3 not available on ${chainId}`);
    }

    try {
      const result = await client.simulateContract({
        address: quoter,
        abi: QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [tokenIn, tokenOut, fee, amountIn, 0n],
      });

      return result.result;
    } catch (error) {
      console.error(`Uniswap V3 quote failed:`, error);
      return 0n;
    }
  }

  /**
   * Get Sushiswap quote (V2 style)
   */
  async getSushiswapQuote(
    chainId: ChainId,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint
  ): Promise<bigint> {
    const client = this.getClient(chainId);
    const router = PROTOCOL_ADDRESSES[chainId]?.sushiswapRouter;

    if (!router) {
      return 0n;
    }

    try {
      const amounts = await client.readContract({
        address: router,
        abi: UNISWAP_V2_ABI,
        functionName: 'getAmountsOut',
        args: [amountIn, [tokenIn, tokenOut]],
      });

      return amounts[1];
    } catch (error) {
      console.error(`Sushiswap quote failed:`, error);
      return 0n;
    }
  }

  /**
   * Get best price across all DEXes
   */
  async getBestPrice(
    chainId: ChainId,
    tokenAddress: Address,
    amount: bigint
  ): Promise<TokenPrice> {
    // For simplicity, get price in terms of USDC
    const USDC = chainId === 'ethereum'
      ? '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      : chainId === 'arbitrum'
      ? '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
      : chainId === 'base'
      ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
      : '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

    const quotes: DexQuote[] = [];

    // Get Uniswap V3 quotes for different fee tiers
    for (const fee of FEE_TIERS) {
      try {
        const amountOut = await this.getUniswapV3Quote(
          chainId,
          tokenAddress,
          USDC as Address,
          amount,
          fee
        );

        if (amountOut > 0n) {
          quotes.push({
            dex: `uniswap-v3-${fee}`,
            amountOut,
            fee,
            gasEstimate: 150000n,
          });
        }
      } catch {
        // Skip failed quotes
      }
    }

    // Get Sushiswap quote
    try {
      const amountOut = await this.getSushiswapQuote(
        chainId,
        tokenAddress,
        USDC as Address,
        amount
      );

      if (amountOut > 0n) {
        quotes.push({
          dex: 'sushiswap',
          amountOut,
          gasEstimate: 120000n,
        });
      }
    } catch {
      // Skip failed quotes
    }

    if (quotes.length === 0) {
      throw new Error(`No quotes available for ${tokenAddress} on ${chainId}`);
    }

    // Find best quote (highest output)
    const best = quotes.reduce((a, b) => (a.amountOut > b.amountOut ? a : b));

    // Calculate USD price
    const tokenDecimals = this.getTokenDecimals(tokenAddress);
    const usdcDecimals = 6;

    const amountInNormalized = Number(formatUnits(amount, tokenDecimals));
    const amountOutNormalized = Number(formatUnits(best.amountOut, usdcDecimals));
    const priceInUSD = amountOutNormalized / amountInNormalized;

    // Calculate confidence based on spread
    const prices = quotes.map((q) => Number(formatUnits(q.amountOut, usdcDecimals)));
    const spread = prices.length > 1
      ? (Math.max(...prices) - Math.min(...prices)) / Math.max(...prices)
      : 0;

    const confidence = spread < 0.001 ? 'high' : spread < 0.01 ? 'medium' : 'low';

    const tokenPrice: TokenPrice = {
      chain: chainId,
      tokenAddress,
      priceInUSD,
      priceInETH: 0n, // Would need ETH price
      dex: best.dex,
      liquidity: 0n, // Would need pool data
      timestamp: new Date(),
      confidence,
    };

    // Cache the price
    const cacheKey = `${chainId}:${tokenAddress.toLowerCase()}`;
    this.priceCache.set(cacheKey, tokenPrice);

    return tokenPrice;
  }

  /**
   * Get swap quote with optimal route
   */
  async getBestSwapRoute(
    chainId: ChainId,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint
  ): Promise<SwapQuote> {
    const quotes: Array<DexQuote & { route: string[] }> = [];

    // Get Uniswap V3 quotes
    for (const fee of FEE_TIERS) {
      try {
        const amountOut = await this.getUniswapV3Quote(
          chainId,
          tokenIn,
          tokenOut,
          amountIn,
          fee
        );

        if (amountOut > 0n) {
          quotes.push({
            dex: `uniswap-v3`,
            amountOut,
            fee,
            gasEstimate: 150000n,
            route: [`uniswap-v3-${fee}`],
          });
        }
      } catch {
        // Skip
      }
    }

    // Get Sushiswap quote
    try {
      const amountOut = await this.getSushiswapQuote(chainId, tokenIn, tokenOut, amountIn);

      if (amountOut > 0n) {
        quotes.push({
          dex: 'sushiswap',
          amountOut,
          gasEstimate: 120000n,
          route: ['sushiswap'],
        });
      }
    } catch {
      // Skip
    }

    if (quotes.length === 0) {
      throw new Error(`No swap routes available for ${tokenIn} -> ${tokenOut}`);
    }

    // Find best quote
    const best = quotes.reduce((a, b) => (a.amountOut > b.amountOut ? a : b));

    // Calculate price impact
    const tokenInDecimals = this.getTokenDecimals(tokenIn);
    const tokenOutDecimals = this.getTokenDecimals(tokenOut);

    // Get spot price for comparison (using smaller amount)
    const spotAmount = amountIn / 1000n;
    let spotQuote: bigint;

    try {
      if (best.dex.startsWith('uniswap-v3')) {
        spotQuote = await this.getUniswapV3Quote(
          chainId,
          tokenIn,
          tokenOut,
          spotAmount,
          best.fee || 3000
        );
      } else {
        spotQuote = await this.getSushiswapQuote(chainId, tokenIn, tokenOut, spotAmount);
      }
    } catch {
      spotQuote = best.amountOut / 1000n;
    }

    // Calculate price impact
    const expectedOutput = spotQuote * 1000n;
    const priceImpact = expectedOutput > 0n
      ? Number(expectedOutput - best.amountOut) / Number(expectedOutput)
      : 0;

    return {
      tokenIn,
      tokenOut,
      amountIn,
      amountOut: best.amountOut,
      route: best.route,
      gasEstimate: best.gasEstimate,
      priceImpact,
      expiresAt: new Date(Date.now() + 30000), // 30 second expiry
    };
  }

  /**
   * Get cached price
   */
  getCachedPrice(chainId: ChainId, tokenAddress: Address): TokenPrice | null {
    const cacheKey = `${chainId}:${tokenAddress.toLowerCase()}`;
    const cached = this.priceCache.get(cacheKey);

    // Return if less than 10 seconds old
    if (cached && Date.now() - cached.timestamp.getTime() < 10000) {
      return cached;
    }

    return null;
  }

  /**
   * Subscribe to price updates
   */
  subscribeToPrice(
    chainId: ChainId,
    tokenAddress: Address,
    callback: (price: TokenPrice) => void
  ): () => void {
    const key = `${chainId}:${tokenAddress.toLowerCase()}`;

    if (!this.priceCallbacks.has(key)) {
      this.priceCallbacks.set(key, new Set());
    }

    this.priceCallbacks.get(key)!.add(callback);

    return () => {
      this.priceCallbacks.get(key)?.delete(callback);
    };
  }

  /**
   * Notify price subscribers
   */
  private notifyPriceUpdate(chainId: ChainId, tokenAddress: Address, price: TokenPrice): void {
    const key = `${chainId}:${tokenAddress.toLowerCase()}`;
    const callbacks = this.priceCallbacks.get(key);

    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(price);
        } catch (error) {
          console.error('Price callback error:', error);
        }
      }
    }
  }

  /**
   * Check if token is a stablecoin
   */
  isStablecoin(tokenAddress: Address): boolean {
    return STABLECOINS.has(tokenAddress.toLowerCase());
  }

  /**
   * Get max allowed price impact for a token pair
   */
  getMaxPriceImpact(tokenIn: Address, tokenOut: Address): number {
    if (this.isStablecoin(tokenIn) && this.isStablecoin(tokenOut)) {
      return config.risk.maxStablePriceImpact;
    }
    return config.risk.maxPriceImpact;
  }

  /**
   * Convert amount between tokens using current prices
   */
  async convertAmount(
    chainId: ChainId,
    fromToken: Address,
    toToken: Address,
    amount: bigint
  ): Promise<bigint> {
    const quote = await this.getBestSwapRoute(chainId, fromToken, toToken, amount);
    return quote.amountOut;
  }

  /**
   * Get ETH price in USD
   */
  async getEthPriceUSD(chainId: ChainId = 'ethereum'): Promise<number> {
    const WETH = chainId === 'ethereum'
      ? '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
      : chainId === 'arbitrum'
      ? '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
      : '0x4200000000000000000000000000000000000006';

    try {
      const price = await this.getBestPrice(
        chainId,
        WETH as Address,
        parseUnits('1', 18)
      );
      return price.priceInUSD;
    } catch {
      // Return fallback
      return config.prices.ethUsd;
    }
  }

  /**
   * Clear price cache
   */
  clearCache(): void {
    this.priceCache.clear();
  }
}

export const priceOracleService = new PriceOracleService();
