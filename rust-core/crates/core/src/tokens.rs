//! Token definitions and utilities
//!
//! CRITICAL: Always use correct decimals!
//! - USDC/USDT: 6 decimals (NOT 18!)
//! - WBTC: 8 decimals
//! - Most others: 18 decimals

use alloy_primitives::Address;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;

use crate::ChainId;

/// Token information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Token {
    pub address: Address,
    pub symbol: String,
    pub name: String,
    pub decimals: u8,
    pub chain: ChainId,
}

impl Token {
    pub fn new(address: Address, symbol: &str, name: &str, decimals: u8, chain: ChainId) -> Self {
        Self {
            address,
            symbol: symbol.to_string(),
            name: name.to_string(),
            decimals,
            chain,
        }
    }
}

/// Well-known token addresses per chain
pub static TOKENS: LazyLock<HashMap<ChainId, HashMap<&'static str, Token>>> = LazyLock::new(|| {
    let mut chains = HashMap::new();

    // Ethereum Mainnet
    let mut eth_tokens = HashMap::new();
    eth_tokens.insert("WETH", Token::new(
        "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2".parse().unwrap(),
        "WETH", "Wrapped Ether", 18, ChainId::Ethereum
    ));
    eth_tokens.insert("USDC", Token::new(
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48".parse().unwrap(),
        "USDC", "USD Coin", 6, ChainId::Ethereum  // ⚠️ 6 decimals!
    ));
    eth_tokens.insert("USDT", Token::new(
        "0xdAC17F958D2ee523a2206206994597C13D831ec7".parse().unwrap(),
        "USDT", "Tether USD", 6, ChainId::Ethereum  // ⚠️ 6 decimals!
    ));
    eth_tokens.insert("DAI", Token::new(
        "0x6B175474E89094C44Da98b954EesAC495271d0F".parse().unwrap(),
        "DAI", "Dai Stablecoin", 18, ChainId::Ethereum
    ));
    eth_tokens.insert("WBTC", Token::new(
        "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599".parse().unwrap(),
        "WBTC", "Wrapped Bitcoin", 8, ChainId::Ethereum  // ⚠️ 8 decimals!
    ));
    chains.insert(ChainId::Ethereum, eth_tokens);

    // Arbitrum
    let mut arb_tokens = HashMap::new();
    arb_tokens.insert("WETH", Token::new(
        "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1".parse().unwrap(),
        "WETH", "Wrapped Ether", 18, ChainId::Arbitrum
    ));
    arb_tokens.insert("USDC", Token::new(
        "0xaf88d065e77c8cC2239327C5EDb3A432268e5831".parse().unwrap(),
        "USDC", "USD Coin", 6, ChainId::Arbitrum
    ));
    arb_tokens.insert("USDT", Token::new(
        "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9".parse().unwrap(),
        "USDT", "Tether USD", 6, ChainId::Arbitrum
    ));
    arb_tokens.insert("ARB", Token::new(
        "0x912CE59144191C1204E64559FE8253a0e49E6548".parse().unwrap(),
        "ARB", "Arbitrum", 18, ChainId::Arbitrum
    ));
    chains.insert(ChainId::Arbitrum, arb_tokens);

    // Base
    let mut base_tokens = HashMap::new();
    base_tokens.insert("WETH", Token::new(
        "0x4200000000000000000000000000000000000006".parse().unwrap(),
        "WETH", "Wrapped Ether", 18, ChainId::Base
    ));
    base_tokens.insert("USDC", Token::new(
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".parse().unwrap(),
        "USDC", "USD Coin", 6, ChainId::Base
    ));
    chains.insert(ChainId::Base, base_tokens);

    // Polygon
    let mut poly_tokens = HashMap::new();
    poly_tokens.insert("WETH", Token::new(
        "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619".parse().unwrap(),
        "WETH", "Wrapped Ether", 18, ChainId::Polygon
    ));
    poly_tokens.insert("USDC", Token::new(
        "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359".parse().unwrap(),
        "USDC", "USD Coin", 6, ChainId::Polygon
    ));
    poly_tokens.insert("WMATIC", Token::new(
        "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270".parse().unwrap(),
        "WMATIC", "Wrapped Matic", 18, ChainId::Polygon
    ));
    chains.insert(ChainId::Polygon, poly_tokens);

    chains
});

/// Get token by symbol for a chain
pub fn get_token(chain: ChainId, symbol: &str) -> Option<&'static Token> {
    TOKENS.get(&chain)?.get(symbol)
}

/// Get token decimals - CRITICAL for correct amount calculations
pub fn get_decimals(chain: ChainId, address: Address) -> u8 {
    if let Some(chain_tokens) = TOKENS.get(&chain) {
        for token in chain_tokens.values() {
            if token.address == address {
                return token.decimals;
            }
        }
    }
    18 // Default, but should log a warning in production
}

/// Check if token is a stablecoin
pub fn is_stablecoin(symbol: &str) -> bool {
    matches!(symbol.to_uppercase().as_str(), "USDC" | "USDT" | "DAI" | "FRAX" | "LUSD")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_usdc_has_6_decimals() {
        let usdc = get_token(ChainId::Ethereum, "USDC").unwrap();
        assert_eq!(usdc.decimals, 6, "USDC must have 6 decimals!");
    }

    #[test]
    fn test_wbtc_has_8_decimals() {
        let wbtc = get_token(ChainId::Ethereum, "WBTC").unwrap();
        assert_eq!(wbtc.decimals, 8, "WBTC must have 8 decimals!");
    }

    #[test]
    fn test_stablecoin_detection() {
        assert!(is_stablecoin("USDC"));
        assert!(is_stablecoin("usdt"));
        assert!(!is_stablecoin("WETH"));
    }
}
