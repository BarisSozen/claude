//! Lock-free price state management
//!
//! Uses DashMap for concurrent reads/writes with minimal contention

use alloy_primitives::Address;
use dashmap::DashMap;
use parking_lot::RwLock;
use std::sync::Arc;
use std::time::{Duration, Instant};

use defi_core::{ChainId, DexProtocol, Pool, Price, UniswapV2Pool, UniswapV3Pool};

/// Key for price lookups
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PriceKey {
    pub chain: ChainId,
    pub token0: Address,
    pub token1: Address,
    pub dex: DexProtocol,
}

impl PriceKey {
    pub fn new(chain: ChainId, token0: Address, token1: Address, dex: DexProtocol) -> Self {
        // Normalize order so (A,B) and (B,A) map to same key
        let (t0, t1) = if token0 < token1 {
            (token0, token1)
        } else {
            (token1, token0)
        };
        Self { chain, token0: t0, token1: t1, dex }
    }
}

/// Pool key for lookups
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PoolKey {
    pub chain: ChainId,
    pub address: Address,
}

/// Timestamped price entry
#[derive(Debug, Clone)]
pub struct PriceEntry {
    pub price: Price,
    pub updated_at: Instant,
    pub block_number: u64,
}

impl PriceEntry {
    pub fn age(&self) -> Duration {
        self.updated_at.elapsed()
    }

    pub fn is_stale(&self, max_age: Duration) -> bool {
        self.age() > max_age
    }
}

/// Timestamped pool entry
#[derive(Debug, Clone)]
pub struct PoolEntry {
    pub pool: Pool,
    pub updated_at: Instant,
}

/// Global price state with lock-free access
#[derive(Debug)]
pub struct PriceState {
    /// Prices indexed by (chain, token0, token1, dex)
    prices: DashMap<PriceKey, PriceEntry>,

    /// Pools indexed by (chain, address)
    pools: DashMap<PoolKey, PoolEntry>,

    /// Latest block number per chain
    block_numbers: DashMap<ChainId, u64>,

    /// Stats
    update_count: std::sync::atomic::AtomicU64,
    last_update: RwLock<Instant>,
}

impl PriceState {
    pub fn new() -> Self {
        Self {
            prices: DashMap::new(),
            pools: DashMap::new(),
            block_numbers: DashMap::new(),
            update_count: std::sync::atomic::AtomicU64::new(0),
            last_update: RwLock::new(Instant::now()),
        }
    }

    /// Update a price
    pub fn update_price(&self, price: Price) {
        let key = PriceKey::new(
            price.chain,
            price.token,
            price.quote_token,
            price.dex,
        );

        let entry = PriceEntry {
            block_number: price.block_number,
            price,
            updated_at: Instant::now(),
        };

        self.prices.insert(key, entry);
        self.update_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        *self.last_update.write() = Instant::now();
    }

    /// Get a price
    pub fn get_price(&self, key: &PriceKey) -> Option<PriceEntry> {
        self.prices.get(key).map(|r| r.value().clone())
    }

    /// Get best price across all DEXes for a pair
    pub fn get_best_price(
        &self,
        chain: ChainId,
        token0: Address,
        token1: Address,
        max_age: Duration,
    ) -> Option<PriceEntry> {
        let now = Instant::now();
        let (t0, t1) = if token0 < token1 {
            (token0, token1)
        } else {
            (token1, token0)
        };

        self.prices
            .iter()
            .filter(|entry| {
                let key = entry.key();
                key.chain == chain
                    && key.token0 == t0
                    && key.token1 == t1
                    && !entry.value().is_stale(max_age)
            })
            .max_by(|a, b| {
                a.value().price.value.partial_cmp(&b.value().price.value)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|r| r.value().clone())
    }

    /// Update a pool
    pub fn update_pool(&self, pool: Pool) {
        let key = PoolKey {
            chain: pool.chain(),
            address: pool.address(),
        };

        let entry = PoolEntry {
            pool,
            updated_at: Instant::now(),
        };

        self.pools.insert(key, entry);
    }

    /// Get a pool
    pub fn get_pool(&self, chain: ChainId, address: Address) -> Option<PoolEntry> {
        let key = PoolKey { chain, address };
        self.pools.get(&key).map(|r| r.value().clone())
    }

    /// Update block number
    pub fn update_block(&self, chain: ChainId, block: u64) {
        self.block_numbers.insert(chain, block);
    }

    /// Get latest block
    pub fn get_block(&self, chain: ChainId) -> Option<u64> {
        self.block_numbers.get(&chain).map(|r| *r.value())
    }

    /// Get all prices for a chain (for scanning)
    pub fn get_chain_prices(&self, chain: ChainId, max_age: Duration) -> Vec<PriceEntry> {
        self.prices
            .iter()
            .filter(|e| e.key().chain == chain && !e.value().is_stale(max_age))
            .map(|e| e.value().clone())
            .collect()
    }

    /// Get all pools for a chain
    pub fn get_chain_pools(&self, chain: ChainId, max_age: Duration) -> Vec<PoolEntry> {
        self.pools
            .iter()
            .filter(|e| e.key().chain == chain && e.value().updated_at.elapsed() < max_age)
            .map(|e| e.value().clone())
            .collect()
    }

    /// Clean up stale entries
    pub fn cleanup(&self, max_age: Duration) {
        self.prices.retain(|_, v| !v.is_stale(max_age));
        self.pools.retain(|_, v| v.updated_at.elapsed() < max_age);
    }

    /// Stats
    pub fn stats(&self) -> PriceStateStats {
        PriceStateStats {
            price_count: self.prices.len(),
            pool_count: self.pools.len(),
            update_count: self.update_count.load(std::sync::atomic::Ordering::Relaxed),
            last_update_age: self.last_update.read().elapsed(),
        }
    }
}

impl Default for PriceState {
    fn default() -> Self {
        Self::new()
    }
}

/// Statistics about price state
#[derive(Debug, Clone)]
pub struct PriceStateStats {
    pub price_count: usize,
    pub pool_count: usize,
    pub update_count: u64,
    pub last_update_age: Duration,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_price_key_normalization() {
        let addr_a = Address::repeat_byte(1);
        let addr_b = Address::repeat_byte(2);

        let key1 = PriceKey::new(ChainId::Ethereum, addr_a, addr_b, DexProtocol::UniswapV3);
        let key2 = PriceKey::new(ChainId::Ethereum, addr_b, addr_a, DexProtocol::UniswapV3);

        assert_eq!(key1, key2, "Keys should be normalized regardless of token order");
    }

    #[test]
    fn test_concurrent_updates() {
        use std::sync::Arc;
        use std::thread;

        let state = Arc::new(PriceState::new());
        let handles: Vec<_> = (0..4)
            .map(|i| {
                let state = Arc::clone(&state);
                thread::spawn(move || {
                    for j in 0..100 {
                        let price = Price {
                            value: (i * 100 + j) as f64,
                            token: Address::repeat_byte(1),
                            quote_token: Address::repeat_byte(2),
                            dex: DexProtocol::UniswapV3,
                            chain: ChainId::Ethereum,
                            block_number: j as u64,
                            timestamp_ms: 0,
                        };
                        state.update_price(price);
                    }
                })
            })
            .collect();

        for h in handles {
            h.join().unwrap();
        }

        assert_eq!(state.stats().update_count, 400);
    }
}
