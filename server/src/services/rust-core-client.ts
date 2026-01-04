/**
 * gRPC Client for Rust Low-Latency Core
 *
 * This client connects to the Rust DeFi bot core for:
 * - Sub-millisecond arbitrage detection
 * - EVM simulation
 * - Trade execution via Flashbots
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { config } from '../config/env.js';

// Load proto definition
const PROTO_PATH = path.resolve(__dirname, '../../../rust-core/proto/defi.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const DefiService = protoDescriptor.defi.DefiService;

// Types matching proto definitions
export enum Chain {
  UNKNOWN = 'CHAIN_UNKNOWN',
  ETHEREUM = 'CHAIN_ETHEREUM',
  ARBITRUM = 'CHAIN_ARBITRUM',
  BASE = 'CHAIN_BASE',
  POLYGON = 'CHAIN_POLYGON',
}

export enum DexProtocol {
  UNKNOWN = 'DEX_UNKNOWN',
  UNISWAP_V2 = 'DEX_UNISWAP_V2',
  UNISWAP_V3 = 'DEX_UNISWAP_V3',
  SUSHISWAP = 'DEX_SUSHISWAP',
  CURVE = 'DEX_CURVE',
  BALANCER = 'DEX_BALANCER',
  AAVE_V3 = 'DEX_AAVE_V3',
}

export enum ExecutionStatus {
  UNKNOWN = 'EXECUTION_UNKNOWN',
  PENDING = 'EXECUTION_PENDING',
  SUBMITTED = 'EXECUTION_SUBMITTED',
  CONFIRMED = 'EXECUTION_CONFIRMED',
  FAILED = 'EXECUTION_FAILED',
  REVERTED = 'EXECUTION_REVERTED',
}

export interface Token {
  address: string;
  symbol: string;
  decimals: number;
  chain: Chain;
}

export interface TokenAmount {
  token: Token;
  amount: string;
  amountUsd: number;
}

export interface SwapStep {
  dex: DexProtocol;
  poolAddress: string;
  tokenIn: Token;
  tokenOut: Token;
  amountIn: string;
  amountOut: string;
  priceImpactBps: number;
}

export interface ArbitrageOpportunity {
  id: string;
  chain: Chain;
  tokenPair: string;
  route: SwapStep[];
  inputAmount: TokenAmount;
  outputAmount: TokenAmount;
  profitUsd: number;
  profitBps: number;
  confidence: number;
  gasEstimate: number;
  gasCostUsd: number;
  expiresAtMs: number;
  detectedAtMs: number;
}

export interface PriceUpdate {
  tokenAddress: string;
  chain: Chain;
  priceUsd: number;
  timestampMs: number;
  source: string;
}

export interface SimulateTradeRequest {
  chain: Chain;
  delegationId: string;
  protocol: DexProtocol;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut?: string;
  slippageBps?: number;
}

export interface SimulateTradeResponse {
  success: boolean;
  wouldSucceed: boolean;
  expectedOutput: string;
  expectedOutputUsd: number;
  priceImpactBps: number;
  gasEstimate: number;
  gasCostUsd: number;
  error?: string;
  revertReason?: string;
}

export interface ExecuteTradeRequest {
  chain: Chain;
  delegationId: string;
  opportunityId?: string;
  protocol: DexProtocol;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minAmountOut: string;
  slippageBps: number;
  deadlineMs: number;
  useFlashbots: boolean;
}

export interface ExecuteTradeResponse {
  success: boolean;
  txHash: string;
  tradeId: string;
  status: ExecutionStatus;
  error?: string;
}

export interface SystemStatus {
  success: boolean;
  scannerRunning: boolean;
  uptimeSeconds: number;
  activeFeeds: number;
  trackedPools: number;
  trackedTokens: number;
  opportunitiesFound: number;
  tradesExecuted: number;
  totalProfitUsd: number;
  lastScanDurationUs: number;
  chainStatuses: ChainStatus[];
}

export interface ChainStatus {
  chain: Chain;
  connected: boolean;
  lastBlock: number;
  poolCount: number;
  lastUpdateMs: number;
}

/**
 * Rust Core gRPC Client
 * Provides type-safe access to the low-latency Rust core
 */
export class RustCoreClient extends EventEmitter {
  private client: any;
  private connected: boolean = false;
  private reconnecting: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 1000;

