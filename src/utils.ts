/**
 * Utility Functions
 * Helper functions for liquidity calculations
 */

/** Basis points to decimal */
export function bpsToDecimal(bps: number): number {
  return bps / 10000;
}

/** Decimal to basis points */
export function decimalToBps(decimal: number): number {
  return Math.round(decimal * 10000);
}

/**
 * Calculate price impact in basis points
 * price_impact_bps = |1 - (amountIn/amountOut) / spot_price| × 10000
 */
export function calculatePriceImpactBps(
  amountIn: bigint,
  amountOut: bigint,
  spotPrice: number,
  decimalsIn: number,
  decimalsOut: number
): number {
  if (amountOut === 0n) return 10000; // Max impact if no output

  // Normalize amounts to same decimal basis
  const normalizedIn = Number(amountIn) / Math.pow(10, decimalsIn);
  const normalizedOut = Number(amountOut) / Math.pow(10, decimalsOut);

  // Calculate execution price
  const executionPrice = normalizedIn / normalizedOut;

  // Calculate impact
  const impact = Math.abs(1 - executionPrice / spotPrice);

  return Math.round(impact * 10000);
}

/**
 * Calculate minimum output amount with slippage tolerance
 * minAmountOut = expectedOut × (1 - slippage_bps / 10000)
 */
export function calculateMinOutput(
  expectedOutput: bigint,
  slippageBps: number
): bigint {
  const multiplier = 10000n - BigInt(slippageBps);
  return (expectedOutput * multiplier) / 10000n;
}

/**
 * Calculate effective price from amounts
 */
export function calculateEffectivePrice(
  amountIn: bigint,
  amountOut: bigint,
  decimalsIn: number,
  decimalsOut: number
): number {
  if (amountOut === 0n) return Infinity;

  const normalizedIn = Number(amountIn) / Math.pow(10, decimalsIn);
  const normalizedOut = Number(amountOut) / Math.pow(10, decimalsOut);

  return normalizedIn / normalizedOut;
}

/**
 * Calculate depth multiplier
 */
export function calculateDepthMultiplier(
  liquidityDepth: bigint,
  tradeSize: bigint
): number {
  if (tradeSize === 0n) return Infinity;
  return Number(liquidityDepth) / Number(tradeSize);
}

/**
 * Check if data is stale
 */
export function isDataStale(
  dataTimestamp: number,
  maxAgeSec: number
): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now - dataTimestamp > maxAgeSec;
}

/**
 * Calculate profit after slippage in basis points
 */
export function calculateProfitAfterSlippage(
  grossProfitBps: number,
  priceImpactBps: number,
  slippageBps: number
): number {
  return grossProfitBps - priceImpactBps - slippageBps;
}

/**
 * Format bigint as human-readable with decimals
 */
export function formatAmount(amount: bigint, decimals: number, precision = 6): string {
  const divisor = BigInt(10 ** decimals);
  const integerPart = amount / divisor;
  const fractionalPart = amount % divisor;

  const fractionalStr = fractionalPart.toString().padStart(decimals, '0').slice(0, precision);

  return `${integerPart}.${fractionalStr}`;
}

/**
 * Parse human-readable amount to bigint
 */
export function parseAmount(amount: string, decimals: number): bigint {
  const [integerPart, fractionalPart = ''] = amount.split('.');
  const paddedFractional = fractionalPart.padEnd(decimals, '0').slice(0, decimals);

  return BigInt(integerPart + paddedFractional);
}

/**
 * Calculate UniswapV2-style constant product output
 * amountOut = (amountIn * reserveOut * 997) / (reserveIn * 1000 + amountIn * 997)
 */
export function getAmountOutConstantProduct(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number = 30
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) {
    return 0n;
  }

  const feeMultiplier = 10000n - BigInt(feeBps);
  const amountInWithFee = amountIn * feeMultiplier;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 10000n + amountInWithFee;

  return numerator / denominator;
}

/**
 * Calculate UniswapV2-style constant product input
 * amountIn = (reserveIn * amountOut * 1000) / ((reserveOut - amountOut) * 997) + 1
 */
export function getAmountInConstantProduct(
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number = 30
): bigint {
  if (amountOut <= 0n || reserveIn <= 0n || reserveOut <= 0n || amountOut >= reserveOut) {
    return 0n;
  }

  const feeMultiplier = 10000n - BigInt(feeBps);
  const numerator = reserveIn * amountOut * 10000n;
  const denominator = (reserveOut - amountOut) * feeMultiplier;

  return numerator / denominator + 1n;
}

/**
 * Calculate spot price from reserves
 */
export function getSpotPriceFromReserves(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: number,
  decimals1: number
): number {
  if (reserve0 === 0n) return 0;

  const normalized0 = Number(reserve0) / Math.pow(10, decimals0);
  const normalized1 = Number(reserve1) / Math.pow(10, decimals1);

  return normalized1 / normalized0;
}

/**
 * Estimate confidence score based on multiple factors
 */
export function estimateConfidence(params: {
  depthMultiplier: number;
  priceImpactBps: number;
  dataAgeSec: number;
  maxDataAgeSec: number;
}): number {
  const { depthMultiplier, priceImpactBps, dataAgeSec, maxDataAgeSec } = params;

  // Depth score (0-40 points)
  const depthScore = Math.min(40, depthMultiplier * 8);

  // Impact score (0-30 points, lower impact = higher score)
  const impactScore = Math.max(0, 30 - priceImpactBps / 10);

  // Freshness score (0-30 points)
  const freshnessScore = Math.max(0, 30 * (1 - dataAgeSec / maxDataAgeSec));

  return Math.round(depthScore + impactScore + freshnessScore);
}
