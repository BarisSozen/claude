//! Price feed aggregator - coordinates multiple feeds

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};
use tokio::task::JoinHandle;
use tracing::{error, info, warn};

use defi_core::{ChainId, DexProtocol, RpcConfig};
use crate::feeds::{FeedConfig, PriceUpdate, UniswapV3Feed};
use crate::state::PriceState;

/// Aggregator configuration
#[derive(Debug, Clone)]
pub struct AggregatorConfig {
    pub chains: Vec<ChainConfig>,
    pub cleanup_interval: Duration,
    pub max_price_age: Duration,
}

#[derive(Debug, Clone)]
pub struct ChainConfig {
    pub chain: ChainId,
    pub rpc_http: String,
    pub rpc_ws: String,
    pub enabled_dexes: Vec<DexProtocol>,
}

impl Default for AggregatorConfig {
    fn default() -> Self {
        Self {
            chains: vec![],
            cleanup_interval: Duration::from_secs(60),
            max_price_age: Duration::from_secs(30),
        }
    }
}

/// Main price aggregator
pub struct PriceAggregator {
    config: AggregatorConfig,
    state: Arc<PriceState>,
    update_rx: Option<mpsc::Receiver<PriceUpdate>>,
    update_tx: mpsc::Sender<PriceUpdate>,
    handles: Vec<JoinHandle<()>>,
    running: Arc<RwLock<bool>>,
}

impl PriceAggregator {
    pub fn new(config: AggregatorConfig) -> Self {
        let (update_tx, update_rx) = mpsc::channel(10_000);

        Self {
            config,
            state: Arc::new(PriceState::new()),
            update_rx: Some(update_rx),
            update_tx,
            handles: vec![],
            running: Arc::new(RwLock::new(false)),
        }
    }

    /// Get shared state reference
    pub fn state(&self) -> Arc<PriceState> {
        Arc::clone(&self.state)
    }

    /// Get update receiver (can only be taken once)
    pub fn take_update_receiver(&mut self) -> Option<mpsc::Receiver<PriceUpdate>> {
        self.update_rx.take()
    }

    /// Start all feeds
    pub async fn start(&mut self) -> anyhow::Result<()> {
        info!("Starting price aggregator");
        *self.running.write().await = true;

        for chain_config in &self.config.chains {
            for dex in &chain_config.enabled_dexes {
                let feed_config = FeedConfig {
                    chain: chain_config.chain,
                    dex: *dex,
                    ws_url: chain_config.rpc_ws.clone(),
                    reconnect_delay: Duration::from_secs(5),
                    max_reconnects: 10,
                };

                match dex {
                    DexProtocol::UniswapV3 => {
                        let mut feed = UniswapV3Feed::new(
                            feed_config,
                            Arc::clone(&self.state),
                        );
                        let tx = self.update_tx.clone();

                        let handle = tokio::spawn(async move {
                            feed.run(tx).await;
                        });

                        self.handles.push(handle);
                        info!("Started {} feed for {}", dex.name(), chain_config.chain);
                    }
                    _ => {
                        // Add other DEX feed implementations
                        warn!("Feed for {} not implemented yet", dex.name());
                    }
                }
            }
        }

        // Start cleanup task
        let state = Arc::clone(&self.state);
        let max_age = self.config.max_price_age;
        let cleanup_interval = self.config.cleanup_interval;
        let running = Arc::clone(&self.running);

        let cleanup_handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(cleanup_interval);

            loop {
                interval.tick().await;

                if !*running.read().await {
                    break;
                }

                state.cleanup(max_age);
                let stats = state.stats();
                info!(
                    "Price state: {} prices, {} pools, {} updates",
                    stats.price_count, stats.pool_count, stats.update_count
                );
            }
        });

        self.handles.push(cleanup_handle);

        Ok(())
    }

    /// Stop all feeds
    pub async fn stop(&mut self) {
        info!("Stopping price aggregator");
        *self.running.write().await = false;

        for handle in self.handles.drain(..) {
            handle.abort();
        }
    }

    /// Check if running
    pub async fn is_running(&self) -> bool {
        *self.running.read().await
    }

    /// Get statistics
    pub fn stats(&self) -> AggregatorStats {
        let state_stats = self.state.stats();

        AggregatorStats {
            feed_count: self.handles.len(),
            price_count: state_stats.price_count,
            pool_count: state_stats.pool_count,
            update_count: state_stats.update_count,
            last_update_age: state_stats.last_update_age,
        }
    }
}

/// Aggregator statistics
#[derive(Debug, Clone)]
pub struct AggregatorStats {
    pub feed_count: usize,
    pub price_count: usize,
    pub pool_count: usize,
    pub update_count: u64,
    pub last_update_age: Duration,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_aggregator_creation() {
        let config = AggregatorConfig::default();
        let aggregator = PriceAggregator::new(config);

        assert!(!aggregator.is_running().await);
        assert_eq!(aggregator.stats().feed_count, 0);
    }
}
