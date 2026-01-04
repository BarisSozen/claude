/**
 * Gas Sponsor Service
 * Ensures session keys have sufficient gas for trading
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum, base, polygon } from 'viem/chains';
import { getRpcUrl, config } from '../config/env.js';
import { delegationService } from './delegation.js';
import { executionLogger } from './logger.js';
import type { ChainId } from '../../shared/schema.js';

// Minimum gas balance thresholds (in ETH)
const MIN_GAS_BALANCE: Record<ChainId, bigint> = {
  ethereum: parseEther('0.01'),    // ~$30-40 worth of gas
  arbitrum: parseEther('0.001'),   // ~$3-4 worth of gas
  base: parseEther('0.001'),       // ~$3-4 worth of gas
  polygon: parseEther('0.1'),      // ~$0.1 MATIC (cheap)
};

// Target gas balance when sponsoring
const TARGET_GAS_BALANCE: Record<ChainId, bigint> = {
  ethereum: parseEther('0.03'),    // ~$100 worth of gas
  arbitrum: parseEther('0.005'),   // ~$15 worth of gas
  base: parseEther('0.005'),       // ~$15 worth of gas
  polygon: parseEther('0.5'),      // ~$0.5 MATIC
};

// Chain configs
const CHAIN_CONFIGS = {
  ethereum: mainnet,
  arbitrum: arbitrum,
  base: base,
  polygon: polygon,
};

interface GasCheckResult {
  hasEnough: boolean;
  balance: bigint;
  minRequired: bigint;
  shortfall: bigint;
}

interface SponsorResult {
  success: boolean;
  txHash?: string;
  error?: string;
  amountSponsored?: bigint;
}

class GasSponsorService {
  private clients: Map<ChainId, PublicClient> = new Map();
  private sponsorWallets: Map<ChainId, WalletClient> = new Map();
  private sponsorEnabled: boolean = false;

  /**
   * Get public client for a chain
   */
  private getClient(chainId: ChainId): PublicClient {
    let client = this.clients.get(chainId);

    if (!client) {
      const chain = CHAIN_CONFIGS[chainId];
      client = createPublicClient({
        chain,
        transport: http(getRpcUrl(chainId)),
      });
      this.clients.set(chainId, client);
    }

    return client;
  }

  /**
   * Initialize sponsor wallet (requires private key in env)
   * Note: In production, this should be a secure multi-sig or similar
   */
  initializeSponsorWallet(chainId: ChainId, privateKey: string): void {
    const chain = CHAIN_CONFIGS[chainId];
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    const wallet = createWalletClient({
      account,
      chain,
      transport: http(getRpcUrl(chainId)),
    });

    this.sponsorWallets.set(chainId, wallet);
    this.sponsorEnabled = true;

    executionLogger.info('system', `Gas sponsor wallet initialized for ${chainId}`);
  }

  /**
   * Check if session key has enough gas
   */
  async checkGasBalance(
    sessionKeyAddress: Address,
    chainId: ChainId
  ): Promise<GasCheckResult> {
    const client = this.getClient(chainId);
    const balance = await client.getBalance({ address: sessionKeyAddress });
    const minRequired = MIN_GAS_BALANCE[chainId];

    return {
      hasEnough: balance >= minRequired,
      balance,
      minRequired,
      shortfall: balance < minRequired ? minRequired - balance : 0n,
    };
  }

  /**
   * Sponsor gas for a session key
   */
  async sponsorGas(
    sessionKeyAddress: Address,
    chainId: ChainId,
    amount?: bigint
  ): Promise<SponsorResult> {
    if (!this.sponsorEnabled) {
      return {
        success: false,
        error: 'Gas sponsoring not enabled',
      };
    }

    const sponsorWallet = this.sponsorWallets.get(chainId);

    if (!sponsorWallet) {
      return {
        success: false,
        error: `No sponsor wallet configured for ${chainId}`,
      };
    }

    // Determine amount to send
    const targetAmount = amount || TARGET_GAS_BALANCE[chainId];

    try {
      // Check sponsor wallet balance first
      const client = this.getClient(chainId);
      const sponsorBalance = await client.getBalance({
        address: sponsorWallet.account!.address,
      });

      if (sponsorBalance < targetAmount) {
        executionLogger.warning('system', 'Sponsor wallet low on funds', {
          chainId,
          balance: formatEther(sponsorBalance),
          needed: formatEther(targetAmount),
        });

        return {
          success: false,
          error: 'Sponsor wallet has insufficient funds',
        };
      }

      // Send gas
      const txHash = await sponsorWallet.sendTransaction({
        to: sessionKeyAddress,
        value: targetAmount,
      });

      executionLogger.success('system', 'Gas sponsored', {
        chainId,
        sessionKey: sessionKeyAddress,
        amount: formatEther(targetAmount),
        txHash,
      });

      return {
        success: true,
        txHash,
        amountSponsored: targetAmount,
      };
    } catch (error) {
      executionLogger.error('system', 'Gas sponsoring failed', error as Error, {
        chainId,
        sessionKey: sessionKeyAddress,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Ensure session key has enough gas before trade
   */
  async ensureGasForTrade(
    sessionKeyAddress: Address,
    chainId: ChainId,
    delegationId: string
  ): Promise<{ ready: boolean; error?: string }> {
    // Check current balance
    const check = await this.checkGasBalance(sessionKeyAddress, chainId);

    if (check.hasEnough) {
      return { ready: true };
    }

    // Try to sponsor if enabled
    if (this.sponsorEnabled) {
      const sponsorResult = await this.sponsorGas(sessionKeyAddress, chainId);

      if (sponsorResult.success) {
        // Wait for confirmation
        const client = this.getClient(chainId);
        await client.waitForTransactionReceipt({
          hash: sponsorResult.txHash as `0x${string}`,
        });

        return { ready: true };
      }

      return {
        ready: false,
        error: sponsorResult.error,
      };
    }

    return {
      ready: false,
      error: `Insufficient gas balance: ${formatEther(check.balance)} < ${formatEther(check.minRequired)}`,
    };
  }

  /**
   * Get sponsor wallet balance
   */
  async getSponsorBalance(chainId: ChainId): Promise<bigint | null> {
    const sponsorWallet = this.sponsorWallets.get(chainId);

    if (!sponsorWallet) {
      return null;
    }

    const client = this.getClient(chainId);
    return client.getBalance({ address: sponsorWallet.account!.address });
  }

  /**
   * Get sponsor status
   */
  getStatus(): {
    enabled: boolean;
    chains: ChainId[];
  } {
    return {
      enabled: this.sponsorEnabled,
      chains: Array.from(this.sponsorWallets.keys()),
    };
  }

  /**
   * Check all active delegations for low gas
   */
  async checkAllDelegations(): Promise<
    Array<{
      delegationId: string;
      sessionKeyAddress: Address;
      chainId: ChainId;
      balance: bigint;
      needsSponsoring: boolean;
    }>
  > {
    const results: Array<{
      delegationId: string;
      sessionKeyAddress: Address;
      chainId: ChainId;
      balance: bigint;
      needsSponsoring: boolean;
    }> = [];

    // This would need to iterate through all active delegations
    // For now, return empty array as this requires full delegation scan

    return results;
  }
}

export const gasSponsorService = new GasSponsorService();
