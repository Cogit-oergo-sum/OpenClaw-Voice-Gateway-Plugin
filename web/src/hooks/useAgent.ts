import { useState, useRef, useCallback, useEffect } from 'react';
import { ZegoExpressEngine } from 'zego-express-engine-webrtc';
import type { AgentState } from '../components/FluidVoiceCore';
import type { Message } from '../components/SubtitleStream';
import type { WidgetData } from '../components/GlassWidget';

const GATEWAY_URL = 'http://localhost:18790';
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
  const targetAgentStreamId = useRef<string>('');
  const [isConnecting, setIsConnecting] = useState(false);

  const log = (msg: string) => console.log(`[useAgent] ${msg}`);

  const triggerPulse = useCallback(() => {
    setPulseTrigger(prev => prev + 1);
  }, []);

  const startCall = async () => {
    if (isConnected || isConnecting) return;
    setIsConnecting(true);

    try {
      setHookText('REQUESTING ACCESS...');
      const res = await fetch(`${GATEWAY_URL}/voice/start-call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'test-token-12345'
        },
        body: JSON.stringify({ userId: MOCK_USER_ID })
      });

      if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
      const data = await res.json();
      currentControlToken.current = data.controlToken;
      roomId.current = data.roomId;
      targetAgentStreamId.current = data.agentStreamId; // Store latest target

      if (!zgRef.current) {
        zgRef.current = new ZegoExpressEngine(1623602215, 'wss://webliveroom1623602215-api.zego.im/ws');

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

        zgRef.current.on('roomStreamUpdate', async (roomID: string, updateType: string, streamList: any[]) => {
          log(`roomStreamUpdate: ${updateType}, room: ${roomID}, streams: ${JSON.stringify(streamList)}`);
          if (updateType === 'ADD') {
            for (const stream of streamList) {
              log(`Checking stream: ${stream.streamID}, target: ${targetAgentStreamId.current}`);
              if (stream.streamID === targetAgentStreamId.current) {
                log('Found AI stream, starting playback...');
                const remoteStream = await zgRef.current!.startPlayingStream(stream.streamID);
                const audio = document.getElementById('remote-audio') as HTMLAudioElement;
                if (audio) {
                  audio.srcObject = remoteStream;
                  audio.play().catch(e => log('Audio play failed: ' + e.message));
                } else {
                  log('Error: remote-audio element not found');
                }
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
    } finally {
      setIsConnecting(false);
    }
  };

  const endCall = async () => {
    if (!isConnected) return;

    try {
      await fetch(`${GATEWAY_URL}/voice/end-call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'test-token-12345'
        },
        body: JSON.stringify({ userId: MOCK_USER_ID, controlToken: currentControlToken.current })
      });
    } catch (e) { }

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

  const sendTestTTS = async () => {
    if (!isConnected) return;
    log('Sending manual test TTS...');
    try {
      const res = await fetch(`${GATEWAY_URL}/voice/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'test-token-12345'
          },
          body: JSON.stringify({
              messages: [{ role: 'user', content: 'TEST_TTS_INTERNAL_TRIGGER' }],
              agent_info: { agent_instance_id: 'CURRENT_SESSION' } // We will handle this mock logic in backend or just use raw API
          })
      });
      if (!res.ok) log('Test TTS failed: ' + res.status);
    } catch (e: any) {
        log('Test TTS Error: ' + e.message);
    }
  };

  const textChatSessionId = useRef<string>(`text-chat-${Date.now()}`);

  // Proactive Notifications (SSE)
  useEffect(() => {
    const sessionId = textChatSessionId.current;
    log(`Connecting to event stream for session: ${sessionId}`);
    
    const eventSource = new EventSource(`${GATEWAY_URL}/voice/events?sessionId=${sessionId}`);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (['notification', 'internal', 'idle'].includes(data.type) && data.content) {
          log(`Received notification: ${data.content}`);
          setMessages(prev => [
            ...prev, 
            { 
              id: 'notify-' + Date.now(), 
              role: 'agent', 
              text: data.content, 
              fragments: [{ text: data.content, type: data.type }],
              isTyping: false,
              trace: data.trace
            }
          ]);
          triggerPulse();
        }
      } catch (e) {
        // Heartbeat or system messages skip
      }
    };

    eventSource.onerror = (err) => {
      console.error('EventSource failed:', err);
      // Optional: retry logic
    };

    return () => {
      eventSource.close();
    };
  }, [triggerPulse]);

  const sendTextMessage = async (text: string) => {
    log(`Sending text message: ${text} (Version: v3, Session: ${textChatSessionId.current})`);
    
    // Add user message to UI
    const userMsgId = Date.now().toString();
    setMessages(prev => [...prev, { id: userMsgId, role: 'user', text, isTyping: false }]);

    try {
      const res = await fetch(`${GATEWAY_URL}/voice/text-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'test-token-12345'
        },
        body: JSON.stringify({ 
          message: text, 
          version: 'v3',
          sessionId: textChatSessionId.current
        })
      });

      if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let agentMsgId = (Date.now() + 1).toString();
      let fullText = "";

      if (reader) {
        setMessages(prev => [...prev, { id: agentMsgId, role: 'agent', text: '', fragments: [], isTyping: true }]);
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.replace('data: ', '').trim();
              if (dataStr === '[DONE]') continue;
              
              try {
                const data = JSON.parse(dataStr);
                if (['text', 'filler', 'chat', 'internal', 'idle', 'waiting'].includes(data.type)) {
                  if (data.content) {
                    fullText += data.content;
                  }
                  setMessages(prev => {
                    const updated = [...prev];
                    const idx = updated.findIndex(m => m.id === agentMsgId);
                    if (idx !== -1) {
                      const newFragments = [...(updated[idx].fragments || [])];
                      if (data.content) {
                        newFragments.push({ text: data.content, type: data.type });
                      }

                      updated[idx] = { 
                        ...updated[idx], 
                        text: fullText, 
                        fragments: newFragments,
                        isTyping: !data.isFinal,
                        trace: data.trace || updated[idx].trace 
                      };
                    }
                    return updated;
                  });
                  if (data.type === 'text') triggerPulse();
                }
              } catch (e) {}
            }
          }
        }
      }
    } catch (e: any) {
      log('Text chat failed: ' + e.message);
    }
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
    endCall,
    sendTestTTS,
    sendTextMessage
  };
}
