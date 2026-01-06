/**
 * Wallet Service
 * Manages wallet balances and monitoring
 */

import {
  createPublicClient,
  http,
  formatUnits,
  type Address,
  type PublicClient,
  erc20Abi,
} from 'viem';
import { mainnet, arbitrum, base, polygon } from 'viem/chains';
import { getRpcUrl } from '../config/env.js';
import type { ChainId, TokenBalance, WalletBalance } from '../../shared/schema.js';
import { TOKEN_DECIMALS } from '../../shared/schema.js';

// Common token addresses per chain
const COMMON_TOKENS: Record<ChainId, Address[]> = {
  ethereum: [
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
    '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
  ],
  arbitrum: [
    '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
    '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
    '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // DAI
    '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', // WBTC
  ],
  base: [
    '0x4200000000000000000000000000000000000006', // WETH
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
    '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', // DAI
  ],
  polygon: [
    '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // WETH
    '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDC
    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT
    '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', // DAI
    '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', // WBTC
  ],
};

// Token symbols
const TOKEN_SYMBOLS: Record<string, string> = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
  '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI',
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'WBTC',
  '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 'WETH',
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC',
  '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'USDT',
  '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 'DAI',
  '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': 'WBTC',
  '0x4200000000000000000000000000000000000006': 'WETH',
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 'DAI',
  '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': 'WETH',
  '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': 'USDC',
  '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 'USDT',
  '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': 'DAI',
  '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': 'WBTC',
};

// Chain configs
const CHAIN_CONFIGS = {
  ethereum: mainnet,
  arbitrum: arbitrum,
  base: base,
  polygon: polygon,
};

class WalletService {
  private clients: Map<ChainId, PublicClient> = new Map();
  private balanceCache: Map<string, WalletBalance> = new Map();
  private balanceCallbacks: Set<(address: Address, balance: WalletBalance) => void> = new Set();

  constructor() {
    // Initialize clients lazily
  }

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
   * Get token symbol
   */
  private getTokenSymbol(tokenAddress: Address): string {
    return TOKEN_SYMBOLS[tokenAddress.toLowerCase()] ?? 'UNKNOWN';
  }

  /**
   * Get native ETH balance
   */
  async getNativeBalance(walletAddress: Address, chainId: ChainId): Promise<bigint> {
    const client = this.getClient(chainId);
    return client.getBalance({ address: walletAddress });
  }

  /**
   * Get ERC20 token balance
   */
  async getTokenBalance(
    walletAddress: Address,
    tokenAddress: Address,
    chainId: ChainId
  ): Promise<bigint> {
    const client = this.getClient(chainId);

    try {
      const balance = await client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [walletAddress],
      });

      return balance;
    } catch (error) {
      console.error(`Failed to get balance for ${tokenAddress}:`, error);
      return 0n;
    }
  }

  /**
   * Refresh all balances for a wallet
   */
  async refreshBalances(
    walletAddress: Address,
    chainId: ChainId
  ): Promise<WalletBalance> {
    const tokens = COMMON_TOKENS[chainId] || [];
    const tokenBalances: TokenBalance[] = [];

    // Get native ETH balance
    const nativeBalance = await this.getNativeBalance(walletAddress, chainId);
    tokenBalances.push({
      tokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as Address,
      symbol: 'ETH',
      decimals: 18,
      balance: nativeBalance,
      valueUSD: 0, // Will be calculated by price service
    });

    // Get ERC20 balances in parallel
    const balancePromises = tokens.map(async (tokenAddress) => {
      const balance = await this.getTokenBalance(walletAddress, tokenAddress, chainId);
      return {
        tokenAddress,
        symbol: this.getTokenSymbol(tokenAddress),
        decimals: this.getTokenDecimals(tokenAddress),
        balance,
        valueUSD: 0,
      };
    });

    const erc20Balances = await Promise.all(balancePromises);
    tokenBalances.push(...erc20Balances.filter((b) => b.balance > 0n));

    const walletBalance: WalletBalance = {
      walletAddress,
      chainId,
      tokens: tokenBalances,
      totalValueUSD: 0,
      lastUpdated: new Date(),
    };

    // Cache the balance
    const cacheKey = `${walletAddress.toLowerCase()}:${chainId}`;
    this.balanceCache.set(cacheKey, walletBalance);

    // Notify subscribers
    this.notifyBalanceChange(walletAddress, walletBalance);

    return walletBalance;
  }

  /**
   * Get cached balance (or refresh if not cached)
   */
  async getBalance(
    walletAddress: Address,
    chainId: ChainId
  ): Promise<WalletBalance> {
    const cacheKey = `${walletAddress.toLowerCase()}:${chainId}`;
    const cached = this.balanceCache.get(cacheKey);

    // Return cached if less than 30 seconds old
    if (cached && Date.now() - cached.lastUpdated.getTime() < 30000) {
      return cached;
    }

    return this.refreshBalances(walletAddress, chainId);
  }

  /**
   * Get balances for all chains
   */
  async getAllBalances(walletAddress: Address): Promise<WalletBalance[]> {
    const chains: ChainId[] = ['ethereum', 'arbitrum', 'base', 'polygon'];

    const balances = await Promise.all(
      chains.map((chainId) => this.getBalance(walletAddress, chainId))
    );

    return balances;
  }

  /**
   * Check if wallet has sufficient balance for a trade
   */
  async hasSufficientBalance(
    walletAddress: Address,
    tokenAddress: Address,
    amount: bigint,
    chainId: ChainId
  ): Promise<boolean> {
    if (tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
      const balance = await this.getNativeBalance(walletAddress, chainId);
      return balance >= amount;
    }

    const balance = await this.getTokenBalance(walletAddress, tokenAddress, chainId);
    return balance >= amount;
  }

  /**
   * Subscribe to balance changes
   */
  onBalanceChange(
    callback: (address: Address, balance: WalletBalance) => void
  ): () => void {
    this.balanceCallbacks.add(callback);
    return () => this.balanceCallbacks.delete(callback);
  }

  /**
   * Notify subscribers of balance change
   */
  private notifyBalanceChange(address: Address, balance: WalletBalance): void {
    for (const callback of this.balanceCallbacks) {
      try {
        callback(address, balance);
      } catch (error) {
        console.error('Balance callback error:', error);
      }
    }
  }

  /**
   * Clear balance cache for a wallet
   */
  clearCache(walletAddress?: Address): void {
    if (walletAddress) {
      const prefix = walletAddress.toLowerCase();
      for (const key of this.balanceCache.keys()) {
        if (key.startsWith(prefix)) {
          this.balanceCache.delete(key);
        }
      }
    } else {
      this.balanceCache.clear();
    }
  }

  /**
   * Get token allowance
   */
  async getAllowance(
    walletAddress: Address,
    tokenAddress: Address,
    spenderAddress: Address,
    chainId: ChainId
  ): Promise<bigint> {
    const client = this.getClient(chainId);

    try {
      const allowance = await client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [walletAddress, spenderAddress],
      });

      return allowance;
    } catch (error) {
      console.error(`Failed to get allowance:`, error);
      return 0n;
    }
  }

  /**
   * Check if token approval is needed
   */
  async needsApproval(
    walletAddress: Address,
    tokenAddress: Address,
    spenderAddress: Address,
    amount: bigint,
    chainId: ChainId
  ): Promise<boolean> {
    // Native ETH doesn't need approval
    if (tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
      return false;
    }

    const allowance = await this.getAllowance(
      walletAddress,
      tokenAddress,
      spenderAddress,
      chainId
    );

    return allowance < amount;
  }
}

export const walletService = new WalletService();
