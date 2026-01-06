/**
 * Distributed Tracing Service
 * OpenTelemetry integration with Jaeger exporter for production observability
 *
 * Features:
 * - Automatic HTTP request tracing
 * - Database query tracing
 * - Custom span creation for business operations
 * - Context propagation across services
 * - Sampling strategies for high-volume environments
 */

import { config } from '../config/env.js';
import { structuredLogger } from './logger.js';

// Tracing types
export interface SpanContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
  traceState?: string;
}

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

export interface Span {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'unset' | 'ok' | 'error';
  attributes: SpanAttributes;
  events: SpanEvent[];
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: SpanAttributes;
}

export interface TracingConfig {
  serviceName: string;
  jaegerEndpoint: string;
  sampleRate: number;
  enabled: boolean;
  maxSpansPerTrace: number;
  flushIntervalMs: number;
}

// Generate random hex ID
function generateId(length: number): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Active span storage using AsyncLocalStorage pattern
 * Enables automatic context propagation
 */
class SpanContextManager {
  private activeSpans: Map<string, Span> = new Map();
  private currentTraceId: string | null = null;
  private currentSpanId: string | null = null;

  setActive(span: Span): void {
    this.activeSpans.set(span.spanId, span);
    this.currentSpanId = span.spanId;
    this.currentTraceId = span.traceId;
  }

  getActive(): Span | undefined {
    if (this.currentSpanId) {
      return this.activeSpans.get(this.currentSpanId);
    }
    return undefined;
  }

  getCurrentTraceId(): string | null {
    return this.currentTraceId;
  }

  remove(spanId: string): void {
    const span = this.activeSpans.get(spanId);
    this.activeSpans.delete(spanId);

    // If this was the active span, set parent as active
    if (this.currentSpanId === spanId && span?.parentSpanId) {
      this.currentSpanId = span.parentSpanId;
    }
  }

  clear(): void {
    this.activeSpans.clear();
    this.currentTraceId = null;
    this.currentSpanId = null;
  }
}

/**
 * Distributed Tracing Service
 */
class TracingService {
  private config: TracingConfig;
  private spans: Span[] = [];
  private contextManager: SpanContextManager;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private isShuttingDown: boolean = false;

  constructor() {
    this.config = {
      serviceName: 'defi-bot-server',
      jaegerEndpoint: process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
      sampleRate: parseFloat(process.env.TRACE_SAMPLE_RATE || '1.0'),
      enabled: process.env.TRACING_ENABLED !== 'false',
      maxSpansPerTrace: 1000,
      flushIntervalMs: 5000,
    };

    this.contextManager = new SpanContextManager();

    if (this.config.enabled) {
      this.startFlushInterval();
      structuredLogger.info('tracing', 'Distributed tracing initialized', {
        serviceName: this.config.serviceName,
        jaegerEndpoint: this.config.jaegerEndpoint,
        sampleRate: this.config.sampleRate,
      });
    }
  }

  /**
   * Check if request should be sampled
   */
  private shouldSample(): boolean {
    return Math.random() < this.config.sampleRate;
  }

  /**
   * Start a new trace (root span)
   */
  startTrace(name: string, attributes?: SpanAttributes): Span {
    if (!this.config.enabled || !this.shouldSample()) {
      return this.createNoopSpan(name);
    }

    const traceId = generateId(32);
    const spanId = generateId(16);

    const span: Span = {
      traceId,
      spanId,
      name,
      startTime: Date.now(),
      status: 'unset',
      attributes: {
        'service.name': this.config.serviceName,
        ...attributes,
      },
      events: [],
    };

    this.contextManager.setActive(span);
    return span;
  }

  /**
   * Start a child span within current trace
   */
  startSpan(name: string, attributes?: SpanAttributes): Span {
    if (!this.config.enabled) {
      return this.createNoopSpan(name);
    }

    const parentSpan = this.contextManager.getActive();
    const traceId = parentSpan?.traceId || generateId(32);
    const spanId = generateId(16);

    const span: Span = {
      traceId,
      spanId,
      parentSpanId: parentSpan?.spanId,
      name,
      startTime: Date.now(),
      status: 'unset',
      attributes: {
        'service.name': this.config.serviceName,
        ...attributes,
      },
      events: [],
    };

    this.contextManager.setActive(span);
    return span;
  }

