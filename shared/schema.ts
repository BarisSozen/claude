/**
 * Shared TypeScript types for DeFi Bot
 * Used by both server and client
 */

// Ethereum address type
export type Address = `0x${string}`;
export type Hex = `0x${string}`;

// Chain identifiers
export type ChainId = 'ethereum' | 'arbitrum' | 'base' | 'polygon';

// User types
export interface User {
  id: string;
  walletAddress: Address;
  createdAt: Date;
  lastSeen: Date | null;
  preferences: UserPreferences;
}

export interface UserPreferences {
  defaultChain?: ChainId;
  slippageTolerance?: number;
  notifications?: boolean;
}

// Delegation types
export type DelegationStatus = 'active' | 'paused' | 'revoked' | 'expired';

export interface Delegation {
  id: string;
  userId: string;
  walletAddress: Address;
  sessionKeyAddress: Address;
  encryptedSessionKey: string;
  chainId: ChainId;
  allowedProtocols: string[];
  allowedTokens: Address[];
  status: DelegationStatus;
  validFrom: Date;
  validUntil: Date;
  createdAt: Date;
}

export interface SessionLimits {
  id: string;
  delegationId: string;
  maxPerTrade: string;
  maxDailyVolume: string;
  maxWeeklyVolume: string;
  currentDailyVolume: string;
  currentWeeklyVolume: string;
  maxLeverage: string;
  lastResetDaily: Date;
  lastResetWeekly: Date;
}

// Trade types
export type TradeAction = 'swap' | 'lend' | 'borrow' | 'repay' | 'flash_loan';
export type TradeStatus = 'pending' | 'success' | 'failed' | 'reverted';

export interface Trade {
  id: string;
  delegationId: string;
  txHash: string | null;
  chainId: ChainId;
  protocol: string;
  action: TradeAction;
  tokenIn: Address | null;
  tokenOut: Address | null;
  amountIn: string;
  amountOut: string | null;
  gasUsed: string | null;
  gasPrice: string | null;
  profitUsd: number | null;
  status: TradeStatus;
  errorMessage: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
}

// Audit types
export type AuditTrigger = 'user' | 'system' | 'admin';

export interface DelegationAudit {
  id: string;
  delegationId: string;
  action: string;
  triggeredBy: AuditTrigger;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// Price types
export interface TokenPrice {
  chain: ChainId;
  tokenAddress: Address;
  priceInUSD: number;
  priceInETH: bigint;
  dex: string;
  liquidity: bigint;
  timestamp: Date;
  confidence: 'high' | 'medium' | 'low';
}

export interface SwapQuote {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  route: string[];
  gasEstimate: bigint;
  priceImpact: number;
  expiresAt: Date;
}

// Arbitrage types
export type ArbitrageType = 'cross-exchange' | 'triangular' | 'cross-chain';

export interface ArbitrageOpportunity {
  id: string;
  type: ArbitrageType;
  tokenPair: string;
  buyDex: string;
  sellDex: string;
  buyPrice: bigint;
  sellPrice: bigint;
  profitUSD: number;
  profitPercent: number;
  requiredCapital: bigint;
  gasEstimateUSD: number;
  netProfitUSD: number;
  expiresAt: Date;
  executionPath: ExecutionStep[];
}

export interface ExecutionStep {
  dex: string;
  action: 'buy' | 'sell' | 'swap';
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  expectedAmountOut: bigint;
}

// Wallet types
export interface TokenBalance {
  tokenAddress: Address;
  symbol: string;
  decimals: number;
  balance: bigint;
  valueUSD: number;
}

export interface WalletBalance {
  walletAddress: Address;
  chainId: ChainId;
  tokens: TokenBalance[];
  totalValueUSD: number;
  lastUpdated: Date;
}

// Executor types
export interface ExecutorStatus {
  isRunning: boolean;
  dailyTradeCount: number;
  totalProfitToday: number;
  lastScanTime: Date | null;
  config: ExecutorConfig;
}

export interface ExecutorConfig {
  scanInterval: number;
  minProfitUSD: number;
  maxDailyTrades: number;
  enabledStrategies: string[];
}

// Trade execution params
export interface TradeParams {
  delegationId: string;
  protocol: string;
  action: TradeAction;
  tokenIn?: Address;
  tokenOut?: Address;
  amountIn: bigint;
  amountOutMin?: bigint;
  targetContract: Address;
  callData?: Hex;
}

export interface TradeResult {
  success: boolean;
  txHash?: string;
  error?: string;
  gasUsed?: bigint;
  effectivePrice?: string;
  actualAmountOut?: bigint;
}

// API response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

// WebSocket event types
export type WSEventType =
  | 'price:update'
  | 'opportunity:new'
  | 'trade:executed'
  | 'balance:update'
  | 'error'
  | 'executor:status'
  | 'pong';

export interface WSEvent<T = unknown> {
  type: WSEventType;
  payload: T;
  timestamp: number;
}

// Request validation schemas (used with Zod on server)
export interface CreateDelegationRequest {
  walletAddress: Address;
  sessionKeyAddress: Address;
  encryptedSessionKey: string;
  chainId: ChainId;
  allowedProtocols: string[];
  allowedTokens: Address[];
  validUntil: string;
  limits: {
    maxPerTrade: string;
    maxDailyVolume: string;
    maxWeeklyVolume: string;
    maxLeverage?: string;
  };
}

export interface ExecuteTradeRequest {
  delegationId: string;
  opportunityId?: string;
  params?: TradeParams;
}

// Token constants
export const TOKEN_DECIMALS: Record<string, number> = {
  // 6 decimals
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,  // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,  // USDT
  // 8 decimals
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 8,  // WBTC
  // 18 decimals (default)
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18, // WETH
  '0x6b175474e89094c44da98b954eedeac495271d0f': 18, // DAI
};

export const ETH_ADDRESS: Address = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// Protocol addresses
export const PROTOCOL_ADDRESSES = {
  ethereum: {
    uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564' as Address,
    uniswapV3Quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6' as Address,
    sushiswapRouter: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F' as Address,
    aavePool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' as Address,
    curveRouter: '0x99a58482BD75cbab83b27EC03CA68fF489b5788f' as Address,
    balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8' as Address,
  },
  arbitrum: {
    uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564' as Address,
    uniswapV3Quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6' as Address,
    sushiswapRouter: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506' as Address,
    aavePool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD' as Address,
    curveRouter: '0x2191718CD32d02B8E60BAdFFeA33E4B5DD9A0A0D' as Address,
    balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8' as Address,
  },
  base: {
    uniswapV3Router: '0x2626664c2603336E57B271c5C0b26F421741e481' as Address,
    uniswapV3Quoter: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a' as Address,
    aavePool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5' as Address,
  },
  polygon: {
    uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564' as Address,
    uniswapV3Quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6' as Address,
    sushiswapRouter: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506' as Address,
    aavePool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD' as Address,
    curveRouter: '0x0DCDED3545D565bA3B19E683431381007245d983' as Address,
    balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8' as Address,
  },
} as const;
