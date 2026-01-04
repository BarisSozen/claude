//! Route optimization for arbitrage opportunities

use alloy_primitives::U256;
use defi_core::{ArbitrageOpportunity, GasPrice};

/// Route optimizer - refines opportunities for execution
pub struct RouteOptimizer {
    min_profit_after_gas: U256,
    gas_price: Option<GasPrice>,
}

impl RouteOptimizer {
    pub fn new() -> Self {
        Self {
            min_profit_after_gas: U256::from(1_000_000_000_000_000u128), // 0.001 ETH
            gas_price: None,
        }
    }

    pub fn with_min_profit(mut self, min: U256) -> Self {
        self.min_profit_after_gas = min;
        self
    }

    pub fn update_gas_price(&mut self, gas_price: GasPrice) {
        self.gas_price = Some(gas_price);
    }

    /// Optimize an opportunity for execution
    pub fn optimize(&self, mut opp: ArbitrageOpportunity) -> Option<ArbitrageOpportunity> {
        // Calculate actual gas cost
        if let Some(gas_price) = &self.gas_price {
            let gas_units = opp.buy_route.gas_estimate + opp.sell_route.gas_estimate;
            opp.gas_cost_wei = gas_price.estimate_cost(gas_units);
        }

        // Recalculate net profit
        if opp.gross_profit > opp.gas_cost_wei {
            opp.net_profit = opp.gross_profit - opp.gas_cost_wei;
        } else {
            opp.net_profit = U256::ZERO;
        }

        // Filter unprofitable opportunities
        if opp.net_profit < self.min_profit_after_gas {
            return None;
        }

        // Update profit in bps
        if !opp.input_amount.is_zero() {
            let input_f: f64 = opp.input_amount.to_string().parse().unwrap_or(1.0);
            let profit_f: f64 = opp.net_profit.to_string().parse().unwrap_or(0.0);
            opp.profit_bps = ((profit_f / input_f) * 10_000.0) as i32;
        }

        // Update confidence based on competition and timing
        opp.confidence = self.calculate_confidence(&opp);

        Some(opp)
    }

    /// Calculate confidence score for an opportunity
    fn calculate_confidence(&self, opp: &ArbitrageOpportunity) -> f64 {
        let mut confidence = 0.9;

        // Reduce confidence if there's competition
        if opp.competing_txs > 0 {
            confidence *= 1.0 / (1.0 + opp.competing_txs as f64 * 0.2);
        }

        // Reduce confidence for multi-hop routes
        let total_hops = opp.buy_route.hop_count() + opp.sell_route.hop_count();
        if total_hops > 2 {
            confidence *= 0.9f64.powi((total_hops - 2) as i32);
        }

        // Reduce confidence for small profits (more susceptible to slippage)
        if opp.profit_bps < 20 {
            confidence *= 0.8;
        }

        confidence.max(0.1).min(0.99)
    }

    /// Find optimal input amount for maximum profit
    pub fn optimize_size(&self, opp: &ArbitrageOpportunity) -> U256 {
        // Binary search for optimal size
        // This is a simplified version - production would simulate at multiple sizes

        let min_size = opp.input_amount / U256::from(10);
        let max_size = opp.input_amount * U256::from(10);

        // For now, return the current size
        opp.input_amount
    }
}

impl Default for RouteOptimizer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_optimizer_creation() {
        let optimizer = RouteOptimizer::new();
        assert!(optimizer.gas_price.is_none());
    }
}
