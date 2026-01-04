/**
 * WebSocket Service
 * Real-time updates for prices, opportunities, trades, and balances
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { validateSession } from '../middleware/auth.js';
import { priceOracleService } from './price-oracle.js';
import { arbitrageService } from './arbitrage.js';
import { walletService } from './wallet.js';
import { continuousExecutorService } from './continuous-executor.js';
import type { WSEvent, WSEventType, Address, ChainId } from '../../shared/schema.js';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  walletAddress?: Address;
  isAlive: boolean;
  subscriptions: Set<string>;
}

class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Set<AuthenticatedWebSocket> = new Set();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Initialize WebSocket server
   */
  initialize(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req) => {
      const client = ws as AuthenticatedWebSocket;
      client.isAlive = true;
      client.subscriptions = new Set();

      // Handle authentication via query param
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');

      if (token) {
        const session = validateSession(token);
        if (session.valid && session.userId && session.walletAddress) {
          client.userId = session.userId;
          client.walletAddress = session.walletAddress;
        }
      }

      this.clients.add(client);

      client.on('pong', () => {
        client.isAlive = true;
      });

      client.on('message', (data) => {
        this.handleMessage(client, data.toString());
      });

      client.on('close', () => {
        this.clients.delete(client);
      });

      client.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(client);
      });

      // Send welcome message
      this.send(client, {
        type: 'executor:status',
        payload: {
          connected: true,
          authenticated: !!client.userId,
        },
        timestamp: Date.now(),
      });
    });

    // Setup ping interval for keepalive
    this.pingInterval = setInterval(() => {
      this.clients.forEach((client) => {
        if (!client.isAlive) {
          client.terminate();
          this.clients.delete(client);
          return;
        }

        client.isAlive = false;
        client.ping();
      });
    }, 30000);

    // Subscribe to service events
    this.setupServiceSubscriptions();

    console.log('[WS] WebSocket server initialized');
  }

  /**
   * Setup subscriptions to internal service events
   */
  private setupServiceSubscriptions(): void {
    // Arbitrage opportunities
    arbitrageService.onOpportunityFound((opportunity) => {
      this.broadcast('opportunity:new', {
        id: opportunity.id,
        type: opportunity.type,
        tokenPair: opportunity.tokenPair,
        netProfitUSD: opportunity.netProfitUSD,
        expiresAt: opportunity.expiresAt,
      });
    });

    // Executor status
    continuousExecutorService.onStatusChange((status) => {
      this.broadcast('executor:status', status);
    });

    // Wallet balance changes
    walletService.onBalanceChange((address, balance) => {
      this.broadcastToUser(address, 'balance:update', {
        walletAddress: address,
        chainId: balance.chainId,
        totalValueUSD: balance.totalValueUSD,
        tokens: balance.tokens.map((t) => ({
          ...t,
          balance: t.balance.toString(),
        })),
      });
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(client: AuthenticatedWebSocket, data: string): void {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'subscribe':
          this.handleSubscribe(client, message.channel);
          break;

        case 'unsubscribe':
          this.handleUnsubscribe(client, message.channel);
          break;

        case 'ping':
          this.send(client, { type: 'pong' as any, payload: {}, timestamp: Date.now() });
          break;

        default:
          console.warn('[WS] Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('[WS] Message parse error:', error);
    }
  }

  /**
   * Handle channel subscription
   */
  private handleSubscribe(client: AuthenticatedWebSocket, channel: string): void {
    client.subscriptions.add(channel);

    this.send(client, {
      type: 'executor:status' as WSEventType,
      payload: { subscribed: channel },
      timestamp: Date.now(),
    });
  }

  /**
   * Handle channel unsubscription
   */
  private handleUnsubscribe(client: AuthenticatedWebSocket, channel: string): void {
    client.subscriptions.delete(channel);

    this.send(client, {
      type: 'executor:status' as WSEventType,
      payload: { unsubscribed: channel },
      timestamp: Date.now(),
    });
  }

  /**
   * Send message to a specific client
   */
  send<T>(client: AuthenticatedWebSocket, event: WSEvent<T>): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(event));
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast<T>(type: WSEventType, payload: T): void {
    const event: WSEvent<T> = { type, payload, timestamp: Date.now() };
    const message = JSON.stringify(event);

    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  /**
   * Broadcast message to clients subscribed to a specific channel
   */
  broadcastToChannel<T>(channel: string, type: WSEventType, payload: T): void {
    const event: WSEvent<T> = { type, payload, timestamp: Date.now() };
    const message = JSON.stringify(event);

    this.clients.forEach((client) => {
      if (
        client.readyState === WebSocket.OPEN &&
        client.subscriptions.has(channel)
      ) {
        client.send(message);
      }
    });
  }

  /**
   * Broadcast message to a specific user
   */
  broadcastToUser<T>(walletAddress: Address, type: WSEventType, payload: T): void {
    const event: WSEvent<T> = { type, payload, timestamp: Date.now() };
    const message = JSON.stringify(event);
    const normalizedAddress = walletAddress.toLowerCase();

    this.clients.forEach((client) => {
      if (
        client.readyState === WebSocket.OPEN &&
        client.walletAddress?.toLowerCase() === normalizedAddress
      ) {
        client.send(message);
      }
    });
  }

  /**
   * Send error to a specific client
   */
  sendError(client: AuthenticatedWebSocket, code: string, message: string): void {
    this.send(client, {
      type: 'error',
      payload: { code, message },
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast trade execution result
   */
  broadcastTradeExecuted(delegationId: string, txHash: string, profit: number): void {
    this.broadcast('trade:executed', {
      delegationId,
      txHash,
      profit,
    });
  }

  /**
   * Broadcast price update
   */
  broadcastPriceUpdate(
    chain: ChainId,
    tokenAddress: Address,
    priceUSD: number
  ): void {
    this.broadcastToChannel(`price:${chain}:${tokenAddress.toLowerCase()}`, 'price:update', {
      chain,
      token: tokenAddress,
      price: priceUSD,
    });
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get authenticated client count
   */
  getAuthenticatedClientCount(): number {
    let count = 0;
    this.clients.forEach((client) => {
      if (client.userId) count++;
    });
    return count;
  }

  /**
   * Shutdown WebSocket server
   */
  shutdown(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.clients.forEach((client) => {
      client.close();
    });

    this.clients.clear();

    if (this.wss) {
      this.wss.close();
    }

    console.log('[WS] WebSocket server shutdown');
  }
}

export const websocketService = new WebSocketService();
