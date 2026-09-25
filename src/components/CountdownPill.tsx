import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface CountdownPillProps {
  expiresAt: number;
  prefix?: string;
  className?: string;
  onExpire?: () => void;
  showIcon?: boolean;
}

/**
 * Isolated CountdownPill component.
 * Manages its own timer tick internally to avoid re-rendering entire parent feeds/grids.
 */
export const CountdownPill: React.FC<CountdownPillProps> = ({
  expiresAt,
  prefix = '',
  className = '',
  onExpire,
  showIcon = true,
}) => {
  const [timeLeftStr, setTimeLeftStr] = useState<string>(() => computeTimeLeft(expiresAt));
  const [isExpired, setIsExpired] = useState<boolean>(() => Date.now() >= expiresAt);

  function computeTimeLeft(target: number): string {
    const diff = target - Date.now();
    if (diff <= 0) return 'Expired';

    const totalSeconds = Math.floor(diff / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m left`;
    }
    if (minutes > 0) {
      return `${minutes}m left`;
    }
    return `${seconds}s left`;
  }

  useEffect(() => {
    // Determine interval frequency: 1s if under 2 minutes, else 15s
    const checkInterval = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        setIsExpired(true);
        setTimeLeftStr('Expired');
        if (onExpire) onExpire();
        return;
      }
      setTimeLeftStr(computeTimeLeft(expiresAt));
    };

    checkInterval();

    const diff = expiresAt - Date.now();
    const intervalMs = diff < 2 * 60 * 1000 ? 1000 : 15000;

    const timer = setInterval(checkInterval, intervalMs);
    return () => clearInterval(timer);
  }, [expiresAt, onExpire]);

  if (isExpired) {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-medium text-zinc-500 bg-white/[0.04] border border-white/5 ${className}`}
      >
        {showIcon && <Clock className="w-2.5 h-2.5 text-zinc-500" />}
        <span>Expired</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold tracking-tight text-amber-300 bg-amber-950/40 border border-amber-500/30 ${className}`}
      title={`Active intent expires at ${new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
    >
      {showIcon && <Clock className="w-2.5 h-2.5 text-amber-400 shrink-0 animate-pulse" />}
      <span>
        {prefix ? `${prefix} ` : ''}
        {timeLeftStr}
      </span>
    </span>
  );
};
