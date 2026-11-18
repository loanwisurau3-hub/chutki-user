import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVerifiedUpiUri,
  collectKnownUtrs,
  detectSpamContent,
  evaluateActionRateLimit,
  evaluateOrderFraudShield,
  evaluatePasswordStrength,
  evaluateWalletWithdrawalSafety,
  getAuthLockoutRemainingSec,
  isForbiddenObjectKey,
  mapAuthErrorSafe,
  reconcileCartWithCatalog,
  recordAuthAttemptState,
  recordRateLimitedAction,
  requiresStrictEmailVerification,
  sanitizeInputBounded,
  sanitizeSafeUrl,
  sanitizeStoredCartItems,
  stripForbiddenKeysDeep,
  validatePaymentCard,
  validateScreenshotPayload,
  validateUpiUtr,
  verifyHoneypotClean,
} from './security';
import type { Store } from '../types/bazar';

test('blocks prototype pollution keys, unsafe URLs, and script injection payloads', () => {
  assert.equal(isForbiddenObjectKey('__proto__'), true);
  assert.equal(isForbiddenObjectKey('constructor'), true);
  assert.equal(isForbiddenObjectKey('store_1'), false);

  assert.equal(
    sanitizeInputBounded('<script>alert(1)</script>javascript:steal()\x00', 50),
    'scriptalert(1)/scriptsteal()'
  );

  assert.equal(sanitizeSafeUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeSafeUrl('data:text/html,<script>alert(1)</script>', true), '');
  assert.equal(sanitizeSafeUrl('data:image/svg+xml;base64,PHN2Zz4=', true), '');
  assert.equal(sanitizeSafeUrl('data:image/png;base64,iVBORw0KGgo=', true), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(sanitizeSafeUrl('https://cdn.example.com/milk.png'), 'https://cdn.example.com/milk.png');
  assert.equal(sanitizeSafeUrl('//evil.com/phish.png'), '');
});

test('validateUpiUtr blocks fake repeated/sequential UTRs and duplicate UTR replay scams', () => {
  assert.equal(validateUpiUtr('431982741052').valid, true);
  assert.equal(validateUpiUtr('12345').valid, false);
  assert.equal(validateUpiUtr('43198274105A').valid, false);
  assert.equal(validateUpiUtr('000000000000').valid, false);
  assert.equal(validateUpiUtr('999999999999').valid, false);
  assert.equal(validateUpiUtr('123456789012').valid, false);
  assert.equal(validateUpiUtr('987654321098').valid, false);

  const used = collectKnownUtrs(
    {
      o1: {
        customerUid: 'u1',
        restaurantId: 's1',
        items: [],
        totalAmount: 100,
        status: 'PLACED',
        transactionId: '431982741052',
      },
    },
    ['551122334455']
  );
  const replay = validateUpiUtr('431982741052', used);
  assert.equal(replay.valid, false);
  assert.ok(replay.reason?.includes('already been used'));
  assert.equal(validateUpiUtr('551122334455', used).valid, false);
});

test('buildVerifiedUpiUri rejects malformed merchant VPAs and out-of-range amounts', () => {
  const ok = buildVerifiedUpiUri({
    payeeVpa: 'gossaigaonbazar@apl',
    payeeName: 'Gossaigaon Bazar',
    amount: 245.5,
  });
  assert.ok(ok?.startsWith('upi://pay?pa=gossaigaonbazar%40apl'));
  assert.equal(
    buildVerifiedUpiUri({ payeeVpa: 'scammer-invalid', payeeName: 'Scam', amount: 100 }),
    null
  );
  assert.equal(
    buildVerifiedUpiUri({ payeeVpa: 'gossaigaonbazar@apl', payeeName: 'Scam', amount: -50 }),
    null
  );
});

test('sanitizeStoredCartItems and reconcileCartWithCatalog stop price tampering', () => {
  const sanitized = sanitizeStoredCartItems([
    {
      itemId: 'item_1',
      storeId: 'store_1',
      name: 'Fresh <b>Tomato</b>',
      price: 1,
      qty: 2,
      imageUrl: 'javascript:alert(1)',
      storeName: 'Fresh Mart',
    },
    {
      itemId: '__proto__',
      storeId: 'store_1',
      name: 'Bad',
      price: 10,
      qty: 1,
      imageUrl: '',
      storeName: 'Bad',
    },
  ]);

  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].imageUrl, '');
  assert.equal(sanitized[0].name, 'Fresh bTomato/b');

  const stores: Record<string, Store> = {
    store_1: { name: 'Gossaigaon Fresh Mart', approved: true, isOpen: true },
  };
  const menus = {
    store_1: {
      item_1: { name: 'Farm Fresh Red Tomato', price: 38, available: true, adminApproved: true },
    },
  };

  const reconciled = reconcileCartWithCatalog(sanitized, stores, menus);
  assert.equal(reconciled.tamperedCount, 1);
  assert.equal(reconciled.removedCount, 0);
  assert.equal(reconciled.safeCart[0].price, 38);
  assert.equal(reconciled.safeCart[0].name, 'Farm Fresh Red Tomato');
});

