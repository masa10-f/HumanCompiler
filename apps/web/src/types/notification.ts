/**
 * Notification types for checkout reminders (Issue #228)
 */

/**
 * Notification urgency level
 */
export type NotificationLevel = 'light' | 'strong' | 'overdue';

/**
 * WebSocket notification message from server
 */
export interface NotificationMessage {
  id: string;
  type: 'notification';
  level: NotificationLevel;
  title: string;
  body: string;
  session_id: string;
  action_url?: string;
  timestamp: string;
}

/**
 * WebSocket connection message
 */
export interface WebSocketConnectionMessage {
  type: 'connected' | 'status' | 'ping' | 'pong' | 'echo';
  user_id?: string;
  message?: string;
  connected?: boolean;
  active_connections?: number;
}

/**
 * Union type for all WebSocket messages
 */
export type WebSocketMessage = NotificationMessage | WebSocketConnectionMessage;

/**
 * Push subscription keys from Web Push API
 */
export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

/**
 * Push subscription request payload
 */
export interface PushSubscriptionCreateRequest {
  endpoint: string;
  keys: PushSubscriptionKeys;
  user_agent?: string;
  device_type?: 'desktop' | 'mobile' | 'tablet';
}

/**
 * Push subscription response from API
 */
export interface PushSubscriptionResponse {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
  user_agent: string | null;
  device_type: 'desktop' | 'mobile' | 'tablet' | null;
  is_active: boolean;
  last_successful_push: string | null;
  failure_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Snooze request payload
 */
export interface SnoozeRequest {
  snooze_minutes?: number;
}

/**
 * Snooze response from API
 */
export interface SnoozeResponse {
  session: import('./work-session').WorkSession;
  new_planned_checkout_at: string;
  snooze_count: number;
  max_snooze_count: number;
}

/**
 * Notification permission status
 */
export type NotificationPermission = 'default' | 'granted' | 'denied';

/**
 * Notification hook state
 */
export interface NotificationState {
  /** Whether user has granted notification permission */
  hasPermission: boolean;
  /** Whether push subscription is active */
  isSubscribed: boolean;
  /** Current in-app notification to display */
  currentNotification: NotificationMessage | null;
  /** Whether WebSocket is connected */
  isConnected: boolean;
  /** Whether notification features are supported */
  isSupported: boolean;
}
