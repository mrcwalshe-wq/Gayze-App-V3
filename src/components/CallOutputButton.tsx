import React from 'react';
import { Bluetooth, Car, Headphones, Smartphone, Volume2 } from 'lucide-react';
import { CallDockButton } from './callUi';
import { routeLabel, showAudioOutputPicker, type AudioRoute } from '../services/callAudioRoute';

const icon = (r: AudioRoute | null) => {
  const cls = 'w-[22px] h-[22px]';
  if (r?.kind === 'bluetooth') return <Bluetooth className={cls} />;
  if (r?.kind === 'headphones') return <Headphones className={cls} />;
  if (r?.kind === 'car') return <Car className={cls} />;
  if (r?.kind === 'receiver') return <Smartphone className={cls} />;
  return <Volume2 className={cls} />;
};

/** iPhone app: shows where the call sound is going and opens iOS's output picker (iPhone, Speaker, AirPods, car). */
export const CallOutputButton: React.FC<{ route: AudioRoute | null }> = ({ route }) => (
  <CallDockButton
    label={routeLabel(route)}
    ariaLabel={`Audio output: ${routeLabel(route)}. Change`}
    icon={icon(route)}
    onClick={() => { void showAudioOutputPicker(); }}
  />
);
