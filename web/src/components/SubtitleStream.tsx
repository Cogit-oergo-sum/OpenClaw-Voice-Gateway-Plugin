import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface Message {
  id: string;
  role: 'user' | 'agent';
  text: string;
  isInterrupted?: boolean;
  isTyping?: boolean;
  trace?: string[];
}

interface SubtitleStreamProps {
  messages: Message[];
}

export const SubtitleStream: React.FC<SubtitleStreamProps> = ({ messages }) => {
  // We only show the last 4 messages to match prototype logic
  const displayMessages = messages.slice(-4);

  return (
    <div className="h-[35%] w-full p-6 flex flex-col justify-end pb-12 z-20 pointer-events-none subtitle-mask">
      <div className="flex flex-col gap-3 w-full justify-end min-h-full">
        <AnimatePresence initial={false}>
          {displayMessages.map((msg, index) => {
            const age = displayMessages.length - 1 - index;
            
            let opacity = 1;
            let scale = 1;
            let y = 0;
            let blur = '0px';

            if (age === 1) {
              opacity = msg.role === 'agent' ? 0.9 : 0.8;
              scale = 0.98;
              y = -4;
            } else if (age === 2) {
              opacity = msg.role === 'agent' ? 0.3 : 0.2;
              scale = 0.92;
              y = -12;
              blur = '2px';
            } else if (age === 3) {
              opacity = 0.05;
              scale = 0.85;
              y = -20;
              blur = '5px';
            }

            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ 
                  opacity, 
                  scale, 
                  y, 
                  filter: `blur(${blur})` 
                }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className={cn(
                  "chat-bubble transition-all duration-400 transform-origin-left-bottom",
                  msg.role === 'agent' 
                    ? "text-xl font-semibold text-white text-glow drop-shadow-lg" 
                    : "text-sm font-medium text-gray-400/90",
                  msg.isTyping && "inline-cursor"
                )}
              >
                {msg.text}
                {msg.isInterrupted && (
                  <span className="text-red-500 animate-pulse font-bold ml-2">||</span>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};
