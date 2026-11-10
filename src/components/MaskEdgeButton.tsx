import React from 'react';
import { EyeOff } from 'lucide-react';

/** A slim tab on the right edge, at thumb height. One tap covers the app with a disguise screen. */
export const MaskEdgeButton: React.FC<{ onActivate: () => void }> = ({ onActivate }) => (
  <button
    type="button"
    onClick={onActivate}
    aria-label="Hide GAYZE now"
    title="Hide GAYZE now"
    className="g-mask-edge"
  >
    <EyeOff className="w-4 h-4" aria-hidden="true" />
  </button>
);
