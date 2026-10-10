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
  AlertCircle,
  ChevronDown
} from 'lucide-react';
import { hapticSensitiveAction, triggerVibration } from '../services/hapticService';
import { webrtcCallService, CallState, type IncomingCall } from '../services/webrtcService';
import { getCallAudioContext, closeCallAudio } from '../services/callAudioService';

interface FullScreenCallModalProps {
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

export const FullScreenCallModal: React.FC<FullScreenCallModalProps> = ({
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
  const [callState, setCallState] = useState<CallState>(isIncoming ? 'ringing' : 'calling');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(initialCallType === 'video');
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [showControls, setShowControls] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const terminalCloseTimerRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  const ringtoneTimerRef = useRef<number | null>(null);
  const controlsTimerRef = useRef<number | null>(null);
  const startAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Auto-hide controls after inactivity
  useEffect(() => {
    if (!isOpen || !showControls) return;
    
    const timer = setTimeout(() => {
      setShowControls(false);
    }, 3000);
    
    return () => clearTimeout(timer);
  }, [isOpen, showControls]);

  // Handle user activity to show controls
  const handleUserActivity = () => {
    if (isOpen) {
      setShowControls(true);
      // Reset the auto-hide timer
      if (controlsTimerRef.current) {
        clearTimeout(controlsTimerRef.current);
      }
      controlsTimerRef.current = window.setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  };

  // Branded GAYZE call alert
  const stopRingtone = () => {
    if (ringtoneTimerRef.current !== null) {
      window.clearInterval(ringtoneTimerRef.current);
      ringtoneTimerRef.current = null;
    }
    closeCallAudio();
  };

  const playRingtoneBurst = () => {
    const ctx = getCallAudioContext();
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
    gain.connect(ctx.destination);
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      oscillator.type = index === 2 ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.connect(gain);
      oscillator.start(now + index * 0.10);
      oscillator.stop(now + 0.49);
    });
  };

  useEffect(() => {
    if (!isOpen || (callState !== 'calling' && callState !== 'ringing')) {
      stopRingtone();
      return;
    }

    // Outgoing uses the ascending GAYZE ringback. Incoming uses a different
    // two-stage chime so the recipient can distinguish an incoming call.
    const play = isIncoming ? () => {
      const ctx = getCallAudioContext();
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const tones = [
        [392, 0, 0.34, 0.055],
        [493.88, 0.09, 0.42, 0.05],
        [587.33, 0.18, 0.52, 0.045],
        [783.99, 0.34, 0.58, 0.032],
      ];
      tones.forEach(([frequency, offset, duration, level]) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = frequency === 783.99 ? 'sine' : 'triangle';
        oscillator.frequency.setValueAtTime(frequency, now);
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(level, now + offset + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + duration + 0.02);
      });
    } : playRingtoneBurst;
    play();
    ringtoneTimerRef.current = window.setInterval(play, isIncoming ? 1900 : 1700);

    return () => stopRingtone();
  }, [isOpen, callState]);

