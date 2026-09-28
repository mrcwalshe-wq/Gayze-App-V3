import React, { useState, useEffect, useRef } from 'react';
import type { IScannerControls } from '@zxing/browser';
import { UserProfile, DatingProfile, SwarmQRPayload, SwarmRoom } from '../types';
import { hapticLight } from '../services/hapticService';
import { bufToHex, getOrCreateDeviceIdentity } from '../services/cryptoService';
import {
  X,
  QrCode,
  Camera,
  ShieldCheck,
  Lock,
  Copy,
  Check,
  RefreshCw,
  Award,
  UserCheck,
  Users,
  Sparkles,
  Upload,
  AlertCircle,
  Shield,
  Smartphone,
  Zap
} from 'lucide-react';

function isSwarmQRPayload(value: unknown): value is SwarmQRPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<SwarmQRPayload>;
  return payload.v === 2
    && payload.type === 'gayze_swarm_identity'
    && typeof payload.publicKey === 'string'
    && typeof payload.shortKey === 'string'
    && typeof payload.displayName === 'string'
    && typeof payload.neighborhood === 'string'
    && typeof payload.reliabilityScore === 'number'
    && typeof payload.verifiedPeersCount === 'number'
    && typeof payload.timestamp === 'number'
    && typeof payload.fingerprint === 'string';
}

async function validateSwarmQRPayload(rawValue: string): Promise<SwarmQRPayload> {
  const parsed: unknown = JSON.parse(rawValue);
  if (!isSwarmQRPayload(parsed)) {
    throw new Error('This is not a supported GAYZE identity QR. Ask the person to refresh their code.');
  }

  const ageMs = Date.now() - parsed.timestamp;
  if (ageMs > 120_000 || ageMs < -30_000) {
    throw new Error('This identity QR has expired. Ask the person to refresh it.');
  }

  try {
    const publicKeyJwk = JSON.parse(parsed.publicKey) as JsonWebKey;
    await window.crypto.subtle.importKey(
      'jwk',
      publicKeyJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );

    const digest = await window.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(parsed.publicKey),
    );
    const expectedFingerprint = `pk_${bufToHex(digest).slice(0, 64)}`;
    if (parsed.fingerprint !== expectedFingerprint) {
      throw new Error('The fingerprint does not match the public key in this QR.');
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'The fingerprint does not match the public key in this QR.') {
      throw error;
    }
    throw new Error('The public key in this QR is invalid.');
  }

  return parsed;
}

interface SwarmQRModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  onVerifyPeer: (payload: SwarmQRPayload) => void;
  targetPeer?: DatingProfile | null;
}

