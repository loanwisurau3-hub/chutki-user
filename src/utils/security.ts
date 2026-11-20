import type { CartItem, MenuItem, OrderRecord, Store } from '../types/bazar';
import { isValidUpiId, sanitizeText } from './bazarLogic';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const COMMON_WEAK_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty12',
  'qwerty123',
  'abcdefgh',
  '11111111',
  '00000000',
  'letmein1',
  'welcome1',
  'admin123',
]);

export function isForbiddenObjectKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(String(key));
}

export function sanitizeInputBounded(
  value: string | undefined | null,
  maxLength = 200
): string {
  const cleaned = sanitizeText(value)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '')
    .trim();
  return cleaned.slice(0, Math.max(1, maxLength));
}

export function sanitizeSafeUrl(
  url: string | undefined | null,
  allowRasterDataUrl = false
): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/[\u0000-\u001F\u007F]/.test(raw)) return '';

  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return raw;
  }

  if (allowRasterDataUrl) {
    if (/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(raw)) {
      return raw;
    }
    return '';
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.href;
    }
    return '';
  } catch {
    return '';
  }
}

export interface UtrValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateUpiUtr(
  utrRaw: string | undefined | null,
  usedUtrs?: Iterable<string>
): UtrValidationResult {
  const utr = String(utrRaw || '').trim();
  if (!/^\d{12}$/.test(utr)) {
    return {
      valid: false,
      reason: 'Enter a valid 12-digit numeric UPI UTR / Reference number.',
    };
  }

  if (/^(\d)\1{11}$/.test(utr)) {
    return {
      valid: false,
      reason: 'Repeated-digit UTRs (e.g. 000000000000) are blocked by anti-scam protection.',
    };
  }

  const knownSeqs = ['01234567890123456789', '98765432109876543210'];
  if (knownSeqs.some((seq) => seq.includes(utr))) {
    return {
      valid: false,
      reason: 'Sequential test UTRs are blocked. Enter your real 12-digit UPI transaction UTR.',
    };
  }

  if (usedUtrs) {
    for (const prev of usedUtrs) {
      if (String(prev || '').trim() === utr) {
        return {
          valid: false,
          reason: 'This UTR has already been used. Duplicate UTR replay is blocked.',
        };
      }
    }
  }

  return { valid: true };
}

export function collectKnownUtrs(
  orders: Record<string, Omit<OrderRecord, 'orderId'> | OrderRecord>,
  storedUtrs: string[] = []
): Set<string> {
  const set = new Set<string>();
  Object.values(orders || {}).forEach((o) => {
    const status = String(o.status || '').trim().toUpperCase();
    if (status === 'CANCELLED') return;
    const tx = String(o.transactionId || '').trim();
    if (/^\d{12}$/.test(tx)) set.add(tx);
  });
  storedUtrs.forEach((u) => {
    const clean = String(u || '').trim();
    if (/^\d{12}$/.test(clean)) set.add(clean);
  });
  return set;
}

export function buildVerifiedUpiUri(params: {
  payeeVpa: string;
  payeeName: string;
  amount: number;
  maxAmount?: number;
}): string | null {
  const vpa = String(params.payeeVpa || '').trim();
  const maxAmt = params.maxAmount ?? 50000;
  if (!isValidUpiId(vpa)) return null;
  if (!Number.isFinite(params.amount) || params.amount < 1 || params.amount > maxAmt) {
    return null;
  }
  const cleanName = sanitizeInputBounded(params.payeeName || 'GossaigaonBazar', 40).replace(
    /\s+/g,
    ''
  );
  return `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(cleanName)}&am=${params.amount.toFixed(2)}&cu=INR`;
}

export interface CartReconcileResult {
  safeCart: CartItem[];
  tamperedCount: number;
  removedCount: number;
}

