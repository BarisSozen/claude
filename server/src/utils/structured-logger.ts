/**
 * Structured Logger with Correlation ID Support
 *
 * Security features:
 * - Correlation ID validation and sanitization
 * - Sensitive data redaction
 * - Audit trail fields (user_id, action_outcome)
 * - Circular reference handling
 * - Crypto-secure ID generation
 */

import crypto from 'crypto';

// Correlation ID prefixes for different operation types
export type CorrelationPrefix = 'liq' | 'arb' | 'quo' | 'op' | 'auth' | 'api' | 'ws';

// Log levels
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

// Operation context with audit fields
export interface OperationContext {
  correlation_id: string;
  started_at: Date;
  user_id?: string;
  action?: string;
}

// Structured log entry with audit fields
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  correlation_id: string;
  service: string;
  component?: string;
  event_type: string;
  message: string;
  user_id?: string;
  action_outcome?: 'success' | 'failure' | 'pending';
  context: Record<string, unknown>;
}

// Patterns for sensitive data that should be redacted
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /password["']?\s*[:=]\s*["']?[^"'\s,}]+/gi, replacement: 'password: "[REDACTED]"' },
  { pattern: /secret["']?\s*[:=]\s*["']?[^"'\s,}]+/gi, replacement: 'secret: "[REDACTED]"' },
  { pattern: /api[_-]?key["']?\s*[:=]\s*["']?[^"'\s,}]+/gi, replacement: 'api_key: "[REDACTED]"' },
  { pattern: /private[_-]?key["']?\s*[:=]\s*["']?[^"'\s,}]+/gi, replacement: 'private_key: "[REDACTED]"' },
  { pattern: /bearer\s+[a-zA-Z0-9._-]+/gi, replacement: 'Bearer [REDACTED]' },
  { pattern: /0x[a-fA-F0-9]{64}/g, replacement: '[PRIVATE_KEY_REDACTED]' }, // Private keys
  { pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g, replacement: '[JWT_REDACTED]' },
];

// Fields that should always be redacted
const SENSITIVE_FIELDS = new Set([
  'password',
  'secret',
  'apiKey',
  'api_key',
  'privateKey',
  'private_key',
  'encryptedKey',
  'encrypted_key',
  'sessionKey',
  'session_key',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'authorization',
  'cookie',
  'ssn',
  'creditCard',
  'credit_card',
]);

// Correlation ID validation pattern
const CORRELATION_ID_PATTERN = /^[a-z]{2,4}_[a-f0-9]{8}_[a-f0-9]{4}$/;
const MAX_CORRELATION_ID_LENGTH = 24;

export const CORRELATION_HEADER = 'X-Correlation-ID';

/**
 * Validate and sanitize a correlation ID from external sources
 */
export function validateCorrelationId(id: string | undefined): string | undefined {
  if (!id) return undefined;

  // Length check
  if (id.length > MAX_CORRELATION_ID_LENGTH) {
    return undefined;
  }

  // Pattern validation
  if (!CORRELATION_ID_PATTERN.test(id)) {
    return undefined;
  }

  return id;
}

/**
 * Extract correlation ID from HTTP headers with validation
 */
export function getCorrelationId(
  headers: Record<string, string | string[] | undefined>
): string | undefined {
  // Case-insensitive header lookup
  const key = Object.keys(headers).find(
    k => k.toLowerCase() === CORRELATION_HEADER.toLowerCase()
  );

  if (!key) return undefined;

  const value = headers[key];
  const rawId = Array.isArray(value) ? value[0] : value;

  // Validate and sanitize external input
  return validateCorrelationId(rawId);
}

/**
 * Create headers object with correlation ID for outgoing requests
 */
export function withCorrelationId(
  ctx: OperationContext,
  existingHeaders: Record<string, string> = {}
): Record<string, string> {
  if (!ctx.correlation_id) {
    return existingHeaders;
  }

  return {
    ...existingHeaders,
    [CORRELATION_HEADER]: ctx.correlation_id,
  };
}

export class StructuredLogger {
  private service: string;
  private component?: string;
  private minLevel: LogLevel;
  private output: (message: string) => void;

  constructor(options: {
    service: string;
    component?: string;
    minLevel?: LogLevel;
    output?: (message: string) => void;
  }) {
    this.service = options.service;
    this.component = options.component;
    this.minLevel = options.minLevel || 'INFO';
    this.output = options.output || console.log;
  }

