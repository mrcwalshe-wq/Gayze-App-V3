import React, { useState } from 'react';
import { UserProfile, LocationPrivacy } from '../types';
import { 
  hapticQRHandshake, 
  hapticTimerWarning, 
  hapticMessageDecrypted, 
  isVibrationSupported, 
  setHapticsEnabled as persistHapticsEnabled,
  areHapticsEnabled
} from '../services/hapticService';
import { 
  Shield, 
  ShieldCheck, 
  Key, 
  Copy, 
  Check, 
  EyeOff, 
  Radio, 
  MapPin, 
  Trash2, 
  X, 
  QrCode, 
  Award, 
  UserCheck, 
  Zap, 
  Vibrate
} from 'lucide-react';

interface IdentityModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserProfile;
  onUpdateUser: (updated: Partial<UserProfile>) => void;
  onPurgeLocalCache: () => void;
  onOpenQR?: () => void;
}

export const IdentityModal: React.FC<IdentityModalProps> = ({
  isOpen,
  onClose,
  user,
  onUpdateUser,
  onPurgeLocalCache,
  onOpenQR,
}) => {
  const [copiedKey, setCopiedKey] = useState(false);
  const [handle, setHandle] = useState(user.handle);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const [privacySetting, setPrivacySetting] = useState<LocationPrivacy>(user.privacySetting);
  const [hapticsEnabled, setHapticsState] = useState<boolean>(user.hapticsEnabled !== false);
  const [hapticTestedLabel, setHapticTestedLabel] = useState<string | null>(null);
  const [purgedMessage, setPurgedMessage] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard?.writeText(user.publicKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    persistHapticsEnabled(hapticsEnabled);
    onUpdateUser({
      handle,
      displayName,
      bio,
      privacySetting,
      hapticsEnabled,
    });
    onClose();
  };

  const testHapticPattern = (name: string, fn: () => void) => {
    fn();
    setHapticTestedLabel(`Triggered: ${name}`);
    setTimeout(() => setHapticTestedLabel(null), 2500);
  };

  const handlePurge = () => {
    if (confirm('Are you sure? This will purge all decrypted message caches on this device.')) {
      onPurgeLocalCache();
      setPurgedMessage(true);
      setTimeout(() => setPurgedMessage(false), 3000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-lg bg-[#12131a] border border-zinc-800 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-amber-400">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Identity & Privacy Settings</h3>
              <span className="text-[11px] text-zinc-400">Local device keypair & safety preferences</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-zinc-400 hover:text-white flex items-center justify-center hover:bg-zinc-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Public Key Display */}
        <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl space-y-1.5">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="font-mono text-[11px] text-zinc-400">PUBLIC DEVICE KEY</span>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-amber-400 hover:text-amber-300 font-mono text-[11px] cursor-pointer"
            >
              {copiedKey ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedKey ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <div className="font-mono text-xs text-zinc-300 break-all bg-zinc-950 p-2 rounded-lg border border-zinc-800 selection:bg-amber-400/30">
            {user.publicKey}
          </div>
        </div>

        {/* Reliability Score & In-Person QR Verification Action */}
        <div className="p-3 bg-zinc-900/90 border border-zinc-800 rounded-xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
              <Award className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-white">
                Reliability Score: <span className="text-amber-300">{user.reliabilityScore || 94}/100</span>
              </div>
              <div className="text-[11px] text-zinc-400">
                {user.verifiedPeersCount || 14} in-person Swarm verifications
              </div>
            </div>
          </div>

          {onOpenQR && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenQR();
              }}
              className="min-h-[34px] px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-black text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Show QR</span>
            </button>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-[#181a24] border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Handle</label>
              <input
                type="text"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                className="w-full bg-[#181a24] border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Bio / Interests</label>
            <textarea
              rows={2}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full bg-[#181a24] border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none resize-none"
            />
          </div>

          {/* Location-Based Safety & Privacy Cloak */}
          <div className="space-y-2 pt-2 border-t border-zinc-800">
            <label className="block text-xs font-semibold text-zinc-200">
              Location Cloaking & Privacy Radius
            </label>
            <div className="space-y-2">
              <label className="flex items-start gap-3 p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition-colors">
                <input
                  type="radio"
                  name="privacy"
                  checked={privacySetting === 'fuzzy_500m'}
                  onChange={() => setPrivacySetting('fuzzy_500m')}
                  className="mt-1 text-amber-400 focus:ring-amber-400"
                />
                <div>
                  <div className="text-xs font-medium text-white flex items-center gap-1.5">
                    <span>Approximate Location (~500m Privacy Blur, Recommended)</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Protects your privacy by blurring your location by ~300m–500m. Nearby people see your general area without ever knowing your exact street.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition-colors">
                <input
                  type="radio"
                  name="privacy"
                  checked={privacySetting === 'neighborhood'}
                  onChange={() => setPrivacySetting('neighborhood')}
                  className="mt-1 text-amber-400 focus:ring-amber-400"
                />
                <div>
                  <div className="text-xs font-medium text-white">Neighborhood Only</div>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Shows only your neighborhood name (e.g. "{user.neighborhood}"). Your distance in kilometers is completely hidden.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition-colors">
                <input
                  type="radio"
                  name="privacy"
                  checked={privacySetting === 'ghost'}
                  onChange={() => setPrivacySetting('ghost')}
                  className="mt-1 text-amber-400 focus:ring-amber-400"
                />
                <div>
                  <div className="text-xs font-medium text-white flex items-center gap-1.5">
                    <EyeOff className="w-3 h-3 text-zinc-400" />
                    <span>Ghost Mode (Completely Hidden)</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    You do not appear on nearby lists or the map at all. You can still browse and join gathering groups.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Sensory & Tactile Security Haptics (Vibration API) */}
          <div className="space-y-2.5 pt-2 border-t border-zinc-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-semibold text-zinc-200">
                  Haptic Feedback & Sensory Beacons
                </span>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                isVibrationSupported()
                  ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/40'
                  : 'bg-zinc-800 text-zinc-400 border-zinc-700'
              }`}>
                {isVibrationSupported() ? 'Vibration API Ready' : 'Simulated Haptics'}
              </span>
            </div>

            <label className="flex items-start gap-3 p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition-colors">
              <input
                type="checkbox"
                checked={hapticsEnabled}
                onChange={(e) => setHapticsState(e.target.checked)}
                className="mt-1 rounded text-amber-400 focus:ring-amber-400"
              />
              <div className="text-xs">
                <div className="font-medium text-white">Enable Tactile Vibration for Sensitive Actions</div>
                <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                  Triggers haptic buzzes for physical QR handshakes, urgent safety timer warnings, and message decryptions.
                </p>
              </div>
            </label>

            {/* Test Haptic Buttons */}
            {hapticsEnabled && (
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span>Test Haptic Patterns:</span>
                  {hapticTestedLabel && (
                    <span className="text-amber-400 font-mono text-[10px] animate-pulse">
                      {hapticTestedLabel}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => testHapticPattern('QR Handshake Pulse', hapticQRHandshake)}
                    className="py-1.5 px-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-mono rounded-lg border border-zinc-700/60 transition-colors text-center"
                  >
                    QR Handshake
                  </button>
                  <button
                    type="button"
                    onClick={() => testHapticPattern('Timer Warning Pulse', hapticTimerWarning)}
                    className="py-1.5 px-2 bg-zinc-800 hover:bg-zinc-700 text-amber-300 text-[10px] font-mono rounded-lg border border-zinc-700/60 transition-colors text-center"
                  >
                    Timer Warning
                  </button>
                  <button
                    type="button"
                    onClick={() => testHapticPattern('Decryption Click', hapticMessageDecrypted)}
                    className="py-1.5 px-2 bg-zinc-800 hover:bg-zinc-700 text-emerald-300 text-[10px] font-mono rounded-lg border border-zinc-700/60 transition-colors text-center"
                  >
                    Decryption Click
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Secure Wipe Button */}
          <div className="pt-2 border-t border-zinc-800 flex items-center justify-between">
            <button
              type="button"
              onClick={handlePurge}
              className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Purge Device Cache</span>
            </button>
            {purgedMessage && (
              <span className="text-[11px] text-emerald-400 font-mono">Local cache wiped ✓</span>
            )}
          </div>

          {/* Save Footer */}
          <div className="pt-3 flex items-center justify-end gap-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[38px] px-4 py-2 text-xs font-medium text-zinc-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="min-h-[38px] px-4 py-2 text-xs font-semibold text-black bg-amber-400 hover:bg-amber-300 rounded-xl transition-colors cursor-pointer"
            >
              Save Settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
