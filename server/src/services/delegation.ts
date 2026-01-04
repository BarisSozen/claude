/**
 * Delegation Service
 * Manages session key delegations and limits
 */

import { db, delegations, sessionLimits, delegationAudits } from '../db/index.js';
import { eq, and, gt, lt, or } from 'drizzle-orm';
import type { Address, ChainId } from '../../shared/schema.js';
import type { CreateDelegationInput, UpdateDelegationInput } from '../middleware/validation.js';
import { generateId } from './encryption.js';

export interface DelegationWithLimits {
  id: string;
  userId: string;
  walletAddress: string;
  sessionKeyAddress: string;
  encryptedSessionKey: string;
  chainId: string;
  allowedProtocols: string[];
  allowedTokens: string[];
  status: 'active' | 'paused' | 'revoked' | 'expired';
  validFrom: Date;
  validUntil: Date;
  createdAt: Date;
  limits: {
    maxPerTrade: string;
    maxDailyVolume: string;
    maxWeeklyVolume: string;
    currentDailyVolume: string;
    currentWeeklyVolume: string;
    maxLeverage: string;
    lastResetDaily: Date;
    lastResetWeekly: Date;
  } | null;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  delegation?: DelegationWithLimits;
}

export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  remainingDaily?: string;
  remainingWeekly?: string;
}

class DelegationService {
  /**
   * Create a new delegation with limits
   */
  async create(
    userId: string,
    input: CreateDelegationInput
  ): Promise<DelegationWithLimits> {
    const now = new Date();

    // Create delegation
    const [delegation] = await db
      .insert(delegations)
      .values({
        userId,
        walletAddress: input.walletAddress.toLowerCase(),
        sessionKeyAddress: input.sessionKeyAddress.toLowerCase(),
        encryptedSessionKey: input.encryptedSessionKey,
        chainId: input.chainId,
        allowedProtocols: input.allowedProtocols,
        allowedTokens: input.allowedTokens.map((t) => t.toLowerCase()),
        status: 'active',
        validFrom: now,
        validUntil: new Date(input.validUntil),
      })
      .returning();

    // Create session limits
    const [limits] = await db
      .insert(sessionLimits)
      .values({
        delegationId: delegation.id,
        maxPerTrade: input.limits.maxPerTrade,
        maxDailyVolume: input.limits.maxDailyVolume,
        maxWeeklyVolume: input.limits.maxWeeklyVolume,
        maxLeverage: input.limits.maxLeverage || '1.0',
      })
      .returning();

    // Create audit entry
    await this.createAudit(delegation.id, 'created', 'user', {
      walletAddress: input.walletAddress,
      chainId: input.chainId,
      protocols: input.allowedProtocols,
    });

    return {
      ...delegation,
      limits: {
        maxPerTrade: limits.maxPerTrade,
        maxDailyVolume: limits.maxDailyVolume,
        maxWeeklyVolume: limits.maxWeeklyVolume,
        currentDailyVolume: limits.currentDailyVolume,
        currentWeeklyVolume: limits.currentWeeklyVolume,
        maxLeverage: limits.maxLeverage,
        lastResetDaily: limits.lastResetDaily,
        lastResetWeekly: limits.lastResetWeekly,
      },
    };
  }

  /**
   * Get delegation by ID with limits
   */
  async getById(delegationId: string): Promise<DelegationWithLimits | null> {
    const result = await db.query.delegations.findFirst({
      where: eq(delegations.id, delegationId),
      with: {
        limits: true,
      },
    });

    if (!result) return null;

    return {
      ...result,
      limits: result.limits
        ? {
            maxPerTrade: result.limits.maxPerTrade,
            maxDailyVolume: result.limits.maxDailyVolume,
            maxWeeklyVolume: result.limits.maxWeeklyVolume,
            currentDailyVolume: result.limits.currentDailyVolume,
            currentWeeklyVolume: result.limits.currentWeeklyVolume,
            maxLeverage: result.limits.maxLeverage,
            lastResetDaily: result.limits.lastResetDaily,
            lastResetWeekly: result.limits.lastResetWeekly,
          }
        : null,
    };
  }

