import { AuroraBackground } from './components/AuroraBackground';
import { FluidVoiceCore } from './components/FluidVoiceCore';
import { GlassWidget } from './components/GlassWidget';
import { SubtitleStream } from './components/SubtitleStream';
import { TerminalEnding } from './components/TerminalEnding';
import { TextChatPanel } from './components/TextChatPanel';
import { useAgent } from './hooks/useAgent';
import { MicOff } from 'lucide-react';

function App() {
  const {
    state,
    messages,
    widget,
    showTerminal,
    hookText,
    pulseTrigger,
    isConnected,
    isMuted,
    startCall,
    endCall,
    toggleMute,
    sendTextMessage
  } = useAgent();

  return (
    <div className="h-screen w-screen relative overflow-hidden flex flex-col justify-between cursor-pointer select-none" onClick={() => !isConnected && startCall()}>
      {/* Aurora Background Layer */}
      <AuroraBackground state={state} />

      {/* HUD Widget Wrapper */}
      <GlassWidget data={widget} />

      {/* Central Visual: Fluid Voice Core */}
      <div className="flex-1 flex flex-col items-center justify-center relative z-20 pointer-events-none">
        <FluidVoiceCore state={state} pulseTrigger={pulseTrigger} />
        
        {isConnected && isMuted && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-3 animate-pulse pointer-events-none">
            <div className="p-4 rounded-full bg-red-500/20 border border-red-500/50 backdrop-blur-xl shadow-[0_0_40px_rgba(239,68,68,0.4)] transition-all duration-300 scale-110">
              <MicOff className="w-10 h-10 text-red-400" />
            </div>
            <div className="text-[10px] font-mono tracking-[0.3em] text-red-400/90 uppercase text-glow-red animate-bounce">
              Microphone Muted
            </div>
          </div>
        )}
        
        {hookText && (
          <div className="absolute bottom-4 text-center font-mono text-[11px] tracking-widest text-cyan-400 transition-opacity duration-500 text-glow whitespace-pre">
            {hookText}
          </div>
        )}
      </div>

      {/* Text Chat Panel (Always accessible) */}
      <TextChatPanel 
        messages={messages} 
        onSendMessage={sendTextMessage}
      />

      {/* Interaction Stage: Subtitles */}
      <SubtitleStream messages={messages} />

      {/* End State Terminal Overlay */}
      <TerminalEnding show={showTerminal} />

      {/* Floating Indicators / Help */}
      {!isConnected && !showTerminal && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-10 pointer-events-none">
          <div className="text-[10px] text-white/40 font-mono tracking-widest uppercase animate-pulse">
            Tap screen to start call
          </div>
        </div>
      )}

      {isConnected && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-40 flex gap-4">
          <div 
            onClick={(e) => { e.stopPropagation(); toggleMute(); }}
            className={`px-8 py-2.5 rounded-full border font-mono text-[11px] tracking-widest transition-all duration-300 pointer-events-auto cursor-pointer flex items-center gap-2 ${
              isMuted 
                ? "border-red-500/60 bg-red-500/20 text-red-400 shadow-[0_0_20px_rgba(239,68,68,0.2)] hover:bg-red-500/30" 
                : "border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 active:scale-95 shadow-[0_0_20px_rgba(34,211,238,0.1)]"
            }`}
          >
            {isMuted && <MicOff className="w-3 h-3" />}
            {isMuted ? 'ENABLE MIC' : 'DISABLE MIC'}
          </div>
          <div 
            onClick={(e) => { e.stopPropagation(); endCall(); }}
            className="px-6 py-2 rounded-full border border-red-500/30 bg-red-500/10 backdrop-blur-md text-red-500 font-mono text-xs tracking-widest hover:bg-red-500/20 transition-all pointer-events-auto cursor-pointer"
          >
            HANG UP
          </div>
        </div>
      )}

      {/* Invisible Audio for WebRTC Player */}
      <audio id="remote-audio" autoPlay style={{ display: 'none' }} />
    </div>
  );
}

export default App;
