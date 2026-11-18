import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { ref, update } from 'firebase/database';
import { getToken, onMessage } from 'firebase/messaging';
import { db, getFirebaseMessagingSafe } from '../firebase';
import type { AppNotification, TabKey } from '../types/bazar';

const INBOX_STORAGE_KEY = 'gb_push_inbox_v1';
const PROMPT_DISMISSED_KEY = 'gb_push_prompt_dismissed_v1';
const ANDROID_CHANNEL_ID = 'chutki_orders';

function loadSavedInbox(): AppNotification[] {
  try {
    const raw = localStorage.getItem(INBOX_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 40) : [];
  } catch {
    return [];
  }
}

export type PushPermissionState = NotificationPermission | 'unsupported';

function mapCapacitorPerm(state: string | undefined): PushPermissionState {
  if (state === 'granted') return 'granted';
  if (state === 'denied') return 'denied';
  return 'default';
}

function resolveTab(rawTab: unknown): TabKey {
  if (rawTab === 'home' || rawTab === 'orders' || rawTab === 'wallet' || rawTab === 'profile') {
    return rawTab;
  }
  return 'orders';
}

export function usePushNotifications(
  userUid: string | null,
  isDemoMode: boolean,
  onNavigateTab?: (tab: TabKey) => void
) {
  const isNative = Capacitor.isNativePlatform();

  const [permission, setPermission] = useState<PushPermissionState>(() => {
    if (isNative) return 'default';
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    return Notification.permission;
  });
  const [notifications, setNotifications] = useState<AppNotification[]>(loadSavedInbox);
  const [promptDismissed, setPromptDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PROMPT_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [fcmToken, setFcmToken] = useState<string>('');
  const [activeBanner, setActiveBanner] = useState<AppNotification | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userUidRef = useRef<string | null>(userUid);
  const isDemoModeRef = useRef<boolean>(isDemoMode);
  userUidRef.current = userUid;
  isDemoModeRef.current = isDemoMode;

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, []);

  const persistInbox = useCallback((items: AppNotification[]) => {
    try {
      localStorage.setItem(INBOX_STORAGE_KEY, JSON.stringify(items.slice(0, 40)));
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  const ensureNativeChannels = useCallback(async () => {
    if (!isNative || Capacitor.getPlatform() !== 'android') return;
    try {
      await LocalNotifications.createChannel({
        id: ANDROID_CHANNEL_ID,
        name: 'Order & Delivery Alerts',
        description: 'Live order packing, rider PIN & wallet notifications',
        importance: 5,
        visibility: 1,
        vibration: true,
      });
    } catch {
      // Ignore channel errors
    }
    try {
      await PushNotifications.createChannel({
        id: ANDROID_CHANNEL_ID,
        name: 'Order & Delivery Alerts',
        description: 'Live order packing, rider PIN & wallet notifications',
        importance: 5,
        visibility: 1,
        sound: 'default',
        vibration: true,
      });
    } catch {
      // Ignore channel errors
    }
  }, [isNative]);

  const showNativeNotification = useCallback(
    async (notif: AppNotification) => {
      if (isNative) {
        try {
          await ensureNativeChannels();
          const checkLocal = await LocalNotifications.checkPermissions();
          let displayPerm = checkLocal.display;
          if (displayPerm !== 'granted') {
            const checkPush = await PushNotifications.checkPermissions();
            if (checkPush.receive === 'granted') {
              const reqLocal = await LocalNotifications.requestPermissions();
              displayPerm = reqLocal.display;
            }
          }
          if (displayPerm !== 'granted') return;

          const notifIntId = Math.floor(1 + Math.random() * 2000000000);
          await LocalNotifications.schedule({
            notifications: [
              {
                id: notifIntId,
                title: notif.title,
                body: notif.body,
                channelId: ANDROID_CHANNEL_ID,
                extra: {
                  targetTab: notif.targetTab || 'orders',
                },
              },
            ],
          });
        } catch {
          // Ignore native scheduling error
        }
        return;
      }

      if (typeof window === 'undefined' || !('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;

      try {
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.ready;
          if (reg && typeof reg.showNotification === 'function') {
            await reg.showNotification(notif.title, {
              body: notif.body,
              icon: '/pwa-192x192.png',
              badge: '/pwa-192x192.png',
              tag: notif.tag,
              data: {
                url: `/?tab=${notif.targetTab || 'orders'}`,
                targetTab: notif.targetTab || 'orders',
              },
            });
            return;
          }
        }
        new Notification(notif.title, {
          body: notif.body,
          icon: '/pwa-192x192.png',
          tag: notif.tag,
        });
      } catch {
        // Fallback silently if browser restricts notification constructor
      }
    },
    [ensureNativeChannels, isNative]
  );

  const dismissBanner = useCallback(() => {
    if (bannerTimerRef.current) {
      clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = null;
    }
    setActiveBanner(null);
  }, []);

  const pushNotification = useCallback(
    (notif: AppNotification, showSystemAlert = true) => {
      let wasAdded = false;
      setNotifications((prev) => {
        if (prev.some((n) => n.id === notif.id)) return prev;
        wasAdded = true;
        const next = [notif, ...prev].slice(0, 40);
        persistInbox(next);
        return next;
      });
      if (showSystemAlert) {
        if (wasAdded || notif.type === 'ORDER') {
          setActiveBanner(notif);
          if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
          bannerTimerRef.current = setTimeout(() => {
            setActiveBanner((cur) => (cur?.id === notif.id ? null : cur));
          }, 5500);
        }
        void showNativeNotification(notif);
      }
    },
    [persistInbox, showNativeNotification]
  );

  const markNotificationRead = useCallback(
    (notifId: string) => {
      setNotifications((prev) => {
        const next = prev.map((n) => (n.id === notifId ? { ...n, read: true } : n));
        persistInbox(next);
        return next;
      });
    },
    [persistInbox]
  );

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      persistInbox(next);
      return next;
    });
  }, [persistInbox]);

  const clearInbox = useCallback(() => {
    setNotifications([]);
    persistInbox([]);
    dismissBanner();
  }, [dismissBanner, persistInbox]);

  const dismissPrompt = useCallback(() => {
    setPromptDismissed(true);
    try {
      localStorage.setItem(PROMPT_DISMISSED_KEY, '1');
    } catch {
      // Ignore
    }
  }, []);

  const syncFcmToken = useCallback(async () => {
    if (!userUid || isDemoMode) return;

    if (isNative) {
      try {
        await ensureNativeChannels();
        await PushNotifications.register();
        await update(ref(db, `customers/${userUid}`), {
          pushEnabled: true,
        });
      } catch {
        // Ignore if FCM registration fails temporarily
      }
      return;
    }

    try {
      const messaging = await getFirebaseMessagingSafe();
      if (!messaging || !('serviceWorker' in navigator)) return;
      const reg = await navigator.serviceWorker.ready;
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
      const token = vapidKey
        ? await getToken(messaging, { vapidKey, serviceWorkerRegistration: reg })
        : await getToken(messaging, { serviceWorkerRegistration: reg }).catch(() => '');
      if (token) {
        setFcmToken(token);
        await update(ref(db, `customers/${userUid}`), {
          fcmToken: token,
          pushEnabled: true,
        });
      } else {
        await update(ref(db, `customers/${userUid}`), {
          pushEnabled: true,
        });
      }
    } catch {
      if (userUid && !isDemoMode) {
        void update(ref(db, `customers/${userUid}`), { pushEnabled: true }).catch(() => {});
      }
    }
  }, [ensureNativeChannels, isDemoMode, isNative, userUid]);

  const enablePushNotifications = useCallback(async (): Promise<{
    granted: boolean;
    message: string;
  }> => {
    if (isNative) {
      try {
        await ensureNativeChannels();
        const pushPerm = await PushNotifications.requestPermissions();
        const localPerm = await LocalNotifications.requestPermissions();
        const isGranted =
          pushPerm.receive === 'granted' || localPerm.display === 'granted';
        const mapped: PushPermissionState = isGranted
          ? 'granted'
          : mapCapacitorPerm(pushPerm.receive);
        setPermission(mapped);

        if (isGranted) {
          dismissPrompt();
          if (pushPerm.receive === 'granted') {
            await PushNotifications.register().catch(() => {});
          }
          if (userUid && !isDemoMode) {
            await update(ref(db, `customers/${userUid}`), {
              pushEnabled: true,
            }).catch(() => {});
          }
          const welcomeNotif: AppNotification = {
            id: `welcome_${Date.now()}`,
            title: '🔔 Chutki Alerts Active!',
            body: 'You will now receive live order updates, rider arrival PIN & deal alerts.',
            tag: 'gb-welcome-push',
            type: 'SYSTEM',
            targetTab: 'home',
            createdAt: Date.now(),
            read: false,
          };
          pushNotification(welcomeNotif, true);
          return {
            granted: true,
            message: '🔔 Push notifications enabled! Check your notification tray.',
          };
        }

        return {
          granted: false,
          message:
            mapped === 'denied'
              ? 'Notification permission denied. Please enable Notifications in Android App Settings.'
              : 'Notification permission dismissed.',
        };
      } catch (err) {
        return {
          granted: false,
          message: err instanceof Error ? err.message : 'Unable to enable notifications.',
        };
      }
    }

    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return {
        granted: false,
        message: 'Push notifications are not supported on this browser.',
      };
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        dismissPrompt();
        await syncFcmToken();
        const welcomeNotif: AppNotification = {
          id: `welcome_${Date.now()}`,
          title: '🔔 Chutki Alerts Active!',
          body: 'You will now receive live order updates, rider arrival PIN & deal alerts.',
          tag: 'gb-welcome-push',
          type: 'SYSTEM',
          targetTab: 'home',
          createdAt: Date.now(),
          read: false,
        };
        pushNotification(welcomeNotif, true);
        return {
          granted: true,
          message: '🔔 Push notifications enabled! Check your notification tray.',
        };
      }
      return {
        granted: false,
        message:
          result === 'denied'
            ? 'Notification permission blocked in browser settings.'
            : 'Notification permission dismissed.',
      };
    } catch (err) {
      return {
        granted: false,
        message: err instanceof Error ? err.message : 'Unable to enable notifications.',
      };
    }
  }, [
    dismissPrompt,
    ensureNativeChannels,
    isDemoMode,
    isNative,
    pushNotification,
    syncFcmToken,
    userUid,
  ]);

  const sendTestPush = useCallback(async () => {
    if (permission !== 'granted') {
      return enablePushNotifications();
    }
    const testNotif: AppNotification = {
      id: `test_${Date.now()}`,
      title: '⚡ 15-Min Express Order Alert',
      body: 'Push notifications are working smoothly! Rider & offer updates will arrive here.',
      tag: `gb-test-${Date.now()}`,
      type: 'ORDER',
      targetTab: 'orders',
      createdAt: Date.now(),
      read: false,
    };
    pushNotification(testNotif, true);
    return { granted: true, message: '🔔 Test push notification sent!' };
  }, [enablePushNotifications, permission, pushNotification]);

  // Native Android Capacitor Push & Local Notification listeners
  useEffect(() => {
    if (!isNative) return undefined;

    let cancelled = false;
    const handles: PluginListenerHandle[] = [];

    const initNativePush = async () => {
      try {
        await ensureNativeChannels();
        const pushPerm = await PushNotifications.checkPermissions();
        const localPerm = await LocalNotifications.checkPermissions();
        if (!cancelled) {
          if (pushPerm.receive === 'granted' || localPerm.display === 'granted') {
            setPermission('granted');
          } else {
            setPermission(mapCapacitorPerm(pushPerm.receive));
          }
        }

        const regHandle = await PushNotifications.addListener('registration', (token) => {
          if (cancelled || !token?.value) return;
          setFcmToken(token.value);
          const uid = userUidRef.current;
          if (uid && !isDemoModeRef.current) {
            void update(ref(db, `customers/${uid}`), {
              fcmToken: token.value,
              pushEnabled: true,
            }).catch(() => {});
          }
        });
        handles.push(regHandle);

        const rxHandle = await PushNotifications.addListener(
          'pushNotificationReceived',
          (notification) => {
            if (cancelled) return;
            const title = notification.title || 'Chutki';
            const body = notification.body || 'You have a new update.';
            const data = (notification.data || {}) as Record<string, unknown>;
            pushNotification(
              {
                id: `fcm_${notification.id || Date.now()}`,
                title,
                body,
                tag: 'gb-fcm-msg',
                type: 'ORDER',
                targetTab: resolveTab(data.targetTab),
                createdAt: Date.now(),
                read: false,
              },
              true
            );
          }
        );
        handles.push(rxHandle);

        const pushTapHandle = await PushNotifications.addListener(
          'pushNotificationActionPerformed',
          (action) => {
            if (cancelled) return;
            const data = (action.notification?.data || {}) as Record<string, unknown>;
            onNavigateTab?.(resolveTab(data.targetTab));
          }
        );
        handles.push(pushTapHandle);

        const localTapHandle = await LocalNotifications.addListener(
          'localNotificationActionPerformed',
          (action) => {
            if (cancelled) return;
            const extra = (action.notification?.extra || {}) as Record<string, unknown>;
            onNavigateTab?.(resolveTab(extra.targetTab));
          }
        );
        handles.push(localTapHandle);

        if (pushPerm.receive === 'granted') {
          await PushNotifications.register().catch(() => {});
        }
      } catch {
        // Ignore initialization errors
      }
    };

    void initNativePush();

    return () => {
      cancelled = true;
      handles.forEach((h) => {
        void h.remove().catch(() => {});
      });
    };
  }, [ensureNativeChannels, isNative, onNavigateTab, pushNotification]);

  // Listen for FCM foreground messages & SW notification clicks (Web / PWA)
  useEffect(() => {
    if (isNative) return undefined;

    let unsubscribeFcm: (() => void) | undefined;
    let isMounted = true;

    void getFirebaseMessagingSafe().then((messaging) => {
      if (!messaging || !isMounted) return;
      unsubscribeFcm = onMessage(messaging, (payload) => {
        const title = payload.notification?.title || 'Chutki';
        const body = payload.notification?.body || 'You have a new update.';
        const targetTab =
          (payload.data?.targetTab as TabKey | undefined) || 'orders';
        pushNotification(
          {
            id: `fcm_${Date.now()}`,
            title,
            body,
            tag: 'gb-fcm-msg',
            type: 'ORDER',
            targetTab,
            createdAt: Date.now(),
            read: false,
          },
          true
        );
      });
    });

    const handleSwMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; tab?: TabKey } | undefined;
      if (data?.type === 'NAVIGATE_TAB' && data.tab && onNavigateTab) {
        onNavigateTab(data.tab);
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }

    return () => {
      isMounted = false;
      if (unsubscribeFcm) unsubscribeFcm();
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
    };
  }, [isNative, onNavigateTab, pushNotification]);

  useEffect(() => {
    if (permission === 'granted' && userUid && !isDemoMode) {
      void syncFcmToken();
    }
  }, [permission, userUid, isDemoMode, syncFcmToken]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    permission,
    fcmToken,
    notifications,
    unreadCount,
    activeBanner,
    promptDismissed,
    enablePushNotifications,
    sendTestPush,
    pushNotification,
    markNotificationRead,
    markAllRead,
    clearInbox,
    dismissBanner,
    dismissPrompt,
  };
}
