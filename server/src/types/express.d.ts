/**
 * Express Request Type Extensions
 * Extends Express Request to include custom properties
 */

declare global {
  namespace Express {
    interface Request {
      /**
       * Correlation ID for request tracing
       * Added by middleware in index.ts
       */
      correlationId: string;

      /**
       * Authenticated user ID from session
       * Added by auth middleware
       */
      userId?: string;

      /**
       * Authenticated wallet address from session
       * Added by auth middleware
       */
      walletAddress?: string;
    }
  }
}

export {};
