//! Main arbitrage scanner

use std::sync::Arc;
use std::time::{Duration, Instant};
use rayon::prelude::*;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use defi_core::{
    ArbitrageOpportunity, ChainId, DetectionConfig, OpportunityFilter,
    Pool, UniswapV2Pool,
};
use defi_price_feed::PriceState;

use crate::strategies::{CrossDexStrategy, TriangularStrategy, Strategy};
use crate::optimizer::RouteOptimizer;

/// Scanner configuration
#[derive(Debug, Clone)]
pub struct ScannerConfig {
    pub scan_interval: Duration,
    pub max_price_age: Duration,
    pub min_profit_bps: i32,
    pub max_gas_gwei: f64,
    pub enabled_chains: Vec<ChainId>,
    pub parallel_chains: bool,
}

impl Default for ScannerConfig {
    fn default() -> Self {
        Self {
            scan_interval: Duration::from_millis(100),
            max_price_age: Duration::from_millis(500),
            min_profit_bps: 10,  // 0.1%
            max_gas_gwei: 50.0,
            enabled_chains: vec![ChainId::Ethereum, ChainId::Arbitrum],
            parallel_chains: true,
        }
    }
}

/// Main arbitrage scanner
pub struct ArbitrageScanner {
    config: ScannerConfig,
    state: Arc<PriceState>,
    strategies: Vec<Box<dyn Strategy + Send + Sync>>,
    filter: OpportunityFilter,
    optimizer: RouteOptimizer,
}

impl ArbitrageScanner {
    pub fn new(config: ScannerConfig, state: Arc<PriceState>) -> Self {
        let strategies: Vec<Box<dyn Strategy + Send + Sync>> = vec![
            Box::new(CrossDexStrategy::new()),
            Box::new(TriangularStrategy::new()),
        ];

        Self {
            config,
            state,
            strategies,
            filter: OpportunityFilter::default(),
            optimizer: RouteOptimizer::new(),
        }
    }

    /// Run continuous scanning
    pub async fn run(&self, mut shutdown: tokio::sync::oneshot::Receiver<()>) {
        info!("Starting arbitrage scanner");

        let mut interval = tokio::time::interval(self.config.scan_interval);

        loop {
            tokio::select! {
                _ = interval.tick() => {
                    let start = Instant::now();
                    let opportunities = self.scan_all_chains().await;
                    let duration = start.elapsed();

                    if !opportunities.is_empty() {
                        info!(
                            "Found {} opportunities in {:?}",
                            opportunities.len(),
                            duration
                        );

                        for opp in &opportunities {
                            info!(
                                "Opportunity: {} {} profit={:.4} USD confidence={:.2}",
                                opp.chain,
                                opp.token_pair,
                                opp.profit_usd,
                                opp.confidence
                            );
                        }
                    } else {
                        debug!("Scan completed in {:?}, no opportunities", duration);
                    }
                }
                _ = &mut shutdown => {
                    info!("Scanner shutdown requested");
                    break;
                }
            }
        }
    }

    /// Scan all enabled chains
    async fn scan_all_chains(&self) -> Vec<ArbitrageOpportunity> {
        if self.config.parallel_chains {
            // Parallel scanning using rayon
            self.config.enabled_chains
                .par_iter()
                .flat_map(|chain| self.scan_chain(*chain))
                .collect()
        } else {
            // Sequential scanning
            self.config.enabled_chains
                .iter()
                .flat_map(|chain| self.scan_chain(*chain))
                .collect()
        }
    }

    /// Scan a single chain for opportunities
    fn scan_chain(&self, chain: ChainId) -> Vec<ArbitrageOpportunity> {
        let start = Instant::now();

        // Get fresh pool data
        let pools = self.state.get_chain_pools(chain, self.config.max_price_age);

        if pools.is_empty() {
            debug!("No pools available for {}", chain);
            return vec![];
        }

        // Run all strategies in parallel
        let opportunities: Vec<ArbitrageOpportunity> = self.strategies
            .par_iter()
            .flat_map(|strategy| {
                strategy.find_opportunities(chain, &pools, &self.state)
            })
            .filter(|opp| self.filter.matches(opp))
            .collect();

        // Optimize routes for valid opportunities
        let optimized: Vec<ArbitrageOpportunity> = opportunities
            .into_iter()
            .filter_map(|opp| self.optimizer.optimize(opp))
            .collect();

        debug!(
            "Scanned {} with {} pools, found {} opportunities in {:?}",
            chain,
            pools.len(),
            optimized.len(),
            start.elapsed()
        );

        optimized
    }

    /// Single scan (for testing)
    pub fn scan_once(&self) -> Vec<ArbitrageOpportunity> {
        self.config.enabled_chains
            .iter()
            .flat_map(|chain| self.scan_chain(*chain))
            .collect()
    }

    /// Update filter
    pub fn set_filter(&mut self, filter: OpportunityFilter) {
        self.filter = filter;
    }

    /// Get current stats
    pub fn stats(&self) -> ScannerStats {
        let state_stats = self.state.stats();

        ScannerStats {
            enabled_chains: self.config.enabled_chains.len(),
            strategy_count: self.strategies.len(),
            pool_count: state_stats.pool_count,
            price_count: state_stats.price_count,
        }
    }
}

/// Scanner statistics
#[derive(Debug, Clone)]
pub struct ScannerStats {
    pub enabled_chains: usize,
    pub strategy_count: usize,
    pub pool_count: usize,
    pub price_count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scanner_creation() {
        let config = ScannerConfig::default();
        let state = Arc::new(PriceState::new());
        let scanner = ArbitrageScanner::new(config, state);

        let stats = scanner.stats();
        assert_eq!(stats.strategy_count, 2);
        assert_eq!(stats.enabled_chains, 2);
    }

    #[test]
    fn test_empty_scan() {
        let config = ScannerConfig::default();
        let state = Arc::new(PriceState::new());
        let scanner = ArbitrageScanner::new(config, state);

        let opportunities = scanner.scan_once();
        assert!(opportunities.is_empty());
    }
}
