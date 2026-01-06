/**
 * DeFi Bot Server Entry Point
 * Production-ready server with Redis sessions, structured logging, and metrics
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createServer } from 'http';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import config (validates env vars)
import { config } from './config/env.js';

// Import database
import { checkDatabaseConnection, closeDatabaseConnection } from './db/index.js';

// Import services
import { websocketService } from './services/websocket.js';
import { structuredLogger } from './services/logger.js';
import { redisService } from './services/redis.js';
import { metricsService } from './services/metrics.js';
import { rpcProvider } from './services/rpc-provider.js';

// Import routes
import authRoutes from './routes/auth.js';
import delegationRoutes from './routes/delegations.js';
import tradeRoutes from './routes/trades.js';
import opportunityRoutes from './routes/opportunities.js';
import executorRoutes from './routes/executor.js';
import walletRoutes from './routes/wallet.js';
import strategyRoutes from './routes/strategies.js';
import adminRoutes from './routes/admin.js';
import docsRoutes from './routes/docs.js';

// Create Express app
const app = express();
const httpServer = createServer(app);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: config.server.nodeEnv === 'production' ? undefined : false,
}));
app.use(compression());
app.use(cors({
  origin: config.server.corsOrigin,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// Request correlation ID middleware
app.use((req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] as string ||
    req.headers['x-request-id'] as string ||
    `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  res.setHeader('x-correlation-id', correlationId);
  (req as any).correlationId = correlationId;
  next();
});

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const correlationId = (req as any).correlationId;

    // Log request
    structuredLogger.http(req.method, req.path, res.statusCode, duration, {
      correlationId,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });

    // Record metrics
    metricsService.recordHttpRequest(req.method, req.path, res.statusCode, duration);
  });

  next();
});

// Health check endpoint (no auth required)
app.get('/health', async (req, res) => {
  const dbHealthy = await checkDatabaseConnection();
  const redisHealthy = await redisService.ping();
  const wsClients = websocketService.getClientCount();

  const status = dbHealthy && redisHealthy ? 'healthy' : 'degraded';

  res.status(status === 'healthy' ? 200 : 503).json({
    status,
    timestamp: Date.now(),
    version: '1.0.0',
    environment: config.server.nodeEnv,
    services: {
      database: dbHealthy,
      redis: redisHealthy,
      websocket: {
        clients: wsClients,
      },
    },
  });
});

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    const metrics = await metricsService.getMetrics();
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics);
  } catch (error) {
    structuredLogger.error('system', 'Failed to generate metrics', error as Error);
    res.status(500).send('Failed to generate metrics');
  }
});

// Metrics JSON endpoint (for internal use)
app.get('/metrics/json', async (req, res) => {
  try {
    const metrics = await metricsService.getMetricsJson();
    res.json({
      success: true,
      data: metrics,
      timestamp: Date.now(),
    });
  } catch (error) {
    structuredLogger.error('system', 'Failed to generate metrics JSON', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate metrics',
      timestamp: Date.now(),
    });
  }
});

// Readiness probe (for Kubernetes)
app.get('/ready', async (req, res) => {
  const dbHealthy = await checkDatabaseConnection();
  const redisHealthy = await redisService.ping();

  if (dbHealthy && redisHealthy) {
    res.status(200).json({ ready: true });
  } else {
    res.status(503).json({
      ready: false,
      services: { database: dbHealthy, redis: redisHealthy },
    });
  }
});

// Liveness probe (for Kubernetes)
app.get('/live', (req, res) => {
  res.status(200).json({ live: true });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/delegations', delegationRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/opportunities', opportunityRoutes);
app.use('/api/executor', executorRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/strategies', strategyRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/docs', docsRoutes);

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const correlationId = (req as any).correlationId;

  structuredLogger.error('system', 'Unhandled error', err, {
    correlationId,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    error: config.server.nodeEnv === 'production'
      ? 'Internal server error'
      : err.message,
    correlationId,
    timestamp: Date.now(),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    timestamp: Date.now(),
  });
});

// Initialize services
async function initializeServices(): Promise<void> {
  structuredLogger.info('system', 'Initializing services...');

  // Connect to Redis
  try {
    await redisService.connect();
    structuredLogger.success('system', 'Redis connected');
  } catch (error) {
    structuredLogger.error('system', 'Failed to connect to Redis', error as Error);
    // Don't exit - allow degraded operation without Redis
  }

  // Initialize WebSocket
  websocketService.initialize(httpServer);
  structuredLogger.success('system', 'WebSocket initialized');

  // Check database connection
  const dbHealthy = await checkDatabaseConnection();
  if (dbHealthy) {
    structuredLogger.success('system', 'Database connected');
  } else {
    structuredLogger.error('system', 'Database connection failed');
  }

  // Log RPC provider status
  const rpcStats = rpcProvider.getAllStats();
  for (const [chain, stats] of Object.entries(rpcStats)) {
    structuredLogger.info('system', `RPC endpoints for ${chain}`, {
      endpoints: stats.endpoints.length,
      healthy: stats.endpoints.filter(e => e.healthy).length,
    });
  }
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  structuredLogger.info('system', `Received ${signal}, shutting down...`);

  // Stop accepting new requests
  httpServer.close();

  // Shutdown services
  websocketService.shutdown();
  rpcProvider.shutdown();
  await structuredLogger.shutdown();
  await redisService.disconnect();
  await closeDatabaseConnection();

  structuredLogger.info('system', 'Shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  structuredLogger.error('system', 'Unhandled rejection', null, {
    reason: String(reason),
    promise: String(promise),
  });
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  structuredLogger.error('system', 'Uncaught exception', error);
  // Give time for logs to flush
  setTimeout(() => process.exit(1), 1000);
});

// Start server
const PORT = config.server.port;

initializeServices()
  .then(() => {
    httpServer.listen(PORT, () => {
      structuredLogger.success('system', `Server started on port ${PORT}`);
      structuredLogger.info('system', `Environment: ${config.server.nodeEnv}`);
      structuredLogger.info('system', `CORS origin: ${config.server.corsOrigin}`);
      structuredLogger.info('system', `API docs: http://localhost:${PORT}/api/docs/swagger`);
    });
  })
  .catch((error) => {
    structuredLogger.error('system', 'Failed to start server', error);
    process.exit(1);
  });

export default app;
