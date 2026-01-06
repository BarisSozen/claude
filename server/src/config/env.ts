/**
 * Environment Configuration
 * Validates and exports all environment variables
 */

import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // RPC URLs
  ETH_RPC_URL: z.string().min(1, 'ETH_RPC_URL is required'),
  ARBITRUM_RPC_URL: z.string().optional(),
  BASE_RPC_URL: z.string().optional(),
  POLYGON_RPC_URL: z.string().optional(),

  // Encryption
  ENCRYPTION_KEY: z.string().length(64, 'ENCRYPTION_KEY must be 32 bytes (64 hex chars)'),

  // Price feeds (fallbacks)
  ETH_PRICE_USD: z.string().default('3900'),

  // Gas estimates (fallbacks)
  MAINNET_GAS_ESTIMATE_USD: z.string().default('15'),
  STABLE_SWAP_GAS_USD: z.string().default('5'),

  // Risk parameters
  MAX_PRICE_IMPACT: z.string().default('0.02'),
  MAX_STABLE_PRICE_IMPACT: z.string().default('0.005'),

  // Executor config
  MIN_PROFIT_USD: z.string().default('0.01'),
  SCAN_INTERVAL_MS: z.string().default('5000'),
  MAX_DAILY_TRADES: z.string().default('100'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // gRPC (Rust core connection)
  GRPC_HOST: z.string().default('localhost'),
  GRPC_PORT: z.string().default('50051'),
  GRPC_USE_TLS: z.string().default('false'),
  GRPC_CA_CERT_PATH: z.string().optional(),
  GRPC_CLIENT_CERT_PATH: z.string().optional(),
  GRPC_CLIENT_KEY_PATH: z.string().optional(),

  // MEV Protection
  FLASHBOTS_SIGNER_KEY: z.string().optional(),
  BLOXROUTE_API_KEY: z.string().optional(),
  MEV_PROVIDER: z.enum(['flashbots', 'bloxroute', 'both']).default('flashbots'),

  // Slippage and risk
  MAX_SLIPPAGE_PERCENT: z.string().default('1.5'),
  QUOTE_MAX_AGE_SEC: z.string().default('2'),
  OPPORTUNITY_EXPIRY_SEC: z.string().default('12'),
  MIN_PROFIT_MULTIPLIER: z.string().default('2'),
});

// Parse and validate environment
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

// Chain-specific RPC URLs
export function getRpcUrl(chainId: string): string {
  switch (chainId) {
    case 'ethereum':
      return env.ETH_RPC_URL;
    case 'arbitrum':
      return env.ARBITRUM_RPC_URL || env.ETH_RPC_URL;
    case 'base':
      return env.BASE_RPC_URL || env.ETH_RPC_URL;
    case 'polygon':
      return env.POLYGON_RPC_URL || env.ETH_RPC_URL;
    default:
      return env.ETH_RPC_URL;
  }
}

// Export typed config object
export const config = {
  server: {
    nodeEnv: env.NODE_ENV,
    port: parseInt(env.PORT, 10),
    corsOrigin: env.CORS_ORIGIN,
  },
  database: {
    url: env.DATABASE_URL,
  },
  redis: {
    url: env.REDIS_URL,
  },
  rpc: {
    ethereum: env.ETH_RPC_URL,
    arbitrum: env.ARBITRUM_RPC_URL,
    base: env.BASE_RPC_URL,
    polygon: env.POLYGON_RPC_URL,
  },
  encryption: {
    key: Buffer.from(env.ENCRYPTION_KEY, 'hex'),
  },
  prices: {
    ethUsd: parseFloat(env.ETH_PRICE_USD),
  },
  gas: {
    mainnetEstimateUsd: parseFloat(env.MAINNET_GAS_ESTIMATE_USD),
    stableSwapUsd: parseFloat(env.STABLE_SWAP_GAS_USD),
  },
  risk: {
    maxPriceImpact: parseFloat(env.MAX_PRICE_IMPACT),
    maxStablePriceImpact: parseFloat(env.MAX_STABLE_PRICE_IMPACT),
  },
  executor: {
    minProfitUsd: parseFloat(env.MIN_PROFIT_USD),
    scanIntervalMs: parseInt(env.SCAN_INTERVAL_MS, 10),
    maxDailyTrades: parseInt(env.MAX_DAILY_TRADES, 10),
  },
  grpc: {
    host: env.GRPC_HOST,
    port: parseInt(env.GRPC_PORT, 10),
    useTls: env.GRPC_USE_TLS === 'true',
    caCertPath: env.GRPC_CA_CERT_PATH,
    clientCertPath: env.GRPC_CLIENT_CERT_PATH,
    clientKeyPath: env.GRPC_CLIENT_KEY_PATH,
  },
  mev: {
    flashbotsSignerKey: env.FLASHBOTS_SIGNER_KEY,
    provider: env.MEV_PROVIDER as 'flashbots' | 'bloxroute' | 'both',
  },
  bloxroute: {
    apiKey: env.BLOXROUTE_API_KEY,
  },
  slippage: {
    maxSlippagePercent: parseFloat(env.MAX_SLIPPAGE_PERCENT),
    quoteMaxAgeSec: parseInt(env.QUOTE_MAX_AGE_SEC, 10),
    opportunityExpirySec: parseInt(env.OPPORTUNITY_EXPIRY_SEC, 10),
    minProfitMultiplier: parseFloat(env.MIN_PROFIT_MULTIPLIER),
  },
} as const;
