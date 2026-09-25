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
  onCreateRecovery?: () => Promise<void>;
  onRestoreRecovery?: () => Promise<void>;
}

export const IdentityModal: React.FC<IdentityModalProps> = ({
  isOpen,
  onClose,
  user,
  onUpdateUser,
  onPurgeLocalCache,
  onOpenQR,
  onCreateRecovery,
  onRestoreRecovery,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-lg bg-[#11131a] border border-white/10 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#171922] border border-white/10 flex items-center justify-center text-[#C9A24D]">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Identity & Privacy Controls</h3>
              <span className="text-[11px] text-zinc-400">Local device keypair & safety preferences</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-zinc-400 hover:text-white flex items-center justify-center hover:bg-white/[0.06] transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Public Key Display */}
        <div className="p-3 bg-[#141620] border border-white/[0.07] rounded-xl space-y-1.5">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="font-mono text-[10px] tracking-wider text-zinc-400 uppercase font-semibold">PUBLIC DEVICE KEY</span>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-[#C9A24D] hover:text-[#e0b85a] font-mono text-[11px] cursor-pointer"
            >
              {copiedKey ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedKey ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <div className="font-mono text-xs text-zinc-300 break-all bg-[#090a0e] p-2.5 rounded-lg border border-white/10 selection:bg-[#C9A24D]/30">
            {user.publicKey}
          </div>
        </div>

        {/* Multi-device encrypted identity recovery */}
        <div className="p-3 bg-[#141620] border border-white/[0.07] rounded-xl space-y-2.5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <div>
              <div className="text-xs font-semibold text-white">Multi-device recovery</div>
              <div className="text-[11px] text-zinc-400">Create an encrypted identity backup for a new device.</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {onCreateRecovery && (
              <button type="button" onClick={onCreateRecovery} className="min-h-[38px] rounded-xl bg-[#C9A24D] text-black text-xs font-semibold hover:bg-[#b58f3b] transition-colors">
                Create Backup
              </button>
            )}
            {onRestoreRecovery && (
              <button type="button" onClick={onRestoreRecovery} className="min-h-[38px] rounded-xl bg-[#1c1f2b] border border-white/10 text-zinc-200 text-xs font-semibold hover:bg-[#252838] transition-colors">
                Restore Backup
              </button>
            )}
          </div>
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            Your private identity key is encrypted locally with your recovery passphrase. GAYZE does not receive the passphrase or plaintext private key.
          </p>
        </div>

        {/* Reliability Score & In-Person QR Verification Action */}
        <div className="p-3 bg-[#141620] border border-white/[0.07] rounded-xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
              <Award className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-white">
                Reliability Score: <span className="text-[#C9A24D] font-mono">{user.reliabilityScore || 94}/100</span>
              </div>
              <div className="text-[11px] text-zinc-400">
                {user.verifiedPeersCount || 14} in-person Group verifications
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
              className="h-8 min-h-[34px] px-3 rounded-xl bg-[#C9A24D] hover:bg-[#b58f3b] text-black text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors shadow-sm"
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
                className="w-full bg-[#171922] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-[#C9A24D] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Handle</label>
              <input
                type="text"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                className="w-full bg-[#171922] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-[#C9A24D] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Bio / Interests</label>
            <textarea
              rows={2}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full bg-[#171922] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-[#C9A24D] focus:outline-none resize-none"
            />
          </div>

          {/* Location-Based Safety & Privacy Cloak */}
          <div className="space-y-2 pt-2 border-t border-white/[0.08]">
            <label className="block text-xs font-semibold text-zinc-200">
              Location Cloaking & Privacy Radius
            </label>
            <div className="space-y-2">
              <label className="flex items-start gap-3 p-2.5 rounded-xl bg-[#141620] border border-white/[0.07] cursor-pointer hover:border-white/20 transition-colors">
                <input
                  type="radio"
                  name="privacy"
                  checked={privacySetting === 'fuzzy_500m'}
                  onChange={() => setPrivacySetting('fuzzy_500m')}
                  className="mt-1 text-[#C9A24D] focus:ring-[#C9A24D]"
                />
                <div>
                  <div className="text-xs font-medium text-white flex items-center gap-1.5">
                    <span>Approximate Location (~500m Blur, Recommended)</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                    Protects your privacy by fuzzing your coordinates by ~300m–500m. Nearby peers see your general zone without discovering your exact street.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-2.5 rounded-xl bg-[#141620] border border-white/[0.07] cursor-pointer hover:border-white/20 transition-colors">
                <input
                  type="radio"
                  name="privacy"
                  checked={privacySetting === 'neighborhood'}
                  onChange={() => setPrivacySetting('neighborhood')}
                  className="mt-1 text-[#C9A24D] focus:ring-[#C9A24D]"
                />
                <div>
                  <div className="text-xs font-medium text-white">Neighborhood Only</div>
                  <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                    Shows only your neighborhood name (e.g. "{user.neighborhood}"). Distance in kilometers is completely hidden.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-2.5 rounded-xl bg-[#141620] border border-white/[0.07] cursor-pointer hover:border-white/20 transition-colors">
                <input
                  type="radio"
                  name="privacy"
                  checked={privacySetting === 'ghost'}
                  onChange={() => setPrivacySetting('ghost')}
                  className="mt-1 text-[#C9A24D] focus:ring-[#C9A24D]"
                />
                <div>
                  <div className="text-xs font-medium text-white flex items-center gap-1.5">
                    <EyeOff className="w-3 h-3 text-zinc-400" />
                    <span>Ghost Mode (Completely Hidden)</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                    You do not appear on nearby lists or the map at all. You can still browse and join gathering circles.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Sensory & Tactile Security Haptics (Vibration API) */}
          <div className="space-y-2.5 pt-2 border-t border-white/[0.08]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-[#C9A24D]" />
                <span className="text-xs font-semibold text-zinc-200">
                  Haptic Feedback & Sensory Beacons
                </span>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md border ${
                isVibrationSupported()
                  ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/30'
                  : 'bg-[#171922] text-zinc-400 border-white/10'
              }`}>
                {isVibrationSupported() ? 'Vibration API Ready' : 'Simulated Haptics'}
              </span>
            </div>

            <label className="flex items-start gap-3 p-2.5 rounded-xl bg-[#141620] border border-white/[0.07] cursor-pointer hover:border-white/20 transition-colors">
              <input
                type="checkbox"
                checked={hapticsEnabled}
                onChange={(e) => setHapticsState(e.target.checked)}
                className="mt-1 rounded text-[#C9A24D] focus:ring-[#C9A24D]"
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
                    <span className="text-[#C9A24D] font-mono text-[10px] animate-pulse">
                      {hapticTestedLabel}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => testHapticPattern('QR Handshake Pulse', hapticQRHandshake)}
                    className="py-1.5 px-2 bg-[#171922] hover:bg-[#202330] text-zinc-200 text-[10px] font-mono rounded-lg border border-white/10 transition-colors text-center cursor-pointer"
                  >
                    QR Handshake
                  </button>
                  <button
                    type="button"
                    onClick={() => testHapticPattern('Timer Warning Pulse', hapticTimerWarning)}
                    className="py-1.5 px-2 bg-[#171922] hover:bg-[#202330] text-[#C9A24D] text-[10px] font-mono rounded-lg border border-white/10 transition-colors text-center cursor-pointer"
                  >
                    Timer Warning
                  </button>
                  <button
                    type="button"
                    onClick={() => testHapticPattern('Decryption Click', hapticMessageDecrypted)}
                    className="py-1.5 px-2 bg-[#171922] hover:bg-[#202330] text-emerald-300 text-[10px] font-mono rounded-lg border border-white/10 transition-colors text-center cursor-pointer"
                  >
                    Decryption Click
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Secure Wipe Button */}
          <div className="pt-2 border-t border-white/[0.08] flex items-center justify-between">
            <button
              type="button"
              onClick={handlePurge}
              className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Purge Device Cache</span>
            </button>
            {purgedMessage && (
              <span className="text-[11px] text-emerald-400 font-mono">Local cache wiped ✓</span>
            )}
          </div>

          {/* Save Footer */}
          <div className="pt-3 flex items-center justify-end gap-3 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] px-4 py-2 text-xs font-medium text-zinc-400 hover:text-white cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="min-h-[42px] px-4 py-2 text-xs font-semibold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-colors cursor-pointer shadow-sm"
            >
              Save Settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