  useEffect(() => {
    if (!isOpen) return;
    setCallState(isIncoming ? 'connecting' : 'calling');
    setErrorMessage(null);
    setDurationSeconds(0);
    setIsMuted(false);
    setIsVideoEnabled(initialCallType === 'video');
    setIsSpeakerOn(true);
    setShowControls(true);
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
        if (local) void localVideoRef.current.play().catch(() => undefined);
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = initialCallType === 'video' ? remote : null;
        remoteVideoRef.current.muted = initialCallType !== 'video';
        if (remote && initialCallType === 'video') void remoteVideoRef.current.play().catch((error) => {
          console.warn('[GAYZE Call] Remote video autoplay was blocked', error);
        });
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = initialCallType === 'audio' ? remote : null;
        remoteAudioRef.current.volume = isSpeakerOn ? 1 : 0;
        if (remote && initialCallType === 'audio') void remoteAudioRef.current.play().catch((error) => {
          console.warn('[GAYZE Call] Remote audio autoplay was blocked', error);
        });
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
    if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = isSpeakerOn ? 1 : 0;
    }
  }, [isSpeakerOn]);

  // Ensure media tracks are cleanly stopped if modal closes or unmounts unexpectedly
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

  // Start each outgoing call exactly once. Parent rerenders must not restart
  // signalling or tear down an already-negotiating peer connection.
  useEffect(() => {
    if (!isOpen) { startAttemptRef.current = null; return; }
    if (isIncoming || !conversationId || !callerId || !targetUserId) return;
    const attemptKey = `${conversationId}:${callerId}:${targetUserId}:${initialCallType}`;
    if (startAttemptRef.current === attemptKey) return;
    startAttemptRef.current = attemptKey;
    void webrtcCallService.startCall({
      conversationId,
      callerId,
      callerName: callerName || 'Gayze member',
      targetUserId,
      targetUserName: peerName,
      callType: initialCallType,
    });
  }, [isOpen, isIncoming, conversationId, callerId, callerName, targetUserId, peerName, initialCallType]);

  if (!isOpen) return null;

  const handleEndCall = () => {
    hapticSensitiveAction();
    void webrtcCallService.endCall();
    onClose();
  };

  const handleToggleMute = () => {
    // Keep the service as the single source of truth, including when the user
    // mutes before getUserMedia has resolved.
    const nextEnabled = webrtcCallService.toggleAudio(isMuted);
    setIsMuted(!nextEnabled);
  };

  const handleToggleVideo = () => {
    const nextState = webrtcCallService.toggleVideo(!isVideoEnabled);
    setIsVideoEnabled(nextState);
  };

  const handleFlipCamera = () => {
    void webrtcCallService.flipCamera();
  };

  const handleToggleMinimize = () => {
    setIsMinimized(!isMinimized);
  };

  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Full-screen iPhone-style UI
  return (
    <div 
      className="fixed inset-0 z-[10000] bg-black/95 backdrop-blur-3xl transition-opacity duration-200"
      onClick={handleUserActivity}
      onTouchStart={handleUserActivity}
      onMouseMove={handleUserActivity}
    >
      {/* Hidden audio element for audio calls */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {/* Main call container - iPhone style full screen */}
      <div className="relative w-full h-[100dvh] min-h-[100svh] flex flex-col overflow-hidden">
        
        {/* Status Bar - iOS style */}
        <div className="absolute top-0 left-0 right-0 z-40 pt-[env(safe-area-inset-top)] pb-2">
          <div className="flex items-center justify-between px-4">
            {/* Time */}
            <div className="text-white text-sm font-medium">
              {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
            
            {/* Status indicator */}
            <div className="flex items-center gap-2">
              {/* Network status */}
              <div className="w-4 h-4 bg-white/20 rounded-sm flex items-center justify-center">
                <div className="w-2 h-2 bg-white rounded-sm"></div>
              </div>
              {/* Battery */}
              <div className="w-6 h-3 bg-white/20 rounded-sm border border-white/30">
                <div className="w-4 h-2 bg-white rounded-sm"></div>
              </div>
            </div>
          </div>
          
          {/* Call status text */}
          <div className="flex items-center justify-center mt-2">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 font-mono text-xs">
              <Lock className="w-3 h-3 text-emerald-400" />
              <span>{callState === 'connected' ? 'P2P WEBRTC ENCRYPTED' : callState === 'calling' || callState === 'ringing' ? 'SECURE CALL REQUEST' : callState === 'connecting' ? 'NEGOTIATING SECURELY' : 'CALL ENDED'}</span>
            </div>
          </div>
        </div>

        {/* Main video area */}
        <div className="flex-1 relative overflow-hidden">
          
          {/* Remote Video Stream - Full screen */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`w-full h-full object-cover transition-opacity duration-300 ${
              callState === 'connected' && isVideoEnabled ? 'opacity-100' : 'opacity-0 absolute'
            }`}
          />

          {/* Fallback UI when no video or audio call */}
          {(callState !== 'connected' || !isVideoEnabled) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-[#0a0a0f] via-[#1a1a22] to-[#0a0a0f] p-6 text-center">
              <div className="relative">
                <div className="w-28 h-28 rounded-full bg-[#171922] border-2 border-[#C9A24D]/40 flex items-center justify-center text-4xl font-bold text-[#C9A24D] shadow-2xl overflow-hidden ring-4 ring-[#C9A24D]/20 ring-offset-2 ring-offset-[#0a0a0f]">
                  <span aria-hidden="true">{peerName.charAt(0).toUpperCase() || 'G'}</span>
                  {peerAvatar && (
                    <img src={peerAvatar} alt={peerName} onError={(event) => { event.currentTarget.style.display = 'none'; }} className="absolute inset-0 w-full h-full object-cover" />
                  )}
                </div>
                {callState === 'connected' && (
                  <span className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-emerald-500 border-2 border-[#0c0d14] flex items-center justify-center text-white text-[11px]">
                    <ShieldCheck className="w-4 h-4" />
                  </span>
                )}
              </div>

              <div className="space-y-2 mt-6">
                <h3 className="text-2xl font-bold text-white tracking-[-0.02em] drop-shadow-lg">
                  {peerName}
                </h3>
                <p className="text-sm text-zinc-400">
                  {callState === 'connected'
                    ? 'Direct peer-to-peer connection secured'
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
                <div className="max-w-xs p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-center gap-2 text-left mt-4">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Live audio indicator */}
              {callState === 'connected' && (
                <div className="flex items-center gap-2 h-8 mt-4">
                  <span className="g-live-amber" aria-hidden="true" />
                  <span className="text-[12px] text-zinc-400">
                    {formatDuration(durationSeconds)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Self Video Picture-in-Picture */}
          {initialCallType === 'video' && isVideoEnabled && (
            <div
              className={`absolute bottom-6 right-6 w-32 h-44 rounded-2xl bg-black/80 border border-white/20 overflow-hidden shadow-2xl z-30 transition-all ${
                callState === 'connected' ? 'block' : 'hidden'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover mirror"
              />
              <div className="absolute bottom-2 left-2 text-[11px] font-medium text-white/85 bg-black/55 backdrop-blur-sm px-2 py-1 rounded-lg">
                You
              </div>
            </div>
          )}
        </div>

        {/* Call Controls - iOS style bottom bar */}
        <div 
          className={`absolute bottom-0 left-0 right-0 z-40 pb-[env(safe-area-inset-bottom)] pt-2 transition-all duration-300 ${
            showControls || isMinimized ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="flex items-center justify-center gap-4 px-2">
            
            {/* Mute Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleToggleMute();
              }}
              className={`w-14 h-14 rounded-2xl flex items-center justify-center border transition-all cursor-pointer ${
                isMuted
                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-400 shadow-lg shadow-rose-950/30'
                  : 'bg-white/10 border-white/20 text-white hover:bg-white/15'
              }`}
              aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>

            {/* Camera Toggle - Video calls only */}
            {initialCallType === 'video' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleVideo();
                }}
                className={`w-14 h-14 rounded-2xl flex items-center justify-center border transition-all cursor-pointer ${
                  !isVideoEnabled
                    ? 'bg-zinc-800/50 text-zinc-500 border-white/5'
                    : 'bg-white/10 border-white/20 text-white hover:bg-white/15'
                }`}
                aria-label={isVideoEnabled ? 'Disable camera' : 'Enable camera'}
              >
                {isVideoEnabled ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
              </button>
            )}

            {/* Flip Camera - Video calls only */}
            {initialCallType === 'video' && isVideoEnabled && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleFlipCamera();
                }}
                className="w-14 h-14 rounded-2xl bg-white/10 border border-white/20 text-zinc-300 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                aria-label="Flip camera"
              >
                <RefreshCw className="w-6 h-6" />
              </button>
            )}

            {/* Speaker Toggle */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsSpeakerOn((current) => !current);
              }}
              className={`w-14 h-14 rounded-2xl flex items-center justify-center border transition-all cursor-pointer ${
                !isSpeakerOn
                  ? 'bg-zinc-800/50 text-zinc-500 border-white/5'
                  : 'bg-white/10 border-white/20 text-white hover:bg-white/15'
              }`}
              aria-label="Toggle speaker"
            >
              {isSpeakerOn ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
            </button>

            {/* End Call Button - Red */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleEndCall();
              }}
              className="w-16 h-16 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-2xl shadow-rose-950/60 transition-transform active:scale-90 cursor-pointer"
              aria-label="End call"
            >
              <PhoneOff className="w-7 h-7" />
            </button>
          </div>

          {/* Call duration display */}
          {callState === 'connected' && (
            <div className="text-center mt-3">
              <span className="text-2xl font-mono text-white tracking-wider">
                {formatDuration(durationSeconds)}
              </span>
            </div>
          )}
        </div>

        {/* Minimize button for picture-in-picture mode */}
        {!isMinimized && (
          <button
            onClick={handleToggleMinimize}
            className="absolute top-6 right-6 w-10 h-10 rounded-xl bg-black/50 backdrop-blur-sm border border-white/10 text-white flex items-center justify-center transition-all hover:bg-black/70 z-40"
            aria-label="Minimize call"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Minimized Picture-in-Picture Mode */}
      {isMinimized && (
        <div 
          className="fixed bottom-6 left-1/2 transform -translate-x-1/2 w-48 h-64 rounded-2xl bg-[#0a0a0f] border border-white/20 overflow-hidden shadow-2xl z-50"
          onClick={handleToggleMinimize}
        >
          {/* Remote video in minimized mode */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-40 object-cover"
          />
          
          {/* Local video preview in minimized mode */}
          {initialCallType === 'video' && isVideoEnabled && (
            <div className="absolute top-2 right-2 w-12 h-16 rounded-lg bg-black/80 border border-white/20 overflow-hidden">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover mirror"
              />
            </div>
          )}

          {/* Minimized controls */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 flex items-center justify-between">
            <div className="text-white text-sm font-medium truncate flex-1 mr-2">
              {peerName}
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleMute();
                }}
                className="w-8 h-8 rounded-lg bg-white/10 border border-white/20 text-white flex items-center justify-center text-xs"
              >
                {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleEndCall();
                }}
                className="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center text-xs"
              >
                <PhoneOff className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Separate Audio Call UI component
export const FullScreenAudioCallModal: React.FC<FullScreenCallModalProps> = ({
  isOpen,
  onClose,
  peerName,
  peerAvatar,
  callType,
  conversationId,
  callerId,
  callerName,
  targetUserId,
  isIncoming = false,
}) => {
  const [callState, setCallState] = useState<CallState>(isIncoming ? 'ringing' : 'calling');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [showControls, setShowControls] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const terminalCloseTimerRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  const ringtoneTimerRef = useRef<number | null>(null);
  const controlsTimerRef = useRef<number | null>(null);
  const startAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Auto-hide controls after inactivity
  useEffect(() => {
    if (!isOpen || !showControls) return;
    
    const timer = setTimeout(() => {
      setShowControls(false);
    }, 3000);
    
    return () => clearTimeout(timer);
  }, [isOpen, showControls]);

  const handleUserActivity = () => {
    if (isOpen) {
      setShowControls(true);
      if (controlsTimerRef.current) {
        clearTimeout(controlsTimerRef.current);
      }
      controlsTimerRef.current = window.setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  };

  const stopRingtone = () => {
    if (ringtoneTimerRef.current !== null) {
      window.clearInterval(ringtoneTimerRef.current);
      ringtoneTimerRef.current = null;
    }
    closeCallAudio();
  };

  useEffect(() => {
    if (!isOpen) {
      stopRingtone();
      return;
    }

    const play = isIncoming ? () => {
      const ctx = getCallAudioContext();
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const tones = [
        [392, 0, 0.34, 0.055],
        [493.88, 0.09, 0.42, 0.05],
        [587.33, 0.18, 0.52, 0.045],
        [783.99, 0.34, 0.58, 0.032],
      ];
      tones.forEach(([frequency, offset, duration, level]) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = frequency === 783.99 ? 'sine' : 'triangle';
        oscillator.frequency.setValueAtTime(frequency, now);
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(level, now + offset + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + duration + 0.02);
      });
    } : () => {
      const ctx = getCallAudioContext();
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
      gain.connect(ctx.destination);
      [523.25, 659.25, 783.99].forEach((frequency, index) => {
        const oscillator = ctx.createOscillator();
        oscillator.type = index === 2 ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(frequency, now);
        oscillator.connect(gain);
        oscillator.start(now + index * 0.10);
        oscillator.stop(now + 0.49);
      });
    };
    play();
    ringtoneTimerRef.current = window.setInterval(play, isIncoming ? 1900 : 1700);

    return () => stopRingtone();
  }, [isOpen, callState, isIncoming]);

  useEffect(() => {
    if (!isOpen) return;
    setCallState(isIncoming ? 'connecting' : 'calling');
    setErrorMessage(null);
    setDurationSeconds(0);
    setIsMuted(false);
    setIsSpeakerOn(true);
    setShowControls(true);
  }, [isOpen, isIncoming]);

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
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remote;
        remoteAudioRef.current.volume = isSpeakerOn ? 1 : 0;
        if (remote) void remoteAudioRef.current.play().catch((error) => {
          console.warn('[GAYZE Call] Remote audio autoplay was blocked', error);
        });
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
    if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = isSpeakerOn ? 1 : 0;
    }
  }, [isSpeakerOn]);

  // Ensure media tracks are cleanly stopped if modal closes or unmounts unexpectedly
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

  // Start each outgoing call exactly once. Parent rerenders must not restart
  // signalling or tear down an already-negotiating peer connection.
  useEffect(() => {
    if (!isOpen) { startAttemptRef.current = null; return; }
    if (isIncoming || !conversationId || !callerId || !targetUserId) return;
    const attemptKey = `${conversationId}:${callerId}:${targetUserId}:audio`;
    if (startAttemptRef.current === attemptKey) return;
    startAttemptRef.current = attemptKey;
    void webrtcCallService.startCall({
      conversationId,
      callerId,
      callerName: callerName || 'Gayze member',
      targetUserId,
      targetUserName: peerName,
      callType: 'audio',
    });
  }, [isOpen, isIncoming, conversationId, callerId, callerName, targetUserId, peerName]);

  if (!isOpen) return null;

  const handleEndCall = () => {
    hapticSensitiveAction();
    void webrtcCallService.endCall();
    onClose();
  };

  const handleToggleMute = () => {
    // Keep the service as the single source of truth, including when the user
    // mutes before getUserMedia has resolved.
    const nextEnabled = webrtcCallService.toggleAudio(isMuted);
    setIsMuted(!nextEnabled);
  };

  const handleToggleMinimize = () => {
    setIsMinimized(!isMinimized);
  };

  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div 
      className="fixed inset-0 z-[10000] bg-black/95 backdrop-blur-3xl transition-opacity duration-200"
      onClick={handleUserActivity}
      onTouchStart={handleUserActivity}
      onMouseMove={handleUserActivity}
    >
      {/* Hidden audio element */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {/* Main call container - Full screen audio call UI */}
      <div className="relative w-full h-[100dvh] flex flex-col items-center justify-center p-6">
        
        {/* Status Bar - iOS style */}
        <div className="absolute top-0 left-0 right-0 z-40 pt-[env(safe-area-inset-top)] pb-2">
          <div className="flex items-center justify-between px-4">
            <div className="text-white text-sm font-medium">
              {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-white/20 rounded-sm flex items-center justify-center">
                <div className="w-2 h-2 bg-white rounded-sm"></div>
              </div>
              <div className="w-6 h-3 bg-white/20 rounded-sm border border-white/30">
                <div className="w-4 h-2 bg-white rounded-sm"></div>
              </div>
            </div>
          </div>
          
          <div className="flex items-center justify-center mt-2">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 font-mono text-xs">
              <Lock className="w-3 h-3 text-emerald-400" />
              <span>P2P WEBRTC ENCRYPTED</span>
            </div>
          </div>
        </div>

        {/* Audio call visualizer */}
        <div className="flex-1 flex flex-col items-center justify-center relative">
          
          {/* Avatar and info */}
          <div className="relative">
            <div className="w-32 h-32 rounded-full bg-gradient-to-br from-[#C9A24D]/20 to-[#171922] border-2 border-[#C9A24D]/40 flex items-center justify-center text-5xl font-bold text-[#C9A24D] shadow-2xl overflow-hidden ring-4 ring-[#C9A24D]/20 ring-offset-2 ring-offset-[#0a0a0f]">
              <span aria-hidden="true">{peerName.charAt(0).toUpperCase()}</span>
              {peerAvatar && (
                <img
                  src={peerAvatar}
                  alt={peerName}
                  onError={(event) => { event.currentTarget.style.display = 'none'; }}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
            </div>
            {callState === 'connected' && (
              <span className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-emerald-500 border-2 border-[#0c0d14] flex items-center justify-center text-white text-[12px]">
                <ShieldCheck className="w-5 h-5" />
              </span>
            )}
          </div>

          <div className="space-y-2 mt-8 text-center">
            <h3 className="text-3xl font-bold text-white tracking-[-0.02em] drop-shadow-lg">
              {peerName}
            </h3>
            <p className="text-lg text-zinc-400">
              {callState === 'connected'
                ? 'Audio call connected'
                : callState === 'ringing'
                ? 'Ringing...'
                : callState === 'connecting'
                ? 'Connecting...'
                : callState === 'calling'
                ? 'Calling...'
                : callState === 'declined'
                ? 'Call declined'
                : callState === 'missed'
                ? 'No answer'
                : callState === 'failed'
                ? 'Connection failed'
                : 'Call ended'}
            </p>
          </div>

          {errorMessage && (
            <div className="max-w-xs p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-center gap-2 text-left mt-4">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Audio wave animation */}
          {callState === 'connected' && (
            <div className="flex items-center gap-4 h-16 mt-8">
              <div className="flex items-end gap-1 h-12">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div 
                    key={i}
                    className="w-2 bg-[#C9A24D] rounded-full transition-all duration-100"
                    style={{ 
                      height: `${Math.random() * 80 + 20}%`,
                      animation: `wave ${Math.random() * 0.5 + 0.5}s ease-in-out infinite alternate`
                    }}
                  />
                ))}
              </div>
              <div className="text-3xl font-mono text-white tracking-wider">
                {formatDuration(durationSeconds)}
              </div>
              <div className="flex items-end gap-1 h-12">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div 
                    key={i}
                    className="w-2 bg-[#C9A24D] rounded-full transition-all duration-100"
                    style={{ 
                      height: `${Math.random() * 80 + 20}%`,
                      animation: `wave ${Math.random() * 0.5 + 0.5}s ease-in-out infinite alternate-reverse`
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Call Controls - iOS style bottom bar */}
        <div 
          className={`absolute bottom-0 left-0 right-0 z-40 pb-[env(safe-area-inset-bottom)] pt-4 transition-all duration-300 ${
            showControls || isMinimized ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="flex items-center justify-center gap-4 px-2">
            
            {/* Mute Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleToggleMute();
              }}
              className={`w-14 h-14 rounded-2xl flex items-center justify-center border transition-all cursor-pointer ${
                isMuted
                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-400 shadow-lg shadow-rose-950/30'
                  : 'bg-white/10 border-white/20 text-white hover:bg-white/15'
              }`}
              aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>

            {/* Speaker Toggle */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsSpeakerOn((current) => !current);
              }}
              className={`w-14 h-14 rounded-2xl flex items-center justify-center border transition-all cursor-pointer ${
                !isSpeakerOn
                  ? 'bg-zinc-800/50 text-zinc-500 border-white/5'
                  : 'bg-white/10 border-white/20 text-white hover:bg-white/15'
              }`}
              aria-label="Toggle speaker"
            >
              {isSpeakerOn ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
            </button>

            {/* End Call Button - Red */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleEndCall();
              }}
              className="w-16 h-16 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-2xl shadow-rose-950/60 transition-transform active:scale-90 cursor-pointer"
              aria-label="End call"
            >
              <PhoneOff className="w-7 h-7" />
            </button>
          </div>
        </div>

        {/* Minimize button */}
        {!isMinimized && (
          <button
            onClick={handleToggleMinimize}
            className="absolute top-6 right-6 w-10 h-10 rounded-xl bg-black/50 backdrop-blur-sm border border-white/10 text-white flex items-center justify-center transition-all hover:bg-black/70 z-40"
            aria-label="Minimize call"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Minimized Audio Call Mode */}
      {isMinimized && (
        <div 
          className="fixed bottom-6 left-1/2 transform -translate-x-1/2 w-48 h-20 rounded-2xl bg-[#0a0a0f] border border-white/20 overflow-hidden shadow-2xl z-50 flex items-center p-3"
          onClick={handleToggleMinimize}
        >
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#C9A24D]/20 to-[#171922] border border-[#C9A24D]/40 flex items-center justify-center text-lg font-bold text-[#C9A24D] overflow-hidden mr-3">
            {peerAvatar ? (
              <img src={peerAvatar} alt={peerName} className="w-full h-full object-cover" />
            ) : (
              peerName.charAt(0).toUpperCase()
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="text-white text-sm font-medium truncate">
              {peerName}
            </div>
            <div className="text-zinc-400 text-xs">
              {callState === 'connected' ? formatDuration(durationSeconds) : callState}
            </div>
          </div>
          
          <div className="flex items-center gap-2 ml-2">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                handleToggleMute();
              }}
              className="w-8 h-8 rounded-lg bg-white/10 border border-white/20 text-white flex items-center justify-center text-xs"
            >
              {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleEndCall();
              }}
              className="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center text-xs"
            >
              <PhoneOff className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

