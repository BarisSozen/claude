/**
 * Liquidity Depth Analyzer
 *
 * DEX liquidity depth analyzer for MEV trading - slippage estimation,
 * price impact calculation, and route selection.
 *
 * Core Principle: Never execute without knowing:
 * 1. How much liquidity exists
 * 2. How far price will move
 * 3. Whether profit survives slippage
 *
 * @example
 * ```typescript
 * import { LiquidityDepthAnalyzer, UniswapV2Adapter, CONFIG_PROFILES } from 'liquidity-depth-analyzer';
 * import { ethers } from 'ethers';
 *
 * const provider = new ethers.JsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/YOUR-KEY');
 * const analyzer = new LiquidityDepthAnalyzer(CONFIG_PROFILES.standard.getConfig());
 *
 * // Register adapters
 * analyzer.registerAdapter('uniswap-v2', new UniswapV2Adapter({ provider }));
 *
 * // Analyze trade
 * const result = await analyzer.analyzeTrade({
 *   poolAddress: '0x...',
 *   adapterKey: 'uniswap-v2',
 *   tokenIn: { address: '0x...', symbol: 'WETH', decimals: 18 },
 *   tokenOut: { address: '0x...', symbol: 'USDC', decimals: 6 },
 *   amountIn: ethers.parseEther('1'),
 * });
 *
 * if (result.shouldExecute) {
 *   console.log('Trade is viable!');
 *   console.log(`Price impact: ${result.slippage.priceImpactBps} bps`);
 *   console.log(`Min output: ${result.slippage.minOutput}`);
 * } else {
 *   console.log(`Trade aborted: ${result.abortReason} - ${result.abortMessage}`);
 * }
 * ```
 */

// Core analyzer
export { LiquidityDepthAnalyzer } from './analyzer';
export { default } from './analyzer';

// Configuration
export { Config, CONFIG_PROFILES } from './config';

// Types
export {
  AbortReason,
  PoolType,
  DEFAULT_CONFIG,
} from './types';

export type {
  AnalyzerConfig,
  Token,
  PoolReserves,
  V3PoolData,
  CurvePoolData,
  LiquidityDepth,
  SlippageAnalysis,
  TradeAnalysis,
  RouteSegment,
  RouteAnalysis,
  PoolAdapter,
} from './types';

// Adapters
export {
  UniswapV2Adapter,
  UniswapV3Adapter,
  CurveAdapter,
} from './adapters';

export type {
  UniswapV2AdapterConfig,
  UniswapV3AdapterConfig,
  CurveAdapterConfig,
} from './adapters';

// Utilities
export {
  bpsToDecimal,
  decimalToBps,
  calculatePriceImpactBps,
  calculateMinOutput,
  calculateEffectivePrice,
  calculateDepthMultiplier,
  isDataStale,
  calculateProfitAfterSlippage,
  formatAmount,
  parseAmount,
  getAmountOutConstantProduct,
  getAmountInConstantProduct,
  getSpotPriceFromReserves,
  estimateConfidence,
} from './utils';
