/**
 * Haptic Feedback Service using the HTML5 Vibration API (navigator.vibrate)
 * Provides tactile sensory feedback for critical privacy, cryptographic, and safety actions.
 */

// Check if Vibration API is available in the current browser environment
export const isVibrationSupported = (): boolean => {
  return typeof window !== 'undefined' && 'navigator' in window && typeof navigator.vibrate === 'function';
};

// Check if user has enabled haptics (defaults to true)
export const areHapticsEnabled = (): boolean => {
  try {
    const saved = localStorage.getItem('gayze_haptics_enabled');
    if (saved !== null) {
      return JSON.parse(saved);
    }
  } catch {
    // Ignore error
  }
  return true;
};

export const setHapticsEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem('gayze_haptics_enabled', JSON.stringify(enabled));
  } catch {
    // Ignore error
  }
};

/**
 * Base vibration helper with safety check & fallback logging
 */
export const triggerVibration = (pattern: number | number[]): boolean => {
  if (!areHapticsEnabled()) return false;

  if (isVibrationSupported()) {
    try {
      return navigator.vibrate(pattern);
    } catch (e) {
      console.warn('Vibration API error:', e);
    }
  }
  return false;
};

/**
 * Triggered upon successful QR in-person key exchange and cryptographic verification.
 * Pattern: Confident double pulse (short buzz, brief pause, prolonged affirmative buzz).
 */
export const hapticQRHandshake = (): void => {
  triggerVibration([70, 50, 160]);
};

/**
 * Triggered when the Safety Check-in Beacon is nearing expiration (< 60s remaining).
 * Pattern: Urgent pulsing heartbeat warning pattern.
 */
export const hapticTimerWarning = (): void => {
  triggerVibration([180, 80, 180, 80, 250]);
};

/**
 * Triggered when the Safety Beacon expires or emergency distress alert is triggered.
 * Pattern: Intense repeated distress alarm pattern.
 */
export const hapticTimerExpired = (): void => {
  triggerVibration([300, 100, 300, 100, 500]);
};

/**
 * Triggered when an end-to-end encrypted message is decrypted locally on device.
 * Pattern: Crisp, subtle cryptographic click.
 */
export const hapticMessageDecrypted = (): void => {
  triggerVibration([35]);
};

/**
 * Triggered when activating/deactivating the Discreet Camouflage Mask or purging device cache.
 * Pattern: Dual firm buzz.
 */
export const hapticSensitiveAction = (): void => {
  triggerVibration([60, 40, 60]);
};

/**
 * Subtle feedback for interactive taps (e.g. rotating nonce, copying public key).
 */
export const hapticLight = (): void => {
  triggerVibration([25]);
};
