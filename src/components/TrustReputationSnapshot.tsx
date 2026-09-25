import React from 'react';
import { DatingProfile, UserProfile } from '../types';
import { ShieldCheck, CheckCircle2, QrCode, Users, Award, ShieldAlert, HeartHandshake } from 'lucide-react';

interface TrustReputationSnapshotProps {
  profile?: DatingProfile;
  user?: UserProfile;
  variant?: 'compact' | 'badge' | 'card';
  onOpenQR?: () => void;
  className?: string;
}

export const TrustReputationSnapshot: React.FC<TrustReputationSnapshotProps> = ({
  profile,
  user,
  variant = 'compact',
  onOpenQR,
  className = '',
}) => {
  const reliability = profile?.reliabilityScore ?? user?.reliabilityScore ?? 95;
  const verifiedPeers = profile?.verifiedPeersCount ?? user?.verifiedPeersCount ?? 12;
  const isSafetyVerified = profile?.safetyVerified ?? user?.safetyVerified ?? true;
  const isQRVerified = profile?.verifiedViaQR ?? false;
  const metTimes = profile?.metTimesCount ?? 0;
  const vouches = profile?.vouchesCount ?? verifiedPeers;

  const trustColor =
    reliability >= 95 ? 'text-emerald-400' : reliability >= 85 ? 'text-amber-400' : 'text-zinc-400';

  if (variant === 'badge') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-mono border ${
          reliability >= 95
            ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
            : 'bg-white/[0.04] border-white/10 text-zinc-300'
        } ${className}`}
      >
        <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
        <span className="font-bold">{reliability}</span>
        <span className="text-zinc-500">·</span>
        <span>{verifiedPeers} peers</span>
        {isQRVerified && (
          <>
            <span className="text-zinc-500">·</span>
            <span className="text-[#C9A24D] font-bold">QR ✓</span>
          </>
        )}
      </span>
    );
  }

  if (variant === 'compact') {
    return (
      <div className={`flex items-center gap-2 text-[11px] font-mono text-zinc-400 ${className}`}>
        <div className="flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="text-zinc-200 font-semibold">{reliability} Trust</span>
        </div>
        <span className="text-zinc-600">·</span>
        <div className="flex items-center gap-1 text-zinc-400">
          <Users className="w-3 h-3 text-zinc-400" />
          <span>{verifiedPeers} peers</span>
        </div>
        {isQRVerified && (
          <>
            <span className="text-zinc-600">·</span>
            <span className="text-[#C9A24D] font-semibold flex items-center gap-1">
              <QrCode className="w-3 h-3" />
              Verified
            </span>
          </>
        )}
      </div>
    );
  }

  // Full Card layout for profile sheet or trust modal
  return (
    <div className={`rounded-xl bg-[#0e1017] border border-white/10 p-3.5 space-y-3 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4 text-[#C9A24D]" />
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-white">
            TRUST & REPUTATION
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs font-mono">
          <span className={`font-bold ${trustColor}`}>{reliability}</span>
          <span className="text-zinc-500">/ 100</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        {/* Verification Status */}
        <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5 space-y-0.5">
          <span className="text-[10px] font-mono text-zinc-500 uppercase">Identity</span>
          <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{isSafetyVerified ? 'Safety Verified' : 'Standard'}</span>
          </div>
        </div>

        {/* Peer Vouch count */}
        <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5 space-y-0.5">
          <span className="text-[10px] font-mono text-zinc-500 uppercase">In-Person Peers</span>
          <div className="flex items-center gap-1.5 text-zinc-200 font-semibold font-mono">
            <Users className="w-3.5 h-3.5 text-purple-400" />
            <span>{verifiedPeers} Verified</span>
          </div>
        </div>

        {/* In-Person Encounters */}
        <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5 space-y-0.5">
          <span className="text-[10px] font-mono text-zinc-500 uppercase">Direct Encounters</span>
          <div className="flex items-center gap-1.5 text-zinc-200 font-semibold font-mono">
            <HeartHandshake className="w-3.5 h-3.5 text-[#C9A24D]" />
            <span>{metTimes > 0 ? `Met ${metTimes} times` : 'New Connection'}</span>
          </div>
        </div>

        {/* QR Handshake */}
        <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5 space-y-0.5">
          <span className="text-[10px] font-mono text-zinc-500 uppercase">QR Cryptographic</span>
          <div className="flex items-center gap-1.5 font-semibold">
            {isQRVerified ? (
              <span className="text-[#C9A24D] flex items-center gap-1">
                <QrCode className="w-3.5 h-3.5" />
                Handshake Done
              </span>
            ) : onOpenQR ? (
              <button
                type="button"
                onClick={onOpenQR}
                className="text-zinc-400 hover:text-white flex items-center gap-1 text-[11px] underline underline-offset-2 cursor-pointer"
              >
                <QrCode className="w-3.5 h-3.5 text-zinc-400" />
                Verify via QR
              </button>
            ) : (
              <span className="text-zinc-500">Unverified</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
