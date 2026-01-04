//! Error types

use thiserror::Error;

use crate::ChainId;

/// Core error types
#[derive(Debug, Error)]
pub enum CoreError {
    #[error("Chain {0} not configured")]
    ChainNotConfigured(ChainId),

    #[error("Token not found: {0}")]
    TokenNotFound(String),

    #[error("Pool not found: {0}")]
    PoolNotFound(String),

    #[error("Insufficient liquidity")]
    InsufficientLiquidity,

    #[error("Price too stale: {age_ms}ms > {max_ms}ms")]
    StalePrice { age_ms: u64, max_ms: u64 },

    #[error("Price impact too high: {impact_bps}bps > {max_bps}bps")]
    PriceImpactTooHigh { impact_bps: u16, max_bps: u16 },

    #[error("Slippage exceeded: expected {expected}, got {actual}")]
    SlippageExceeded { expected: String, actual: String },

    #[error("Gas price too high: {price_gwei} gwei > {max_gwei} gwei")]
    GasPriceTooHigh { price_gwei: f64, max_gwei: f64 },

    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),

    #[error("RPC error: {0}")]
    RpcError(String),

    #[error("Serialization error: {0}")]
    SerializationError(String),
}

/// Price feed errors
#[derive(Debug, Error)]
pub enum PriceFeedError {
    #[error("WebSocket connection failed: {0}")]
    ConnectionFailed(String),

    #[error("Subscription failed: {0}")]
    SubscriptionFailed(String),

    #[error("Feed disconnected")]
    Disconnected,

    #[error("Invalid message format: {0}")]
    InvalidMessage(String),

    #[error("Rate limited")]
    RateLimited,

    #[error("Timeout waiting for data")]
    Timeout,
}

/// Execution errors
#[derive(Debug, Error)]
pub enum ExecutionError {
    #[error("Transaction simulation failed: {0}")]
    SimulationFailed(String),

    #[error("Transaction reverted: {0}")]
    Reverted(String),

    #[error("Nonce too low")]
    NonceTooLow,

    #[error("Replacement transaction underpriced")]
    Underpriced,

    #[error("Transaction not mined in time")]
    NotMined,

    #[error("Frontrun detected")]
    Frontrun,

    #[error("Insufficient balance")]
    InsufficientBalance,

    #[error("Delegation invalid: {0}")]
    DelegationInvalid(String),

    #[error("Circuit breaker triggered: {0}")]
    CircuitBreaker(String),
}

/// Result type alias
pub type CoreResult<T> = Result<T, CoreError>;
pub type PriceFeedResult<T> = Result<T, PriceFeedError>;
pub type ExecutionResult<T> = Result<T, ExecutionError>;
