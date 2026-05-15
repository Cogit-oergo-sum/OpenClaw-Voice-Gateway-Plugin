import { useState, useRef, useCallback, useEffect } from 'react';
import { ZegoExpressEngine } from 'zego-express-engine-webrtc';
import type { AgentState } from '../components/FluidVoiceCore';
import type { Message } from '../components/SubtitleStream';
import type { WidgetData } from '../components/GlassWidget';

// 支持环境变量配置，本地开发默认 localhost，生产环境使用配置的地址
const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || '';
const MOCK_USER_ID = 'user_' + Math.floor(Math.random() * 10000);

// [V4.3] ACTION 信令提取：从 AI 响应文本中提取 [ACTION:XXX] 并剥离
const ACTION_RE = /\[ACTION:([A-Z_]+)\]/g;
function extractActions(text: string): { cleanText: string; actions: string[] } {
  const actions: string[] = [];
  const cleanText = text.replace(ACTION_RE, (_, action) => { actions.push(action); return ''; }).trim();
  return { cleanText, actions };
}

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
  const [isMuted, setIsMuted] = useState(false);
  const [currentMode, setCurrentMode] = useState<string>(''); // [V4.1] 当前对话模式
  const [currentModeDesc, setCurrentModeDesc] = useState<string>(''); // [V4.1] 当前对话模式描述
  const [agentInstanceId, setAgentInstanceId] = useState<string>(''); // 当前通话的 agentInstanceId
  const [pendingAction, setPendingAction] = useState<string>(''); // [V4.3] 提取的 ACTION 信令

  // [V3.7.5] ZEGO 官方消息缓存方案 - 参考 useChat.ts
  const agentMsgMapRef = useRef<Record<number, { seqId: number; messageId: string; content: string }[]>>({});
  const userMsgMapRef = useRef<Record<number, { seqId: number; content: string }[]>>({});
  // [V3.7.3] 缓存提前到达的 perf_report（SSE 可能比 ZEGO Cmd=4 先到达）
  const pendingPerfRef = useRef<{ trace: string[]; perf: any } | null>(null);

  const log = (msg: string) => console.log(`[useAgent] ${msg}`);

  // [V4.3] 清除当前 action
  const clearAction = useCallback(() => {
    setPendingAction('');
    setWidget(prev => ({ ...prev, show: false }));
  }, []);

  // [V4.3] pendingAction 驱动 GlassWidget 显示
  useEffect(() => {
    if (!pendingAction) return;
    setWidget({
      show: true,
      title: 'ACTION',
      task: pendingAction,
      status: 'DONE',
      progress: 100,
    });
  }, [pendingAction]);

  // [V3.7.5] ZEGO 官方 handleUserMessage 实现 - Cmd=3 ASR
  const handleUserMessage = useCallback((seqId: number, round: number, data: { MessageId: string; Text: string; EndFlag: boolean }) => {
    const content = data.Text?.trim() || '';
    if (!content) return;

    log(`handleUserMessage: seqId=${seqId}, round=${round}, text="${content.substring(0,20)}..."`);

    // 缓存消息片段
    if (!userMsgMapRef.current[round]) {
      userMsgMapRef.current[round] = [];
    }
    userMsgMapRef.current[round].push({ seqId, content });

    setMessages(prev => {
      const index = prev.findIndex(m => m.role === 'user' && m.roundId === round);

      if (index !== -1) {
        // 消息已存在，取 seqId 最大的内容（处理乱序）
        const maxMsg = userMsgMapRef.current[round].reduce((max, cur) =>
          cur.seqId > max.seqId ? cur : max
        );
        const updated = [...prev];
        updated[index] = { ...updated[index], text: maxMsg.content, isTyping: !data.EndFlag };
        return updated;
      }

      // 新消息
      return [...prev, {
        id: `user-${round}`,
        role: 'user',
        text: content,
        isTyping: !data.EndFlag,
        roundId: round
      }];
    });
  }, []);

  // [V3.7.5] ZEGO 官方 handleAgentMessage 实现 - Cmd=4 LLM
  const handleAgentMessage = useCallback((seqId: number, round: number, data: { MessageId: string; Text: string; EndFlag: boolean }) => {
    const content = data.Text?.trim() || '';
    const messageId = data.MessageId;
    if (!content) return;

    log(`handleAgentMessage: seqId=${seqId}, round=${round}, messageId=${messageId}, text="${content.substring(0,20)}..."`);

    // 缓存消息片段
    if (!agentMsgMapRef.current[round]) {
      agentMsgMapRef.current[round] = [];
    }
    agentMsgMapRef.current[round].push({ seqId, messageId, content });

    setMessages(prev => {
      const index = prev.findIndex(m => m.role === 'agent' && m.roundId === round);

      if (index !== -1) {
        // 消息已存在，按 messageId 过滤，按 seqId 排序后拼接
        const filtered = agentMsgMapRef.current[round].filter(m => m.messageId === messageId);
        const sorted = [...filtered].sort((a, b) => a.seqId - b.seqId);
        const mergedContent = sorted.map(m => m.content).join('');

        const updated = [...prev];
        // [V4.3] 提取并剥离 ACTION 信令
        const { cleanText, actions } = extractActions(mergedContent);
        if (actions.length > 0) {
          log(`ACTION signals detected: ${actions.join(', ')}`);
          setPendingAction(actions[actions.length - 1]); // 取最后一个 action
        }
        updated[index] = { ...updated[index], text: cleanText, isTyping: !data.EndFlag };
        // [V3.7.3] 合并提前到达的 perf_report
        if (data.EndFlag && pendingPerfRef.current) {
          updated[index] = { ...updated[index], trace: pendingPerfRef.current.trace, perf: pendingPerfRef.current.perf };
          pendingPerfRef.current = null;
        }
        return updated;
      }

      // 新消息
      return [...prev, {
        id: `agent-${round}`,
        role: 'agent',
        text: content,
        isTyping: !data.EndFlag,
        roundId: round,
        ...(data.EndFlag && pendingPerfRef.current ? { trace: pendingPerfRef.current.trace, perf: pendingPerfRef.current.perf } : {}),
      }];
    });
    if (data.EndFlag && pendingPerfRef.current) pendingPerfRef.current = null;
  }, []);

  const triggerPulse = useCallback(() => {
    setPulseTrigger(prev => prev + 1);
  }, []);

  // [V4.1] 初始化时从后端获取 mode 信息
  useEffect(() => {
    fetch(`${GATEWAY_URL}/voice/mode-info`)
      .then(res => res.json())
      .then(data => {
        if (data.initialMode) {
          setCurrentMode(data.initialMode);
        }
        if (data.modes) {
          const initial = data.modes.find((m: any) => m.name === data.initialMode);
          if (initial?.description) {
            setCurrentModeDesc(initial.description);
          }
        }
      })
      .catch(() => {}); // 静默失败，不影响主流程
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

      // [V3.7.4] 同步 SSE sessionId 为语音通话的 agentInstanceId，以接收 perf_report
      if (data.agentInstanceId) {
        log(`Syncing SSE sessionId to voice session: ${data.agentInstanceId}`);
        setCurrentSessionId(data.agentInstanceId);
        setAgentInstanceId(data.agentInstanceId);
      }

      if (!zgRef.current) {
        log('Initializing ZEGO Express Engine...');
        zgRef.current = new ZegoExpressEngine(1623602215, 'wss://webliveroom1623602215-api.zego.im/ws');
        
        // Ensure we don't have multiple listeners if this code path runs again (safety)
        zgRef.current.off('recvExperimentalAPI');
        zgRef.current.off('roomStreamUpdate');

        // Listen for experimental API (Subtitles)
        zgRef.current.on('recvExperimentalAPI', (result: any) => {
          const { method, content } = result;
          if (method === "onRecvRoomChannelMessage") {
            try {
              const recvMsg = JSON.parse(content.msgContent);
              // [V3.7.5] 参考 ZEGO 官方 useChat.ts 实现方案
              // 消息结构: { Timestamp, SeqId, Round, Cmd, Data: { MessageId, Text, EndFlag, SpeakStatus } }
              const { Cmd, SeqId, Round, Data } = recvMsg;
              log(`RoomChannelMessage: Cmd=${Cmd}, SeqId=${SeqId}, Round=${Round}, Text=${Data.Text?.substring(0,20)}...`);

              if (Cmd === 3) { // ASR (User) - 参考 handleUserMessage
                setState('listening');
                handleUserMessage(SeqId, Round, Data);
                if (Data.EndFlag) {
                  setTimeout(() => setState('idle'), 1000);
                }
              } else if (Cmd === 4) { // LLM (Agent) - 参考 handleAgentMessage
                setState('speaking');
                triggerPulse();
                handleAgentMessage(SeqId, Round, Data);
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
                log(`Found AI stream (${stream.streamID}), starting playback...`);
                try {
                  const remoteStream = await zgRef.current!.startPlayingStream(stream.streamID);
                  const audio = document.getElementById('remote-audio') as HTMLAudioElement;
                  if (audio) {
                    audio.srcObject = remoteStream;
                    audio.play().catch(e => log('Audio play failed: ' + e.message));
                  } else {
                    log('Error: remote-audio element not found');
                  }
                } catch (playErr: any) {
                  log('startPlayingStream failed: ' + playErr.message);
                }
              }
            }
          }
        });
      }

      log(`Logging into room: ${data.roomId} as ${MOCK_USER_ID}...`);
      await zgRef.current.loginRoom(data.roomId, data.token, { userID: MOCK_USER_ID, userName: 'Web_Test' });
      log('Login successful.');

      const localStream = await zgRef.current.createStream({ camera: { audio: true, video: false } });
      localStreamRef.current = localStream;
      publishedStreamId.current = data.userStreamId || ('user_stream_' + Date.now());
      
      log(`Starting to publish stream: ${publishedStreamId.current}...`);
      zgRef.current.startPublishingStream(publishedStreamId.current, localStream);
      log('Publication request sent.');

      // Enable experimental API
      zgRef.current.callExperimentalAPI({ method: "onRecvRoomChannelMessage", params: {} });

      setIsConnected(true);
      setIsMuted(false); // Reset mute state on new call
      setHookText('RTC SESSION ESTABLISHED');

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
    setAgentInstanceId('');
  };

  const toggleMute = useCallback(async () => {
    if (!zgRef.current || !publishedStreamId.current) {
      log('Mute failed: ZEGO engine or stream not ready');
      return;
    }
    const nextMuted = !isMuted;
    try {
      log(`Attempting to ${nextMuted ? 'Mute' : 'Unmute'} stream: ${publishedStreamId.current}`);
      
      // 1. Client-side track control (instant, reliable)
      if (localStreamRef.current) {
        const audioTracks = localStreamRef.current.getAudioTracks();
        if (audioTracks && audioTracks.length > 0) {
          audioTracks.forEach((track: MediaStreamTrack) => {
            track.enabled = !nextMuted;
            log(`Track ${track.id} set to enabled = ${!nextMuted}`);
          });
        } else {
          log('No audio tracks found in local stream');
        }
      }

      // 2. ZEGO Engine control (notifies server)
      if (localStreamRef.current) {
        await zgRef.current.mutePublishStreamAudio(localStreamRef.current, nextMuted);
      }
      
      setIsMuted(nextMuted);
      log(`Microphone ${nextMuted ? 'Muted' : 'Unmuted'} successfully`);
    } catch (e: any) {
      log('Mute/Unmute failed: ' + e.message);
    }
  }, [isMuted, publishedStreamId]);

  const textChatSessionId = useRef<string>(`text-chat-${Date.now()}`);
  const [currentSessionId, setCurrentSessionId] = useState<string>(textChatSessionId.current); // [V3.7.4] 动态 sessionId，支持语音通话同步

  // Proactive Notifications (SSE)
  useEffect(() => {
    const sessionId = currentSessionId;
    log(`Connecting to event stream for session: ${sessionId}`);

    const eventSource = new EventSource(`${GATEWAY_URL}/voice/events?sessionId=${sessionId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // [V3.7.3] 处理 perf_report：语音对话的 trace/perf 通知
        if (data.type === 'perf_report' && data.trace && data.perf) {
          log(`Received perf_report: TTFT=${data.perf.ttft}ms, trace=${data.trace.join(' → ')}`);
          setMessages(prev => {
            // 找到最近的一条 agent 消息并合并 trace/perf
            const lastAgentIdx = prev.findLastIndex(m => m.role === 'agent');
            if (lastAgentIdx !== -1) {
              const updated = [...prev];
              updated[lastAgentIdx] = {
                ...updated[lastAgentIdx],
                trace: data.trace,
                perf: data.perf,
                isTyping: false
              };
              return updated;
            }
            // 还没有 agent 消息，缓存到 ref，等 Cmd=4 到达时合并
            pendingPerfRef.current = { trace: data.trace, perf: data.perf };
            return prev;
          });
          return;
        }

        // [V4.2] 处理 mode_update 事件（优先更新 mode）
        if (data.type === 'mode_update' && data.mode) {
          log(`Mode update: ${data.mode}, desc: ${data.modeDescription}`);
          setCurrentMode(data.mode);
          if (data.modeDescription) setCurrentModeDesc(data.modeDescription);
          return; // mode_update 不需要显示消息，只需更新状态
        }
        if (['notification', 'internal', 'idle'].includes(data.type) && data.content) {
          log(`Received notification: ${data.content}`);
          // [V4.3] notification 也提取 ACTION 信令
          const { cleanText: notifyClean, actions: notifyActions } = extractActions(data.content);
          if (notifyActions.length > 0) {
            log(`ACTION signals detected (notification): ${notifyActions.join(', ')}`);
            setPendingAction(notifyActions[notifyActions.length - 1]);
          }
          if (notifyClean) {
              setMessages(prev => [
                ...prev,
                {
                  id: 'notify-' + Date.now(),
                  role: 'agent',
                  text: notifyClean,
                  fragments: [{ text: notifyClean, type: data.type }],
                  isTyping: false,
                  trace: data.trace,
                  perf: data.perf
                }
              ]);
          }
          triggerPulse();
        }
      } catch (e) {
        // Heartbeat or system messages skip
      }
    };

    eventSource.onerror = () => {
      if (eventSource.readyState === EventSource.CLOSED) {
        console.warn('[SSE] Connection permanently closed by server.');
      } else if (eventSource.readyState === EventSource.CONNECTING) {
        console.warn('[SSE] Connection lost, browser will auto-retry...');
      } else {
        console.error('[SSE] Connection error, readyState:', eventSource.readyState);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [currentSessionId, triggerPulse]); // [V3.7.4] 依赖 currentSessionId，语音通话时自动重连

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
                // [V4.2] 处理 mode_update 事件（优先更新 mode）
                if (data.type === 'mode_update' && data.mode) {
                  setCurrentMode(data.mode);
                  if (data.modeDescription) setCurrentModeDesc(data.modeDescription);
                  continue; // mode_update 不需要显示消息，只需更新状态
                }
                if (['text', 'filler', 'chat', 'internal', 'idle', 'waiting'].includes(data.type)) {
                  if (data.content) {
                    fullText += data.content;
                    // [V4.3] 从 SSE chunk 提取 ACTION 信令
                    const { actions: chunkActions } = extractActions(data.content);
                    if (chunkActions.length > 0) {
                      log(`ACTION signals detected (SSE): ${chunkActions.join(', ')}`);
                      setPendingAction(chunkActions[chunkActions.length - 1]);
                    }
                  }
                  // [V4.1] 更新当前 mode
                  if (data.mode) {
                    setCurrentMode(data.mode);
                  }
                  if (data.modeDescription) {
                    setCurrentModeDesc(data.modeDescription);
                  }
                  setMessages(prev => {
                    const updated = [...prev];
                    const idx = updated.findIndex(m => m.id === agentMsgId);
                    if (idx !== -1) {
                      const newFragments = [...(updated[idx].fragments || [])];
                      if (data.content) {
                        // [V4.3] fragment 也剥离信令
                        const { cleanText: fragClean } = extractActions(data.content);
                        newFragments.push({ text: fragClean, type: data.type });
                      }
                      // [V4.3] 显示文本剥离信令
                      const { cleanText: displayText } = extractActions(fullText);
                      updated[idx] = {
                        ...updated[idx],
                        text: displayText,
                        fragments: newFragments,
                        isTyping: !data.isFinal,
                        trace: data.trace || updated[idx].trace,
                        perf: data.perf || updated[idx].perf
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
    isMuted,
    currentMode, // [V4.1] 当前对话模式
    currentModeDesc, // [V4.1] 当前对话模式描述
    agentInstanceId,
    pendingAction, // [V4.3] 当前触发的 ACTION 信令
    startCall,
    endCall,
    toggleMute,
    sendTextMessage,
    clearAction, // [V4.3] 清除 ACTION 信令
  };
}
