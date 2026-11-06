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
  return iosTaps(pattern);
};

/**
 * iPhones have no Vibration API. Safari 17.4+ does give a small tap whenever a switch-style checkbox is toggled, so a hidden
 * one is toggled once for each "buzz" in the pattern. Safari only allows it while the person is touching the screen (inside a
 * tap), so it works for button presses, not for events that arrive on their own such as an incoming call.
 */
let iosSwitch: HTMLLabelElement | null = null;
const iosTaps = (pattern: number | number[]): boolean => {
  if (typeof document === 'undefined' || !/iPhone|iPad|iPod/.test(navigator.userAgent)) return false;
  try {
    if (!iosSwitch) {
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      label.appendChild(input);
      document.body.appendChild(label);
      iosSwitch = label;
    }
    const steps = Array.isArray(pattern) ? pattern : [pattern];
    let at = 0;
    steps.forEach((ms, index) => {
      if (index % 2 === 0) window.setTimeout(() => iosSwitch?.click(), at);
      at += ms;
    });
    return true;
  } catch { return false; }
};

/**
 * Triggered upon successful QR in-person key exchange and cryptographic verification.
 * Pattern: Confident double pulse (short buzz, brief pause, prolonged affirmative buzz).
 */
export const hapticQRHandshake = (): void => {
  triggerVibration([70, 50, 160]);
};

/**
 * Triggered when the local safety check-in timer is nearing expiration (< 60s remaining).
 * Pattern: Urgent pulsing heartbeat warning pattern.
 */
export const hapticTimerWarning = (): void => {
  triggerVibration([180, 80, 180, 80, 250]);
};

/**
 * Triggered for local safety check-in timer warnings and expiry.
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

/** A call has connected: confident rising double pulse. */
export const hapticCallConnected = (): void => { triggerVibration([40, 60, 120]); };

/** A call has ended or was not answered. */
export const hapticCallEnded = (): void => { triggerVibration([100, 50, 100]); };

/** A message was sent. */
export const hapticMessageSent = (): void => { triggerVibration([18]); };