test('password strength, login brute-force lockout, and safe auth error mapping work properly', () => {
  assert.equal(evaluatePasswordStrength('123456').valid, false);
  assert.equal(evaluatePasswordStrength('password123').valid, false);
  assert.equal(evaluatePasswordStrength('abcdefgh').valid, false);
  assert.equal(evaluatePasswordStrength('bazar2026').valid, true);
  assert.equal(evaluatePasswordStrength('Gossaigaon@2026').label, 'Strong');

  let state = { failedCount: 0, lockedUntil: 0, lockoutTier: 0 };
  const t0 = 1_700_000_000_000;
  for (let i = 0; i < 4; i += 1) {
    state = recordAuthAttemptState(state, false, t0);
    assert.equal(getAuthLockoutRemainingSec(state, t0), 0);
  }
  state = recordAuthAttemptState(state, false, t0);
  assert.equal(getAuthLockoutRemainingSec(state, t0), 30);

  state = recordAuthAttemptState(state, true, t0 + 40_000);
  assert.equal(state.failedCount, 0);
  assert.equal(getAuthLockoutRemainingSec(state, t0 + 40_000), 0);

  assert.equal(
    mapAuthErrorSafe(new Error('Firebase: Error (auth/user-not-found).'), 'login'),
    'Invalid email or password. Please verify and try again.'
  );
  assert.ok(
    mapAuthErrorSafe(new Error('Firebase: Error (auth/popup-blocked).'), 'google').includes('blocked')
  );
  assert.ok(
    mapAuthErrorSafe(new Error('Firebase: Error (auth/unauthorized-domain).'), 'google').includes('authorized')
  );
});

test('requiresStrictEmailVerification gates unverified password users while allowing verified, Google, and demo users', () => {
  assert.equal(requiresStrictEmailVerification({ isDemoMode: true, user: null }), false);
  assert.equal(
    requiresStrictEmailVerification({
      isDemoMode: false,
      user: { emailVerified: false, providerData: [{ providerId: 'password' }] },
    }),
    true
  );
  assert.equal(
    requiresStrictEmailVerification({
      isDemoMode: false,
      user: { emailVerified: true, providerData: [{ providerId: 'password' }] },
    }),
    false
  );
  assert.equal(
    requiresStrictEmailVerification({
      isDemoMode: false,
      user: { emailVerified: false, providerData: [{ providerId: 'google.com' }] },
    }),
    false
  );
});

test('evaluateWalletWithdrawalSafety blocks rapid duplicate withdrawals and invalid amounts', () => {
  const now = 1_700_000_100_000;
  const rapid = evaluateWalletWithdrawalSafety({
    amount: 100,
    balance: 500,
    minWithdraw: 50,
    maxWithdraw: 5000,
    upiId: '9876543210@paytm',
    lastWithdrawAt: now - 15_000,
    now,
  });
  assert.equal(rapid.allowed, false);
  assert.ok(rapid.reason?.includes('cooldown'));

  const ok = evaluateWalletWithdrawalSafety({
    amount: 100,
    balance: 500,
    minWithdraw: 50,
    maxWithdraw: 5000,
    upiId: '9876543210@paytm',
    lastWithdrawAt: now - 90_000,
    now,
  });
  assert.equal(ok.allowed, true);
});

test('validatePaymentCard validates Luhn checksum, expiry date, CVV, and card brand without storing PAN', () => {
  const validVisa = validatePaymentCard({
    holderName: 'Rahul Roy',
    cardNumber: '4111 1111 1111 1111',
    expiry: '12/30',
    cvv: '123',
    now: new Date(2026, 10, 15),
  });
  assert.equal(validVisa.valid, true);
  assert.equal(validVisa.last4, '1111');
  assert.equal(validVisa.brand, 'VISA');

  const badLuhn = validatePaymentCard({
    holderName: 'Rahul Roy',
    cardNumber: '4111 1111 1111 1112',
    expiry: '12/30',
    cvv: '123',
    now: new Date(2026, 10, 15),
  });
  assert.equal(badLuhn.valid, false);

  const expired = validatePaymentCard({
    holderName: 'Rahul Roy',
    cardNumber: '4111 1111 1111 1111',
    expiry: '01/25',
    cvv: '123',
    now: new Date(2026, 10, 15),
  });
  assert.equal(expired.valid, false);
});

