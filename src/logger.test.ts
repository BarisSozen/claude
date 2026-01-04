import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Logger } from './logger';
import { getCorrelationId, withCorrelationId, CORRELATION_HEADER } from './http';

describe('Logger', () => {
  it('should generate correlation IDs with correct format', () => {
    const id = Logger.generateCorrelationId('liq');
    assert.match(id, /^liq_[0-9a-f]+_[a-z0-9]{4}$/);
  });

  it('should generate different correlation IDs for each prefix', () => {
    const liqId = Logger.generateCorrelationId('liq');
    const arbId = Logger.generateCorrelationId('arb');
    const quoId = Logger.generateCorrelationId('quo');

    assert.ok(liqId.startsWith('liq_'));
    assert.ok(arbId.startsWith('arb_'));
    assert.ok(quoId.startsWith('quo_'));
  });

  it('should output valid JSON Lines format', () => {
    const logs: string[] = [];
    const logger = new Logger('test-service', 'test-component', {
      output: (line) => logs.push(line),
    });

    const ctx = logger.startOperation('liq');
    logger.error(ctx, 'TX_REVERT', 'Liquidation reverted', { tx_hash: '0x123', gas_used: 50000 });

    assert.strictEqual(logs.length, 1);
    const entry = JSON.parse(logs[0]);

    assert.strictEqual(entry.level, 'ERROR');
    assert.strictEqual(entry.service, 'test-service');
    assert.strictEqual(entry.component, 'test-component');
    assert.strictEqual(entry.event_type, 'TX_REVERT');
    assert.strictEqual(entry.message, 'Liquidation reverted');
    assert.strictEqual(entry.context.tx_hash, '0x123');
    assert.strictEqual(entry.context.gas_used, 50000);
    assert.ok(entry.timestamp);
    assert.ok(entry.correlation_id.startsWith('liq_'));
  });

  it('should respect minimum log level', () => {
    const logs: string[] = [];
    const logger = new Logger('test-service', undefined, {
      minLevel: 'WARN',
      output: (line) => logs.push(line),
    });

    const ctx = logger.startOperation('arb');
    logger.debug(ctx, 'DEBUG_EVENT', 'Debug message');
    logger.info(ctx, 'INFO_EVENT', 'Info message');
    logger.warn(ctx, 'WARN_EVENT', 'Warn message');
    logger.error(ctx, 'ERROR_EVENT', 'Error message');

    assert.strictEqual(logs.length, 2);
    assert.ok(logs[0].includes('WARN'));
    assert.ok(logs[1].includes('ERROR'));
  });

  it('should track operation duration with complete()', (_, done) => {
    const logs: string[] = [];
    const logger = new Logger('test-service', undefined, {
      output: (line) => logs.push(line),
    });

    const ctx = logger.startOperation('quo');

    setTimeout(() => {
      logger.complete(ctx, 'QUOTE_COMPLETE', 'Quote finished');
      const entry = JSON.parse(logs[0]);
      assert.ok(entry.context.duration_ms >= 10);
      done();
    }, 15);
  });
});

describe('HTTP utilities', () => {
  it('should extract correlation ID from headers', () => {
    const headers = { [CORRELATION_HEADER]: 'liq_abc123_xyz' };
    assert.strictEqual(getCorrelationId(headers), 'liq_abc123_xyz');
  });

  it('should handle lowercase header name', () => {
    const headers = { 'x-correlation-id': 'arb_def456_uvw' };
    assert.strictEqual(getCorrelationId(headers), 'arb_def456_uvw');
  });

  it('should create headers with correlation ID', () => {
    const ctx = { correlation_id: 'quo_ghi789_rst', started_at: new Date() };
    const headers = withCorrelationId(ctx, { 'Content-Type': 'application/json' });

    assert.strictEqual(headers[CORRELATION_HEADER], 'quo_ghi789_rst');
    assert.strictEqual(headers['Content-Type'], 'application/json');
  });
});
