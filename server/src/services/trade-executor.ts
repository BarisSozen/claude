/**
 * Trade Execution Service
 * Executes trades using delegated session keys
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  formatUnits,
  parseUnits,
  encodeFunctionData,
  type Address,
  type Hex,
  type WalletClient,
  type PublicClient,
  type Account,
  erc20Abi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum, base, polygon } from 'viem/chains';
import { getRpcUrl, config } from '../config/env.js';
import { decryptPrivateKey } from './encryption.js';
import { delegationService, type DelegationWithLimits } from './delegation.js';
import { priceOracleService } from './price-oracle.js';
import { db, trades } from '../db/index.js';
import type { ChainId, TradeParams, TradeResult, TradeAction } from '../../shared/schema.js';
import { TOKEN_DECIMALS, PROTOCOL_ADDRESSES, ETH_ADDRESS } from '../../shared/schema.js';

// Uniswap V3 Router ABI (minimal for exactInputSingle)
const UNISWAP_V3_ROUTER_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'exactInputSingle',
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;

// Chain configs
const CHAIN_CONFIGS = {
  ethereum: mainnet,
  arbitrum: arbitrum,
  base: base,
  polygon: polygon,
};

interface ExecutionContext {
  delegation: DelegationWithLimits;
  walletClient: WalletClient;
  publicClient: PublicClient;
  sessionKeyAddress: Address;
}

class TradeExecutorService {
  private activeContexts: Map<string, ExecutionContext> = new Map();

  /**
   * Get token decimals
   */
  private getTokenDecimals(tokenAddress: Address): number {
    return TOKEN_DECIMALS[tokenAddress.toLowerCase()] ?? 18;
  }

  /**
   * Get chain config
   */
  private getChain(chainId: ChainId) {
    return CHAIN_CONFIGS[chainId];
  }

  /**
   * Initialize execution context for a delegation
   */
  private async initializeContext(delegationId: string): Promise<ExecutionContext | null> {
    // Check if already initialized
    const existing = this.activeContexts.get(delegationId);
    if (existing) {
      return existing;
    }

    // Validate delegation
    const validation = await delegationService.validate(delegationId);
    if (!validation.valid || !validation.delegation) {
      console.error(`Delegation validation failed: ${validation.reason}`);
      return null;
    }

    const delegation = validation.delegation;

    // Decrypt session key (minimize time in memory)
    let privateKey: string;
    try {
      privateKey = decryptPrivateKey(delegation.encryptedSessionKey);
    } catch (error) {
      console.error('Failed to decrypt session key:', error);
      return null;
    }

    // Create account from private key
    const account = privateKeyToAccount(privateKey as Hex);

    // Verify the decrypted key matches the stored address
    if (account.address.toLowerCase() !== delegation.sessionKeyAddress.toLowerCase()) {
      console.error('Session key address mismatch');
      return null;
    }

    const chain = this.getChain(delegation.chainId as ChainId);
    const rpcUrl = getRpcUrl(delegation.chainId);

    // Create clients
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    const context: ExecutionContext = {
      delegation,
      walletClient,
      publicClient,
      sessionKeyAddress: account.address,
    };

    // Cache context (for short period)
    this.activeContexts.set(delegationId, context);

    // Auto-cleanup after 5 minutes
    setTimeout(() => {
      this.activeContexts.delete(delegationId);
    }, 5 * 60 * 1000);

    return context;
  }

  /**
   * Ensure token approval for spending
   */
  private async ensureApproval(
    context: ExecutionContext,
    tokenAddress: Address,
    spenderAddress: Address,
    amount: bigint
  ): Promise<{ needed: boolean; txHash?: string }> {
    // Native ETH doesn't need approval
    if (tokenAddress.toLowerCase() === ETH_ADDRESS.toLowerCase()) {
      return { needed: false };
    }

    // Check current allowance
    const allowance = await context.publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [context.sessionKeyAddress, spenderAddress],
    });

    if (allowance >= amount) {
      return { needed: false };
    }

    // Approve max uint256 to avoid repeated approvals
    const maxApproval = 2n ** 256n - 1n;

    const txHash = await context.walletClient.writeContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spenderAddress, maxApproval],
    });

    // Wait for confirmation
    await context.publicClient.waitForTransactionReceipt({ hash: txHash });

    return { needed: true, txHash };
  }

  /**
   * Execute a trade
   */
  async executeTrade(params: TradeParams): Promise<TradeResult> {
    const startTime = Date.now();

    // Initialize context
    const context = await this.initializeContext(params.delegationId);
    if (!context) {
      return { success: false, error: 'Failed to initialize execution context' };
    }

    const { delegation, walletClient, publicClient } = context;

    // Validate delegation status
    const validation = await delegationService.validate(params.delegationId);
    if (!validation.valid) {
      return { success: false, error: validation.reason };
    }

    // Check protocol is allowed
    if (!delegationService.isProtocolAllowed(delegation, params.protocol)) {
      return { success: false, error: `Protocol ${params.protocol} not allowed` };
    }

    // Check tokens are allowed
    if (params.tokenIn && !delegationService.isTokenAllowed(delegation, params.tokenIn)) {
      return { success: false, error: `Token ${params.tokenIn} not allowed` };
    }
    if (params.tokenOut && !delegationService.isTokenAllowed(delegation, params.tokenOut)) {
      return { success: false, error: `Token ${params.tokenOut} not allowed` };
    }

    // Calculate trade amount in USD
    let tradeAmountUsd = 0;
    if (params.tokenIn) {
      try {
        const price = await priceOracleService.getBestPrice(
          delegation.chainId as ChainId,
          params.tokenIn,
          params.amountIn
        );
        tradeAmountUsd = price.priceInUSD;
      } catch {
        // Use fallback calculation
        const decimals = this.getTokenDecimals(params.tokenIn);
        const normalizedAmount = Number(formatUnits(params.amountIn, decimals));
        tradeAmountUsd = normalizedAmount * config.prices.ethUsd; // Rough estimate
      }
    }

    // Check trade limits
    const limitCheck = await delegationService.checkTradeLimits(
      params.delegationId,
      tradeAmountUsd
    );

    if (!limitCheck.allowed) {
      return { success: false, error: limitCheck.reason };
    }

    // Record pending trade
    const [tradeRecord] = await db
      .insert(trades)
      .values({
        delegationId: params.delegationId,
        chainId: delegation.chainId,
        protocol: params.protocol,
        action: params.action,
        tokenIn: params.tokenIn || null,
        tokenOut: params.tokenOut || null,
        amountIn: params.amountIn.toString(),
        status: 'pending',
      })
      .returning();

    try {
      // Ensure token approval if needed
      if (params.tokenIn && params.tokenIn.toLowerCase() !== ETH_ADDRESS.toLowerCase()) {
        await this.ensureApproval(
          context,
          params.tokenIn,
          params.targetContract,
          params.amountIn
        );
      }

      // Execute the transaction
      const value = params.tokenIn?.toLowerCase() === ETH_ADDRESS.toLowerCase()
        ? params.amountIn
        : 0n;

      const txHash = await walletClient.sendTransaction({
        to: params.targetContract,
        data: params.callData || '0x',
        value,
      });

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status === 'reverted') {
        // Update trade record
        await db
          .update(trades)
          .set({
            txHash,
            status: 'reverted',
            gasUsed: receipt.gasUsed.toString(),
            gasPrice: receipt.effectiveGasPrice.toString(),
            confirmedAt: new Date(),
          })
          .where(eq(trades.id, tradeRecord.id));

        return {
          success: false,
          txHash,
          error: 'Transaction reverted',
          gasUsed: receipt.gasUsed,
        };
      }

      // Update limits after successful trade
      await delegationService.updateLimitsAfterTrade(params.delegationId, tradeAmountUsd);

      // Update trade record
      await db
        .update(trades)
        .set({
          txHash,
          status: 'success',
          gasUsed: receipt.gasUsed.toString(),
          gasPrice: receipt.effectiveGasPrice.toString(),
          confirmedAt: new Date(),
        })
        .where(eq(trades.id, tradeRecord.id));

      const executionTime = Date.now() - startTime;
      console.log(`Trade executed in ${executionTime}ms: ${txHash}`);

      return {
        success: true,
        txHash,
        gasUsed: receipt.gasUsed,
      };
    } catch (error) {
      console.error('Trade execution failed:', error);

      // Update trade record
      await db
        .update(trades)
        .set({
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          confirmedAt: new Date(),
        })
        .where(eq(trades.id, tradeRecord.id));

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute a Uniswap V3 swap
   */
  async executeUniswapV3Swap(
    delegationId: string,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    amountOutMin: bigint,
    fee: number = 3000
  ): Promise<TradeResult> {
    const context = await this.initializeContext(delegationId);
    if (!context) {
      return { success: false, error: 'Failed to initialize context' };
    }

    const chainId = context.delegation.chainId as ChainId;
    const router = PROTOCOL_ADDRESSES[chainId]?.uniswapV3Router;

    if (!router) {
      return { success: false, error: 'Uniswap V3 not available on this chain' };
    }

    // Encode swap data
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 minutes

    const swapParams = {
      tokenIn,
      tokenOut,
      fee,
      recipient: context.sessionKeyAddress,
      deadline,
      amountIn,
      amountOutMinimum: amountOutMin,
      sqrtPriceLimitX96: 0n,
    };

    const callData = encodeFunctionData({
      abi: UNISWAP_V3_ROUTER_ABI,
      functionName: 'exactInputSingle',
      args: [swapParams],
    });

    return this.executeTrade({
      delegationId,
      protocol: 'uniswap-v3',
      action: 'swap',
      tokenIn,
      tokenOut,
      amountIn,
      amountOutMin,
      targetContract: router,
      callData,
    });
  }

  /**
   * Calculate minimum output with slippage
   */
  calculateMinOutput(expectedOutput: bigint, slippagePercent: number): bigint {
    const slippageBps = BigInt(Math.floor(slippagePercent * 10000));
    return (expectedOutput * (10000n - slippageBps)) / 10000n;
  }

  /**
   * Get deadline timestamp
   */
  getDeadline(minutes: number = 5): bigint {
    return BigInt(Math.floor(Date.now() / 1000) + minutes * 60);
  }

  /**
   * Build swap transaction for MEV bundle
   * Returns unsigned transaction for Flashbots submission
   */
  async buildSwapTransaction(
    delegationId: string,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    minAmountOut: bigint,
    dex: string
  ): Promise<{
    success: boolean;
    transaction?: {
      to: Address;
      data: Hex;
      value?: bigint;
      gasLimit?: bigint;
    };
    error?: string;
  }> {
    const context = await this.initializeContext(delegationId);
    if (!context) {
      return { success: false, error: 'Failed to initialize execution context' };
    }

    try {
      const chainId = context.delegation.chainId as ChainId;
      let router: Address;
      let callData: Hex;

      if (dex.startsWith('uniswap-v3')) {
        router = PROTOCOL_ADDRESSES[chainId]?.uniswapV3Router as Address;
        if (!router) {
          return { success: false, error: `Uniswap V3 router not found for ${chainId}` };
        }

        // Extract fee from dex string (e.g., 'uniswap-v3-3000')
        const fee = parseInt(dex.split('-')[2], 10) || 3000;

        const swapParams = {
          tokenIn,
          tokenOut,
          fee,
          recipient: context.sessionKeyAddress,
          deadline: this.getDeadline(5),
          amountIn,
          amountOutMinimum: minAmountOut,
          sqrtPriceLimitX96: 0n,
        };

        callData = encodeFunctionData({
          abi: UNISWAP_V3_ROUTER_ABI,
          functionName: 'exactInputSingle',
          args: [swapParams],
        });
      } else if (dex === 'sushiswap') {
        router = PROTOCOL_ADDRESSES[chainId]?.sushiswapRouter as Address;
        if (!router) {
          return { success: false, error: `SushiSwap router not found for ${chainId}` };
        }

        // V2-style swap
        const SUSHISWAP_V2_ABI = [{
          inputs: [
            { name: 'amountIn', type: 'uint256' },
            { name: 'amountOutMin', type: 'uint256' },
            { name: 'path', type: 'address[]' },
            { name: 'to', type: 'address' },
            { name: 'deadline', type: 'uint256' },
          ],
          name: 'swapExactTokensForTokens',
          outputs: [{ name: 'amounts', type: 'uint256[]' }],
          stateMutability: 'nonpayable',
          type: 'function',
        }] as const;

        callData = encodeFunctionData({
          abi: SUSHISWAP_V2_ABI,
          functionName: 'swapExactTokensForTokens',
          args: [
            amountIn,
            minAmountOut,
            [tokenIn, tokenOut],
            context.sessionKeyAddress,
            this.getDeadline(5),
          ],
        });
      } else {
        return { success: false, error: `Unsupported DEX: ${dex}` };
      }

      return {
        success: true,
        transaction: {
          to: router,
          data: callData,
          value: tokenIn === ETH_ADDRESS ? amountIn : undefined,
          gasLimit: dex.startsWith('uniswap-v3') ? 180000n : 150000n,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to build transaction',
      };
    }
  }

  /**
   * Get current block number
   */
  async getCurrentBlock(chainId: ChainId): Promise<bigint> {
    const chain = this.getChain(chainId);
    const client = createPublicClient({
      chain,
      transport: http(getRpcUrl(chainId)),
    });

    return client.getBlockNumber();
  }

  /**
   * Clean up execution context
   */
  cleanupContext(delegationId: string): void {
    this.activeContexts.delete(delegationId);
  }

  /**
   * Clean up all contexts
   */
  cleanupAllContexts(): void {
    this.activeContexts.clear();
  }
}

// Import eq for database queries
import { eq } from 'drizzle-orm';

export const tradeExecutorService = new TradeExecutorService();
