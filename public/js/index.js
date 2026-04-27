const socket = io();

const AI_USER_ID = 'ai-assistant';
const AI_AVATAR = 'img/g.webp';
const VOICE_SETTINGS_KEY = 'chat-ai-voice-settings-v2';

const state = {
  currentUser: null,
  currentPrivateTarget: null,
  membersMap: new Map(),
  voiceConfig: null,
  voiceSettings: null,
  aiRequestInFlight: false,
  isRecording: false,
  mediaRecorder: null,
  mediaStream: null,
  audioChunks: [],
  audioContext: null,
  analyser: null,
  waveAnimationFrame: null,
  silenceStartedAt: null,
  speechDetected: false,
  recognition: null,
  recognitionTranscript: '',
  shouldSendRecognition: true,
  browserRecognitionMode: false,
  currentAudio: null,
  currentUtterance: null,
  activeTypewriterToken: null
};

const dom = {
  chatRoomContainer: document.getElementById('chatRoomContainer'),
  loginOverlay: document.getElementById('loginOverlay'),
  membersList: document.getElementById('membersList'),
  memberCount: document.getElementById('memberCount'),
  chatModeLabel: document.getElementById('chatModeLabel'),
  chatTargetLabel: document.getElementById('chatTargetLabel'),
  privateNoticeBar: document.getElementById('privateNoticeBar'),
  privateWithName: document.getElementById('privateWithName'),
  closePrivateBtn: document.getElementById('closePrivateBtn'),
  messagesArea: document.getElementById('messagesArea'),
  messageInput: document.getElementById('messageInput'),
  sendBtn: document.getElementById('sendBtn'),
  voiceRecordBtn: document.getElementById('voiceRecordBtn'),
  aiStatusText: document.getElementById('aiStatusText'),
  voiceHintText: document.getElementById('voiceHintText'),
  readAloudToggle: document.getElementById('readAloudToggle'),
  phoneModeToggle: document.getElementById('phoneModeToggle'),
  clearAiHistoryBtn: document.getElementById('clearAiHistoryBtn'),
  settingsToggleBtn: document.getElementById('settingsToggleBtn'),
  settingsPanel: document.getElementById('settingsPanel'),
  asrEngineSelect: document.getElementById('asrEngineSelect'),
  ttsEngineSelect: document.getElementById('ttsEngineSelect'),
  llmBackendSelect: document.getElementById('llmBackendSelect'),
  llmModelInput: document.getElementById('llmModelInput'),
  speechRateInput: document.getElementById('speechRateInput'),
  speechPitchInput: document.getElementById('speechPitchInput'),
  voiceBackendHint: document.getElementById('voiceBackendHint'),
  waveBars: Array.from(document.querySelectorAll('#waveBars span')),
  ttsAudioPlayer: document.getElementById('ttsAudioPlayer'),
  joinBtn: document.getElementById('joinBtn'),
  nicknameInput: document.getElementById('nicknameInput'),
  avatarOptions: document.getElementById('avatarOptions')
};

const defaultAvatars = [
  'img/a.webp',
  'img/b.jpg',
  'img/c.jpg',
  'img/d.jpg',
  'img/e.png',
  'img/f.jpg',
  'img/g.webp'
];

function defaultVoiceSettings() {
  return {
    autoRead: true,
    phoneMode: false,
    asrEngine: 'sensevoice',
    ttsEngine: 'cosyvoice',
    llmBackend: 'deepseek-api',
    llmModel: '',
    speechRate: 1,
    speechPitch: 1
  };
}

function getAiSessionId() {
  return state.currentUser ? `ai-session-${state.currentUser.id}` : 'ai-session-guest';
}

function isAiChat() {
  return state.currentPrivateTarget?.id === AI_USER_ID;
}

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function updateAiStatus(text) {
  if (text) {
    dom.aiStatusText.innerText = text;
    return;
  }

  if (state.isRecording) {
    dom.aiStatusText.innerText = state.browserRecognitionMode
      ? '正在聆听并实时识别语音...'
      : '正在录音中，说完后会自动识别并发送给 AI。';
    return;
  }

  if (state.aiRequestInFlight) {
    dom.aiStatusText.innerText = 'AI 正在思考中，请稍候...';
    return;
  }

  if (isAiChat()) {
    dom.aiStatusText.innerText = state.voiceSettings.autoRead
      ? 'AI 对话已就绪，支持文字输入、语音输入和自动朗读。'
      : 'AI 对话已就绪，目前为静音模式，仅显示文字回复。';
    return;
  }

  dom.aiStatusText.innerText = '点击左侧 AI Assistant，开始文本或语音混合对话。';
}

