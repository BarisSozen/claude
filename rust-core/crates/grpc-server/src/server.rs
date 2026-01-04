//! gRPC server configuration and startup

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use tonic::transport::Server;
use tracing::{error, info};

use crate::proto::DefiServiceServer;
use crate::service::DefiServiceImpl;

/// Server configuration
#[derive(Debug, Clone)]
pub struct GrpcServerConfig {
    pub host: String,
    pub port: u16,
    pub max_connections: usize,
    pub keep_alive_interval: Duration,
    pub keep_alive_timeout: Duration,
    pub accept_http1: bool,
}

impl Default for GrpcServerConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 50051,
            max_connections: 1000,
            keep_alive_interval: Duration::from_secs(60),
            keep_alive_timeout: Duration::from_secs(20),
            accept_http1: true, // For grpc-web compatibility
        }
    }
}

/// gRPC server wrapper
pub struct GrpcServer {
    config: GrpcServerConfig,
    service: Arc<DefiServiceImpl>,
}

impl GrpcServer {
    pub fn new(config: GrpcServerConfig) -> Self {
        Self {
            config,
            service: Arc::new(DefiServiceImpl::new()),
        }
    }

    pub fn with_service(config: GrpcServerConfig, service: DefiServiceImpl) -> Self {
        Self {
            config,
            service: Arc::new(service),
        }
    }

    /// Get reference to the service
    pub fn service(&self) -> &DefiServiceImpl {
        &self.service
    }

    /// Start the server
    pub async fn start(&self) -> anyhow::Result<()> {
        let addr: SocketAddr = format!("{}:{}", self.config.host, self.config.port)
            .parse()?;

        info!("Starting gRPC server on {}", addr);

        // Create the service
        let service = DefiServiceServer::new((*self.service).clone());

        // Build and run the server
        Server::builder()
            .concurrency_limit_per_connection(256)
            .tcp_keepalive(Some(self.config.keep_alive_interval))
            .http2_keepalive_interval(Some(self.config.keep_alive_interval))
            .http2_keepalive_timeout(Some(self.config.keep_alive_timeout))
            .add_service(service)
            .serve(addr)
            .await?;

        Ok(())
    }

    /// Start with graceful shutdown
    pub async fn start_with_shutdown(
        &self,
        shutdown: tokio::sync::oneshot::Receiver<()>,
    ) -> anyhow::Result<()> {
        let addr: SocketAddr = format!("{}:{}", self.config.host, self.config.port)
            .parse()?;

        info!("Starting gRPC server on {} (with graceful shutdown)", addr);

        let service = DefiServiceServer::new((*self.service).clone());

        Server::builder()
            .concurrency_limit_per_connection(256)
            .tcp_keepalive(Some(self.config.keep_alive_interval))
            .http2_keepalive_interval(Some(self.config.keep_alive_interval))
            .http2_keepalive_timeout(Some(self.config.keep_alive_timeout))
            .add_service(service)
            .serve_with_shutdown(addr, async {
                shutdown.await.ok();
                info!("Shutdown signal received");
            })
            .await?;

        Ok(())
    }

    /// Get server address
    pub fn address(&self) -> String {
        format!("{}:{}", self.config.host, self.config.port)
    }
}

/// Builder for server configuration
pub struct GrpcServerBuilder {
    config: GrpcServerConfig,
    service: Option<DefiServiceImpl>,
}

impl GrpcServerBuilder {
    pub fn new() -> Self {
        Self {
            config: GrpcServerConfig::default(),
            service: None,
        }
    }

    pub fn host(mut self, host: impl Into<String>) -> Self {
        self.config.host = host.into();
        self
    }

    pub fn port(mut self, port: u16) -> Self {
        self.config.port = port;
        self
    }

    pub fn max_connections(mut self, max: usize) -> Self {
        self.config.max_connections = max;
        self
    }

    pub fn keep_alive_interval(mut self, interval: Duration) -> Self {
        self.config.keep_alive_interval = interval;
        self
    }

    pub fn keep_alive_timeout(mut self, timeout: Duration) -> Self {
        self.config.keep_alive_timeout = timeout;
        self
    }

    pub fn accept_http1(mut self, accept: bool) -> Self {
        self.config.accept_http1 = accept;
        self
    }

    pub fn service(mut self, service: DefiServiceImpl) -> Self {
        self.service = Some(service);
        self
    }

    pub fn build(self) -> GrpcServer {
        if let Some(service) = self.service {
            GrpcServer::with_service(self.config, service)
        } else {
            GrpcServer::new(self.config)
        }
    }
}

impl Default for GrpcServerBuilder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = GrpcServerConfig::default();
        assert_eq!(config.port, 50051);
        assert_eq!(config.host, "127.0.0.1");
    }

    #[test]
    fn test_builder() {
        let server = GrpcServerBuilder::new()
            .host("0.0.0.0")
            .port(9000)
            .build();

        assert_eq!(server.address(), "0.0.0.0:9000");
    }
}