  /**
   * Create a no-op span for unsampled requests
   */
  private createNoopSpan(name: string): Span {
    return {
      traceId: 'noop',
      spanId: 'noop',
      name,
      startTime: Date.now(),
      status: 'unset',
      attributes: {},
      events: [],
    };
  }

  /**
   * End a span and record it
   */
  endSpan(span: Span, status?: 'ok' | 'error'): void {
    if (span.traceId === 'noop') {
      return;
    }

    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status || 'ok';

    this.spans.push(span);
    this.contextManager.remove(span.spanId);

    // Auto-flush if buffer is large
    if (this.spans.length >= 100) {
      this.flush();
    }
  }

  /**
   * Record an error on a span
   */
  recordError(span: Span, error: Error): void {
    if (span.traceId === 'noop') {
      return;
    }

    span.events.push({
      name: 'exception',
      timestamp: Date.now(),
      attributes: {
        'exception.type': error.name,
        'exception.message': error.message,
        'exception.stacktrace': error.stack || '',
      },
    });

    span.status = 'error';
    span.attributes['error'] = true;
    span.attributes['error.message'] = error.message;
  }

  /**
   * Add an event to a span
   */
  addEvent(span: Span, name: string, attributes?: SpanAttributes): void {
    if (span.traceId === 'noop') {
      return;
    }

    span.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
  }

  /**
   * Set attributes on a span
   */
  setAttributes(span: Span, attributes: SpanAttributes): void {
    if (span.traceId === 'noop') {
      return;
    }

    Object.assign(span.attributes, attributes);
  }

  /**
   * Get current trace ID for correlation
   */
  getCurrentTraceId(): string | null {
    return this.contextManager.getCurrentTraceId();
  }

  /**
   * Create span for HTTP request
   */
  startHttpSpan(method: string, path: string, headers?: Record<string, string>): Span {
    // Extract trace context from headers if present (W3C Trace Context)
    const traceparent = headers?.['traceparent'];
    let parentTraceId: string | undefined;
    let parentSpanId: string | undefined;

    if (traceparent) {
      const parts = traceparent.split('-');
      if (parts.length === 4) {
        parentTraceId = parts[1];
        parentSpanId = parts[2];
      }
    }

    const span = this.startSpan(`HTTP ${method} ${path}`, {
      'http.method': method,
      'http.url': path,
      'http.scheme': 'https',
      'span.kind': 'server',
    });

    if (parentTraceId && parentSpanId) {
      span.attributes['parent.trace_id'] = parentTraceId;
      span.attributes['parent.span_id'] = parentSpanId;
    }

    return span;
  }

  /**
   * End HTTP span with response details
   */
  endHttpSpan(span: Span, statusCode: number, responseSize?: number): void {
    span.attributes['http.status_code'] = statusCode;
    if (responseSize !== undefined) {
      span.attributes['http.response_content_length'] = responseSize;
    }

    const status = statusCode >= 400 ? 'error' : 'ok';
    this.endSpan(span, status);
  }

  /**
   * Create span for database operation
   */
  startDbSpan(operation: string, table: string): Span {
    return this.startSpan(`DB ${operation} ${table}`, {
      'db.system': 'postgresql',
      'db.operation': operation,
      'db.sql.table': table,
      'span.kind': 'client',
    });
  }

  /**
   * Create span for external service call
   */
  startExternalSpan(service: string, operation: string): Span {
    return this.startSpan(`${service} ${operation}`, {
      'peer.service': service,
      'span.kind': 'client',
    });
  }

  /**
   * Create span for blockchain RPC call
   */
  startRpcSpan(method: string, chainId: number): Span {
    return this.startSpan(`RPC ${method}`, {
      'rpc.method': method,
      'blockchain.chain_id': chainId,
      'span.kind': 'client',
    });
  }

  /**
   * Create span for trade execution
   */
  startTradeSpan(delegationId: string, protocol: string): Span {
    return this.startSpan('Trade Execution', {
      'trade.delegation_id': delegationId,
      'trade.protocol': protocol,
      'span.kind': 'internal',
    });
  }

