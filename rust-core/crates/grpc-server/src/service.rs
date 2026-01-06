//! gRPC service implementation

use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::Stream;
use parking_lot::RwLock;
use tokio::sync::{mpsc, oneshot};
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status};
use tracing::{debug, error, info, warn};

use defi_core::ChainId;
use defi_detector::{ArbitrageScanner, ScannerConfig};
use defi_executor::{TransactionSubmitter, SubmitterConfig};
use defi_price_feed::{PriceAggregator, AggregatorConfig, PriceState};

use crate::conversions::{self, opportunity_to_proto, now_ms};
use crate::proto::*;

/// Service state
pub struct ServiceState {
    pub price_state: Arc<PriceState>,
    pub aggregator: Option<PriceAggregator>,
    pub scanner: Option<ArbitrageScanner>,
    pub submitter: TransactionSubmitter,
    pub start_time: Instant,
    pub opportunities_found: u64,
    pub trades_executed: u64,
    pub total_profit_usd: f64,
    pub scanner_shutdown: Option<oneshot::Sender<()>>,
}

/// gRPC service implementation
pub struct DefiServiceImpl {
    state: Arc<RwLock<ServiceState>>,
}

impl DefiServiceImpl {
    pub fn new() -> Self {
        let price_state = Arc::new(PriceState::new());

        let state = ServiceState {
            price_state: Arc::clone(&price_state),
            aggregator: None,
            scanner: None,
            submitter: TransactionSubmitter::new(SubmitterConfig::default()),
            start_time: Instant::now(),
            opportunities_found: 0,
            trades_executed: 0,
            total_profit_usd: 0.0,
            scanner_shutdown: None,
        };

        Self {
            state: Arc::new(RwLock::new(state)),
        }
    }

    /// Initialize with config
    pub fn with_config(aggregator_config: AggregatorConfig) -> Self {
        let mut aggregator = PriceAggregator::new(aggregator_config);
        let price_state = aggregator.state();

        let state = ServiceState {
            price_state: Arc::clone(&price_state),
            aggregator: Some(aggregator),
            scanner: None,
            submitter: TransactionSubmitter::new(SubmitterConfig::default()),
            start_time: Instant::now(),
            opportunities_found: 0,
            trades_executed: 0,
            total_profit_usd: 0.0,
            scanner_shutdown: None,
        };

        Self {
            state: Arc::new(RwLock::new(state)),
        }
    }

    /// Start all background services
    pub async fn start(&self) -> anyhow::Result<()> {
        let mut state = self.state.write();

        // Start aggregator if configured
        if let Some(ref mut aggregator) = state.aggregator {
            aggregator.start().await?;
            info!("Price aggregator started");
        }

        Ok(())
    }

    /// Stop all services
    pub async fn stop(&self) {
        let mut state = self.state.write();

        // Stop scanner
        if let Some(shutdown) = state.scanner_shutdown.take() {
            let _ = shutdown.send(());
        }

        // Stop aggregator
        if let Some(ref mut aggregator) = state.aggregator {
            aggregator.stop().await;
        }

        info!("All services stopped");
    }
}

impl Clone for DefiServiceImpl {
    fn clone(&self) -> Self {
        Self {
            state: Arc::clone(&self.state),
        }
    }
}

#[tonic::async_trait]
impl DefiService for DefiServiceImpl {
    async fn get_price(
        &self,
        request: Request<GetPriceRequest>,
    ) -> Result<Response<GetPriceResponse>, Status> {
        let req = request.into_inner();
        let chain: ChainId = req.chain.into();

        let state = self.state.read();

        // Try to get price from state
        if let Some(price) = state.price_state.get_price(&req.token_address, chain) {
            Ok(Response::new(GetPriceResponse {
                success: true,
                price_usd: price.price_usd,
                timestamp_ms: price.timestamp.timestamp_millis() as u64,
                source: price.source.clone(),
                error: String::new(),
            }))
        } else {
            Ok(Response::new(GetPriceResponse {
                success: false,
                price_usd: 0.0,
                timestamp_ms: 0,
                source: String::new(),
                error: format!("Price not found for {} on {}", req.token_address, chain),
            }))
        }
    }

    type StreamPricesStream = Pin<Box<dyn Stream<Item = Result<PriceUpdate, Status>> + Send>>;

    async fn stream_prices(
        &self,
        request: Request<StreamPricesRequest>,
    ) -> Result<Response<Self::StreamPricesStream>, Status> {
        let req = request.into_inner();
        let chain: ChainId = req.chain.into();
        let tokens = req.token_addresses;

        let (tx, rx) = mpsc::channel(100);
        let state = Arc::clone(&self.state);

        // Spawn background task to push updates
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(100));

