/**
 * Chainlink Price Oracle Service
 * Reliable price feeds with manipulation resistance
 * Used as fallback and validation for DEX prices
 */

import {
  createPublicClient,
  http,
  formatUnits,
  type Address,
} from 'viem';
import { mainnet, arbitrum, base, polygon } from 'viem/chains';
import { getRpcUrl } from '../config/env.js';
import type { ChainId } from '../../shared/schema.js';

// Chainlink Aggregator V3 ABI
const AGGREGATOR_V3_ABI = [
  {
    inputs: [],
    name: 'latestRoundData',
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'description',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Chainlink price feed addresses by chain
const CHAINLINK_FEEDS: Record<ChainId, Record<string, Address>> = {
  ethereum: {
    'ETH/USD': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
    'BTC/USD': '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
    'USDC/USD': '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
    'USDT/USD': '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D',
    'DAI/USD': '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9',
    'LINK/USD': '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c',
    'UNI/USD': '0x553303d460EE0afB37EdFf9bE42922D8FF63220e',
    'AAVE/USD': '0x547a514d5e3769680Ce22B2361c10Ea13619e8a9',
    'CRV/USD': '0xCd627aA160A6fA45Eb793D19286F0C5DDD54c506',
    'WBTC/USD': '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c', // Uses BTC/USD
    'WETH/USD': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', // Uses ETH/USD
  },
  arbitrum: {
    'ETH/USD': '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
    'BTC/USD': '0x6ce185860a4963106506C203335A2910A1B9B79F',
    'USDC/USD': '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3',
    'USDT/USD': '0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7',
    'DAI/USD': '0xc5C8E77B397E531B8EC06BFb0048328B30E9eCfB',
    'LINK/USD': '0x86E53CF1B870786351Da77A57575e79CB55812CB',
    'ARB/USD': '0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6',
  },
  base: {
    'ETH/USD': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
    'USDC/USD': '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B',
    'DAI/USD': '0x591e79239a7d679378eC8c847e5038150364C78F',
  },
  polygon: {
    'ETH/USD': '0xF9680D99D6C9589e2a93a78A04A279e509205945',
    'BTC/USD': '0xc907E116054Ad103354f2D350FD2514433D57F6f',
    'USDC/USD': '0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7',
    'USDT/USD': '0x0A6513e40db6EB1b165753AD52E80663aeA50545',
    'DAI/USD': '0x4746DeC9e833A82EC7C2C1356372CcF2cfcD2F3D',
    'MATIC/USD': '0xAB594600376Ec9fD91F8e885dADF0CE036862dE0',
    'LINK/USD': '0xd9FFdb71EbE7496cC440152d43986Aae0AB76665',
  },
};

// Token symbol mapping for feed lookup
const TOKEN_TO_FEED: Record<string, string> = {
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 'WETH/USD', // WETH mainnet
  '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599': 'WBTC/USD', // WBTC mainnet
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 'USDC/USD', // USDC mainnet
  '0xdAC17F958D2ee523a2206206994597C13D831ec7': 'USDT/USD', // USDT mainnet
  '0x6B175474E89094C44Da98b954EedeAC495271d0F': 'DAI/USD',  // DAI mainnet
  '0x514910771AF9Ca656af840dff83E8264EcF986CA': 'LINK/USD', // LINK mainnet
  '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984': 'UNI/USD',  // UNI mainnet
  '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9': 'AAVE/USD', // AAVE mainnet
  '0xD533a949740bb3306d119CC777fa900bA034cd52': 'CRV/USD',  // CRV mainnet
};

interface PriceData {
  price: number;
  decimals: number;
  updatedAt: Date;
  roundId: bigint;
  isStale: boolean;
  source: string;
}

interface PriceValidation {
  isValid: boolean;
  deviation: number;
  chainlinkPrice: number;
  comparedPrice: number;
  maxDeviation: number;
}

class ChainlinkOracleService {
  private clients: Map<ChainId, ReturnType<typeof createPublicClient>> = new Map();
  private priceCache: Map<string, { data: PriceData; cachedAt: number }> = new Map();
  private cacheTTLMs = 10000; // 10 second cache
  private maxStalenessSeconds = 3600; // 1 hour max staleness

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
   * Get price from Chainlink feed
   */
  async getPrice(chainId: ChainId, feedName: string): Promise<PriceData | null> {
    const cacheKey = `${chainId}:${feedName}`;

    // Check cache
    const cached = this.priceCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.cacheTTLMs) {
      return cached.data;
    }

    const feedAddress = CHAINLINK_FEEDS[chainId]?.[feedName];
    if (!feedAddress) {
      return null;
    }

    try {
      const client = this.getClient(chainId);

      // Get decimals and latest round data in parallel
      const [decimals, roundData] = await Promise.all([
        client.readContract({
          address: feedAddress,
          abi: AGGREGATOR_V3_ABI,
          functionName: 'decimals',
        }),
        client.readContract({
          address: feedAddress,
          abi: AGGREGATOR_V3_ABI,
          functionName: 'latestRoundData',
        }),
      ]);

      const [roundId, answer, , updatedAt] = roundData;

      // Check staleness
      const updatedAtDate = new Date(Number(updatedAt) * 1000);
      const ageSeconds = (Date.now() - updatedAtDate.getTime()) / 1000;
      const isStale = ageSeconds > this.maxStalenessSeconds;

      const priceData: PriceData = {
        price: Number(formatUnits(answer, decimals)),
        decimals,
        updatedAt: updatedAtDate,
        roundId,
        isStale,
        source: `chainlink:${feedName}`,
      };

      // Update cache
      this.priceCache.set(cacheKey, { data: priceData, cachedAt: Date.now() });

      return priceData;
    } catch (error) {
      console.error(`Chainlink price fetch failed for ${feedName}:`, error);
      return null;
    }
  }

  /**
   * Get price for a token address
   */
  async getTokenPrice(chainId: ChainId, tokenAddress: Address): Promise<PriceData | null> {
    const feedName = TOKEN_TO_FEED[tokenAddress];

    if (!feedName) {
      // Try to find a matching feed based on common patterns
      return null;
    }

    return this.getPrice(chainId, feedName);
  }

  /**
   * Get ETH price in USD
   */
  async getEthPrice(chainId: ChainId = 'ethereum'): Promise<number> {
    const priceData = await this.getPrice(chainId, 'ETH/USD');
    return priceData?.price ?? 0;
  }

  /**
   * Get BTC price in USD
   */
  async getBtcPrice(chainId: ChainId = 'ethereum'): Promise<number> {
    const priceData = await this.getPrice(chainId, 'BTC/USD');
    return priceData?.price ?? 0;
  }

  /**
   * Validate a DEX price against Chainlink
   * Detects potential price manipulation
   */
  async validatePrice(
    chainId: ChainId,
    tokenAddress: Address,
    dexPrice: number,
    maxDeviationPercent: number = 5
  ): Promise<PriceValidation> {
    const chainlinkData = await this.getTokenPrice(chainId, tokenAddress);

    if (!chainlinkData || chainlinkData.isStale) {
      return {
        isValid: true, // Can't validate, assume valid
        deviation: 0,
        chainlinkPrice: 0,
        comparedPrice: dexPrice,
        maxDeviation: maxDeviationPercent,
      };
    }

    const deviation = Math.abs(dexPrice - chainlinkData.price) / chainlinkData.price * 100;

    return {
      isValid: deviation <= maxDeviationPercent,
      deviation,
      chainlinkPrice: chainlinkData.price,
      comparedPrice: dexPrice,
      maxDeviation: maxDeviationPercent,
    };
  }

  /**
   * Get multiple prices in parallel
   */
  async getPrices(chainId: ChainId, feedNames: string[]): Promise<Map<string, PriceData | null>> {
    const results = await Promise.all(
      feedNames.map(async (feed) => ({
        feed,
        data: await this.getPrice(chainId, feed),
      }))
    );

    const priceMap = new Map<string, PriceData | null>();
    for (const { feed, data } of results) {
      priceMap.set(feed, data);
    }

    return priceMap;
  }

  /**
   * Convert amount between tokens using Chainlink prices
   */
  async convertAmount(
    chainId: ChainId,
    fromToken: Address,
    toToken: Address,
    amount: bigint,
    fromDecimals: number,
    toDecimals: number
  ): Promise<bigint | null> {
    const [fromPrice, toPrice] = await Promise.all([
      this.getTokenPrice(chainId, fromToken),
      this.getTokenPrice(chainId, toToken),
    ]);

    if (!fromPrice || !toPrice) {
      return null;
    }

    // Convert: amount * fromPrice / toPrice
    const amountFloat = Number(formatUnits(amount, fromDecimals));
    const convertedFloat = amountFloat * fromPrice.price / toPrice.price;

    // Convert back to bigint with target decimals
    return BigInt(Math.floor(convertedFloat * Math.pow(10, toDecimals)));
  }

  /**
   * Check if a trade's expected output is reasonable
   */
  async isOutputReasonable(
    chainId: ChainId,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    expectedAmountOut: bigint,
    tokenInDecimals: number,
    tokenOutDecimals: number,
    tolerancePercent: number = 10
  ): Promise<{ reasonable: boolean; expectedByChainlink: bigint | null; deviation: number }> {
    const chainlinkExpected = await this.convertAmount(
      chainId,
      tokenIn,
      tokenOut,
      amountIn,
      tokenInDecimals,
      tokenOutDecimals
    );

    if (!chainlinkExpected) {
      return { reasonable: true, expectedByChainlink: null, deviation: 0 };
    }

    const deviation = Number(expectedAmountOut - chainlinkExpected) / Number(chainlinkExpected) * 100;

    return {
      reasonable: Math.abs(deviation) <= tolerancePercent,
      expectedByChainlink: chainlinkExpected,
      deviation,
    };
  }

  /**
   * Get available feeds for a chain
   */
  getAvailableFeeds(chainId: ChainId): string[] {
    return Object.keys(CHAINLINK_FEEDS[chainId] ?? {});
  }

  /**
   * Check if a feed exists
   */
  hasFeed(chainId: ChainId, feedName: string): boolean {
    return !!CHAINLINK_FEEDS[chainId]?.[feedName];
  }

  /**
   * Add custom feed address
   */
  addCustomFeed(chainId: ChainId, feedName: string, feedAddress: Address): void {
    if (!CHAINLINK_FEEDS[chainId]) {
      (CHAINLINK_FEEDS as Record<ChainId, Record<string, Address>>)[chainId] = {};
    }
    CHAINLINK_FEEDS[chainId][feedName] = feedAddress;
  }

  /**
   * Map token address to feed name
   */
  mapTokenToFeed(tokenAddress: Address, feedName: string): void {
    TOKEN_TO_FEED[tokenAddress.toLowerCase()] = feedName;
  }

  /**
   * Clear price cache
   */
  clearCache(): void {
    this.priceCache.clear();
  }

  /**
   * Set cache TTL
   */
  setCacheTTL(ttlMs: number): void {
    this.cacheTTLMs = ttlMs;
  }

  /**
   * Set max staleness threshold
   */
  setMaxStaleness(seconds: number): void {
    this.maxStalenessSeconds = seconds;
  }
}

export const chainlinkOracleService = new ChainlinkOracleService();
export type { PriceData, PriceValidation };
