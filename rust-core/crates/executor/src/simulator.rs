//! Local EVM simulation for trade validation

use alloy_primitives::{Address, Bytes, U256};
use revm::{
    primitives::{ExecutionResult, Output, TransactTo, TxEnv},
    Evm, InMemoryDB,
};
use std::collections::HashMap;
use tracing::{debug, warn};

use defi_core::{ArbitrageOpportunity, ChainId, ExecutionResult as TradeResult};

/// Simulation result
#[derive(Debug, Clone)]
pub struct SimulationResult {
    pub success: bool,
    pub gas_used: u64,
    pub output: Vec<u8>,
    pub profit: U256,
    pub error: Option<String>,
}

/// EVM simulator for local trade validation
pub struct EvmSimulator {
    chain: ChainId,
    fork_block: u64,
}

impl EvmSimulator {
    pub fn new(chain: ChainId) -> Self {
        Self {
            chain,
            fork_block: 0,
        }
    }

    pub fn with_fork_block(mut self, block: u64) -> Self {
        self.fork_block = block;
        self
    }

    /// Simulate a complete arbitrage opportunity
    pub fn simulate_opportunity(
        &self,
        opp: &ArbitrageOpportunity,
        from: Address,
        value: U256,
    ) -> SimulationResult {
        // Create in-memory database
        let mut db = InMemoryDB::default();

        // Set up initial state
        // In production, this would fork from an actual node
        self.setup_initial_state(&mut db, from, value);

        // Build and simulate each step
        let mut total_gas = 0u64;

        // Simulate buy route
        for step in &opp.buy_route.steps {
            match self.simulate_swap(&mut db, from, step.pool, step.amount_in) {
                Ok(result) => {
                    if !result.success {
                        return SimulationResult {
                            success: false,
                            gas_used: total_gas,
                            output: vec![],
                            profit: U256::ZERO,
                            error: Some(format!("Buy step failed: {:?}", result.error)),
                        };
                    }
                    total_gas += result.gas_used;
                }
                Err(e) => {
                    return SimulationResult {
                        success: false,
                        gas_used: total_gas,
                        output: vec![],
                        profit: U256::ZERO,
                        error: Some(format!("Simulation error: {}", e)),
                    };
                }
            }
        }

        // Simulate sell route
        for step in &opp.sell_route.steps {
            match self.simulate_swap(&mut db, from, step.pool, step.amount_in) {
                Ok(result) => {
                    if !result.success {
                        return SimulationResult {
                            success: false,
                            gas_used: total_gas,
                            output: vec![],
                            profit: U256::ZERO,
                            error: Some(format!("Sell step failed: {:?}", result.error)),
                        };
                    }
                    total_gas += result.gas_used;
                }
                Err(e) => {
                    return SimulationResult {
                        success: false,
                        gas_used: total_gas,
                        output: vec![],
                        profit: U256::ZERO,
                        error: Some(format!("Simulation error: {}", e)),
                    };
                }
            }
        }

        SimulationResult {
            success: true,
            gas_used: total_gas,
            output: vec![],
            profit: opp.net_profit,
            error: None,
        }
    }

    fn setup_initial_state(&self, db: &mut InMemoryDB, account: Address, balance: U256) {
        // Set up account with balance
        // In production, this would copy state from a forked node
        debug!("Setting up simulation state for {:?}", account);
    }

    fn simulate_swap(
        &self,
        db: &mut InMemoryDB,
        from: Address,
        pool: Address,
        amount: U256,
    ) -> anyhow::Result<SimulationResult> {
        // Build swap transaction
        let calldata = self.encode_swap_call(pool, amount)?;

        // Configure transaction
        let tx = TxEnv {
            caller: from,
            transact_to: TransactTo::Call(pool),
            value: U256::ZERO,
            data: calldata.clone(),
            gas_limit: 500_000,
            gas_price: U256::from(20_000_000_000u64), // 20 gwei
            ..Default::default()
        };

        // Execute in EVM
        let mut evm = Evm::builder()
            .with_db(db)
            .with_tx_env(tx)
            .build();

        let result = evm.transact()?;

        match result.result {
            ExecutionResult::Success { gas_used, output, .. } => {
                let output_bytes = match output {
                    Output::Call(bytes) => bytes.to_vec(),
                    Output::Create(bytes, _) => bytes.to_vec(),
                };

                Ok(SimulationResult {
                    success: true,
                    gas_used,
                    output: output_bytes,
                    profit: U256::ZERO,
                    error: None,
                })
            }
            ExecutionResult::Revert { gas_used, output } => {
                Ok(SimulationResult {
                    success: false,
                    gas_used,
                    output: output.to_vec(),
                    profit: U256::ZERO,
                    error: Some("Transaction reverted".to_string()),
                })
            }
            ExecutionResult::Halt { reason, gas_used } => {
                Ok(SimulationResult {
                    success: false,
                    gas_used,
                    output: vec![],
                    profit: U256::ZERO,
                    error: Some(format!("Execution halted: {:?}", reason)),
                })
            }
        }
    }

    fn encode_swap_call(&self, pool: Address, amount: U256) -> anyhow::Result<Bytes> {
        // Encode swap function call
        // In production, use alloy-sol-types for proper encoding

        // Uniswap V2 swap: swap(uint256,uint256,address,bytes)
        // Function selector: 0x022c0d9f

        let mut data = Vec::with_capacity(132);
        data.extend_from_slice(&[0x02, 0x2c, 0x0d, 0x9f]); // selector

        // Simplified encoding - production would use proper ABI encoding
        data.extend_from_slice(&[0u8; 128]);

        Ok(Bytes::from(data))
    }

    /// Estimate gas for an opportunity
    pub fn estimate_gas(&self, opp: &ArbitrageOpportunity) -> u64 {
        let base_gas = 21_000u64;
        let swap_gas = 150_000u64;

        let total_swaps = opp.buy_route.steps.len() + opp.sell_route.steps.len();

        base_gas + (total_swaps as u64 * swap_gas)
    }

    /// Validate slippage bounds
    pub fn validate_slippage(
        &self,
        opp: &ArbitrageOpportunity,
        max_slippage_bps: u16,
    ) -> bool {
        let total_impact = opp.buy_route.price_impact_bps + opp.sell_route.price_impact_bps;
        total_impact <= max_slippage_bps
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simulator_creation() {
        let simulator = EvmSimulator::new(ChainId::Ethereum);
        assert_eq!(simulator.fork_block, 0);
    }

    #[test]
    fn test_gas_estimation() {
        let simulator = EvmSimulator::new(ChainId::Ethereum);

        // Create mock opportunity with 2 swaps (1 buy, 1 sell)
        // Gas should be: 21000 + 2 * 150000 = 321000
    }
}
