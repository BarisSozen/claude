//! Transaction builder for arbitrage execution

use alloy_primitives::{Address, Bytes, U256};
use defi_core::{ArbitrageOpportunity, ChainId, SwapRoute};

/// Built transaction ready for submission
#[derive(Debug, Clone)]
pub struct BuiltTransaction {
    pub chain: ChainId,
    pub to: Address,
    pub value: U256,
    pub data: Bytes,
    pub gas_limit: u64,
    pub max_fee_per_gas: U256,
    pub max_priority_fee: U256,
    pub nonce: Option<u64>,
}

/// Transaction builder
pub struct TransactionBuilder {
    chain: ChainId,
    router_address: Address,
    deadline_seconds: u64,
}

impl TransactionBuilder {
    pub fn new(chain: ChainId, router_address: Address) -> Self {
        Self {
            chain,
            router_address,
            deadline_seconds: 120,
        }
    }

    /// Build transaction for an arbitrage opportunity
    pub fn build_arbitrage_tx(
        &self,
        opp: &ArbitrageOpportunity,
        from: Address,
        nonce: u64,
    ) -> anyhow::Result<BuiltTransaction> {
        // Build multicall data for atomic execution
        let calldata = self.encode_multicall(opp)?;

        let gas_limit = self.estimate_gas(opp);

        Ok(BuiltTransaction {
            chain: self.chain,
            to: self.router_address,
            value: U256::ZERO,
            data: calldata,
            gas_limit,
            max_fee_per_gas: U256::from(50_000_000_000u64), // 50 gwei
            max_priority_fee: U256::from(2_000_000_000u64),  // 2 gwei
            nonce: Some(nonce),
        })
    }

    /// Build flash loan arbitrage transaction
    pub fn build_flash_loan_tx(
        &self,
        opp: &ArbitrageOpportunity,
        flash_loan_amount: U256,
        from: Address,
        nonce: u64,
    ) -> anyhow::Result<BuiltTransaction> {
        // Build flash loan callback data
        let calldata = self.encode_flash_loan(opp, flash_loan_amount)?;

        let gas_limit = self.estimate_gas(opp) + 100_000; // Extra for flash loan

        Ok(BuiltTransaction {
            chain: self.chain,
            to: self.router_address,
            value: U256::ZERO,
            data: calldata,
            gas_limit,
            max_fee_per_gas: U256::from(50_000_000_000u64),
            max_priority_fee: U256::from(2_000_000_000u64),
            nonce: Some(nonce),
        })
    }

    fn encode_multicall(&self, opp: &ArbitrageOpportunity) -> anyhow::Result<Bytes> {
        let mut calls = Vec::new();

        // Encode buy route swaps
        for step in &opp.buy_route.steps {
            calls.push(self.encode_swap(step)?);
        }

        // Encode sell route swaps
        for step in &opp.sell_route.steps {
            calls.push(self.encode_swap(step)?);
        }

        // Encode multicall
        // In production, use proper ABI encoding
        let mut data = Vec::new();
        data.extend_from_slice(&[0xac, 0x96, 0x50, 0xd8]); // multicall selector

        for call in &calls {
            data.extend_from_slice(call);
        }

        Ok(Bytes::from(data))
    }

    fn encode_swap(&self, step: &defi_core::SwapStep) -> anyhow::Result<Vec<u8>> {
        // Encode swap call
        // In production, use alloy-sol-types

        let mut data = Vec::new();
        // Placeholder encoding
        data.extend_from_slice(&step.pool.as_slice());
        data.extend_from_slice(&step.amount_in.to_be_bytes::<32>());

        Ok(data)
    }

    fn encode_flash_loan(
        &self,
        opp: &ArbitrageOpportunity,
        amount: U256,
    ) -> anyhow::Result<Bytes> {
        // Encode Aave V3 flash loan call
        // flashLoan(address receiverAddress, address[] assets, uint256[] amounts, ...)

        let mut data = Vec::new();
        data.extend_from_slice(&[0xab, 0x9c, 0x4b, 0x5d]); // flashLoan selector

        // Placeholder - production would properly encode all parameters
        data.extend_from_slice(&amount.to_be_bytes::<32>());

        Ok(Bytes::from(data))
    }

    fn estimate_gas(&self, opp: &ArbitrageOpportunity) -> u64 {
        let base = 50_000u64;
        let per_swap = 150_000u64;

        let swaps = opp.buy_route.steps.len() + opp.sell_route.steps.len();

        base + (swaps as u64 * per_swap)
    }
}
