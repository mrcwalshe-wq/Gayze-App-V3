import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  PhoneOff,
  Minimize2,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  ShieldCheck,
  RefreshCw,
  AlertCircle,
  ChevronDown
} from 'lucide-react';
import { hapticSensitiveAction, triggerVibration } from '../services/hapticService';
import { webrtcCallService, CallState, type IncomingCall } from '../services/webrtcService';
import { getCallAudioContext, closeCallAudio } from '../services/callAudioService';
import {
  CallAura, CallDockButton, CallOrb, CallSecureChip, CallVoiceBars, DraggablePip,
  callStatusLabel, formatCallDuration, isCallPending, useCallLevels,
} from './callUi';

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

  const levelRef = useCallLevels<HTMLDivElement>(isOpen && callState === 'connected');

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
      } else if (state === 'ended' || state === 'declined' || state === 'missed' || state === 'failed') {
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

  // Render at document.body so app-shell stacking contexts cannot leave the
  // navigation bar above the full-screen call surface on iOS Safari.
  const showRemote = callState === 'connected' && isVideoEnabled;
  const controlsVisible = !showRemote || showControls || isMinimized;
  const pending = isCallPending(callState);

  return createPortal(
    <div
      ref={levelRef}
      data-gayze-call-screen="true"
      data-state={callState}
      className={`g-call g-call--video ${isMinimized ? 'is-mini' : ''} ${showRemote ? 'has-remote' : ''}`}
      onClick={isMinimized ? handleToggleMinimize : handleUserActivity}
      onTouchStart={isMinimized ? undefined : handleUserActivity}
      onMouseMove={isMinimized ? undefined : handleUserActivity}
    >
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
      <CallAura />

      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className={`g-call__remote ${showRemote ? 'is-on' : ''}`}
      />
      <div className="g-call__scrim" aria-hidden="true" />

      {!showRemote && (
        <div className="g-call__center g-call__full">
          <CallOrb name={peerName} avatar={peerAvatar} state={callState} />
          <h3 className="g-call__name">{peerName}</h3>
          <p className={`g-call__status ${pending ? 'is-pending' : ''}`}>
            {callState === 'connected' ? formatCallDuration(durationSeconds) : callStatusLabel(callState, 'video', peerName)}
          </p>
          {errorMessage && (
            <div className="g-call__error">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>
      )}

      <header className="g-call__top g-call__full">
        <CallSecureChip label={callState === 'connected' ? 'Encrypted · peer to peer' : 'End-to-end encrypted'} />
        {showRemote && <span className="g-call__time">{formatCallDuration(durationSeconds)}</span>}
        <button type="button" onClick={(e) => { e.stopPropagation(); handleToggleMinimize(); }} className="g-call__round" aria-label="Minimize call">
          <Minimize2 className="w-[18px] h-[18px]" />
        </button>
      </header>

      {showRemote && (
        <div className="g-call__who g-call__full">
          <strong>{peerName}</strong>
        </div>
      )}

      <DraggablePip hidden={!(initialCallType === 'video' && isVideoEnabled && callState === 'connected')}>
        <video ref={localVideoRef} autoPlay playsInline muted className="mirror" />
      </DraggablePip>

      <div className={`g-call__dock g-call__full ${controlsVisible ? '' : 'is-hidden'}`}>
        <div className="g-dock">
          <CallDockButton
            label={isMuted ? 'Unmute' : 'Mute'}
            ariaLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            off={isMuted}
            icon={isMuted ? <MicOff className="w-[22px] h-[22px]" /> : <Mic className="w-[22px] h-[22px]" />}
            onClick={handleToggleMute}
          />
          {initialCallType === 'video' && (
            <CallDockButton
              label={isVideoEnabled ? 'Camera' : 'Camera off'}
              ariaLabel={isVideoEnabled ? 'Disable camera' : 'Enable camera'}
              off={!isVideoEnabled}
              icon={isVideoEnabled ? <Video className="w-[22px] h-[22px]" /> : <VideoOff className="w-[22px] h-[22px]" />}
              onClick={handleToggleVideo}
            />
          )}
          {initialCallType === 'video' && isVideoEnabled && (
            <CallDockButton label="Flip" ariaLabel="Flip camera" icon={<RefreshCw className="w-[22px] h-[22px]" />} onClick={handleFlipCamera} />
          )}
          <CallDockButton
            label={isSpeakerOn ? 'Speaker' : 'Speaker off'}
            ariaLabel="Toggle speaker"
            off={!isSpeakerOn}
            icon={isSpeakerOn ? <Volume2 className="w-[22px] h-[22px]" /> : <VolumeX className="w-[22px] h-[22px]" />}
            onClick={() => setIsSpeakerOn((current) => !current)}
          />
        </div>
        <button type="button" className="g-call__end" onClick={(e) => { e.stopPropagation(); handleEndCall(); }} aria-label="End call">
          <PhoneOff className="w-6 h-6" /> <span>End call</span>
        </button>
      </div>

      <div className="g-call__mini">
        <div className="g-call__mini-bar">
          <span className="g-call__mini-name">{peerName}</span>
          <span className="g-call__mini-time">{callState === 'connected' ? formatCallDuration(durationSeconds) : callStatusLabel(callState, 'video', peerName)}</span>
          <button type="button" aria-label="End call" onClick={(e) => { e.stopPropagation(); handleEndCall(); }}><PhoneOff className="w-4 h-4" /></button>
        </div>
      </div>
    </div>
  , document.body);
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

  const levelRef = useCallLevels<HTMLDivElement>(isOpen && callState === 'connected');

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

  const pending = isCallPending(callState);

  return createPortal(
    <div
      ref={levelRef}
      data-gayze-call-screen="true"
      data-state={callState}
      className={`g-call g-call--audio ${isMinimized ? 'is-mini' : ''}`}
      onClick={isMinimized ? handleToggleMinimize : undefined}
    >
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
      <CallAura />

      <header className="g-call__top g-call__full">
        <CallSecureChip label={callState === 'connected' ? 'Encrypted · peer to peer' : 'End-to-end encrypted'} />
        <button type="button" onClick={(e) => { e.stopPropagation(); handleToggleMinimize(); }} className="g-call__round" aria-label="Minimize call">
          <Minimize2 className="w-[18px] h-[18px]" />
        </button>
      </header>

      <div className="g-call__center g-call__full">
        <CallOrb name={peerName} avatar={peerAvatar} state={callState} />
        <h3 className="g-call__name">{peerName}</h3>
        <p className={`g-call__status ${pending ? 'is-pending' : ''}`}>
          {callState === 'connected' ? callStatusLabel(callState, 'audio', peerName) : callStatusLabel(callState, 'audio', peerName)}
        </p>
        {callState === 'connected' && (
          <>
            <div className="g-call__timer">{formatCallDuration(durationSeconds)}</div>
            <CallVoiceBars />
          </>
        )}
        {errorMessage && (
          <div className="g-call__error">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      <div className="g-call__dock g-call__full">
        <div className="g-dock">
          <CallDockButton
            label={isMuted ? 'Unmute' : 'Mute'}
            ariaLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            off={isMuted}
            icon={isMuted ? <MicOff className="w-[22px] h-[22px]" /> : <Mic className="w-[22px] h-[22px]" />}
            onClick={handleToggleMute}
          />
          <CallDockButton
            label={isSpeakerOn ? 'Speaker' : 'Speaker off'}
            ariaLabel="Toggle speaker"
            off={!isSpeakerOn}
            icon={isSpeakerOn ? <Volume2 className="w-[22px] h-[22px]" /> : <VolumeX className="w-[22px] h-[22px]" />}
            onClick={() => setIsSpeakerOn((current) => !current)}
          />
        </div>
        <button type="button" className="g-call__end" onClick={(e) => { e.stopPropagation(); handleEndCall(); }} aria-label="End call">
          <PhoneOff className="w-6 h-6" /> <span>End call</span>
        </button>
      </div>

      <div className="g-call__mini">
        <CallOrb name={peerName} avatar={peerAvatar} state={callState} size="md" />
        <div className="g-call__mini-copy">
          <span className="g-call__mini-name">{peerName}</span>
          <span className="g-call__mini-time">{callState === 'connected' ? formatCallDuration(durationSeconds) : callStatusLabel(callState, 'audio', peerName)}</span>
        </div>
        <button type="button" aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'} className={isMuted ? 'is-off' : ''} onClick={(e) => { e.stopPropagation(); handleToggleMute(); }}>
          {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>
        <button type="button" aria-label="End call" className="is-end" onClick={(e) => { e.stopPropagation(); handleEndCall(); }}><PhoneOff className="w-4 h-4" /></button>
      </div>
    </div>
  , document.body);
};

