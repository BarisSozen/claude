//! Core type definitions

use alloy_primitives::{Address, U256};
use serde::{Deserialize, Serialize};
use std::fmt;

/// Supported blockchain networks
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChainId {
    Ethereum,
    Arbitrum,
    Base,
    Polygon,
}

impl ChainId {
    pub fn chain_id(&self) -> u64 {
        match self {
            ChainId::Ethereum => 1,
            ChainId::Arbitrum => 42161,
            ChainId::Base => 8453,
            ChainId::Polygon => 137,
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            ChainId::Ethereum => "ethereum",
            ChainId::Arbitrum => "arbitrum",
            ChainId::Base => "base",
            ChainId::Polygon => "polygon",
        }
    }

    pub fn block_time_ms(&self) -> u64 {
        match self {
            ChainId::Ethereum => 12000,
            ChainId::Arbitrum => 250,
            ChainId::Base => 2000,
            ChainId::Polygon => 2000,
        }
    }
}

impl fmt::Display for ChainId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.name())
    }
}

/// Supported DEX protocols
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DexProtocol {
    UniswapV2,
    UniswapV3,
    SushiSwap,
    Curve,
    Balancer,
    Camelot,      // Arbitrum
    Aerodrome,    // Base
    QuickSwap,    // Polygon
}

impl DexProtocol {
    pub fn name(&self) -> &'static str {
        match self {
            DexProtocol::UniswapV2 => "uniswap-v2",
            DexProtocol::UniswapV3 => "uniswap-v3",
            DexProtocol::SushiSwap => "sushiswap",
            DexProtocol::Curve => "curve",
            DexProtocol::Balancer => "balancer",
            DexProtocol::Camelot => "camelot",
            DexProtocol::Aerodrome => "aerodrome",
            DexProtocol::QuickSwap => "quickswap",
        }
    }

    pub fn is_available_on(&self, chain: ChainId) -> bool {
        match self {
            DexProtocol::UniswapV2 => matches!(chain, ChainId::Ethereum | ChainId::Arbitrum | ChainId::Polygon),
            DexProtocol::UniswapV3 => true,
            DexProtocol::SushiSwap => matches!(chain, ChainId::Ethereum | ChainId::Arbitrum | ChainId::Polygon),
            DexProtocol::Curve => matches!(chain, ChainId::Ethereum | ChainId::Arbitrum | ChainId::Polygon),
            DexProtocol::Balancer => matches!(chain, ChainId::Ethereum | ChainId::Arbitrum | ChainId::Polygon),
            DexProtocol::Camelot => matches!(chain, ChainId::Arbitrum),
            DexProtocol::Aerodrome => matches!(chain, ChainId::Base),
            DexProtocol::QuickSwap => matches!(chain, ChainId::Polygon),
        }
    }
}

/// Token amount with proper decimal handling
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TokenAmount {
    pub raw: U256,
    pub decimals: u8,
}

impl TokenAmount {
    pub fn new(raw: U256, decimals: u8) -> Self {
        Self { raw, decimals }
    }

    pub fn from_human(amount: f64, decimals: u8) -> Self {
        let multiplier = 10u64.pow(decimals as u32);
        let raw = U256::from((amount * multiplier as f64) as u128);
        Self { raw, decimals }
    }

    pub fn to_human(&self) -> f64 {
        let divisor = 10u64.pow(self.decimals as u32) as f64;
        // Convert U256 to f64 safely
        let raw_f64: f64 = self.raw.to_string().parse().unwrap_or(0.0);
        raw_f64 / divisor
    }

    pub fn is_zero(&self) -> bool {
        self.raw.is_zero()
    }
}

/// Price with source tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Price {
    pub value: f64,
    pub token: Address,
    pub quote_token: Address,
    pub dex: DexProtocol,
    pub chain: ChainId,
    pub block_number: u64,
    pub timestamp_ms: u64,
}

impl Price {
    pub fn age_ms(&self, now_ms: u64) -> u64 {
        now_ms.saturating_sub(self.timestamp_ms)
    }

    pub fn is_stale(&self, max_age_ms: u64, now_ms: u64) -> bool {
        self.age_ms(now_ms) > max_age_ms
    }
}

/// Gas price information
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct GasPrice {
    pub base_fee: U256,
    pub priority_fee: U256,
    pub max_fee: U256,
}

impl GasPrice {
    pub fn effective_gas_price(&self) -> U256 {
        self.base_fee + self.priority_fee
    }

    pub fn estimate_cost(&self, gas_units: u64) -> U256 {
        self.effective_gas_price() * U256::from(gas_units)
    }
}

/// Execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub success: bool,
    pub tx_hash: Option<String>,
    pub gas_used: Option<u64>,
    pub profit_wei: Option<U256>,
    pub error: Option<String>,
    pub latency_us: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_amount_conversion() {
        // USDC with 6 decimals
        let amount = TokenAmount::from_human(100.0, 6);
        assert_eq!(amount.raw, U256::from(100_000_000u64));
        assert!((amount.to_human() - 100.0).abs() < 0.0001);

        // ETH with 18 decimals
        let eth = TokenAmount::from_human(1.5, 18);
        assert!((eth.to_human() - 1.5).abs() < 0.0001);
    }

    #[test]
    fn test_chain_ids() {
        assert_eq!(ChainId::Ethereum.chain_id(), 1);
        assert_eq!(ChainId::Arbitrum.chain_id(), 42161);
        assert_eq!(ChainId::Base.chain_id(), 8453);
    }
}
