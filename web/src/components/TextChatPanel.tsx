import React, { useState, useRef, useEffect } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

import type { Message } from './SubtitleStream';

interface TextChatPanelProps {
  messages: Message[];
  onSendMessage: (text: string) => void;
}

export const TextChatPanel: React.FC<TextChatPanelProps> = ({ 
  messages, 
  onSendMessage
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      onSendMessage(inputValue.trim());
      setInputValue('');
    }
  };

  return (
    <div className={`fixed right-6 bottom-24 z-50 transition-all duration-500 ${isOpen ? 'w-80 h-[500px]' : 'w-12 h-12'}`}>
      {!isOpen ? (
        <button 
          onClick={() => setIsOpen(true)}
          className="w-full h-full rounded-full bg-cyan-500/20 backdrop-blur-xl border border-cyan-500/30 flex items-center justify-center text-cyan-400 hover:bg-cyan-500/40 transition-all shadow-lg shadow-cyan-500/20"
        >
          <svg viewBox="0 0 24 24" className="w-6 h-6 fill-none stroke-current stroke-2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      ) : (
        <div className="w-full h-full flex flex-col rounded-2xl bg-black/60 backdrop-blur-2xl border border-white/10 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
          {/* Header */}
          <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/5">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono tracking-widest text-cyan-400 uppercase">Text Console</span>
              <div className="bg-purple-500/20 text-purple-400 px-2 py-1 text-[9px] rounded-md border border-purple-500/10 font-mono">
                V3
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-white/30 hover:text-white/60">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current stroke-2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center opacity-20 transform scale-75">
                 <div className="w-12 h-12 rounded-full border border-dashed border-white flex items-center justify-center mb-2">
                    <div className="w-2 h-2 bg-white rounded-full animate-ping" />
                 </div>
                 <div className="text-[10px] font-mono tracking-wider">AWAITING INPUT</div>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`px-4 py-2 rounded-2xl max-w-[85%] text-xs leading-relaxed ${
                    m.role === 'user' 
                      ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-100 rounded-br-none' 
                      : 'bg-white/5 border border-white/10 text-white/80 rounded-bl-none'
                  }`}>
                    {m.role === 'agent' && m.trace && m.trace.length > 0 && (
                      <div className="text-[9px] font-mono text-green-400/80 mb-1 border-b border-green-500/10 pb-1 italic">
                        {m.trace.join(' ➔ ')}
                      </div>
                    )}
                    {m.fragments && m.fragments.length > 0 ? (
                      m.fragments.map((frag, i) => (
                        <span key={i} className={cn(
                          frag.type === 'thought' ? "text-[10px] text-white/40 italic block border-l border-white/10 pl-2 my-1" :
                          frag.type === 'waiting' ? "text-red-400 italic" :
                          frag.type === 'idle' ? "text-pink-300" :
                          frag.type === 'internal' ? "text-purple-400 font-bold" :
                          "text-white/80"
                        )}>
                          {frag.text}
                        </span>
                      ))
                    ) : (
                      m.text
                    )}
                    {m.isTyping && <span className="inline-block w-1.5 h-3 bg-cyan-400/50 ml-1 animate-pulse" />}
                    
                    {/* [V3.7.2] Latency Metrics Visualization */}
                    {m.role === 'agent' && m.perf && (
                      <div className="mt-2 p-2 rounded-lg bg-black/40 border border-white/5 font-mono text-[9px] w-full animate-in slide-in-from-top-2 duration-300">
                        <div className="flex justify-between border-b border-white/5 pb-1 mb-1">
                          <span className="text-cyan-400 font-bold uppercase tracking-tighter">Latency Analysis</span>
                          <span className="font-bold text-white text-[10px]">{m.perf.total}ms</span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 opacity-80">
                          <div className="flex justify-between gap-1">
                            <span className="text-white/40">TTFT</span>
                            <span className="text-green-400">{m.perf.ttft ?? '-'}</span>
                          </div>
                          <div className="flex justify-between gap-1">
                            <span className="text-white/40">1st Sent</span>
                            <span className="text-yellow-400">{m.perf.first_sentence ?? '-'}</span>
                          </div>
                        </div>
                        <div className="mt-1 flex items-center gap-1 overflow-hidden h-1.5 bg-white/5 rounded-full border border-white/5">
                           {m.perf.modules.router && <div className="h-full bg-blue-500" style={{ width: `${(m.perf.modules.router / m.perf.total) * 100}%` }} />}
                           {m.perf.modules.slc && <div className="h-full bg-cyan-400" style={{ width: `${(m.perf.modules.slc / m.perf.total) * 100}%` }} />}
                           {m.perf.modules.sle && <div className="h-full bg-purple-500" style={{ width: `${(m.perf.modules.sle / m.perf.total) * 100}%` }} />}
                           {m.perf.modules.tool && <div className="h-full bg-orange-500" style={{ width: `${(m.perf.modules.tool / m.perf.total) * 100}%` }} />}
                           {m.perf.modules.summarize && <div className="h-full bg-green-500" style={{ width: `${(m.perf.modules.summarize / m.perf.total) * 100}%` }} />}
                        </div>
                        <div className="mt-1 grid grid-cols-5 justify-items-center text-[7px] text-white/30 uppercase tracking-widest">
                           <span className="text-blue-400">R:{m.perf.modules.router ?? 0}</span>
                           <span className="text-cyan-400">SLC:{m.perf.modules.slc ?? 0}</span>
                           <span className="text-purple-400">SLE:{m.perf.modules.sle ?? 0}</span>
                           <span className="text-orange-400">T:{m.perf.modules.tool ?? 0}</span>
                           <span className="text-green-400">S:{m.perf.modules.summarize ?? 0}</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <span className="text-[8px] font-mono opacity-20 mt-1 uppercase">
                    {m.role === 'user' ? 'System User' : `FastAgent V3`}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="p-4 bg-white/5 border-t border-white/5">
            <div className="relative">
              <input 
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Type your command..."
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-500/50 transition-all pr-12"
              />
              <button 
                type="submit"
                disabled={!inputValue.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center text-cyan-400 disabled:opacity-20 transition-all hover:bg-cyan-400/10"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current stroke-2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <div className="mt-2 text-[8px] font-mono text-center opacity-20 uppercase tracking-tighter">
              Press Enter to execute on Gateway Core
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
