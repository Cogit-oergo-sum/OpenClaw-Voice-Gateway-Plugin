// 极简测试逻辑: HTTP 控制信令 + ZEGO RTC 引擎
const GATEWAY_URL = 'http://localhost:18789';
const MOCK_USER_ID = 'user_' + Math.floor(Math.random() * 10000);

const btnStart = document.getElementById('btn-start');
const btnEnd = document.getElementById('btn-end');
const logBox = document.getElementById('log-console');
const tagState = document.getElementById('conn-state');
const remoteAudio = document.getElementById('remote-audio');

let zg = null;
let currentRoomId = '';
let currentStreamId = '';
let publishedStreamId = ''; // 本端往外推的本地流
let currentControlToken = ''; // 保存防盗刷凭证

function log(msg) {
    const time = new Date().toLocaleTimeString();
    logBox.innerHTML += `\n[${time}] ${msg}`;
    logBox.scrollTop = logBox.scrollHeight;
}

btnStart.addEventListener('click', async () => {
    btnStart.disabled = true;
    log('请求 /voice/start-call (UserId: ' + MOCK_USER_ID + ')...');

    try {
        // --- 1. 设备嗅探 ---
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasMic = devices.some(d => d.kind === 'audioinput');
        if (!hasMic) {
            throw new Error('未检测到麦克风设备，无法发起语音通话');
        }

        const res = await fetch(`${GATEWAY_URL}/voice/start-call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: MOCK_USER_ID })
        });

        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);

        const data = await res.json();
        log('收到网关鉴权: RoomId=' + data.roomId);
        currentControlToken = data.controlToken;

        // 初始化 ZEGO Web SDK
        if (!zg) {
            // 注意: 实际环境推荐使用正式的 AppID 这里使用占位符, 依赖 Gateway 真正生效的是 Token
            zg = new ZegoExpressEngine(0, 'wss://webliveroom-test.zego.im/ws');

            zg.on('roomStreamUpdate', async (roomID, updateType, streamList) => {
                log(`流状态变更: ${updateType}`);
                if (updateType === 'ADD') {
                    for (const stream of streamList) {
                        if (stream.streamID === data.agentStreamId) {
                            log('拉取播放大模型音频流: ' + stream.streamID);
                            const remoteStream = await zg.startPlayingStream(stream.streamID);
                            remoteAudio.srcObject = remoteStream;
                        }
                    }
                }
            });

            // --- 2. Token 过期无感刷新 ---
            zg.on('roomTokenWillExpire', async (roomID, token) => {
                log('房间 Token 即将过期，正在向网关请求续期...');
                try {
                    const tRes = await fetch(`${GATEWAY_URL}/voice/refresh-token`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId: MOCK_USER_ID, controlToken: currentControlToken })
                    });
                    const tData = await tRes.json();
                    if (tData.success) {
                        zg.renewToken(tData.token);
                        log('Token 续期成功！');
                    } else {
                        log('Token 续期失败: ' + tData.error);
                    }
                } catch (e) {
                    log('Token 续期请求异常: ' + e.message);
                }
            });
        }

        // 登录房间并推拉流
        log('开始登录 ZEGO 房间...');
        await zg.loginRoom(data.roomId, data.token, { userID: MOCK_USER_ID, userName: 'Web_Test' }, { userUpdate: true });

        log('创建本地麦克风音频流...');
        let localStream;
        try {
            localStream = await zg.createStream({ camera: false, microphone: true });
        } catch (e) {
            if (e.name === 'NotAllowedError' || e.message.includes('Permission denied')) {
                throw new Error('麦克风权限被拒绝，请在浏览器设置中允许后重试');
            }
            throw e;
        }
        publishedStreamId = data.userStreamId || ('user_stream_' + Date.now());

        log('往 ZEGO 云推送本地语音...');
        zg.startPublishingStream(publishedStreamId, localStream);

        currentRoomId = data.roomId;
        currentStreamId = publishedStreamId;

        tagState.className = 'tag active';
        tagState.innerText = 'ACTIVE';
        btnEnd.disabled = false;
        log('🎉 音频连麦成功，请开始说话！');

    } catch (e) {
        log('❌ 建联失败: ' + e.message);
        btnStart.disabled = false;
    }
});

// --- 5. 优雅挂断 ---
const doTeardown = async (isUnload = false) => {
    if (!currentRoomId) return;

    if (!isUnload) log('请求 /voice/end-call 销毁大模型实例...');
    try {
        if (isUnload && navigator.sendBeacon) {
            // 对于 unload，使用 keepalive 以防请求被浏览器截断
            fetch(`${GATEWAY_URL}/voice/end-call`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: MOCK_USER_ID, controlToken: currentControlToken }),
                keepalive: true
            });
        } else {
            const res = await fetch(`${GATEWAY_URL}/voice/end-call`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: MOCK_USER_ID, controlToken: currentControlToken })
            });
            const data = await res.json();
            log('挂断成功，大模型计费已停止。消耗统计: ' + JSON.stringify(data.stats || {}));
        }
    } catch (e) {
        if (!isUnload) log('❌ 挂断请求失败: ' + e.message);
    }

    // 清理本地 ZEGO 资源
    if (zg) {
        if (publishedStreamId) {
            zg.stopPublishingStream(publishedStreamId);
            zg.destroyStream(publishedStreamId);
        }
        if (currentRoomId) zg.logoutRoom(currentRoomId);
        if (!isUnload) log('ZEGO 房间已登出，麦克风已释放。');
    }

    tagState.className = 'tag idle';
    tagState.innerText = 'IDLE';
    btnStart.disabled = false;
    publishedStreamId = '';
    currentRoomId = '';
    currentControlToken = '';
};

btnEnd.addEventListener('click', async () => {
    btnEnd.disabled = true;
    await doTeardown(false);
});

// 响应离开或页面刷新
window.addEventListener('beforeunload', () => {
    doTeardown(true);
});
