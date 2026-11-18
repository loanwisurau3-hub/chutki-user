import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import type { AppNotification, TabKey } from '../types/bazar';
import type { PushPermissionState } from '../hooks/usePushNotifications';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className={compact ? 'btn btn-primary btn-sm' : 'btn btn-primary'}
        style={compact ? { fontSize: '0.72rem', padding: '5px 10px' } : { marginTop: '0.75rem' }}
      >
        <i className="fa-solid fa-download" />
        Install Chutki App
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={compact ? 'btn btn-outline btn-sm' : 'btn btn-outline'}
          style={{
            borderColor: 'var(--brand-green)',
            color: 'var(--brand-green)',
            marginTop: compact ? 0 : '0.75rem',
          }}
        >
          <i className="fa-solid fa-mobile-screen" />
          Install on iPhone / iPad
        </button>

        {showIOSGuide && (
          <div className="sheet-backdrop" style={{ zIndex: 1200 }} onClick={() => setShowIOSGuide(false)}>
            <div className="checkout-sheet" onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h3 style={{ fontWeight: 900, fontSize: '1.05rem' }}>Install on iPhone / iPad</h3>
                <button
                  type="button"
                  aria-label="Close iOS install guide"
                  onClick={() => setShowIOSGuide(false)}
                  style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: '#64748b' }}
                >
                  <i className="fa-solid fa-xmark" />
                </button>
              </div>
              <p style={{ fontSize: '0.84rem', color: '#334155', lineHeight: 1.5, marginBottom: '1rem' }}>
                1. Tap the <strong>Share</strong> button in your Safari toolbar.<br />
                2. Scroll down and tap <strong>Add to Home Screen</strong>.<br />
                3. Tap <strong>Add</strong> to launch Chutki like a native app!
              </p>
              <button type="button" className="btn btn-primary" onClick={() => setShowIOSGuide(false)}>
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: '#f59e0b',
        color: '#fff',
        fontSize: '0.75rem',
        fontWeight: 800,
        padding: '6px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
      }}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: '#fff',
          display: 'inline-block',
        }}
      />
      Offline Mode — Cached groceries & orders are available.
    </div>
  );
};

interface PushPermissionBannerProps {
  permission: PushPermissionState;
  promptDismissed: boolean;
  onEnable: () => void;
  onDismiss: () => void;
}

export const PushPermissionBanner: React.FC<PushPermissionBannerProps> = ({
  permission,
  promptDismissed,
  onEnable,
  onDismiss,
}) => {
  if (permission !== 'default' || promptDismissed) return null;

  return (
    <div
      style={{
        background: '#f0fdf4',
        border: '1px solid #bbf7d0',
        borderRadius: '14px',
        padding: '0.75rem 0.85rem',
        marginBottom: '0.85rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
      }}
    >
      <div style={{ flex: 1 }}>
        <strong style={{ fontSize: '0.82rem', color: '#14532d', display: 'block' }}>
          <i className="fa-solid fa-bell" style={{ color: 'var(--brand-green)' }} /> Enable Push Notifications
        </strong>
        <span style={{ fontSize: '0.72rem', color: '#166534', fontWeight: 600 }}>
          Get instant order status, rider arrival PIN & offer alerts.
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={onEnable}>
          Allow
        </button>
        <button
          type="button"
          aria-label="Dismiss notification prompt"
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            padding: '4px',
            fontSize: '0.95rem',
          }}
        >
          <i className="fa-solid fa-xmark" />
        </button>
      </div>
    </div>
  );
};

interface LivePushBannerProps {
  notification: AppNotification | null;
  onOpen: (notif: AppNotification) => void;
  onDismiss: () => void;
}

export const LivePushBanner: React.FC<LivePushBannerProps> = ({
  notification,
  onOpen,
  onDismiss,
}) => {
  if (!notification) return null;

  return (
    <div
      id="live-push-banner"
      className="live-push-banner"
      role="status"
      aria-live="assertive"
    >
      <button
        type="button"
        className="live-push-main"
        onClick={() => onOpen(notification)}
      >
        <div className="live-push-icon" aria-hidden="true">
          <i className="fa-solid fa-bell" />
        </div>
        <div className="live-push-content">
          <div className="live-push-title">{notification.title}</div>
          <div className="live-push-body">{notification.body}</div>
        </div>
        <span className="live-push-cta">View</span>
      </button>
      <button
        type="button"
        className="live-push-close"
        aria-label="Dismiss alert"
        onClick={onDismiss}
      >
        <i className="fa-solid fa-xmark" aria-hidden="true" />
      </button>
    </div>
  );
};

