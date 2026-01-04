//! High-performance price feed aggregator
//!
//! Features:
//! - WebSocket connections to multiple DEXes
//! - Lock-free concurrent price updates
//! - Sub-millisecond latency
//! - Automatic reconnection
//! - Price staleness detection

pub mod aggregator;
pub mod feeds;
pub mod state;

pub use aggregator::PriceAggregator;
pub use state::PriceState;