export function sanitizeStoredCartItems(rawItems: unknown): CartItem[] {
  if (!Array.isArray(rawItems)) return [];
  const safe: CartItem[] = [];
  const seen = new Set<string>();

  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    const storeId = String(rec.storeId || '').trim();
    const itemId = String(rec.itemId || '').trim();
    if (
      !SAFE_ID_PATTERN.test(storeId) ||
      !SAFE_ID_PATTERN.test(itemId) ||
      isForbiddenObjectKey(storeId) ||
      isForbiddenObjectKey(itemId)
    ) {
      continue;
    }

    const qty = Math.min(99, Math.max(0, Math.floor(Number(rec.qty || 0))));
    const price = Number(rec.price);
    if (!Number.isFinite(price) || price < 0 || qty <= 0) continue;

    const dedupeKey = `${storeId}___${itemId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    safe.push({
      itemId,
      storeId,
      name: sanitizeInputBounded(String(rec.name || 'Grocery Item'), 120),
      storeName: sanitizeInputBounded(String(rec.storeName || 'Grocery Store'), 120),
      price: Number(price.toFixed(2)),
      qty,
      imageUrl: sanitizeSafeUrl(String(rec.imageUrl || ''), true),
    });

    if (safe.length >= 40) break;
  }

  return safe;
}

export function reconcileCartWithCatalog(
  cartItems: CartItem[],
  stores: Record<string, Store>,
  allMenus: Record<string, Record<string, Omit<MenuItem, 'itemId' | 'storeId'>>>
): CartReconcileResult {
  const safeCart: CartItem[] = [];
  let tamperedCount = 0;
  let removedCount = 0;
  const hasCatalog = Object.keys(stores).length > 0 && Object.keys(allMenus).length > 0;

  for (const item of cartItems) {
    const storeId = String(item.storeId || '').trim();
    const itemId = String(item.itemId || '').trim();
    const qty = Math.min(99, Math.max(0, Math.floor(Number(item.qty || 0))));
    if (!SAFE_ID_PATTERN.test(storeId) || !SAFE_ID_PATTERN.test(itemId) || qty <= 0) {
      removedCount += 1;
      continue;
    }

    if (!hasCatalog) {
      safeCart.push(item);
      continue;
    }

    const st = stores[storeId];
    const liveItem = allMenus[storeId]?.[itemId];
    if (!st || !liveItem) {
      removedCount += 1;
      continue;
    }

    const authoritativePrice = Number(liveItem.price || 0);
    if (!Number.isFinite(authoritativePrice) || authoritativePrice <= 0) {
      removedCount += 1;
      continue;
    }

    if (Math.abs(Number(item.price || 0) - authoritativePrice) > 0.01) {
      tamperedCount += 1;
    }

    safeCart.push({
      itemId,
      storeId,
      name: sanitizeInputBounded(liveItem.name || item.name || 'Grocery Item', 120),
      storeName: sanitizeInputBounded(st.name || item.storeName || 'Grocery Store', 120),
      price: Number(authoritativePrice.toFixed(2)),
      qty,
      imageUrl: sanitizeSafeUrl(liveItem.imageUrl || item.imageUrl || '', true),
    });
  }

  return { safeCart, tamperedCount, removedCount };
}

export interface PasswordStrengthResult {
  valid: boolean;
  score: 0 | 1 | 2 | 3;
  label: 'Too Weak' | 'Fair' | 'Strong';
  reason?: string;
}

export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
  const pwd = String(password || '');
  if (pwd.length < 8) {
    return {
      valid: false,
      score: 0,
      label: 'Too Weak',
      reason: 'Password must be at least 8 characters long.',
    };
  }
  if (COMMON_WEAK_PASSWORDS.has(pwd.toLowerCase())) {
    return {
      valid: false,
      score: 0,
      label: 'Too Weak',
      reason: 'This password is too common. Choose a stronger password.',
    };
  }
  const hasLetter = /[a-zA-Z]/.test(pwd);
  const hasDigit = /\d/.test(pwd);
  const hasSymbolOrUpper = /[^a-zA-Z0-9]/.test(pwd) || (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd));

  if (!hasLetter || !hasDigit) {
    return {
      valid: false,
      score: 1,
      label: 'Too Weak',
      reason: 'Password must include both letters and numbers.',
    };
  }

  if (pwd.length >= 10 && hasSymbolOrUpper) {
    return { valid: true, score: 3, label: 'Strong' };
  }

  return { valid: true, score: 2, label: 'Fair' };
}

export interface AuthAttemptState {
  failedCount: number;
  lockedUntil: number;
  lockoutTier: number;
}

export function getAuthLockoutRemainingSec(
  state: AuthAttemptState,
  now = Date.now()
): number {
  if (!state.lockedUntil || state.lockedUntil <= now) return 0;
  return Math.ceil((state.lockedUntil - now) / 1000);
}

export function recordAuthAttemptState(
  prev: AuthAttemptState,
  success: boolean,
  now = Date.now()
): AuthAttemptState {
  if (success) {
    return { failedCount: 0, lockedUntil: 0, lockoutTier: 0 };
  }
  const nextFailed = (prev.failedCount || 0) + 1;
  if (nextFailed >= 5) {
    const tier = Math.min(4, (prev.lockoutTier || 0) + 1);
    const lockDurationMs = Math.min(300_000, 30_000 * 2 ** (tier - 1));
    return {
      failedCount: 0,
      lockedUntil: now + lockDurationMs,
      lockoutTier: tier,
    };
  }
  return {
    failedCount: nextFailed,
    lockedUntil: prev.lockedUntil && prev.lockedUntil > now ? prev.lockedUntil : 0,
    lockoutTier: prev.lockoutTier || 0,
  };
}

export function requiresStrictEmailVerification(params: {
  isDemoMode: boolean;
  user: {
    emailVerified?: boolean;
    providerData?: Array<{ providerId?: string | null } | null>;
  } | null;
}): boolean {
  if (params.isDemoMode || !params.user) return false;
  const hasGoogleProvider =
    Array.isArray(params.user.providerData) &&
    params.user.providerData.some((p) => p?.providerId === 'google.com');
  if (hasGoogleProvider) return false;
  return params.user.emailVerified !== true;
}

export function mapAuthErrorSafe(
  err: unknown,
  mode: 'login' | 'signup' | 'google' | 'verification'
): string {
  const msg = String(err instanceof Error ? err.message : err || '').toLowerCase();
  if (msg.includes('too-many-requests')) {
    return 'Too many attempts detected. Please wait a minute before trying again.';
  }
  if (msg.includes('network-request-failed')) {
    return 'Network unavailable. Check your internet connection and retry.';
  }
  if (mode === 'google') {
    if (msg.includes('popup-closed-by-user')) {
      return 'Google sign-in popup was closed before completing.';
    }
    if (msg.includes('cancelled-popup-request')) {
      return 'Sign-in request was replaced. Please tap Continue with Google again.';
    }
    if (msg.includes('popup-blocked')) {
      return 'Popup was blocked by your browser. Allow popups for this site and try again.';
    }
    if (msg.includes('unauthorized-domain')) {
      return 'This domain is not yet authorized for Google Sign-In in Firebase Console. Use Email login or whitelist this domain.';
    }
    if (msg.includes('operation-not-supported-in-this-environment')) {
      return 'Google popup is restricted in this embedded frame. Open the app in a full browser tab or use Email login.';
    }
    if (msg.includes('account-exists-with-different-credential')) {
      return 'An account already exists with this email using password login.';
    }
    return 'Google Sign-In could not be completed. Please try again.';
  }
  if (mode === 'verification') {
    if (msg.includes('user-token-expired') || msg.includes('requires-recent-login')) {
      return 'Session expired. Please sign out and sign in again to resend verification.';
    }
    return 'Could not complete email verification check right now. Please try again shortly.';
  }
  if (mode === 'login') {
    if (
      msg.includes('invalid-credential') ||
      msg.includes('wrong-password') ||
      msg.includes('user-not-found') ||
      msg.includes('invalid-email')
    ) {
      return 'Invalid email or password. Please verify and try again.';
    }
    return 'Sign in could not be completed. Please try again.';
  }
  if (msg.includes('email-already-in-use')) {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (msg.includes('weak-password')) {
    return 'Password is too weak. Use at least 8 characters with letters and numbers.';
  }
  if (msg.includes('invalid-email')) {
    return 'Enter a valid email address.';
  }
  return 'Account creation failed. Please check your details and try again.';
}

export function evaluateWalletWithdrawalSafety(params: {
  amount: number;
  balance: number;
  minWithdraw: number;
  maxWithdraw: number;
  upiId: string;
  lastWithdrawAt: number;
  now?: number;
}): { allowed: boolean; reason?: string } {
  const now = params.now ?? Date.now();
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    return { allowed: false, reason: 'Enter a valid positive withdrawal amount.' };
  }
  if (params.amount < params.minWithdraw || params.amount > params.maxWithdraw) {
    return {
      allowed: false,
      reason: `Withdraw limit: ₹${params.minWithdraw} to ₹${params.maxWithdraw}!`,
    };
  }
  if (params.amount > params.balance) {
    return { allowed: false, reason: 'Insufficient wallet balance!' };
  }
  if (!isValidUpiId(params.upiId)) {
    return { allowed: false, reason: 'Enter a valid UPI ID (e.g. 9876543210@paytm)!' };
  }
  if (params.lastWithdrawAt > 0 && now - params.lastWithdrawAt < 60_000) {
    const waitSec = Math.ceil((60_000 - (now - params.lastWithdrawAt)) / 1000);
    return {
      allowed: false,
      reason: `Security cooldown: wait ${waitSec}s before another withdrawal request.`,
    };
  }
  return { allowed: true };
}

export interface CardValidationResult {
  valid: boolean;
  last4?: string;
  brand?: 'VISA' | 'MASTERCARD' | 'RUPAY' | 'CARD';
  reason?: string;
}

export function validatePaymentCard(params: {
  holderName: string;
  cardNumber: string;
  expiry: string;
  cvv: string;
  now?: Date;
}): CardValidationResult {
  const name = sanitizeInputBounded(params.holderName, 60);
  if (name.length < 2) {
    return { valid: false, reason: 'Enter cardholder name (minimum 2 characters).' };
  }
  const digits = String(params.cardNumber || '').replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) {
    return { valid: false, reason: 'Enter a valid 16-digit card number.' };
  }
  // Luhn validation
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = parseInt(digits[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  if (sum % 10 !== 0) {
    return { valid: false, reason: 'Invalid card number check digit. Please recheck.' };
  }

  const expMatch = /^(\d{2})\/(\d{2})$/.exec(String(params.expiry || '').trim());
  if (!expMatch) {
    return { valid: false, reason: 'Enter card expiry in MM/YY format.' };
  }
  const mm = parseInt(expMatch[1], 10);
  const yy = 2000 + parseInt(expMatch[2], 10);
  if (mm < 1 || mm > 12) {
    return { valid: false, reason: 'Expiry month must be between 01 and 12.' };
  }
  const nowDate = params.now || new Date();
  const curYear = nowDate.getFullYear();
  const curMonth = nowDate.getMonth() + 1;
  if (yy < curYear || (yy === curYear && mm < curMonth)) {
    return { valid: false, reason: 'This card has expired.' };
  }

  const cvvDigits = String(params.cvv || '').replace(/\D/g, '');
  if (cvvDigits.length < 3 || cvvDigits.length > 4) {
    return { valid: false, reason: 'Enter a valid 3 or 4-digit CVV.' };
  }

  let brand: CardValidationResult['brand'] = 'CARD';
  if (digits.startsWith('4')) brand = 'VISA';
  else if (/^(5[1-5]|2[2-7])/.test(digits)) brand = 'MASTERCARD';
  else if (/^(60|65|81|82|508)/.test(digits)) brand = 'RUPAY';

  return {
    valid: true,
    last4: digits.slice(-4),
    brand,
  };
}

const SPAM_PHISHING_URL_REGEX = /(https?:\/\/|www\.|bit\.ly\/|tinyurl\.com\/|t\.me\/|wa\.me\/)/i;
const SCAM_PHRASE_REGEX =
  /\b(send\s*otp|share\s*otp|verify\s*kyc|urgent\s*kyc|claim\s*prize|lottery\s*win|bank\s*pin|cvv\s*number|card\s*pin)\b/i;

export interface SpamContentCheckResult {
  safe: boolean;
  reason?: string;
}

export function detectSpamContent(rawText: string | undefined | null): SpamContentCheckResult {
  const text = String(rawText || '').trim();
  if (!text) return { safe: true };

  if (SPAM_PHISHING_URL_REGEX.test(text)) {
    return {
      safe: false,
      reason: 'External links / URLs are blocked by anti-phishing & spam protection.',
    };
  }
  if (SCAM_PHRASE_REGEX.test(text)) {
    return {
      safe: false,
      reason: 'Suspicious phishing/OTP scam phrase detected and blocked.',
    };
  }
  if (/(.)\1{9,}/.test(text)) {
    return {
      safe: false,
      reason: 'Excessive repeated characters detected. Please enter meaningful text.',
    };
  }
  return { safe: true };
}

export function validateScreenshotPayload(
  dataUrl: string | undefined | null,
  maxBytes = 2_200_000
): { valid: boolean; reason?: string } {
  const raw = String(dataUrl || '').trim();
  if (!raw) return { valid: true };

  if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(raw)) {
    return {
      valid: false,
      reason: 'Invalid payment proof format. Upload a valid PNG, JPG, or WEBP screenshot.',
    };
  }
  if (raw.length > maxBytes) {
    return {
      valid: false,
      reason: 'Payment screenshot exceeds security size limit. Please choose a smaller image.',
    };
  }
  return { valid: true };
}

export interface RateLimitCheckResult {
  allowed: boolean;
  waitSec: number;
  reason?: string;
}

export function evaluateActionRateLimit(
  historyMap: Record<string, number[]>,
  actionKey: string,
  cooldownMs: number,
  maxPerWindow = 5,
  windowMs = 300_000,
  now = Date.now()
): RateLimitCheckResult {
  const cleanCooldown = Math.max(0, Number(cooldownMs || 0));
  const list = (historyMap[actionKey] || []).filter((ts) => now - ts <= windowMs);
  historyMap[actionKey] = list;

  if (list.length > 0 && cleanCooldown > 0) {
    const lastTs = list[list.length - 1];
    const diff = now - lastTs;
    if (diff < cleanCooldown) {
      const waitSec = Math.max(1, Math.ceil((cleanCooldown - diff) / 1000));
      return {
        allowed: false,
        waitSec,
        reason: `Anti-spam cooldown: please wait ${waitSec}s before trying again.`,
      };
    }
  }

  if (list.length >= maxPerWindow) {
    const oldest = list[0];
    const waitSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    return {
      allowed: false,
      waitSec,
      reason: `Rate limit reached. Please wait ${waitSec}s before submitting again.`,
    };
  }

  return { allowed: true, waitSec: 0 };
}

export function recordRateLimitedAction(
  historyMap: Record<string, number[]>,
  actionKey: string,
  now = Date.now(),
  windowMs = 300_000
): void {
  const existing = (historyMap[actionKey] || []).filter((ts) => now - ts <= windowMs);
  existing.push(now);
  historyMap[actionKey] = existing;
}

export interface OrderFraudShieldResult {
  block: boolean;
  reason?: string;
  isSpamSuspect: boolean;
  spamReason: string;
}

export function evaluateOrderFraudShield(params: {
  orders: Record<string, Omit<OrderRecord, 'orderId'> | OrderRecord>;
  totalAmount: number;
  paymentMode: string;
  customerBlocked?: boolean;
  spamScore?: number;
  strictAntiScamShield?: boolean;
  codMaxOrderAmount?: number;
  maxActiveOrdersPerUser?: number;
  blockCodForFlaggedUsers?: boolean;
  spamAutoBlockThreshold?: number;
  now?: number;
}): OrderFraudShieldResult {
  const now = params.now ?? Date.now();
  if (params.customerBlocked === true) {
    return {
      block: true,
      reason: '🚫 Account suspended by security shield. Contact Support.',
      isSpamSuspect: true,
      spamReason: 'Account blocked',
    };
  }

  const allOrders = Object.values(params.orders || {});
  const activeStatuses = new Set([
    'PLACED',
    'ACCEPTED',
    'PREPARING',
    'PACKING',
    'READY_FOR_PICKUP',
    'OUT_FOR_DELIVERY',
  ]);
  const activeCount = allOrders.filter((o) =>
    activeStatuses.has(String(o.status || '').toUpperCase().trim())
  ).length;
  const maxActive = Math.max(1, Number(params.maxActiveOrdersPerUser || 5));

  if (params.strictAntiScamShield !== false && activeCount >= maxActive) {
    return {
      block: true,
      reason: `🛡️ Limit of ${maxActive} active orders reached. Complete or cancel an existing order first.`,
      isSpamSuspect: true,
      spamReason: `Excessive concurrent active orders (${activeCount})`,
    };
  }

  const recentCodCancels = allOrders.filter(
    (o) =>
      String(o.paymentMode || '').toUpperCase() === 'COD' &&
      String(o.status || '').toUpperCase().trim() === 'CANCELLED' &&
      now - Number(o.createdAt || 0) <= 7 * 24 * 3600 * 1000
  ).length;

  const threshold = Math.max(1, Number(params.spamAutoBlockThreshold || 3));
  const userSpamScore = Number(params.spamScore || 0);

  if (params.paymentMode === 'COD' && params.strictAntiScamShield !== false) {
    if (
      params.blockCodForFlaggedUsers !== false &&
      (userSpamScore >= threshold || recentCodCancels >= threshold)
    ) {
      return {
        block: true,
        reason:
          '🛡️ Cash on Delivery temporarily restricted due to repeated cancellations or spam flags. Pay via UPI, Card, or Wallet.',
        isSpamSuspect: true,
        spamReason: 'COD restricted for flagged abuse/cancellations',
      };
    }

    const codCap = Number(params.codMaxOrderAmount || 3000);
    if (codCap > 0 && params.totalAmount > codCap) {
      return {
        block: true,
        reason: `🛡️ Cash on Delivery is capped at ₹${codCap}. Choose UPI, Card, or Wallet for orders above ₹${codCap}.`,
        isSpamSuspect: false,
        spamReason: '',
      };
    }
  }

  return {
    block: false,
    isSpamSuspect: false,
    spamReason: '',
  };
}

export function verifyHoneypotClean(botTrapValue: string | undefined | null): boolean {
  return String(botTrapValue || '').trim().length === 0;
}

export function stripForbiddenKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripForbiddenKeysDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const cleanObj: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
      if (!isForbiddenObjectKey(k)) {
        cleanObj[k] = stripForbiddenKeysDeep(v);
      }
    });
    return cleanObj as T;
  }
  return value;
}
