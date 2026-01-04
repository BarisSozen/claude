import { OperationContext } from './types';

/** HTTP header name for correlation ID propagation */
export const CORRELATION_HEADER = 'X-Correlation-ID';

/**
 * Extract correlation ID from HTTP headers.
 * Returns undefined if not present.
 */
export function getCorrelationId(
  headers: Record<string, string | string[] | undefined>
): string | undefined {
  const value = headers[CORRELATION_HEADER] ?? headers[CORRELATION_HEADER.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Create headers object with correlation ID for outgoing requests.
 */
export function withCorrelationId(
  ctx: OperationContext,
  existingHeaders: Record<string, string> = {}
): Record<string, string> {
  return {
    ...existingHeaders,
    [CORRELATION_HEADER]: ctx.correlation_id,
  };
}

/**
 * Express/Connect-style middleware for correlation ID extraction.
 * Attaches correlation_id to request object.
 */
export function correlationMiddleware() {
  return (
    req: { headers: Record<string, string | string[] | undefined>; correlation_id?: string },
    _res: unknown,
    next: () => void
  ) => {
    req.correlation_id = getCorrelationId(req.headers);
    next();
  };
}
