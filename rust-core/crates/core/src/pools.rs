//! Pool definitions for different DEX types

use alloy_primitives::{Address, U256};
use serde::{Deserialize, Serialize};

use crate::{ChainId, DexProtocol};

/// Uniswap V2 style pool (constant product)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UniswapV2Pool {
    pub address: Address,
    pub token0: Address,
    pub token1: Address,
    pub reserve0: U256,
    pub reserve1: U256,
    pub fee_bps: u16,  // Usually 30 (0.3%)
    pub chain: ChainId,
    pub dex: DexProtocol,
    pub block_number: u64,
}

impl UniswapV2Pool {
    /// Calculate output amount using constant product formula
    /// amountOut = (amountIn * fee * reserveOut) / (reserveIn * 10000 + amountIn * fee)
    pub fn get_amount_out(&self, amount_in: U256, token_in: Address) -> U256 {
        if amount_in.is_zero() {
            return U256::ZERO;
        }

        let (reserve_in, reserve_out) = if token_in == self.token0 {
            (self.reserve0, self.reserve1)
        } else {
            (self.reserve1, self.reserve0)
        };

        if reserve_in.is_zero() || reserve_out.is_zero() {
            return U256::ZERO;
        }

        let fee_multiplier = U256::from(10000 - self.fee_bps);
        let amount_in_with_fee = amount_in * fee_multiplier;
        let numerator = amount_in_with_fee * reserve_out;
        let denominator = reserve_in * U256::from(10000) + amount_in_with_fee;

        numerator / denominator
    }

    /// Calculate input amount needed for desired output
    pub fn get_amount_in(&self, amount_out: U256, token_out: Address) -> U256 {
        if amount_out.is_zero() {
            return U256::ZERO;
        }

        let (reserve_in, reserve_out) = if token_out == self.token1 {
            (self.reserve0, self.reserve1)
        } else {
            (self.reserve1, self.reserve0)
        };

        if reserve_in.is_zero() || reserve_out.is_zero() || amount_out >= reserve_out {
            return U256::MAX;
        }

        let fee_multiplier = U256::from(10000 - self.fee_bps);
        let numerator = reserve_in * amount_out * U256::from(10000);
        let denominator = (reserve_out - amount_out) * fee_multiplier;

        (numerator / denominator) + U256::from(1)
    }

    /// Calculate spot price (token1 per token0)
    pub fn spot_price(&self) -> f64 {
        if self.reserve0.is_zero() {
            return 0.0;
        }
        let r0: f64 = self.reserve0.to_string().parse().unwrap_or(0.0);
        let r1: f64 = self.reserve1.to_string().parse().unwrap_or(0.0);
        r1 / r0
    }

    /// Calculate price impact for a trade
    pub fn price_impact(&self, amount_in: U256, token_in: Address) -> f64 {
        let amount_out = self.get_amount_out(amount_in, token_in);
        if amount_out.is_zero() || amount_in.is_zero() {
            return 1.0;
        }

        let in_f64: f64 = amount_in.to_string().parse().unwrap_or(0.0);
        let out_f64: f64 = amount_out.to_string().parse().unwrap_or(0.0);

        let (reserve_in, reserve_out) = if token_in == self.token0 {
            (self.reserve0, self.reserve1)
        } else {
            (self.reserve1, self.reserve0)
        };

        let r_in: f64 = reserve_in.to_string().parse().unwrap_or(1.0);
        let r_out: f64 = reserve_out.to_string().parse().unwrap_or(1.0);

        let spot = r_out / r_in;
        let effective = out_f64 / in_f64;

        1.0 - (effective / spot)
    }
}

/// Uniswap V3 style pool (concentrated liquidity)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UniswapV3Pool {
    pub address: Address,
    pub token0: Address,
    pub token1: Address,
    pub fee: u32,           // Fee in hundredths of a bip (e.g., 3000 = 0.3%)
    pub tick_spacing: i32,
    pub liquidity: u128,
    pub sqrt_price_x96: U256,
    pub tick: i32,
    pub chain: ChainId,
    pub block_number: u64,
}