test('detectSpamContent, validateScreenshotPayload, rate-limit, and prototype stripper block abuse and hacker payloads', () => {
  assert.equal(detectSpamContent('Fresh tomatoes delivered fast!').safe, true);
  assert.equal(detectSpamContent('Claim prize at https://evil.example.com').safe, false);
  assert.equal(detectSpamContent('Please send otp to verify KYC').safe, false);
  assert.equal(detectSpamContent('spaaaaaaaaaaam').safe, false);

  assert.equal(validateScreenshotPayload('data:image/png;base64,iVBORw0KGgo=').valid, true);
  assert.equal(validateScreenshotPayload('data:image/svg+xml;base64,PHN2Zz4=').valid, false);
  assert.equal(validateScreenshotPayload('javascript:alert(1)').valid, false);

  const history: Record<string, number[]> = {};
  const t0 = 1_700_000_000_000;
  assert.equal(evaluateActionRateLimit(history, 'FEEDBACK', 15_000, 4, 300_000, t0).allowed, true);
  recordRateLimitedAction(history, 'FEEDBACK', t0);
  const blockedCooldown = evaluateActionRateLimit(history, 'FEEDBACK', 15_000, 4, 300_000, t0 + 3_000);
  assert.equal(blockedCooldown.allowed, false);
  assert.equal(blockedCooldown.waitSec, 12);
  assert.equal(evaluateActionRateLimit(history, 'FEEDBACK', 15_000, 4, 300_000, t0 + 16_000).allowed, true);

  assert.equal(verifyHoneypotClean(''), true);
  assert.equal(verifyHoneypotClean('bot@spam.ru'), false);

  const rawUntrusted = JSON.parse('{"name":"Order","__proto__":{"isAdmin":true},"nested":{"constructor":"evil","ok":1}}');
  const cleaned = stripForbiddenKeysDeep(rawUntrusted) as Record<string, unknown>;
  assert.equal(Object.prototype.hasOwnProperty.call(cleaned, '__proto__'), false);
  assert.equal((cleaned.nested as Record<string, unknown>).ok, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(cleaned.nested as object, 'constructor'), false);
});

test('evaluateOrderFraudShield stops suspended accounts, active order flooding, and COD scam patterns while allowing prepaid', () => {
  const now = 1_700_000_500_000;

  assert.equal(
    evaluateOrderFraudShield({
      orders: {},
      totalAmount: 100,
      paymentMode: 'COD',
      customerBlocked: true,
      now,
    }).block,
    true
  );

  // Concurrent active order cap
  const fiveActive = {
    o1: { customerUid: 'u1', restaurantId: 's1', items: [], totalAmount: 100, status: 'PLACED', createdAt: now - 1000 },
    o2: { customerUid: 'u1', restaurantId: 's1', items: [], totalAmount: 100, status: 'PREPARING', createdAt: now - 2000 },
    o3: { customerUid: 'u1', restaurantId: 's1', items: [], totalAmount: 100, status: 'PACKING', createdAt: now - 3000 },
    o4: { customerUid: 'u1', restaurantId: 's1', items: [], totalAmount: 100, status: 'OUT_FOR_DELIVERY', createdAt: now - 4000 },
    o5: { customerUid: 'u1', restaurantId: 's1', items: [], totalAmount: 100, status: 'ACCEPTED', createdAt: now - 5000 },
  };
  assert.equal(
    evaluateOrderFraudShield({
      orders: fiveActive,
      totalAmount: 150,
      paymentMode: 'UPI',
      maxActiveOrdersPerUser: 5,
      now,
    }).block,
    true
  );

  // COD restricted after 3+ recent COD cancellations, but prepaid UPI allowed!
  const threeCancelledCod = {
    c1: { customerUid: 'u1', restaurantId: 's1', items: [], totalAmount: 200, paymentMode: 'COD', status: 'CANCELLED', createdAt: now - 10000 },
    c2: { customerUid: 'u1', restaurantId: 's1', items: [], totalAmount: 200, paymentMode: 'COD', status: 'CANCELLED', createdAt: now - 20000 },
    c3: { customerUid: 'u1', restaurantId: 's1', items: [], totalAmount: 200, paymentMode: 'COD', status: 'CANCELLED', createdAt: now - 30000 },
  };
  assert.equal(
    evaluateOrderFraudShield({
      orders: threeCancelledCod,
      totalAmount: 250,
      paymentMode: 'COD',
      blockCodForFlaggedUsers: true,
      spamAutoBlockThreshold: 3,
      now,
    }).block,
    true
  );
  assert.equal(
    evaluateOrderFraudShield({
      orders: threeCancelledCod,
      totalAmount: 250,
      paymentMode: 'UPI',
      blockCodForFlaggedUsers: true,
      spamAutoBlockThreshold: 3,
      now,
    }).block,
    false
  );

  // Oversized COD blocked (> codMaxOrderAmount), prepaid allowed
  assert.equal(
    evaluateOrderFraudShield({
      orders: {},
      totalAmount: 4500,
      paymentMode: 'COD',
      codMaxOrderAmount: 3000,
      now,
    }).block,
    true
  );
  assert.equal(
    evaluateOrderFraudShield({
      orders: {},
      totalAmount: 4500,
      paymentMode: 'CARD',
      codMaxOrderAmount: 3000,
      now,
    }).block,
    false
  );
});

