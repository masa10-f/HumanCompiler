/**
 * Notifications hook for checkout reminders (Issue #228)
 *
 * Provides:
 * - Push subscription management
 * - WebSocket connection for real-time updates
 * - In-app notification state
 * - Snooze functionality
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWebSocket } from './use-websocket';
import { useAuth } from './use-auth';
import type {
  NotificationMessage,
  NotificationState,
  PushSubscriptionCreateRequest,
  SnoozeResponse,
  WebSocketMessage,
} from '@/types/notification';

// API base URL
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// WebSocket base URL (derived from API URL)
const getWebSocketUrl = (apiUrl: string): string => {
  const url = new URL(apiUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString().replace(/\/$/, '');
};

const WS_BASE_URL = getWebSocketUrl(API_BASE_URL);

interface UseNotificationsReturn extends NotificationState {
  /** Request notification permission */
  requestPermission: () => Promise<boolean>;
  /** Subscribe to push notifications */
  subscribe: () => Promise<void>;
  /** Unsubscribe from push notifications */
  unsubscribe: () => Promise<void>;
  /** Dismiss current in-app notification */
  dismissNotification: () => void;
  /** Snooze current session */
  snooze: () => Promise<SnoozeResponse>;
  /** Whether snooze is in progress */
  isSnoozing: boolean;
  /** Reconnect WebSocket */
  reconnect: () => void;
}

/**
 * Check if notifications are supported in this browser
 */
function isNotificationSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

/**
 * Get device type for push subscription
 */
function getDeviceType(): 'desktop' | 'mobile' | 'tablet' {
  if (typeof window === 'undefined') return 'desktop';

  const ua = navigator.userAgent.toLowerCase();
  if (/tablet|ipad/i.test(ua)) return 'tablet';
  if (/mobile|iphone|android/i.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * Hook for managing checkout notifications
 */
export function useNotifications(): UseNotificationsReturn {
  const { session, isAuthenticated } = useAuth();
  const userId = session?.user?.id;
  const accessToken = session?.access_token;

  // State
  const [hasPermission, setHasPermission] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [currentNotification, setCurrentNotification] =
    useState<NotificationMessage | null>(null);
  const [isSnoozing, setIsSnoozing] = useState(false);

  const isSupported = useMemo(() => isNotificationSupported(), []);

  // WebSocket URL with auth token
  const wsUrl = useMemo(() => {
    if (!isAuthenticated || !userId || !accessToken) return null;
    return `${WS_BASE_URL}/ws/notifications/${userId}?token=${accessToken}`;
  }, [isAuthenticated, userId, accessToken]);

  // WebSocket connection
  const {
    isConnected,
    lastMessage,
    connect: reconnect,
  } = useWebSocket(wsUrl, {
    autoConnect: true,
    reconnectDelay: 2000,
    maxReconnectAttempts: 10,
    heartbeatInterval: 30000,
  });

  // Check permission on mount
  useEffect(() => {
    if (isSupported) {
      setHasPermission(Notification.permission === 'granted');
    }
  }, [isSupported]);

  // Handle incoming WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    const message = lastMessage as WebSocketMessage;

    if (message.type === 'notification') {
      const notification = message as NotificationMessage;
      setCurrentNotification(notification);

      // Auto-dismiss light notifications after 10 seconds
      if (notification.level === 'light') {
        const timeoutId = setTimeout(() => {
          setCurrentNotification((current) =>
            current?.id === notification.id ? null : current
          );
        }, 10000);

        return () => clearTimeout(timeoutId);
      }
    }
  }, [lastMessage]);

  /**
   * Request notification permission
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;

    try {
      const permission = await Notification.requestPermission();
      const granted = permission === 'granted';
      setHasPermission(granted);
      return granted;
    } catch (error) {
      console.error('Failed to request notification permission:', error);
      return false;
    }
  }, [isSupported]);

  /**
   * Subscribe to push notifications
   */
  const subscribe = useCallback(async (): Promise<void> => {
    if (!isSupported || !hasPermission) {
      throw new Error('Notifications not supported or permission not granted');
    }

    try {
      // Register service worker if not already registered
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      // Get push subscription
      // Note: In production, you'd get the VAPID public key from the server
      const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

      if (!VAPID_PUBLIC_KEY) {
        console.warn('VAPID public key not configured, skipping push subscription');
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      // Send subscription to server
      const keys = subscription.toJSON().keys;
      if (!keys?.p256dh || !keys?.auth) {
        throw new Error('Failed to get push subscription keys');
      }

      const payload: PushSubscriptionCreateRequest = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
        user_agent: navigator.userAgent,
        device_type: getDeviceType(),
      };

      const response = await fetch(`${API_BASE_URL}/api/notifications/push-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Failed to register push subscription');
      }

      setIsSubscribed(true);
      console.log('Push subscription registered');
    } catch (error) {
      console.error('Failed to subscribe to push notifications:', error);
      throw error;
    }
  }, [isSupported, hasPermission, accessToken]);

  /**
   * Unsubscribe from push notifications
   */
  const unsubscribe = useCallback(async (): Promise<void> => {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return;

      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return;

      // Unsubscribe from push manager
      await subscription.unsubscribe();

      // Notify server
      await fetch(
        `${API_BASE_URL}/api/notifications/push-subscription?endpoint=${encodeURIComponent(
          subscription.endpoint
        )}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      setIsSubscribed(false);
      console.log('Push subscription removed');
    } catch (error) {
      console.error('Failed to unsubscribe from push notifications:', error);
      throw error;
    }
  }, [accessToken]);

  /**
   * Dismiss current in-app notification
   */
  const dismissNotification = useCallback(() => {
    setCurrentNotification(null);
  }, []);

  /**
   * Snooze current session
   */
  const snooze = useCallback(async (): Promise<SnoozeResponse> => {
    setIsSnoozing(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/work-sessions/snooze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ snooze_minutes: 5 }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to snooze session');
      }

      const data: SnoozeResponse = await response.json();
      setCurrentNotification(null);
      return data;
    } finally {
      setIsSnoozing(false);
    }
  }, [accessToken]);

  return {
    // State
    hasPermission,
    isSubscribed,
    currentNotification,
    isConnected,
    isSupported,
    // Actions
    requestPermission,
    subscribe,
    unsubscribe,
    dismissNotification,
    snooze,
    isSnoozing,
    reconnect,
  };
}

/**
 * Convert a base64 URL-safe string to Uint8Array for VAPID key
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}
