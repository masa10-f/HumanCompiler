/**
 * WebSocket hook for real-time notifications (Issue #228)
 *
 * Provides:
 * - Automatic connection management
 * - Reconnection with exponential backoff
 * - Ping-pong heartbeat
 * - Message handling
 */

import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import type { WebSocketMessage } from '@/types/notification';

interface UseWebSocketOptions {
  /** Whether to automatically connect */
  autoConnect?: boolean;
  /** Reconnection delay in ms (base) */
  reconnectDelay?: number;
  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number;
  /** Heartbeat interval in ms */
  heartbeatInterval?: number;
}

interface UseWebSocketReturn {
  /** Whether the WebSocket is connected */
  isConnected: boolean;
  /** Last message received */
  lastMessage: WebSocketMessage | null;
  /** Connection error if any */
  error: string | null;
  /** Manually connect */
  connect: () => void;
  /** Manually disconnect */
  disconnect: () => void;
  /** Send a message */
  send: (message: string) => void;
}

const DEFAULT_OPTIONS: UseWebSocketOptions = {
  autoConnect: true,
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
  heartbeatInterval: 30000,
};

/**
 * Hook for managing WebSocket connection
 */
export function useWebSocket(
  url: string | null,
  options: UseWebSocketOptions = {}
): UseWebSocketReturn {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Clear all timers
   */
  const clearTimers = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  /**
   * Start heartbeat ping
   */
  const startHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }

    heartbeatIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping');
      }
    }, opts.heartbeatInterval);
  }, [opts.heartbeatInterval]);

  /**
   * Connect to WebSocket
   */
  const connect = useCallback(() => {
    if (!url) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    clearTimers();
    setError(null);

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected');
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
        startHeartbeat();
      };

      ws.onmessage = (event) => {
        try {
          // Handle text messages
          if (event.data === 'pong') {
            // Heartbeat response, ignore
            return;
          }

          // Try to parse JSON messages
          const message = JSON.parse(event.data) as WebSocketMessage;
          setLastMessage(message);
        } catch {
          // Non-JSON message
          console.log('[WS] Non-JSON message:', event.data);
        }
      };

      ws.onerror = (event) => {
        console.error('[WS] Error:', event);
        setError('WebSocket connection error');
      };

      ws.onclose = (event) => {
        console.log('[WS] Closed:', event.code, event.reason);
        setIsConnected(false);
        clearTimers();

        // Close codes that should not trigger reconnection
        const noReconnectCodes = [1000, 4001, 4003]; // Normal close, auth required, user mismatch
        if (noReconnectCodes.includes(event.code)) {
          return;
        }

        // Attempt reconnection with exponential backoff
        if (reconnectAttemptsRef.current < (opts.maxReconnectAttempts || 5)) {
          const delay =
            (opts.reconnectDelay || 1000) *
            Math.pow(2, reconnectAttemptsRef.current);
          reconnectAttemptsRef.current++;

          console.log(
            `[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          setError('Maximum reconnection attempts reached');
        }
      };
    } catch (e) {
      console.error('[WS] Connection error:', e);
      setError('Failed to create WebSocket connection');
    }
  }, [url, clearTimers, startHeartbeat, opts.maxReconnectAttempts, opts.reconnectDelay]);

  /**
   * Disconnect from WebSocket
   */
  const disconnect = useCallback(() => {
    clearTimers();
    reconnectAttemptsRef.current = opts.maxReconnectAttempts || 5; // Prevent reconnection

    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected');
      wsRef.current = null;
    }

    setIsConnected(false);
  }, [clearTimers, opts.maxReconnectAttempts]);

  /**
   * Send a message
   */
  const send = useCallback((message: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(message);
    } else {
      console.warn('[WS] Cannot send - not connected');
    }
  }, []);

  // Keep refs in sync with latest callbacks to avoid dependency issues
  const connectRef = useRef(connect);
  const disconnectRef = useRef(disconnect);

  useLayoutEffect(() => {
    connectRef.current = connect;
    disconnectRef.current = disconnect;
  }, [connect, disconnect]);

  // Auto-connect on mount if enabled and URL is provided
  // Using refs to avoid unnecessary reconnections when callbacks change
  useEffect(() => {
    if (opts.autoConnect && url) {
      connectRef.current();
    }

    return () => {
      disconnectRef.current();
    };
  }, [url, opts.autoConnect]);

  return {
    isConnected,
    lastMessage,
    error,
    connect,
    disconnect,
    send,
  };
}