  /**
   * Get all delegations for a user
   */
  async getByUserId(userId: string): Promise<DelegationWithLimits[]> {
    const results = await db.query.delegations.findMany({
      where: eq(delegations.userId, userId),
      with: {
        limits: true,
      },
      orderBy: (delegations, { desc }) => [desc(delegations.createdAt)],
    });

    return results.map((r) => ({
      ...r,
      limits: r.limits
        ? {
            maxPerTrade: r.limits.maxPerTrade,
            maxDailyVolume: r.limits.maxDailyVolume,
            maxWeeklyVolume: r.limits.maxWeeklyVolume,
            currentDailyVolume: r.limits.currentDailyVolume,
            currentWeeklyVolume: r.limits.currentWeeklyVolume,
            maxLeverage: r.limits.maxLeverage,
            lastResetDaily: r.limits.lastResetDaily,
            lastResetWeekly: r.limits.lastResetWeekly,
          }
        : null,
    }));
  }

  /**
   * Get active delegations for a wallet
   */
  async getActiveDelegations(walletAddress: Address): Promise<DelegationWithLimits[]> {
    const now = new Date();

    const results = await db.query.delegations.findMany({
      where: and(
        eq(delegations.walletAddress, walletAddress.toLowerCase()),
        eq(delegations.status, 'active'),
        lt(delegations.validFrom, now),
        gt(delegations.validUntil, now)
      ),
      with: {
        limits: true,
      },
    });

    return results.map((r) => ({
      ...r,
      limits: r.limits
        ? {
            maxPerTrade: r.limits.maxPerTrade,
            maxDailyVolume: r.limits.maxDailyVolume,
            maxWeeklyVolume: r.limits.maxWeeklyVolume,
            currentDailyVolume: r.limits.currentDailyVolume,
            currentWeeklyVolume: r.limits.currentWeeklyVolume,
            maxLeverage: r.limits.maxLeverage,
            lastResetDaily: r.limits.lastResetDaily,
            lastResetWeekly: r.limits.lastResetWeekly,
          }
        : null,
    }));
  }

  /**
   * Validate a delegation is active and usable
   */
  async validate(delegationId: string): Promise<ValidationResult> {
    const delegation = await this.getById(delegationId);

    if (!delegation) {
      return { valid: false, reason: 'Delegation not found' };
    }

    if (delegation.status === 'revoked') {
      return { valid: false, reason: 'Delegation has been revoked' };
    }

    if (delegation.status === 'paused') {
      return { valid: false, reason: 'Delegation is paused' };
    }

    if (delegation.status === 'expired') {
      return { valid: false, reason: 'Delegation has expired' };
    }

    const now = new Date();

    if (delegation.validFrom > now) {
      return { valid: false, reason: 'Delegation not yet valid' };
    }

    if (delegation.validUntil < now) {
      // Update status to expired
      await this.updateStatus(delegationId, 'expired', 'system');
      return { valid: false, reason: 'Delegation has expired' };
    }

    return { valid: true, delegation };
  }

