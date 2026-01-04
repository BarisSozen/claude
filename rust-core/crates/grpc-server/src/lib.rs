//! gRPC server for DeFi bot
//!
//! Provides the interface between TypeScript backend and Rust low-latency core

pub mod server;
pub mod service;
pub mod conversions;

// Re-export proto types
pub mod proto {
    include!("generated/defi.rs");
}

pub use server::{GrpcServer, GrpcServerConfig};
pub use service::DefiServiceImpl;
