import { useState, useRef, useCallback } from 'react';
import { ZegoExpressEngine } from 'zego-express-engine-webrtc';
import type { AgentState } from '../components/FluidVoiceCore';
import type { Message } from '../components/SubtitleStream';
import type { WidgetData } from '../components/GlassWidget';

const GATEWAY_URL = 'http://localhost:18789';
const MOCK_USER_ID = 'user_' + Math.floor(Math.random() * 10000);

export function useAgent() {
  const [state, setState] = useState<AgentState>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [widget, setWidget] = useState<WidgetData>({
    show: false,
    title: 'WEBHOOK',
    task: '',
    status: 'RUNNING',
    progress: 0,
  });
  const [showTerminal, setShowTerminal] = useState(false);
  const [hookText, setHookText] = useState('');
  const [pulseTrigger, setPulseTrigger] = useState(0);
  const [isConnected, setIsConnected] = useState(false);

  const zgRef = useRef<ZegoExpressEngine | null>(null);
  const currentControlToken = useRef('');
  const roomId = useRef('');
  const publishedStreamId = useRef('');
  const localStreamRef = useRef<any>(null);

  const log = (msg: string) => console.log(`[useAgent] ${msg}`);

  const triggerPulse = useCallback(() => {
    setPulseTrigger(prev => prev + 1);
  }, []);

  const startCall = async () => {
    if (isConnected) return;
    
    try {
      setHookText('REQUESTING ACCESS...');
      const res = await fetch(`${GATEWAY_URL}/voice/start-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: MOCK_USER_ID })
      });

      if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
      const data = await res.json();
      currentControlToken.current = data.controlToken;
      roomId.current = data.roomId;

      if (!zgRef.current) {
        zgRef.current = new ZegoExpressEngine(0, 'wss://webliveroom-test.zego.im/ws');
        
        // Listen for experimental API (Subtitles)
        zgRef.current.on('recvExperimentalAPI', (result: any) => {
          const { method, content } = result;
          if (method === "onRecvRoomChannelMessage") {
            try {
              const recvMsg = JSON.parse(content.msgContent);
              const { Cmd, Data } = recvMsg;
              
              if (Cmd === 3) { // ASR (User)
                setState('listening');
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last && last.role === 'user' && !last.isInterrupted) {
                    const updated = [...prev];
                    updated[updated.length - 1] = { ...last, text: Data.Text, isTyping: !Data.EndFlag };
                    return updated;
                  }
                  return [...prev, { id: Date.now().toString(), role: 'user', text: Data.Text, isTyping: !Data.EndFlag }];
                });
                if (Data.EndFlag) {
                   setTimeout(() => setState('idle'), 1000);
                }
              } else if (Cmd === 4) { // LLM (Agent)
                setState('speaking');
                triggerPulse();
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last && last.role === 'agent') {
                    const updated = [...prev];
                    updated[updated.length - 1] = { ...last, text: Data.Text, isTyping: !Data.EndFlag };
                    return updated;
                  }
                  return [...prev, { id: Date.now().toString(), role: 'agent', text: Data.Text, isTyping: !Data.EndFlag }];
                });
                if (Data.EndFlag) {
                   setTimeout(() => setState('idle'), 1000);
                }
              }
            } catch (error) {
              log("Failed to parse experimental API message");
            }
          }
        });

        zgRef.current.on('roomStreamUpdate', async (_: string, updateType: string, streamList: any[]) => {
          if (updateType === 'ADD') {
            for (const stream of streamList) {
              if (stream.streamID === data.agentStreamId) {
                const remoteStream = await zgRef.current!.startPlayingStream(stream.streamID);
                const audio = document.getElementById('remote-audio') as HTMLAudioElement;
                if (audio) audio.srcObject = remoteStream;
              }
            }
          }
        });
      }

      await zgRef.current.loginRoom(data.roomId, data.token, { userID: MOCK_USER_ID, userName: 'Web_Test' });
      
      const localStream = await zgRef.current.createStream({ camera: { audio: true, video: false } });
      localStreamRef.current = localStream;
      publishedStreamId.current = data.userStreamId || ('user_stream_' + Date.now());
      zgRef.current.startPublishingStream(publishedStreamId.current, localStream);

      // Enable experimental API
      zgRef.current.callExperimentalAPI({ method: "onRecvRoomChannelMessage", params: {} });

      setIsConnected(true);
      setHookText('COLD START < 800MS');
      
      // Start Mock Webhook sequence
      startMockSequence();

    } catch (e: any) {
      log('Connection failed: ' + e.message);
      setHookText('CONNECTION FAILED');
    }
  };

  const endCall = async () => {
    if (!isConnected) return;
    
    try {
      await fetch(`${GATEWAY_URL}/voice/end-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: MOCK_USER_ID, controlToken: currentControlToken.current })
      });
    } catch (e) {}

    if (zgRef.current) {
      if (publishedStreamId.current) {
        zgRef.current.stopPublishingStream(publishedStreamId.current);
      }
      if (localStreamRef.current) {
        zgRef.current.destroyStream(localStreamRef.current);
        localStreamRef.current = null;
      }
      zgRef.current.logoutRoom(roomId.current);
    }

    setIsConnected(false);
    setState('idle');
    setShowTerminal(true);
  };

  const startMockSequence = () => {
    // Simulate some webhook activity after 5 seconds
    setTimeout(() => {
      setWidget({
        show: true,
        title: 'MEMORY SYNC',
        task: 'Query: "小王", "邮件"',
        status: 'RUNNING',
        progress: 10,
        log: 'Searching database...'
      });

      let p = 10;
      const interval = setInterval(() => {
        p += 20;
        if (p >= 100) {
          clearInterval(interval);
          setWidget(prev => ({ ...prev, progress: 100, status: 'DONE', log: 'MATCH FOUND in memory.db' }));
          setTimeout(() => setWidget(prev => ({ ...prev, show: false })), 3000);
        } else {
          setWidget(prev => ({ ...prev, progress: p }));
        }
      }, 800);
    }, 5000);
  };

  return {
    state,
    messages,
    widget,
    showTerminal,
    hookText,
    pulseTrigger,
    isConnected,
    startCall,
    endCall
  };
}