impl UniswapV3Pool {
    /// Fee tiers
    pub const FEE_LOWEST: u32 = 100;    // 0.01%
    pub const FEE_LOW: u32 = 500;       // 0.05%
    pub const FEE_MEDIUM: u32 = 3000;   // 0.3%
    pub const FEE_HIGH: u32 = 10000;    // 1%

    /// Calculate current price from sqrtPriceX96
    pub fn current_price(&self) -> f64 {
        let sqrt_price: f64 = self.sqrt_price_x96.to_string().parse().unwrap_or(0.0);
        let q96: f64 = 2f64.powi(96);
        let price = (sqrt_price / q96).powi(2);
        price
    }

    /// Get fee as percentage
    pub fn fee_percent(&self) -> f64 {
        self.fee as f64 / 1_000_000.0
    }
}

/// Curve pool (StableSwap)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurvePool {
    pub address: Address,
    pub tokens: Vec<Address>,
    pub balances: Vec<U256>,
    pub a_parameter: U256,  // Amplification coefficient
    pub fee: u64,           // Fee in 1e10 (e.g., 4000000 = 0.04%)
    pub chain: ChainId,
    pub block_number: u64,
}

impl CurvePool {
    /// Get fee as percentage
    pub fn fee_percent(&self) -> f64 {
        self.fee as f64 / 1e10
    }

    /// Check if this is a stablecoin pool (higher A parameter)
    pub fn is_stable_pool(&self) -> bool {
        self.a_parameter > U256::from(100)
    }
}

/// Generic pool enum for unified handling
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Pool {
    UniswapV2(UniswapV2Pool),
    UniswapV3(UniswapV3Pool),
    Curve(CurvePool),
}

impl Pool {
    pub fn address(&self) -> Address {
        match self {
            Pool::UniswapV2(p) => p.address,
            Pool::UniswapV3(p) => p.address,
            Pool::Curve(p) => p.address,
        }
    }

    pub fn chain(&self) -> ChainId {
        match self {
            Pool::UniswapV2(p) => p.chain,
            Pool::UniswapV3(p) => p.chain,
            Pool::Curve(p) => p.chain,
        }
    }

    pub fn block_number(&self) -> u64 {
        match self {
            Pool::UniswapV2(p) => p.block_number,
            Pool::UniswapV3(p) => p.block_number,
            Pool::Curve(p) => p.block_number,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_v2_constant_product() {
        let pool = UniswapV2Pool {
            address: Address::ZERO,
            token0: Address::ZERO,
            token1: Address::repeat_byte(1),
            reserve0: U256::from(1_000_000_000_000u64), // 1M USDC (6 decimals)
            reserve1: U256::from(500_000_000_000_000_000_000u128), // 500 ETH (18 decimals)
            fee_bps: 30,
            chain: ChainId::Ethereum,
            dex: DexProtocol::UniswapV2,
            block_number: 0,
        };

        // Swap 1000 USDC
        let amount_in = U256::from(1_000_000_000u64); // 1000 USDC
        let amount_out = pool.get_amount_out(amount_in, Address::ZERO);

        // Should get roughly 0.5 ETH (minus fees and slippage)
        assert!(amount_out > U256::ZERO);
        assert!(amount_out < U256::from(1_000_000_000_000_000_000u128)); // Less than 1 ETH
    }

    #[test]
    fn test_v3_price_calculation() {
        let pool = UniswapV3Pool {
            address: Address::ZERO,
            token0: Address::ZERO,
            token1: Address::repeat_byte(1),
            fee: 3000,
            tick_spacing: 60,
            liquidity: 1_000_000_000_000,
            sqrt_price_x96: U256::from(1u128 << 96), // Price = 1
            tick: 0,
            chain: ChainId::Ethereum,
            block_number: 0,
        };

        let price = pool.current_price();
        assert!((price - 1.0).abs() < 0.01);
    }
}
