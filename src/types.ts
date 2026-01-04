/**
 * Liquidity Depth Analyzer Types
 * Core type definitions for DEX liquidity analysis and MEV trading
 */

/** Abort reason codes for trade execution */
export enum AbortReason {
  NO_POOL = 'NO_POOL',
  LOW_DEPTH = 'LOW_DEPTH',
  HIGH_PRICE_IMPACT = 'HIGH_PRICE_IMPACT',
  LOW_PROFIT = 'LOW_PROFIT',
  STALE_DATA = 'STALE_DATA',
  INSUFFICIENT_OUTPUT = 'INSUFFICIENT_OUTPUT',
}

/** AMM pool types */
export enum PoolType {
  UNISWAP_V2 = 'UNISWAP_V2',
  UNISWAP_V3 = 'UNISWAP_V3',
  CURVE = 'CURVE',
  BALANCER = 'BALANCER',
  CUSTOM = 'CUSTOM',
}

/** Token information */
export interface Token {
  address: string;
  symbol: string;
  decimals: number;
}

/** Pool reserve information */
export interface PoolReserves {
  token0: Token;
  token1: Token;
  reserve0: bigint;
  reserve1: bigint;
  blockNumber: number;
  timestamp: number;
}

/** UniswapV3 specific pool data */
export interface V3PoolData extends PoolReserves {
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
  fee: number;
  tickSpacing: number;
}

/** Curve pool specific data */
export interface CurvePoolData {
  tokens: Token[];
  balances: bigint[];
  amplificationCoefficient: bigint;
  fee: number;
  blockNumber: number;
  timestamp: number;
}

/** Liquidity depth at various price levels */
export interface LiquidityDepth {
  /** Price level */
  price: number;
  /** Available liquidity at this price (in quote token) */
  liquidity: bigint;
  /** Cumulative liquidity up to this price */
  cumulativeLiquidity: bigint;
}

/** Slippage analysis result */
export interface SlippageAnalysis {
  /** Expected output amount without slippage */
  expectedOutput: bigint;
  /** Minimum output with slippage tolerance */
  minOutput: bigint;
  /** Estimated actual output considering liquidity */
  estimatedOutput: bigint;
  /** Price impact in basis points */
  priceImpactBps: number;
  /** Slippage from expected in basis points */
  slippageBps: number;
}

/** Trade execution analysis result */
export interface TradeAnalysis {
  /** Whether trade should proceed */
  shouldExecute: boolean;
  /** Reason for abort if shouldExecute is false */
  abortReason?: AbortReason;
  /** Detailed abort message */
  abortMessage?: string;
  /** Slippage analysis */
  slippage: SlippageAnalysis;
  /** Available liquidity depth */
  liquidityDepth: bigint;
  /** Depth multiplier (liquidity / trade size) */
  depthMultiplier: number;
  /** Effective price after impact */
  effectivePrice: number;
  /** Spot price before trade */
  spotPrice: number;
  /** Estimated profit after slippage (if applicable) */
  estimatedProfit?: bigint;
  /** Confidence score (0-100) */
  confidence: number;
}

/** Route segment for multi-hop trades */
export interface RouteSegment {
  poolAddress: string;
  poolType: PoolType;
  tokenIn: Token;
  tokenOut: Token;
  fee?: number;
}

/** Multi-hop route analysis */
export interface RouteAnalysis {
  segments: RouteSegment[];
  totalPriceImpactBps: number;
  totalSlippageBps: number;
  expectedOutput: bigint;
  minOutput: bigint;
  shouldExecute: boolean;
  abortReason?: AbortReason;
}

/** Analyzer configuration */
export interface AnalyzerConfig {
  /** Maximum acceptable price impact in basis points */
  maxPriceImpactBps: number;
  /** Maximum acceptable slippage in basis points */
  maxSlippageBps: number;
  /** Minimum depth multiplier (liquidity / trade size) */
  minDepthMultiplier: number;
  /** Maximum data age in seconds before considered stale */
  maxDataAgeSec: number;
  /** Minimum profit threshold for MEV opportunities */
  minProfitBps?: number;
}

/** Default configuration values */
export const DEFAULT_CONFIG: AnalyzerConfig = {
  maxPriceImpactBps: 50,      // 0.5%
  maxSlippageBps: 100,        // 1%
  minDepthMultiplier: 3,      // Depth >= 3x trade size
  maxDataAgeSec: 12,          // ~1 block on Ethereum
  minProfitBps: 10,           // 0.1% minimum profit
};

/** Pool adapter interface for different AMM implementations */
export interface PoolAdapter {
  /** Get pool reserves */
  getReserves(poolAddress: string): Promise<PoolReserves>;

  /** Calculate output amount for given input */
  getAmountOut(
    amountIn: bigint,
    tokenIn: string,
    tokenOut: string,
    poolAddress: string
  ): Promise<bigint>;

  /** Calculate input amount for desired output */
  getAmountIn(
    amountOut: bigint,
    tokenIn: string,
    tokenOut: string,
    poolAddress: string
  ): Promise<bigint>;

  /** Get spot price */
  getSpotPrice(
    tokenIn: string,
    tokenOut: string,
    poolAddress: string
  ): Promise<number>;

  /** Get liquidity depth at price levels */
  getLiquidityDepth(
    tokenIn: string,
    tokenOut: string,
    poolAddress: string,
    priceLevels: number[]
  ): Promise<LiquidityDepth[]>;
}
