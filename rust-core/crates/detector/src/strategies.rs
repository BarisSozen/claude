//! Arbitrage detection strategies

use std::sync::Arc;
use alloy_primitives::{Address, U256};
use rayon::prelude::*;

use defi_core::{
    ArbitrageOpportunity, ArbitrageType, ChainId, DexProtocol,
    OpportunityBuilder, Pool, SwapRoute, SwapStep, UniswapV2Pool,
};
use defi_price_feed::{PriceState, PoolEntry};

/// Strategy trait for different arbitrage types
pub trait Strategy: Send + Sync {
    fn name(&self) -> &'static str;
    fn find_opportunities(
        &self,
        chain: ChainId,
        pools: &[PoolEntry],
        state: &Arc<PriceState>,
    ) -> Vec<ArbitrageOpportunity>;
}

/// Cross-DEX arbitrage: Buy on DEX A, sell on DEX B
pub struct CrossDexStrategy {
    min_price_diff_bps: u32,
}

impl CrossDexStrategy {
    pub fn new() -> Self {
        Self {
            min_price_diff_bps: 10,  // 0.1% minimum
        }
    }

    fn find_pair_opportunities(
        &self,
        chain: ChainId,
        token0: Address,
        token1: Address,
        pools: &[PoolEntry],
    ) -> Vec<ArbitrageOpportunity> {
        let mut opportunities = Vec::new();

        // Get all pools for this pair
        let pair_pools: Vec<&PoolEntry> = pools
            .iter()
            .filter(|p| match &p.pool {
                Pool::UniswapV2(v2) => {
                    (v2.token0 == token0 && v2.token1 == token1) ||
                    (v2.token0 == token1 && v2.token1 == token0)
                }
                Pool::UniswapV3(v3) => {
                    (v3.token0 == token0 && v3.token1 == token1) ||
                    (v3.token0 == token1 && v3.token1 == token0)
                }
                _ => false,
            })
            .collect();

        if pair_pools.len() < 2 {
            return opportunities;
        }

        // Compare all pairs of pools
        for i in 0..pair_pools.len() {
            for j in (i + 1)..pair_pools.len() {
                if let Some(opp) = self.compare_pools(
                    chain,
                    token0,
                    token1,
                    &pair_pools[i].pool,
                    &pair_pools[j].pool,
                ) {
                    opportunities.push(opp);
                }
            }
        }

        opportunities
    }

    fn compare_pools(
        &self,
        chain: ChainId,
        token0: Address,
        token1: Address,
        pool_a: &Pool,
        pool_b: &Pool,
    ) -> Option<ArbitrageOpportunity> {
        // Get prices from both pools
        let (price_a, dex_a) = self.get_pool_price(pool_a, token0)?;
        let (price_b, dex_b) = self.get_pool_price(pool_b, token0)?;

        // Calculate price difference in bps
        let (buy_pool, sell_pool, buy_price, sell_price) = if price_a < price_b {
            (pool_a, pool_b, price_a, price_b)
        } else {
            (pool_b, pool_a, price_b, price_a)
        };

        let price_diff_bps = ((sell_price - buy_price) / buy_price * 10000.0) as u32;

        if price_diff_bps < self.min_price_diff_bps {
            return None;
        }

        // Calculate optimal trade size and profit
        let input_amount = self.calculate_optimal_size(buy_pool, sell_pool)?;

        // Build routes
        let buy_route = self.build_route(chain, buy_pool, token0, token1, input_amount)?;
        let sell_route = self.build_route(chain, sell_pool, token1, token0, buy_route.total_amount_out)?;

        OpportunityBuilder::new()
            .arb_type(ArbitrageType::CrossDex)
            .chain(chain)
            .tokens(token0, token1)
            .routes(buy_route, sell_route)
            .input(input_amount)
            .build()
    }

    fn get_pool_price(&self, pool: &Pool, base_token: Address) -> Option<(f64, DexProtocol)> {
        match pool {
            Pool::UniswapV2(v2) => {
                let price = v2.spot_price();
                let adjusted = if v2.token0 == base_token {
                    price
                } else {
                    1.0 / price
                };
                Some((adjusted, v2.dex))
            }
            Pool::UniswapV3(v3) => {
                let price = v3.current_price();
                let adjusted = if v3.token0 == base_token {
                    price
                } else {
                    1.0 / price
                };
                Some((adjusted, DexProtocol::UniswapV3))
            }
            _ => None,
        }
    }