interface NotificationInboxModalProps {
  isOpen: boolean;
  notifications: AppNotification[];
  permission: PushPermissionState;
  onClose: () => void;
  onEnablePush: () => void;
  onSendTestPush: () => void;
  onMarkRead?: (id: string) => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onSelectTargetTab: (tab: TabKey) => void;
}

export const NotificationInboxModal: React.FC<NotificationInboxModalProps> = ({
  isOpen,
  notifications,
  permission,
  onClose,
  onEnablePush,
  onSendTestPush,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
  onSelectTargetTab,
}) => {
  if (!isOpen) return null;

  return (
    <div id="notification-inbox-modal" className="sheet-backdrop" style={{ zIndex: 850 }} onClick={onClose}>
      <div className="checkout-sheet" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.85rem',
            borderBottom: '1px solid var(--border)',
            paddingBottom: '0.65rem',
          }}
        >
          <div>
            <h3 style={{ fontWeight: 900, fontSize: '1.1rem' }}>
              <i className="fa-solid fa-bell" style={{ color: 'var(--brand-green)' }} /> Push Alerts
            </h3>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>
              Status:{' '}
              <strong style={{ color: permission === 'granted' ? 'var(--brand-green)' : 'var(--warning)' }}>
                {permission === 'granted'
                  ? 'Active'
                  : permission === 'denied'
                    ? 'Blocked in Browser'
                    : permission === 'unsupported'
                      ? 'Not Supported'
                      : 'Not Enabled'}
              </strong>
            </span>
          </div>
          <button
            type="button"
            aria-label="Close notifications"
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '1.35rem', cursor: 'pointer', color: '#64748b' }}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
          {permission !== 'granted' && permission !== 'unsupported' ? (
            <button type="button" className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={onEnablePush}>
              <i className="fa-solid fa-bell" /> Turn On Push Alerts
            </button>
          ) : (
            <button type="button" className="btn btn-outline btn-sm" style={{ flex: 1, borderColor: 'var(--brand-green)', color: 'var(--brand-green)' }} onClick={onSendTestPush}>
              <i className="fa-solid fa-paper-plane" /> Send Test Push
            </button>
          )}
          {notifications.length > 0 && (
            <>
              <button type="button" className="btn btn-outline btn-sm" onClick={onMarkAllRead}>
                Mark Read
              </button>
              <button type="button" className="btn btn-outline btn-sm" style={{ color: 'var(--danger)' }} onClick={onClearAll}>
                Clear
              </button>
            </>
          )}
        </div>

        {notifications.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '2rem 1rem',
              background: '#f8fafc',
              borderRadius: '14px',
              border: '1px dashed var(--border)',
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '0.4rem' }}>🔔</div>
            <strong style={{ fontSize: '0.9rem', display: 'block' }}>No notifications yet</strong>
            <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              Order status updates, rider arrival PINs, and wallet credits appear here.
            </span>
          </div>
        ) : (
          <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
            {notifications.map((n) => (
              <button
                type="button"
                key={n.id}
                onClick={() => {
                  onMarkRead?.(n.id);
                  onClose();
                  if (n.targetTab) onSelectTargetTab(n.targetTab);
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: n.read ? '#fff' : '#f0fdf4',
                  border: `1px solid ${n.read ? 'var(--border)' : '#bbf7d0'}`,
                  borderRadius: '12px',
                  padding: '0.7rem 0.85rem',
                  marginBottom: '8px',
                  cursor: 'pointer',
                  display: 'block',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                  <strong style={{ fontSize: '0.84rem', color: '#111' }}>{n.title}</strong>
                  <small style={{ fontSize: '0.68rem', color: '#64748b' }}>
                    {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </small>
                </div>
                <div style={{ fontSize: '0.76rem', color: '#475569' }}>{n.body}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
