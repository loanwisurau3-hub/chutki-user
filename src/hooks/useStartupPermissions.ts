import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';

interface StartupPermissionOptions {
  onLocationGranted?: (lat: number, lng: number) => void;
  onNotificationGranted?: () => void;
}

export function useStartupPermissions(options?: StartupPermissionOptions) {
  const hasRequestedRef = useRef(false);

  useEffect(() => {
    if (hasRequestedRef.current) return;
    hasRequestedRef.current = true;

    const requestAllStartupPermissions = async () => {
      // 1. NOTIFICATIONS PERMISSION (Native Android + Web)
      try {
        if (Capacitor.isNativePlatform()) {
          const pushStatus = await PushNotifications.checkPermissions();
          if (pushStatus.receive !== 'granted') {
            const requested = await PushNotifications.requestPermissions();
            if (requested.receive === 'granted') {
              await PushNotifications.register().catch(() => {});
              options?.onNotificationGranted?.();
            }
          } else {
            await PushNotifications.register().catch(() => {});
          }

          const localStatus = await LocalNotifications.checkPermissions();
          if (localStatus.display !== 'granted') {
            await LocalNotifications.requestPermissions().catch(() => {});
          }
        } else if (typeof window !== 'undefined' && 'Notification' in window) {
          if (Notification.permission === 'default') {
            const perm = await Notification.requestPermission();
            if (perm === 'granted') {
              options?.onNotificationGranted?.();
            }
          }
        }
      } catch {
        // Silently continue if permission request was dismissed
      }

      // 2. GPS LOCATION PERMISSION (Startup Auto Pin)
      try {
        if (typeof navigator !== 'undefined' && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const lat = Number(pos.coords.latitude.toFixed(6));
              const lng = Number(pos.coords.longitude.toFixed(6));
              options?.onLocationGranted?.(lat, lng);
            },
            () => {
              // User dismissed or location off - non-fatal
            },
            {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 15000,
            }
          );
        }
      } catch {
        // Silently continue
      }
    };

    // Chhota sa 600ms delay taaki UI render smoothly ho jaye
    const timer = setTimeout(() => {
      void requestAllStartupPermissions();
    }, 600);

    return () => clearTimeout(timer);
  }, [options]);
}