  /**
   * Check if a trade is within limits
   */
  async checkTradeLimits(
    delegationId: string,
    tradeAmountUsd: number
  ): Promise<LimitCheckResult> {
    const delegation = await this.getById(delegationId);

    if (!delegation || !delegation.limits) {
      return { allowed: false, reason: 'Delegation or limits not found' };
    }

    const limits = delegation.limits;

    // Reset daily/weekly volumes if needed
    await this.resetLimitsIfNeeded(delegationId, limits);

    // Re-fetch after potential reset
    const updatedDelegation = await this.getById(delegationId);
    if (!updatedDelegation || !updatedDelegation.limits) {
      return { allowed: false, reason: 'Failed to refresh limits' };
    }

    const currentLimits = updatedDelegation.limits;

    // Check per-trade limit
    const maxPerTrade = parseFloat(currentLimits.maxPerTrade);
    if (tradeAmountUsd > maxPerTrade) {
      return {
        allowed: false,
        reason: `Trade amount $${tradeAmountUsd.toFixed(2)} exceeds max per trade $${maxPerTrade.toFixed(2)}`,
      };
    }

    // Check daily limit
    const currentDaily = parseFloat(currentLimits.currentDailyVolume);
    const maxDaily = parseFloat(currentLimits.maxDailyVolume);
    const newDaily = currentDaily + tradeAmountUsd;

    if (newDaily > maxDaily) {
      return {
        allowed: false,
        reason: `Trade would exceed daily limit ($${newDaily.toFixed(2)} > $${maxDaily.toFixed(2)})`,
        remainingDaily: (maxDaily - currentDaily).toString(),
      };
    }

    // Check weekly limit
    const currentWeekly = parseFloat(currentLimits.currentWeeklyVolume);
    const maxWeekly = parseFloat(currentLimits.maxWeeklyVolume);
    const newWeekly = currentWeekly + tradeAmountUsd;

    if (newWeekly > maxWeekly) {
      return {
        allowed: false,
        reason: `Trade would exceed weekly limit ($${newWeekly.toFixed(2)} > $${maxWeekly.toFixed(2)})`,
        remainingWeekly: (maxWeekly - currentWeekly).toString(),
      };
    }

    return {
      allowed: true,
      remainingDaily: (maxDaily - newDaily).toString(),
      remainingWeekly: (maxWeekly - newWeekly).toString(),
    };
  }

  /**
   * Update limits after a successful trade
   */
  async updateLimitsAfterTrade(
    delegationId: string,
    tradeAmountUsd: number
  ): Promise<void> {
    const delegation = await this.getById(delegationId);
    if (!delegation || !delegation.limits) return;

    const currentDaily = parseFloat(delegation.limits.currentDailyVolume);
    const currentWeekly = parseFloat(delegation.limits.currentWeeklyVolume);

    await db
      .update(sessionLimits)
      .set({
        currentDailyVolume: (currentDaily + tradeAmountUsd).toString(),
        currentWeeklyVolume: (currentWeekly + tradeAmountUsd).toString(),
      })
      .where(eq(sessionLimits.delegationId, delegationId));
  }

  /**
   * Reset daily/weekly limits if time has passed
   */
  private async resetLimitsIfNeeded(
    delegationId: string,
    limits: DelegationWithLimits['limits']
  ): Promise<void> {
    if (!limits) return;

    const now = new Date();
    const updates: Partial<typeof sessionLimits.$inferInsert> = {};

    // Check daily reset (24 hours)
    const dailyResetTime = new Date(limits.lastResetDaily);
    dailyResetTime.setHours(dailyResetTime.getHours() + 24);

    if (now > dailyResetTime) {
      updates.currentDailyVolume = '0';
      updates.lastResetDaily = now;
    }

    // Check weekly reset (7 days)
    const weeklyResetTime = new Date(limits.lastResetWeekly);
    weeklyResetTime.setDate(weeklyResetTime.getDate() + 7);

    if (now > weeklyResetTime) {
      updates.currentWeeklyVolume = '0';
      updates.lastResetWeekly = now;
    }

    if (Object.keys(updates).length > 0) {
      await db
        .update(sessionLimits)
        .set(updates)
        .where(eq(sessionLimits.delegationId, delegationId));
    }
  }

  /**
   * Update delegation status
   */
  async updateStatus(
    delegationId: string,
    status: 'active' | 'paused' | 'revoked' | 'expired',
    triggeredBy: 'user' | 'system' | 'admin'
  ): Promise<void> {
    await db
      .update(delegations)
      .set({ status })
      .where(eq(delegations.id, delegationId));

    await this.createAudit(delegationId, `status_changed_to_${status}`, triggeredBy, {});
  }

