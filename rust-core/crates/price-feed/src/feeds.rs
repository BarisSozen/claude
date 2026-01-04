//! WebSocket price feed implementations

use alloy_primitives::{Address, U256};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, error, info, warn};

use defi_core::{ChainId, DexProtocol, Pool, Price, UniswapV2Pool, UniswapV3Pool};
use crate::state::PriceState;

/// Price update message
#[derive(Debug, Clone)]
pub enum PriceUpdate {
    Price(Price),
    Pool(Pool),
    Block { chain: ChainId, number: u64 },
    Error(String),
}

/// Feed configuration
#[derive(Debug, Clone)]
pub struct FeedConfig {
    pub chain: ChainId,
    pub dex: DexProtocol,
    pub ws_url: String,
    pub reconnect_delay: Duration,
    pub max_reconnects: u32,
}

/// Base trait for price feeds
#[async_trait::async_trait]
pub trait PriceFeed: Send + Sync {
    async fn connect(&mut self) -> anyhow::Result<()>;
    async fn disconnect(&mut self);
    fn is_connected(&self) -> bool;
    fn chain(&self) -> ChainId;
    fn dex(&self) -> DexProtocol;
}

/// Uniswap V3 WebSocket feed
pub struct UniswapV3Feed {
    config: FeedConfig,
    state: Arc<PriceState>,
    connected: bool,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
}

impl UniswapV3Feed {
    pub fn new(config: FeedConfig, state: Arc<PriceState>) -> Self {
        Self {
            config,
            state,
            connected: false,
            shutdown: None,
        }
    }

    pub async fn run(&mut self, mut updates_tx: mpsc::Sender<PriceUpdate>) {
        let mut reconnect_count = 0;

        loop {
            match self.connect_and_listen(&mut updates_tx).await {
                Ok(_) => {
                    info!("Feed {} disconnected normally", self.config.dex.name());
                    break;
                }
                Err(e) => {
                    error!("Feed {} error: {}", self.config.dex.name(), e);
                    reconnect_count += 1;

                    if reconnect_count >= self.config.max_reconnects {
                        error!("Max reconnects reached for {}", self.config.dex.name());
                        break;
                    }

                    warn!(
                        "Reconnecting {} in {:?} (attempt {}/{})",
                        self.config.dex.name(),
                        self.config.reconnect_delay,
                        reconnect_count,
                        self.config.max_reconnects
                    );

                    tokio::time::sleep(self.config.reconnect_delay).await;
                }
            }
        }
    }

    async fn connect_and_listen(
        &mut self,
        updates_tx: &mut mpsc::Sender<PriceUpdate>,
    ) -> anyhow::Result<()> {
        info!("Connecting to {} at {}", self.config.dex.name(), self.config.ws_url);

        let (ws_stream, _) = connect_async(&self.config.ws_url).await?;
        let (mut write, mut read) = ws_stream.split();

        self.connected = true;
        info!("Connected to {}", self.config.dex.name());

        // Subscribe to pool updates
        let subscribe_msg = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_subscribe",
            "params": ["logs", {
                "topics": [
                    // Uniswap V3 Swap event
                    "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
                ]
            }]
        });

        write.send(Message::Text(subscribe_msg.to_string())).await?;

        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Ok(update) = self.parse_message(&text) {
                        // Update local state immediately
                        match &update {
                            PriceUpdate::Price(p) => self.state.update_price(p.clone()),
                            PriceUpdate::Pool(p) => self.state.update_pool(p.clone()),
                            PriceUpdate::Block { chain, number } => {
                                self.state.update_block(*chain, *number)
                            }
                            _ => {}
                        }

                        // Send to channel for external consumers
                        if updates_tx.send(update).await.is_err() {
                            debug!("Updates channel closed");
                            break;
                        }
                    }
                }
                Ok(Message::Ping(data)) => {
                    write.send(Message::Pong(data)).await?;
                }
                Ok(Message::Close(_)) => {
                    info!("WebSocket closed by server");
                    break;
                }
                Err(e) => {
                    error!("WebSocket error: {}", e);
                    return Err(e.into());
                }
                _ => {}
            }
        }

        self.connected = false;
        Ok(())
    }

    fn parse_message(&self, text: &str) -> anyhow::Result<PriceUpdate> {
        // Parse the WebSocket message and extract price/pool updates
        // This is a simplified implementation - real version would decode logs properly

        let json: serde_json::Value = serde_json::from_str(text)?;

        // Handle subscription confirmation
        if json.get("result").is_some() {
            debug!("Subscription confirmed");
            return Err(anyhow::anyhow!("Not a price update"));
        }

        // Handle log events
        if let Some(params) = json.get("params") {
            if let Some(result) = params.get("result") {
                // Parse Swap event log
                // In production, decode the actual log data
                let price = Price {
                    value: 0.0,  // Would be calculated from log data
                    token: Address::ZERO,
                    quote_token: Address::ZERO,
                    dex: self.config.dex,
                    chain: self.config.chain,
                    block_number: 0,
                    timestamp_ms: chrono::Utc::now().timestamp_millis() as u64,
                };

                return Ok(PriceUpdate::Price(price));
            }
        }

        Err(anyhow::anyhow!("Unknown message format"))
    }
}

#[async_trait::async_trait]
impl PriceFeed for UniswapV3Feed {
    async fn connect(&mut self) -> anyhow::Result<()> {
        // Connection is handled in run()
        Ok(())
    }

    async fn disconnect(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        self.connected = false;
    }

    fn is_connected(&self) -> bool {
        self.connected
    }

    fn chain(&self) -> ChainId {
        self.config.chain
    }

    fn dex(&self) -> DexProtocol {
        self.config.dex
    }
}

/// RPC-based pool state fetcher (for initial sync and fallback)
pub struct PoolFetcher {
    chain: ChainId,
    rpc_url: String,
}

impl PoolFetcher {
    pub fn new(chain: ChainId, rpc_url: String) -> Self {
        Self { chain, rpc_url }
    }

    /// Fetch V2 pool reserves
    pub async fn fetch_v2_reserves(
        &self,
        pool_address: Address,
        dex: DexProtocol,
    ) -> anyhow::Result<UniswapV2Pool> {
        // In production, use alloy to make the RPC call
        // getReserves() -> (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)

        todo!("Implement V2 reserves fetch with alloy")
    }

    /// Fetch V3 pool slot0
    pub async fn fetch_v3_slot0(
        &self,
        pool_address: Address,
    ) -> anyhow::Result<UniswapV3Pool> {
        // In production, use alloy to make the RPC call
        // slot0() -> (sqrtPriceX96, tick, observationIndex, ...)

        todo!("Implement V3 slot0 fetch with alloy")
    }

    /// Batch fetch multiple pools
    pub async fn fetch_pools_batch(
        &self,
        addresses: &[Address],
    ) -> anyhow::Result<Vec<Pool>> {
        // Use multicall for efficiency
        todo!("Implement batch pool fetch")
    }
}