  constructor(
    private host: string = config.grpc.host,
    private port: number = config.grpc.port
  ) {
    super();
  }

  /**
   * Create gRPC credentials based on configuration
   * Uses TLS in production when GRPC_USE_TLS=true
   */
  private createCredentials(): grpc.ChannelCredentials {
    if (!config.grpc.useTls) {
      // Development mode - warn but allow insecure
      if (config.server.nodeEnv === 'production') {
        console.warn('[SECURITY] gRPC using insecure credentials in production!');
      }
      return grpc.credentials.createInsecure();
    }

    // Production TLS configuration
    const caCert = config.grpc.caCertPath
      ? fs.readFileSync(config.grpc.caCertPath)
      : undefined;
    const clientCert = config.grpc.clientCertPath
      ? fs.readFileSync(config.grpc.clientCertPath)
      : undefined;
    const clientKey = config.grpc.clientKeyPath
      ? fs.readFileSync(config.grpc.clientKeyPath)
      : undefined;

    return grpc.credentials.createSsl(caCert, clientKey, clientCert);
  }

  /**
   * Connect to the Rust core
   */
  async connect(): Promise<void> {
    const address = `${this.host}:${this.port}`;

    return new Promise((resolve, reject) => {
      this.client = new DefiService(
        address,
        this.createCredentials(),
        {
          'grpc.keepalive_time_ms': 60000,
          'grpc.keepalive_timeout_ms': 20000,
          'grpc.keepalive_permit_without_calls': 1,
          'grpc.max_receive_message_length': 50 * 1024 * 1024, // 50MB
        }
      );

      // Wait for connection
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 5);

      this.client.waitForReady(deadline, (err: Error | null) => {
        if (err) {
          console.error('Failed to connect to Rust core:', err.message);
          reject(err);
        } else {
          this.connected = true;
          this.reconnectAttempts = 0;
          this.emit('connected');
          console.log(`Connected to Rust core at ${address} (TLS: ${config.grpc.useTls})`);
          resolve();
        }
      });
    });
  }

  /**
   * Disconnect from the Rust core
   */
  disconnect(): void {
    if (this.client) {
      this.client.close();
      this.connected = false;
      this.emit('disconnected');
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get price for a token
   */
  async getPrice(tokenAddress: string, chain: Chain): Promise<PriceUpdate | null> {
    return this.callUnary('getPrice', {
      token_address: tokenAddress,
      chain: this.chainToProto(chain),
    });
  }

  /**
   * Stream price updates for tokens
   */
  streamPrices(
    tokenAddresses: string[],
    chain: Chain,
    callback: (update: PriceUpdate) => void
  ): () => void {
    const call = this.client.streamPrices({
      token_addresses: tokenAddresses,
      chain: this.chainToProto(chain),
    });

    call.on('data', (data: any) => {
      callback(this.transformPriceUpdate(data));
    });

    call.on('error', (err: Error) => {
      console.error('Price stream error:', err);
      this.emit('streamError', err);
    });

    call.on('end', () => {
      this.emit('streamEnded', 'prices');
    });

    // Return cancel function
    return () => call.cancel();
  }

  /**
   * Get current arbitrage opportunities
   */
  async getOpportunities(
    chains: Chain[] = [],
    minProfitUsd: number = 0,
    minConfidence: number = 0.5,
    limit: number = 100
  ): Promise<ArbitrageOpportunity[]> {
    const response = await this.callUnary('getOpportunities', {
      chains: chains.map(c => this.chainToProto(c)),
      min_profit_usd: minProfitUsd,
      min_confidence: minConfidence,
      limit,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to get opportunities');
    }

    return response.opportunities.map((opp: any) => this.transformOpportunity(opp));
  }

  /**
   * Stream arbitrage opportunities in real-time
   */
  streamOpportunities(
    chains: Chain[],
    minProfitUsd: number,
    minConfidence: number,
    callback: (opportunity: ArbitrageOpportunity) => void
  ): () => void {
    const call = this.client.streamOpportunities({
      chains: chains.map(c => this.chainToProto(c)),
      min_profit_usd: minProfitUsd,
      min_confidence: minConfidence,
    });

    call.on('data', (data: any) => {
      callback(this.transformOpportunity(data));
    });

    call.on('error', (err: Error) => {
      console.error('Opportunity stream error:', err);
      this.emit('streamError', err);
    });

    return () => call.cancel();
  }

  /**
   * Simulate a trade before execution
   */
  async simulateTrade(request: SimulateTradeRequest): Promise<SimulateTradeResponse> {
    const response = await this.callUnary('simulateTrade', {
      chain: this.chainToProto(request.chain),
      delegation_id: request.delegationId,
      protocol: this.dexToProto(request.protocol),
      token_in: request.tokenIn,
      token_out: request.tokenOut,
      amount_in: request.amountIn,
      min_amount_out: request.minAmountOut || '0',
      slippage_bps: request.slippageBps || 50,
    });

    return {
      success: response.success,
      wouldSucceed: response.would_succeed,
      expectedOutput: response.expected_output,
      expectedOutputUsd: response.expected_output_usd,
      priceImpactBps: response.price_impact_bps,
      gasEstimate: Number(response.gas_estimate),
      gasCostUsd: response.gas_cost_usd,
      error: response.error || undefined,
      revertReason: response.revert_reason || undefined,
    };
  }

  /**
   * Execute a trade
   */
  async executeTrade(request: ExecuteTradeRequest): Promise<ExecuteTradeResponse> {
    const response = await this.callUnary('executeTrade', {
      chain: this.chainToProto(request.chain),
      delegation_id: request.delegationId,
      opportunity_id: request.opportunityId || '',
      protocol: this.dexToProto(request.protocol),
      token_in: request.tokenIn,
      token_out: request.tokenOut,
      amount_in: request.amountIn,
      min_amount_out: request.minAmountOut,
      slippage_bps: request.slippageBps,
      deadline_ms: request.deadlineMs,
      use_flashbots: request.useFlashbots,
    });

    return {
      success: response.success,
      txHash: response.tx_hash,
      tradeId: response.trade_id,
      status: this.statusFromProto(response.status),
      error: response.error || undefined,
    };
  }

  /**
   * Get system status
   */
  async getSystemStatus(): Promise<SystemStatus> {
    const response = await this.callUnary('getSystemStatus', {});

    return {
      success: response.success,
      scannerRunning: response.scanner_running,
      uptimeSeconds: Number(response.uptime_seconds),
      activeFeeds: response.active_feeds,
      trackedPools: response.tracked_pools,
      trackedTokens: response.tracked_tokens,
      opportunitiesFound: Number(response.opportunities_found),
      tradesExecuted: Number(response.trades_executed),
      totalProfitUsd: response.total_profit_usd,
      lastScanDurationUs: Number(response.last_scan_duration_us),
      chainStatuses: response.chain_statuses.map((cs: any) => ({
        chain: this.chainFromProto(cs.chain),
        connected: cs.connected,
        lastBlock: Number(cs.last_block),
        poolCount: cs.pool_count,
        lastUpdateMs: Number(cs.last_update_ms),
      })),
    };
  }

  /**
   * Start the arbitrage scanner
   */
  async startScanner(chains: Chain[] = []): Promise<boolean> {
    const response = await this.callUnary('startScanner', {
      chains: chains.map(c => this.chainToProto(c)),
    });
    return response.success;
  }

  /**
   * Stop the arbitrage scanner
   */
  async stopScanner(): Promise<boolean> {
    const response = await this.callUnary('stopScanner', {});
    return response.success;
  }

  /**
   * Update scanner configuration
   */
  async updateConfig(config: {
    scanIntervalMs?: number;
    minProfitUsd?: number;
    minConfidence?: number;
    maxGasGwei?: number;
    enabledChains?: Chain[];
    enabledDexes?: DexProtocol[];
  }): Promise<boolean> {
    const response = await this.callUnary('updateConfig', {
      scan_interval_ms: config.scanIntervalMs,
      min_profit_usd: config.minProfitUsd,
      min_confidence: config.minConfidence,
      max_gas_gwei: config.maxGasGwei,
      enabled_chains: config.enabledChains?.map(c => this.chainToProto(c)),
      enabled_dexes: config.enabledDexes?.map(d => this.dexToProto(d)),
    });
    return response.success;
  }

  // Private helper methods
  private async callUnary(method: string, request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.client[method](request, (err: Error | null, response: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(response);
        }
      });
    });
  }

  private chainToProto(chain: Chain): number {
    const mapping: Record<Chain, number> = {
      [Chain.UNKNOWN]: 0,
      [Chain.ETHEREUM]: 1,
      [Chain.ARBITRUM]: 2,
      [Chain.BASE]: 3,
      [Chain.POLYGON]: 4,
    };
    return mapping[chain] || 0;
  }

  private chainFromProto(value: number): Chain {
    const mapping: Record<number, Chain> = {
      0: Chain.UNKNOWN,
      1: Chain.ETHEREUM,
      2: Chain.ARBITRUM,
      3: Chain.BASE,
      4: Chain.POLYGON,
    };
    return mapping[value] || Chain.UNKNOWN;
  }

  private dexToProto(dex: DexProtocol): number {
    const mapping: Record<DexProtocol, number> = {
      [DexProtocol.UNKNOWN]: 0,
      [DexProtocol.UNISWAP_V2]: 1,
      [DexProtocol.UNISWAP_V3]: 2,
      [DexProtocol.SUSHISWAP]: 3,
      [DexProtocol.CURVE]: 4,
      [DexProtocol.BALANCER]: 5,
      [DexProtocol.AAVE_V3]: 6,
    };
    return mapping[dex] || 0;
  }

  private statusFromProto(value: number): ExecutionStatus {
    const mapping: Record<number, ExecutionStatus> = {
      0: ExecutionStatus.UNKNOWN,
      1: ExecutionStatus.PENDING,
      2: ExecutionStatus.SUBMITTED,
      3: ExecutionStatus.CONFIRMED,
      4: ExecutionStatus.FAILED,
      5: ExecutionStatus.REVERTED,
    };
    return mapping[value] || ExecutionStatus.UNKNOWN;
  }

  private transformPriceUpdate(data: any): PriceUpdate {
    return {
      tokenAddress: data.token_address,
      chain: this.chainFromProto(data.chain),
      priceUsd: data.price_usd,
      timestampMs: Number(data.timestamp_ms),
      source: data.source,
    };
  }

  private transformOpportunity(data: any): ArbitrageOpportunity {
    return {
      id: data.id,
      chain: this.chainFromProto(data.chain),
      tokenPair: data.token_pair,
      route: data.route?.map((step: any) => ({
        dex: this.dexFromProto(step.dex),
        poolAddress: step.pool_address,
        tokenIn: step.token_in,
        tokenOut: step.token_out,
        amountIn: step.amount_in,
        amountOut: step.amount_out,
        priceImpactBps: step.price_impact_bps,
      })) || [],
      inputAmount: data.input_amount,
      outputAmount: data.output_amount,
      profitUsd: data.profit_usd,
      profitBps: data.profit_bps,
      confidence: data.confidence,
      gasEstimate: Number(data.gas_estimate),
      gasCostUsd: data.gas_cost_usd,
      expiresAtMs: Number(data.expires_at_ms),
      detectedAtMs: Number(data.detected_at_ms),
    };
  }

  private dexFromProto(value: number): DexProtocol {
    const mapping: Record<number, DexProtocol> = {
      0: DexProtocol.UNKNOWN,
      1: DexProtocol.UNISWAP_V2,
      2: DexProtocol.UNISWAP_V3,
      3: DexProtocol.SUSHISWAP,
      4: DexProtocol.CURVE,
      5: DexProtocol.BALANCER,
      6: DexProtocol.AAVE_V3,
    };
    return mapping[value] || DexProtocol.UNKNOWN;
  }
}

// Singleton instance
let rustCoreClient: RustCoreClient | null = null;

/**
 * Get the Rust core client singleton
 */
export function getRustCoreClient(): RustCoreClient {
  if (!rustCoreClient) {
    const host = process.env.RUST_CORE_HOST || 'localhost';
    const port = parseInt(process.env.RUST_CORE_PORT || '50051', 10);
    rustCoreClient = new RustCoreClient(host, port);
  }
  return rustCoreClient;
}

/**
 * Initialize and connect to Rust core
 */
export async function initRustCore(): Promise<RustCoreClient> {
  const client = getRustCoreClient();

  if (!client.isConnected()) {
    try {
      await client.connect();
      console.log('Successfully connected to Rust core');
    } catch (error) {
      console.warn('Failed to connect to Rust core, running in degraded mode:', error);
      // Don't throw - allow TypeScript backend to run without Rust core
    }
  }

  return client;
}