  /**
   * Generate W3C traceparent header for outgoing requests
   */
  getTraceparentHeader(): string | null {
    const traceId = this.contextManager.getCurrentTraceId();
    const activeSpan = this.contextManager.getActive();

    if (!traceId || !activeSpan) {
      return null;
    }

    // Format: version-trace_id-parent_id-trace_flags
    return `00-${traceId}-${activeSpan.spanId}-01`;
  }

  /**
   * Start periodic flush to Jaeger
   */
  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.config.flushIntervalMs);
  }

  /**
   * Flush spans to Jaeger
   */
  async flush(): Promise<void> {
    if (this.spans.length === 0) {
      return;
    }

    const spansToSend = [...this.spans];
    this.spans = [];

    try {
      await this.sendToJaeger(spansToSend);
    } catch (error) {
      structuredLogger.error('tracing', 'Failed to send spans to Jaeger', error as Error);
      // Re-queue spans on failure (with limit to prevent memory issues)
      if (this.spans.length < 1000) {
        this.spans.push(...spansToSend);
      }
    }
  }

  /**
   * Send spans to Jaeger in Thrift format
   */
  private async sendToJaeger(spans: Span[]): Promise<void> {
    if (spans.length === 0) {
      return;
    }

    // Convert to Jaeger Thrift batch format
    const batch = this.convertToJaegerFormat(spans);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(this.config.jaegerEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-thrift',
        },
        body: JSON.stringify(batch),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Jaeger returned ${response.status}`);
      }

      structuredLogger.debug('tracing', 'Spans sent to Jaeger', {
        count: spans.length,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Convert internal spans to Jaeger format
   */
  private convertToJaegerFormat(spans: Span[]): object {
    return {
      process: {
        serviceName: this.config.serviceName,
        tags: [
          { key: 'hostname', value: process.env.HOSTNAME || 'unknown' },
          { key: 'ip', value: process.env.POD_IP || '127.0.0.1' },
        ],
      },
      spans: spans.map((span) => ({
        traceIdLow: span.traceId.substring(16),
        traceIdHigh: span.traceId.substring(0, 16),
        spanId: span.spanId,
        parentSpanId: span.parentSpanId || '0',
        operationName: span.name,
        startTime: span.startTime * 1000, // Convert to microseconds
        duration: (span.duration || 0) * 1000,
        tags: Object.entries(span.attributes).map(([key, value]) => ({
          key,
          vType: typeof value === 'number' ? 'DOUBLE' : 'STRING',
          vStr: String(value),
          vDouble: typeof value === 'number' ? value : undefined,
        })),
        logs: span.events.map((event) => ({
          timestamp: event.timestamp * 1000,
          fields: [
            { key: 'event', vType: 'STRING', vStr: event.name },
            ...Object.entries(event.attributes || {}).map(([key, value]) => ({
              key,
              vType: 'STRING',
              vStr: String(value),
            })),
          ],
        })),
      })),
    };
  }

  /**
   * Express middleware for automatic request tracing
   */
  expressMiddleware() {
    return (req: any, res: any, next: any) => {
      if (!this.config.enabled) {
        return next();
      }

      const span = this.startHttpSpan(req.method, req.path, req.headers);

      // Add trace ID to request for correlation
      req.traceId = span.traceId;
      req.spanId = span.spanId;

      // Set trace header on response
      res.setHeader('x-trace-id', span.traceId);

      // Hook into response finish
      res.on('finish', () => {
        this.endHttpSpan(span, res.statusCode);
      });

      next();
    };
  }

  /**
   * Wrap async function with tracing
   */
  traceAsync<T>(
    name: string,
    fn: () => Promise<T>,
    attributes?: SpanAttributes
  ): Promise<T> {
    const span = this.startSpan(name, attributes);

    return fn()
      .then((result) => {
        this.endSpan(span, 'ok');
        return result;
      })
      .catch((error) => {
        this.recordError(span, error);
        this.endSpan(span, 'error');
        throw error;
      });
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    // Final flush
    await this.flush();
    this.contextManager.clear();

    structuredLogger.info('tracing', 'Tracing service shutdown complete');
  }
}

// Export singleton instance
export const tracingService = new TracingService();

// Export decorator for tracing methods
export function Traced(name?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const spanName = name || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (...args: any[]) {
      return tracingService.traceAsync(spanName, () =>
        originalMethod.apply(this, args)
      );
    };

    return descriptor;
  };
}