  /**
   * Generate a cryptographically secure correlation ID
   */
  static generateCorrelationId(prefix: CorrelationPrefix): string {
    const timestampHex = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
    const random = crypto.randomBytes(2).toString('hex');
    return `${prefix}_${timestampHex}_${random}`;
  }

  /**
   * Start a new operation with correlation ID
   */
  startOperation(prefix: CorrelationPrefix, userId?: string, action?: string): OperationContext {
    return {
      correlation_id: StructuredLogger.generateCorrelationId(prefix),
      started_at: new Date(),
      user_id: userId,
      action,
    };
  }

  /**
   * Create context from an existing correlation ID with validation
   */
  fromCorrelationId(correlationId?: string, userId?: string): OperationContext {
    const validId = validateCorrelationId(correlationId);

    return {
      correlation_id: validId || StructuredLogger.generateCorrelationId('op'),
      started_at: new Date(),
      user_id: userId,
    };
  }

  /**
   * Redact sensitive data from an object
   */
  private redactSensitive(obj: Record<string, unknown>): Record<string, unknown> {
    const redacted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      // Check if field name is sensitive
      if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
        redacted[key] = '[REDACTED]';
        continue;
      }

      // Recursively redact nested objects
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        redacted[key] = this.redactSensitive(value as Record<string, unknown>);
        continue;
      }

      // Check string values for sensitive patterns
      if (typeof value === 'string') {
        let sanitized = value;
        for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
          sanitized = sanitized.replace(pattern, replacement);
        }
        redacted[key] = sanitized;
        continue;
      }

      redacted[key] = value;
    }

    return redacted;
  }

  /**
   * Safely stringify with circular reference handling
   */
  private safeStringify(entry: LogEntry): string {
    const seen = new WeakSet();

    try {
      return JSON.stringify(entry, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }
        // Handle BigInt
        if (typeof value === 'bigint') {
          return value.toString();
        }
        return value;
      });
    } catch (error) {
      // Ultimate fallback
      return JSON.stringify({
        ...entry,
        context: { error: 'Failed to stringify context' },
      });
    }
  }

  /**
   * Check if log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  /**
   * Internal log method
   */
  private log(
    level: LogLevel,
    ctx: OperationContext,
    eventType: string,
    message: string,
    context: Record<string, unknown> = {},
    outcome?: 'success' | 'failure' | 'pending'
  ): void {
    if (!this.shouldLog(level)) return;

    // Redact sensitive data from context
    const redactedContext = this.redactSensitive(context);

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      correlation_id: ctx.correlation_id,
      service: this.service,
      ...(this.component && { component: this.component }),
      event_type: eventType,
      message,
      ...(ctx.user_id && { user_id: ctx.user_id }),
      ...(outcome && { action_outcome: outcome }),
      context: redactedContext,
    };

    this.output(this.safeStringify(entry));
  }

  debug(ctx: OperationContext, eventType: string, message: string, context?: Record<string, unknown>): void {
    this.log('DEBUG', ctx, eventType, message, context);
  }

  info(ctx: OperationContext, eventType: string, message: string, context?: Record<string, unknown>): void {
    this.log('INFO', ctx, eventType, message, context);
  }

  warn(ctx: OperationContext, eventType: string, message: string, context?: Record<string, unknown>): void {
    this.log('WARN', ctx, eventType, message, context);
  }

  error(ctx: OperationContext, eventType: string, message: string, context?: Record<string, unknown>): void {
    this.log('ERROR', ctx, eventType, message, context, 'failure');
  }

  /**
   * Log with explicit outcome for audit trail
   */
  audit(
    ctx: OperationContext,
    eventType: string,
    message: string,
    outcome: 'success' | 'failure',
    context?: Record<string, unknown>
  ): void {
    this.log('INFO', ctx, eventType, message, context, outcome);
  }

  /**
   * Create a child logger for a specific component
   */
  child(component: string): StructuredLogger {
    return new StructuredLogger({
      service: this.service,
      component,
      minLevel: this.minLevel,
      output: this.output,
    });
  }
}

// Default logger instance
export const logger = new StructuredLogger({
  service: 'defi-bot',
  minLevel: process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG',
});
