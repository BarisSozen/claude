//! Quote and swap route types

use alloy_primitives::{Address, U256};
use serde::{Deserialize, Serialize};

use crate::{ChainId, DexProtocol, Pool};

/// A single swap step in a route
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapStep {
    pub pool: Address,
    pub dex: DexProtocol,
    pub token_in: Address,
    pub token_out: Address,
    pub amount_in: U256,
    pub amount_out: U256,
    pub fee_bps: u16,
}

/// A complete swap route (may be multi-hop)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapRoute {
    pub steps: Vec<SwapStep>,
    pub chain: ChainId,
    pub total_amount_in: U256,
    pub total_amount_out: U256,
    pub gas_estimate: u64,
    pub price_impact_bps: u16,
}

impl SwapRoute {
    pub fn is_empty(&self) -> bool {
        self.steps.is_empty()
    }

    pub fn hop_count(&self) -> usize {
        self.steps.len()
    }

    /// Calculate effective price (amount_out / amount_in)
    pub fn effective_price(&self) -> f64 {
        if self.total_amount_in.is_zero() {
            return 0.0;
        }
        let in_f64: f64 = self.total_amount_in.to_string().parse().unwrap_or(0.0);
        let out_f64: f64 = self.total_amount_out.to_string().parse().unwrap_or(0.0);
        out_f64 / in_f64
    }

    /// Get the token path
    pub fn token_path(&self) -> Vec<Address> {
        if self.steps.is_empty() {
            return vec![];
        }

        let mut path = vec![self.steps[0].token_in];
        for step in &self.steps {
            path.push(step.token_out);
        }
        path
    }

    /// Calculate total fees in bps
    pub fn total_fees_bps(&self) -> u32 {
        self.steps.iter().map(|s| s.fee_bps as u32).sum()
    }
}

/// Quote from a DEX
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quote {
    pub route: SwapRoute,
    pub timestamp_ms: u64,
    pub valid_until_ms: u64,
    pub source: String,
}

impl Quote {
    pub fn is_expired(&self, now_ms: u64) -> bool {
        now_ms > self.valid_until_ms
    }

    pub fn ttl_ms(&self, now_ms: u64) -> i64 {
        self.valid_until_ms as i64 - now_ms as i64
    }
}

/// Quote request parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuoteRequest {
    pub chain: ChainId,
    pub token_in: Address,
    pub token_out: Address,
    pub amount_in: U256,
    pub slippage_bps: u16,
    pub max_hops: u8,
    pub deadline_ms: u64,
}

impl QuoteRequest {
    pub fn new(
        chain: ChainId,
        token_in: Address,
        token_out: Address,
        amount_in: U256,
    ) -> Self {
        Self {
            chain,
            token_in,
            token_out,
            amount_in,
            slippage_bps: 50,  // 0.5% default
            max_hops: 3,
            deadline_ms: 30_000,  // 30 seconds
        }
    }

    pub fn with_slippage(mut self, bps: u16) -> Self {
        self.slippage_bps = bps;
        self
    }

    pub fn with_max_hops(mut self, hops: u8) -> Self {
        self.max_hops = hops;
        self
    }
}

/// Aggregated quotes from multiple DEXes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregatedQuotes {
    pub request: QuoteRequest,
    pub quotes: Vec<Quote>,
    pub best_quote_index: Option<usize>,
    pub timestamp_ms: u64,
}

impl AggregatedQuotes {
    pub fn best_quote(&self) -> Option<&Quote> {
        self.best_quote_index.and_then(|i| self.quotes.get(i))
    }

    pub fn quote_count(&self) -> usize {
        self.quotes.len()
    }

    /// Get price spread between best and worst quotes
    pub fn price_spread_bps(&self) -> Option<u16> {
        if self.quotes.len() < 2 {
            return None;
        }

        let prices: Vec<f64> = self.quotes
            .iter()
            .map(|q| q.route.effective_price())
            .filter(|p| *p > 0.0)
            .collect();

        if prices.len() < 2 {
            return None;
        }

        let max = prices.iter().cloned().fold(f64::MIN, f64::max);
        let min = prices.iter().cloned().fold(f64::MAX, f64::min);

        if min <= 0.0 {
            return None;
        }

        let spread = (max - min) / min;
        Some((spread * 10_000.0) as u16)
    }
}
