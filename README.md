# error-logger

Structured error logging for multi-service trading infrastructure. Outputs JSON Lines format with correlation ID tracking for distributed tracing.

## Installation

```bash
npm install
npm run build
```

## Usage

```typescript
import { Logger, withCorrelationId } from 'error-logger';

// Create a logger for your service
const log = new Logger('rust-hotpath', 'liquidation');

// Start a new operation (generates correlation ID)
const ctx = log.startOperation('liq');

// Log events with context
log.info(ctx, 'LIQ_START', 'Starting liquidation', { position_id: 'pos_123' });
log.error(ctx, 'TX_REVERT', 'Liquidation reverted', { tx_hash: '0xabc', gas_used: 50000 });

// Track operation completion with duration
log.complete(ctx, 'LIQ_COMPLETE', 'Liquidation finished');
```

## Log Format (JSON Lines)

```json
{
  "timestamp": "2024-01-15T14:32:01.847Z",
  "level": "ERROR",
  "correlation_id": "liq_18d4f2a1_x7k9",
  "service": "rust-hotpath",
  "component": "liquidation",
  "event_type": "TX_REVERT",
  "message": "Liquidation reverted",
  "context": { "tx_hash": "0xabc", "gas_used": 50000 }
}
```

## Correlation ID Format

```
{prefix}_{timestamp_hex}_{random}
```

Prefixes:
- `liq_` - Liquidation operations
- `arb_` - Arbitrage operations
- `quo_` - Quote operations

## HTTP Propagation

```typescript
import { withCorrelationId, getCorrelationId, CORRELATION_HEADER } from 'error-logger';

// Outgoing request - add correlation ID header
const headers = withCorrelationId(ctx, { 'Content-Type': 'application/json' });
// Result: { 'X-Correlation-ID': 'liq_18d4f2a1_x7k9', 'Content-Type': 'application/json' }

// Incoming request - extract correlation ID
const correlationId = getCorrelationId(req.headers);
const ctx = log.fromCorrelationId(correlationId);
```

## Configuration

```typescript
const log = new Logger('service', 'component', {
  minLevel: 'WARN',  // Filter out DEBUG and INFO
  output: (line) => customOutputStream.write(line),
});
```
