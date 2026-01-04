/**
 * Protocol and token constants for delegation configuration
 */

import type { Address } from 'viem';

export type ChainId = 'ethereum' | 'arbitrum' | 'base' | 'polygon';

export interface Protocol {
  id: string;
  name: string;
  description: string;
  chains: ChainId[];
  type: 'dex' | 'lending' | 'aggregator';
}

export interface Token {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  chains: ChainId[];
  logoUrl?: string;
}

// Supported protocols
export const PROTOCOLS: Protocol[] = [
  {
    id: 'uniswap-v3',
    name: 'Uniswap V3',
    description: 'Concentrated liquidity DEX',
    chains: ['ethereum', 'arbitrum', 'base', 'polygon'],
    type: 'dex',
  },
  {
    id: 'uniswap-v2',
    name: 'Uniswap V2',
    description: 'Constant product AMM',
    chains: ['ethereum', 'arbitrum', 'polygon'],
    type: 'dex',
  },
  {
    id: 'sushiswap',
    name: 'SushiSwap',
    description: 'Multi-chain DEX',
    chains: ['ethereum', 'arbitrum', 'polygon'],
    type: 'dex',
  },
  {
    id: 'curve',
    name: 'Curve Finance',
    description: 'Stablecoin optimized DEX',
    chains: ['ethereum', 'arbitrum', 'polygon'],
    type: 'dex',
  },
  {
    id: 'balancer',
    name: 'Balancer',
    description: 'Weighted pool DEX',
    chains: ['ethereum', 'arbitrum', 'polygon'],
    type: 'dex',
  },
  {
    id: 'aave-v3',
    name: 'Aave V3',
    description: 'Lending protocol with flash loans',
    chains: ['ethereum', 'arbitrum', 'base', 'polygon'],
    type: 'lending',
  },
  {
    id: '1inch',
    name: '1inch',
    description: 'DEX aggregator',
    chains: ['ethereum', 'arbitrum', 'base', 'polygon'],
    type: 'aggregator',
  },
];

// Common tokens per chain
export const TOKENS: Record<ChainId, Token[]> = {
  ethereum: [
    {
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      chains: ['ethereum'],
    },
    {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      chains: ['ethereum'],
    },
    {
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      chains: ['ethereum'],
    },
    {
      address: '0x6B175474E89094C44Da98b954EesAC495271d0F',
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18,
      chains: ['ethereum'],
    },
    {
      address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      symbol: 'WBTC',
      name: 'Wrapped Bitcoin',
      decimals: 8,
      chains: ['ethereum'],
    },
  ],
  arbitrum: [
    {
      address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      chains: ['arbitrum'],
    },
    {
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      chains: ['arbitrum'],
    },
    {
      address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      chains: ['arbitrum'],
    },
    {
      address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18,
      chains: ['arbitrum'],
    },
    {
      address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
      symbol: 'WBTC',
      name: 'Wrapped Bitcoin',
      decimals: 8,
      chains: ['arbitrum'],
    },
    {
      address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
      symbol: 'ARB',
      name: 'Arbitrum',
      decimals: 18,
      chains: ['arbitrum'],
    },
  ],
  base: [
    {
      address: '0x4200000000000000000000000000000000000006',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      chains: ['base'],
    },
    {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      chains: ['base'],
    },
    {
      address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18,
      chains: ['base'],
    },
  ],
  polygon: [
    {
      address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      chains: ['polygon'],
    },
    {
      address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      chains: ['polygon'],
    },
    {
      address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      chains: ['polygon'],
    },
    {
      address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18,
      chains: ['polygon'],
    },
    {
      address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
      symbol: 'WBTC',
      name: 'Wrapped Bitcoin',
      decimals: 8,
      chains: ['polygon'],
    },
    {
      address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      symbol: 'WMATIC',
      name: 'Wrapped Matic',
      decimals: 18,
      chains: ['polygon'],
    },
  ],
};

// Chain display info
export const CHAINS: { id: ChainId; name: string; icon: string }[] = [
  { id: 'ethereum', name: 'Ethereum', icon: 'ETH' },
  { id: 'arbitrum', name: 'Arbitrum', icon: 'ARB' },
  { id: 'base', name: 'Base', icon: 'BASE' },
  { id: 'polygon', name: 'Polygon', icon: 'MATIC' },
];

// Get protocols available on a chain
export function getProtocolsForChain(chainId: ChainId): Protocol[] {
  return PROTOCOLS.filter((p) => p.chains.includes(chainId));
}

// Get tokens available on a chain
export function getTokensForChain(chainId: ChainId): Token[] {
  return TOKENS[chainId] || [];
}
