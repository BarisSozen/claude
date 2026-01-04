//! Trade execution with EVM simulation
//!
//! Features:
//! - Local EVM simulation before submission
//! - Flashbots bundle building
//! - Gas optimization
//! - Slippage protection

pub mod simulator;
pub mod builder;
pub mod submitter;

pub use simulator::{EvmSimulator, SimulationResult};
pub use builder::{TransactionBuilder, BuiltTransaction};
pub use submitter::{TransactionSubmitter, SubmitterConfig};
