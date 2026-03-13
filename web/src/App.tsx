import { AuroraBackground } from './components/AuroraBackground';
import { FluidVoiceCore } from './components/FluidVoiceCore';
import { GlassWidget } from './components/GlassWidget';
import { SubtitleStream } from './components/SubtitleStream';
import { TerminalEnding } from './components/TerminalEnding';
import { useAgent } from './hooks/useAgent';

function App() {
  const {
    state,
    messages,
    widget,
    showTerminal,
    hookText,
    pulseTrigger,
    isConnected,
    startCall,
    endCall,
    sendTestTTS
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
        
        {hookText && (
          <div className="absolute bottom-4 text-center font-mono text-[11px] tracking-widest text-cyan-400 transition-opacity duration-500 text-glow whitespace-pre">
            {hookText}
          </div>
        )}
      </div>

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
            onClick={(e) => { e.stopPropagation(); sendTestTTS(); }}
            className="px-6 py-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 backdrop-blur-md text-cyan-400 font-mono text-xs tracking-widest hover:bg-cyan-500/20 transition-all pointer-events-auto cursor-pointer"
          >
            TEST TTS
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
