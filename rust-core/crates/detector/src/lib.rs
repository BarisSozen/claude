//! High-performance arbitrage detection engine
//!
//! Features:
//! - Cross-DEX arbitrage detection
//! - Triangular arbitrage detection
//! - Parallel scanning with rayon
//! - Sub-millisecond detection latency

pub mod scanner;
pub mod strategies;
pub mod optimizer;

pub use scanner::ArbitrageScanner;
pub use strategies::{CrossDexStrategy, TriangularStrategy, Strategy};
pub use optimizer::RouteOptimizer;
