import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface WidgetData {
  show: boolean;
  title: string;
  task: string;
  status: 'RUNNING' | 'SUCCESS' | 'DONE' | 'ERROR';
  progress: number;
  log?: string;
}

interface GlassWidgetProps {
  data: WidgetData;
}

export const GlassWidget: React.FC<GlassWidgetProps> = ({ data }) => {
  const isSuccess = data.status === 'SUCCESS' || data.status === 'DONE';
  const statusColor = isSuccess ? 'text-emerald-400' : 'text-blue-400';
  const dotColor = isSuccess ? 'bg-emerald-400' : 'bg-blue-400 animate-pulse';
  const barColor = isSuccess ? 'bg-emerald-400' : 'bg-blue-500';

  return (
    <div 
      className={cn(
        "fixed top-16 right-4 w-56 glass-panel rounded-2xl p-4 transition-all duration-600 z-30 pointer-events-none",
        data.show ? "translate-x-0 scale-100 opacity-100" : "translate-x-[120%] scale-95 opacity-0 rotate-y-10"
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cn("w-2 h-2 rounded-full", dotColor)} />
          <span className="text-[10px] text-gray-300 font-mono font-medium tracking-wide uppercase">
            {data.title}
          </span>
        </div>
        <span className={cn("text-[9px] font-mono uppercase tracking-widest", statusColor)}>
          {data.status}
        </span>
      </div>
      
      <div className="text-sm font-semibold text-white/90 mb-3 truncate drop-shadow-md">
        {data.task}
      </div>
      
      <div className="w-full bg-black/40 rounded-full h-1.5 overflow-hidden border border-white/5 relative">
        <div 
          className={cn("h-full glow-progress rounded-full transition-all duration-300", barColor)}
          style={{ width: `${data.progress}%` }} 
        />
      </div>
      
      {data.log && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="font-mono text-[9px] text-emerald-400/90 break-words leading-relaxed">
            {`> ${data.log}`}
          </div>
        </div>
      )}
    </div>
  );
};