function updateVoiceHint() {
  dom.voiceHintText.innerText = state.voiceSettings.phoneMode
    ? '电话模式已开启，按住麦克风说话，松开后自动发送；朗读时可再次按住打断。'
    : '点击麦克风开始录音，再次点击或静音后自动结束。文本和语音可以混用。';
}

function updateComposerState() {
  dom.sendBtn.disabled = !state.currentUser || state.aiRequestInFlight || state.isRecording;
  dom.messageInput.disabled = !state.currentUser || state.isRecording;
  dom.voiceRecordBtn.disabled = !state.currentUser;
}

function applyVoiceSettingsToUI() {
  const settings = state.voiceSettings;

  dom.readAloudToggle.classList.toggle('is-off', !settings.autoRead);
  dom.readAloudToggle.classList.toggle('is-active', settings.autoRead);
  dom.readAloudToggle.innerText = settings.autoRead ? '🔊 朗读回复' : '🔇 静音模式';
  dom.readAloudToggle.setAttribute('aria-pressed', String(settings.autoRead));

  dom.phoneModeToggle.classList.toggle('is-active', settings.phoneMode);
  dom.phoneModeToggle.innerText = settings.phoneMode ? '📞 电话模式开' : '📞 电话模式关';
  dom.phoneModeToggle.setAttribute('aria-pressed', String(settings.phoneMode));

  dom.asrEngineSelect.value = settings.asrEngine;
  dom.ttsEngineSelect.value = settings.ttsEngine;
  dom.llmBackendSelect.value = settings.llmBackend;
  dom.llmModelInput.value = settings.llmModel || '';
  dom.speechRateInput.value = String(settings.speechRate);
  dom.speechPitchInput.value = String(settings.speechPitch);

  dom.voiceRecordBtn.classList.toggle('phone-mode', settings.phoneMode);
  dom.voiceRecordBtn.innerText = settings.phoneMode ? '按住说话' : '🎙️';
  updateVoiceHint();
  updateAiStatus();
  updateComposerState();
}

function persistVoiceSettings() {
  localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(state.voiceSettings));
}

function loadVoiceSettings() {
  const savedSettings = JSON.parse(localStorage.getItem(VOICE_SETTINGS_KEY) || 'null');
  const merged = {
    ...defaultVoiceSettings(),
    ...(state.voiceConfig?.defaultSettings || {}),
    ...(savedSettings || {})
  };

  state.voiceSettings = merged;
  applyVoiceSettingsToUI();
}

function syncSettingsFromUI() {
  state.voiceSettings = {
    ...state.voiceSettings,
    asrEngine: dom.asrEngineSelect.value,
    ttsEngine: dom.ttsEngineSelect.value,
    llmBackend: dom.llmBackendSelect.value,
    llmModel: dom.llmModelInput.value.trim(),
    speechRate: Number(dom.speechRateInput.value),
    speechPitch: Number(dom.speechPitchInput.value)
  };

  persistVoiceSettings();
  updateVoiceHint();
}

function setWaveLevel(level) {
  dom.waveBars.forEach((bar, index) => {
    const factor = 0.25 + ((index % 4) * 0.1);
    const height = 8 + Math.max(0, Math.min(1, level)) * 22 * factor * 2.4;
    bar.style.height = `${height}px`;
    bar.style.opacity = String(0.25 + Math.min(0.85, level + 0.2));
  });
}

function resetWaveBars() {
  dom.waveBars.forEach((bar, index) => {
    const height = 8 + (index % 3) * 2;
    bar.style.height = `${height}px`;
    bar.style.opacity = '0.35';
  });
}

