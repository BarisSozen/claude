/** Log severity levels */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/** Correlation ID prefixes for different operation types */
export type CorrelationPrefix = 'liq' | 'arb' | 'quo';

/** Context object for tracking operations across services */
export interface OperationContext {
  correlation_id: string;
  started_at: Date;
}

/** Structured log entry in JSON Lines format */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  correlation_id: string;
  service: string;
  component?: string;
  event_type: string;
  message: string;
  context: Record<string, unknown>;
}

/** Configuration options for Logger */
export interface LoggerOptions {
  /** Minimum log level to output (default: 'DEBUG') */
  minLevel?: LogLevel;
  /** Custom output function (default: console.log) */
  output?: (line: string) => void;
}
