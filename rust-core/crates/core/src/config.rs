//! Configuration types

use alloy_primitives::Address;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::{ChainId, DexProtocol};

/// RPC endpoint configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcConfig {
    pub http_url: String,
    pub ws_url: Option<String>,
    pub chain: ChainId,
    pub requests_per_second: u32,
}

/// DEX router addresses
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DexAddresses {
    pub router: Address,
    pub factory: Option<Address>,
    pub quoter: Option<Address>,
}

/// Chain-specific configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainConfig {
    pub chain: ChainId,
    pub rpc: RpcConfig,
    pub dexes: HashMap<DexProtocol, DexAddresses>,
    pub block_time_ms: u64,
    pub flashbots_relay: Option<String>,
}

/// Execution configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionConfig {
    pub min_profit_usd: f64,
    pub max_gas_price_gwei: f64,
    pub slippage_bps: u16,
    pub deadline_seconds: u64,
    pub use_flashbots: bool,
    pub max_retries: u32,
}

impl Default for ExecutionConfig {
    fn default() -> Self {
        Self {
            min_profit_usd: 1.0,
            max_gas_price_gwei: 100.0,
            slippage_bps: 50,
            deadline_seconds: 120,
            use_flashbots: true,
            max_retries: 2,
        }
    }
}

/// Detection configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionConfig {
    pub scan_interval_ms: u64,
    pub max_price_age_ms: u64,
    pub min_liquidity_usd: f64,
    pub max_price_impact_bps: u16,
    pub enabled_strategies: Vec<String>,
}

impl Default for DetectionConfig {
    fn default() -> Self {
        Self {
            scan_interval_ms: 100,  // 100ms for fast detection
            max_price_age_ms: 500,  // Prices older than 500ms are stale
            min_liquidity_usd: 10_000.0,
            max_price_impact_bps: 100,  // 1% max impact
            enabled_strategies: vec![
                "cross_dex".to_string(),
                "triangular".to_string(),
            ],
        }
    }
}

/// Risk management configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskConfig {
    pub max_position_usd: f64,
    pub max_daily_loss_usd: f64,
    pub max_consecutive_losses: u32,
    pub circuit_breaker_enabled: bool,
}

impl Default for RiskConfig {
    fn default() -> Self {
        Self {
            max_position_usd: 10_000.0,
            max_daily_loss_usd: 500.0,
            max_consecutive_losses: 3,
            circuit_breaker_enabled: true,
        }
    }
}

/// Complete bot configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotConfig {
    pub chains: Vec<ChainConfig>,
    pub execution: ExecutionConfig,
    pub detection: DetectionConfig,
    pub risk: RiskConfig,
    pub grpc_port: u16,
    pub metrics_port: u16,
}

impl BotConfig {
    pub fn get_chain_config(&self, chain: ChainId) -> Option<&ChainConfig> {
        self.chains.iter().find(|c| c.chain == chain)
    }
}