function appendMessage(message) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message-item';

  if (message.type === 'system') {
    wrapper.classList.add('system-message');
    const bubble = document.createElement('div');
    bubble.className = 'system-bubble';
    bubble.innerText = message.content;
    wrapper.appendChild(bubble);
    dom.messagesArea.appendChild(wrapper);
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'end' });
    return { wrapper, bubble };
  }

  const isCurrentUser = message.senderNickname === state.currentUser?.nickname;
  wrapper.classList.add(isCurrentUser ? 'message-item-right' : 'message-item-left');

  const avatar = document.createElement('img');
  avatar.className = 'message-avatar';
  avatar.src = message.senderAvatar || defaultAvatars[0];
  avatar.alt = message.senderNickname;
  avatar.onerror = () => {
    avatar.src = defaultAvatars[0];
  };

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  const nameLine = document.createElement('div');
  nameLine.className = 'message-name';
  nameLine.append(document.createTextNode(message.senderNickname));

  if (message.isPrivate) {
    const privateTag = document.createElement('span');
    privateTag.className = 'private-tag';
    privateTag.innerText = message.isAi ? 'AI 对话' : '私聊';
    nameLine.appendChild(privateTag);
  }

  if (message.source === 'voice') {
    const sourceTag = document.createElement('span');
    sourceTag.className = 'voice-source-tag';
    sourceTag.innerText = '🎙️ 语音输入';
    nameLine.appendChild(sourceTag);
  }

  if (message.isAiReply) {
    const replyTag = document.createElement('span');
    replyTag.className = 'voice-reply-tag';
    replyTag.innerText = '🔊 可朗读';
    nameLine.appendChild(replyTag);
  }

  const text = document.createElement('div');
  text.className = 'message-text';
  text.innerText = message.content || '';

  const actions = document.createElement('div');
  actions.className = 'message-actions';

  if (message.isAiReply) {
    const replayBtn = document.createElement('button');
    replayBtn.className = 'message-action-btn';
    replayBtn.type = 'button';
    replayBtn.innerText = '▶️ 重播';
    replayBtn.dataset.action = 'replay-tts';
    replayBtn.dataset.text = message.content || '';
    actions.appendChild(replayBtn);

    const stopBtn = document.createElement('button');
    stopBtn.className = 'message-action-btn';
    stopBtn.type = 'button';
    stopBtn.innerText = '⏹️ 停止朗读';
    stopBtn.dataset.action = 'stop-tts';
    actions.appendChild(stopBtn);
  }

  bubble.appendChild(nameLine);
  bubble.appendChild(text);
  if (actions.childNodes.length > 0) {
    bubble.appendChild(actions);
  }

  if (isCurrentUser) {
    wrapper.appendChild(bubble);
    wrapper.appendChild(avatar);
  } else {
    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
  }

  dom.messagesArea.appendChild(wrapper);
  wrapper.scrollIntoView({ behavior: 'smooth', block: 'end' });

  return { wrapper, bubble, text, actions };
}

function setPendingAiMessage(messageRefs, text) {
  messageRefs.text.innerText = text;
}

function buildReplayButtons(actions, content) {
  actions.innerHTML = '';

  const replayBtn = document.createElement('button');
  replayBtn.className = 'message-action-btn';
  replayBtn.type = 'button';
  replayBtn.innerText = '▶️ 重播';
  replayBtn.dataset.action = 'replay-tts';
  replayBtn.dataset.text = content;

  const stopBtn = document.createElement('button');
  stopBtn.className = 'message-action-btn';
  stopBtn.type = 'button';
  stopBtn.innerText = '⏹️ 停止朗读';
  stopBtn.dataset.action = 'stop-tts';

  actions.appendChild(replayBtn);
  actions.appendChild(stopBtn);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function animateAiReply(messageRefs, content) {
  const token = { cancelled: false };

  if (state.activeTypewriterToken) {
    state.activeTypewriterToken.cancelled = true;
  }

  state.activeTypewriterToken = token;

  if (!state.voiceSettings.phoneMode) {
    messageRefs.text.innerText = content;
    buildReplayButtons(messageRefs.actions, content);
    return;
  }

  messageRefs.text.innerText = '';

  for (const char of content) {
    if (token.cancelled) {
      messageRefs.text.innerText = content;
      break;
    }

    messageRefs.text.innerText += char;
    messageRefs.wrapper.scrollIntoView({ behavior: 'smooth', block: 'end' });
    await sleep(16);
  }

  buildReplayButtons(messageRefs.actions, content);
}

function stopSpeechPlayback() {
  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio.currentTime = 0;
    state.currentAudio = null;
  }

  if (state.currentUtterance && window.speechSynthesis) {
    window.speechSynthesis.cancel();
    state.currentUtterance = null;
  }

  dom.ttsAudioPlayer.pause();
  dom.ttsAudioPlayer.currentTime = 0;
  updateAiStatus();
}

