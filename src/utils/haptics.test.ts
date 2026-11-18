import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HAPTIC_PATTERNS,
  isVibrationSupported,
  resolveHapticPattern,
  triggerHaptic,
} from './haptics';

test('resolveHapticPattern maps semantic presets and custom patterns cleanly', () => {
  assert.equal(resolveHapticPattern('tap'), 10);
  assert.equal(resolveHapticPattern('cartAdd'), 18);
  assert.equal(resolveHapticPattern('cartRemove'), 12);
  assert.deepEqual(resolveHapticPattern('favorite'), [12, 30, 18]);
  assert.deepEqual(resolveHapticPattern('success'), [25, 45, 50]);
  assert.deepEqual(resolveHapticPattern('error'), [35, 35, 35]);
  assert.deepEqual(resolveHapticPattern([15, 25]), [15, 25]);
});

test('triggerHaptic calls navigator.vibrate safely when supported and handles unsupported environments', () => {
  const calls: Array<number | number[]> = [];
  const mockNav = {
    vibrate: (pattern: number | number[]) => {
      calls.push(pattern);
      return true;
    },
  };

  assert.equal(isVibrationSupported(mockNav), true);
  assert.equal(triggerHaptic('cartAdd', mockNav), true);
  assert.equal(triggerHaptic('success', mockNav), true);
  assert.deepEqual(calls, [HAPTIC_PATTERNS.cartAdd, HAPTIC_PATTERNS.success]);

  // Missing navigator or missing vibrate method should fail safely without throwing
  assert.equal(isVibrationSupported(undefined), false);
  assert.equal(triggerHaptic('cartAdd', undefined), false);
  assert.equal(isVibrationSupported({}), false);
  assert.equal(triggerHaptic('tap', {}), false);

  // Exception thrown by vibrate should be caught gracefully
  const throwingNav = {
    vibrate: () => {
      throw new Error('Blocked before user gesture');
    },
  };
  assert.equal(triggerHaptic('success', throwingNav), false);
});
