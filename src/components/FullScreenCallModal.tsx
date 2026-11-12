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
import { webrtcCallService, CallState, type IncomingCall, type UpgradePhase } from '../services/webrtcService';
import { playCallSound, stopCallSounds } from '../services/callSounds';
import {
  CallAura, CallDockButton, CallOrb, CallSecureChip, CallVoiceBars, DraggablePip,
  callStatusLabel, formatCallDuration, isCallPending, useCallLevels, useSlowConnect,
} from './callUi';
import { CallOutputButton } from './CallOutputButton';
import { useCallAudioRoute } from '../services/callAudioRoute';

/** Point a media element at a stream only when it changed. Re-assigning the same stream restarts the element (a flash, or a
 * shrunken picture on phones) and happened on every camera flip. */
function attachStream(el: HTMLMediaElement | null, stream: MediaStream | null, opts: { muted?: boolean; volume?: number } = {}) {
  if (!el) return;
  if (opts.muted !== undefined) el.muted = opts.muted;
  if (opts.volume !== undefined) el.volume = opts.volume;
  if (el.srcObject !== stream) el.srcObject = stream;
  if (stream && el.paused) void el.play().catch(() => undefined);
}
const hasLiveVideo = (s: MediaStream | null) => !!s && s.getVideoTracks().some((t) => t.readyState === 'live');

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
  const slowConnect = useSlowConnect(callState);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(initialCallType === 'video');
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [showControls, setShowControls] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const isSpeakerOnRef = useRef(true);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const terminalCloseTimerRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  const ringtoneTimerRef = useRef<number | null>(null);
  const controlsTimerRef = useRef<number | null>(null);
  const startAttemptRef = useRef<string | null>(null);

  const levelRef = useCallLevels<HTMLDivElement>(isOpen && callState === 'connected');
  const audioRoute = useCallAudioRoute(isOpen && callState === 'connected', initialCallType === 'video');

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

  // Use the shared HTMLAudioElement sound service rather than Web Audio. On iOS,
  // Web Audio can be suspended or interfere with the active microphone route.
  const stopRingtone = () => {
    if (ringtoneTimerRef.current !== null) {
      window.clearInterval(ringtoneTimerRef.current);
      ringtoneTimerRef.current = null;
    }
    stopCallSounds();
  };

  useEffect(() => {
    if (!isOpen) {
      stopRingtone();
      return;
    }
    if (callState === 'calling' || callState === 'ringing') {
      const sound = isIncoming ? 'incoming' : 'outgoing';
      playCallSound(sound);
      ringtoneTimerRef.current = window.setInterval(() => playCallSound(sound), isIncoming ? 2600 : 2400);
    } else if (callState === 'connected') {
      stopRingtone();
      playCallSound('connected');
    } else if (callState === 'ended' || callState === 'declined' || callState === 'missed' || callState === 'failed') {
      stopRingtone();
      playCallSound(callState === 'ended' ? 'ended' : 'unanswered');
    } else {
      stopRingtone();
    }
    return () => stopRingtone();
  }, [isOpen, callState, isIncoming]);

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
      attachStream(localVideoRef.current, local);
      // Sound always plays through the <audio> element; the <video> stays muted and only receives a stream that has a picture.
      attachStream(remoteVideoRef.current, hasLiveVideo(remote) ? remote : null, { muted: true });
      attachStream(remoteAudioRef.current, remote, { volume: isSpeakerOnRef.current ? 1 : 0 });
      setHasRemoteVideo(!!remote && remote.getVideoTracks().some((t) => t.readyState === 'live'));
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
    isSpeakerOnRef.current = isSpeakerOn;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = isSpeakerOn ? 1 : 0;
    }
  }, [isSpeakerOn]);

  // The close effect is the single owner of call teardown for both call-screen variants.
  useEffect(() => {
    if (!isOpen) {
      const state = webrtcCallService.getState();
      if (state !== 'idle' && state !== 'ended' && state !== 'declined' && state !== 'missed' && state !== 'failed') {
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
    // onClose flips isOpen; the close effect above performs teardown exactly once.
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
  const showRemote = callState === 'connected' && hasRemoteVideo;
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
            {callState === 'connected' ? formatCallDuration(durationSeconds) : callStatusLabel(callState, 'video', peerName, { slow: slowConnect, incoming: isIncoming })}
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
          {audioRoute.available ? (
            <CallOutputButton route={audioRoute.route} />
          ) : (
            <CallDockButton
              label={isSpeakerOn ? 'Speaker' : 'Speaker off'}
              ariaLabel="Toggle speaker"
              off={!isSpeakerOn}
              icon={isSpeakerOn ? <Volume2 className="w-[22px] h-[22px]" /> : <VolumeX className="w-[22px] h-[22px]" />}
              onClick={() => setIsSpeakerOn((current) => !current)}
            />
          )}
        </div>
        <button type="button" className="g-call__end" onClick={(e) => { e.stopPropagation(); handleEndCall(); }} aria-label="End call">
          <PhoneOff className="w-6 h-6" /> <span>End call</span>
        </button>
      </div>

      <div className="g-call__mini">
        <div className="g-call__mini-bar">
          <span className="g-call__mini-name">{peerName}</span>
          <span className="g-call__mini-time">{callState === 'connected' ? formatCallDuration(durationSeconds) : callStatusLabel(callState, 'video', peerName, { slow: slowConnect, incoming: isIncoming })}</span>
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
  const slowConnect = useSlowConnect(callState);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [showControls, setShowControls] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [upgrade, setUpgrade] = useState<UpgradePhase>('idle');
  const [videoOn, setVideoOn] = useState(false);          // the call has been switched to video
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const isSpeakerOnRef = useRef(true);

  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const terminalCloseTimerRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  const ringtoneTimerRef = useRef<number | null>(null);
  const controlsTimerRef = useRef<number | null>(null);
  const startAttemptRef = useRef<string | null>(null);

  const levelRef = useCallLevels<HTMLDivElement>(isOpen && callState === 'connected');
  const audioRoute = useCallAudioRoute(isOpen && callState === 'connected', false);

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

  // Use the shared HTMLAudioElement sound service rather than Web Audio. On iOS,
  // Web Audio can be suspended or interfere with the active microphone route.
  const stopRingtone = () => {
    if (ringtoneTimerRef.current !== null) {
      window.clearInterval(ringtoneTimerRef.current);
      ringtoneTimerRef.current = null;
    }
    stopCallSounds();
  };

  useEffect(() => {
    if (!isOpen) {
      stopRingtone();
      return;
    }
    if (callState === 'calling' || callState === 'ringing') {
      const sound = isIncoming ? 'incoming' : 'outgoing';
      playCallSound(sound);
      ringtoneTimerRef.current = window.setInterval(() => playCallSound(sound), isIncoming ? 2600 : 2400);
    } else if (callState === 'connected') {
      stopRingtone();
      playCallSound('connected');
    } else if (callState === 'ended' || callState === 'declined' || callState === 'missed' || callState === 'failed') {
      stopRingtone();
      playCallSound(callState === 'ended' ? 'ended' : 'unanswered');
    } else {
      stopRingtone();
    }
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
    setCameraOn(true);
    setHasRemoteVideo(false);
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

    const unsubUpgrade = webrtcCallService.subscribeUpgrade((phase, type) => {
      setUpgrade(phase);
      setVideoOn(type === 'video' && (phase === 'active' || webrtcCallService.getLocalStream()?.getVideoTracks().length ? true : false));
    });

    const unsubStreams = webrtcCallService.subscribeStreams((local, remote) => {
      attachStream(localVideoRef.current, local && local.getVideoTracks().length ? local : null);
      // An audio call must stay audio-only: the picture element only receives a stream once it actually has video.
      attachStream(remoteVideoRef.current, hasLiveVideo(remote) ? remote : null, { muted: true });
      setHasRemoteVideo(!!remote && remote.getVideoTracks().some((t) => t.readyState === 'live'));
      attachStream(remoteAudioRef.current, remote, { volume: isSpeakerOnRef.current ? 1 : 0 });
    });

    return () => {
      unsubState();
      unsubUpgrade();
      unsubStreams();
      if (terminalCloseTimerRef.current !== null) {
        window.clearTimeout(terminalCloseTimerRef.current);
        terminalCloseTimerRef.current = null;
      }
    };
  }, [isOpen]);

  useEffect(() => {
    isSpeakerOnRef.current = isSpeakerOn;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = isSpeakerOn ? 1 : 0;
    }
  }, [isSpeakerOn]);

  // The close effect is the single owner of call teardown for both call-screen variants.
  useEffect(() => {
    if (!isOpen) {
      const state = webrtcCallService.getState();
      if (state !== 'idle' && state !== 'ended' && state !== 'declined' && state !== 'missed' && state !== 'failed') {
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

  useEffect(() => {
    if (videoOn && localVideoRef.current) {
      localVideoRef.current.srcObject = webrtcCallService.getLocalStream();
      void localVideoRef.current.play().catch(() => undefined);
    }
  }, [videoOn, isMinimized, callState]);
  useEffect(() => { if (upgrade === 'incoming') setIsMinimized(false); }, [upgrade]);

  if (!isOpen) return null;

  const handleEndCall = () => {
    hapticSensitiveAction();
    // onClose flips isOpen; the close effect above performs teardown exactly once.
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
  const showVideo = videoOn && callState === 'connected' && !isMinimized;
  const showRemote = showVideo && hasRemoteVideo;
  const handleToggleCamera = () => setCameraOn(webrtcCallService.toggleVideo(!cameraOn));

  return createPortal(
    <div
      ref={levelRef}
      data-gayze-call-screen="true"
      data-state={callState}
      className={`g-call ${showVideo ? 'g-call--video' : 'g-call--audio'} ${isMinimized ? 'is-mini' : ''} ${showRemote ? 'has-remote' : ''}`}
      onClick={isMinimized ? handleToggleMinimize : undefined}
    >
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
      <CallAura />
      <video ref={remoteVideoRef} autoPlay playsInline muted className={`g-call__remote ${showRemote ? 'is-on' : ''}`} />
      <div className="g-call__scrim" aria-hidden="true" />

      <header className="g-call__top g-call__full">
        <CallSecureChip label={callState === 'connected' ? 'Encrypted · peer to peer' : 'End-to-end encrypted'} />
        <button type="button" onClick={(e) => { e.stopPropagation(); handleToggleMinimize(); }} className="g-call__round" aria-label="Minimize call">
          <Minimize2 className="w-[18px] h-[18px]" />
        </button>
      </header>

      {upgrade === 'incoming' && (
        <div className="g-call__ask g-call__full" role="alertdialog" aria-label={`${peerName} wants to switch to video`}>
          <strong>{peerName} wants to switch to video</strong>
          <span>Your camera will turn on if you accept.</span>
          <div>
            <button type="button" onClick={(e) => { e.stopPropagation(); void webrtcCallService.answerVideoUpgrade(false); }}>Not now</button>
            <button type="button" className="is-go" onClick={(e) => { e.stopPropagation(); void webrtcCallService.answerVideoUpgrade(true); }}>Switch to video</button>
          </div>
        </div>
      )}
      {(upgrade === 'requesting' || upgrade === 'declined' || upgrade === 'failed') && (
        <div className="g-call__ask g-call__full" role="status">
          <strong>{upgrade === 'requesting' ? `Asking ${peerName} to switch to video…` : upgrade === 'declined' ? `${peerName} stayed on audio` : 'Couldn’t switch to video'}</strong>
          {upgrade === 'failed' && <span>Check that camera access is allowed for GAYZE.</span>}
          {upgrade === 'requesting' && <div><button type="button" onClick={(e) => { e.stopPropagation(); webrtcCallService.cancelVideoUpgrade(); }}>Cancel</button></div>}
        </div>
      )}

      {showVideo && (
        <DraggablePip hidden={!cameraOn}>
          <video ref={localVideoRef} autoPlay playsInline muted className="mirror" />
        </DraggablePip>
      )}
      {!showVideo && <video ref={localVideoRef} autoPlay playsInline muted className="hidden" />}

      {!showRemote && <div className="g-call__center g-call__full">
        <CallOrb name={peerName} avatar={peerAvatar} state={callState} />
        <h3 className="g-call__name">{peerName}</h3>
        <p className={`g-call__status ${pending ? 'is-pending' : ''}`}>
          {callState === 'connected' ? callStatusLabel(callState, 'audio', peerName, { slow: slowConnect, incoming: isIncoming }) : callStatusLabel(callState, 'audio', peerName, { slow: slowConnect, incoming: isIncoming })}
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
      </div>}

      <div className="g-call__dock g-call__full">
        <div className="g-dock">
          <CallDockButton
            label={isMuted ? 'Unmute' : 'Mute'}
            ariaLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            off={isMuted}
            icon={isMuted ? <MicOff className="w-[22px] h-[22px]" /> : <Mic className="w-[22px] h-[22px]" />}
            onClick={handleToggleMute}
          />
          {callState === 'connected' && !videoOn && (
            <CallDockButton
              label="Video"
              ariaLabel="Switch to video call"
              icon={<Video className="w-[22px] h-[22px]" />}
              onClick={() => { hapticSensitiveAction(); webrtcCallService.requestVideoUpgrade(); }}
            />
          )}
          {videoOn && (
            <CallDockButton
              label={cameraOn ? 'Camera' : 'Camera off'}
              ariaLabel={cameraOn ? 'Turn camera off' : 'Turn camera on'}
              off={!cameraOn}
              icon={cameraOn ? <Video className="w-[22px] h-[22px]" /> : <VideoOff className="w-[22px] h-[22px]" />}
              onClick={handleToggleCamera}
            />
          )}
          {audioRoute.available ? (
            <CallOutputButton route={audioRoute.route} />
          ) : (
            <CallDockButton
              label={isSpeakerOn ? 'Speaker' : 'Speaker off'}
              ariaLabel="Toggle speaker"
              off={!isSpeakerOn}
              icon={isSpeakerOn ? <Volume2 className="w-[22px] h-[22px]" /> : <VolumeX className="w-[22px] h-[22px]" />}
              onClick={() => setIsSpeakerOn((current) => !current)}
            />
          )}
        </div>
        <button type="button" className="g-call__end" onClick={(e) => { e.stopPropagation(); handleEndCall(); }} aria-label="End call">
          <PhoneOff className="w-6 h-6" /> <span>End call</span>
        </button>
      </div>

      <div className="g-call__mini">
        <CallOrb name={peerName} avatar={peerAvatar} state={callState} size="md" />
        <div className="g-call__mini-copy">
          <span className="g-call__mini-name">{peerName}</span>
          <span className="g-call__mini-time">{callState === 'connected' ? formatCallDuration(durationSeconds) : callStatusLabel(callState, 'audio', peerName, { slow: slowConnect, incoming: isIncoming })}</span>
        </div>
        <button type="button" aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'} className={isMuted ? 'is-off' : ''} onClick={(e) => { e.stopPropagation(); handleToggleMute(); }}>
          {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>
        <button type="button" aria-label="End call" className="is-end" onClick={(e) => { e.stopPropagation(); handleEndCall(); }}><PhoneOff className="w-4 h-4" /></button>
      </div>
    </div>
  , document.body);
};

