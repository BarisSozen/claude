/**
 * Database Schema - Drizzle ORM
 * PostgreSQL schema for DeFi Bot
 */

import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  text,
  decimal,
  boolean,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Users table
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  walletAddress: varchar('wallet_address', { length: 42 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastSeen: timestamp('last_seen'),
  preferences: jsonb('preferences').default({}).$type<{
    defaultChain?: string;
    slippageTolerance?: number;
    notifications?: boolean;
  }>(),
}, (table) => ({
  walletAddressIdx: index('users_wallet_address_idx').on(table.walletAddress),
}));

// Delegations table (session key permissions)
export const delegations = pgTable('delegations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  walletAddress: varchar('wallet_address', { length: 42 }).notNull(),
  sessionKeyAddress: varchar('session_key_address', { length: 42 }).notNull(),
  encryptedSessionKey: text('encrypted_session_key').notNull(),
  chainId: varchar('chain_id', { length: 20 }).notNull(),
  allowedProtocols: text('allowed_protocols').array().notNull(),
  allowedTokens: text('allowed_tokens').array().notNull(),
  status: varchar('status', { length: 20 }).default('active').notNull().$type<
    'active' | 'paused' | 'revoked' | 'expired'
  >(),
  validFrom: timestamp('valid_from').notNull(),
  validUntil: timestamp('valid_until').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('delegations_user_id_idx').on(table.userId),
  walletAddressIdx: index('delegations_wallet_address_idx').on(table.walletAddress),
  statusIdx: index('delegations_status_idx').on(table.status),
}));

// Session limits table
export const sessionLimits = pgTable('session_limits', {
  id: uuid('id').primaryKey().defaultRandom(),
  delegationId: uuid('delegation_id').notNull().references(() => delegations.id, { onDelete: 'cascade' }).unique(),
  maxPerTrade: varchar('max_per_trade', { length: 78 }).notNull(),
  maxDailyVolume: varchar('max_daily_volume', { length: 78 }).notNull(),
  maxWeeklyVolume: varchar('max_weekly_volume', { length: 78 }).notNull(),
  currentDailyVolume: varchar('current_daily_volume', { length: 78 }).default('0').notNull(),
  currentWeeklyVolume: varchar('current_weekly_volume', { length: 78 }).default('0').notNull(),
  maxLeverage: varchar('max_leverage', { length: 10 }).default('1.0').notNull(),
  lastResetDaily: timestamp('last_reset_daily').defaultNow().notNull(),
  lastResetWeekly: timestamp('last_reset_weekly').defaultNow().notNull(),
});

// Trades table
export const trades = pgTable('trades', {
  id: uuid('id').primaryKey().defaultRandom(),
  delegationId: uuid('delegation_id').notNull().references(() => delegations.id),
  txHash: varchar('tx_hash', { length: 66 }),
  chainId: varchar('chain_id', { length: 20 }).notNull(),
  protocol: varchar('protocol', { length: 50 }).notNull(),
  action: varchar('action', { length: 20 }).notNull().$type<
    'swap' | 'lend' | 'borrow' | 'repay' | 'flash_loan'
  >(),
  tokenIn: varchar('token_in', { length: 42 }),
  tokenOut: varchar('token_out', { length: 42 }),
  amountIn: varchar('amount_in', { length: 78 }).notNull(),
  amountOut: varchar('amount_out', { length: 78 }),
  gasUsed: varchar('gas_used', { length: 78 }),
  gasPrice: varchar('gas_price', { length: 78 }),
  profitUsd: decimal('profit_usd', { precision: 20, scale: 6 }),
  status: varchar('status', { length: 20 }).notNull().$type<
    'pending' | 'success' | 'failed' | 'reverted'
  >(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at'),
}, (table) => ({
  delegationIdIdx: index('trades_delegation_id_idx').on(table.delegationId),
  statusIdx: index('trades_status_idx').on(table.status),
  createdAtIdx: index('trades_created_at_idx').on(table.createdAt),
}));

// Delegation audits table
export const delegationAudits = pgTable('delegation_audits', {
  id: uuid('id').primaryKey().defaultRandom(),
  delegationId: uuid('delegation_id').notNull().references(() => delegations.id, { onDelete: 'cascade' }),
  action: varchar('action', { length: 50 }).notNull(),
  triggeredBy: varchar('triggered_by', { length: 20 }).notNull().$type<
    'user' | 'system' | 'admin'
  >(),
  metadata: jsonb('metadata').default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  delegationIdIdx: index('delegation_audits_delegation_id_idx').on(table.delegationId),
}));

// Price history table (for TimescaleDB hypertable)
export const priceHistory = pgTable('price_history', {
  time: timestamp('time', { withTimezone: true }).notNull(),
  chain: varchar('chain', { length: 20 }).notNull(),
  tokenAddress: varchar('token_address', { length: 42 }).notNull(),
  priceUsd: decimal('price_usd', { precision: 30, scale: 18 }).notNull(),
  dex: varchar('dex', { length: 50 }),
  liquidity: decimal('liquidity', { precision: 30, scale: 18 }),
}, (table) => ({
  pk: primaryKey({ columns: [table.time, table.chain, table.tokenAddress] }),
  tokenAddressIdx: index('price_history_token_address_idx').on(table.tokenAddress),
}));

