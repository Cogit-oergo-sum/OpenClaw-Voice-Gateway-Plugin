import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface TerminalEndingProps {
  show: boolean;
}

export const TerminalEnding: React.FC<TerminalEndingProps> = ({ show }) => {
  const [lines, setLines] = useState<{ text: string; className?: string }[]>([]);
  const [showFinal, setShowFinal] = useState(false);

  useEffect(() => {
    if (show) {
      const runEffect = async () => {
        const sequence = [
          { text: "$ npm install @zego/openclaw-voice-gateway", delay: 30, typing: true },
          { text: "", delay: 300 },
          { text: "> fetching metadata...", delay: 20, className: "text-gray-500" },
          { text: "> checking dependencies...", delay: 20, className: "text-gray-500" },
          { text: "✔ Installation complete.", delay: 500, className: "text-emerald-400 font-bold mt-2" },
        ];

        for (const item of sequence) {
          if (item.typing) {
            let currentText = "";
            for (let i = 0; i <= item.text.length; i++) {
              currentText = item.text.substring(0, i);
              setLines(prev => {
                const newLines = [...prev];
                if (newLines.length > 0 && newLines[newLines.length - 1].text.startsWith("$")) {
                  newLines[newLines.length - 1].text = currentText;
                  return newLines;
                } else {
                  return [...prev, { text: currentText, className: item.className }];
                }
              });
              await new Promise(r => setTimeout(r, (item.delay || 0) + Math.random() * 20));
            }
          } else {
            setLines(prev => [...prev, { text: item.text, className: item.className }]);
            await new Promise(r => setTimeout(r, item.delay));
          }
        }
        
        setTimeout(() => setShowFinal(true), 800);
      };

      runEffect();
    }
  }, [show]);

  if (!show) return null;

  return (
    <div className="terminal-bg inset-0 absolute flex items-center justify-center flex-col z-50 opacity-100 bg-black pointer-events-auto">
      <div className="w-full max-w-md p-8">
        <div className="text-emerald-400 font-mono text-sm typing-cursor mb-6 leading-relaxed flex flex-col items-start w-full mx-auto min-h-[120px]">
          {lines.map((line, i) => (
            <div key={i} className={line.className}>{line.text}</div>
          ))}
        </div>
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={showFinal ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 1 }}
          className="text-center mt-16 flex flex-col items-center"
        >
          <h1 className="text-3xl font-bold mb-4 tracking-tight drop-shadow-2xl text-white">构建企业级超级助理</h1>
          <p className="text-sm font-medium tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400 pb-2">
            只需一行代码，注入亿级通话并发底座
          </p>
          <div className="mt-12 inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-md">
            <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
            </svg>
            <span className="font-mono text-[10px] text-gray-300 tracking-wider">github.com/zego/openclaw-voice-gateway</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
};
