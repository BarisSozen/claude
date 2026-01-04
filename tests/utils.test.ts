/**
 * Utility Functions Tests
 */

import {
  bpsToDecimal,
  decimalToBps,
  calculatePriceImpactBps,
  calculateMinOutput,
  calculateEffectivePrice,
  calculateDepthMultiplier,
  isDataStale,
  getAmountOutConstantProduct,
  getAmountInConstantProduct,
  getSpotPriceFromReserves,
  formatAmount,
  parseAmount,
  estimateConfidence,
} from '../src/utils';

describe('bpsToDecimal', () => {
  it('should convert basis points to decimal', () => {
    expect(bpsToDecimal(100)).toBe(0.01);
    expect(bpsToDecimal(50)).toBe(0.005);
    expect(bpsToDecimal(10000)).toBe(1);
    expect(bpsToDecimal(0)).toBe(0);
  });
});

describe('decimalToBps', () => {
  it('should convert decimal to basis points', () => {
    expect(decimalToBps(0.01)).toBe(100);
    expect(decimalToBps(0.005)).toBe(50);
    expect(decimalToBps(1)).toBe(10000);
    expect(decimalToBps(0)).toBe(0);
  });
});

describe('calculatePriceImpactBps', () => {
  it('should calculate price impact correctly', () => {
    // 1 ETH in, 2000 USDC out, spot price 2100 USDC/ETH
    const impact = calculatePriceImpactBps(
      BigInt(1e18), // 1 ETH
      BigInt(2000e6), // 2000 USDC
      2100, // spot price
      18, // ETH decimals
      6 // USDC decimals
    );

    // (1/2000) / 2100 = 0.000000476, so 1 - 0.000000476/0.000476 ≈ 0.0476 = 476 bps
    expect(impact).toBeGreaterThan(0);
  });

  it('should return max impact for zero output', () => {
    const impact = calculatePriceImpactBps(
      BigInt(1e18),
      0n,
      2000,
      18,
      6
    );
    expect(impact).toBe(10000);
  });
});

describe('calculateMinOutput', () => {
  it('should calculate minimum output with slippage', () => {
    const expected = BigInt(2000e6); // 2000 USDC
    const slippageBps = 100; // 1%

    const minOutput = calculateMinOutput(expected, slippageBps);

    // 2000 * 0.99 = 1980
    expect(minOutput).toBe(BigInt(1980e6));
  });

  it('should handle zero slippage', () => {
    const expected = BigInt(2000e6);
    const minOutput = calculateMinOutput(expected, 0);
    expect(minOutput).toBe(expected);
  });
});

describe('calculateEffectivePrice', () => {
  it('should calculate effective price correctly', () => {
    const price = calculateEffectivePrice(
      BigInt(1e18), // 1 ETH
      BigInt(2000e6), // 2000 USDC
      18,
      6
    );
    expect(price).toBeCloseTo(0.0005, 5); // 1/2000
  });

  it('should return Infinity for zero output', () => {
    const price = calculateEffectivePrice(BigInt(1e18), 0n, 18, 6);
    expect(price).toBe(Infinity);
  });
});

describe('calculateDepthMultiplier', () => {
  it('should calculate depth multiplier correctly', () => {
    const depth = BigInt(1000e18); // 1000 ETH
    const trade = BigInt(100e18); // 100 ETH

    expect(calculateDepthMultiplier(depth, trade)).toBe(10);
  });

  it('should return Infinity for zero trade size', () => {
    expect(calculateDepthMultiplier(BigInt(1000e18), 0n)).toBe(Infinity);
  });
});

describe('isDataStale', () => {
  it('should detect stale data', () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 60; // 60 seconds ago
    expect(isDataStale(oldTimestamp, 30)).toBe(true);
  });

  it('should accept fresh data', () => {
    const freshTimestamp = Math.floor(Date.now() / 1000) - 5; // 5 seconds ago
    expect(isDataStale(freshTimestamp, 30)).toBe(false);
  });
});

describe('getAmountOutConstantProduct', () => {
  it('should calculate output for constant product AMM', () => {
    const reserveIn = BigInt(100e18); // 100 ETH
    const reserveOut = BigInt(200000e6); // 200000 USDC
    const amountIn = BigInt(1e18); // 1 ETH

    const amountOut = getAmountOutConstantProduct(amountIn, reserveIn, reserveOut, 30);

    // With 0.3% fee: (1 * 0.997 * 200000) / (100 + 1 * 0.997) ≈ 1974 USDC
    expect(amountOut).toBeGreaterThan(BigInt(1970e6));
    expect(amountOut).toBeLessThan(BigInt(2000e6));
  });

  it('should return 0 for invalid inputs', () => {
    expect(getAmountOutConstantProduct(0n, BigInt(100e18), BigInt(200000e6))).toBe(0n);
    expect(getAmountOutConstantProduct(BigInt(1e18), 0n, BigInt(200000e6))).toBe(0n);
    expect(getAmountOutConstantProduct(BigInt(1e18), BigInt(100e18), 0n)).toBe(0n);
  });
});

describe('getAmountInConstantProduct', () => {
  it('should calculate input for constant product AMM', () => {
    const reserveIn = BigInt(100e18);
    const reserveOut = BigInt(200000e6);
    const amountOut = BigInt(1000e6); // Want 1000 USDC

    const amountIn = getAmountInConstantProduct(amountOut, reserveIn, reserveOut, 30);

    // Should need slightly more than 0.5 ETH due to fee
    expect(amountIn).toBeGreaterThan(BigInt(5e17));
  });

  it('should return 0 for output >= reserve', () => {
    const amountIn = getAmountInConstantProduct(
      BigInt(300000e6), // More than reserve
      BigInt(100e18),
      BigInt(200000e6),
      30
    );
    expect(amountIn).toBe(0n);
  });
});

describe('getSpotPriceFromReserves', () => {
  it('should calculate spot price from reserves', () => {
    const price = getSpotPriceFromReserves(
      BigInt(100e18), // 100 ETH
      BigInt(200000e6), // 200000 USDC
      18,
      6
    );
    expect(price).toBe(2000); // 200000/100 = 2000 USDC/ETH
  });

  it('should return 0 for zero reserve', () => {
    expect(getSpotPriceFromReserves(0n, BigInt(200000e6), 18, 6)).toBe(0);
  });
});

describe('formatAmount', () => {
  it('should format bigint amounts', () => {
    expect(formatAmount(BigInt(1234567890123456789n), 18, 4)).toBe('1.2345');
    expect(formatAmount(BigInt(1000000), 6, 2)).toBe('1.00');
  });
});

describe('parseAmount', () => {
  it('should parse string amounts to bigint', () => {
    expect(parseAmount('1.5', 18)).toBe(BigInt('1500000000000000000'));
    expect(parseAmount('100', 6)).toBe(BigInt(100000000));
  });
});

describe('estimateConfidence', () => {
  it('should return high confidence for good conditions', () => {
    const confidence = estimateConfidence({
      depthMultiplier: 5,
      priceImpactBps: 10,
      dataAgeSec: 2,
      maxDataAgeSec: 12,
    });
    expect(confidence).toBeGreaterThan(80);
  });

  it('should return low confidence for poor conditions', () => {
    const confidence = estimateConfidence({
      depthMultiplier: 1,
      priceImpactBps: 200,
      dataAgeSec: 10,
      maxDataAgeSec: 12,
    });
    expect(confidence).toBeLessThan(30);
  });
});