  /**
   * Update delegation settings
   */
  async update(
    delegationId: string,
    userId: string,
    input: UpdateDelegationInput
  ): Promise<DelegationWithLimits | null> {
    // Verify ownership
    const delegation = await this.getById(delegationId);
    if (!delegation || delegation.userId !== userId) {
      return null;
    }

    // Update delegation fields
    const delegationUpdates: Partial<typeof delegations.$inferInsert> = {};

    if (input.status) {
      delegationUpdates.status = input.status;
    }
    if (input.allowedProtocols) {
      delegationUpdates.allowedProtocols = input.allowedProtocols;
    }
    if (input.allowedTokens) {
      delegationUpdates.allowedTokens = input.allowedTokens.map((t) => t.toLowerCase());
    }
    if (input.validUntil) {
      delegationUpdates.validUntil = new Date(input.validUntil);
    }

    if (Object.keys(delegationUpdates).length > 0) {
      await db
        .update(delegations)
        .set(delegationUpdates)
        .where(eq(delegations.id, delegationId));
    }

    // Update limits if provided
    if (input.limits) {
      const limitsUpdates: Partial<typeof sessionLimits.$inferInsert> = {};

      if (input.limits.maxPerTrade) {
        limitsUpdates.maxPerTrade = input.limits.maxPerTrade;
      }
      if (input.limits.maxDailyVolume) {
        limitsUpdates.maxDailyVolume = input.limits.maxDailyVolume;
      }
      if (input.limits.maxWeeklyVolume) {
        limitsUpdates.maxWeeklyVolume = input.limits.maxWeeklyVolume;
      }
      if (input.limits.maxLeverage) {
        limitsUpdates.maxLeverage = input.limits.maxLeverage;
      }

      if (Object.keys(limitsUpdates).length > 0) {
        await db
          .update(sessionLimits)
          .set(limitsUpdates)
          .where(eq(sessionLimits.delegationId, delegationId));
      }
    }

    await this.createAudit(delegationId, 'updated', 'user', { changes: input });

    return this.getById(delegationId);
  }

  /**
   * Revoke a delegation
   */
  async revoke(
    delegationId: string,
    userId: string,
    reason: string
  ): Promise<boolean> {
    // Verify ownership
    const delegation = await this.getById(delegationId);
    if (!delegation || delegation.userId !== userId) {
      return false;
    }

    await this.updateStatus(delegationId, 'revoked', 'user');
    await this.createAudit(delegationId, 'revoked', 'user', { reason });

    return true;
  }

  /**
   * Revoke all delegations for a wallet (emergency)
   */
  async revokeAllForWallet(walletAddress: Address): Promise<number> {
    const result = await db
      .update(delegations)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(delegations.walletAddress, walletAddress.toLowerCase()),
          or(eq(delegations.status, 'active'), eq(delegations.status, 'paused'))
        )
      )
      .returning();

    for (const d of result) {
      await this.createAudit(d.id, 'emergency_revoked', 'system', {
        walletAddress,
      });
    }

    return result.length;
  }

  /**
   * Check if a protocol is allowed for a delegation
   */
  isProtocolAllowed(delegation: DelegationWithLimits, protocol: string): boolean {
    return delegation.allowedProtocols.includes(protocol.toLowerCase());
  }

  /**
   * Check if a token is allowed for a delegation
   */
  isTokenAllowed(delegation: DelegationWithLimits, tokenAddress: Address): boolean {
    return delegation.allowedTokens.includes(tokenAddress.toLowerCase());
  }

  /**
   * Create audit entry
   */
  private async createAudit(
    delegationId: string,
    action: string,
    triggeredBy: 'user' | 'system' | 'admin',
    metadata: Record<string, unknown>
  ): Promise<void> {
    await db.insert(delegationAudits).values({
      delegationId,
      action,
      triggeredBy,
      metadata,
    });
  }

  /**
   * Get audit history for a delegation
   */
  async getAuditHistory(delegationId: string): Promise<typeof delegationAudits.$inferSelect[]> {
    return db
      .select()
      .from(delegationAudits)
      .where(eq(delegationAudits.delegationId, delegationId))
      .orderBy(delegationAudits.createdAt);
  }
}

export const delegationService = new DelegationService();
