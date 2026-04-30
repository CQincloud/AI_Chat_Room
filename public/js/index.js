const { createApp, nextTick } = Vue;

const socket = io();
const AI_USER_ID = 'ai-assistant';
const AI_AVATAR = 'img/g.webp';
const VOICE_SETTINGS_KEY = 'chat-ai-voice-settings-v3';
const createMessageId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

createApp({
  data() {
    return {
      AI_USER_ID,
      defaultAvatars: [
        'img/a.webp',
        'img/b.jpg',
        'img/c.jpg',
        'img/d.jpg',
        'img/e.png',
        'img/f.jpg',
        'img/g.webp'
      ],
      currentUser: null,
      currentPrivateTarget: null,
      membersMap: new Map(),
      messages: [
        {
          id: createMessageId('system'),
          type: 'system',
          content: '欢迎来到聊天室。这里支持公开聊天、私聊，以及 AI 的文字和语音混合对话。'
        }
      ],
      loginNickname: '',
      selectedAvatar: 'img/a.webp',
      messageInput: '',
      voiceConfig: null,
      voiceSettings: {
        autoRead: true,
        phoneMode: false,
        asrEngine: 'sensevoice',
        ttsEngine: 'cosyvoice',
        llmBackend: 'deepseek-api',
        llmModel: '',
        speechRate: 1,
        speechPitch: 1
      },
      showSettings: false,
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
      activeTypewriterToken: null,
      waveLevels: Array.from({ length: 12 }, () => 0.2),
      aiStatusText: '点击左侧 AI Assistant，开始文本或语音混合对话。',
      voiceHintText: '文本和语音都能发送给 AI。电话模式下支持按住说话。',
      voiceBackendHint: '语音后端未连接时，会优先尝试浏览器能力做降级。'
    };
  },

  computed: {
    members() {
      return Array.from(this.membersMap.values());
    },

    chatModeLabel() {
      if (this.currentPrivateTarget?.id === AI_USER_ID) {
        return 'AI 对话';
      }

      if (this.currentPrivateTarget) {
        return '私聊中';
      }

      return '公开聊天';
    },

    chatTargetLabel() {
      return this.currentPrivateTarget ? `当前对象：${this.currentPrivateTarget.nickname}` : '';
    },

    messagePlaceholder() {
      if (this.currentPrivateTarget?.id === AI_USER_ID) {
        return '输入你的问题，或者点击麦克风开始说话...';
      }

      if (this.currentPrivateTarget) {
        return `私信 ${this.currentPrivateTarget.nickname}...`;
      }

      return '输入消息...';
    }
  },

  mounted() {
    this.bindSocketEvents();
    this.loadVoiceConfig();
    this.resetWaveBars();
    this.updateAiStatus();
    this.updateVoiceHint();
  },

  methods: {
    createMessageId(prefix) {
      return createMessageId(prefix);
    },

    isAiChat() {
      return this.currentPrivateTarget?.id === AI_USER_ID;
    },

    getAiSessionId() {
      return this.currentUser ? `ai-session-${this.currentUser.id}` : 'ai-session-guest';
    },

    getSpeechRecognitionCtor() {
      return window.SpeechRecognition || window.webkitSpeechRecognition || null;
    },

    messageItemClass(message) {
      if (message.type === 'system') {
        return 'system-message';
      }

      return message.senderNickname === this.currentUser?.nickname
        ? 'message-item-right'
        : 'message-item-left';
    },

    waveBarStyle(level, index) {
      const factor = 0.25 + ((index % 4) * 0.1);
      const height = 8 + Math.max(0, Math.min(1, level)) * 22 * factor * 2.4;

      return {
        height: `${height}px`,
        opacity: String(0.25 + Math.min(0.85, level + 0.2))
      };
    },

    appendMessage(message) {
      const newMessage = {
        id: this.createMessageId(message.type || 'msg'),
        type: message.type || 'message',
        senderNickname: message.senderNickname || '',
        senderAvatar: message.senderAvatar || '',
        content: message.content || '',
        isPrivate: Boolean(message.isPrivate),
        isAi: Boolean(message.isAi),
        isAiReply: Boolean(message.isAiReply),
        source: message.source || 'text'
      };

      this.messages.push(newMessage);
      this.scrollMessagesToBottom();
      return newMessage;
    },

    async scrollMessagesToBottom() {
      await nextTick();
      const area = document.querySelector('.messages-area');

      if (area) {
        area.scrollTop = area.scrollHeight;
      }
    },

    updateAiStatus(text) {
      if (text) {
        this.aiStatusText = text;
        return;
      }

      if (this.isRecording) {
        this.aiStatusText = this.browserRecognitionMode
          ? '正在聆听并实时识别语音...'
          : '正在录音中，说完后会自动识别并发送给 AI。';
        return;
      }

      if (this.aiRequestInFlight) {
        this.aiStatusText = 'AI 正在思考中，请稍候...';
        return;
      }

      if (this.isAiChat()) {
        this.aiStatusText = this.voiceSettings.autoRead
          ? 'AI 对话已就绪，支持文字输入、语音输入和自动朗读。'
          : 'AI 对话已就绪，目前为静音模式，仅显示文字回复。';
        return;
      }

      this.aiStatusText = '点击左侧 AI Assistant，开始文本或语音混合对话。';
    },

    updateVoiceHint() {
      this.voiceHintText = this.voiceSettings.phoneMode
        ? '电话模式已开启，按住麦克风说话，松开后自动发送；朗读时可再次按住打断。'
        : '点击麦克风开始录音，再次点击或静音后自动结束。文本和语音可以混用。';
    },

    persistVoiceSettings() {
      localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(this.voiceSettings));
      this.updateVoiceHint();
      this.updateAiStatus();
    },

    loadVoiceSettings() {
      const savedSettings = JSON.parse(localStorage.getItem(VOICE_SETTINGS_KEY) || 'null');
      const mergedSettings = {
        autoRead: true,
        phoneMode: false,
        asrEngine: 'sensevoice',
        ttsEngine: 'cosyvoice',
        llmBackend: 'deepseek-api',
        llmModel: '',
        speechRate: 1,
        speechPitch: 1,
        ...(this.voiceConfig?.defaultSettings || {}),
        ...(savedSettings || {})
      };

      this.voiceSettings = mergedSettings;
      this.updateVoiceHint();
      this.updateAiStatus();
    },

    async loadVoiceConfig() {
      try {
        const response = await fetch('/api/voice/config');
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || '语音配置获取失败');
        }

        this.voiceConfig = data;
        this.voiceBackendHint = data.backendAvailability.voiceBackendConfigured
          ? 'FastAPI 语音后端已配置，可用 SenseVoice / CosyVoice / Edge TTS 等引擎。'
          : '尚未配置 FastAPI 语音后端。麦克风会优先尝试浏览器识别，朗读会回退到浏览器语音。';
      } catch (error) {
        this.voiceConfig = {
          defaultSettings: {
            autoRead: true,
            phoneMode: false,
            asrEngine: 'sensevoice',
            ttsEngine: 'cosyvoice',
            llmBackend: 'deepseek-api',
            llmModel: '',
            speechRate: 1,
            speechPitch: 1
          },
          backendAvailability: {
            voiceBackendConfigured: false
          }
        };
        this.voiceBackendHint = '未能读取语音配置，当前将使用浏览器能力降级。';
      }

      this.loadVoiceSettings();
    },

    handleMemberClick(member) {
      if (this.currentUser && member.id === this.currentUser.id) {
        this.appendMessage({ type: 'system', content: '不能和自己私聊。' });
        return;
      }

      this.currentPrivateTarget = member;

      if (member.id === AI_USER_ID) {
        this.appendMessage({
          type: 'system',
          content: '已切换到 AI 语音对话模式。你现在可以输入文字、点击麦克风说话，或开启电话模式按住说话。'
        });
      } else {
        this.appendMessage({
          type: 'system',
          content: `已切换为私聊模式，对象：${member.nickname}`
        });
      }

      this.updateAiStatus();
    },

    exitPrivateChat() {
      this.currentPrivateTarget = null;
      this.appendMessage({ type: 'system', content: '已切换回公开频道。' });
      this.updateAiStatus();
    },

    joinChatRoom() {
      if (!this.loginNickname.trim()) {
        alert('请输入昵称');
        return;
      }

      socket.emit('login', {
        nickname: this.loginNickname.trim(),
        avatarUrl: this.selectedAvatar
      });
    },

    handleSend() {
      if (!this.messageInput.trim()) {
        return;
      }

      if (this.isAiChat()) {
        this.sendAiMessage(this.messageInput, 'text');
        return;
      }

      const content = this.messageInput.trim();

      if (this.currentPrivateTarget) {
        socket.emit('privateMessage', {
          toId: this.currentPrivateTarget.id,
          toNickname: this.currentPrivateTarget.nickname,
          content
        });

        this.appendMessage({
          type: 'message',
          senderNickname: this.currentUser.nickname,
          senderAvatar: this.currentUser.avatarUrl,
          content,
          isPrivate: true
        });
      } else {
        socket.emit('publicMessage', { content });
      }

      this.messageInput = '';
    },

    buildServerSettings() {
      return {
        ...this.voiceSettings,
        llmModel: this.voiceSettings.llmModel.trim()
      };
    },

    ensureAiMode(actionLabel) {
      if (this.isAiChat()) {
        return true;
      }

      this.appendMessage({
        type: 'system',
        content: `${actionLabel}需要先切换到 AI Assistant 对话窗口。`
      });

      return false;
    },

    async sendAiMessage(content, source = 'text') {
      const text = content.trim();

      if (!text || this.aiRequestInFlight) {
        return;
      }

      this.appendMessage({
        type: 'message',
        senderNickname: this.currentUser.nickname,
        senderAvatar: this.currentUser.avatarUrl,
        content: text,
        isPrivate: true,
        isAi: true,
        source
      });

      this.messageInput = '';
      this.aiRequestInFlight = true;
      this.updateAiStatus();

      const pendingMessage = this.appendMessage({
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
            sessionId: this.getAiSessionId(),
            nickname: this.currentUser.nickname,
            message: text,
            source,
            settings: this.buildServerSettings()
          })
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || 'AI 服务异常');
        }

        await this.animateAiReply(pendingMessage, data.reply);
        await this.playReplyAudio(data.reply, false);
        this.updateAiStatus(`AI 已通过 ${data.backend} / ${data.model} 回复完成。`);
      } catch (error) {
        pendingMessage.content = `AI 回复失败：${error.message}`;
        this.appendMessage({
          type: 'system',
          content: '本轮 AI 调用失败了。你可以检查语音后端、模型后端或网络配置后重试。'
        });
      } finally {
        this.aiRequestInFlight = false;
        this.updateAiStatus();
      }
    },

    async animateAiReply(message, content) {
      const token = { cancelled: false };

      if (this.activeTypewriterToken) {
        this.activeTypewriterToken.cancelled = true;
      }

      this.activeTypewriterToken = token;

      if (!this.voiceSettings.phoneMode) {
        message.content = content;
        return;
      }

      message.content = '';

      for (const char of content) {
        if (token.cancelled) {
          message.content = content;
          break;
        }

        message.content += char;
        await this.scrollMessagesToBottom();
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
    },

    stopSpeechPlayback() {
      if (this.currentAudio) {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        this.currentAudio = null;
      }

      if (this.currentUtterance && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        this.currentUtterance = null;
      }

      if (this.$refs.ttsAudioPlayer) {
        this.$refs.ttsAudioPlayer.pause();
        this.$refs.ttsAudioPlayer.currentTime = 0;
      }

      this.updateAiStatus();
    },

    speakWithBrowser(text) {
      if (!('speechSynthesis' in window)) {
        this.appendMessage({ type: 'system', content: '当前浏览器不支持内置语音朗读。' });
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = this.voiceSettings.speechRate;
      utterance.pitch = this.voiceSettings.speechPitch;
      utterance.onend = () => {
        this.currentUtterance = null;
        this.updateAiStatus();
      };
      utterance.onerror = () => {
        this.currentUtterance = null;
        this.updateAiStatus('浏览器朗读失败，请尝试切换 TTS 引擎或检查权限。');
      };

      this.currentUtterance = utterance;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    },

    async playAudioBase64(audioBase64, mimeType) {
      const src = `data:${mimeType || 'audio/mpeg'};base64,${audioBase64}`;

      this.$refs.ttsAudioPlayer.src = src;
      this.currentAudio = this.$refs.ttsAudioPlayer;

      await this.$refs.ttsAudioPlayer.play();

      this.$refs.ttsAudioPlayer.onended = () => {
        this.currentAudio = null;
        this.updateAiStatus();
      };
    },

    async playReplyAudio(text, force = false) {
      if (!text?.trim()) {
        return;
      }

      if (!this.voiceSettings.autoRead && !force) {
        return;
      }

      this.stopSpeechPlayback();
      this.updateAiStatus(force ? '正在重播 AI 语音...' : 'AI 正在朗读回复...');

      try {
        const response = await fetch('/api/voice/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            settings: this.voiceSettings
          })
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || '朗读失败');
        }

        if (data.audio_base64) {
          await this.playAudioBase64(data.audio_base64, data.mime_type);
          return;
        }

        this.speakWithBrowser(text);
      } catch (error) {
        this.appendMessage({
          type: 'system',
          content: `语音朗读暂时不可用，已切换到浏览器朗读：${error.message}`
        });
        this.speakWithBrowser(text);
      }
    },

    toggleReadAloud() {
      this.voiceSettings.autoRead = !this.voiceSettings.autoRead;
      this.persistVoiceSettings();

      if (!this.voiceSettings.autoRead) {
        this.stopSpeechPlayback();
      }
    },

    togglePhoneMode() {
      this.voiceSettings.phoneMode = !this.voiceSettings.phoneMode;
      this.persistVoiceSettings();
    },

    setWaveLevel(level) {
      this.waveLevels = this.waveLevels.map((_, index) => {
        const factor = 0.25 + ((index % 4) * 0.1);
        return Math.max(0, Math.min(1, level * factor * 2.4));
      });
    },

    resetWaveBars() {
      this.waveLevels = this.waveLevels.map((_, index) => 0.18 + (index % 3) * 0.04);
    },

    teardownAudioGraph() {
      if (this.waveAnimationFrame) {
        cancelAnimationFrame(this.waveAnimationFrame);
        this.waveAnimationFrame = null;
      }

      if (this.audioContext) {
        this.audioContext.close().catch(() => {});
        this.audioContext = null;
      }

      this.analyser = null;
      this.resetWaveBars();
    },

    stopMediaStream() {
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((track) => track.stop());
        this.mediaStream = null;
      }
    },

    stopRecordingUI() {
      this.isRecording = false;
      this.teardownAudioGraph();
      this.stopMediaStream();
      this.updateAiStatus();
    },

    watchAudioLevels() {
      if (!this.analyser) {
        return;
      }

      const data = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(data);

      let sum = 0;
      for (const value of data) {
        sum += value;
      }

      const level = sum / data.length / 120;
      this.setWaveLevel(level);

      if (!this.browserRecognitionMode && this.mediaRecorder?.state === 'recording') {
        if (level > 0.12) {
          this.speechDetected = true;
          this.silenceStartedAt = null;
        } else if (this.speechDetected) {
          if (!this.silenceStartedAt) {
            this.silenceStartedAt = Date.now();
          } else if (Date.now() - this.silenceStartedAt > 1300) {
            this.stopVoiceCapture(true);
            return;
          }
        }
      }

      this.waveAnimationFrame = requestAnimationFrame(() => this.watchAudioLevels());
    },

    async setupAudioMonitoring(stream) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

      if (!AudioContextCtor) {
        return;
      }

      this.audioContext = new AudioContextCtor();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      this.silenceStartedAt = null;
      this.speechDetected = false;
      this.watchAudioLevels();
    },

    blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = String(reader.result || '');
          resolve(result.split(',')[1] || '');
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    },

    async handleRecordedAudio(blob) {
      const audioBase64 = await this.blobToBase64(blob);
      const response = await fetch('/api/voice/asr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64,
          mimeType: blob.type || 'audio/webm',
          settings: this.voiceSettings
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

      this.messageInput = transcript;
      await this.sendAiMessage(transcript, 'voice');
    },

    async startBrowserRecognition(stream) {
      const RecognitionCtor = this.getSpeechRecognitionCtor();

      if (!RecognitionCtor) {
        throw new Error('当前浏览器不支持语音识别，请配置 FastAPI ASR 后端。');
      }

      this.browserRecognitionMode = true;
      this.recognitionTranscript = '';

      const recognition = new RecognitionCtor();
      recognition.lang = 'zh-CN';
      recognition.interimResults = true;
      recognition.continuous = !this.voiceSettings.phoneMode;

      recognition.onresult = (event) => {
        let interim = '';
        let finalText = this.recognitionTranscript;

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result[0]?.transcript || '';

          if (result.isFinal) {
            finalText += transcript;
          } else {
            interim += transcript;
          }
        }

        this.recognitionTranscript = finalText;
        this.messageInput = `${finalText}${interim}`.trim();
      };

      recognition.onerror = () => {
        this.appendMessage({ type: 'system', content: '浏览器语音识别失败，请重试或切换到 FastAPI ASR 后端。' });
      };

      recognition.onend = async () => {
        const transcript = (this.recognitionTranscript || this.messageInput || '').trim();
        const shouldSend = this.shouldSendRecognition;

        this.recognition = null;
        this.browserRecognitionMode = false;
        this.stopRecordingUI();

        if (!shouldSend || !transcript) {
          this.updateAiStatus();
          return;
        }

        this.messageInput = transcript;
        await this.sendAiMessage(transcript, 'voice');
      };

      this.mediaStream = stream;
      await this.setupAudioMonitoring(stream);
      this.recognition = recognition;
      recognition.start();
    },

    async startVoiceCapture() {
      if (!this.ensureAiMode('语音输入')) {
        return;
      }

      if (this.isRecording) {
        return;
      }

      this.stopSpeechPlayback();

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const shouldUseBrowserFallback =
          !this.voiceConfig?.backendAvailability?.voiceBackendConfigured &&
          Boolean(this.getSpeechRecognitionCtor());

        this.isRecording = true;
        this.updateAiStatus();

        if (shouldUseBrowserFallback) {
          this.shouldSendRecognition = true;
          await this.startBrowserRecognition(stream);
          return;
        }

        this.browserRecognitionMode = false;
        this.mediaStream = stream;
        this.audioChunks = [];
        await this.setupAudioMonitoring(stream);

        const recorder = new MediaRecorder(stream);
        this.mediaRecorder = recorder;

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            this.audioChunks.push(event.data);
          }
        };

        recorder.onstop = async () => {
          const shouldSend = recorder.dataset.shouldSend === 'true';
          const blob = new Blob(this.audioChunks, { type: recorder.mimeType || 'audio/webm' });

          this.mediaRecorder = null;
          this.stopRecordingUI();

          if (!shouldSend || blob.size === 0) {
            return;
          }

          try {
            this.updateAiStatus('语音识别中，请稍候...');
            await this.handleRecordedAudio(blob);
          } catch (error) {
            this.appendMessage({
              type: 'system',
              content: `语音识别失败：${error.message}`
            });
            this.updateAiStatus();
          }
        };

        recorder.start();
      } catch (error) {
        this.isRecording = false;
        this.appendMessage({
          type: 'system',
          content: `无法开启麦克风：${error.message}`
        });
        this.updateAiStatus();
      }
    },

    stopVoiceCapture(shouldSend) {
      if (!this.isRecording) {
        return;
      }

      if (this.recognition) {
        this.shouldSendRecognition = shouldSend;
        this.recognition.stop();
        return;
      }

      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.dataset.shouldSend = shouldSend ? 'true' : 'false';
        this.mediaRecorder.stop();
        return;
      }

      this.stopRecordingUI();
    },

    handleMicClick() {
      if (this.voiceSettings.phoneMode) {
        return;
      }

      if (this.isRecording) {
        this.stopVoiceCapture(true);
      } else {
        this.startVoiceCapture();
      }
    },

    handleMicPointerDown(event) {
      if (!this.voiceSettings.phoneMode) {
        return;
      }

      event.preventDefault();
      this.startVoiceCapture();
    },

    handleMicPointerUp(event) {
      if (!this.voiceSettings.phoneMode) {
        return;
      }

      event.preventDefault();

      if (this.isRecording) {
        this.stopVoiceCapture(true);
      }
    },

    async clearAiHistory() {
      if (!this.ensureAiMode('清空对话')) {
        return;
      }

      try {
        const response = await fetch('/api/ai/history/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: this.getAiSessionId()
          })
        });
        const data = await response.json();

        if (!response.ok || !data.ok) {
          throw new Error(data.message || '清空失败');
        }

        this.appendMessage({
          type: 'system',
          content: 'AI 对话历史已清空，后续提问会从新的上下文开始。'
        });
      } catch (error) {
        this.appendMessage({
          type: 'system',
          content: `清空对话失败：${error.message}`
        });
      }
    },

    bindSocketEvents() {
      socket.on('login_success', (userData) => {
        this.currentUser = {
          id: userData.id,
          nickname: userData.nickname,
          avatarUrl: userData.avatarUrl
        };

        this.membersMap.set(this.currentUser.id, this.currentUser);
        this.appendMessage({
          type: 'system',
          content: `欢迎 ${this.currentUser.nickname} 加入聊天室。`
        });
      });

      socket.on('login_error', (errorMsg) => {
        alert(errorMsg);
      });

      socket.on('join', (content) => {
        this.appendMessage({ type: 'system', content });
      });

      socket.on('user_list', (users) => {
        const memberMap = new Map();

        users.forEach((user) => {
          memberMap.set(user.id, {
            id: user.id,
            nickname: user.nickName,
            avatarUrl: user.avatar
          });
        });

        this.membersMap = memberMap;
      });

      socket.on('publicMessage', (data) => {
        this.appendMessage({
          type: 'message',
          senderNickname: data.nickname,
          senderAvatar: data.avatarUrl,
          content: data.content,
          isPrivate: false
        });
      });

      socket.on('privateMessage', async (data) => {
        const message = this.appendMessage({
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
          await this.playReplyAudio(message.content, false);
          return;
        }

        if (!this.currentPrivateTarget || this.currentPrivateTarget.id !== data.fromId) {
          this.appendMessage({
            type: 'system',
            content: `${data.fromNickname} 给你发来了一条私聊。`
          });
        }
      });

      socket.on('ai_status', ({ loading }) => {
        this.aiRequestInFlight = Boolean(loading);
        this.updateAiStatus();
      });
    }
  }
}).mount('#app');
