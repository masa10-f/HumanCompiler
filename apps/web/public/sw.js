/**
 * Service Worker for Push Notifications (Issue #228)
 *
 * Handles:
 * - Push notification reception
 * - Notification click actions (checkout, snooze)
 * - Background sync for offline support
 */

// Service Worker version for cache busting
const SW_VERSION = '1.0.0';

// Install event - called when service worker is first installed
self.addEventListener('install', (event) => {
  console.log('[SW] Service Worker installing, version:', SW_VERSION);
  // Skip waiting to activate immediately
  self.skipWaiting();
});

// Activate event - called when service worker becomes active
self.addEventListener('activate', (event) => {
  console.log('[SW] Service Worker activating');
  // Take control of all pages immediately
  event.waitUntil(clients.claim());
});

// Push notification event - received from server
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');

  if (!event.data) {
    console.warn('[SW] Push event has no data');
    return;
  }

  let data;
  try {
    data = event.data.json();
  } catch (e) {
    console.error('[SW] Failed to parse push data:', e);
    return;
  }

  const {
    title = 'チェックアウト通知',
    body = '',
    level = 'light',
    session_id,
    action_url = '/runner',
  } = data;

  // Configure notification options based on urgency level
  const options = {
    body,
    icon: '/icon-192x192.png',
    badge: '/favicon-32x32.png',
    tag: `checkout-${session_id}`,
    renotify: true, // Always notify even if same tag
    requireInteraction: level !== 'light', // Keep notification visible for strong/overdue
    data: {
      session_id,
      action_url,
      level,
    },
    actions: [
      { action: 'checkout', title: 'チェックアウト' },
    ],
  };

  // Add snooze action for non-overdue notifications
  if (level !== 'overdue') {
    options.actions.push({ action: 'snooze', title: 'スヌーズ (5分)' });
  }

  // Vibration pattern based on urgency
  if (level === 'overdue') {
    options.vibrate = [200, 100, 200, 100, 200]; // Urgent pattern
  } else if (level === 'strong') {
    options.vibrate = [200, 100, 200]; // Medium urgency
  } else {
    options.vibrate = [100]; // Light tap
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click event - user clicked on notification
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.action);

  event.notification.close();

  const { action_url, session_id } = event.notification.data || {};

  if (event.action === 'checkout') {
    // Open Runner page with checkout trigger
    event.waitUntil(
      openOrFocusWindow('/runner?checkout=true')
    );
  } else if (event.action === 'snooze') {
    // Send snooze request to API
    event.waitUntil(
      handleSnooze(session_id)
    );
  } else {
    // Default click - open runner page
    event.waitUntil(
      openOrFocusWindow(action_url || '/runner')
    );
  }
});

// Notification close event - user dismissed notification
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notification dismissed');
  // Could track dismissals here if needed
});

/**
 * Open a window or focus existing one with the given URL
 */
async function openOrFocusWindow(url) {
  const allClients = await clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  // Check if a window with the same origin is already open
  for (const client of allClients) {
    if (client.url.includes(self.location.origin)) {
      // Navigate existing window to the URL and focus it
      await client.navigate(url);
      return client.focus();
    }
  }

  // No existing window, open new one
  return clients.openWindow(url);
}

/**
 * Handle snooze action from notification
 */
async function handleSnooze(session_id) {
  try {
    // Get the stored auth token
    // Note: In production, you'd want to handle this more securely
    const response = await fetch('/api/work-sessions/snooze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Auth token would need to be included here
        // This is a limitation - service workers can't easily access
        // cookies/localStorage from the main thread
      },
      body: JSON.stringify({ snooze_minutes: 5 }),
      credentials: 'include',
    });

    if (response.ok) {
      console.log('[SW] Snooze successful');
      // Show confirmation notification
      await self.registration.showNotification('スヌーズしました', {
        body: '5分後に再通知します',
        icon: '/icon-192x192.png',
        tag: 'snooze-confirmation',
        requireInteraction: false,
      });
    } else {
      console.error('[SW] Snooze failed:', response.status);
      // Show error notification
      await self.registration.showNotification('スヌーズ失敗', {
        body: 'スヌーズ上限に達したか、エラーが発生しました',
        icon: '/icon-192x192.png',
        tag: 'snooze-error',
        requireInteraction: false,
      });
    }
  } catch (error) {
    console.error('[SW] Snooze error:', error);
    // Open the runner page as fallback
    await openOrFocusWindow('/runner');
  }
}

// Message event - communication from main thread
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
