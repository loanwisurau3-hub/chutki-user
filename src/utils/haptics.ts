export type HapticPattern = number | number[];

export type HapticPreset =
  | 'tap'
  | 'cartAdd'
  | 'cartRemove'
  | 'favorite'
  | 'success'
  | 'warning'
  | 'error'
  | 'notification';

export const HAPTIC_PATTERNS: Record<HapticPreset, HapticPattern> = {
  tap: 10,
  cartAdd: 18,
  cartRemove: 12,
  favorite: [12, 30, 18],
  success: [25, 45, 50],
  warning: [30, 35, 30],
  error: [35, 35, 35],
  notification: [20, 40, 20],
};

export interface VibrateCapableNavigator {
  vibrate?: (pattern: VibratePattern) => boolean;
}

export function resolveHapticPattern(
  presetOrPattern: HapticPreset | HapticPattern
): HapticPattern {
  if (typeof presetOrPattern === 'string') {
    return HAPTIC_PATTERNS[presetOrPattern];
  }
  return presetOrPattern;
}

export function isVibrationSupported(
  nav: VibrateCapableNavigator | undefined = typeof navigator !== 'undefined'
    ? navigator
    : undefined
): boolean {
  return Boolean(nav && typeof nav.vibrate === 'function');
}

export function triggerHaptic(
  presetOrPattern: HapticPreset | HapticPattern,
  nav: VibrateCapableNavigator | undefined = typeof navigator !== 'undefined'
    ? navigator
    : undefined
): boolean {
  if (!isVibrationSupported(nav)) return false;

  const pattern = resolveHapticPattern(presetOrPattern);
  try {
    return Boolean(nav!.vibrate!(pattern));
  } catch {
    return false;
  }
}