    fn calculate_optimal_size(&self, buy_pool: &Pool, sell_pool: &Pool) -> Option<U256> {
        // Simplified: use a percentage of the smaller pool's liquidity
        match (buy_pool, sell_pool) {
            (Pool::UniswapV2(a), Pool::UniswapV2(b)) => {
                let min_reserve = a.reserve0.min(a.reserve1).min(b.reserve0).min(b.reserve1);
                // Trade 1% of liquidity
                Some(min_reserve / U256::from(100))
            }
            _ => Some(U256::from(1_000_000_000_000_000_000u128))  // 1 ETH default
        }
    }

    fn build_route(
        &self,
        chain: ChainId,
        pool: &Pool,
        token_in: Address,
        token_out: Address,
        amount_in: U256,
    ) -> Option<SwapRoute> {
        let (amount_out, pool_address, dex, fee_bps) = match pool {
            Pool::UniswapV2(v2) => {
                let out = v2.get_amount_out(amount_in, token_in);
                (out, v2.address, v2.dex, v2.fee_bps)
            }
            Pool::UniswapV3(v3) => {
                // Simplified V3 output calculation
                (amount_in, v3.address, DexProtocol::UniswapV3, (v3.fee / 100) as u16)
            }
            _ => return None,
        };

        let step = SwapStep {
            pool: pool_address,
            dex,
            token_in,
            token_out,
            amount_in,
            amount_out,
            fee_bps,
        };

        Some(SwapRoute {
            steps: vec![step],
            chain,
            total_amount_in: amount_in,
            total_amount_out: amount_out,
            gas_estimate: 150_000,
            price_impact_bps: 0,
        })
    }
}

impl Default for CrossDexStrategy {
    fn default() -> Self {
        Self::new()
    }
}

impl Strategy for CrossDexStrategy {
    fn name(&self) -> &'static str {
        "cross_dex"
    }

    fn find_opportunities(
        &self,
        chain: ChainId,
        pools: &[PoolEntry],
        _state: &Arc<PriceState>,
    ) -> Vec<ArbitrageOpportunity> {
        // Extract unique token pairs
        let mut pairs: Vec<(Address, Address)> = Vec::new();

        for entry in pools {
            let (t0, t1) = match &entry.pool {
                Pool::UniswapV2(v2) => (v2.token0, v2.token1),
                Pool::UniswapV3(v3) => (v3.token0, v3.token1),
                _ => continue,
            };

            let pair = if t0 < t1 { (t0, t1) } else { (t1, t0) };
            if !pairs.contains(&pair) {
                pairs.push(pair);
            }
        }

        // Scan pairs in parallel
        pairs
            .par_iter()
            .flat_map(|(t0, t1)| self.find_pair_opportunities(chain, *t0, *t1, pools))
            .collect()
    }
}

/// Triangular arbitrage: A -> B -> C -> A
pub struct TriangularStrategy {
    min_profit_bps: u32,
}

impl TriangularStrategy {
    pub fn new() -> Self {
        Self {
            min_profit_bps: 15,
        }
    }
}

impl Default for TriangularStrategy {
    fn default() -> Self {
        Self::new()
    }
}

impl Strategy for TriangularStrategy {
    fn name(&self) -> &'static str {
        "triangular"
    }

    fn find_opportunities(
        &self,
        chain: ChainId,
        pools: &[PoolEntry],
        _state: &Arc<PriceState>,
    ) -> Vec<ArbitrageOpportunity> {
        // Triangular arbitrage detection is more complex
        // This is a placeholder - full implementation would:
        // 1. Build a graph of token pairs
        // 2. Find 3-hop cycles
        // 3. Calculate profit for each cycle
        // 4. Filter by minimum profit threshold

        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cross_dex_strategy() {
        let strategy = CrossDexStrategy::new();
        assert_eq!(strategy.name(), "cross_dex");
    }

    #[test]
    fn test_triangular_strategy() {
        let strategy = TriangularStrategy::new();
        assert_eq!(strategy.name(), "triangular");
    }
}