export const SwarmQRModal: React.FC<SwarmQRModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onVerifyPeer,
  targetPeer,
}) => {
  const [activeTab, setActiveTab] = useState<'my_qr' | 'scan_peer'>('my_qr');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [ephemeralNonce, setEphemeralNonce] = useState<string>(() => Math.random().toString(36).substring(2, 8));

  // Scanning state
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const payloadProcessingRef = useRef(false);

  // Manual payload input
  const [manualPayloadInput, setManualPayloadInput] = useState<string>('');
  const [scannedPeerPayload, setScannedPeerPayload] = useState<SwarmQRPayload | null>(null);
  const [verificationSuccess, setVerificationSuccess] = useState<boolean>(false);
  const [fingerprintConfirmed, setFingerprintConfirmed] = useState(false);
  const [payloadError, setPayloadError] = useState<string | null>(null);

  // If a target peer is provided when opening, go directly to the real scanner.
  useEffect(() => {
    if (targetPeer) {
      setActiveTab('scan_peer');
      setScannedPeerPayload(null);
      setFingerprintConfirmed(false);
    }
  }, [targetPeer]);

  // Generate QR code data URL whenever currentUser or ephemeralNonce changes
  useEffect(() => {
    let cancelled = false;
    const generateIdentityQr = async () => {
      try {
        const identity = await getOrCreateDeviceIdentity();
        if (cancelled) return;

        const payload: SwarmQRPayload = {
          v: 2,
          type: 'gayze_swarm_identity',
          publicKey: identity.publicKeyJwkString,
          shortKey: currentUser.shortKey,
          displayName: currentUser.displayName,
          neighborhood: currentUser.neighborhood,
          reliabilityScore: currentUser.reliabilityScore,
          verifiedPeersCount: currentUser.verifiedPeersCount,
          timestamp: Date.now(),
          fingerprint: identity.fingerprint,
        };

        const payloadString = JSON.stringify(payload);
        const qrCodeModule = await import('qrcode');
        const url = await qrCodeModule.toDataURL(payloadString, {
          width: 320,
          margin: 1.5,
          color: {
            dark: '#ffffff',
            light: '#111219',
          },
          errorCorrectionLevel: 'M',
        });

        if (!cancelled) setQrDataUrl(url);
      } catch (err) {
        console.error('Error preparing identity QR:', err);
      }
    };

    void generateIdentityQr();
    return () => { cancelled = true; };
  }, [currentUser, ephemeralNonce]);

  // Clean up camera stream when modal closes or tab changes
  useEffect(() => {
    if (!isOpen || activeTab !== 'scan_peer') {
      stopCamera();
    }
  }, [isOpen, activeTab]);

  const startCamera = async () => {
    setCameraError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('Camera access is not supported by your browser or environment.');
        return;
      }

      if (!videoRef.current) return;
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const reader = new BrowserQRCodeReader();
      scannerControlsRef.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        videoRef.current,
        (result, _error, controls) => {
          if (!result || payloadProcessingRef.current) return;
          payloadProcessingRef.current = true;
          scannerControlsRef.current = controls;
          void handlePayloadText(result.getText()).finally(() => {
            payloadProcessingRef.current = false;
          });
        },
      );
      setCameraActive(true);
    } catch (err: any) {
      console.warn('Camera error:', err);
      setCameraError('Camera permission was denied or is unavailable. Paste the identity payload instead.');
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    setCameraActive(false);
  };

  const handleCopyPayload = async () => {
    try {
      const identity = await getOrCreateDeviceIdentity();
      const payload: SwarmQRPayload = {
        v: 2,
        type: 'gayze_swarm_identity',
        publicKey: identity.publicKeyJwkString,
        shortKey: currentUser.shortKey,
        displayName: currentUser.displayName,
        neighborhood: currentUser.neighborhood,
        reliabilityScore: currentUser.reliabilityScore,
        verifiedPeersCount: currentUser.verifiedPeersCount,
        timestamp: Date.now(),
        fingerprint: identity.fingerprint,
      };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setIsCopied(true);
      hapticLight();
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Unable to copy identity payload', err);
    }
  };

  const handlePayloadText = async (rawValue: string) => {
    setPayloadError(null);
    try {
      const payload = await validateSwarmQRPayload(rawValue.trim());
      hapticLight();
      setScannedPeerPayload(payload);
      setManualPayloadInput('');
      setFingerprintConfirmed(false);
      setVerificationSuccess(false);
      stopCamera();
    } catch (error) {
      setPayloadError(error instanceof Error ? error.message : 'Unable to validate this identity QR.');
    }
  };

  const handleParseManualInput = () => {
    void handlePayloadText(manualPayloadInput);
  };

  const handleConfirmVerification = () => {
    if (!scannedPeerPayload || !fingerprintConfirmed) return;
    onVerifyPeer(scannedPeerPayload);
    setVerificationSuccess(true);
    setTimeout(() => {
      setScannedPeerPayload(null);
      setVerificationSuccess(false);
      onClose();
    }, 1800);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-md bg-[#11131a] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#C9A24D]/15 border border-[#C9A24D]/30 flex items-center justify-center text-[#C9A24D]">
              <QrCode className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                In-Person Safety Verification
              </h2>
              <p className="text-[11px] text-zinc-400">
                Scan a current identity code, then compare fingerprints in person
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="w-8 h-8 rounded-xl bg-[#171922] hover:bg-[#202330] text-zinc-400 hover:text-white flex items-center justify-center border border-white/10 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="grid grid-cols-2 p-1.5 bg-[#141620] border-b border-white/[0.08] text-xs font-medium">
          <button
            onClick={() => {
              stopCamera();
              setActiveTab('my_qr');
            }}
            className={`py-2 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${activeTab === 'my_qr'
              ? 'bg-[#1c1f2b] text-white font-semibold border border-white/10 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
              }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>My Safety QR</span>
          </button>

          <button
            onClick={() => setActiveTab('scan_peer')}
            className={`py-2 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${activeTab === 'scan_peer'
              ? 'bg-[#1c1f2b] text-white font-semibold border border-white/10 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
              }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Scan Meetup Partner</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {activeTab === 'my_qr' ? (
            /* TAB 1: Show My QR Code */
            <div className="flex flex-col items-center text-center space-y-4">
              {/* QR Code Presentation Frame */}
              <div className="p-3 bg-[#0c0d12] rounded-2xl border border-white/10 shadow-xl relative group">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="My Safety Verification QR Code"
                    className="w-56 h-56 sm:w-64 sm:h-64 rounded-xl object-contain bg-[#0c0d12]"
                  />
                ) : (
                  <div className="w-56 h-56 flex items-center justify-center text-zinc-500 text-xs">
                    Generating Safety QR...
                  </div>
                )}

                {/* Center Shield Icon */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-xl bg-[#11131a] border border-[#C9A24D]/40 flex items-center justify-center shadow-lg pointer-events-none">
                  <ShieldCheck className="w-5 h-5 text-[#C9A24D]" />
                </div>
              </div>

              {/* User Identity Details */}
              <div className="space-y-1">
                <div className="flex items-center justify-center gap-2">
                  <span className="text-base font-bold text-white">{currentUser.displayName}</span>
                  <span className="text-xs text-zinc-400">({currentUser.neighborhood})</span>
                </div>
                <div className="font-mono text-[11px] text-[#C9A24D] break-all px-2.5 py-0.5 rounded-lg bg-[#141620] border border-white/[0.08] inline-block font-semibold">
                  {currentUser.shortKey}
                </div>
              </div>

              {/* Reliability Score Card */}
              <div className="w-full p-3 rounded-xl bg-[#141620] border border-white/[0.07] flex items-center justify-between text-left">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                    <Award className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <span>Trust Score: <span className="text-[#C9A24D] font-mono">{currentUser.reliabilityScore}/100</span></span>
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      {currentUser.verifiedPeersCount} in-person verifications
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="g-badge g-badge--verify !text-[11px]">
                    Verified
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 w-full pt-1">
                <button
                  onClick={handleCopyPayload}
                  className="flex-1 min-h-[40px] px-3 py-2 rounded-xl bg-[#1c1f2b] hover:bg-[#252838] border border-white/10 text-xs font-medium text-zinc-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400 font-semibold">Payload Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-zinc-400" />
                      <span>Copy Identity Payload</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => setEphemeralNonce(Math.random().toString(36).substring(2, 8))}
                  className="min-h-[40px] px-3 py-2 rounded-xl bg-[#1c1f2b] hover:bg-[#252838] border border-white/10 text-xs font-medium text-zinc-300 hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Generate a fresh temporary safety code"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              </div>

              <div className="text-[11px] text-zinc-400 leading-normal text-center max-w-xs">
                Exchange current identity codes and compare fingerprints in person. Verification is recorded separately on each device.
              </div>
            </div>
          ) : (
            /* TAB 2: Scan Peer Key */
            <div className="space-y-4">
              {/* If peer was scanned/selected, show the verification card */}
              {scannedPeerPayload ? (
                <div className="p-4 rounded-2xl bg-[#141620] border border-[#C9A24D]/40 space-y-3.5 animate-in fade-in">
                  <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-semibold text-emerald-300">Identity payload loaded</span>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-500/40">Key fingerprint checked</span>
                  </div>

                  {/* Scanned Peer Preview */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-white tracking-tight">
                        {scannedPeerPayload.displayName}
                      </h4>
                      <p className="text-xs text-zinc-400">{scannedPeerPayload.neighborhood}</p>
                    </div>

                    <div className="text-right">
                      <div className="text-xs font-semibold text-[#C9A24D] font-mono">
                        Score: {scannedPeerPayload.reliabilityScore}/100
                      </div>
                      <div className="text-[10px] text-zinc-400">
                        {scannedPeerPayload.verifiedPeersCount} verifications
                      </div>
                    </div>
                  </div>

                  {/* Verification Code */}
                  <div className="p-2.5 rounded-xl bg-[#090a0e] border border-white/10 text-[11px] space-y-1">
                    <div className="g-label">Safety match code</div>
                    <div className="font-mono text-[#C9A24D] font-bold tracking-wider">
                      {scannedPeerPayload.fingerprint?.toUpperCase()}
                    </div>
                  </div>

                  <label className="p-2.5 rounded-xl bg-[#090a0e] border border-white/10 text-[11px] text-zinc-300 flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={fingerprintConfirmed}
                      onChange={(event) => setFingerprintConfirmed(event.target.checked)}
                      className="mt-0.5 accent-[#C9A24D]"
                    />
                    <span>I compared this fingerprint with the code on the other person's device in person, and they match.</span>
                  </label>
                  {payloadError && (
                    <div role="alert" className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-[11px] text-rose-300">
                      {payloadError}
                    </div>
                  )}

                  <div className="text-[10px] text-zinc-500">
                    This verifies the key on this device only. The other person must verify your fingerprint separately.
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => setScannedPeerPayload(null)}
                      className="min-h-[42px] px-3.5 py-2 text-xs font-medium text-zinc-400 hover:text-white bg-[#1c1f2b] hover:bg-[#252838] rounded-xl transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>

                    <button
                      onClick={handleConfirmVerification}
                      disabled={verificationSuccess || !fingerprintConfirmed}
                      className={`flex-1 min-h-[42px] px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-md ${verificationSuccess
                        ? 'bg-emerald-500 text-black'
                        : 'bg-[#C9A24D] hover:bg-[#b58f3b] text-black'
                        }`}
                    >
                      {verificationSuccess ? (
                        <>
                          <Check className="w-4 h-4" />
                          <span>Fingerprint matched</span>
                        </>
                      ) : (
                        <>
                          <UserCheck className="w-4 h-4" />
                          <span>Verify This Fingerprint</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                /* Camera QR scanner */
                <div className="space-y-4">
                  {/* Camera view container */}
                  <div className="relative w-full h-48 bg-[#090a0e] rounded-2xl border border-white/10 overflow-hidden flex flex-col items-center justify-center">
                    {cameraActive ? (
                      <>
                        <video
                          ref={videoRef}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-full object-cover"
                        />
                        {/* Target reticle */}
                        <div className="absolute inset-8 border-2 border-dashed border-[#C9A24D]/80 rounded-xl pointer-events-none animate-pulse" />
                        <button
                          onClick={stopCamera}
                          className="absolute bottom-2.5 px-3 py-1 text-[11px] font-medium bg-black/80 hover:bg-black text-white rounded-lg backdrop-blur-md border border-white/10 cursor-pointer"
                        >
                          Stop Camera
                        </button>
                      </>
                    ) : (
                      <div className="text-center p-4 space-y-2">
                        <Smartphone className="w-8 h-8 text-zinc-500 mx-auto" />
                        <p className="text-xs text-zinc-400">
                          Scan peer's screen directly using your device camera
                        </p>
                        <button
                          onClick={startCamera}
                          className="min-h-[38px] px-4 py-1.5 text-xs font-semibold text-black bg-[#C9A24D] hover:bg-[#b58f3b] rounded-xl transition-colors cursor-pointer inline-flex items-center gap-1.5 shadow-sm"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>Launch Camera Scanner</span>
                        </button>
                        {cameraError && (
                          <p className="text-[11px] text-[#C9A24D] max-w-xs">{cameraError}</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Manual Paste Code */}
                  <div className="p-3 rounded-xl bg-[#141620] border border-white/[0.07] space-y-2">
                    <label className="text-[11px] font-medium text-zinc-400 block">
                      Or paste the identity payload copied from the other person's app:
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={manualPayloadInput}
                        onChange={(e) => setManualPayloadInput(e.target.value)}
                        placeholder='Paste identity JSON...'
                        className="flex-1 bg-[#090a0e] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#C9A24D] font-mono"
                      />
                      <button
                        onClick={handleParseManualInput}
                        disabled={!manualPayloadInput.trim()}
                        className="min-h-[36px] px-3.5 py-1.5 text-xs font-semibold text-zinc-200 bg-[#1c1f2b] hover:bg-[#252838] border border-white/10 rounded-xl transition-colors cursor-pointer"
                      >
                        Check Payload
                      </button>
                    </div>
                    {payloadError && (
                      <div role="alert" className="text-[11px] text-rose-300">{payloadError}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
