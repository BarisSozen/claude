//! Type conversions between internal types and proto types

use defi_core::{ChainId, DexProtocol as CoreDexProtocol};

use crate::proto::{Chain, DexProtocol};

impl From<Chain> for ChainId {
    fn from(chain: Chain) -> Self {
        match chain {
            Chain::Ethereum => ChainId::Ethereum,
            Chain::Arbitrum => ChainId::Arbitrum,
            Chain::Base => ChainId::Base,
            Chain::Polygon => ChainId::Polygon,
            Chain::Unknown => ChainId::Ethereum, // Default
        }
    }
}

impl From<ChainId> for Chain {
    fn from(chain: ChainId) -> Self {
        match chain {
            ChainId::Ethereum => Chain::Ethereum,
            ChainId::Arbitrum => Chain::Arbitrum,
            ChainId::Base => Chain::Base,
            ChainId::Polygon => Chain::Polygon,
        }
    }
}

impl From<i32> for ChainId {
    fn from(value: i32) -> Self {
        Chain::try_from(value)
            .unwrap_or(Chain::Ethereum)
            .into()
    }
}

impl From<DexProtocol> for CoreDexProtocol {
    fn from(dex: DexProtocol) -> Self {
        match dex {
            DexProtocol::UniswapV2 => CoreDexProtocol::UniswapV2,
            DexProtocol::UniswapV3 => CoreDexProtocol::UniswapV3,
            DexProtocol::Sushiswap => CoreDexProtocol::SushiSwap,
            DexProtocol::Curve => CoreDexProtocol::Curve,
            DexProtocol::Balancer => CoreDexProtocol::Balancer,
            DexProtocol::AaveV3 => CoreDexProtocol::AaveV3,
            DexProtocol::Unknown => CoreDexProtocol::UniswapV2,
        }
    }
}

impl From<CoreDexProtocol> for DexProtocol {
    fn from(dex: CoreDexProtocol) -> Self {
        match dex {
            CoreDexProtocol::UniswapV2 => DexProtocol::UniswapV2,
            CoreDexProtocol::UniswapV3 => DexProtocol::UniswapV3,
            CoreDexProtocol::SushiSwap => DexProtocol::Sushiswap,
            CoreDexProtocol::Curve => DexProtocol::Curve,
            CoreDexProtocol::Balancer => DexProtocol::Balancer,
            CoreDexProtocol::AaveV3 => DexProtocol::AaveV3,
        }
    }
}

impl From<i32> for CoreDexProtocol {
    fn from(value: i32) -> Self {
        DexProtocol::try_from(value)
            .unwrap_or(DexProtocol::UniswapV2)
            .into()
    }
}

/// Convert core opportunity to proto format
pub fn opportunity_to_proto(
    opp: &defi_core::ArbitrageOpportunity,
) -> crate::proto::ArbitrageOpportunity {
    use chrono::Utc;

    crate::proto::ArbitrageOpportunity {
        id: opp.id.clone(),
        chain: Chain::from(opp.chain) as i32,
        token_pair: opp.token_pair.clone(),
        route: opp.route.iter().map(step_to_proto).collect(),
        input_amount: Some(token_amount_to_proto(&opp.input)),
        output_amount: Some(token_amount_to_proto(&opp.output)),
        profit_usd: opp.profit_usd,
        profit_bps: opp.profit_bps as f64,
        confidence: opp.confidence,
        gas_estimate: opp.gas_estimate,
        gas_cost_usd: opp.gas_cost_usd,
        expires_at_ms: opp.expires_at.timestamp_millis() as u64,
        detected_at_ms: Utc::now().timestamp_millis() as u64,
    }
}

fn step_to_proto(step: &defi_core::SwapStep) -> crate::proto::SwapStep {
    crate::proto::SwapStep {
        dex: DexProtocol::from(step.dex) as i32,
        pool_address: step.pool_address.to_string(),
        token_in: Some(crate::proto::Token {
            address: step.token_in.address.to_string(),
            symbol: step.token_in.symbol.clone(),
            decimals: step.token_in.decimals as u32,
            chain: Chain::from(step.token_in.chain) as i32,
        }),
        token_out: Some(crate::proto::Token {
            address: step.token_out.address.to_string(),
            symbol: step.token_out.symbol.clone(),
            decimals: step.token_out.decimals as u32,
            chain: Chain::from(step.token_out.chain) as i32,
        }),
        amount_in: step.amount_in.to_string(),
        amount_out: step.amount_out.to_string(),
        price_impact_bps: step.price_impact_bps as f64,
    }
}

fn token_amount_to_proto(amount: &defi_core::TokenAmount) -> crate::proto::TokenAmount {
    crate::proto::TokenAmount {
        token: Some(crate::proto::Token {
            address: amount.token.address.to_string(),
            symbol: amount.token.symbol.clone(),
            decimals: amount.token.decimals as u32,
            chain: Chain::from(amount.token.chain) as i32,
        }),
        amount: amount.amount.to_string(),
        amount_usd: amount.value_usd,
    }
}

/// Get current timestamp in milliseconds
pub fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
