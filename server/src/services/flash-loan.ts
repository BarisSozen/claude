/**
 * Flash Loan Service
 * Flash loan arbitrage using Aave V3
 */

import {
  createPublicClient,
  http,
  encodeFunctionData,
  encodeAbiParameters,
  parseAbiParameters,
  formatUnits,
  type Address,
  type Hex,
} from 'viem';
import { mainnet, arbitrum } from 'viem/chains';
import { getRpcUrl, config } from '../config/env.js';
import { tradeExecutorService } from './trade-executor.js';
import type { ChainId, ExecutionStep, TradeResult } from '../../shared/schema.js';
import { PROTOCOL_ADDRESSES, TOKEN_DECIMALS } from '../../shared/schema.js';

// Aave V3 Pool ABI (minimal for flash loans)
const AAVE_POOL_ABI = [
  {
    inputs: [
      { name: 'receiverAddress', type: 'address' },
      { name: 'assets', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'interestRateModes', type: 'uint256[]' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'params', type: 'bytes' },
      { name: 'referralCode', type: 'uint16' },
    ],
    name: 'flashLoan',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'asset', type: 'address' }],
    name: 'getReserveData',
    outputs: [
      {
        components: [
          { name: 'configuration', type: 'uint256' },
          { name: 'liquidityIndex', type: 'uint128' },
          { name: 'currentLiquidityRate', type: 'uint128' },
          { name: 'variableBorrowIndex', type: 'uint128' },
          { name: 'currentVariableBorrowRate', type: 'uint128' },
          { name: 'currentStableBorrowRate', type: 'uint128' },
          { name: 'lastUpdateTimestamp', type: 'uint40' },
          { name: 'id', type: 'uint16' },
          { name: 'aTokenAddress', type: 'address' },
          { name: 'stableDebtTokenAddress', type: 'address' },
          { name: 'variableDebtTokenAddress', type: 'address' },
          { name: 'interestRateStrategyAddress', type: 'address' },
          { name: 'accruedToTreasury', type: 'uint128' },
          { name: 'unbacked', type: 'uint128' },
          { name: 'isolationModeTotalDebt', type: 'uint128' },
        ],
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Flash loan premium (0.09% on Aave V3)
const FLASH_LOAN_PREMIUM_BPS = 9;

interface FlashLoanParams {
  chainId: ChainId;
  loanToken: Address;
  loanAmount: bigint;
  arbitrageSteps: ExecutionStep[];
}

interface FlashLoanQuote {
  loanToken: Address;
  loanAmount: bigint;
  premium: bigint;
  totalRepayment: bigint;
  estimatedProfit: bigint;
  profitUSD: number;
  gasEstimateUSD: number;
  netProfitUSD: number;
  viable: boolean;
}

class FlashLoanService {
  private clients: Map<ChainId, ReturnType<typeof createPublicClient>> = new Map();

  /**
   * Get public client for a chain
   */
  private getClient(chainId: ChainId) {
    let client = this.clients.get(chainId);

    if (!client) {
      const chain = chainId === 'ethereum' ? mainnet : arbitrum;
      client = createPublicClient({
        chain,
        transport: http(getRpcUrl(chainId)),
      });
      this.clients.set(chainId, client);
    }

    return client;
  }

  /**
   * Calculate flash loan premium
   */
  calculatePremium(amount: bigint): bigint {
    return (amount * BigInt(FLASH_LOAN_PREMIUM_BPS)) / 10000n;
  }

  /**
   * Get flash loan quote
   */
  async getFlashLoanQuote(
    chainId: ChainId,
    loanToken: Address,
    loanAmount: bigint,
    estimatedProfitBeforeLoan: bigint
  ): Promise<FlashLoanQuote> {
    const premium = this.calculatePremium(loanAmount);
    const totalRepayment = loanAmount + premium;

    // Calculate profit after flash loan premium
    const estimatedProfit = estimatedProfitBeforeLoan - premium;

    // Get token decimals (don't hardcode 18 - USDC/USDT are 6)
    const tokenDecimals = TOKEN_DECIMALS[loanToken.toLowerCase()] ?? 18;

    // Convert to USD (rough estimate)
    const profitNormalized = Number(formatUnits(estimatedProfit, tokenDecimals));
    const profitUSD = profitNormalized * config.prices.ethUsd;

    // Gas estimate for flash loan + swaps (higher than regular)
    const gasEstimateUSD = config.gas.mainnetEstimateUsd * 3;

    const netProfitUSD = profitUSD - gasEstimateUSD;

    return {
      loanToken,
      loanAmount,
      premium,
      totalRepayment,
      estimatedProfit,
      profitUSD,
      gasEstimateUSD,
      netProfitUSD,
      viable: netProfitUSD > config.executor.minProfitUsd,
    };
  }

  /**
   * Check if flash loan is available for a token
   */
  async isFlashLoanAvailable(chainId: ChainId, tokenAddress: Address): Promise<boolean> {
    const aavePool = PROTOCOL_ADDRESSES[chainId]?.aavePool;

    if (!aavePool) {
      return false;
    }

    try {
      const client = this.getClient(chainId);
      await client.readContract({
        address: aavePool,
        abi: AAVE_POOL_ABI,
        functionName: 'getReserveData',
        args: [tokenAddress],
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get maximum flash loan amount for a token
   */
  async getMaxFlashLoanAmount(chainId: ChainId, tokenAddress: Address): Promise<bigint> {
    const aavePool = PROTOCOL_ADDRESSES[chainId]?.aavePool;

    if (!aavePool) {
      return 0n;
    }

    try {
      const client = this.getClient(chainId);
      const reserveData = await client.readContract({
        address: aavePool,
        abi: AAVE_POOL_ABI,
        functionName: 'getReserveData',
        args: [tokenAddress],
      });

      // Available liquidity can be derived from aToken total supply
      // For simplicity, return a conservative estimate
      return BigInt('1000000000000000000000'); // 1000 tokens max
    } catch {
      return 0n;
    }
  }

  /**
   * Encode flash loan callback data
   */
  encodeCallbackData(steps: ExecutionStep[]): Hex {
    // Encode the arbitrage steps as callback params
    // In a real implementation, this would encode the swap routes
    const encoded = encodeAbiParameters(
      parseAbiParameters('address[], address[], uint256[]'),
      [
        steps.map((s) => s.tokenIn),
        steps.map((s) => s.tokenOut),
        steps.map((s) => s.amountIn),
      ]
    );

    return encoded;
  }

  /**
   * Build flash loan transaction
   */
  buildFlashLoanTx(params: FlashLoanParams): {
    to: Address;
    data: Hex;
  } {
    const aavePool = PROTOCOL_ADDRESSES[params.chainId]?.aavePool;

    if (!aavePool) {
      throw new Error(`Aave not available on ${params.chainId}`);
    }

    // Note: In production, you need a flash loan receiver contract
    // that implements the executeOperation callback
    const receiverContract = aavePool; // Placeholder

    const callbackData = this.encodeCallbackData(params.arbitrageSteps);

    const data = encodeFunctionData({
      abi: AAVE_POOL_ABI,
      functionName: 'flashLoan',
      args: [
        receiverContract,
        [params.loanToken],
        [params.loanAmount],
        [0n], // Interest rate mode (0 = no debt)
        receiverContract, // onBehalfOf
        callbackData,
        0, // Referral code
      ],
    });

    return { to: aavePool, data };
  }

  /**
   * Execute flash loan arbitrage
   * Note: Requires a deployed flash loan receiver contract
   */
  async executeFlashLoanArbitrage(
    delegationId: string,
    params: FlashLoanParams
  ): Promise<TradeResult> {
    // Get quote first
    const quote = await this.getFlashLoanQuote(
      params.chainId,
      params.loanToken,
      params.loanAmount,
      0n // Would need to calculate expected profit
    );

    if (!quote.viable) {
      return {
        success: false,
        error: `Flash loan not viable: net profit $${quote.netProfitUSD.toFixed(4)}`,
      };
    }

    // Build transaction
    const { to, data } = this.buildFlashLoanTx(params);

    // Execute via trade executor
    return tradeExecutorService.executeTrade({
      delegationId,
      protocol: 'aave-v3',
      action: 'flash_loan',
      tokenIn: params.loanToken,
      amountIn: params.loanAmount,
      targetContract: to,
      callData: data,
    });
  }

  /**
   * Simulate flash loan (dry run)
   */
  async simulateFlashLoan(params: FlashLoanParams): Promise<{
    success: boolean;
    error?: string;
    quote?: FlashLoanQuote;
  }> {
    // Check availability
    const available = await this.isFlashLoanAvailable(params.chainId, params.loanToken);

    if (!available) {
      return {
        success: false,
        error: 'Flash loan not available for this token',
      };
    }

    // Check max amount
    const maxAmount = await this.getMaxFlashLoanAmount(params.chainId, params.loanToken);

    // Get token decimals for proper formatting
    const tokenDecimals = TOKEN_DECIMALS[params.loanToken.toLowerCase()] ?? 18;

    if (params.loanAmount > maxAmount) {
      return {
        success: false,
        error: `Loan amount exceeds max (${formatUnits(maxAmount, tokenDecimals)})`,
      };
    }

    // Get quote
    const quote = await this.getFlashLoanQuote(
      params.chainId,
      params.loanToken,
      params.loanAmount,
      0n
    );

    return {
      success: quote.viable,
      quote,
      error: quote.viable ? undefined : 'Insufficient profit after fees',
    };
  }
}

export const flashLoanService = new FlashLoanService();