// Auth nonces table (for SIWE)
export const authNonces = pgTable('auth_nonces', {
  walletAddress: varchar('wallet_address', { length: 42 }).primaryKey(),
  nonce: varchar('nonce', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Arbitrage opportunities table (for tracking)
export const arbitrageOpportunities = pgTable('arbitrage_opportunities', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: varchar('type', { length: 30 }).notNull().$type<
    'cross-exchange' | 'triangular' | 'cross-chain'
  >(),
  tokenPair: varchar('token_pair', { length: 100 }).notNull(),
  buyDex: varchar('buy_dex', { length: 50 }).notNull(),
  sellDex: varchar('sell_dex', { length: 50 }).notNull(),
  buyPrice: varchar('buy_price', { length: 78 }).notNull(),
  sellPrice: varchar('sell_price', { length: 78 }).notNull(),
  profitUsd: decimal('profit_usd', { precision: 20, scale: 6 }).notNull(),
  profitPercent: decimal('profit_percent', { precision: 10, scale: 6 }).notNull(),
  requiredCapital: varchar('required_capital', { length: 78 }).notNull(),
  gasEstimateUsd: decimal('gas_estimate_usd', { precision: 20, scale: 6 }).notNull(),
  netProfitUsd: decimal('net_profit_usd', { precision: 20, scale: 6 }).notNull(),
  executionPath: jsonb('execution_path').notNull().$type<unknown[]>(),
  status: varchar('status', { length: 20 }).default('pending').notNull().$type<
    'pending' | 'executed' | 'expired' | 'failed'
  >(),
  executedAt: timestamp('executed_at'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  statusIdx: index('arbitrage_opportunities_status_idx').on(table.status),
  createdAtIdx: index('arbitrage_opportunities_created_at_idx').on(table.createdAt),
}));

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  delegations: many(delegations),
}));

export const delegationsRelations = relations(delegations, ({ one, many }) => ({
  user: one(users, {
    fields: [delegations.userId],
    references: [users.id],
  }),
  limits: one(sessionLimits, {
    fields: [delegations.id],
    references: [sessionLimits.delegationId],
  }),
  trades: many(trades),
  audits: many(delegationAudits),
}));

export const sessionLimitsRelations = relations(sessionLimits, ({ one }) => ({
  delegation: one(delegations, {
    fields: [sessionLimits.delegationId],
    references: [delegations.id],
  }),
}));

export const tradesRelations = relations(trades, ({ one }) => ({
  delegation: one(delegations, {
    fields: [trades.delegationId],
    references: [delegations.id],
  }),
}));

export const delegationAuditsRelations = relations(delegationAudits, ({ one }) => ({
  delegation: one(delegations, {
    fields: [delegationAudits.delegationId],
    references: [delegations.id],
  }),
}));

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Delegation = typeof delegations.$inferSelect;
export type NewDelegation = typeof delegations.$inferInsert;
export type SessionLimit = typeof sessionLimits.$inferSelect;
export type NewSessionLimit = typeof sessionLimits.$inferInsert;
export type Trade = typeof trades.$inferSelect;
export type NewTrade = typeof trades.$inferInsert;
export type DelegationAudit = typeof delegationAudits.$inferSelect;
export type NewDelegationAudit = typeof delegationAudits.$inferInsert;
export type PriceHistoryRecord = typeof priceHistory.$inferSelect;
export type NewPriceHistoryRecord = typeof priceHistory.$inferInsert;
export type ArbitrageOpportunityRecord = typeof arbitrageOpportunities.$inferSelect;
export type NewArbitrageOpportunityRecord = typeof arbitrageOpportunities.$inferInsert;

// ============================================
// Admin Configuration & Strategy Performance
// ============================================

