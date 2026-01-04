//! Arbitrage opportunity types

use alloy_primitives::{Address, U256};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

use crate::{ChainId, DexProtocol, SwapRoute};

/// Type of arbitrage opportunity
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ArbitrageType {
    /// Buy on DEX A, sell on DEX B
    CrossDex,
    /// A -> B -> C -> A cycle
    Triangular,
    /// Cross-chain arbitrage
    CrossChain,
    /// Flash loan arbitrage
    FlashLoan,
}

/// Detected arbitrage opportunity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArbitrageOpportunity {
    pub id: String,
    pub arb_type: ArbitrageType,
    pub chain: ChainId,

    // Token pair
    pub token_a: Address,
    pub token_b: Address,
    pub token_pair: String,

    // Routes
    pub buy_route: SwapRoute,
    pub sell_route: SwapRoute,

    // Profit calculation
    pub input_amount: U256,
    pub output_amount: U256,
    pub gross_profit: U256,
    pub gas_cost_wei: U256,
    pub net_profit: U256,
    pub profit_bps: i32,
    pub profit_usd: f64,

    // Timing
    pub detected_at_ms: u64,
    pub expires_at_ms: u64,
    pub block_number: u64,

    // Confidence
    pub confidence: f64,  // 0.0 - 1.0
    pub competing_txs: u32,
}

impl ArbitrageOpportunity {
    /// Check if opportunity is still valid
    pub fn is_valid(&self, now_ms: u64) -> bool {
        now_ms < self.expires_at_ms && self.net_profit > U256::ZERO
    }

    /// Time until expiration
    pub fn ttl_ms(&self, now_ms: u64) -> i64 {
        self.expires_at_ms as i64 - now_ms as i64
    }

    /// Check if profitable after gas
    pub fn is_profitable(&self, min_profit_wei: U256) -> bool {
        self.net_profit >= min_profit_wei
    }

    /// Calculate ROI in basis points
    pub fn roi_bps(&self) -> i32 {
        if self.input_amount.is_zero() {
            return 0;
        }
        let input: f64 = self.input_amount.to_string().parse().unwrap_or(1.0);
        let profit: f64 = self.net_profit.to_string().parse().unwrap_or(0.0);
        ((profit / input) * 10_000.0) as i32
    }

    /// Estimated success probability based on competition
    pub fn success_probability(&self) -> f64 {
        if self.competing_txs == 0 {
            return self.confidence * 0.9;
        }
        // Rough model: probability decreases with more competition
        let competition_factor = 1.0 / (1.0 + self.competing_txs as f64 * 0.3);
        self.confidence * competition_factor * 0.8
    }
}

/// Builder for ArbitrageOpportunity
#[derive(Debug, Default)]
pub struct OpportunityBuilder {
    arb_type: Option<ArbitrageType>,
    chain: Option<ChainId>,
    token_a: Option<Address>,
    token_b: Option<Address>,
    buy_route: Option<SwapRoute>,
    sell_route: Option<SwapRoute>,
    input_amount: Option<U256>,
    gas_cost_wei: Option<U256>,
    block_number: Option<u64>,
}

impl OpportunityBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn arb_type(mut self, t: ArbitrageType) -> Self {
        self.arb_type = Some(t);
        self
    }

    pub fn chain(mut self, c: ChainId) -> Self {
        self.chain = Some(c);
        self
    }

    pub fn tokens(mut self, a: Address, b: Address) -> Self {
        self.token_a = Some(a);
        self.token_b = Some(b);
        self
    }

    pub fn routes(mut self, buy: SwapRoute, sell: SwapRoute) -> Self {
        self.buy_route = Some(buy);
        self.sell_route = Some(sell);
        self
    }

    pub fn input(mut self, amount: U256) -> Self {
        self.input_amount = Some(amount);
        self
    }

    pub fn gas_cost(mut self, cost: U256) -> Self {
        self.gas_cost_wei = Some(cost);
        self
    }

    pub fn block(mut self, num: u64) -> Self {
        self.block_number = Some(num);
        self
    }

    pub fn build(self) -> Option<ArbitrageOpportunity> {
        let buy_route = self.buy_route?;
        let sell_route = self.sell_route?;
        let input_amount = self.input_amount.unwrap_or(buy_route.total_amount_in);
        let output_amount = sell_route.total_amount_out;
        let gas_cost_wei = self.gas_cost_wei.unwrap_or(U256::ZERO);

        let gross_profit = if output_amount > input_amount {
            output_amount - input_amount
        } else {
            U256::ZERO
        };

        let net_profit = if gross_profit > gas_cost_wei {
            gross_profit - gas_cost_wei
        } else {
            U256::ZERO
        };

        let profit_bps = if !input_amount.is_zero() {
            let input_f: f64 = input_amount.to_string().parse().unwrap_or(1.0);
            let profit_f: f64 = net_profit.to_string().parse().unwrap_or(0.0);
            ((profit_f / input_f) * 10_000.0) as i32
        } else {
            0
        };

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        Some(ArbitrageOpportunity {
            id: format!("{:x}", now_ms),
            arb_type: self.arb_type.unwrap_or(ArbitrageType::CrossDex),
            chain: self.chain.unwrap_or(ChainId::Ethereum),
            token_a: self.token_a.unwrap_or(Address::ZERO),
            token_b: self.token_b.unwrap_or(Address::ZERO),
            token_pair: String::new(),
            buy_route,
            sell_route,
            input_amount,
            output_amount,
            gross_profit,
            gas_cost_wei,
            net_profit,
            profit_bps,
            profit_usd: 0.0,  // Needs price data
            detected_at_ms: now_ms,
            expires_at_ms: now_ms + 12_000,  // 1 block on Ethereum
            block_number: self.block_number.unwrap_or(0),
            confidence: 0.8,
            competing_txs: 0,
        })
    }
}

/// Opportunity filter criteria
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpportunityFilter {
    pub min_profit_usd: f64,
    pub min_profit_bps: i32,
    pub max_gas_cost_usd: f64,
    pub allowed_dexes: Vec<DexProtocol>,
    pub allowed_chains: Vec<ChainId>,
    pub max_hops: u8,
    pub min_confidence: f64,
}

impl Default for OpportunityFilter {
    fn default() -> Self {
        Self {
            min_profit_usd: 1.0,
            min_profit_bps: 10,  // 0.1%
            max_gas_cost_usd: 50.0,
            allowed_dexes: vec![
                DexProtocol::UniswapV2,
                DexProtocol::UniswapV3,
                DexProtocol::SushiSwap,
            ],
            allowed_chains: vec![ChainId::Ethereum, ChainId::Arbitrum],
            max_hops: 3,
            min_confidence: 0.5,
        }
    }
}

impl OpportunityFilter {
    pub fn matches(&self, opp: &ArbitrageOpportunity) -> bool {
        opp.profit_usd >= self.min_profit_usd
            && opp.profit_bps >= self.min_profit_bps
            && opp.confidence >= self.min_confidence
            && self.allowed_chains.contains(&opp.chain)
            && opp.buy_route.hop_count() <= self.max_hops as usize
    }
}
