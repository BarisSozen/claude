import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '../store/auth';
import { z } from 'zod';

type MessageHandler = (data: unknown) => void;

// WebSocket message validation schema
const wsMessageSchema = z.object({
  type: z.string().min(1).max(100),
  payload: z.unknown().optional(),
});

// Exponential backoff configuration
const BACKOFF_CONFIG = {
  baseDelay: 1000,      // 1 second
  maxDelay: 30000,      // 30 seconds max
  multiplier: 2,
  maxRetries: 10,
};

// Heartbeat configuration
const HEARTBEAT_CONFIG = {
  interval: 30000,      // Send ping every 30 seconds
  timeout: 10000,       // Wait 10 seconds for pong before considering connection dead
};

export function useWebSocket() {
  const token = useAuthStore((state) => state.token);
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const handlersRef = useRef<Map<string, Set<MessageHandler>>>(new Map());
  const retryCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awaitingPongRef = useRef(false);

  /**
   * Calculate exponential backoff delay
   */
  const getBackoffDelay = useCallback((retryCount: number): number => {
    const delay = BACKOFF_CONFIG.baseDelay * Math.pow(BACKOFF_CONFIG.multiplier, retryCount);
    // Add jitter (±20%) to prevent thundering herd
    const jitter = delay * 0.2 * (Math.random() - 0.5);
    return Math.min(delay + jitter, BACKOFF_CONFIG.maxDelay);
  }, []);

  /**
   * Stop heartbeat timers
   */
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
    awaitingPongRef.current = false;
  }, []);

  /**
   * Start heartbeat to detect stale connections
   */
  const startHeartbeat = useCallback(() => {
    stopHeartbeat();

    heartbeatIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN && !awaitingPongRef.current) {
        // Send ping
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
        awaitingPongRef.current = true;

        // Set timeout for pong response
        heartbeatTimeoutRef.current = setTimeout(() => {
          if (awaitingPongRef.current) {
            // No pong received, connection is stale
            wsRef.current?.close();
          }
        }, HEARTBEAT_CONFIG.timeout);
      }
    }, HEARTBEAT_CONFIG.interval);
  }, [stopHeartbeat]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // Clear any pending reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const wsUrl = `ws://${window.location.host}/ws${token ? `?token=${token}` : ''}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setIsConnected(true);
      retryCountRef.current = 0; // Reset retry count on successful connection
      startHeartbeat(); // Start heartbeat monitoring
    };

    ws.onclose = () => {
      setIsConnected(false);
      stopHeartbeat(); // Stop heartbeat monitoring

      // Exponential backoff reconnection
      if (retryCountRef.current < BACKOFF_CONFIG.maxRetries) {
        const delay = getBackoffDelay(retryCountRef.current);
        retryCountRef.current++;
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      // Error is handled in onclose
    };

    ws.onmessage = (event) => {
      try {
        const rawData = JSON.parse(event.data);

        // Validate message structure using Zod
        const parseResult = wsMessageSchema.safeParse(rawData);
        if (!parseResult.success) {
          // Invalid message structure - ignore silently
          return;
        }

        const { type, payload } = parseResult.data;

        // Handle pong response for heartbeat
        if (type === 'pong') {
          awaitingPongRef.current = false;
          if (heartbeatTimeoutRef.current) {
            clearTimeout(heartbeatTimeoutRef.current);
            heartbeatTimeoutRef.current = null;
          }
          return;
        }

        const handlers = handlersRef.current.get(type);
        if (handlers) {
          handlers.forEach((handler) => handler(payload));
        }
      } catch {
        // Invalid JSON - ignore silently
      }
    };

    wsRef.current = ws;
  }, [token, getBackoffDelay, startHeartbeat, stopHeartbeat]);

  const disconnect = useCallback(() => {
    // Clear any pending reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    // Stop heartbeat
    stopHeartbeat();
    // Prevent auto-reconnect
    retryCountRef.current = BACKOFF_CONFIG.maxRetries;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [stopHeartbeat]);

  const subscribe = useCallback((type: string, handler: MessageHandler) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);

    // Send subscribe message
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', channel: type }));
    }

    return () => {
      handlersRef.current.get(type)?.delete(handler);
    };
  }, []);

  const send = useCallback((type: string, payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  return {
    isConnected,
    subscribe,
    send,
    connect,
    disconnect,
  };
}