function speakWithBrowser(text) {
  if (!('speechSynthesis' in window)) {
    appendMessage({ type: 'system', content: '当前浏览器不支持内置语音朗读。' });
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = state.voiceSettings.speechRate;
  utterance.pitch = state.voiceSettings.speechPitch;
  utterance.onend = () => {
    state.currentUtterance = null;
    updateAiStatus();
  };
  utterance.onerror = () => {
    state.currentUtterance = null;
    updateAiStatus('浏览器朗读失败，请尝试切换 TTS 引擎或检查权限。');
  };

  state.currentUtterance = utterance;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

async function playAudioBase64(audioBase64, mimeType) {
  const src = `data:${mimeType || 'audio/mpeg'};base64,${audioBase64}`;

  dom.ttsAudioPlayer.src = src;
  state.currentAudio = dom.ttsAudioPlayer;

  await dom.ttsAudioPlayer.play();

  dom.ttsAudioPlayer.onended = () => {
    state.currentAudio = null;
    updateAiStatus();
  };
}

async function playReplyAudio(text, { force = false } = {}) {
  if (!text?.trim()) {
    return;
  }

  if (!state.voiceSettings.autoRead && !force) {
    return;
  }

  stopSpeechPlayback();
  updateAiStatus(force ? '正在重播 AI 语音...' : 'AI 正在朗读回复...');

  try {
    const response = await fetch('/api/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        settings: state.voiceSettings
      })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || '朗读失败');
    }

    if (data.audio_base64) {
      await playAudioBase64(data.audio_base64, data.mime_type);
      return;
    }

    speakWithBrowser(text);
  } catch (error) {
    appendMessage({
      type: 'system',
      content: `语音朗读暂时不可用，已切换到浏览器朗读：${error.message}`
    });
    speakWithBrowser(text);
  }
}

function buildServerSettings() {
  return {
    ...state.voiceSettings,
    llmModel: state.voiceSettings.llmModel.trim()
  };
}

function ensureAiMode(actionLabel) {
  if (isAiChat()) {
    return true;
  }

  appendMessage({
    type: 'system',
    content: `${actionLabel}需要先切换到 AI Assistant 对话窗口。`
  });

  return false;
}

async function sendAiMessage(content, source = 'text') {
  const text = content.trim();

  if (!text || state.aiRequestInFlight) {
    return;
  }

  appendMessage({
    type: 'message',
    senderNickname: state.currentUser.nickname,
    senderAvatar: state.currentUser.avatarUrl,
    content: text,
    isPrivate: true,
    isAi: true,
    source
  });

  dom.messageInput.value = '';
  state.aiRequestInFlight = true;
  updateComposerState();
  updateAiStatus();

  const pendingMessage = appendMessage({
    type: 'message',
    senderNickname: 'AI Assistant',
    senderAvatar: AI_AVATAR,
    content: '正在思考...',
    isPrivate: true,
    isAi: true,
    isAiReply: true
  });

  try {
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: getAiSessionId(),
        nickname: state.currentUser.nickname,
        message: text,
        source,
        settings: buildServerSettings()
      })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'AI 服务异常');
    }

    const renderTask = animateAiReply(pendingMessage, data.reply);
    const speakTask = playReplyAudio(data.reply);

    await Promise.allSettled([renderTask, speakTask]);

    updateAiStatus(`AI 已通过 ${data.backend} / ${data.model} 回复完成。`);
  } catch (error) {
    setPendingAiMessage(pendingMessage, `AI 回复失败：${error.message}`);
    pendingMessage.actions.innerHTML = '';
    appendMessage({
      type: 'system',
      content: '本轮 AI 调用失败了。你可以检查语音后端、模型后端或网络配置后重试。'
    });
  } finally {
    state.aiRequestInFlight = false;
    updateComposerState();
    updateAiStatus();
  }
}

function sendMessage(text) {
  if (!state.currentUser || !text.trim()) {
    return;
  }

  if (isAiChat()) {
    sendAiMessage(text, 'text');
    return;
  }

  const content = text.trim();

  if (state.currentPrivateTarget) {
    socket.emit('privateMessage', {
      toId: state.currentPrivateTarget.id,
      toNickname: state.currentPrivateTarget.nickname,
      content
    });

    appendMessage({
      type: 'message',
      senderNickname: state.currentUser.nickname,
      senderAvatar: state.currentUser.avatarUrl,
      content,
      isPrivate: true,
      isAi: false
    });
  } else {
    socket.emit('publicMessage', { content });
  }

  dom.messageInput.value = '';
}

