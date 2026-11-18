import React, { useEffect, useState } from 'react';
import type { AdminSettings, CustomerProfile, FeedbackItem } from '../types/bazar';
import type { PushPermissionState } from '../hooks/usePushNotifications';
import { PWAInstallButton } from './PWAControls';

interface ProfileTabProps {
  profile: CustomerProfile;
  userEmail: string;
  referralCode: string;
  hasGpsPinned: boolean;
  isDetectingGps: boolean;
  settings: AdminSettings;
  myFeedbacks: Record<string, FeedbackItem>;
  pushPermission: PushPermissionState;
  unreadNotifications: number;
  isPlusActive: boolean;
  isActivatingPlus?: boolean;
  allowChutkiPlus?: boolean;
  plusPlanPrice: number;
  plusValidityDays?: number;
  onActivatePlus: () => void;
  onDetectGps: () => void;
  onSaveProfile: (name: string, phone: string, address: string) => void;
  onOpenFeedback: () => void;
  onEnablePush: () => void;
  onSendTestPush: () => void;
  onOpenNotificationInbox: () => void;
  onSendPasswordReset: () => void;
  onLogout: () => void;
}

export const ProfileTab: React.FC<ProfileTabProps> = ({
  profile,
  userEmail,
  referralCode,
  hasGpsPinned,
  isDetectingGps,
  settings,
  myFeedbacks,
  pushPermission,
  unreadNotifications,
  isPlusActive,
  isActivatingPlus = false,
  allowChutkiPlus = true,
  plusPlanPrice,
  plusValidityDays = 30,
  onActivatePlus,
  onDetectGps,
  onSaveProfile,
  onOpenFeedback,
  onEnablePush,
  onSendTestPush,
  onOpenNotificationInbox,
  onSendPasswordReset,
  onLogout,
}) => {
  const [name, setName] = useState(profile.name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [address, setAddress] = useState(profile.address || '');

  useEffect(() => {
    setName(profile.name || '');
    setPhone(profile.phone || '');
    setAddress(profile.address || '');
  }, [profile.name, profile.phone, profile.address]);

  const wBal = Number(profile.walletBalance || 0);
  const waNum = String(settings.supportWhatsapp || settings.supportPhone || '').replace(
    /\D/g,
    ''
  );
  const feedbackEntries = Object.entries(myFeedbacks).sort(
    (a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0)
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveProfile(name, phone, address);
  };

  return (
    <div id="tab-profile" className="tab-content active">
      <div
        style={{
          background: '#ffffff',
          border: '1px solid var(--border)',
          borderRadius: '18px',
          padding: '1rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <div
          id="prof-avatar-circle"
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            background: 'var(--brand-green)',
            color: '#fff',
            fontWeight: 900,
            fontSize: '1.3rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {(profile.name || 'U').charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <strong
            id="prof-card-name"
            style={{ fontSize: '1rem', display: 'block' }}
          >
            {profile.name || 'Valued Customer'}
          </strong>
          <small
            id="prof-card-meta"
            style={{ color: 'var(--text-muted)', fontWeight: 700 }}
          >
            Wallet: ₹{wBal.toFixed(0)} • Code: {referralCode}
          </small>
        </div>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          id="btn-profile-gps"
          disabled={isDetectingGps}
          onClick={onDetectGps}
          style={{
            color: 'var(--brand-green)',
            borderColor: 'var(--brand-green)',
          }}
        >
          <i
            className={
              isDetectingGps
                ? 'fa-solid fa-spinner fa-spin'
                : 'fa-solid fa-location-crosshairs'
            }
          />{' '}
          GPS
        </button>
      </div>

      {/* CHUTKI PLUS MEMBERSHIP CARD */}
      {allowChutkiPlus && (
        <div
          className={`chutki-plus-card ${isPlusActive ? 'active' : ''}`}
          data-testid="profile-chutki-plus-card"
        >
          <div className="chutki-plus-head">
            <div>
              <div className="chutki-plus-title">👑 Chutki Plus Membership</div>
              <div className="chutki-plus-sub">
                {isPlusActive && profile.plusActiveUntil
                  ? `Active until ${new Date(profile.plusActiveUntil).toLocaleDateString()} • ₹0 Delivery Fee on all orders!`
                  : `Pay ₹${plusPlanPrice} for ${plusValidityDays} days via Wallet for unlimited ₹0 Free Delivery.`}
              </div>
            </div>
            <span className={`chutki-plus-badge ${isPlusActive ? 'active' : ''}`}>
              {isPlusActive ? 'ACTIVE' : `₹${plusPlanPrice}`}
            </span>
          </div>
          {!isPlusActive && (
            <button
              type="button"
              className="btn btn-primary btn-sm chutki-plus-btn"
              data-testid="activate-chutki-plus-btn"
              disabled={isActivatingPlus}
              onClick={onActivatePlus}
            >
              {isActivatingPlus
                ? 'Activating...'
                : `👑 Activate Chutki Plus • ₹${plusPlanPrice} (${plusValidityDays}d)`}
            </button>
          )}
        </div>
      )}

      {/* PUSH NOTIFICATIONS & NATIVE APP INSTALL CARD */}
      <div
        style={{
          background: '#fff',
          border: '1px solid var(--border)',
          borderRadius: '18px',
          padding: '1rem',
          marginBottom: '1rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '6px',
          }}
        >
          <strong style={{ fontSize: '0.92rem' }}>
            <i
              className="fa-solid fa-bell"
              style={{ color: 'var(--brand-green)' }}
            />{' '}
            Push Notifications & App
          </strong>
          <span
            style={{
              fontSize: '0.68rem',
              fontWeight: 900,
              padding: '2px 8px',
              borderRadius: '8px',
              background:
                pushPermission === 'granted' ? '#e8f5e9' : '#fef3c7',
              color: pushPermission === 'granted' ? '#0c831f' : '#92400e',
            }}
          >
            {pushPermission === 'granted'
              ? 'ACTIVE'
              : pushPermission === 'denied'
                ? 'BLOCKED'
                : 'OFF'}
          </span>
        </div>
        <p
          style={{
            fontSize: '0.74rem',
            color: 'var(--text-muted)',
            marginBottom: '8px',
          }}
        >
          Receive instant alerts for order packing, rider arrival PIN & wallet
          updates.
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {pushPermission !== 'granted' ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ flex: 1 }}
              onClick={onEnablePush}
            >
              <i className="fa-solid fa-bell" /> Enable Push Alerts
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{
                flex: 1,
                borderColor: 'var(--brand-green)',
                color: 'var(--brand-green)',
              }}
              onClick={onSendTestPush}
            >
              <i className="fa-solid fa-paper-plane" /> Send Test Push
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={onOpenNotificationInbox}
          >
            <i className="fa-solid fa-inbox" /> Alerts ({unreadNotifications})
          </button>
        </div>
        <PWAInstallButton />
      </div>

      <div
        style={{
          background: '#ffffff',
          border: '1px solid var(--border)',
          borderRadius: '18px',
          padding: '1.15rem',
          marginBottom: '1rem',
        }}
      >
        <form id="profile-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="prof-name">Full Name</label>
            <input
              type="text"
              id="prof-name"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="prof-email">Email Address</label>
            <input
              type="email"
              id="prof-email"
              className="form-input"
              value={userEmail}
              disabled
              style={{ background: '#f1f5f9', color: '#64748b' }}
            />
          </div>
          <div className="form-group">
            <label htmlFor="prof-phone">10-Digit Mobile Number</label>
            <input
              type="tel"
              id="prof-phone"
              className="form-input"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="prof-address">Default Delivery Address</label>
            <textarea
              id="prof-address"
              className="form-input"
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
            />
          </div>
          {hasGpsPinned && (
            <div
              id="prof-gps-badge"
              style={{
                background: '#e8f5e9',
                border: '1px solid #c8e6c9',
                borderRadius: '8px',
                padding: '6px 10px',
                fontSize: '0.74rem',
                color: '#1b5e20',
                fontWeight: 800,
                marginBottom: '0.85rem',
              }}
            >
              📍 Exact Doorstep GPS Pinned
            </div>
          )}
          <button type="submit" className="btn btn-primary">
            Save Profile Details
          </button>
        </form>
      </div>

      {/* HELPLINE & FEEDBACK CARD */}
      <div
        style={{
          background: '#fff',
          border: '1px solid var(--border)',
          borderRadius: '18px',
          padding: '1rem',
          marginBottom: '1rem',
        }}
      >
        <strong
          style={{ fontSize: '0.92rem', display: 'block', marginBottom: '4px' }}
        >
          <i
            className="fa-solid fa-headset"
            style={{ color: 'var(--brand-green)' }}
          />{' '}
          24/7 Helpline & Feedback
        </strong>
        <p
          id="cust-helpline-hours"
          style={{
            fontSize: '0.74rem',
            color: 'var(--text-muted)',
            marginBottom: '8px',
          }}
        >
          {settings.supportHours
            ? `Helpline Hours: ${settings.supportHours}`
            : 'Need help with an order or payment?'}
        </p>
        {(settings.supportPhone || waNum) && (
          <div
            id="customer-support-card"
            style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}
          >
            {settings.supportPhone && (
              <a
                id="cust-support-call"
                href={`tel:${settings.supportPhone}`}
                className="btn btn-outline btn-sm"
                style={{ flex: 1 }}
              >
                <i className="fa-solid fa-phone" /> Call Helpline
              </a>
            )}
            {waNum && (
              <a
                id="cust-support-wa"
                href={`https://wa.me/${waNum.length === 10 ? '91' + waNum : waNum}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary btn-sm"
                style={{ flex: 1 }}
              >
                <i className="fa-brands fa-whatsapp" /> WhatsApp
              </a>
            )}
          </div>
        )}
        <button
          type="button"
          className="btn btn-outline btn-sm"
          style={{
            width: '100%',
            borderColor: 'var(--brand-green)',
            color: 'var(--brand-green)',
          }}
          onClick={onOpenFeedback}
        >
          <i className="fa-solid fa-comment-dots" /> Send Feedback / Report Issue
        </button>
        {feedbackEntries.length > 0 && (
          <div id="my-feedbacks-list" style={{ marginTop: '8px' }}>
            {feedbackEntries.slice(0, 3).map(([fbId, f]) => (
              <div
                key={fbId}
                style={{
                  background: '#f8fafc',
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '0.55rem 0.75rem',
                  marginTop: '6px',
                  fontSize: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{f.subject}</strong>
                  <span
                    style={{
                      color:
                        f.status === 'RESOLVED'
                          ? 'var(--brand-green)'
                          : 'var(--warning)',
                      fontWeight: 800,
                    }}
                  >
                    {f.status}
                  </span>
                </div>
                {f.adminReply && (
                  <div style={{ color: '#0284c7', marginTop: '2px' }}>
                    Admin: {f.adminReply}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ACCOUNT SECURITY & ANTI-SCAM SHIELD */}
      <section className="security-shield-card" aria-label="Security and Anti-Scam Protection">
        <div className="security-shield-head">
          <strong>
            <i className="fa-solid fa-shield-halved" aria-hidden="true" />{' '}
            Security & Anti-Scam Shield
          </strong>
          <span className="security-shield-badge">PROTECTED</span>
        </div>
        <ul className="security-shield-rules">
          <li>
            <strong>Delivery PIN Guard:</strong> Share your 4-digit PIN only at the doorstep after verifying your items.
          </li>
          <li>
            <strong>Zero-PIN Policy:</strong> Chutki staff or riders never ask for your UPI PIN, OTP, or remote screen-sharing apps.
          </li>
          <li>
            <strong>UTR & Price Lock:</strong> All order totals lock to live verified store prices and duplicate UTRs are blocked automatically.
          </li>
        </ul>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          style={{ width: '100%' }}
          onClick={onSendPasswordReset}
        >
          <i className="fa-solid fa-key" aria-hidden="true" /> Send Password Reset Link
        </button>
      </section>

      <button
        type="button"
        className="btn btn-outline"
        onClick={onLogout}
        style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
      >
        <i className="fa-solid fa-arrow-right-from-bracket" /> Sign Out
      </button>
    </div>
  );
};
