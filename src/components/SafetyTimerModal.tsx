import React, { useState } from 'react';
import { SafetyCheckin } from '../types';
import { 
  hapticTimerExpired, 
  hapticTimerWarning, 
  hapticSensitiveAction, 
  hapticLight,
  isVibrationSupported 
} from '../services/hapticService';
import { Shield, ShieldAlert, Clock, CheckCircle2, AlertTriangle, MapPin, User, X, PhoneCall, Zap } from 'lucide-react';

interface SafetyTimerModalProps {
  isOpen: boolean;
  onClose: () => void;
  checkinState: SafetyCheckin;
  onStartTimer: (data: { partnerName: string; venueName: string; durationMinutes: number; notes: string }) => void;
  onExtendTimer: (extraMinutes: number) => void;
  onEndCheckin: () => void;
  onTriggerDistressBeacon: () => void;
  remainingSeconds: number;
}

export const SafetyTimerModal: React.FC<SafetyTimerModalProps> = ({
  isOpen,
  onClose,
  checkinState,
  onStartTimer,
  onExtendTimer,
  onEndCheckin,
  onTriggerDistressBeacon,
  remainingSeconds,
}) => {
  const [partnerName, setPartnerName] = useState(checkinState.meetupPartnerName || '');
  const [venueName, setVenueName] = useState(checkinState.venueName || '');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [notes, setNotes] = useState(checkinState.notes || '');
  const [distressSent, setDistressSent] = useState(false);

  if (!isOpen) return null;

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeFormatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const isExpiringSoon = remainingSeconds <= 60 && remainingSeconds > 0;

  const handleSubmitStart = (e: React.FormEvent) => {
    e.preventDefault();
    hapticSensitiveAction();
    onStartTimer({
      partnerName: partnerName || 'Meetup Peer',
      venueName: venueName || 'Public Space',
      durationMinutes,
      notes,
    });
  };

  const handleSendDistress = () => {
    hapticTimerExpired();
    onTriggerDistressBeacon();
    setDistressSent(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-md bg-[#11131a] border border-white/10 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              checkinState.isActive ? 'bg-rose-950/40 border border-rose-600/40 text-rose-400' : 'bg-emerald-950/40 border border-emerald-500/40 text-emerald-400'
            }`}>
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Safety Check-in Beacon</h3>
              <span className="text-[11px] text-zinc-400">
                {checkinState.isActive ? 'Active Check-in in Progress' : 'Set Automatic Safety Check-in'}
              </span>
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

        {checkinState.isActive ? (
          /* ACTIVE BEACON COUNTDOWN VIEW */
          <div className="space-y-4">
            <div className={`p-4 rounded-xl border text-center space-y-1.5 transition-colors ${
              isExpiringSoon 
                ? 'bg-rose-950/40 border-rose-500/60 animate-pulse' 
                : 'bg-[#141620] border-white/[0.08]'
            }`}>
              <div className="flex items-center justify-center gap-1.5 text-[10px] uppercase font-mono tracking-wider font-semibold">
                {isExpiringSoon ? (
                  <span className="text-rose-400 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                    <span>Timer Expiring Soon · Vibration Alert</span>
                  </span>
                ) : (
                  <span className="text-zinc-400 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-[#C9A24D]" />
                    <span>Time Until Safety Check</span>
                  </span>
                )}
              </div>
              <div className={`text-4xl font-mono font-bold tracking-tight ${
                isExpiringSoon ? 'text-rose-400' : 'text-[#C9A24D]'
              }`}>
                {timeFormatted}
              </div>
              <div className="text-xs text-zinc-400">
                Meeting <strong className="text-white">{checkinState.meetupPartnerName}</strong> at <strong className="text-white">{checkinState.venueName}</strong>
              </div>
            </div>

            {checkinState.notes && (
              <div className="p-3 bg-[#141620] rounded-xl border border-white/[0.07] text-xs text-zinc-300">
                <span className="text-zinc-400 font-mono text-[10px] uppercase tracking-wider block mb-0.5">PRIVATE CHECK-IN NOTE:</span>
                {checkinState.notes}
              </div>
            )}

            {/* Quick Extension & Safe Confirm Buttons */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => onExtendTimer(30)}
                className="h-11 min-h-[44px] py-2 px-3 text-xs font-medium text-zinc-200 bg-[#1c1f2b] hover:bg-[#252838] rounded-xl border border-white/10 transition-colors cursor-pointer flex items-center justify-center"
              >
                +30 min extension
              </button>

              <button
                onClick={onEndCheckin}
                className="h-11 min-h-[44px] py-2 px-3 text-xs font-semibold text-black bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>I'm Safe / End</span>
              </button>
            </div>

            {/* Emergency Distress Button */}
            <div className="pt-2 border-t border-white/[0.08]">
              {distressSent ? (
                <div className="p-3 bg-rose-950/40 border border-rose-600/40 rounded-xl text-center text-xs font-medium text-rose-300">
                  ✓ Emergency alert sent to your trusted contacts with your venue details.
                </div>
              ) : (
                <button
                  onClick={handleSendDistress}
                  className="w-full h-11 min-h-[44px] py-2.5 px-3 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-rose-950/40"
                >
                  <ShieldAlert className="w-4 h-4" />
                  <span>Send Emergency Alert Now</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          /* SETUP BEACON FORM */
          <form onSubmit={handleSubmitStart} className="space-y-4">
            <p className="text-xs text-zinc-300 leading-relaxed">
              Meeting someone from Gayze? Set an automated safety timer. If you don't confirm you're safe before the timer ends, your trusted safety circle is alerted with venue details.
            </p>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Who are you meeting?</label>
              <input
                type="text"
                required
                value={partnerName}
                onChange={(e) => setPartnerName(e.target.value)}
                placeholder="e.g. Marcus T. (or 'Coffee date')"
                className="w-full bg-[#171922] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-[#C9A24D] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Meetup Location / Venue</label>
              <input
                type="text"
                required
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
                placeholder="e.g. Timberyard Cafe / The Yard Courtyard"
                className="w-full bg-[#171922] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-[#C9A24D] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Check-in Duration</label>
                <select
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="w-full bg-[#171922] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-[#C9A24D] focus:outline-none cursor-pointer"
                >
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={90}>1.5 hours</option>
                  <option value={120}>2 hours</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Safety Circle</label>
                <div className="h-9 min-h-[36px] px-3 py-1.5 bg-[#171922] border border-white/10 rounded-xl text-xs text-emerald-400 font-mono flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>2 Buddies Linked</span>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Private Safe Word / Notes (Optional)</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Safe word is 'Sunflower'. Wearing grey jacket."
                className="w-full bg-[#171922] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-[#C9A24D] focus:outline-none"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-3 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={onClose}
                className="h-11 min-h-[44px] px-4 py-2 text-xs font-medium text-zinc-400 hover:text-white cursor-pointer flex items-center justify-center"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-11 min-h-[44px] px-4 py-2 text-xs font-semibold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Start Safety Beacon</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
