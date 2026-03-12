import React, { useEffect, useRef } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type AgentState = 'idle' | 'listening' | 'speaking' | 'warning';

interface FluidVoiceCoreProps {
  state: AgentState;
  pulseTrigger?: number; // Change this to trigger pulse
}

export const FluidVoiceCore: React.FC<FluidVoiceCoreProps> = ({ state, pulseTrigger }) => {
  const orbRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pulseTrigger && orbRef.current && innerRef.current) {
      const isAI = state === 'speaking' || state === 'warning';
      orbRef.current.style.transform = isAI ? 'scale(1.2)' : 'scale(1.05)';
      innerRef.current.style.transform = 'scale(1.1)';
      
      const timer = setTimeout(() => {
        if (orbRef.current) orbRef.current.style.transform = '';
        if (innerRef.current) innerRef.current.style.transform = '';
      }, 40);
      
      return () => clearTimeout(timer);
    }
  }, [pulseTrigger, state]);

  const stateClasses = {
    idle: 'state-idle',
    listening: 'state-listening',
    speaking: 'state-speaking',
    warning: 'state-warning',
  };

  return (
    <div className={cn("voice-core-container", stateClasses[state])}>
      <div className="ring-outer" />
      <div ref={innerRef} className="ring-inner" />
      <div ref={orbRef} className="core-orb" />
    </div>
  );
};
