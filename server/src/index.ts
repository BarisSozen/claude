/**
 * DeFi Bot Server Entry Point
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
import { executionLogger } from './services/logger.js';

// Import routes
import authRoutes from './routes/auth.js';
import delegationRoutes from './routes/delegations.js';
import tradeRoutes from './routes/trades.js';
import opportunityRoutes from './routes/opportunities.js';
import executorRoutes from './routes/executor.js';
import walletRoutes from './routes/wallet.js';

// Create Express app
const app = express();
const httpServer = createServer(app);

// Security middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: config.server.corsOrigin,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    executionLogger.debug('system', `${req.method} ${req.path}`, {
      status: res.statusCode,
      duration,
    });
  });
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  const dbHealthy = await checkDatabaseConnection();
  const wsClients = websocketService.getClientCount();

  res.json({
    status: dbHealthy ? 'healthy' : 'degraded',
    timestamp: Date.now(),
    services: {
      database: dbHealthy,
      websocket: {
        clients: wsClients,
      },
    },
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/delegations', delegationRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/opportunities', opportunityRoutes);
app.use('/api/executor', executorRoutes);
app.use('/api/wallet', walletRoutes);

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  executionLogger.error('system', 'Unhandled error', err);

  res.status(500).json({
    success: false,
    error: config.server.nodeEnv === 'production'
      ? 'Internal server error'
      : err.message,
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

// Initialize WebSocket
websocketService.initialize(httpServer);

// Graceful shutdown
const shutdown = async () => {
  executionLogger.info('system', 'Shutting down...');

  websocketService.shutdown();
  await closeDatabaseConnection();

  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
const PORT = config.server.port;

httpServer.listen(PORT, () => {
  executionLogger.success('system', `Server started on port ${PORT}`);
  executionLogger.info('system', `Environment: ${config.server.nodeEnv}`);
  executionLogger.info('system', `CORS origin: ${config.server.corsOrigin}`);
});

export default app;