function startPrivateChat(targetMember) {
  state.currentPrivateTarget = targetMember;
  dom.privateNoticeBar.style.display = 'flex';
  dom.privateWithName.innerText = targetMember.nickname;

  if (targetMember.id === AI_USER_ID) {
    dom.chatModeLabel.innerText = 'AI 对话';
    dom.chatTargetLabel.innerText = '当前对象：AI Assistant';
    dom.messageInput.placeholder = '输入你的问题，或者点击麦克风开始说话...';
    appendMessage({
      type: 'system',
      content: '已切换到 AI 语音对话模式。你现在可以输入文字、点击麦克风说话，或开启电话模式按住说话。'
    });
  } else {
    dom.chatModeLabel.innerText = '私聊中';
    dom.chatTargetLabel.innerText = `当前对象：${targetMember.nickname}`;
    dom.messageInput.placeholder = `私信 ${targetMember.nickname}...`;
    appendMessage({
      type: 'system',
      content: `已切换为私聊模式，对象：${targetMember.nickname}`
    });
  }

  updateAiStatus();
}

function exitPrivateChat() {
  state.currentPrivateTarget = null;
  dom.chatModeLabel.innerText = '公开聊天';
  dom.chatTargetLabel.innerText = '';
  dom.privateNoticeBar.style.display = 'none';
  dom.messageInput.placeholder = '输入消息...';
  appendMessage({ type: 'system', content: '已切换回公开频道。' });
  updateAiStatus();
}

function renderMembersList() {
  const members = Array.from(state.membersMap.values());
  dom.memberCount.innerText = String(members.length);

  if (!members.length) {
    dom.membersList.innerHTML = '<div class="empty-state">暂无成员</div>';
    return;
  }

  dom.membersList.innerHTML = '';

  members.forEach((member) => {
    const item = document.createElement('div');
    item.className = 'member-item';

    if (member.id === AI_USER_ID) {
      item.classList.add('member-item-ai');
    }

    const avatar = document.createElement('img');
    avatar.className = 'member-avatar';
    avatar.src = member.avatarUrl;
    avatar.alt = member.nickname;

    const name = document.createElement('div');
    name.className = 'member-name';
    name.append(document.createTextNode(member.nickname));

    if (member.id === AI_USER_ID) {
      const badge = document.createElement('span');
      badge.className = 'member-ai-badge';
      badge.innerText = 'VOICE';
      name.appendChild(badge);
    }

    if (state.currentUser && member.id === state.currentUser.id) {
      const selfBadge = document.createElement('span');
      selfBadge.className = 'member-self-badge';
      selfBadge.innerText = '我';
      name.appendChild(selfBadge);
    }

    item.appendChild(avatar);
    item.appendChild(name);

    item.addEventListener('click', () => {
      if (state.currentUser && member.id === state.currentUser.id) {
        appendMessage({ type: 'system', content: '不能和自己私聊。' });
        return;
      }

      startPrivateChat(member);
    });

    dom.membersList.appendChild(item);
  });
}

function joinChatRoom(nickname, avatarUrl) {
  if (!nickname.trim()) {
    alert('请输入昵称');
    return;
  }

  socket.emit('login', {
    nickname: nickname.trim(),
    avatarUrl
  });
}

function initLoginAvatars() {
  let selectedAvatar = defaultAvatars[0];
  dom.avatarOptions.innerHTML = '';

  defaultAvatars.forEach((url, index) => {
    const avatar = document.createElement('img');
    avatar.className = 'avatar-option';
    avatar.src = url;
    avatar.alt = 'avatar';

    if (index === 0) {
      avatar.classList.add('selected');
    }

    avatar.addEventListener('click', () => {
      document.querySelectorAll('.avatar-option').forEach((item) => item.classList.remove('selected'));
      avatar.classList.add('selected');
      selectedAvatar = url;
    });

    dom.avatarOptions.appendChild(avatar);
  });

  window.getSelectedAvatar = () => selectedAvatar;
}

