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
    const stream = webrtcCallService.getLocalStream?.();
    const track = stream?.getAudioTracks()[0];
    const nextMuted = track ? track.enabled : !isMuted;
    if (track) {
      track.enabled = !nextMuted;
    } else {
      webrtcCallService.toggleAudio(!nextMuted);
    }
    setIsMuted(nextMuted);
  };

  const handleToggleVideo = () => {
    const nextState = webrtcCallService.toggleVideo();
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

  // GAYZE call surface — shared visual language for audio and video.
  const statusLabel =
    callState === 'connected' ? 'Connected' :
    callState === 'ringing' ? 'Ringing' :
    callState === 'connecting' ? 'Connecting securely' :
    callState === 'calling' ? 'Calling' :
    callState === 'declined' ? 'Call declined' :
    callState === 'missed' ? 'No answer' :
    callState === 'failed' ? 'Connection failed' : 'Call ended';

  const statusDetail =
    callState === 'connected'
      ? (initialCallType === 'video' ? 'Private peer-to-peer video' : 'Private peer-to-peer audio')
      : callState === 'ringing'
        ? 'Their device is ringing'
        : callState === 'connecting'
          ? 'Establishing a secure peer connection'
          : callState === 'calling'
            ? 'Waiting for them to answer'
            : callState === 'declined'
              ? peerName + ' is unavailable'
              : callState === 'missed'
                ? peerName + ' did not answer'
                : callState === 'failed'
                  ? 'We could not establish the call'
                  : 'Call finished';

  const isLive = callState === 'connected';
  const isVideoCall = initialCallType === 'video';
  const showVideo = isVideoCall && isVideoEnabled && isLive;

  return (
    <div
      className="fixed inset-0 z-[80] overflow-hidden bg-[#07070b] text-white"
      onClick={handleUserActivity}
      onTouchStart={handleUserActivity}
      onMouseMove={handleUserActivity}
    >
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      <div className="relative h-[100dvh] w-full overflow-hidden">
        {showVideo ? (
          <>
            <video ref={remoteVideoRef} autoPlay playsInline className="absolute inset-0 h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(7,7,11,.78)_0%,rgba(7,7,11,.08)_27%,rgba(7,7,11,.04)_54%,rgba(7,7,11,.9)_100%)]" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_25%,rgba(111,60,195,.18),transparent_38%),radial-gradient(circle_at_50%_100%,rgba(201,162,77,.12),transparent_42%)]" />
          </>
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(111,60,195,.2),transparent_28%),radial-gradient(circle_at_50%_70%,rgba(201,162,77,.1),transparent_34%),linear-gradient(155deg,#0b0b12_0%,#11111b_48%,#08080d_100%)]" />
        )}

        <div className="absolute inset-x-0 top-0 z-40 px-4 pt-[calc(env(safe-area-inset-top)+14px)] sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1.5 backdrop-blur-xl">
                <span className={'h-1.5 w-1.5 rounded-full ' + (isLive ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.8)]' : 'bg-[#C9A24D] shadow-[0_0_10px_rgba(201,162,77,.65)]')} />
                <Lock className="h-3.5 w-3.5 text-white/70" />
                <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/75">GAYZE secure call</span>
              </div>
              <div className="mt-3 pl-1">
                <div className="text-[22px] font-semibold tracking-[-0.03em]">{peerName}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[12px] text-white/55">
                  <span>{statusLabel}</span>
                  {isLive && <span className="text-white/25">•</span>}
                  {isLive && <span className="font-mono tabular-nums text-white/70">{formatDuration(durationSeconds)}</span>}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleEndCall(); }}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/30 text-white/75 backdrop-blur-xl transition active:scale-95"
              aria-label="Close call"
            >
              <span className="text-xl leading-none">×</span>
            </button>
          </div>
        </div>

        {!showVideo && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-6 pb-28 pt-32 text-center">
            <div className="relative">
              <div className={'absolute -inset-5 rounded-full border border-[#6F3CC3]/25 ' + (isLive ? 'animate-pulse' : '')} />
              <div className={'absolute -inset-9 rounded-full border border-[#C9A24D]/10 ' + (isLive ? 'animate-pulse' : '')} />
              <div className="relative h-32 w-32 overflow-hidden rounded-full border border-white/15 bg-[#171720] shadow-[0_20px_80px_rgba(0,0,0,.45)] sm:h-36 sm:w-36">
                {peerAvatar ? (
                  <img src={peerAvatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(145deg,rgba(111,60,195,.34),rgba(201,162,77,.16))] text-5xl font-semibold text-white">
                    {peerName.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#0b0b12] bg-emerald-500 text-white shadow-lg">
                {isLive ? <ShieldCheck className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              </div>
            </div>

            <div className="mt-8 max-w-sm">
              <h2 className="text-3xl font-semibold tracking-[-0.04em]">{peerName}</h2>
              <p className="mt-2 text-sm text-white/55">{statusDetail}</p>
            </div>

            {isLive && (
              <div className="mt-8 flex h-10 items-end justify-center gap-1.5" aria-label="Audio activity">
                {[18, 30, 12, 36, 22, 42, 16, 28, 20].map((height, index) => (
                  <span key={index} className="w-1 rounded-full bg-[linear-gradient(180deg,#C9A24D,#6F3CC3)]" style={{ height: height, opacity: 0.45 + (index % 3) * 0.16 }} />
                ))}
              </div>
            )}

            {!isLive && (
              <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-4 py-2 text-[11px] text-white/55 backdrop-blur-xl">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#C9A24D]" />
                {statusLabel}
              </div>
            )}

            {errorMessage && (
              <div className="mt-5 flex max-w-sm items-start gap-2 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-left text-xs text-rose-200 backdrop-blur-xl">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>
        )}

        {isVideoCall && isVideoEnabled && (
          <div className={'absolute right-4 top-[calc(env(safe-area-inset-top)+104px)] z-30 h-36 w-24 overflow-hidden rounded-2xl border border-white/20 bg-black/60 shadow-2xl backdrop-blur-xl sm:right-6 sm:h-44 sm:w-32 ' + (showVideo ? 'opacity-100' : 'opacity-0')}>
            <video ref={localVideoRef} autoPlay playsInline muted className="mirror h-full w-full object-cover" />
            <div className="absolute inset-x-2 bottom-2 rounded-lg bg-black/45 px-2 py-1 text-center text-[9px] font-medium uppercase tracking-[0.12em] text-white/70 backdrop-blur-md">You</div>
          </div>
        )}

        <div className={'absolute inset-x-0 bottom-0 z-40 px-4 pb-[calc(env(safe-area-inset-bottom)+14px)] pt-20 transition-opacity duration-300 sm:px-6 ' + (showControls || isMinimized ? 'opacity-100' : 'opacity-0')}>
          <div className="mx-auto flex max-w-md items-center justify-center gap-2.5 rounded-[28px] border border-white/10 bg-[#0c0c13]/75 p-2.5 shadow-[0_-18px_60px_rgba(0,0,0,.35)] backdrop-blur-2xl">
            <button type="button" onClick={(e) => { e.stopPropagation(); handleToggleMute(); }} className={'flex h-12 w-12 items-center justify-center rounded-full border transition active:scale-95 ' + (isMuted ? 'border-rose-400/40 bg-rose-500/15 text-rose-300' : 'border-white/10 bg-white/[0.06] text-white/85')} aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}>
              {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>

            {isVideoCall && (
              <button type="button" onClick={(e) => { e.stopPropagation(); handleToggleVideo(); }} className={'flex h-12 w-12 items-center justify-center rounded-full border transition active:scale-95 ' + (!isVideoEnabled ? 'border-white/10 bg-white/[0.035] text-white/35' : 'border-[#6F3CC3]/45 bg-[#6F3CC3]/15 text-white')} aria-label={isVideoEnabled ? 'Turn camera off' : 'Turn camera on'}>
                {isVideoEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
              </button>
            )}

            {isVideoCall && isVideoEnabled && (
              <button type="button" onClick={(e) => { e.stopPropagation(); handleFlipCamera(); }} className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/75 transition active:scale-95" aria-label="Flip camera">
                <RefreshCw className="h-5 w-5" />
              </button>
            )}

            <button type="button" onClick={(e) => { e.stopPropagation(); setIsSpeakerOn((current) => !current); }} className={'flex h-12 w-12 items-center justify-center rounded-full border transition active:scale-95 ' + (!isSpeakerOn ? 'border-white/10 bg-white/[0.035] text-white/35' : 'border-white/10 bg-white/[0.06] text-white/85')} aria-label={isSpeakerOn ? 'Turn speaker off' : 'Turn speaker on'}>
              {isSpeakerOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </button>

            <button type="button" onClick={(e) => { e.stopPropagation(); handleEndCall(); }} className="ml-1 flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-[0_8px_28px_rgba(225,29,72,.34)] transition hover:bg-rose-500 active:scale-95" aria-label="End call">
              <PhoneOff className="h-6 w-6" />
            </button>
          </div>

          <div className="mx-auto mt-3 flex max-w-md items-center justify-center gap-2 text-[10px] uppercase tracking-[0.16em] text-white/35">
            <Lock className="h-3 w-3" />
            End-to-end peer connection
          </div>
        </div>
      </div>
    </div>
  );

  // Separate Audio Call UI component
  export const FullScreenAudioCallModal: React.FC<FullScreenCallModalProps> = ({
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
    const [isSpeakerOn, setIsSpeakerOn] = useState(true);
    const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
    const terminalCloseTimerRef = useRef<number | null>(null);
    const onCloseRef = useRef(onClose);
    const ringtoneTimerRef = useRef<number | null>(null);

    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    const stopRingtone = () => {
      if (ringtoneTimerRef.current !== null) {
        window.clearInterval(ringtoneTimerRef.current);
        ringtoneTimerRef.current = null;
      }
      closeCallAudio();
    };

    const playTone = () => {
      const ctx = getCallAudioContext();
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.07, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
      gain.connect(ctx.destination);
      [392, 493.88, 587.33].forEach((frequency, index) => {
        const oscillator = ctx.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, now + index * 0.09);
        oscillator.connect(gain);
        oscillator.start(now + index * 0.09);
        oscillator.stop(now + 0.45);
      });
    };

    useEffect(() => {
      if (!isOpen || (callState !== 'calling' && callState !== 'ringing')) {
        stopRingtone();
        return;
      }
      playTone();
      ringtoneTimerRef.current = window.setInterval(playTone, 1700);
      return () => stopRingtone();
    }, [isOpen, callState]);

    useEffect(() => {
      if (!isOpen) return;
      setCallState(isIncoming ? 'connecting' : 'calling');
      setErrorMessage(null);
      setDurationSeconds(0);
      setIsMuted(false);
      setIsSpeakerOn(true);
    }, [isOpen, isIncoming, conversationId]);

    useEffect(() => {
      if (!isOpen) return;
      const unsubState = webrtcCallService.subscribeState((state, error) => {
        setCallState(state);
        setErrorMessage(error || null);
        if (state === 'ringing') triggerVibration([80, 100]);
        else if (state === 'connected') triggerVibration([40, 60, 120]);
        else if (state === 'ended' || state === 'declined' || state === 'failed') {
          triggerVibration([100, 50, 100]);
          if (terminalCloseTimerRef.current !== null) window.clearTimeout(terminalCloseTimerRef.current);
          terminalCloseTimerRef.current = window.setTimeout(() => {
            terminalCloseTimerRef.current = null;
            onCloseRef.current();
          }, 2200);
        }
      });

      const unsubStreams = webrtcCallService.subscribeStreams((_local, remote) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remote;
          remoteAudioRef.current.volume = isSpeakerOn ? 1 : 0;
          if (remote) void remoteAudioRef.current.play().catch(() => undefined);
        }
      });

      return () => {
        unsubState();
        unsubStreams();
        if (terminalCloseTimerRef.current !== null) window.clearTimeout(terminalCloseTimerRef.current);
      };
    }, [isOpen]);

    useEffect(() => {
      if (remoteAudioRef.current) remoteAudioRef.current.volume = isSpeakerOn ? 1 : 0;
    }, [isSpeakerOn]);

    useEffect(() => {
      if (!isOpen) {
        const state = webrtcCallService.getState();
        if (state !== 'idle' && state !== 'ended' && state !== 'declined' && state !== 'missed') void webrtcCallService.endCall();
      }
    }, [isOpen]);

    useEffect(() => {
      if (!isOpen || callState !== 'connected') {
        setDurationSeconds(0);
        return;
      }
      const interval = window.setInterval(() => setDurationSeconds((s) => s + 1), 1000);
      return () => window.clearInterval(interval);
    }, [isOpen, callState]);

    useEffect(() => {
      if (isOpen && !isIncoming && conversationId && callerId && targetUserId) {
        void webrtcCallService.startCall({
          conversationId,
          callerId,
          callerName: callerName || 'Gayze member',
          targetUserId,
          targetUserName: peerName,
          callType: 'audio',
        });
      }
    }, [isOpen, isIncoming, conversationId, callerId, callerName, targetUserId, peerName]);

    if (!isOpen) return null;

    const handleEndCall = () => {
      hapticSensitiveAction();
      void webrtcCallService.endCall();
      onClose();
    };

    const handleToggleMute = () => {
      const next = webrtcCallService.toggleAudio();
      setIsMuted(!next);
    };

    const formatDuration = (secs: number) => {
      const mins = Math.floor(secs / 60);
      const s = secs % 60;
      return mins.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
    };

    return (
      <div className="fixed inset-0 z-[80] overflow-hidden bg-[#07070b] text-white">
        <div className="relative flex h-[100dvh] w-full flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_35%,rgba(111,60,195,.22),transparent_28%),radial-gradient(circle_at_50%_75%,rgba(201,162,77,.12),transparent_35%),linear-gradient(160deg,#08080d,#12121b,#08080d)] px-6 text-center">
          <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

          <div className="absolute inset-x-0 top-0 px-5 pt-[calc(env(safe-area-inset-top)+16px)]">
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1.5 backdrop-blur-xl">
                <Lock className="h-3.5 w-3.5 text-white/65" />
                <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/65">GAYZE secure audio</span>
              </div>
              <div className="font-mono text-xs text-white/50">{callState === 'connected' ? formatDuration(durationSeconds) : statusLabel}</div>
            </div>
          </div>

          <div className="relative">
            <div className={'absolute -inset-7 rounded-full border border-[#6F3CC3]/25 ' + (callState === 'connected' ? 'animate-pulse' : '')} />
            <div className={'absolute -inset-12 rounded-full border border-[#C9A24D]/10 ' + (callState === 'connected' ? 'animate-pulse' : '')} />
            <div className="h-36 w-36 overflow-hidden rounded-full border border-white/15 bg-[#171720] shadow-[0_24px_90px_rgba(0,0,0,.45)]">
              {peerAvatar ? <img src={peerAvatar} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(145deg,rgba(111,60,195,.34),rgba(201,162,77,.16))] text-5xl font-semibold">{peerName.charAt(0).toUpperCase()}</div>}
            </div>
            <div className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#0b0b12] bg-emerald-500">
              <ShieldCheck className="h-4 w-4" />
            </div>
          </div>

          <h2 className="mt-8 text-3xl font-semibold tracking-[-0.04em]">{peerName}</h2>
          <p className="mt-2 text-sm text-white/50">{statusDetail}</p>

          {callState === 'connected' && (
            <div className="mt-8 flex h-9 items-end gap-1.5">
              {[16, 26, 12, 34, 20, 40, 15, 28, 18].map((height, index) => (
                <span key={index} className="w-1 rounded-full bg-[linear-gradient(180deg,#C9A24D,#6F3CC3)]" style={{ height: height, opacity: 0.45 + (index % 3) * 0.16 }} />
              ))}
            </div>
          )}

          {errorMessage && (
            <div className="mt-5 flex max-w-sm items-start gap-2 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-left text-xs text-rose-200 backdrop-blur-xl">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 px-5 pb-[calc(env(safe-area-inset-bottom)+18px)] pt-20">
            <div className="mx-auto flex max-w-sm items-center justify-center gap-3 rounded-[28px] border border-white/10 bg-[#0c0c13]/75 p-3 shadow-[0_-18px_60px_rgba(0,0,0,.35)] backdrop-blur-2xl">
              <button type="button" onClick={(e) => { e.stopPropagation(); handleToggleMute(); }} className={'flex h-13 w-13 items-center justify-center rounded-full border transition active:scale-95 ' + (isMuted ? 'border-rose-400/40 bg-rose-500/15 text-rose-300' : 'border-white/10 bg-white/[0.06] text-white/85')} aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}>
                {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); setIsSpeakerOn((current) => !current); }} className={'flex h-13 w-13 items-center justify-center rounded-full border transition active:scale-95 ' + (!isSpeakerOn ? 'border-white/10 bg-white/[0.035] text-white/35' : 'border-white/10 bg-white/[0.06] text-white/85')} aria-label={isSpeakerOn ? 'Turn speaker off' : 'Turn speaker on'}>
                {isSpeakerOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); handleEndCall(); }} className="ml-1 flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-[0_8px_28px_rgba(225,29,72,.34)] transition hover:bg-rose-500 active:scale-95" aria-label="End call">
                <PhoneOff className="h-6 w-6" />
              </button>
            </div>
            <div className="mx-auto mt-3 flex max-w-sm items-center justify-center gap-2 text-[10px] uppercase tracking-[0.16em] text-white/30">
              <Lock className="h-3 w-3" /> End-to-end peer connection
            </div>
          </div>
        </div>
      </div>
    );
  };
};
