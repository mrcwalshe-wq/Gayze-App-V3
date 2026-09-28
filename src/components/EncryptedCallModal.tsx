import React, { useState, useEffect, useRef } from 'react';
import {
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  ShieldCheck,
  Lock,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { hapticSensitiveAction, triggerVibration } from '../services/hapticService';
import { webrtcCallService, CallState } from '../services/webrtcService';

interface EncryptedCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  peerName: string;
  peerAvatar?: string;
  callType: 'audio' | 'video';
  conversationId?: string;
  callerId?: string;
  callerName?: string;
  targetUserId?: string;
  isIncoming?: boolean;
}

export const EncryptedCallModal: React.FC<EncryptedCallModalProps> = ({
  isOpen,
  onClose,
  peerName,
  peerAvatar,
  callType: initialCallType,
  conversationId,
  callerId,
  callerName,
  targetUserId,
  isIncoming = false,
}) => {
  const [callState, setCallState] = useState<CallState>(isIncoming ? 'connecting' : 'calling');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(initialCallType === 'video');
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const terminalCloseTimerRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    setCallState(isIncoming ? 'connecting' : 'calling');
    setErrorMessage(null);
    setDurationSeconds(0);
    setIsMuted(false);
    setIsVideoEnabled(initialCallType === 'video');
    setIsSpeakerOn(true);
  }, [isOpen, isIncoming, initialCallType, conversationId]);

  // Subscribe to WebRTC Call Service state and media streams
  useEffect(() => {
    if (!isOpen) return;

    const unsubState = webrtcCallService.subscribeState((state, error) => {
      setCallState(state);
      setErrorMessage(error || null);

      if (state === 'ringing') {
        triggerVibration([80, 100]);
      } else if (state === 'connected') {
        triggerVibration([40, 60, 120]);
      } else if (state === 'ended' || state === 'declined' || state === 'failed') {
        triggerVibration([100, 50, 100]);
        if (terminalCloseTimerRef.current !== null) window.clearTimeout(terminalCloseTimerRef.current);
        terminalCloseTimerRef.current = window.setTimeout(() => {
          terminalCloseTimerRef.current = null;
          onCloseRef.current();
        }, 2200);
      } else if (terminalCloseTimerRef.current !== null) {
        window.clearTimeout(terminalCloseTimerRef.current);
        terminalCloseTimerRef.current = null;
      }
    });

    const unsubStreams = webrtcCallService.subscribeStreams((local, remote) => {
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = local;
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remote;
      }
    });

    return () => {
      unsubState();
      unsubStreams();
      if (terminalCloseTimerRef.current !== null) {
        window.clearTimeout(terminalCloseTimerRef.current);
        terminalCloseTimerRef.current = null;
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.volume = isSpeakerOn ? 1 : 0;
    }
  }, [isSpeakerOn]);

  // Ensure media tracks are cleanly stopped if modal closes or unmounts unexpectedly
  useEffect(() => {
    return () => {
      const state = webrtcCallService.getState();
      if (state !== 'idle' && state !== 'ended' && state !== 'declined' && state !== 'missed') {
        void webrtcCallService.endCall();
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      const state = webrtcCallService.getState();
      if (state !== 'idle' && state !== 'ended' && state !== 'declined' && state !== 'missed') {
        void webrtcCallService.endCall();
      }
    }
  }, [isOpen]);

  // Duration Timer
  useEffect(() => {
    let interval: any = null;
    if (isOpen && callState === 'connected') {
      interval = setInterval(() => {
        setDurationSeconds((s) => s + 1);
      }, 1000);
    } else {
      setDurationSeconds(0);
    }
    return () => clearInterval(interval);
  }, [isOpen, callState]);

  // Start outgoing call when modal opens
  useEffect(() => {
    if (isOpen && !isIncoming && conversationId && callerId && targetUserId) {
      void webrtcCallService.startCall({
        conversationId,
        callerId,
        callerName: callerName || 'Gayze member',
        targetUserId,
        targetUserName: peerName,
        callType: initialCallType,
      });
    }
  }, [isOpen, isIncoming, conversationId, callerId, callerName, targetUserId, peerName, initialCallType]);

  if (!isOpen) return null;

  const handleEndCall = () => {
    hapticSensitiveAction();
    void webrtcCallService.endCall();
    onClose();
  };

  const handleToggleMute = () => {
    const nextState = webrtcCallService.toggleAudio();
    setIsMuted(!nextState);
  };

  const handleToggleVideo = () => {
    const nextState = webrtcCallService.toggleVideo();
    setIsVideoEnabled(nextState);
  };

  const handleFlipCamera = () => {
    void webrtcCallService.flipCamera();
  };

  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/90 backdrop-blur-xl animate-in fade-in">
      <div className="relative w-full max-w-sm sm:max-w-md h-[560px] sm:h-[600px] g-panel !rounded-[22px] overflow-hidden flex flex-col justify-between p-5 sm:p-6">
        {/* Top Header: Encryption & Call Security */}
        <div className="flex items-center justify-between text-xs z-20">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 font-mono">
            <Lock className="w-3 h-3 text-emerald-400" />
            <span>P2P WEBRTC ENCRYPTED</span>
          </div>

          <div className="text-[11px] font-mono text-zinc-400">
            {callState === 'connected' ? (
              <span className="text-white font-bold tracking-wider">{formatDuration(durationSeconds)}</span>
            ) : callState === 'calling' ? (
              <span className="text-[#C9A24D]">Calling…</span>
            ) : callState === 'ringing' ? (
              <span className="text-[#C9A24D]">Ringing…</span>
            ) : callState === 'connecting' ? (
              <span className="text-amber-300">Securing peer connection…</span>
            ) : callState === 'declined' ? (
              <span className="text-rose-400 font-semibold">Call Declined</span>
            ) : callState === 'missed' ? (
              <span className="text-amber-400 font-semibold">No Answer</span>
            ) : callState === 'failed' ? (
              <span className="text-rose-400 font-semibold">Failed</span>
            ) : (
              <span className="text-zinc-500">Call Ended</span>
            )}
          </div>
        </div>

        {/* Center: Live Video Streams or Audio Waveform */}
        <div className="flex-1 flex flex-col items-center justify-center my-3 relative overflow-hidden rounded-2xl bg-[#090a0f] border border-white/10">
          {/* Remote Video Stream Element */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`w-full h-full object-cover transition-opacity duration-300 ${
              callState === 'connected' && isVideoEnabled ? 'opacity-100' : 'opacity-0 absolute'
            }`}
          />

          {/* Fallback/Audio UI when remote video is not streaming or call is connecting */}
          {(callState !== 'connected' || !isVideoEnabled) && (
            <div className="flex flex-col items-center space-y-4 z-10 p-6 text-center">
              <div className="relative">
                <div className="w-24 h-24 rounded-full bg-[#171922] border-2 border-[#C9A24D]/40 flex items-center justify-center text-3xl font-bold text-[#C9A24D] shadow-xl overflow-hidden">
                  {peerAvatar ? (
                    <img src={peerAvatar} alt={peerName} className="w-full h-full object-cover" />
                  ) : (
                    peerName.charAt(0).toUpperCase()
                  )}
                </div>
                {callState === 'connected' && (
                  <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-[#0c0d14] flex items-center justify-center text-white text-[10px]">
                    <ShieldCheck className="w-3.5 h-3.5" />
                  </span>
                )}
              </div>

              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white tracking-wide">{peerName}</h3>
                <p className="text-xs text-zinc-400">
                  {callState === 'connected'
                    ? 'Direct peer-to-peer audio connected'
                    : callState === 'ringing'
                    ? 'Ringing device securely...'
                    : callState === 'connecting'
                    ? 'Negotiating WebRTC handshake...'
                    : callState === 'calling'
                    ? 'Contacting peer...'
                    : callState === 'declined'
                    ? `${peerName} is unavailable`
                    : callState === 'missed'
                    ? `${peerName} did not answer`
                    : callState === 'failed'
                    ? 'Connection could not be established'
                    : 'Call finished'}
                </p>
              </div>

              {errorMessage && (
                <div className="max-w-xs p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2 text-left">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Live audio indicator — one line that breathes, not an equaliser */}
              {callState === 'connected' && (
                <div className="flex items-center gap-2 h-8 pt-2">
                  <span className="g-live-amber" aria-hidden="true" />
                  <span className="text-[11.5px] text-zinc-400">Connected</span>
                </div>
              )}
            </div>
          )}

          {/* Self Video Picture-in-Picture (Real Local Video) */}
          <div
            className={`absolute bottom-3 right-3 w-24 h-32 rounded-xl bg-black/80 border border-white/20 overflow-hidden shadow-2xl z-20 transition-all ${
              initialCallType === 'video' && isVideoEnabled ? 'block' : 'hidden'
            }`}
          >
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover mirror"
            />
            <span className="absolute bottom-1.5 left-2 text-[10px] font-medium text-white/85 bg-black/55 backdrop-blur-sm px-1.5 py-0.5 rounded-md">
              You
            </span>
          </div>
        </div>

        {/* Bottom Call Controls */}
        <div className="flex items-center justify-center gap-3 pt-2 z-20">
          {/* Mute Microphone Toggle */}
          <button
            onClick={handleToggleMute}
            className={`w-12 h-12 min-h-[48px] min-w-[48px] rounded-2xl flex items-center justify-center border transition-all cursor-pointer ${
              isMuted
                ? 'bg-rose-500/20 border-rose-500/50 text-rose-400'
                : 'bg-[#171922] border-white/10 text-white hover:bg-[#202330]'
            }`}
            aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {/* Camera On/Off Toggle */}
          {initialCallType === 'video' && (
            <button
              onClick={handleToggleVideo}
              className={`w-12 h-12 min-h-[48px] min-w-[48px] rounded-2xl flex items-center justify-center border transition-all cursor-pointer ${
                !isVideoEnabled
                  ? 'bg-zinc-800 text-zinc-500 border-white/5'
                  : 'bg-[#C9A24D]/20 border-[#C9A24D]/50 text-[#C9A24D]'
              }`}
              aria-label={isVideoEnabled ? 'Disable camera' : 'Enable camera'}
              title={isVideoEnabled ? 'Disable camera' : 'Enable camera'}
            >
              {isVideoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            </button>
          )}

          {/* Flip Camera (Mobile Front/Back switch) */}
          {initialCallType === 'video' && isVideoEnabled && (
            <button
              onClick={handleFlipCamera}
              className="w-12 h-12 min-h-[48px] min-w-[48px] rounded-2xl bg-[#171922] border border-white/10 text-zinc-300 hover:text-white flex items-center justify-center transition-all cursor-pointer"
              aria-label="Flip camera"
              title="Flip camera"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          )}

          {/* Speaker Toggle */}
          <button
            onClick={() => setIsSpeakerOn(!isSpeakerOn)}
            className={`w-12 h-12 min-h-[48px] min-w-[48px] rounded-2xl flex items-center justify-center border transition-all cursor-pointer ${
              !isSpeakerOn
                ? 'bg-zinc-800 text-zinc-500 border-white/5'
                : 'bg-[#171922] border-white/10 text-white hover:bg-[#202330]'
            }`}
            aria-label="Toggle speaker"
            title="Toggle speaker"
          >
            {isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>

          {/* End Call Button */}
          <button
            onClick={handleEndCall}
            className="w-14 h-14 min-h-[56px] min-w-[56px] rounded-2xl bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-lg shadow-rose-950/60 transition-transform active:scale-95 cursor-pointer ml-1"
            aria-label="End call"
            title="End call"
          >
            <PhoneOff className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );
};