async function loadVoiceConfig() {
  try {
    const response = await fetch('/api/voice/config');
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || '语音配置获取失败');
    }

    state.voiceConfig = data;

    if (data.backendAvailability.voiceBackendConfigured) {
      dom.voiceBackendHint.innerText = 'FastAPI 语音后端已配置，可用 SenseVoice / CosyVoice / Edge TTS 等引擎。';
    } else {
      dom.voiceBackendHint.innerText = '尚未配置 FastAPI 语音后端。麦克风会优先尝试浏览器识别，朗读会回退到浏览器语音。';
    }
  } catch (error) {
    state.voiceConfig = {
      defaultSettings: defaultVoiceSettings(),
      backendAvailability: {
        voiceBackendConfigured: false
      }
    };
    dom.voiceBackendHint.innerText = '未能读取语音配置，当前将使用浏览器能力降级。';
  }

  loadVoiceSettings();
}

function teardownAudioGraph() {
  if (state.waveAnimationFrame) {
    cancelAnimationFrame(state.waveAnimationFrame);
    state.waveAnimationFrame = null;
  }

  if (state.audioContext) {
    state.audioContext.close().catch(() => {});
    state.audioContext = null;
  }

  state.analyser = null;
  resetWaveBars();
}

function stopMediaStream() {
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((track) => track.stop());
    state.mediaStream = null;
  }
}

function stopRecordingUI() {
  state.isRecording = false;
  dom.voiceRecordBtn.classList.remove('recording');
  dom.voiceRecordBtn.setAttribute('aria-pressed', 'false');
  teardownAudioGraph();
  stopMediaStream();
  updateComposerState();
  updateAiStatus();
}

function watchAudioLevels() {
  if (!state.analyser) {
    return;
  }

  const data = new Uint8Array(state.analyser.frequencyBinCount);
  state.analyser.getByteFrequencyData(data);

  let sum = 0;
  for (const value of data) {
    sum += value;
  }

  const level = sum / data.length / 120;
  setWaveLevel(level);

  if (!state.browserRecognitionMode && state.mediaRecorder?.state === 'recording') {
    if (level > 0.12) {
      state.speechDetected = true;
      state.silenceStartedAt = null;
    } else if (state.speechDetected) {
      if (!state.silenceStartedAt) {
        state.silenceStartedAt = Date.now();
      } else if (Date.now() - state.silenceStartedAt > 1300) {
        stopVoiceCapture({ shouldSend: true });
        return;
      }
    }
  }

  state.waveAnimationFrame = requestAnimationFrame(watchAudioLevels);
}

async function setupAudioMonitoring(stream) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextCtor) {
    return;
  }

  state.audioContext = new AudioContextCtor();
  const source = state.audioContext.createMediaStreamSource(stream);

  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 256;

  source.connect(state.analyser);
  state.silenceStartedAt = null;
  state.speechDetected = false;
  watchAudioLevels();
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function handleRecordedAudio(blob) {
  const audioBase64 = await blobToBase64(blob);
  const response = await fetch('/api/voice/asr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audioBase64,
      mimeType: blob.type || 'audio/webm',
      settings: state.voiceSettings
    })
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || '语音识别失败');
  }

  const transcript = (data.text || data.transcript || '').trim();

  if (!transcript) {
    throw new Error('语音识别结果为空');
  }

  dom.messageInput.value = transcript;
  await sendAiMessage(transcript, 'voice');
}

async function startBrowserRecognition(stream) {
  const RecognitionCtor = getSpeechRecognitionCtor();

  if (!RecognitionCtor) {
    throw new Error('当前浏览器不支持语音识别，请配置 FastAPI ASR 后端。');
  }

  state.browserRecognitionMode = true;
  state.recognitionTranscript = '';

  const recognition = new RecognitionCtor();
  recognition.lang = 'zh-CN';
  recognition.interimResults = true;
  recognition.continuous = !state.voiceSettings.phoneMode;

  recognition.onresult = (event) => {
    let interim = '';
    let finalText = state.recognitionTranscript;

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0]?.transcript || '';

      if (result.isFinal) {
        finalText += transcript;
      } else {
        interim += transcript;
      }
    }

    state.recognitionTranscript = finalText;
    dom.messageInput.value = `${finalText}${interim}`.trim();
  };

  recognition.onerror = () => {
    appendMessage({ type: 'system', content: '浏览器语音识别失败，请重试或切换到 FastAPI ASR 后端。' });
  };

  recognition.onend = async () => {
    const transcript = (state.recognitionTranscript || dom.messageInput.value || '').trim();
    const shouldSend = state.shouldSendRecognition;

    state.recognition = null;
    state.browserRecognitionMode = false;
    stopRecordingUI();

    if (!shouldSend || !transcript) {
      updateAiStatus();
      return;
    }

    dom.messageInput.value = transcript;
    await sendAiMessage(transcript, 'voice');
  };

  state.mediaStream = stream;
  await setupAudioMonitoring(stream);

  state.recognition = recognition;
  recognition.start();
}

