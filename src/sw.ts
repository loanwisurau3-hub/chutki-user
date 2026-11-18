/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

precacheAndRoute(self.__WB_MANIFEST || []);

registerRoute(
  ({ url }) =>
    url.origin === 'https://fonts.googleapis.com' ||
    url.origin === 'https://fonts.gstatic.com' ||
    url.origin === 'https://cdnjs.cloudflare.com',
  new CacheFirst({
    cacheName: 'gb-fonts-icons-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  })
);

registerRoute(
  ({ request, url }) =>
    request.destination === 'image' &&
    !url.hostname.includes('googleapis.com') &&
    !url.hostname.includes('gstatic.com'),
  new StaleWhileRevalidate({
    cacheName: 'gb-images-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  })
);

interface PushPayload {
  title?: string;
  body?: string;
  tag?: string;
  targetTab?: string;
  url?: string;
  notification?: {
    title?: string;
    body?: string;
    icon?: string;
    tag?: string;
  };
  data?: {
    targetTab?: string;
    url?: string;
  };
}

self.addEventListener('push', (event: PushEvent) => {
  let payload: PushPayload = {};
  try {
    payload = event.data ? (event.data.json() as PushPayload) : {};
  } catch {
    payload = { body: event.data?.text() || 'New update from Chutki!' };
  }

  const title = payload.notification?.title || payload.title || 'Chutki';
  const body =
    payload.notification?.body ||
    payload.body ||
    'Tap to view your latest order & grocery offers.';
  const tag = payload.notification?.tag || payload.tag || 'gb-push-alert';
  const targetTab = payload.data?.targetTab || payload.targetTab || 'orders';
  const url = payload.data?.url || payload.url || `/?tab=${targetTab}`;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag,
      vibrate: [200, 100, 200],
      data: { url, targetTab },
      actions: [
        { action: 'open', title: 'Open App' },
      ],
    } as NotificationOptions)
  );
});

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as
    | {
        type?: string;
        title?: string;
        body?: string;
        tag?: string;
        targetTab?: string;
      }
    | undefined;
  if (!data) return;

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'SHOW_NOTIFICATION') {
    const title = data.title || 'Chutki';
    const body = data.body || '';
    const tag = data.tag || 'gb-live-alert';
    const targetTab = data.targetTab || 'orders';

    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag,
        vibrate: [200, 100, 200],
        data: { url: `/?tab=${targetTab}`, targetTab },
      } as NotificationOptions)
    );
  }
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const notifData = (event.notification.data || {}) as {
    url?: string;
    targetTab?: string;
  };
  const targetTab = notifData.targetTab || 'orders';
  const targetUrl = notifData.url || `/?tab=${targetTab}`;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.postMessage({ type: 'NAVIGATE_TAB', tab: targetTab });
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
