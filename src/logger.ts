import {
  LogLevel,
  CorrelationPrefix,
  OperationContext,
  LogEntry,
  LoggerOptions,
} from './types';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/**
 * Structured error logger for multi-service trading infrastructure.
 * Outputs JSON Lines format with correlation ID tracking.
 */
export class Logger {
  private readonly service: string;
  private readonly component?: string;
  private readonly minLevel: LogLevel;
  private readonly output: (line: string) => void;

  constructor(service: string, component?: string, options: LoggerOptions = {}) {
    this.service = service;
    this.component = component;
    this.minLevel = options.minLevel ?? 'DEBUG';
    this.output = options.output ?? console.log;
  }

  /**
   * Generate a correlation ID with the specified prefix.
   * Format: {prefix}_{timestamp_hex}_{random}
   */
  static generateCorrelationId(prefix: CorrelationPrefix): string {
    const timestampHex = Math.floor(Date.now() / 1000).toString(16);
    const random = Math.random().toString(36).substring(2, 6);
    return `${prefix}_${timestampHex}_${random}`;
  }

  /**
   * Start a new operation with a generated correlation ID.
   * Use the returned context for all related log calls.
   */
  startOperation(prefix: CorrelationPrefix): OperationContext {
    return {
      correlation_id: Logger.generateCorrelationId(prefix),
      started_at: new Date(),
    };
  }

  /**
   * Create a context from an existing correlation ID (e.g., from HTTP header).
   */
  fromCorrelationId(correlationId: string): OperationContext {
    return {
      correlation_id: correlationId,
      started_at: new Date(),
    };
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  private log(
    level: LogLevel,
    ctx: OperationContext,
    eventType: string,
    message: string,
    context: Record<string, unknown> = {}
  ): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      correlation_id: ctx.correlation_id,
      service: this.service,
      ...(this.component && { component: this.component }),
      event_type: eventType,
      message,
      context,
    };

    this.output(JSON.stringify(entry));
  }

  /** Log at DEBUG level */
  debug(
    ctx: OperationContext,
    eventType: string,
    message: string,
    context?: Record<string, unknown>
  ): void {
    this.log('DEBUG', ctx, eventType, message, context);
  }

  /** Log at INFO level */
  info(
    ctx: OperationContext,
    eventType: string,
    message: string,
    context?: Record<string, unknown>
  ): void {
    this.log('INFO', ctx, eventType, message, context);
  }

  /** Log at WARN level */
  warn(
    ctx: OperationContext,
    eventType: string,
    message: string,
    context?: Record<string, unknown>
  ): void {
    this.log('WARN', ctx, eventType, message, context);
  }

  /** Log at ERROR level */
  error(
    ctx: OperationContext,
    eventType: string,
    message: string,
    context?: Record<string, unknown>
  ): void {
    this.log('ERROR', ctx, eventType, message, context);
  }

  /**
   * Log operation completion with duration.
   */
  complete(
    ctx: OperationContext,
    eventType: string,
    message: string,
    context?: Record<string, unknown>
  ): void {
    const durationMs = Date.now() - ctx.started_at.getTime();
    this.log('INFO', ctx, eventType, message, {
      ...context,
      duration_ms: durationMs,
    });
  }
}
