import React, { useState, useEffect } from 'react';
import { 
  Phone, 
  PhoneOff, 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  Volume2, 
  VolumeX, 
  ShieldCheck, 
  Lock, 
  Radio
} from 'lucide-react';
import { hapticSensitiveAction, triggerVibration } from '../services/hapticService';

interface EncryptedCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  peerName: string;
  peerAvatar?: string;
  callType: 'audio' | 'video';
}

export const EncryptedCallModal: React.FC<EncryptedCallModalProps> = ({
  isOpen,
  onClose,
  peerName,
  peerAvatar,
  callType: initialCallType,
}) => {
  const [callType, setCallType] = useState<'audio' | 'video'>(initialCallType);
  const [callStatus, setCallStatus] = useState<'connecting' | 'ringing' | 'connected'>('connecting');
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(initialCallType === 'video');
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);

  useEffect(() => {
    setCallType(initialCallType);
    setIsVideoEnabled(initialCallType === 'video');
  }, [initialCallType]);

  useEffect(() => {
    if (!isOpen) {
      setDurationSeconds(0);
      setCallStatus('connecting');
      return;
    }

    // Realistic call connection progression
    const ringTimer = setTimeout(() => {
      setCallStatus('ringing');
      triggerVibration([80, 100]);
    }, 1200);

    const connectTimer = setTimeout(() => {
      setCallStatus('connected');
      triggerVibration([40, 60, 120]);
    }, 3200);

    return () => {
      clearTimeout(ringTimer);
      clearTimeout(connectTimer);
    };
  }, [isOpen]);

  useEffect(() => {
    let interval: any = null;
    if (isOpen && callStatus === 'connected') {
      interval = setInterval(() => {
        setDurationSeconds((s) => s + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isOpen, callStatus]);

  if (!isOpen) return null;

  const handleEndCall = () => {
    hapticSensitiveAction();
    onClose();
  };

  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/90 backdrop-blur-xl animate-in fade-in">
      <div className="relative w-full max-w-sm sm:max-w-md h-[540px] sm:h-[580px] bg-[#0c0d14] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col justify-between p-6">
        
        {/* Top Header: Encryption & Security */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 font-mono">
            <Lock className="w-3 h-3 text-emerald-400" />
            <span>P2P ENCRYPTED</span>
          </div>

          <div className="text-[11px] font-mono text-zinc-400">
            {callStatus === 'connected' ? (
              <span className="text-white font-bold">{formatDuration(durationSeconds)}</span>
            ) : (
              <span className="capitalize text-[#C9A24D]">{callStatus}...</span>
            )}
          </div>
        </div>

        {/* Center: Video Preview or Audio Waveform */}
        <div className="flex-1 flex flex-col items-center justify-center my-4 relative">
          {callType === 'video' && isVideoEnabled ? (
            <div className="relative w-full h-full rounded-2xl overflow-hidden bg-[#141622] border border-white/10 flex items-center justify-center">
              {/* Simulated peer video frame */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />
              <div className="text-center z-10 space-y-2">
                <div className="w-20 h-20 rounded-full bg-[#1c1f2b] border border-white/20 mx-auto flex items-center justify-center text-2xl font-bold text-[#C9A24D]">
                  {peerName.charAt(0)}
                </div>
                <div className="text-sm font-bold text-white">{peerName}</div>
                <div className="text-[11px] text-emerald-400 font-mono">Direct Video Stream</div>
              </div>

              {/* Self Video PIP */}
              <div className="absolute bottom-3 right-3 w-20 h-28 rounded-xl bg-zinc-900 border border-white/20 overflow-hidden shadow-lg flex flex-col items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400">
                  You
                </div>
                <span className="text-[9px] text-zinc-500 mt-1">Camera On</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center space-y-4">
              <div className="relative">
                <div className="w-24 h-24 rounded-full bg-[#171922] border-2 border-[#C9A24D]/40 flex items-center justify-center text-3xl font-bold text-[#C9A24D] shadow-xl">
                  {peerName.charAt(0)}
                </div>
                {callStatus === 'connected' && (
                  <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-[#0c0d14] flex items-center justify-center text-white text-[10px]">
                    <ShieldCheck className="w-3.5 h-3.5" />
                  </span>
                )}
              </div>

              <div className="text-center space-y-1">
                <h3 className="text-lg font-bold text-white">{peerName}</h3>
                <p className="text-xs text-zinc-400">
                  {callStatus === 'connected'
                    ? 'Encrypted Voice Connected'
                    : callStatus === 'ringing'
                    ? 'Ringing securely...'
                    : 'Establishing peer connection...'}
                </p>
              </div>

              {/* Animated audio wave pulses when connected */}
              {callStatus === 'connected' && (
                <div className="flex items-center gap-1.5 h-8 pt-2">
                  <div className="w-1 bg-[#C9A24D] h-4 rounded-full animate-pulse" />
                  <div className="w-1 bg-[#C9A24D] h-7 rounded-full animate-pulse delay-75" />
                  <div className="w-1 bg-[#C9A24D] h-3 rounded-full animate-pulse delay-150" />
                  <div className="w-1 bg-[#C9A24D] h-6 rounded-full animate-pulse delay-200" />
                  <div className="w-1 bg-[#C9A24D] h-5 rounded-full animate-pulse delay-100" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Call Controls */}
        <div className="flex items-center justify-center gap-4 pt-2">
          {/* Mute Toggle */}
          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`w-12 h-12 min-h-[48px] min-w-[48px] rounded-2xl flex items-center justify-center border transition-all cursor-pointer ${
              isMuted
                ? 'bg-rose-500/20 border-rose-500/50 text-rose-400'
                : 'bg-[#171922] border-white/10 text-white hover:bg-[#202330]'
            }`}
            aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {/* Video Toggle */}
          <button
            onClick={() => {
              const next = !isVideoEnabled;
              setIsVideoEnabled(next);
              setCallType(next ? 'video' : 'audio');
            }}
            className={`w-12 h-12 min-h-[48px] min-w-[48px] rounded-2xl flex items-center justify-center border transition-all cursor-pointer ${
              isVideoEnabled
                ? 'bg-[#C9A24D]/20 border-[#C9A24D]/50 text-[#C9A24D]'
                : 'bg-[#171922] border-white/10 text-zinc-400 hover:text-white'
            }`}
            aria-label={isVideoEnabled ? 'Disable camera' : 'Enable camera'}
          >
            {isVideoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </button>

          {/* Speaker Toggle */}
          <button
            onClick={() => setIsSpeakerOn(!isSpeakerOn)}
            className={`w-12 h-12 min-h-[48px] min-w-[48px] rounded-2xl flex items-center justify-center border transition-all cursor-pointer ${
              !isSpeakerOn
                ? 'bg-zinc-800 text-zinc-500 border-white/5'
                : 'bg-[#171922] border-white/10 text-white hover:bg-[#202330]'
            }`}
            aria-label="Toggle speaker"
          >
            {isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>

          {/* End Call Button */}
          <button
            onClick={handleEndCall}
            className="w-14 h-14 min-h-[56px] min-w-[56px] rounded-2xl bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-lg shadow-rose-950/60 transition-transform active:scale-95 cursor-pointer ml-2"
            aria-label="End call"
          >
            <PhoneOff className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );
};
