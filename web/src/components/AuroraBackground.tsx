import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface AuroraBackgroundProps {
  state?: 'idle' | 'listening' | 'speaking' | 'warning';
}

export const AuroraBackground: React.FC<AuroraBackgroundProps> = ({ state = 'idle' }) => {
  const bgClasses = {
    idle: 'bg-indigo-900/20',
    listening: 'bg-cyan-900/30',
    speaking: 'bg-blue-900/30',
    warning: 'bg-orange-900/30',
  };

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none opacity-60">
      {/* Static Blob 1 */}
      <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full bg-blue-900/30 mix-blend-screen filter blur-[100px] animate-blob" />
      
      {/* Dynamic Aura Blob */}
      <div 
        className={cn(
          "absolute top-[20%] right-[-10%] w-[70%] h-[70%] rounded-full mix-blend-screen filter blur-[120px] animate-blob animation-delay-2000 transition-colors duration-1000",
          bgClasses[state]
        )} 
      />
      
      {/* Static Blob 2 */}
      <div className="absolute bottom-[-20%] left-[10%] w-[80%] h-[80%] rounded-full bg-indigo-900/30 mix-blend-screen filter blur-[100px] animate-blob animation-delay-4000" />
    </div>
  );
};
