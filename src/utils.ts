/**
 * Utility Functions
 * Helper functions for liquidity calculations
 *
 * IMPORTANT: All BigInt operations use safe arithmetic to prevent precision loss.
 * Never use Number() directly on wei/token amounts.
 */

// Precision constants for safe BigInt math - exported for use in other modules
export const PRECISION = 10n ** 18n; // 18 decimal precision for internal calculations
export const BPS_PRECISION = 10000n; // Basis points precision

/** Basis points to decimal */
export function bpsToDecimal(bps: number): number {
  return bps / 10000;
}

/** Decimal to basis points */
export function decimalToBps(decimal: number): number {
  return Math.round(decimal * 10000);
}

/**
 * Safely normalize a BigInt amount to a standard precision
 * This allows comparison between tokens with different decimals
 */
export function normalizeToPrecision(amount: bigint, decimals: number): bigint {
  if (decimals === 18) return amount;
  if (decimals < 18) {
    return amount * (10n ** BigInt(18 - decimals));
  }
  return amount / (10n ** BigInt(decimals - 18));
}

/**
 * Safe BigInt division with precision
 * Returns result scaled by PRECISION to maintain accuracy
 */
export function safeDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  return (numerator * PRECISION) / denominator;
}

/**
 * Convert a scaled BigInt ratio to a number (for display/logging only)
 * Only use this at the final step when you need a JS number
 */
export function scaledBigIntToNumber(scaled: bigint, precision: bigint = PRECISION): number {
  // Split into integer and fractional parts to avoid precision loss
  const intPart = scaled / precision;
  const fracPart = scaled % precision;

  // For very large numbers, just return the integer approximation
  if (intPart > BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(intPart);
  }

  return Number(intPart) + Number(fracPart) / Number(precision);
}

/**
 * Calculate price impact in basis points using safe BigInt arithmetic
 * price_impact_bps = |1 - (amountIn/amountOut) / spot_price| × 10000
 *
 * Uses BigInt throughout to prevent precision loss on large amounts
 */
export function calculatePriceImpactBps(
  amountIn: bigint,
  amountOut: bigint,
  spotPrice: number,
  decimalsIn: number,
  decimalsOut: number
): number {
  if (amountOut === 0n) return 10000; // Max impact if no output

  // Normalize both amounts to 18 decimals for consistent comparison
  const normalizedIn = normalizeToPrecision(amountIn, decimalsIn);
  const normalizedOut = normalizeToPrecision(amountOut, decimalsOut);

  // Calculate execution price as a scaled BigInt (multiplied by PRECISION)
  // executionPrice = normalizedIn / normalizedOut (scaled by 1e18)
  const executionPriceScaled = safeDivide(normalizedIn, normalizedOut);

  // Convert spot price to scaled BigInt
  // spotPrice is typically a small number like 0.0005 or 2000
  // Scale it by 1e18 for comparison
  const spotPriceScaled = BigInt(Math.floor(spotPrice * 1e18));

  if (spotPriceScaled === 0n) return 10000;

  // Calculate ratio: executionPrice / spotPrice (both already scaled)
  // Result is scaled by 1e18
  const ratioScaled = safeDivide(executionPriceScaled, spotPriceScaled);

  // Calculate |1 - ratio| in basis points
  // 1 scaled = 1e18, so we compare ratioScaled to 1e18
  const oneScaled = PRECISION;
  const diffScaled = ratioScaled > oneScaled
    ? ratioScaled - oneScaled
    : oneScaled - ratioScaled;

  // Convert to basis points: (diffScaled / 1e18) * 10000
  // = diffScaled * 10000 / 1e18
  const impactBps = (diffScaled * BPS_PRECISION) / PRECISION;

  // Safe to convert to number since bps is always small
  return Number(impactBps);
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
 * Calculate effective price from amounts using safe BigInt arithmetic
 * Returns the price as a number (safe for display, may lose some precision for very large values)
 */
export function calculateEffectivePrice(
  amountIn: bigint,
  amountOut: bigint,
  decimalsIn: number,
  decimalsOut: number
): number {
  if (amountOut === 0n) return Infinity;

  // Normalize both to 18 decimals
  const normalizedIn = normalizeToPrecision(amountIn, decimalsIn);
  const normalizedOut = normalizeToPrecision(amountOut, decimalsOut);

  // Calculate price as scaled BigInt
  const priceScaled = safeDivide(normalizedIn, normalizedOut);

  // Convert to number for return (safe since this is a price ratio, not an amount)
  return scaledBigIntToNumber(priceScaled);
}

/**
 * Calculate depth multiplier using safe BigInt arithmetic
 * Returns how many times the trade size fits into the liquidity
 */
export function calculateDepthMultiplier(
  liquidityDepth: bigint,
  tradeSize: bigint
): number {
  if (tradeSize === 0n) return Infinity;

  // Use BigInt division with precision to avoid Number() overflow
  const multiplierScaled = safeDivide(liquidityDepth, tradeSize);

  // Convert to number (safe since this is a ratio, typically < 1000)
  return scaledBigIntToNumber(multiplierScaled);
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
 * Calculate spot price from reserves using safe BigInt arithmetic
 * Returns price of token0 in terms of token1
 */
export function getSpotPriceFromReserves(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: number,
  decimals1: number
): number {
  if (reserve0 === 0n) return 0;

  // Normalize both reserves to 18 decimals
  const normalized0 = normalizeToPrecision(reserve0, decimals0);
  const normalized1 = normalizeToPrecision(reserve1, decimals1);

  // Calculate price as scaled BigInt: reserve1 / reserve0
  const priceScaled = safeDivide(normalized1, normalized0);

  // Convert to number (safe for price ratios)
  return scaledBigIntToNumber(priceScaled);
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