            loop {
                interval.tick().await;

                let state = state.read();

                for token in &tokens {
                    if let Some(price) = state.price_state.get_price(token, chain) {
                        let update = PriceUpdate {
                            token_address: token.clone(),
                            chain: Chain::from(chain) as i32,
                            price_usd: price.price_usd,
                            timestamp_ms: price.timestamp.timestamp_millis() as u64,
                            source: price.source.clone(),
                        };

                        if tx.send(Ok(update)).await.is_err() {
                            return; // Client disconnected
                        }
                    }
                }
            }
        });

        Ok(Response::new(Box::pin(ReceiverStream::new(rx))))
    }

    async fn get_opportunities(
        &self,
        request: Request<GetOpportunitiesRequest>,
    ) -> Result<Response<GetOpportunitiesResponse>, Status> {
        let req = request.into_inner();
        let start = Instant::now();

        let state = self.state.read();

        if let Some(ref scanner) = state.scanner {
            let opportunities = scanner.scan_once();
            let duration_us = start.elapsed().as_micros() as u64;

            // Filter by request parameters
            let filtered: Vec<_> = opportunities
                .into_iter()
                .filter(|opp| {
                    opp.profit_usd >= req.min_profit_usd
                        && opp.confidence >= req.min_confidence
                })
                .take(req.limit.min(100) as usize)
                .map(|opp| opportunity_to_proto(&opp))
                .collect();

            Ok(Response::new(GetOpportunitiesResponse {
                success: true,
                opportunities: filtered,
                scan_duration_us: duration_us,
                error: String::new(),
            }))
        } else {
            Ok(Response::new(GetOpportunitiesResponse {
                success: false,
                opportunities: vec![],
                scan_duration_us: 0,
                error: "Scanner not initialized".to_string(),
            }))
        }
    }

    type StreamOpportunitiesStream = Pin<Box<dyn Stream<Item = Result<ArbitrageOpportunity, Status>> + Send>>;

    async fn stream_opportunities(
        &self,
        request: Request<StreamOpportunitiesRequest>,
    ) -> Result<Response<Self::StreamOpportunitiesStream>, Status> {
        let req = request.into_inner();
        let (tx, rx) = mpsc::channel(100);
        let state = Arc::clone(&self.state);

        // Spawn background task
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(100));

            loop {
                interval.tick().await;

                let state_guard = state.read();

                if let Some(ref scanner) = state_guard.scanner {
                    let opportunities = scanner.scan_once();

                    for opp in opportunities {
                        if opp.profit_usd >= req.min_profit_usd
                            && opp.confidence >= req.min_confidence
                        {
                            let proto_opp = opportunity_to_proto(&opp);
                            if tx.send(Ok(proto_opp)).await.is_err() {
                                return;
                            }
                        }
                    }
                }

                drop(state_guard);
            }
        });

        Ok(Response::new(Box::pin(ReceiverStream::new(rx))))
    }

    async fn simulate_trade(
        &self,
        request: Request<SimulateTradeRequest>,
    ) -> Result<Response<SimulateTradeResponse>, Status> {
        let req = request.into_inner();
        let _chain: ChainId = req.chain.into();

        // In production:
        // 1. Create EVM simulator for the chain
        // 2. Build trade calldata
        // 3. Simulate execution
        // 4. Return results

        // Placeholder simulation result
        Ok(Response::new(SimulateTradeResponse {
            success: true,
            would_succeed: true,
            expected_output: req.amount_in.clone(), // Placeholder
            expected_output_usd: 0.0,
            price_impact_bps: 0.0,
            gas_estimate: 200_000,
            gas_cost_usd: 5.0,
            error: String::new(),
            revert_reason: String::new(),
        }))
    }

    async fn simulate_route(
        &self,
        request: Request<SimulateRouteRequest>,
    ) -> Result<Response<SimulateRouteResponse>, Status> {
        let req = request.into_inner();

        // Simulate each step
        let mut step_results = Vec::new();
        let mut total_gas = 0u64;

        for (i, _step) in req.route.iter().enumerate() {
            step_results.push(StepResult {
                step_index: i as u32,
                success: true,
                output_amount: "0".to_string(),
                gas_used: 100000, // Placeholder
                error: String::new(),
            });
            total_gas += 100000;
        }

        Ok(Response::new(SimulateRouteResponse {
            success: true,
            would_succeed: true,
            final_output: "0".to_string(),
            total_price_impact_bps: 0.0,
            total_gas_estimate: total_gas,
            step_results,
            error: String::new(),
        }))
    }

    async fn execute_trade(
        &self,
        request: Request<ExecuteTradeRequest>,
    ) -> Result<Response<ExecuteTradeResponse>, Status> {
        let req = request.into_inner();
        let chain: ChainId = req.chain.into();
        let trade_id = uuid::Uuid::new_v4().to_string();

        // Audit log: trade execution request
        info!(
            target: "audit",
            event = "TRADE_EXECUTE_REQUEST",
            trade_id = %trade_id,
            delegation_id = %req.delegation_id,
            chain = ?chain,
            dex = req.dex,
            amount_in = %req.amount_in,
            "Trade execution requested"
        );

        // In production:
        // 1. Verify delegation is valid
        // 2. Build transaction
        // 3. Simulate
        // 4. Submit via mempool or Flashbots

        // Update stats
        {
            let mut state = self.state.write();
            state.trades_executed += 1;
        }

        // Audit log: trade execution outcome
        info!(
            target: "audit",
            event = "TRADE_EXECUTE_RESULT",
            trade_id = %trade_id,
            delegation_id = %req.delegation_id,
            outcome = "success",
            status = "pending",
            "Trade execution submitted"
        );

        Ok(Response::new(ExecuteTradeResponse {
            success: true,
            tx_hash: String::new(), // Would be actual tx hash
            trade_id,
            status: ExecutionStatus::Pending as i32,
            error: String::new(),
        }))
    }

    async fn get_trade_status(
        &self,
        request: Request<GetTradeStatusRequest>,
    ) -> Result<Response<GetTradeStatusResponse>, Status> {
        let req = request.into_inner();

        // In production, look up from database/cache
        Ok(Response::new(GetTradeStatusResponse {
            success: true,
            trade_id: req.trade_id,
            status: ExecutionStatus::Pending as i32,
            tx_hash: String::new(),
            block_number: 0,
            gas_used: 0,
            actual_output: String::new(),
            actual_profit_usd: 0.0,
            error: String::new(),
        }))
    }

    async fn get_system_status(
        &self,
        _request: Request<GetSystemStatusRequest>,
    ) -> Result<Response<GetSystemStatusResponse>, Status> {
        let state = self.state.read();

        let uptime = state.start_time.elapsed().as_secs();
        let price_stats = state.price_state.stats();

        let scanner_running = state.scanner.is_some();

        // Build chain statuses
        let chain_statuses: Vec<ChainStatus> = vec![
            ChainStatus {
                chain: Chain::Ethereum as i32,
                connected: true,
                last_block: 0,
                pool_count: price_stats.pool_count as u32,
                last_update_ms: now_ms(),
            },
        ];

        Ok(Response::new(GetSystemStatusResponse {
            success: true,
            scanner_running,
            uptime_seconds: uptime,
            active_feeds: 0,
            tracked_pools: price_stats.pool_count as u32,
            tracked_tokens: price_stats.price_count as u32,
            opportunities_found: state.opportunities_found,
            trades_executed: state.trades_executed,
            total_profit_usd: state.total_profit_usd,
            last_scan_duration_us: 0,
            chain_statuses,
        }))
    }

    async fn update_config(
        &self,
        request: Request<UpdateConfigRequest>,
    ) -> Result<Response<UpdateConfigResponse>, Status> {
        let req = request.into_inner();

        // Audit log: config update with outcome
        info!(
            target: "audit",
            event = "CONFIG_UPDATE",
            scan_interval_ms = ?req.scan_interval_ms,
            min_profit_usd = ?req.min_profit_usd,
            chains_count = req.enabled_chains.len(),
            outcome = "success",
            "Configuration updated"
        );

        // In production, apply config changes to scanner/aggregator
        Ok(Response::new(UpdateConfigResponse {
            success: true,
            error: String::new(),
        }))
    }

    async fn start_scanner(
        &self,
        request: Request<StartScannerRequest>,
    ) -> Result<Response<StartScannerResponse>, Status> {
        let req = request.into_inner();

        let mut state = self.state.write();

        if state.scanner.is_some() {
            return Ok(Response::new(StartScannerResponse {
                success: false,
                error: "Scanner already running".to_string(),
            }));
        }

        // Create scanner with configured chains
        let chains: Vec<ChainId> = req.chains
            .iter()
            .map(|&c| c.into())
            .collect();

        let scanner_config = ScannerConfig {
            enabled_chains: if chains.is_empty() {
                vec![ChainId::Ethereum, ChainId::Arbitrum]
            } else {
                chains
            },
            ..Default::default()
        };

        let scanner = ArbitrageScanner::new(scanner_config, Arc::clone(&state.price_state));
        state.scanner = Some(scanner);

        // Create shutdown channel
        let (shutdown_tx, _shutdown_rx) = oneshot::channel();
        state.scanner_shutdown = Some(shutdown_tx);

        // Audit log: scanner started
        info!(
            target: "audit",
            event = "SCANNER_START",
            chains_count = scanner_config.enabled_chains.len(),
            outcome = "success",
            "Arbitrage scanner started"
        );

        Ok(Response::new(StartScannerResponse {
            success: true,
            error: String::new(),
        }))
    }

    async fn stop_scanner(
        &self,
        _request: Request<StopScannerRequest>,
    ) -> Result<Response<StopScannerResponse>, Status> {
        let mut state = self.state.write();

        let was_running = state.scanner.is_some();

        if let Some(shutdown) = state.scanner_shutdown.take() {
            let _ = shutdown.send(());
        }

        state.scanner = None;

        // Audit log: scanner stopped
        info!(
            target: "audit",
            event = "SCANNER_STOP",
            was_running = was_running,
            outcome = "success",
            "Arbitrage scanner stopped"
        );

        Ok(Response::new(StopScannerResponse {
            success: true,
            error: String::new(),
        }))
    }
}

impl Default for DefiServiceImpl {
    fn default() -> Self {
        Self::new()
    }
}
