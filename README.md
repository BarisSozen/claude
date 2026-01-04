# Liquidity Depth Analyzer

DEX liquidity depth analyzer for MEV trading - slippage estimation, price impact calculation, and route selection.

## Core Principle

**Never execute without knowing:**
1. How much liquidity exists
2. How far price will move
3. Whether profit survives slippage

## Installation

```bash
npm install
```

## Quick Start

```typescript
import { LiquidityDepthAnalyzer, UniswapV2Adapter, CONFIG_PROFILES } from 'liquidity-depth-analyzer';
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('YOUR_RPC_URL');
const analyzer = new LiquidityDepthAnalyzer(CONFIG_PROFILES.standard.getConfig());

// Register adapters
analyzer.registerAdapter('uniswap-v2', new UniswapV2Adapter({ provider }));

// Analyze trade
const result = await analyzer.analyzeTrade({
  poolAddress: '0x...',
  adapterKey: 'uniswap-v2',
  tokenIn: { address: '0x...', symbol: 'WETH', decimals: 18 },
  tokenOut: { address: '0x...', symbol: 'USDC', decimals: 6 },
  amountIn: ethers.parseEther('1'),
});

if (result.shouldExecute) {
  console.log(`Price impact: ${result.slippage.priceImpactBps} bps`);
  console.log(`Min output: ${result.slippage.minOutput}`);
} else {
  console.log(`Aborted: ${result.abortReason} - ${result.abortMessage}`);
}
```

## Key Formulas

```
price_impact_bps = |1 - (amountIn/amountOut) / spot_price| × 10000
minAmountOut = expectedOut × (1 - slippage_bps / 10000)
```

## Configuration

### Default Configuration

```typescript
const config = {
  maxPriceImpactBps: 50,     // 0.5%
  maxSlippageBps: 100,       // 1%
  minDepthMultiplier: 3,     // Depth >= 3x trade
  maxDataAgeSec: 12,         // ~1 block on Ethereum
  minProfitBps: 10,          // 0.1% minimum profit
};
```

### Pre-configured Profiles

| Profile | Max Impact | Max Slippage | Min Depth | Use Case |
|---------|------------|--------------|-----------|----------|
| `conservative` | 0.25% | 0.5% | 5x | Stable pairs |
| `standard` | 0.5% | 1% | 3x | General trading |
| `aggressive` | 1% | 2% | 2x | Volatile pairs |
| `mevSandwich` | 1.5% | 0.5% | 2x | Sandwich attacks |
| `arbitrage` | 0.3% | 0.3% | 4x | Arbitrage |

## Abort Reasons

| Code | Meaning |
|------|---------|
| `NO_POOL` | Pool doesn't exist or no adapter registered |
| `LOW_DEPTH` | Insufficient liquidity |
| `HIGH_PRICE_IMPACT` | Impact > threshold |
| `LOW_PROFIT` | Profit < slippage |
| `STALE_DATA` | Pool data too old |
| `INSUFFICIENT_OUTPUT` | Zero or negative output |

## Supported AMMs

### UniswapV2 Adapter
Constant product AMMs (Uniswap V2, Sushiswap, PancakeSwap, etc.)

```typescript
import { UniswapV2Adapter } from 'liquidity-depth-analyzer';

const adapter = new UniswapV2Adapter({
  provider,
  feeBps: 30, // 0.3% fee (default)
});
```

### UniswapV3 Adapter
Concentrated liquidity AMM

```typescript
import { UniswapV3Adapter } from 'liquidity-depth-analyzer';

const adapter = new UniswapV3Adapter({ provider });
```

### Curve Adapter
StableSwap AMM for stable pairs

```typescript
import { CurveAdapter } from 'liquidity-depth-analyzer';

const adapter = new CurveAdapter({
  provider,
  numCoins: 2, // Number of tokens in pool
});
```

## API Reference

### LiquidityDepthAnalyzer

#### `analyzeTrade(params)`
Analyze a single-pool trade.

```typescript
const result = await analyzer.analyzeTrade({
  poolAddress: string,
  adapterKey: string,
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
  expectedProfit?: bigint, // For MEV trades
});

// Returns: TradeAnalysis
{
  shouldExecute: boolean,
  abortReason?: AbortReason,
  abortMessage?: string,
  slippage: SlippageAnalysis,
  liquidityDepth: bigint,
  depthMultiplier: number,
  effectivePrice: number,
  spotPrice: number,
  estimatedProfit?: bigint,
  confidence: number,
}
```

#### `analyzeRoute(params)`
Analyze a multi-hop route.

```typescript
const result = await analyzer.analyzeRoute({
  segments: RouteSegment[],
  adapterKeys: string[],
  amountIn: bigint,
});

// Returns: RouteAnalysis
{
  segments: RouteSegment[],
  totalPriceImpactBps: number,
  totalSlippageBps: number,
  expectedOutput: bigint,
  minOutput: bigint,
  shouldExecute: boolean,
  abortReason?: AbortReason,
}
```

#### `quickViabilityCheck(params)`
Fast check if a trade is viable without full analysis.

```typescript
const result = await analyzer.quickViabilityCheck({
  poolAddress: string,
  adapterKey: string,
  tradeSize: bigint,
});

// Returns: { viable: boolean, reason?: string }
```

## Utility Functions

```typescript
import {
  calculatePriceImpactBps,
  calculateMinOutput,
  getAmountOutConstantProduct,
  formatAmount,
  parseAmount,
} from 'liquidity-depth-analyzer';

// Calculate price impact
const impactBps = calculatePriceImpactBps(amountIn, amountOut, spotPrice, 18, 6);

// Calculate min output with slippage
const minOut = calculateMinOutput(expectedOut, 100); // 1% slippage

// AMM math
const amountOut = getAmountOutConstantProduct(amountIn, reserveIn, reserveOut, 30);

// Formatting
const formatted = formatAmount(BigInt(1234567890123456789n), 18, 4); // "1.2345"
const parsed = parseAmount("1.5", 18); // 1500000000000000000n
```

## Testing

```bash
npm test
```

## Building

```bash
npm run build
```

## License

MIT
