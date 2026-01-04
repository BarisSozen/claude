/**
 * Risk Manager Service Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock config
vi.mock('../config/env.js', () => ({
  config: {
    risk: {
      maxPriceImpact: 0.02,
      maxStablePriceImpact: 0.005,
    },
    executor: {
      minProfitUsd: 0.01,
    },
  },
}));

// Mock price oracle
vi.mock('./price-oracle.js', () => ({
  priceOracleService: {
    getBestSwapRoute: vi.fn(),
    getMaxPriceImpact: vi.fn().mockReturnValue(0.02),
    isStablecoin: vi.fn().mockReturnValue(false),
  },
}));

// Mock delegation service
vi.mock('./delegation.js', () => ({
  delegationService: {
    validate: vi.fn().mockResolvedValue({ valid: true }),
    revokeAllForWallet: vi.fn().mockResolvedValue(0),
  },
}));

describe('Risk Manager Service', () => {
  describe('calculateMinOutput', () => {
    it('should calculate minimum output with slippage correctly', async () => {
      const { riskManagerService } = await import('../services/risk-manager.js');

      const expectedOutput = 1000000000000000000n; // 1 ETH
      const slippageTolerance = 0.01; // 1%

      const minOutput = riskManagerService.calculateMinOutput(expectedOutput, slippageTolerance);

      expect(minOutput).toBe(990000000000000000n);
    });

    it('should handle 0% slippage', async () => {
      const { riskManagerService } = await import('../services/risk-manager.js');

      const expectedOutput = 1000000000000000000n;
      const minOutput = riskManagerService.calculateMinOutput(expectedOutput, 0);

      expect(minOutput).toBe(expectedOutput);
    });
  });

  describe('getDeadline', () => {
    it('should return deadline in future', async () => {
      const { riskManagerService } = await import('../services/risk-manager.js');

      const now = BigInt(Math.floor(Date.now() / 1000));
      const deadline = riskManagerService.getDeadline(5);

      expect(deadline > now).toBe(true);
      expect(deadline - now).toBe(300n); // 5 minutes
    });
  });

  describe('Circuit Breaker', () => {
    it('should track consecutive losses', async () => {
      const { riskManagerService } = await import('../services/risk-manager.js');

      // Reset state
      riskManagerService.resumeTrading();

      // Record losses
      riskManagerService.recordTradeResult(-10);
      riskManagerService.recordTradeResult(-10);

      const status = riskManagerService.getRiskStatus();
      expect(status.consecutiveLosses).toBe(2);
    });

    it('should reset consecutive losses on profit', async () => {
      const { riskManagerService } = await import('../services/risk-manager.js');

      riskManagerService.resumeTrading();

      riskManagerService.recordTradeResult(-10);
      riskManagerService.recordTradeResult(-10);
      riskManagerService.recordTradeResult(5); // Profit resets counter

      const status = riskManagerService.getRiskStatus();
      expect(status.consecutiveLosses).toBe(0);
    });
  });

  describe('Trading Controls', () => {
    it('should pause and resume trading', async () => {
      const { riskManagerService } = await import('../services/risk-manager.js');

      riskManagerService.pauseTrading('test');
      expect(riskManagerService.getRiskStatus().tradingPaused).toBe(true);

      riskManagerService.resumeTrading();
      expect(riskManagerService.getRiskStatus().tradingPaused).toBe(false);
    });

    it('should pause and resume specific strategies', async () => {
      const { riskManagerService } = await import('../services/risk-manager.js');

      riskManagerService.resumeTrading();

      riskManagerService.pauseStrategy('arbitrage');
      expect(riskManagerService.isStrategyPaused('arbitrage')).toBe(true);
      expect(riskManagerService.isStrategyPaused('other')).toBe(false);

      riskManagerService.resumeStrategy('arbitrage');
      expect(riskManagerService.isStrategyPaused('arbitrage')).toBe(false);
    });
  });
});
