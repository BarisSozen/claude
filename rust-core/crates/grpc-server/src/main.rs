//! DeFi Bot - Low-latency Rust core
//!
//! Main entry point for the gRPC server

use std::env;
use std::time::Duration;

use tokio::signal;
use tracing::{error, info, Level};
use tracing_subscriber::{fmt, EnvFilter};

use defi_grpc_server::{
    GrpcServer, GrpcServerConfig, DefiServiceImpl,
};
use defi_price_feed::AggregatorConfig;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env file
    dotenvy::dotenv().ok();

    // Initialize logging
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true)
        .init();

    info!("Starting DeFi Bot Rust Core v{}", env!("CARGO_PKG_VERSION"));

    // Load configuration
    let host = env::var("GRPC_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port: u16 = env::var("GRPC_PORT")
        .unwrap_or_else(|_| "50051".to_string())
        .parse()
        .unwrap_or(50051);

    // Create service with aggregator
    let aggregator_config = AggregatorConfig {
        cleanup_interval: Duration::from_secs(60),
        max_price_age: Duration::from_secs(30),
        ..Default::default()
    };

    let service = DefiServiceImpl::with_config(aggregator_config);

    // Start background services
    service.start().await?;
    info!("Background services started");

    // Create and configure server
    let server_config = GrpcServerConfig {
        host,
        port,
        max_connections: 1000,
        keep_alive_interval: Duration::from_secs(60),
        keep_alive_timeout: Duration::from_secs(20),
        accept_http1: true,
    };

    let server = GrpcServer::with_service(server_config, service);

    // Setup shutdown channel
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();

    // Spawn shutdown signal handler
    tokio::spawn(async move {
        let ctrl_c = async {
            signal::ctrl_c()
                .await
                .expect("Failed to install Ctrl+C handler");
        };

        #[cfg(unix)]
        let terminate = async {
            signal::unix::signal(signal::unix::SignalKind::terminate())
                .expect("Failed to install signal handler")
                .recv()
                .await;
        };

        #[cfg(not(unix))]
        let terminate = std::future::pending::<()>();

        tokio::select! {
            _ = ctrl_c => {
                info!("Received Ctrl+C");
            }
            _ = terminate => {
                info!("Received termination signal");
            }
        }

        let _ = shutdown_tx.send(());
    });

    // Start server
    info!("gRPC server listening on {}", server.address());
    info!("Press Ctrl+C to shutdown");

    if let Err(e) = server.start_with_shutdown(shutdown_rx).await {
        error!("Server error: {}", e);
        return Err(e);
    }

    info!("Server shutdown complete");
    Ok(())
}
