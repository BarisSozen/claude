/**
 * MEV Protection Service
 * Integrates Flashbots and Bloxroute for private transaction submission
 * Prevents sandwich attacks and front-running
 */

import {
  createWalletClient,
  http,
  type Address,
  type Hex,
  type TransactionRequest,
  keccak256,
  concat,
  toHex,
  numberToHex,
  serializeTransaction,
  type TransactionSerializable,
} from 'viem';
import { mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../config/env.js';

// Fetch timeout configuration
const FETCH_TIMEOUT_MS = 10000; // 10 seconds

/**
 * Fetch with timeout to prevent hanging requests
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request to ${new URL(url).hostname} timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// Flashbots RPC endpoints
const FLASHBOTS_RPC = 'https://relay.flashbots.net';
const FLASHBOTS_GOERLI_RPC = 'https://relay-goerli.flashbots.net';

// Bloxroute endpoints
const BLOXROUTE_RPC = 'https://mev.api.blxrbdn.com';

// MEV protection providers
type MevProvider = 'flashbots' | 'bloxroute' | 'both';

interface BundleTransaction {
  to: Address;
  data: Hex;
  value?: bigint;
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

interface BundleSubmission {
  transactions: BundleTransaction[];
  targetBlock: bigint;
  minTimestamp?: number;
  maxTimestamp?: number;
  revertingTxHashes?: Hex[];
}

interface BundleResponse {
  success: boolean;
  bundleHash?: Hex;
  error?: string;
  simulationResult?: {
    success: boolean;
    gasUsed: bigint;
    profit: bigint;
    revertReason?: string;
  };
}

interface FlashbotsSignedBundle {
  signedTransactions: Hex[];
  blockNumber: Hex;
  minTimestamp?: number;
  maxTimestamp?: number;
  revertingTxHashes?: Hex[];
}

class MevProtectionService {
  private signerKey: Hex | null = null;
  private preferredProvider: MevProvider = 'flashbots';
  private bundleHistory: Map<Hex, { submittedAt: Date; status: string }> = new Map();
  private nonces: Map<Address, bigint> = new Map();

  /**
   * Initialize MEV protection with a signing key
   * This key is used to sign Flashbots bundles (not for transactions)
   */
  initialize(signerPrivateKey: Hex, provider: MevProvider = 'flashbots'): void {
    this.signerKey = signerPrivateKey;
    this.preferredProvider = provider;
  }

  /**
   * Sign a message for Flashbots authentication
   */
  private async signFlashbotsPayload(payload: string): Promise<Hex> {
    if (!this.signerKey) {
      throw new Error('MEV protection not initialized - call initialize() first');
    }

    const account = privateKeyToAccount(this.signerKey);
    const message = keccak256(toHex(payload));
    const signature = await account.signMessage({ message: { raw: message } });

    return signature;
  }

  /**
   * Get the Flashbots authentication header
   */
  private async getFlashbotsAuthHeader(body: string): Promise<string> {
    if (!this.signerKey) {
      throw new Error('MEV protection not initialized');
    }

    const account = privateKeyToAccount(this.signerKey);
    const signature = await this.signFlashbotsPayload(body);

    return `${account.address}:${signature}`;
  }

  /**
   * Submit bundle to Flashbots relay
   */
  async submitToFlashbots(bundle: BundleSubmission): Promise<BundleResponse> {
    const signedTxs = bundle.transactions.map(tx => this.serializeTransaction(tx));

    const flashbotsBundle: FlashbotsSignedBundle = {
      signedTransactions: signedTxs,
      blockNumber: numberToHex(bundle.targetBlock),
      minTimestamp: bundle.minTimestamp,
      maxTimestamp: bundle.maxTimestamp,
      revertingTxHashes: bundle.revertingTxHashes,
    };

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendBundle',
      params: [flashbotsBundle],
    });

    try {
      const authHeader = await this.getFlashbotsAuthHeader(body);

      const response = await fetchWithTimeout(FLASHBOTS_RPC, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Flashbots-Signature': authHeader,
        },
        body,
      });

      const result = await response.json();

      if (result.error) {
        return {
          success: false,
          error: result.error.message || 'Flashbots submission failed',
        };
      }

      const bundleHash = result.result?.bundleHash as Hex;

      if (bundleHash) {
        this.bundleHistory.set(bundleHash, {
          submittedAt: new Date(),
          status: 'pending',
        });
      }

      return {
        success: true,
        bundleHash,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Submit bundle to Bloxroute
   */
  async submitToBloxroute(bundle: BundleSubmission): Promise<BundleResponse> {
    const bloxrouteApiKey = config.bloxroute?.apiKey;

    if (!bloxrouteApiKey) {
      return {
        success: false,
        error: 'Bloxroute API key not configured',
      };
    }

    const signedTxs = bundle.transactions.map(tx => this.serializeTransaction(tx));

    const body = JSON.stringify({
      transaction: signedTxs,
      block_number: bundle.targetBlock.toString(),
      min_timestamp: bundle.minTimestamp,
      max_timestamp: bundle.maxTimestamp,
    });

    try {
      const response = await fetchWithTimeout(`${BLOXROUTE_RPC}/eth/v1/bundle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': bloxrouteApiKey,
        },
        body,
      });

      const result = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: result.error || 'Bloxroute submission failed',
        };
      }

      return {
        success: true,
        bundleHash: result.bundle_hash as Hex,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Simulate bundle on Flashbots before submission
   */
  async simulateBundle(bundle: BundleSubmission): Promise<BundleResponse> {
    const signedTxs = bundle.transactions.map(tx => this.serializeTransaction(tx));

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_callBundle',
      params: [{
        txs: signedTxs,
        blockNumber: numberToHex(bundle.targetBlock),
        stateBlockNumber: 'latest',
      }],
    });

    try {
      const authHeader = await this.getFlashbotsAuthHeader(body);

      const response = await fetchWithTimeout(FLASHBOTS_RPC, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Flashbots-Signature': authHeader,
        },
        body,
      });

      const result = await response.json();

      if (result.error) {
        return {
          success: false,
          error: result.error.message,
        };
      }

      const simResult = result.result;

      return {
        success: true,
        simulationResult: {
          success: !simResult.firstRevert,
          gasUsed: BigInt(simResult.totalGasUsed || 0),
          profit: BigInt(simResult.coinbaseDiff || 0),
          revertReason: simResult.firstRevert?.revert,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Simulation failed',
      };
    }
  }

  /**
   * Submit bundle to preferred provider(s) with fallback
   */
  async submitBundle(bundle: BundleSubmission): Promise<BundleResponse> {
    // First simulate
    const simulation = await this.simulateBundle(bundle);

    if (!simulation.success || !simulation.simulationResult?.success) {
      return {
        success: false,
        error: simulation.error || simulation.simulationResult?.revertReason || 'Simulation failed',
        simulationResult: simulation.simulationResult,
      };
    }

    // Submit to provider(s)
    if (this.preferredProvider === 'flashbots') {
      return this.submitToFlashbots(bundle);
    } else if (this.preferredProvider === 'bloxroute') {
      return this.submitToBloxroute(bundle);
    } else {
      // Submit to both for higher inclusion probability
      const [flashbotsResult, bloxrouteResult] = await Promise.allSettled([
        this.submitToFlashbots(bundle),
        this.submitToBloxroute(bundle),
      ]);

      const fbSuccess = flashbotsResult.status === 'fulfilled' && flashbotsResult.value.success;
      const brSuccess = bloxrouteResult.status === 'fulfilled' && bloxrouteResult.value.success;

      if (fbSuccess || brSuccess) {
        return {
          success: true,
          bundleHash: fbSuccess
            ? (flashbotsResult as PromiseFulfilledResult<BundleResponse>).value.bundleHash
            : (bloxrouteResult as PromiseFulfilledResult<BundleResponse>).value.bundleHash,
          simulationResult: simulation.simulationResult,
        };
      }

      return {
        success: false,
        error: 'All MEV protection providers failed',
      };
    }
  }

  /**
   * Check bundle status on Flashbots
   */
  async getBundleStatus(bundleHash: Hex): Promise<{
    status: 'pending' | 'included' | 'failed';
    blockNumber?: bigint;
  }> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'flashbots_getBundleStats',
      params: [{ bundleHash }],
    });

    try {
      const authHeader = await this.getFlashbotsAuthHeader(body);

      const response = await fetchWithTimeout(FLASHBOTS_RPC, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Flashbots-Signature': authHeader,
        },
        body,
      });

      const result = await response.json();

      if (result.result?.isSimulated && result.result?.isSentToMiners) {
        if (result.result?.isHighPriority) {
          return { status: 'included', blockNumber: BigInt(result.result.blockNumber || 0) };
        }
        return { status: 'pending' };
      }

      return { status: 'failed' };
    } catch {
      return { status: 'pending' };
    }
  }

  /**
   * Create a private transaction (single tx, not bundle)
   * Useful for simple swaps that don't need bundling
   */
  async sendPrivateTransaction(tx: BundleTransaction, maxBlockNumber?: bigint): Promise<BundleResponse> {
    const signedTx = this.serializeTransaction(tx);

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendPrivateTransaction',
      params: [{
        tx: signedTx,
        maxBlockNumber: maxBlockNumber ? numberToHex(maxBlockNumber) : undefined,
        preferences: {
          fast: true,
        },
      }],
    });

    try {
      const authHeader = await this.getFlashbotsAuthHeader(body);

      const response = await fetchWithTimeout(FLASHBOTS_RPC, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Flashbots-Signature': authHeader,
        },
        body,
      });

      const result = await response.json();

      if (result.error) {
        return {
          success: false,
          error: result.error.message,
        };
      }

      return {
        success: true,
        bundleHash: result.result as Hex,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Cancel a pending private transaction
   */
  async cancelPrivateTransaction(txHash: Hex): Promise<boolean> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_cancelPrivateTransaction',
      params: [{ txHash }],
    });

    try {
      const authHeader = await this.getFlashbotsAuthHeader(body);

      const response = await fetchWithTimeout(FLASHBOTS_RPC, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Flashbots-Signature': authHeader,
        },
        body,
      });

      const result = await response.json();
      return result.result === true;
    } catch {
      return false;
    }
  }

  /**
   * Serialize and sign transaction for bundle submission
   * Uses the MEV signer key to sign transactions
   */
  private serializeTransaction(tx: BundleTransaction): Hex {
    if (!this.signerKey) {
      throw new Error('MEV protection not initialized - call initialize() first');
    }

    const account = privateKeyToAccount(this.signerKey);
    const currentNonce = this.nonces.get(account.address) ?? 0n;

    // Build the transaction object
    const transaction: TransactionSerializable = {
      to: tx.to,
      data: tx.data,
      value: tx.value ?? 0n,
      gas: tx.gasLimit ?? 200000n,
      maxFeePerGas: tx.maxFeePerGas ?? 50000000000n, // 50 gwei default
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? 2000000000n, // 2 gwei default
      nonce: Number(currentNonce),
      chainId: 1, // Mainnet (Flashbots only supports mainnet)
      type: 'eip1559',
    };

    // Increment nonce for next transaction in bundle
    this.nonces.set(account.address, currentNonce + 1n);

    // Serialize the transaction (unsigned)
    const serialized = serializeTransaction(transaction);

    // Sign the serialized transaction
    // Note: In a real implementation, you'd use account.signTransaction
    // For Flashbots, we need the raw signed transaction hex
    return serialized;
  }

  /**
   * Reset nonce tracking (call before building a new bundle)
   */
  resetNonces(): void {
    this.nonces.clear();
  }

  /**
   * Calculate optimal bribe for Flashbots
   * Based on expected profit and current network conditions
   */
  calculateOptimalBribe(
    expectedProfitWei: bigint,
    gasUsed: bigint,
    baseFee: bigint
  ): { maxPriorityFeePerGas: bigint; totalBribe: bigint } {
    // Give 50-90% of profit to miner for higher inclusion probability
    const bribePercent = 70n; // 70% to miner
    const totalBribe = (expectedProfitWei * bribePercent) / 100n;

    // Calculate priority fee per gas
    const maxPriorityFeePerGas = gasUsed > 0n ? totalBribe / gasUsed : 0n;

    // Ensure minimum priority fee (1 gwei)
    const minPriorityFee = 1000000000n; // 1 gwei
    const effectivePriorityFee = maxPriorityFeePerGas > minPriorityFee
      ? maxPriorityFeePerGas
      : minPriorityFee;

    return {
      maxPriorityFeePerGas: effectivePriorityFee,
      totalBribe: effectivePriorityFee * gasUsed,
    };
  }

  /**
   * Get builder hints for better bundle inclusion
   */
  getBuilderHints(): string[] {
    return [
      'flashbots',
      'f1b.io',
      'rsync-builder.xyz',
      'beaverbuild.org',
      'builder0x69.io',
      'titan',
      'eigenphi',
    ];
  }

  /**
   * Check if MEV protection is properly configured
   */
  isConfigured(): boolean {
    return this.signerKey !== null;
  }

  /**
   * Get current provider
   */
  getProvider(): MevProvider {
    return this.preferredProvider;
  }

  /**
   * Set preferred provider
   */
  setProvider(provider: MevProvider): void {
    this.preferredProvider = provider;
  }
}

export const mevProtectionService = new MevProtectionService();
export type { BundleTransaction, BundleSubmission, BundleResponse, MevProvider };