async function startVoiceCapture() {
  if (!ensureAiMode('语音输入')) {
    return;
  }

  if (state.isRecording) {
    return;
  }

  stopSpeechPlayback();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const shouldUseBrowserFallback =
      !state.voiceConfig?.backendAvailability?.voiceBackendConfigured && Boolean(getSpeechRecognitionCtor());

    state.isRecording = true;
    dom.voiceRecordBtn.classList.add('recording');
    dom.voiceRecordBtn.setAttribute('aria-pressed', 'true');
    updateComposerState();
    updateAiStatus();

    if (shouldUseBrowserFallback) {
      state.shouldSendRecognition = true;
      await startBrowserRecognition(stream);
      return;
    }

    state.browserRecognitionMode = false;
    state.mediaStream = stream;
    state.audioChunks = [];
    await setupAudioMonitoring(stream);

    const recorder = new MediaRecorder(stream);
    state.mediaRecorder = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        state.audioChunks.push(event.data);
      }
    };

    recorder.onstop = async () => {
      const shouldSend = recorder.dataset.shouldSend === 'true';
      const blob = new Blob(state.audioChunks, { type: recorder.mimeType || 'audio/webm' });

      state.mediaRecorder = null;
      stopRecordingUI();

      if (!shouldSend || blob.size === 0) {
        return;
      }

      try {
        updateAiStatus('语音识别中，请稍候...');
        await handleRecordedAudio(blob);
      } catch (error) {
        appendMessage({
          type: 'system',
          content: `语音识别失败：${error.message}`
        });
        updateAiStatus();
      }
    };

    recorder.start();
  } catch (error) {
    state.isRecording = false;
    dom.voiceRecordBtn.classList.remove('recording');
    appendMessage({
      type: 'system',
      content: `无法开启麦克风：${error.message}`
    });
    updateComposerState();
    updateAiStatus();
  }
}

function stopVoiceCapture({ shouldSend }) {
  if (!state.isRecording) {
    return;
  }

  if (state.recognition) {
    state.shouldSendRecognition = shouldSend;
    state.recognition.stop();
    return;
  }

  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.dataset.shouldSend = shouldSend ? 'true' : 'false';
    state.mediaRecorder.stop();
    return;
  }

  stopRecordingUI();
}

async function clearAiHistory() {
  if (!ensureAiMode('清空对话')) {
    return;
  }

  try {
    const response = await fetch('/api/ai/history/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: getAiSessionId()
      })
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.message || '清空失败');
    }

    appendMessage({
      type: 'system',
      content: 'AI 对话历史已清空，后续提问会从新的上下文开始。'
    });
  } catch (error) {
    appendMessage({
      type: 'system',
      content: `清空对话失败：${error.message}`
    });
  }
}

function bindSocketEvents() {
  socket.on('login_success', (userData) => {
    state.currentUser = {
      id: userData.id,
      nickname: userData.nickname,
      avatarUrl: userData.avatarUrl
    };

    state.membersMap.set(state.currentUser.id, state.currentUser);
    renderMembersList();

    dom.loginOverlay.style.display = 'none';
    dom.chatRoomContainer.style.display = 'flex';

    appendMessage({
      type: 'system',
      content: `欢迎 ${state.currentUser.nickname} 加入聊天室。`
    });

    updateComposerState();
  });

  socket.on('login_error', (errorMsg) => {
    alert(errorMsg);
  });

  socket.on('join', (content) => {
    appendMessage({ type: 'system', content });
  });

  socket.on('user_list', (users) => {
    state.membersMap.clear();

    users.forEach((user) => {
      state.membersMap.set(user.id, {
        id: user.id,
        nickname: user.nickName,
        avatarUrl: user.avatar
      });
    });

    renderMembersList();
  });

  socket.on('publicMessage', (data) => {
    appendMessage({
      type: 'message',
      senderNickname: data.nickname,
      senderAvatar: data.avatarUrl,
      content: data.content,
      isPrivate: false
    });
  });

  socket.on('privateMessage', async (data) => {
    const refs = appendMessage({
      type: 'message',
      senderNickname: data.fromNickname,
      senderAvatar: data.fromAvatar,
      content: data.content,
      isPrivate: true,
      isAi: Boolean(data.isAi),
      isAiReply: Boolean(data.isAi),
      source: data.source || 'text'
    });

    if (data.isAi) {
      buildReplayButtons(refs.actions, data.content);
      await playReplyAudio(data.content);
      return;
    }

    if (!state.currentPrivateTarget || state.currentPrivateTarget.id !== data.fromId) {
      appendMessage({
        type: 'system',
        content: `${data.fromNickname} 给你发来了一条私聊。`
      });
    }
  });

  socket.on('ai_status', ({ loading }) => {
    state.aiRequestInFlight = Boolean(loading);
    updateComposerState();
    updateAiStatus();
  });
}

