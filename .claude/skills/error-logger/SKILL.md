---
name: error-logger
description: Structured JSON logging with correlation IDs for multi-service systems. Use when implementing logging, debugging failures, or tracing errors across services. Triggers on: add logging, error handling, debug failures, trace errors.
---

# Error Logger

## Log Format
```json
{
  "timestamp": "2024-01-15T14:32:01.847Z",
  "level": "ERROR",
  "correlation_id": "liq_18d4f2a1_x7k9",
  "service": "rust-hotpath",
  "event_type": "TX_REVERT",
  "message": "Liquidation reverted",
  "context": {}
}
```

## Correlation ID

Format: `{prefix}_{timestamp_hex}_{random}`
Prefixes: `liq_`, `arb_`, `quo_`, `op_`

## Usage
```typescript
const ctx = log.startOperation('liq');
log.error(ctx, 'TX_REVERT', 'Failed', { tx_hash, gas_used });

// Propagate via HTTP
headers: { 'X-Correlation-ID': ctx.correlation_id }
```

## Log Levels

| Level | Use For |
|-------|---------|
| ERROR | Operation failures |
| WARN | Retries, recoverable |
| INFO | Normal operations |
| DEBUG | Calculations |