// Strategies table - configurable trading strategies
export const strategies = pgTable('strategies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  type: varchar('type', { length: 50 }).notNull().$type<
    'cross-exchange' | 'triangular' | 'cross-chain' | 'flash-loan' | 'liquidation'
  >(),
  description: text('description'),
  enabled: boolean('enabled').default(true).notNull(),
  config: jsonb('config').default({}).$type<{
    minProfitUsd?: number;
    maxGasUsd?: number;
    maxSlippageBps?: number;
    allowedDexes?: string[];
    allowedTokens?: string[];
    allowedChains?: string[];
  }>(),
  riskLevel: varchar('risk_level', { length: 20 }).default('medium').notNull().$type<
    'low' | 'medium' | 'high'
  >(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Strategy performance snapshots - daily aggregated metrics
export const strategySnapshots = pgTable('strategy_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  strategyId: uuid('strategy_id').notNull().references(() => strategies.id, { onDelete: 'cascade' }),
  snapshotDate: timestamp('snapshot_date', { withTimezone: true }).notNull(),
  // Trade counts
  tradeCount: decimal('trade_count', { precision: 10, scale: 0 }).default('0').notNull(),
  successfulTrades: decimal('successful_trades', { precision: 10, scale: 0 }).default('0').notNull(),
  failedTrades: decimal('failed_trades', { precision: 10, scale: 0 }).default('0').notNull(),
  // Financial metrics
  grossProfitUsd: decimal('gross_profit_usd', { precision: 20, scale: 6 }).default('0').notNull(),
  gasSpentUsd: decimal('gas_spent_usd', { precision: 20, scale: 6 }).default('0').notNull(),
  netProfitUsd: decimal('net_profit_usd', { precision: 20, scale: 6 }).default('0').notNull(),
  // Volume
  volumeUsd: decimal('volume_usd', { precision: 20, scale: 6 }).default('0').notNull(),
  // Performance metrics
  successRate: decimal('success_rate', { precision: 5, scale: 2 }).default('0').notNull(),
  avgProfitPerTrade: decimal('avg_profit_per_trade', { precision: 20, scale: 6 }).default('0').notNull(),
  avgGasPerTrade: decimal('avg_gas_per_trade', { precision: 20, scale: 6 }).default('0').notNull(),
  // Risk metrics
  maxDrawdownUsd: decimal('max_drawdown_usd', { precision: 20, scale: 6 }).default('0').notNull(),
  maxDrawdownPercent: decimal('max_drawdown_percent', { precision: 10, scale: 4 }).default('0').notNull(),
  // Cumulative values (running totals)
  cumulativeProfitUsd: decimal('cumulative_profit_usd', { precision: 20, scale: 6 }).default('0').notNull(),
  cumulativeVolumeUsd: decimal('cumulative_volume_usd', { precision: 20, scale: 6 }).default('0').notNull(),
  peakValueUsd: decimal('peak_value_usd', { precision: 20, scale: 6 }).default('0').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  strategyDateIdx: index('strategy_snapshots_strategy_date_idx').on(table.strategyId, table.snapshotDate),
  snapshotDateIdx: index('strategy_snapshots_date_idx').on(table.snapshotDate),
}));

// Admin tokens registry - tokens that can be configured via admin UI
export const adminTokens = pgTable('admin_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  address: varchar('address', { length: 42 }).notNull(),
  chainId: varchar('chain_id', { length: 20 }).notNull(),
  symbol: varchar('symbol', { length: 20 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  decimals: decimal('decimals', { precision: 2, scale: 0 }).notNull(),
  logoUrl: text('logo_url'),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  addressChainIdx: index('admin_tokens_address_chain_idx').on(table.address, table.chainId),
  chainIdIdx: index('admin_tokens_chain_id_idx').on(table.chainId),
}));

// Admin protocols registry - DEXes/protocols configurable via admin UI
export const adminProtocols = pgTable('admin_protocols', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  type: varchar('type', { length: 50 }).notNull().$type<
    'dex' | 'lending' | 'aggregator' | 'bridge'
  >(),
  chainId: varchar('chain_id', { length: 20 }).notNull(),
  routerAddress: varchar('router_address', { length: 42 }),
  factoryAddress: varchar('factory_address', { length: 42 }),
  enabled: boolean('enabled').default(true).notNull(),
  config: jsonb('config').default({}).$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  chainIdIdx: index('admin_protocols_chain_id_idx').on(table.chainId),
  nameIdx: index('admin_protocols_name_idx').on(table.name),
}));

// Admin chains registry - supported chains configurable via admin UI
export const adminChains = pgTable('admin_chains', {
  id: varchar('id', { length: 20 }).primaryKey(), // e.g., 'ethereum', 'arbitrum'
  name: varchar('name', { length: 100 }).notNull(),
  chainIdNumeric: decimal('chain_id_numeric', { precision: 10, scale: 0 }).notNull(),
  rpcUrl: text('rpc_url'),
  explorerUrl: text('explorer_url'),
  nativeToken: varchar('native_token', { length: 10 }).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Strategy relations
export const strategiesRelations = relations(strategies, ({ many }) => ({
  snapshots: many(strategySnapshots),
}));

export const strategySnapshotsRelations = relations(strategySnapshots, ({ one }) => ({
  strategy: one(strategies, {
    fields: [strategySnapshots.strategyId],
    references: [strategies.id],
  }),
}));

// Additional type exports
export type Strategy = typeof strategies.$inferSelect;
export type NewStrategy = typeof strategies.$inferInsert;
export type StrategySnapshot = typeof strategySnapshots.$inferSelect;
export type NewStrategySnapshot = typeof strategySnapshots.$inferInsert;
export type AdminToken = typeof adminTokens.$inferSelect;
export type NewAdminToken = typeof adminTokens.$inferInsert;
export type AdminProtocol = typeof adminProtocols.$inferSelect;
export type NewAdminProtocol = typeof adminProtocols.$inferInsert;
export type AdminChain = typeof adminChains.$inferSelect;
export type NewAdminChain = typeof adminChains.$inferInsert;
