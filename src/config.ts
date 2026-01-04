/**
 * Analyzer Configuration
 * Configurable thresholds and parameters for liquidity analysis
 */

import { AnalyzerConfig, DEFAULT_CONFIG } from './types';

/**
 * Configuration manager for the liquidity analyzer
 */
export class Config {
  private config: AnalyzerConfig;

  constructor(overrides?: Partial<AnalyzerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...overrides };
    this.validate();
  }

  private validate(): void {
    if (this.config.maxPriceImpactBps < 0 || this.config.maxPriceImpactBps > 10000) {
      throw new Error('maxPriceImpactBps must be between 0 and 10000');
    }
    if (this.config.maxSlippageBps < 0 || this.config.maxSlippageBps > 10000) {
      throw new Error('maxSlippageBps must be between 0 and 10000');
    }
    if (this.config.minDepthMultiplier < 1) {
      throw new Error('minDepthMultiplier must be at least 1');
    }
    if (this.config.maxDataAgeSec < 0) {
      throw new Error('maxDataAgeSec must be non-negative');
    }
  }

  get maxPriceImpactBps(): number {
    return this.config.maxPriceImpactBps;
  }

  get maxSlippageBps(): number {
    return this.config.maxSlippageBps;
  }

  get minDepthMultiplier(): number {
    return this.config.minDepthMultiplier;
  }

  get maxDataAgeSec(): number {
    return this.config.maxDataAgeSec;
  }

  get minProfitBps(): number {
    return this.config.minProfitBps ?? DEFAULT_CONFIG.minProfitBps!;
  }

  getConfig(): Readonly<AnalyzerConfig> {
    return Object.freeze({ ...this.config });
  }

  update(overrides: Partial<AnalyzerConfig>): void {
    this.config = { ...this.config, ...overrides };
    this.validate();
  }
}

/** Pre-configured profiles for different trading strategies */
export const CONFIG_PROFILES = {
  /** Conservative settings for stable pairs */
  conservative: new Config({
    maxPriceImpactBps: 25,    // 0.25%
    maxSlippageBps: 50,       // 0.5%
    minDepthMultiplier: 5,    // 5x depth required
    maxDataAgeSec: 6,         // Half a block
    minProfitBps: 20,         // 0.2% min profit
  }),

  /** Standard settings for most trades */
  standard: new Config({
    maxPriceImpactBps: 50,    // 0.5%
    maxSlippageBps: 100,      // 1%
    minDepthMultiplier: 3,    // 3x depth required
    maxDataAgeSec: 12,        // ~1 block
    minProfitBps: 10,         // 0.1% min profit
  }),

  /** Aggressive settings for volatile pairs or time-sensitive MEV */
  aggressive: new Config({
    maxPriceImpactBps: 100,   // 1%
    maxSlippageBps: 200,      // 2%
    minDepthMultiplier: 2,    // 2x depth required
    maxDataAgeSec: 24,        // ~2 blocks
    minProfitBps: 5,          // 0.05% min profit
  }),

  /** MEV-specific settings for sandwich attacks */
  mevSandwich: new Config({
    maxPriceImpactBps: 150,   // 1.5%
    maxSlippageBps: 50,       // 0.5% (we control execution)
    minDepthMultiplier: 2,
    maxDataAgeSec: 6,         // Very fresh data required
    minProfitBps: 1,          // Even tiny profits acceptable
  }),

  /** Arbitrage-specific settings */
  arbitrage: new Config({
    maxPriceImpactBps: 30,    // 0.3%
    maxSlippageBps: 30,       // 0.3%
    minDepthMultiplier: 4,    // Need good depth for arb
    maxDataAgeSec: 3,         // Extremely fresh data
    minProfitBps: 5,          // 0.05% min profit
  }),
};
