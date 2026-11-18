import React, { useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth';
import { get, push, ref, runTransaction, set } from 'firebase/database';
import { auth, db } from '../firebase';
import { isValidIndianMobile } from '../utils/bazarLogic';
import {
  evaluatePasswordStrength,
  getAuthLockoutRemainingSec,
  mapAuthErrorSafe,
  recordAuthAttemptState,
  sanitizeInputBounded,
  type AuthAttemptState,
} from '../utils/security';
import { triggerHaptic } from '../utils/haptics';
import { PWAInstallButton } from './PWAControls';

const AUTH_GUARD_KEY = 'gb_auth_guard';

function loadAuthGuard(): AuthAttemptState {
  try {
    const raw = localStorage.getItem(AUTH_GUARD_KEY);
    if (!raw) return { failedCount: 0, lockedUntil: 0, lockoutTier: 0 };
    const parsed = JSON.parse(raw) as Partial<AuthAttemptState>;
    return {
      failedCount: Math.max(0, Number(parsed.failedCount || 0)),
      lockedUntil: Math.max(0, Number(parsed.lockedUntil || 0)),
      lockoutTier: Math.max(0, Number(parsed.lockoutTier || 0)),
    };
  } catch {
    return { failedCount: 0, lockedUntil: 0, lockoutTier: 0 };
  }
}

function saveAuthGuard(state: AuthAttemptState): void {
  try {
    localStorage.setItem(AUTH_GUARD_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

interface AuthScreenProps {
  brandName: string;
  allowReferrals: boolean;
  referrerBonus: number;
  refereeBonus: number;
  showToast: (msg: string, type?: 'success' | 'danger' | 'info') => void;
  onDetectedGps: (lat: number, lng: number, link: string) => void;
  detectedLat: number | null;
  detectedLng: number | null;
  detectedLocationLink: string;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  brandName,
  allowReferrals,
  referrerBonus,
  refereeBonus,
  showToast,
  onDetectedGps,
  detectedLat,
  detectedLng,
  detectedLocationLink,
}) => {
  const [authTab, setAuthTab] = useState<'login' | 'signup'>('login');
  const [authError, setAuthError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPwd, setShowLoginPwd] = useState(false);
  const [authGuard, setAuthGuard] = useState<AuthAttemptState>(loadAuthGuard);
  const [lockoutSec, setLockoutSec] = useState<number>(() =>
    getAuthLockoutRemainingSec(loadAuthGuard())
  );

  // Signup fields
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupAddress, setSignupAddress] = useState('');
  const [signupReferral, setSignupReferral] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [showSignupPwd, setShowSignupPwd] = useState(false);

  useEffect(() => {
    const rem = getAuthLockoutRemainingSec(authGuard);
    setLockoutSec(rem);
    if (rem <= 0) return;
    const timer = setInterval(() => {
      const nextRem = getAuthLockoutRemainingSec(authGuard);
      setLockoutSec(nextRem);
      if (nextRem <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [authGuard]);

  const handleToggleAuthTab = (type: 'login' | 'signup') => {
    setAuthError('');
    setAuthTab(type);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const remaining = getAuthLockoutRemainingSec(authGuard);
    if (remaining > 0) {
      setAuthError(`Too many failed attempts. Try again in ${remaining}s.`);
      return;
    }

    const email = sanitizeInputBounded(loginEmail, 120);
    if (!email || !loginPassword) {
      setAuthError('Enter your email and password.');
      return;
    }

    setIsSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email, loginPassword);
      const reset = recordAuthAttemptState(authGuard, true);
      setAuthGuard(reset);
      saveAuthGuard(reset);
    } catch (err) {
      const nextGuard = recordAuthAttemptState(authGuard, false);
      setAuthGuard(nextGuard);
      saveAuthGuard(nextGuard);
      const nextLock = getAuthLockoutRemainingSec(nextGuard);
      if (nextLock > 0) {
        setAuthError(
          `Account login temporarily locked for ${nextLock}s after repeated failed attempts.`
        );
      } else {
        setAuthError(mapAuthErrorSafe(err, 'login'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    setAuthError('');
    const email = sanitizeInputBounded(loginEmail, 120);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthError('Enter your registered email address first, then tap Forgot Password.');
      return;
    }
    setIsSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, email);
      triggerHaptic('success');
      showToast(`📧 Password reset link sent to ${email}! Check inbox/spam.`, 'success');
    } catch (err) {
      triggerHaptic('error');
      setAuthError(mapAuthErrorSafe(err, 'login'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDetectSignupGPS = () => {
    if (!navigator.geolocation) {
      showToast('GPS unavailable.', 'danger');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        const link = `https://www.google.com/maps?q=${lat},${lng}`;
        onDetectedGps(lat, lng, link);
        try {
          const resp = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`
          );
          const data = (await resp.json()) as { display_name?: string };
          setSignupAddress(
            data?.display_name
              ? sanitizeInputBounded(
                  data.display_name.split(',').slice(0, 3).join(', '),
                  180
                )
              : 'Gossaigaon Town'
          );
        } catch {
          setSignupAddress('Gossaigaon Town');
        }
        showToast('📍 GPS Attached!', 'success');
      },
      (err) => showToast('GPS Error: ' + err.message, 'danger'),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const name = sanitizeInputBounded(signupName, 80);
    const email = sanitizeInputBounded(signupEmail, 120);
    const phone = signupPhone.replace(/\D/g, '').slice(0, 10);
    const address = sanitizeInputBounded(signupAddress, 200);
    const refCodeInput = sanitizeInputBounded(signupReferral.toUpperCase(), 16);

    if (name.length < 2) {
      setAuthError('Enter your full name.');
      return;
    }
    if (!isValidIndianMobile(phone)) {
      setAuthError('Enter valid 10-digit mobile number!');
      return;
    }
    if (address.length < 5) {
      setAuthError('Enter complete delivery address!');
      return;
    }
    if (refCodeInput && !/^GB[A-Z0-9]{4,10}$/.test(refCodeInput)) {
      setAuthError('Invalid referral code format (e.g. GB123456).');
      return;
    }
    const pwdCheck = evaluatePasswordStrength(signupPassword);
    if (!pwdCheck.valid) {
      setAuthError(pwdCheck.reason || 'Choose a stronger password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, signupPassword);
      const newUid = cred.user.uid;
      const myRefCode = 'GB' + newUid.slice(0, 6).toUpperCase();
      let initialWallet = 0;

      if (refCodeInput && refCodeInput !== myRefCode && allowReferrals) {
        try {
          const allCustSnap = await get(ref(db, 'customers'));
          const allCust = (allCustSnap.val() || {}) as Record<string, { referralCode?: string }>;
          const referrerEntry = Object.entries(allCust).find(
            ([uid, c]) =>
              uid !== newUid &&
              (c.referralCode || 'GB' + uid.slice(0, 6).toUpperCase()) === refCodeInput
          );
          if (referrerEntry) {
            const [refUid] = referrerEntry;
            initialWallet = refereeBonus;
            if (referrerBonus > 0) {
              await runTransaction(ref(db, `customers/${refUid}/walletBalance`), (bal) =>
                Number(bal || 0) + referrerBonus
              );
              await push(ref(db, `walletTransactions/${refUid}`), {
                type: 'CREDIT',
                amount: referrerBonus,
                note: `Referral bonus for inviting ${name}`,
                createdAt: Date.now(),
              });
            }
          }
        } catch {
          // Ignore referral lookup failure when security rules restrict listing /customers
        }
      }

      await set(ref(db, 'customers/' + newUid), {
        name,
        email,
        phone,
        address,
        lat: detectedLat || null,
        lng: detectedLng || null,
        locationLink: detectedLocationLink || '',
        referralCode: myRefCode,
        referredBy: refCodeInput && refCodeInput !== myRefCode ? refCodeInput : '',
        walletBalance: initialWallet,
        blocked: false,
        createdAt: Date.now(),
      });

      if (initialWallet > 0) {
        await push(ref(db, `walletTransactions/${newUid}`), {
          type: 'CREDIT',
          amount: initialWallet,
          note: `Welcome Referral Bonus (${refCodeInput})`,
          createdAt: Date.now(),
        });
      }

      try {
        await sendEmailVerification(cred.user);
        triggerHaptic('success');
        showToast('📧 Verification link sent to your email inbox!', 'success');
      } catch {
        showToast('Account created! Tap Resend Email to verify your inbox.', 'info');
      }
    } catch (err) {
      setAuthError(mapAuthErrorSafe(err, 'signup'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError('');
    triggerHaptic('tap');
    setIsSubmitting(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const cred = await signInWithPopup(auth, provider);
      const user = cred.user;
      const uid = user.uid;
      const custRef = ref(db, `customers/${uid}`);
      const snap = await get(custRef);

      if (!snap.exists()) {
        const myRefCode = 'GB' + uid.slice(0, 6).toUpperCase();
        const fallbackName = sanitizeInputBounded(
          user.displayName || user.email?.split('@')[0] || 'Gossaigaon Customer',
          80
        );
        await set(custRef, {
          name: fallbackName,
          email: sanitizeInputBounded(user.email || '', 120),
          phone: sanitizeInputBounded((user.phoneNumber || '').replace(/\D/g, '').slice(-10), 10),
          address: sanitizeInputBounded(signupAddress || '', 200),
          lat: detectedLat || null,
          lng: detectedLng || null,
          locationLink: detectedLocationLink || '',
          referralCode: myRefCode,
          referredBy: '',
          walletBalance: 0,
          blocked: false,
          createdAt: Date.now(),
        });
      }

      triggerHaptic('success');
      showToast(`👋 Welcome ${user.displayName || 'back'}!`, 'success');
    } catch (err) {
      triggerHaptic('error');
      setAuthError(mapAuthErrorSafe(err, 'google'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const pwdStrength = evaluatePasswordStrength(signupPassword);

  return (
    <div id="auth-screen">
      <div className="auth-screen-inner">
      <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
        <div
          style={{
            width: '66px',
            height: '66px',
            borderRadius: '20px',
            background: 'var(--brand-green-light)',
            color: 'var(--brand-green)',
            fontSize: '2.1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 0.75rem',
            border: '2px solid var(--brand-green)',
          }}
        >
          🛒
        </div>
        <h1
          style={{ fontSize: '1.75rem', fontWeight: 900, letterSpacing: '-0.5px' }}
          id="auth-brand-title"
        >
          {brandName}
        </h1>
        <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', fontWeight: 600 }}>
          Local Grocery SuperApp • 15-Mins Express
        </p>
      </div>

      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={authTab === 'login'}
          className={`auth-tab ${authTab === 'login' ? 'active' : ''}`}
          id="tab-login-btn"
          onClick={() => handleToggleAuthTab('login')}
        >
          Sign In
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={authTab === 'signup'}
          className={`auth-tab ${authTab === 'signup' ? 'active' : ''}`}
          id="tab-signup-btn"
          onClick={() => handleToggleAuthTab('signup')}
        >
          Create Account
        </button>
      </div>

      {authTab === 'login' ? (
        <form id="login-form" onSubmit={handleLogin}>
          {lockoutSec > 0 && (
            <div className="security-alert-banner" role="status">
              <i className="fa-solid fa-shield-halved" aria-hidden="true" />
              <span>
                Too many wrong password attempts. Login locked for {lockoutSec}s.
              </span>
            </div>
          )}
          <div className="form-group">
            <label htmlFor="login-email">Email Address</label>
            <input
              type="email"
              id="login-email"
              className="form-input"
              placeholder="user@gmail.com"
              autoComplete="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <div className="password-input-wrap">
              <input
                type={showLoginPwd ? 'text' : 'password'}
                id="login-password"
                className="form-input"
                placeholder="••••••••"
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="password-eye-btn"
                aria-label={showLoginPwd ? 'Hide password' : 'Show password'}
                onClick={() => setShowLoginPwd((v) => !v)}
              >
                <i
                  className={showLoginPwd ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye'}
                  aria-hidden="true"
                />
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
              <button
                type="button"
                id="btn-forgot-password"
                disabled={isSubmitting}
                onClick={() => void handleForgotPassword()}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: 'var(--brand-green)',
                  fontSize: '0.76rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Forgot Password?
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={isSubmitting || lockoutSec > 0}
            className="btn btn-primary"
            style={{ marginTop: '0.5rem' }}
          >
            {lockoutSec > 0
              ? `Locked (${lockoutSec}s)`
              : isSubmitting
                ? 'Signing In...'
                : 'Continue to App'}
          </button>
        </form>
      ) : (
        <form id="signup-form" onSubmit={handleSignup}>
          <div className="form-group">
            <label htmlFor="signup-name">Full Name</label>
            <input
              type="text"
              id="signup-name"
              className="form-input"
              placeholder="Rahul Roy"
              value={signupName}
              onChange={(e) => setSignupName(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="signup-email">Email Address</label>
            <input
              type="email"
              id="signup-email"
              className="form-input"
              placeholder="name@email.com"
              autoComplete="email"
              value={signupEmail}
              onChange={(e) => setSignupEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="signup-phone">10-Digit Mobile Number</label>
            <input
              type="tel"
              id="signup-phone"
              className="form-input"
              placeholder="9876543210"
              maxLength={10}
              value={signupPhone}
              onChange={(e) => setSignupPhone(e.target.value.replace(/\D/g, ''))}
              required
            />
          </div>
          <div className="form-group">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '4px',
              }}
            >
              <label htmlFor="signup-address" style={{ margin: 0 }}>
                Delivery Address in Gossaigaon
              </label>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={handleDetectSignupGPS}
              >
                <i className="fa-solid fa-location-crosshairs" /> GPS
              </button>
            </div>
            <input
              type="text"
              id="signup-address"
              className="form-input"
              placeholder="Station Road, Gossaigaon"
              value={signupAddress}
              onChange={(e) => setSignupAddress(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="signup-referral">Referral Code (Optional)</label>
            <input
              type="text"
              id="signup-referral"
              className="form-input"
              style={{ textTransform: 'uppercase' }}
              placeholder="e.g. GB123456"
              value={signupReferral}
              onChange={(e) => setSignupReferral(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="signup-password">Create Password (8+ chars, letters & numbers)</label>
            <div className="password-input-wrap">
              <input
                type={showSignupPwd ? 'text' : 'password'}
                id="signup-password"
                className="form-input"
                placeholder="••••••••"
                autoComplete="new-password"
                minLength={8}
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="password-eye-btn"
                aria-label={showSignupPwd ? 'Hide password' : 'Show password'}
                onClick={() => setShowSignupPwd((v) => !v)}
              >
                <i
                  className={showSignupPwd ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye'}
                  aria-hidden="true"
                />
              </button>
            </div>
            {signupPassword.length > 0 && (
              <div
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  marginTop: '4px',
                  color:
                    pwdStrength.score === 3
                      ? 'var(--brand-green)'
                      : pwdStrength.score === 2
                        ? '#b45309'
                        : 'var(--danger)',
                }}
              >
                Strength: {pwdStrength.label}
                {pwdStrength.reason ? ` — ${pwdStrength.reason}` : ''}
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn btn-primary"
            style={{ marginTop: '0.5rem' }}
          >
            {isSubmitting ? 'Creating Account...' : 'Create Verified Account'}
          </button>
        </form>
      )}

      {authError && (
        <div
          id="auth-error"
          role="alert"
          style={{
            color: 'var(--danger)',
            fontSize: '0.82rem',
            textAlign: 'center',
            marginTop: '10px',
            fontWeight: 700,
          }}
        >
          {authError}
        </div>
      )}

      <div className="auth-divider" aria-hidden="true">
        <span>OR</span>
      </div>

      <button
        type="button"
        id="btn-google-signin"
        data-testid="google-signin-btn"
        className="auth-google-btn"
        disabled={isSubmitting}
        onClick={() => void handleGoogleSignIn()}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <path
            fill="#4285F4"
            d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.3 0 6.08-1.09 8.1-2.96l-3.88-3.05c-1.1.74-2.51 1.18-4.22 1.18-3.24 0-5.99-2.19-6.97-5.14H1.03v3.14C3.04 21.17 7.19 24 12 24Z"
          />
          <path
            fill="#FBBC05"
            d="M5.03 14.03A7.22 7.22 0 0 1 4.65 12c0-.71.13-1.4.38-2.03V6.83H1.03A11.98 11.98 0 0 0 0 12c0 1.94.46 3.77 1.03 5.17l4-3.14Z"
          />
          <path
            fill="#EA4335"
            d="M12 4.83c1.8 0 3.41.62 4.68 1.83l3.51-3.51C18.07 1.19 15.3 0 12 0 7.19 0 3.04 2.83 1.03 6.83l4 3.14c.98-2.95 3.73-5.14 6.97-5.14Z"
          />
        </svg>
        <span>{isSubmitting ? 'Connecting to Google...' : 'Continue with Google'}</span>
      </button>

      <PWAInstallButton />
      </div>
    </div>
  );
};

interface EmailVerificationScreenProps {
  brandName: string;
  userEmail: string;
  isChecking: boolean;
  isResending: boolean;
  resendCooldownSec: number;
  statusMessage: string;
  statusError: string;
  onCheckVerified: () => void;
  onResendVerification: () => void;
  onLogout: () => void;
}

export const EmailVerificationScreen: React.FC<EmailVerificationScreenProps> = ({
  brandName,
  userEmail,
  isChecking,
  isResending,
  resendCooldownSec,
  statusMessage,
  statusError,
  onCheckVerified,
  onResendVerification,
  onLogout,
}) => {
  return (
    <div
      id="email-verify-screen"
      data-testid="email-verify-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-verify-title"
    >
      <div className="verify-email-card">
        <div className="verify-email-icon" aria-hidden="true">
          <i className="fa-solid fa-envelope-circle-check" />
        </div>

        <span className="verify-email-badge">{brandName}</span>

        <h1 id="email-verify-title" className="verify-email-title">
          Verify Your Email Address
        </h1>

        <p className="verify-email-desc">
          We sent a verification link to{' '}
          <strong className="verify-email-address">{userEmail || 'your email'}</strong>.
          Open your inbox (or spam folder), click the link, then tap continue below.
        </p>

        {statusMessage && (
          <div className="verify-email-status success" role="status">
            <i className="fa-solid fa-circle-check" aria-hidden="true" />
            <span>{statusMessage}</span>
          </div>
        )}

        {statusError && (
          <div className="verify-email-status error" role="alert">
            <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
            <span>{statusError}</span>
          </div>
        )}

        <div className="verify-email-actions">
          <button
            type="button"
            id="btn-check-email-verified"
            data-testid="check-email-verified-btn"
            className="btn btn-primary"
            disabled={isChecking}
            onClick={onCheckVerified}
          >
            {isChecking ? (
              <>
                <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" /> Checking
                Status...
              </>
            ) : (
              <>
                <i className="fa-solid fa-shield-check" aria-hidden="true" /> I&apos;ve
                Verified, Continue
              </>
            )}
          </button>

          <button
            type="button"
            id="btn-resend-verification-email"
            data-testid="resend-verification-btn"
            className="btn btn-outline"
            disabled={isResending || resendCooldownSec > 0}
            onClick={onResendVerification}
          >
            {isResending ? (
              'Sending Email...'
            ) : resendCooldownSec > 0 ? (
              `Resend Link in ${resendCooldownSec}s`
            ) : (
              <>
                <i className="fa-solid fa-paper-plane" aria-hidden="true" /> Resend
                Verification Email
              </>
            )}
          </button>

          <button
            type="button"
            id="btn-verify-signout"
            className="btn btn-outline"
            style={{ color: 'var(--danger)', borderColor: '#fecaca' }}
            onClick={onLogout}
          >
            <i className="fa-solid fa-arrow-right-from-bracket" aria-hidden="true" />{' '}
            Use Different Account
          </button>
        </div>
      </div>
    </div>
  );
};