function bindEventListeners() {
  dom.joinBtn.addEventListener('click', () => {
    const nickname = dom.nicknameInput.value.trim();
    const avatar = window.getSelectedAvatar ? window.getSelectedAvatar() : defaultAvatars[0];
    joinChatRoom(nickname, avatar);
  });

  dom.nicknameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      dom.joinBtn.click();
    }
  });

  dom.sendBtn.addEventListener('click', () => {
    sendMessage(dom.messageInput.value);
  });

  dom.messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage(dom.messageInput.value);
    }
  });

  dom.closePrivateBtn.addEventListener('click', () => {
    exitPrivateChat();
  });

  dom.readAloudToggle.addEventListener('click', () => {
    state.voiceSettings.autoRead = !state.voiceSettings.autoRead;
    persistVoiceSettings();
    applyVoiceSettingsToUI();

    if (!state.voiceSettings.autoRead) {
      stopSpeechPlayback();
    }
  });

  dom.phoneModeToggle.addEventListener('click', () => {
    state.voiceSettings.phoneMode = !state.voiceSettings.phoneMode;
    persistVoiceSettings();
    applyVoiceSettingsToUI();
  });

  dom.clearAiHistoryBtn.addEventListener('click', () => {
    clearAiHistory();
  });

  dom.settingsToggleBtn.addEventListener('click', () => {
    dom.settingsPanel.classList.toggle('hidden');
    dom.settingsToggleBtn.setAttribute('aria-expanded', String(!dom.settingsPanel.classList.contains('hidden')));
  });

  dom.asrEngineSelect.addEventListener('change', syncSettingsFromUI);
  dom.ttsEngineSelect.addEventListener('change', syncSettingsFromUI);
  dom.llmBackendSelect.addEventListener('change', syncSettingsFromUI);
  dom.llmModelInput.addEventListener('change', syncSettingsFromUI);
  dom.speechRateInput.addEventListener('input', syncSettingsFromUI);
  dom.speechPitchInput.addEventListener('input', syncSettingsFromUI);

  dom.voiceRecordBtn.addEventListener('click', async () => {
    if (state.voiceSettings.phoneMode) {
      return;
    }

    if (state.isRecording) {
      stopVoiceCapture({ shouldSend: true });
    } else {
      await startVoiceCapture();
    }
  });

  dom.voiceRecordBtn.addEventListener('pointerdown', async (event) => {
    if (!state.voiceSettings.phoneMode) {
      return;
    }

    event.preventDefault();
    await startVoiceCapture();
  });

  ['pointerup', 'pointerleave', 'pointercancel'].forEach((eventName) => {
    dom.voiceRecordBtn.addEventListener(eventName, (event) => {
      if (!state.voiceSettings.phoneMode) {
        return;
      }

      event.preventDefault();

      if (state.isRecording) {
        stopVoiceCapture({ shouldSend: true });
      }
    });
  });

  dom.messagesArea.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');

    if (!button) {
      return;
    }

    const action = button.dataset.action;

    if (action === 'replay-tts') {
      await playReplyAudio(button.dataset.text || '', { force: true });
      return;
    }

    if (action === 'stop-tts') {
      stopSpeechPlayback();
    }
  });
}

async function init() {
  initLoginAvatars();
  bindSocketEvents();
  bindEventListeners();
  await loadVoiceConfig();
  resetWaveBars();
  updateComposerState();
  updateAiStatus();
}

init();
